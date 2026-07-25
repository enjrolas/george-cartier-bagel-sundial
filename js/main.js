import { createViewer } from './viewer.js';
import { getSunPosition, zonedToUTC, tzAbbrev } from './solar.js';
import { bearingTo, angularDiff, trackOffset } from './geo.js';

// ---- fixed site parameters ----
const ORIGIN = { lat: 45.514204, lon: -73.585227 };
const TZ = 'America/Toronto'; // Montréal
const BAKERY_CSV = 'montreal_bagel_bakeries.csv';
const HEADING = 207;          // monument's real-world facing, degrees from true north

let bakeries = [];
let lastBearing = null;

const $ = (id) => document.getElementById(id);
const els = {
  date: $('date'), timeSlider: $('timeSlider'), timeVal: $('timeVal'),
  nowBtn: $('nowBtn'), tzLabel: $('tzLabel'),
  roSun: $('roSun'), roBearing: $('roBearing'), roTip: $('roTip'), roOffset: $('roOffset'),
  roPlace: $('roPlace'), note: $('viewerNote'),
  viewCity: $('viewCity'), viewStatue: $('viewStatue'),
};

const pad = (n) => String(n).padStart(2, '0');
const minutesToHHMM = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

function paintSlider(el) {
  const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
  el.style.background = `linear-gradient(90deg, var(--accent) ${pct}%, var(--edge-hi) ${pct}%)`;
}

// current wall-clock in Montréal → date string + minutes-of-day
function nowInTZ() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const m = {}; for (const p of parts) m[p.type] = p.value;
  return { date: `${m.year}-${m.month}-${m.day}`, minutes: Number(m.hour) * 60 + Number(m.minute) };
}

function setNow() {
  const n = nowInTZ();
  els.date.value = n.date;
  els.timeSlider.value = n.minutes;
  els.timeVal.textContent = minutesToHHMM(n.minutes);
  paintSlider(els.timeSlider);
}

// surface any runtime error on-page instead of leaving a blank panel
function showError(msg) {
  if (!els.note) return;
  els.note.hidden = false;
  els.note.textContent = msg;
}
window.addEventListener('error', (e) => showError(`Error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => showError(`Error: ${e.reason?.message || e.reason}`));

let viewer;
try {
  viewer = createViewer($('scene'), ORIGIN);
} catch (e) {
  showError(`Scene failed to start: ${e.message}`);
  throw e;
}

function recompute() {
  const timeStr = minutesToHHMM(Number(els.timeSlider.value));
  const utc = zonedToUTC(els.date.value, timeStr, TZ);
  els.tzLabel.textContent = `(${tzAbbrev(utc, TZ)})`;

  const { azimuth, altitude } = getSunPosition(utc, ORIGIN.lat, ORIGIN.lon);
  els.roSun.textContent = `${azimuth.toFixed(1)}° az · ${altitude.toFixed(1)}° alt`;

  const result = viewer.updateSun(azimuth, altitude);
  if (!result) {
    els.note.hidden = false;
    els.note.textContent = altitude <= 0
      ? 'Sun is below the horizon — no shadow at this time.'
      : 'Sun on the horizon — shadow runs to infinity.';
    els.roBearing.textContent = els.roTip.textContent = els.roOffset.textContent = '—';
    els.roPlace.textContent = '—';
    viewer.setTarget(-1);
    return;
  }
  els.note.hidden = true;
  els.roBearing.textContent = `${result.bearingDeg.toFixed(1)}° (${compass16(result.bearingDeg)})`;
  els.roTip.textContent = `${Math.round(result.tipDist)} m`;

  lastBearing = result.bearingDeg;
  matchBakery(result.bearingDeg);
}

// The bakery the shadow points at = least angular deviation from the shadow bearing.
function matchBakery(bearing) {
  if (!bakeries.length) return;
  let best = -1, bestAng = Infinity;
  bakeries.forEach((b, i) => {
    const ang = angularDiff(bearingTo(ORIGIN.lat, ORIGIN.lon, b.lat, b.lon), bearing);
    if (ang < bestAng) { bestAng = ang; best = i; }
  });
  viewer.setTarget(best);
  if (best < 0) { els.roOffset.textContent = '—'; els.roPlace.textContent = '—'; return; }
  const b = bakeries[best];
  const off = trackOffset(ORIGIN.lat, ORIGIN.lon, bearing, b.lat, b.lon);
  els.roOffset.textContent = `${bestAng.toFixed(1)}° off · ${off.alongKm.toFixed(1)} km away`;
  els.roPlace.textContent = `🥯 ${b.name} — ${b.address}`;
}

// ---- controls ----
els.date.addEventListener('change', recompute);
els.timeSlider.addEventListener('input', () => {
  els.timeVal.textContent = minutesToHHMM(Number(els.timeSlider.value));
  paintSlider(els.timeSlider);
  recompute();
});
els.nowBtn.addEventListener('click', () => { setNow(); recompute(); });
els.viewCity.addEventListener('click', () => viewer.zoomTo('city'));
els.viewStatue.addEventListener('click', () => viewer.zoomTo('statue'));

// ---- boot ----
setNow();
viewer.setHeading(HEADING);
loadBakeries();
viewer.loadModel('model/', '3DModel.mtl', '3DModel.obj')
  .then(() => { viewer.setHeading(HEADING); recompute(); })
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
    viewer.plotBakeries(bakeries);
    if (lastBearing !== null) matchBakery(lastBearing);
  } catch (e) {
    console.error('Bakery CSV load failed', e);
  }
}

function parseCSV(text) {
  const rows = [];
  const lines = text.trim().split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]);
    if (cols.length < 3) continue;
    const lat = parseFloat(cols[1]), lon = parseFloat(cols[2]);
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
    rows.push({ name: cols[0], lat, lon, address: (cols[3] || '').trim() });
  }
  return rows;
}
function splitCSVLine(line) {
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
function compass16(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}
