import { createViewer } from './viewer.js';
import { getSunPosition, zonedToUTC, tzAbbrev } from './solar.js';
import { bearingTo, angularDiff } from './geo.js';

// ---- fixed site parameters ----
const ORIGIN = { lat: 45.514204, lon: -73.585227 };
const TZ = 'America/Toronto'; // Montréal
const BAKERY_CSV = 'montreal_bagel_bakeries.csv';
const HEADING = 207;          // monument's real-world facing, degrees from true north

let bakeries = [];
let lastBearing = null;

const $ = (id) => document.getElementById(id);
const els = {
  dateSlider: $('dateSlider'), dateVal: $('dateVal'),
  timeSlider: $('timeSlider'), timeVal: $('timeVal'),
  nowBtn: $('nowBtn'), tzLabel: $('tzLabel'),
  pointsTo: $('pointsTo'),
  note: $('viewerNote'), loader: $('loader'),
  viewCity: $('viewCity'), viewStatue: $('viewStatue'),
};

const pad = (n) => String(n).padStart(2, '0');
const minutesToHHMM = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

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

// date `offset` days from today (Montréal) → {iso, label}
function dateFromOffset(off) {
  const [y, m, d] = nowInTZ().date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + off * 86400000);
  return {
    iso: `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`,
    label: `${DOW[dt.getUTCDay()]} ${MON[dt.getUTCMonth()]} ${dt.getUTCDate()}`,
  };
}
function updateDateLabel() { els.dateVal.textContent = dateFromOffset(Number(els.dateSlider.value)).label; }

function setNow() {
  const n = nowInTZ();
  els.dateSlider.value = 0;
  els.timeSlider.value = n.minutes;
  updateDateLabel();
  els.timeVal.textContent = minutesToHHMM(n.minutes);
  paintSlider(els.dateSlider); paintSlider(els.timeSlider);
}

function setPointsTo(text, lit) {
  els.pointsTo.textContent = text;
  els.pointsTo.classList.toggle('lit', lit);
}

// surface any runtime error on-page instead of a blank panel
function showError(msg) { if (els.note) { els.note.hidden = false; els.note.textContent = msg; } }
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
  const dateStr = dateFromOffset(Number(els.dateSlider.value)).iso;
  const timeStr = minutesToHHMM(Number(els.timeSlider.value));
  const utc = zonedToUTC(dateStr, timeStr, TZ);
  els.tzLabel.textContent = `(${tzAbbrev(utc, TZ)})`;

  const { azimuth, altitude } = getSunPosition(utc, ORIGIN.lat, ORIGIN.lon);
  const result = viewer.updateSun(azimuth, altitude);
  if (!result) {
    els.note.hidden = false;
    els.note.textContent = altitude <= 0
      ? 'The sun is below the horizon — no shadow at this time.'
      : 'Sun on the horizon — shadow runs to infinity.';
    setPointsTo(altitude <= 0 ? 'no shadow right now' : '—', false);
    viewer.setTarget(-1);
    return;
  }
  els.note.hidden = true;
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
  if (best < 0) { setPointsTo('—', false); return; }
  setPointsTo(bakeries[best].name, true);
}

// ---- controls ----
els.dateSlider.addEventListener('input', () => { updateDateLabel(); paintSlider(els.dateSlider); recompute(); });
els.timeSlider.addEventListener('input', () => {
  els.timeVal.textContent = minutesToHHMM(Number(els.timeSlider.value));
  paintSlider(els.timeSlider);
  recompute();
});
els.nowBtn.addEventListener('click', () => { setNow(); recompute(); });
function setActiveView(w) {
  els.viewCity.classList.toggle('active', w === 'city');
  els.viewStatue.classList.toggle('active', w === 'statue');
}
els.viewCity.addEventListener('click', () => { viewer.zoomTo('city'); setActiveView('city'); });
els.viewStatue.addEventListener('click', () => { viewer.zoomTo('statue'); setActiveView('statue'); });

// Only show the "AR" link where WebXR can actually run (Android/ARCore). On iOS
// and desktop it's hidden — use George Anywhere / Watch instead.
(async () => {
  const arLink = document.querySelector('a.ar-link[href="/ar/"]');
  if (!arLink) return;
  const ok = navigator.xr && await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  if (!ok) arLink.style.display = 'none';
})();

// info modal
const infoBtn = $('infoBtn'), infoModal = $('infoModal'), infoClose = $('infoClose');
if (infoBtn && infoModal) {
  const closeInfo = () => { infoModal.hidden = true; };
  infoBtn.addEventListener('click', () => { infoModal.hidden = false; });
  infoClose.addEventListener('click', closeInfo);
  infoModal.addEventListener('click', (e) => { if (e.target === infoModal) closeInfo(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInfo(); });
}

// ---- boot ----
setNow();
setActiveView('statue');   // default view is the statue
viewer.setHeading(HEADING);
loadBakeries();
viewer.loadModel('model/3DModel-main.obj')
  .then(() => { viewer.setHeading(HEADING); recompute(); els.loader.hidden = true; })
  .catch((err) => {
    console.error('Model load failed', err);
    els.loader.hidden = true;
    els.note.hidden = false;
    els.note.textContent = `Could not load the 3D model: ${err && err.message ? err.message : err}`;
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
