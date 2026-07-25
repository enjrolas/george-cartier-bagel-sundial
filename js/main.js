import { createViewer } from './viewer.js';
import { createMap } from './map.js';
import { getSunPosition, zonedToUTC, tzAbbrev } from './solar.js';

// ---- fixed site parameters ----
const ORIGIN = { lat: 45.514204, lon: -73.585227 };
const TZ = 'America/Toronto'; // Montréal

const $ = (id) => document.getElementById(id);
const els = {
  date: $('date'), time: $('time'), heading: $('heading'), distance: $('distance'),
  nowBtn: $('nowBtn'), tzLabel: $('tzLabel'), headingVal: $('headingVal'), distVal: $('distVal'),
  roSun: $('roSun'), roBearing: $('roBearing'), roTip: $('roTip'), roMarker: $('roMarker'),
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

  map.setBearing(result.bearingDeg);
}

// ---- readouts driven by marker movement ----
map.onMarker(({ lat, lon, km }) => {
  els.roMarker.textContent = `${fmtLL(lat, 'NS')}, ${fmtLL(lon, 'EW')}`;
  els.distance.value = Math.round(km);
  els.distVal.textContent = `${Math.round(km).toLocaleString()} km`;
  paintSlider(els.distance);
});
map.onPlace((r) => {
  if (r.loading) { els.roPlace.textContent = 'locating…'; return; }
  els.roPlace.textContent = r.name;
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

viewer.loadModel('model/', '3DModel.mtl', '3DModel.obj')
  .then(() => { recompute(); setTimeout(() => map.invalidate(), 100); })
  .catch((err) => {
    console.error('Model load failed', err);
    els.note.hidden = false;
    els.note.textContent = 'Could not load the 3D model.';
  });

// ---- helpers ----
function compass16(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}
function fmtLL(v, axis) {
  const hemi = v >= 0 ? axis[0] : axis[1];
  return `${Math.abs(v).toFixed(3)}°${hemi}`;
}
