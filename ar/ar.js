// Bagel Sundial AR (at the monument). WebXR/ARCore: plant a milled-steel dial on
// the real ground around the statue, aligned to true north; a matrix-green shadow
// triangle sweeps it and points at a bagel shop. Gated to being physically at the
// Monument George-Étienne Cartier. (Android Chrome; iOS Safari has no WebXR AR.)

import { getSunPosition } from '../js/solar.js';
import { bearingTo, angularDiff, haversine } from '../js/geo.js';

const DEG = Math.PI / 180;
const ORIGIN = { lat: 45.514204, lon: -73.585227 };
const APEX = { E: -4.5824, U: 31.8430, Z: 4.1897 }; // world metres after 207° heading
const AT_STATUE_KM = 0.3;   // must be within 300 m of the monument
const CSV = '../montreal_bagel_bakeries.csv';
const DIAL_R = 1.6;         // dial radius in metres (rings the ground around you)

const $ = (id) => document.getElementById(id);
const els = {
  start: $('start'), startBtn: $('startBtn'), msg: $('msg'), toast: $('toast'),
  xrOverlay: $('xrOverlay'), xrExit: $('xrExit'), xrHint: $('xrHint'), xrInfo: $('xrInfo'),
};

let bakeries = [];   // top-10 nearest {name, bearing}
let heading = 0, headingOK = false;
let xrSession = null;

// ---------- shared shadow math ----------
function shadowBearing(azDeg, altDeg) {
  const az = azDeg * DEG, k = 1 / Math.tan(altDeg * DEG);
  const sx = APEX.E - APEX.U * Math.sin(az) * k;
  const sz = APEX.Z + APEX.U * Math.cos(az) * k;
  return (Math.atan2(sx, -sz) / DEG + 360) % 360;
}
function currentState() {
  const { azimuth, altitude } = getSunPosition(new Date(), ORIGIN.lat, ORIGIN.lon);
  if (altitude <= 0.5) return { below: true };
  const brg = shadowBearing(azimuth, altitude);
  let t = -1, best = Infinity;
  bakeries.forEach((b, i) => { const a = angularDiff(b.bearing, brg); if (a < best) { best = a; t = i; } });
  return { below: false, brg, target: t };
}

// ---------- sensors ----------
function onOrient(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading;
  else if (e.alpha != null && (e.absolute || e.type === 'deviceorientationabsolute')) h = 360 - e.alpha;
  if (h == null) return;
  heading = (h + (screen.orientation ? screen.orientation.angle : 0) + 360) % 360;
  headingOK = true;
}
function listenOrientation() {
  const D = window.DeviceOrientationEvent;
  if (D && typeof D.requestPermission === 'function') { D.requestPermission().catch(() => {}); }
  window.addEventListener('deviceorientationabsolute', onOrient, true);
  window.addEventListener('deviceorientation', onOrient, true);
}

function locateAtStatue() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(haversine(ORIGIN.lat, ORIGIN.lon, p.coords.latitude, p.coords.longitude)),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  });
}

async function loadBakeries() {
  try {
    const rows = parseCSV(await (await fetch(CSV)).text())
      .map((b) => ({ name: b.name, bearing: bearingTo(ORIGIN.lat, ORIGIN.lon, b.lat, b.lon),
        d: haversine(ORIGIN.lat, ORIGIN.lon, b.lat, b.lon) }))
      .sort((a, b) => a.d - b.d);
    bakeries = rows.slice(0, 10);
  } catch (_) {}
}

// ---------- boot / gating ----------
els.startBtn.addEventListener('click', async () => {
  els.startBtn.disabled = true; els.startBtn.textContent = 'checking…';
  listenOrientation();
  await loadBakeries();

  const supported = navigator.xr && await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  if (!supported) return block('AR needs Android Chrome with ARCore. On iPhone, try <a href="/anywhere/">George&nbsp;Anywhere</a> or the <a href="/">map</a>.');

  const dist = await locateAtStatue();
  if (dist != null && dist > AT_STATUE_KM) {
    return block(`You're about ${dist.toFixed(1)} km from the monument. This view only works at the <b>Monument George-Étienne Cartier</b>. Try <a href="/anywhere/">George&nbsp;Anywhere</a>.`);
  }
  enterXR();
});
els.xrExit.addEventListener('click', () => { if (xrSession) xrSession.end(); });

function block(html) {
  els.start.hidden = true;
  els.msg.hidden = false;
  els.msg.innerHTML = `<div>${html}</div>`;
}
function toast(m) { els.toast.textContent = m; els.toast.hidden = false; setTimeout(() => { els.toast.hidden = true; }, 4000); }

// ---------- WebXR ----------
async function enterXR() {
  let THREE;
  try { THREE = await import('three'); } catch (_) { return block('Could not load the 3D engine.'); }

  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { xrCompatible: true, alpha: true });
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, alpha: true, antialias: true });
  renderer.autoClear = false;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.5));
  const camera = new THREE.PerspectiveCamera();

  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.12, 0.15, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x9dffc4 })
  );
  reticle.visible = false; reticle.matrixAutoUpdate = false;
  scene.add(reticle);

  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'local-floor'],
      domOverlay: { root: els.xrOverlay },
    });
  } catch (_) { return block('Could not start the AR session.'); }
  xrSession = session;
  els.start.hidden = true; els.xrOverlay.hidden = false;
  await renderer.xr.setSession(session);

  const viewerSpace = await session.requestReferenceSpace('viewer');
  const localSpace = await session.requestReferenceSpace('local');
  const hitSource = await session.requestHitTestSource({ space: viewerSpace });

  const dialMat = buildDial(THREE, bakeries.map((b) => b.name));   // canvas-textured dial
  const matrix = buildMatrixTriangle(THREE);                        // shadow pointer
  let placed = false, group = null;

  session.addEventListener('end', () => {
    xrSession = null; els.xrOverlay.hidden = true; hitSource.cancel(); renderer.setAnimationLoop(null);
  });
  session.addEventListener('select', () => {
    if (!reticle.visible || placed) return;
    group = new THREE.Group();
    group.add(dialMat.mesh);
    group.add(matrix.mesh);
    group.position.setFromMatrixPosition(reticle.matrix);
    group.rotation.y = cameraYaw(camera) + heading * DEG; // align dial's -Z to true north
    scene.add(group);
    placed = true;
    els.xrHint.hidden = true;
  });

  let last = 0;
  renderer.setAnimationLoop((t, frame) => {
    if (!frame) return;
    if (!placed) {
      const hits = frame.getHitTestResults(hitSource);
      if (hits.length) { reticle.visible = true; reticle.matrix.fromArray(hits[0].getPose(localSpace).transform.matrix); }
      else reticle.visible = false;
    } else {
      matrix.draw();
      if (t - last > 1500) { last = t; applyState(); }
    }
    renderer.render(scene, camera);
  });

  function applyState() {
    const s = currentState();
    if (s.below) { matrix.mesh.visible = false; els.xrInfo.textContent = '🌙 no shadow right now'; return; }
    matrix.mesh.visible = true;
    matrix.mesh.rotation.y = -s.brg * DEG;   // point along the shadow bearing (group is north-aligned)
    const b = s.target >= 0 ? bakeries[s.target] : null;
    els.xrInfo.textContent = b ? `shadow → 🥯 ${b.name}` : '';
  }
  applyState();
}

function cameraYaw(camera) {
  const e = camera.matrixWorld.elements;
  return Math.atan2(-e[8], -e[10]);
}

// ---------- 3D dial (milled steel + carved names), same style as the / map ----------
function buildDial(THREE, names) {
  const S = 1024, c = S / 2, rOut = S * 0.5, rIn = rOut * 0.62;
  const cnv = document.createElement('canvas'); cnv.width = cnv.height = S;
  const x = cnv.getContext('2d');
  x.save(); x.beginPath(); x.arc(c, c, rOut, 0, 7); x.arc(c, c, rIn, 0, 7, true); x.clip();
  const grad = x.createRadialGradient(c, c, rIn, c, c, rOut);
  grad.addColorStop(0, '#8b9199'); grad.addColorStop(0.5, '#c6ccd2'); grad.addColorStop(0.72, '#7e848c'); grad.addColorStop(1, '#b0b6bd');
  x.fillStyle = grad; x.fillRect(0, 0, S, S);
  for (let r = rIn; r < rOut; r += 2) { x.beginPath(); x.arc(c, c, r, 0, 7); x.strokeStyle = (r & 2) ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.09)'; x.stroke(); }
  x.restore();
  x.strokeStyle = '#565c64'; x.lineWidth = 4; x.beginPath(); x.arc(c, c, rOut - 3, 0, 7); x.stroke();
  const rText = (rIn + rOut) / 2, n = names.length, fs = 30;
  x.font = `700 ${fs}px "Cinzel", "Trajan Pro", Georgia, serif`;
  try { x.letterSpacing = '2px'; } catch (_) {}
  x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const label = names[i].toUpperCase().replace(/U/g, 'V');
    const lines = wrap(x, label, 2 * Math.PI * rIn / n * 0.9).slice(0, 3);
    x.save(); x.translate(c + Math.cos(a) * rText, c + Math.sin(a) * rText); x.rotate(a + Math.PI / 2);
    const tot = (lines.length - 1) * fs * 1.02;
    lines.forEach((ln, li) => {
      const yy = li * fs * 1.02 - tot / 2;
      x.fillStyle = 'rgba(255,255,255,0.5)'; x.fillText(ln, 0.8, yy + 1);
      x.fillStyle = '#111316'; x.fillText(ln, 0, yy);
    });
    x.restore();
  }
  const tex = new THREE.CanvasTexture(cnv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(DIAL_R, 96).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true })
  );
  mesh.position.y = 0.01;
  return { mesh };
}
function wrap(ctx, text, maxW) {
  const words = text.split(/\s+/), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (cur && ctx.measureText(t).width > maxW) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}

// ---------- 3D matrix-bagel shadow triangle ----------
const MGLYPHS = ['◯', '⊙', '0', 'O', 'o', '()', '◎', 'Ø', 'Q', '🥯'];
function buildMatrixTriangle(THREE) {
  const L = DIAL_R * 1.05, SPREAD = Math.tan(11 * DEG);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0.02, 0, 0, 0.02 + L * Math.tan(1 * DEG), -L, 0, 0.02 + L * SPREAD, -L,
  ], 3)); // apex at centre, wedge along -Z (north-local)
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0.5, 1, 0, 1, 1], 2));
  geo.setIndex([0, 1, 2]);
  const cnv = document.createElement('canvas'); cnv.width = 256; cnv.height = 128;
  const ctx = cnv.getContext('2d');
  const tex = new THREE.CanvasTexture(cnv);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  const CELL = 14, COLS = Math.ceil(cnv.width / CELL);
  const drops = Array.from({ length: COLS }, () => (Math.random() * 8) | 0);
  function draw() {
    ctx.fillStyle = 'rgba(0,12,5,0.22)'; ctx.fillRect(0, 0, cnv.width, cnv.height);
    ctx.font = `${CELL}px monospace`; ctx.textBaseline = 'top';
    for (let i = 0; i < COLS; i++) {
      const px = i * CELL, py = drops[i] * CELL;
      ctx.fillStyle = '#2bff86'; ctx.fillText(MGLYPHS[(Math.random() * MGLYPHS.length) | 0], px, py - CELL);
      ctx.fillStyle = '#e9fff0'; ctx.fillText(MGLYPHS[(Math.random() * MGLYPHS.length) | 0], px, py);
      drops[i]++; if (py > cnv.height && Math.random() > 0.94) drops[i] = 0;
    }
    tex.needsUpdate = true;
  }
  return { mesh, draw };
}

// ---------- CSV ----------
function parseCSV(text) {
  const out = [], lines = text.trim().split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const c = splitCSVLine(lines[i]);
    if (c.length < 3) continue;
    const lat = parseFloat(c[1]), lon = parseFloat(c[2]);
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
    out.push({ name: c[0], lat, lon });
  }
  return out;
}
function splitCSVLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur); return out;
}
