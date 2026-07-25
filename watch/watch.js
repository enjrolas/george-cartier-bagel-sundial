// Bagel Sundial Watch. MediaPipe Hands pins a tiny George-Étienne Cartier
// monument on your wrist; its shadow bearing (computed for Montréal right now,
// same constant as the map) is drawn as a beam that points you toward a bagel
// shop within 10 km of your real location (found live via OpenStreetMap Overpass).

import { getSunPosition } from '../js/solar.js';
import { bearingTo, angularDiff, haversine } from '../js/geo.js';
import { createMatrixTriangle } from '../js/matrixtri.js';

const DEG = Math.PI / 180;
const MTL = { lat: 45.514204, lon: -73.585227 };     // the real monument
const APEX = { E: -4.5824, U: 31.8430, Z: 4.1897 };  // world metres after 207° heading
const RADIUS_KM = 10;

const $ = (id) => document.getElementById(id);
const els = {
  cam: $('cam'), stage: $('stage'), findWrist: $('findWrist'),
  bar: $('bar'), barInfo: $('barInfo'),
  info: $('info'), infoDir: $('infoDir'), infoTarget: $('infoTarget'), infoSub: $('infoSub'),
  start: $('start'), startBtn: $('startBtn'), toast: $('toast'),
};

let heading = 0, headingOK = false, sHeading = null;
let posTarget = null, sm = null;  // wrist anchor + its smoothed value
let userPos = null;              // {lat, lon}
let bagels = [];                 // {name, lat, lon, bearing, distKm}
let shadowBrg = null;            // Montréal shadow bearing now
let target = -1;
let beamEl = null;

// ---------- shared shadow math ----------
function shadowBearing(azDeg, altDeg) {
  const az = azDeg * DEG, k = 1 / Math.tan(altDeg * DEG);
  const sx = APEX.E - APEX.U * Math.sin(az) * k;
  const sz = APEX.Z + APEX.U * Math.cos(az) * k;
  return (Math.atan2(sx, -sz) / DEG + 360) % 360;
}

function recompute() {
  const { azimuth, altitude } = getSunPosition(new Date(), MTL.lat, MTL.lon);
  shadowBrg = altitude <= 0.5 ? null : shadowBearing(azimuth, altitude);
  target = -1;
  if (shadowBrg != null && bagels.length) {
    let best = Infinity;
    bagels.forEach((b, i) => { const a = angularDiff(b.bearing, shadowBrg); if (a < best) { best = a; target = i; } });
  }
  updateInfo();
}

function updateInfo() {
  if (shadowBrg == null) {
    els.infoDir.textContent = '🌙 shadowless';
    els.infoTarget.textContent = 'the sun is down in Montréal';
    els.infoSub.textContent = '';
    return;
  }
  if (!userPos) { els.infoSub.textContent = 'waiting for your location…'; return; }
  if (!bagels.length) {
    els.infoDir.textContent = 'no bagels within 10 km';
    els.infoTarget.textContent = 'the statue points into the void';
    els.infoSub.textContent = `shadow bearing ${shadowBrg.toFixed(0)}°`;
    return;
  }
  const b = bagels[target];
  const rel = ((b.bearing - heading + 540) % 360) - 180; // −left / +right
  const turn = Math.abs(rel) < 12 ? 'straight ahead' : rel > 0 ? `turn ${Math.round(rel)}° right` : `turn ${Math.round(-rel)}° left`;
  els.infoDir.textContent = `follow the shadow · ${turn}`;
  els.infoTarget.textContent = `🥯 ${b.name}`;
  els.infoSub.textContent = `${b.distKm.toFixed(1)} km · bearing ${Math.round(b.bearing)}°`;
}

// ---------- sensors ----------
function onOrient(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading;
  else if (e.alpha != null && (e.absolute || e.type === 'deviceorientationabsolute')) h = 360 - e.alpha;
  if (h == null) return;
  h = (h + (screen.orientation ? screen.orientation.angle : 0) + 360) % 360;
  if (sHeading == null) sHeading = h;
  else { const d = ((h - sHeading + 540) % 360) - 180; sHeading = (sHeading + d * 0.18 + 360) % 360; }
  heading = sHeading; headingOK = true;
}
async function requestOrientation() {
  const D = window.DeviceOrientationEvent;
  if (D && typeof D.requestPermission === 'function') { try { await D.requestPermission(); } catch (_) {} }
  window.addEventListener('deviceorientationabsolute', onOrient, true);
  window.addEventListener('deviceorientation', onOrient, true);
}

function locate() {
  if (!navigator.geolocation) { toast('No geolocation on this device.'); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => { userPos = { lat: pos.coords.latitude, lon: pos.coords.longitude }; loadBagels(); },
    () => toast('Location denied — can’t find nearby bagels.'),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
  );
}

// ---------- nearby bagels via Nominatim (OSM) search ----------
async function loadBagels() {
  els.infoSub.textContent = 'searching bagels within 10 km…';
  const { lat, lon } = userPos;
  const dLat = RADIUS_KM / 111.0;
  const dLon = RADIUS_KM / (111.32 * Math.cos(lat * DEG));
  const viewbox = [lon - dLon, lat + dLat, lon + dLon, lat - dLat].join(','); // W,N,E,S
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=bagel&limit=50&bounded=1&namedetails=1&viewbox=${viewbox}`;
  let found = [];
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const data = await res.json();
      found = data.map((d) => ({
        name: (d.namedetails && d.namedetails.name) || (d.display_name || 'Bagel shop').split(',')[0],
        lat: parseFloat(d.lat), lon: parseFloat(d.lon),
      })).filter((d) => !Number.isNaN(d.lat) && !Number.isNaN(d.lon));
    }
  } catch (_) {}
  bagels = found
    .map((b) => ({ ...b, bearing: bearingTo(lat, lon, b.lat, b.lon), distKm: haversine(lat, lon, b.lat, b.lon) }))
    .filter((b) => b.distKm <= RADIUS_KM)
    .sort((a, b) => a.distKm - b.distKm);
  recompute();
  if (!bagels.length) toast('No bagel shops mapped within 10 km of you.');
}

// ---------- wrist tracking ----------
function onHands(results) {
  const lms = results.multiHandLandmarks;
  if (!lms || !lms.length) { els.stage.hidden = true; els.findWrist.hidden = false; posTarget = null; return; }
  els.stage.hidden = false; els.findWrist.hidden = true;

  const lm = lms[0];
  const wrist = mapLandmark(lm[0]);
  const mcp = mapLandmark(lm[9]);
  const handPx = Math.hypot(wrist.x - mcp.x, wrist.y - mcp.y);
  // anchor slightly down the forearm from the wrist joint, so it rides on top
  // of the wrist like a watch rather than at the side
  const dx = wrist.x - mcp.x, dy = wrist.y - mcp.y, len = Math.hypot(dx, dy) || 1;
  posTarget = {
    x: wrist.x + (dx / len) * handPx * 0.25,
    y: wrist.y + (dy / len) * handPx * 0.25,
    s: Math.max(0.5, Math.min(2.4, handPx / 70)),
  };
}

// smooth the wrist anchor + heading every frame (MediaPipe/compass are jittery)
function uiLoop() {
  if (posTarget) {
    if (!sm) sm = { ...posTarget };
    else { const a = 0.22; sm.x += (posTarget.x - sm.x) * a; sm.y += (posTarget.y - sm.y) * a; sm.s += (posTarget.s - sm.s) * a; }
    els.stage.style.transform = `translate(${sm.x}px, ${sm.y}px) translate(-50%, -82%) scale(${sm.s})`;
  }
  if (beamEl) beamEl.style.transform = `translateX(-50%) rotate(${beamAngle()}deg)`;
  requestAnimationFrame(uiLoop);
}

// map a normalized MediaPipe landmark to CSS pixels through object-fit: cover
function mapLandmark(l) {
  const vw = els.cam.videoWidth || 640, vh = els.cam.videoHeight || 480;
  const cw = window.innerWidth, ch = window.innerHeight;
  const s = Math.max(cw / vw, ch / vh);
  const dw = vw * s, dh = vh * s;
  const ox = (cw - dw) / 2, oy = (ch - dh) / 2;
  return { x: ox + l.x * dw, y: oy + l.y * dh };
}

// screen angle of the shadow beam (0° = up). Points at the matched bagel's real bearing.
function beamAngle() {
  const b = (target >= 0 && bagels[target]) ? bagels[target].bearing : (shadowBrg != null ? shadowBrg : 0);
  return ((b - heading + 540) % 360) - 180;
}

// ---------- tiny statue (three.js) ----------
async function buildStatue() {
  let THREE, OBJLoader;
  try {
    THREE = await import('three');
    ({ OBJLoader } = await import('three/addons/loaders/OBJLoader.js'));
  } catch (_) { return; }
  const W = 200, H = 240;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, W / H, 0.1, 100);
  camera.position.set(0, 1.1, 3.2);
  camera.lookAt(0, 0.9, 0);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(W, H);
  els.stage.appendChild(renderer.domElement);

  // glowing matrix-bagel triangle pointer (same style as the / map)
  beamEl = createMatrixTriangle(110, 200);
  beamEl.style.position = 'absolute';
  beamEl.style.left = '50%';
  beamEl.style.bottom = '96px';    // apex rises from the statue's base (tune to taste)
  els.stage.appendChild(beamEl);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.3));
  const dir = new THREE.DirectionalLight(0xfff4de, 1.4);
  dir.position.set(1.5, 2.5, 1.2);
  scene.add(dir);

  const g = new THREE.Group();
  scene.add(g);
  new OBJLoader().load('../model/3DModel-lowpoly.obj',
    (obj) => { fitStatue(THREE, obj, 1.95); g.add(obj); },
    undefined,
    () => { g.add(buildObelisk(THREE)); });   // fallback if the model can't load

  function frame() {
    renderer.render(scene, camera); // statue stays upright and still
    requestAnimationFrame(frame);
  }
  frame();
}

// ---------- boot ----------
els.startBtn.addEventListener('click', () => { startFlow(); });

async function startFlow() {
  els.startBtn.disabled = true;
  els.startBtn.textContent = 'starting…';

  requestOrientation();
  locate();
  startHands();      // requests camera via MediaPipe Camera util

  els.start.hidden = true;
  els.bar.hidden = false;
  els.info.hidden = false;
  els.findWrist.hidden = false;

  // no motion data (desktop, etc.) → still runs, but warn it won't track
  setTimeout(() => { if (!headingOK) { const d = document.getElementById('disclaimer'); if (d) d.hidden = false; } }, 1800);

  await buildStatue();
  uiLoop();
  recompute();
  setInterval(recompute, 5000);
  tickBar();
}

function startHands() {
  if (!window.Hands || !window.Camera) { toast('Hand-tracking failed to load.'); return; }
  const hands = new window.Hands({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${f}` });
  hands.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.6, minTrackingConfidence: 0.5 });
  hands.onResults(onHands);
  const cam = new window.Camera(els.cam, {
    onFrame: async () => { await hands.send({ image: els.cam }); },
    facingMode: 'environment', width: 640, height: 480,
  });
  cam.start().catch(() => toast('Camera unavailable — allow camera access.'));
}

function tickBar() {
  els.barInfo.textContent = headingOK
    ? `Montréal shadow ${shadowBrg == null ? '—' : Math.round(shadowBrg) + '°'} · facing ${Math.round(heading)}°`
    : 'calibrating compass…';
  requestAnimationFrame(tickBar);
}

// scale/centre a loaded low-poly monument to `targetH` tall with its base at y=0,
// and give it a flat-shaded, vertex-coloured material (colours are baked into the OBJ)
function fitStatue(THREE, obj, targetH) {
  obj.traverse((c) => {
    if (!c.isMesh) return;
    const hasColor = !!c.geometry.getAttribute('color');
    c.material = new THREE.MeshStandardMaterial({
      vertexColors: hasColor, color: hasColor ? 0xffffff : 0xb9bcc2,
      roughness: 0.92, metalness: 0.04, flatShading: true,
    });
  });
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3(); box.getSize(size);
  const ctr = new THREE.Vector3(); box.getCenter(ctr);
  const s = targetH / size.y;
  obj.scale.setScalar(s);
  obj.position.set(-ctr.x * s, -box.min.y * s, -ctr.z * s);
}

function buildObelisk(THREE) {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xb9bcc2, roughness: 0.9 });
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1.7, 10), stone); col.position.y = 0.95; g.add(col);
  const fig = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xcaa24a, metalness: 0.4, roughness: 0.5 }));
  fig.position.y = 1.9; g.add(fig);
  return g;
}

let toastTimer = null;
function toast(msg) {
  els.toast.textContent = msg; els.toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { els.toast.hidden = true; }, 4000);
}
