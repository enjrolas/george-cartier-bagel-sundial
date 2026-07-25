// Bagel Sundial AR. Two modes that share one computation:
//   • Compass HUD  — camera feed + device compass (iOS + Android, no app)
//   • WebXR        — a 3D sundial anchored on the ground (Android/ARCore)
//
// The monument's apex position (after the fixed 207° heading, true scale) is a
// constant, so the shadow bearing here matches the 2D map exactly — no model.

import { getSunPosition } from '../js/solar.js';
import { bearingTo, angularDiff, haversine } from '../js/geo.js';

const DEG = Math.PI / 180;
const ORIGIN = { lat: 45.514204, lon: -73.585227 };
const APEX = { E: -4.5824, U: 31.8430, Z: 4.1897 }; // world metres: X=East, Z=South, Y=Up
const HFOV = 60;   // assumed horizontal camera field of view, degrees
const CSV = '../montreal_bagel_bakeries.csv';

const $ = (id) => document.getElementById(id);
const els = {
  cam: $('cam'), hud: $('hud'), markers: $('markers'),
  shadowCallout: $('shadowCallout'), scName: $('scName'),
  bar: $('bar'), barInfo: $('barInfo'), enterAR: $('enterAR'),
  info: $('info'), clock: $('clock'), sun: $('sun'), infoTarget: $('infoTarget'),
  start: $('start'), startBtn: $('startBtn'), startFine: $('startFine'),
  toast: $('toast'),
  xrOverlay: $('xrOverlay'), xrExit: $('xrExit'), xrHint: $('xrHint'), xrInfo: $('xrInfo'),
};

let bakeries = [];        // {name, lat, lon, address, bearing, distKm}
let heading = 0;          // compass heading, degrees from true north
let headingOK = false;
let state = null;         // {azimuth, altitude, below, shadowBrg, target, ang}
let markerEls = [];       // per-bakery DOM markers
let shadowMarker = null;

// ---------- shared computation ----------
function shadowBearing(azDeg, altDeg) {
  const az = azDeg * DEG, k = 1 / Math.tan(altDeg * DEG);
  const sx = APEX.E - APEX.U * Math.sin(az) * k;   // world X (East)
  const sz = APEX.Z + APEX.U * Math.cos(az) * k;   // world Z (South)
  let b = Math.atan2(sx, -sz) / DEG;               // North = -Z
  return (b + 360) % 360;
}

function computeState() {
  const { azimuth, altitude } = getSunPosition(new Date(), ORIGIN.lat, ORIGIN.lon);
  const below = altitude <= 0.5;
  const shadowBrg = below ? null : shadowBearing(azimuth, altitude);
  let target = -1, ang = Infinity;
  if (shadowBrg != null) {
    bakeries.forEach((b, i) => { const a = angularDiff(b.bearing, shadowBrg); if (a < ang) { ang = a; target = i; } });
  }
  state = { azimuth, altitude, below, shadowBrg, target, ang };
  updateInfo();
  return state;
}

function updateInfo() {
  const now = new Date().toLocaleTimeString('en-CA', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit' });
  els.clock.textContent = now;
  els.sun.textContent = state.below ? 'sun below horizon' : `sun ${state.azimuth.toFixed(0)}° · ${state.altitude.toFixed(0)}°`;
  els.barInfo.textContent = headingOK ? `facing ${Math.round(heading)}°` : 'calibrating compass…';
  if (state.below || state.target < 0) {
    els.infoTarget.textContent = state.below ? '🌙 no shadow right now' : '—';
    els.scName.textContent = '—';
    els.shadowCallout.hidden = true;
  } else {
    const b = bakeries[state.target];
    els.infoTarget.textContent = `🥯 ${b.name} · ${b.distKm.toFixed(1)} km`;
    els.scName.textContent = b.name;
    els.shadowCallout.hidden = false;
  }
}

// ---------- compass HUD ----------
function buildMarkers() {
  els.markers.innerHTML = '';
  markerEls = bakeries.map((b) => {
    const m = document.createElement('div');
    m.className = 'marker';
    m.innerHTML = `<span class="dot"></span><span class="tag">${b.name}</span><span class="meta">${b.distKm.toFixed(1)} km</span>`;
    els.markers.appendChild(m);
    return m;
  });
  shadowMarker = document.createElement('div');
  shadowMarker.className = 'marker shadow';
  shadowMarker.innerHTML = `<span class="arrow">▲</span><span class="tag">shadow</span>`;
  els.markers.appendChild(shadowMarker);
}

const normDelta = (a) => ((a + 540) % 360) - 180;

function placeMarker(el, bearing, alwaysTag) {
  const d = normDelta(bearing - heading);
  if (Math.abs(d) > HFOV / 2 + 4) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.style.left = `${50 + (d / HFOV) * 100}%`;
  el.style.opacity = String(Math.max(0.25, 1 - Math.abs(d) / (HFOV / 2)));
  const tag = el.querySelector('.tag');
  if (tag && !alwaysTag) tag.style.display = Math.abs(d) < 11 ? '' : 'none';
}

function hudFrame() {
  if (state) {
    bakeries.forEach((b, i) => {
      const el = markerEls[i];
      const isTarget = i === state.target;
      el.classList.toggle('target', isTarget);
      placeMarker(el, b.bearing, isTarget);
    });
    if (!state.below && state.shadowBrg != null) {
      shadowMarker.style.display = '';
      placeMarker(shadowMarker, state.shadowBrg, true);
    } else {
      shadowMarker.style.display = 'none';
    }
  }
  els.barInfo.textContent = headingOK ? `facing ${Math.round(heading)}°` : 'calibrating compass — rotate the phone';
  requestAnimationFrame(hudFrame);
}

// ---------- sensors ----------
function onOrient(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading;
  else if (e.alpha != null && (e.absolute || e.type === 'deviceorientationabsolute')) h = 360 - e.alpha;
  if (h == null) return;
  h = (h + (screen.orientation ? screen.orientation.angle : 0) + 360) % 360;
  heading = h; headingOK = true;
}

async function requestOrientation() {
  const D = window.DeviceOrientationEvent;
  if (D && typeof D.requestPermission === 'function') {
    try { const r = await D.requestPermission(); if (r !== 'granted') toast('Motion access denied — the compass won’t track.'); }
    catch (_) {}
  }
  window.addEventListener('deviceorientationabsolute', onOrient, true);
  window.addEventListener('deviceorientation', onOrient, true);
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  els.cam.srcObject = stream;
  await els.cam.play();
}

// ---------- boot ----------
async function loadBakeries() {
  const res = await fetch(CSV);
  const text = await res.text();
  bakeries = parseCSV(text).map((b) => ({
    ...b,
    bearing: bearingTo(ORIGIN.lat, ORIGIN.lon, b.lat, b.lon),
    distKm: haversine(ORIGIN.lat, ORIGIN.lon, b.lat, b.lon),
  }));
}

els.startBtn.addEventListener('click', () => { startFlow(); });

async function startFlow() {
  els.startBtn.disabled = true;
  els.startBtn.textContent = 'starting…';

  // Kick off the gesture-gated permissions synchronously (no await between them)
  // so iOS keeps the user-activation valid for both camera and motion.
  const camPromise = startCamera();
  const orientPromise = requestOrientation();

  // Reveal the HUD right away — never block the UI on a pending permission prompt.
  els.start.hidden = true;
  els.hud.hidden = false;
  els.bar.hidden = false;
  els.info.hidden = false;

  camPromise.catch(() => toast('Camera unavailable — showing compass only.'));
  orientPromise.catch(() => {});

  try { await loadBakeries(); } catch (_) { toast('Could not load bakery list.'); }
  buildMarkers();
  computeState();
  setInterval(computeState, 5000);
  requestAnimationFrame(hudFrame);
  checkXR();
}

els.xrExit.addEventListener('click', () => { if (xrSession) xrSession.end(); });

let toastTimer = null;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3800);
}

function parseCSV(text) {
  const out = [];
  const lines = text.trim().split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const c = splitCSVLine(lines[i]);
    if (c.length < 3) continue;
    const lat = parseFloat(c[1]), lon = parseFloat(c[2]);
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
    out.push({ name: c[0], lat, lon, address: (c[3] || '').trim() });
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
  out.push(cur);
  return out;
}

// ---------- WebXR (progressive enhancement, Android/ARCore) ----------
let xrSession = null;

async function checkXR() {
  try {
    if (navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')) {
      els.enterAR.hidden = false;
      els.enterAR.addEventListener('click', enterXR, { once: true });
    }
  } catch (_) {}
}

async function enterXR() {
  let THREE, sundial, reticle, hitSource = null, placed = false;
  try {
    THREE = await import('three');
  } catch (_) { toast('Could not load 3D engine.'); return; }

  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { xrCompatible: true, alpha: true });
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, alpha: true, antialias: true });
  renderer.autoClear = false;
  renderer.xr.enabled = true;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.4));
  const dir = new THREE.DirectionalLight(0xffffff, 1.0); dir.position.set(0.5, 1, 0.25); scene.add(dir);
  const camera = new THREE.PerspectiveCamera();

  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.10, 0.12, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x4fd0e3 })
  );
  reticle.visible = false; reticle.matrixAutoUpdate = false;
  scene.add(reticle);

  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['local-floor', 'dom-overlay'],
      domOverlay: { root: els.xrOverlay },
    });
  } catch (_) { toast('Could not start AR session.'); return; }
  xrSession = session;
  els.xrOverlay.hidden = false;
  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);

  const viewerSpace = await session.requestReferenceSpace('viewer');
  const localSpace = await session.requestReferenceSpace('local');
  hitSource = await session.requestHitTestSource({ space: viewerSpace });

  session.addEventListener('end', () => {
    xrSession = null; els.xrOverlay.hidden = true;
    if (hitSource) hitSource.cancel();
    renderer.setAnimationLoop(null);
  });

  session.addEventListener('select', () => {
    if (!reticle.visible || placed) return;
    sundial = buildSundial(THREE);
    // orient to true north using the compass heading of the camera's forward direction
    const yaw = cameraYaw(camera);
    sundial.rotation.y = yaw + heading * DEG; // rotate group so its -Z points true north
    sundial.position.setFromMatrixPosition(reticle.matrix);
    scene.add(sundial);
    placed = true;
    els.xrHint.hidden = true;
    updateSundial(THREE, sundial);
  });

  let lastCompute = 0;
  renderer.setAnimationLoop((t, frame) => {
    if (!frame) return;
    if (!placed) {
      const results = frame.getHitTestResults(hitSource);
      if (results.length) {
        const pose = results[0].getPose(localSpace);
        reticle.visible = true;
        reticle.matrix.fromArray(pose.transform.matrix);
      } else reticle.visible = false;
    } else if (t - lastCompute > 2000) {
      lastCompute = t; computeState(); updateSundial(THREE, sundial);
    }
    renderer.render(scene, camera);
  });
}

// world yaw of the camera's horizontal forward direction
function cameraYaw(camera) {
  const e = camera.matrixWorld.elements; // forward = -Z column
  return Math.atan2(-e[8], -e[10]);
}

function buildSundial(THREE) {
  const g = new THREE.Group();
  const R = 1.1; // metres
  g.add(new THREE.Mesh(
    new THREE.RingGeometry(R - 0.03, R, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
  ));
  // gnomon
  g.add(new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.03, 0.5, 12).translate(0, 0.25, 0),
    new THREE.MeshStandardMaterial({ color: 0xffb454 })
  ));
  // bagel spokes: local dir East=+x, North=-z
  g.userData.spokes = [];
  bakeries.forEach((b) => {
    const a = b.bearing * DEG;
    const x = Math.sin(a) * R, z = -Math.cos(a) * R;
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x9fb0c2 })
    );
    dot.position.set(x, 0.02, z);
    g.add(dot);
    g.userData.spokes.push(dot);
  });
  // shadow ray (updated live)
  const ray = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.01, R).translate(0, 0.01, -R / 2),
    new THREE.MeshBasicMaterial({ color: 0x4fd0e3 })
  );
  g.add(ray); g.userData.ray = ray;
  return g;
}

function updateSundial(THREE, g) {
  if (!g || !state) return;
  const ray = g.userData.ray;
  if (state.below || state.shadowBrg == null) { ray.visible = false; }
  else { ray.visible = true; ray.rotation.y = state.shadowBrg * DEG; }
  g.userData.spokes.forEach((dot, i) => {
    const on = i === state.target;
    dot.material.color.set(on ? 0xffd166 : 0x9fb0c2);
    dot.scale.setScalar(on ? 1.8 : 1);
  });
  const b = state.target >= 0 ? bakeries[state.target] : null;
  els.xrInfo.textContent = state.below ? '🌙 sun is down — no shadow'
    : b ? `shadow → 🥯 ${b.name}` : '';
}
