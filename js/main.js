import { createViewer } from './viewer.js';
import { createMap } from './map.js';
import { getSunPosition, zonedToUTC, tzAbbrev } from './solar.js';
import { bearingTo, angularDiff, trackOffset } from './geo.js';

// ---- fixed site parameters ----
const ORIGIN = { lat: 45.514204, lon: -73.585227 };
const TZ = 'America/Toronto'; // Montréal
const BAKERY_CSV = 'montreal_bagel_bakeries.csv';

let bakeries = [];        // {name, lat, lon, address}
let lastBearing = null;   // remember bearing so control changes re-match

const $ = (id) => document.getElementById(id);
const els = {
  date: $('date'), time: $('time'), heading: $('heading'), distance: $('distance'),
  nowBtn: $('nowBtn'), tzLabel: $('tzLabel'), headingVal: $('headingVal'), distVal: $('distVal'),
  roSun: $('roSun'), roBearing: $('roBearing'), roTip: $('roTip'), roOffset: $('roOffset'),
  roPlace: $('roPlace'), note: $('viewerNote'),
};

const viewer = createViewer($('viewer3d'));
const map = createMap('map', ORIGIN);

// keep the slider track fill in sync with its value
function paintSlider(el) {
  const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
  el.style.background = `linear-gradient(90deg, var(--accent) ${pct}%, var(--edge-hi) ${pct}%)`;
}

// ---- recompute the sun + shadow bearing (heavy: on date/time/heading change) ----
function recompute() {
  const utc = zonedToUTC(els.date.value, els.time.value, TZ);
  els.tzLabel.textContent = `(${tzAbbrev(utc, TZ)})`;

  const { azimuth, altitude } = getSunPosition(utc, ORIGIN.lat, ORIGIN.lon);
  els.roSun.textContent = `${azimuth.toFixed(1)}° az · ${altitude.toFixed(1)}° alt`;

  const result = viewer.updateSun(azimuth, altitude);

  if (!result) {
    els.note.hidden = false;
    els.note.textContent = altitude <= 0
      ? 'Sun is below the horizon — no shadow at this time.'
      : 'Sun on the horizon — shadow runs to infinity.';
    els.roBearing.textContent = '—';
    els.roTip.textContent = '—';
    return;
  }
  els.note.hidden = true;

  els.roBearing.textContent = `${result.bearingDeg.toFixed(1)}° (${compass16(result.bearingDeg)})`;
  els.roTip.textContent =
    `E ${result.offsetEast.toFixed(2)} · N ${result.offsetNorth.toFixed(2)} m`;

  lastBearing = result.bearingDeg;
  map.setBearing(result.bearingDeg);
  matchBakery(result.bearingDeg);
}

// Find the bakery the shadow bearing points at: the one whose direction from the
// monument is most closely aligned with the shadow bearing (least angular error).
function matchBakery(bearing) {
  if (!bakeries.length) return;
  let best = -1, bestAng = Infinity;
  bakeries.forEach((b, i) => {
    const brg = bearingTo(ORIGIN.lat, ORIGIN.lon, b.lat, b.lon);
    const ang = angularDiff(brg, bearing);
    if (ang < bestAng) { bestAng = ang; best = i; }
  });
  map.setTarget(best);
  if (best < 0) { els.roOffset.textContent = '—'; els.roPlace.textContent = '—'; return; }
  const b = bakeries[best];
  const off = trackOffset(ORIGIN.lat, ORIGIN.lon, bearing, b.lat, b.lon);
  els.roOffset.textContent = `${bestAng.toFixed(1)}° off · ${off.crossKm.toFixed(1)} km · ${off.alongKm.toFixed(1)} km out`;
  els.roPlace.textContent = `🥯 ${b.name} — ${b.address}`;
}

// ---- global range marker readout (secondary explorer) ----
map.onMarker(({ km }) => {
  els.distance.value = Math.round(km);
  els.distVal.textContent = `${Math.round(km).toLocaleString()} km`;
  paintSlider(els.distance);
});

// ---- control listeners ----
['change', 'input'].forEach((ev) => {
  els.date.addEventListener(ev, recompute);
  els.time.addEventListener(ev, recompute);
});
els.heading.addEventListener('input', () => {
  els.headingVal.textContent = `${els.heading.value}°`;
  paintSlider(els.heading);
  viewer.setHeading(Number(els.heading.value));
  recompute();
});
els.distance.addEventListener('input', () => {
  els.distVal.textContent = `${Number(els.distance.value).toLocaleString()} km`;
  paintSlider(els.distance);
  map.setDistance(Number(els.distance.value));
});
els.nowBtn.addEventListener('click', () => {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const m = {}; for (const p of parts) m[p.type] = p.value;
  els.date.value = `${m.year}-${m.month}-${m.day}`;
  els.time.value = `${m.hour}:${m.minute}`;
  recompute();
});

// ---- boot ----
paintSlider(els.heading);
paintSlider(els.distance);
map.setDistance(Number(els.distance.value), false);

loadBakeries();

viewer.loadModel('model/', '3DModel.mtl', '3DModel.obj')
  .then(() => { recompute(); setTimeout(() => map.invalidate(), 100); })
  .catch((err) => {
    console.error('Model load failed', err);
    els.note.hidden = false;
    els.note.textContent = 'Could not load the 3D model.';
  });

async function loadBakeries() {
  try {
    const res = await fetch(BAKERY_CSV);
    if (!res.ok) throw new Error(res.status);
    bakeries = parseCSV(await res.text());
    map.plotBakeries(bakeries);
    if (lastBearing !== null) matchBakery(lastBearing);
  } catch (e) {
    console.error('Bakery CSV load failed', e);
  }
}

// Minimal CSV parser: handles quoted fields containing commas. Columns: name,lat,long,street_address
function parseCSV(text) {
  const rows = [];
  const lines = text.trim().split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {       // skip header
    const cols = splitCSVLine(lines[i]);
    if (cols.length < 3) continue;
    const lat = parseFloat(cols[1]);
    const lon = parseFloat(cols[2]);
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
    rows.push({ name: cols[0], lat, lon, address: (cols[3] || '').trim() });
  }
  return rows;
}
function splitCSVLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      out.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

// ---- helpers ----
function compass16(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}
