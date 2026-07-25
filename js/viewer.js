// Unified 3D scene: the map is a texture on a ground plane (Web-Mercator OSM
// tiles), the monument stands at true scale at the centre, its real shadow falls
// on the map, and a beam extends the shadow's bearing to the matched bakery.
//
// World units are metres. Axes: +X = East, -Z = North, +Y = Up. North is fixed;
// the model rotates about its base-centre vertical axis (heading control).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

const DEG = Math.PI / 180;
const TILE = 256;
const STATUE_HEIGHT_M = 30.78;   // 101 ft
const MAP_HALF_M = 24000;        // 48 km-wide city map plane
const MAP_ZOOM = 11;             // OSM tile zoom for the wide map
const LOCAL_HALF_M = 200;        // hi-res patch around the monument
const LOCAL_ZOOM = 18;           // OSM tile zoom for the close-up (~0.4 m/px)
const LOCAL_TRIGGER_M = 1500;    // build the hi-res patch when the camera gets this close

export function createViewer(container, origin) {
  // --- Web-Mercator projection anchored at the monument ---
  const centerPxX = lonToPixelX(origin.lon, MAP_ZOOM);
  const centerPxY = latToPixelY(origin.lat, MAP_ZOOM);
  const gmpp = 156543.03392 * Math.cos(origin.lat * DEG) / 2 ** MAP_ZOOM; // ground metres / pixel

  // world (metres, from monument) for any lat/lon
  function worldFromLatLon(lat, lon) {
    return {
      x: (lonToPixelX(lon, MAP_ZOOM) - centerPxX) * gmpp,   // East
      z: (latToPixelY(lat, MAP_ZOOM) - centerPxY) * gmpp,   // +Z = South
    };
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0f14);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 300000);
  camera.position.set(0, 34000, 42000);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);
  controls.maxPolarAngle = Math.PI / 2 - 0.03;
  controls.minDistance = 8;
  controls.maxDistance = 150000;
  controls.update();

  // --- lights ---
  scene.add(new THREE.AmbientLight(0xdfe7f0, 0.7));
  scene.add(new THREE.HemisphereLight(0xbcd0e6, 0x20242c, 0.5));
  const sun = new THREE.DirectionalLight(0xfff4de, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.near = 1; sc.far = 6000;
  sc.left = -160; sc.right = 160; sc.top = 160; sc.bottom = -160;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);

  // reference grid — always visible, so the ground is never a single flat colour
  const grid = new THREE.GridHelper(MAP_HALF_M * 2, 48, 0x33414f, 0x222a34);
  grid.position.y = 0.0;
  scene.add(grid);

  // wide city map, and a hi-res patch built lazily when the camera zooms in
  buildTilePlane(MAP_HALF_M, MAP_ZOOM, -0.1);
  let localBuilt = false;
  function buildLocal() { if (!localBuilt) { localBuilt = true; buildTilePlane(LOCAL_HALF_M, LOCAL_ZOOM, 0.03); } }

  // shadow-catcher near the statue (keeps the map bright but shows the shadow)
  const catcher = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
    new THREE.ShadowMaterial({ opacity: 0.42 })
  );
  catcher.position.y = 0.05;
  catcher.receiveShadow = true;
  scene.add(catcher);

  // --- overlays ---
  const beam = makeLine(0x4fd0e3, 3);
  scene.add(beam);
  const bearingLine = makeLine(0x2f6b74, 1);
  scene.add(bearingLine);
  const tip = makeSprite(makeDotTexture('#ffd166', '#6b5212'), 0xffffff, 0.03);
  tip.visible = false;
  scene.add(tip);

  // monument beacon (so you can find it when zoomed out)
  const beacon = makeSprite(makeDotTexture('#ffb454', '#fff'), 0xffffff, 0.055);
  scene.add(beacon);

  // --- model ---
  const modelGroup = new THREE.Group();
  scene.add(modelGroup);
  let baseCentroid = null, apexLocal = null, modelRoot = null, headingDeg = 0;

  function loadModel(dir, mtlName, objName) {
    return new Promise((resolve, reject) => {
      new MTLLoader().setPath(dir).load(mtlName, (materials) => {
        materials.preload();
        new OBJLoader().setMaterials(materials).setPath(dir).load(objName, (obj) => {
          modelRoot = obj;
          baseCentroid = centroid(obj, 0.05, false);
          apexLocal = centroid(obj, 0.98, true);
          obj.position.x = -baseCentroid.x;
          obj.position.z = -baseCentroid.z;
          obj.traverse((c) => {
            if (c.isMesh) { c.castShadow = true; if (c.material) c.material.side = THREE.DoubleSide; }
          });
          // scale raw model (~0.93 units tall) up to true height in metres
          const rawH = apexLocal.y - baseCentroid.y;
          modelGroup.scale.setScalar(STATUE_HEIGHT_M / rawH);
          modelGroup.add(obj);
          setHeading(headingDeg);
          resolve(obj);
        }, undefined, reject);
      }, undefined, reject);
    });
  }

  // centroid of the top (hi=true) or bottom (hi=false) `frac` band of the model
  function centroid(obj, frac, hi) {
    let minY = Infinity, maxY = -Infinity;
    obj.traverse((c) => {
      if (!c.isMesh) return;
      const p = c.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < minY) minY = y; if (y > maxY) maxY = y; }
    });
    const t = minY + (maxY - minY) * frac;
    let sx = 0, sy = 0, sz = 0, n = 0;
    obj.traverse((c) => {
      if (!c.isMesh) return;
      const p = c.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        if ((hi && y >= t) || (!hi && y <= t)) { sx += p.getX(i); sy += y; sz += p.getZ(i); n++; }
      }
    });
    return new THREE.Vector3(sx / n, sy / n, sz / n);
  }

  function setHeading(deg) {
    headingDeg = deg;
    modelGroup.rotation.y = deg * DEG;
    modelGroup.updateMatrixWorld(true);
  }

  /**
   * Update the sun and recompute the shadow tip (ground shadow of the apex).
   * @returns {null | {bearingDeg, offsetEast, offsetNorth, tipDist}}
   */
  function updateSun(azDeg, altDeg) {
    const az = azDeg * DEG, alt = altDeg * DEG;
    const toSun = new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
    sun.position.copy(toSun).multiplyScalar(3000);
    sun.target.position.set(0, 0, 0);

    if (altDeg <= 0.05 || !apexLocal || !modelRoot) {
      tip.visible = false; beam.visible = false; bearingLine.visible = false;
      return null;
    }
    modelGroup.updateMatrixWorld(true);
    const apex = apexLocal.clone().applyMatrix4(modelRoot.matrixWorld);
    const k = 1 / Math.tan(alt);
    const sx = apex.x - apex.y * Math.sin(az) * k;
    const sz = apex.z + apex.y * Math.cos(az) * k;

    tip.position.set(sx, 2, sz);
    tip.visible = true;

    const offsetEast = sx, offsetNorth = -sz;
    let bearing = Math.atan2(offsetEast, offsetNorth) / DEG;
    if (bearing < 0) bearing += 360;

    // faint reference line straight out along the bearing, to the map edge
    const far = MAP_HALF_M * 1.4;
    setLine(bearingLine, 0, 0, 0, Math.sin(bearing * DEG) * far, 0, -Math.cos(bearing * DEG) * far);
    bearingLine.visible = true;

    return { bearingDeg: bearing, offsetEast, offsetNorth, tipDist: Math.hypot(sx, sz) };
  }

  // --- bakeries ---
  let bakerySprites = [], bakeryWorld = [], targetIdx = -1;
  const dotTex = makeDotTexture('#8a94a4', '#c7d0dc');
  const targetTex = makeDotTexture('#ffb454', '#ffe6bd');

  function plotBakeries(list) {
    for (const s of bakerySprites) scene.remove(s);
    bakerySprites = []; bakeryWorld = [];
    list.forEach((b) => {
      const w = worldFromLatLon(b.lat, b.lon);
      bakeryWorld.push(w);
      const s = makeSprite(dotTex, 0xffffff, 0.032);
      s.position.set(w.x, 40, w.z);
      s.userData.name = b.name;
      scene.add(s);
      bakerySprites.push(s);
    });
  }

  function setTarget(idx) {
    if (targetIdx >= 0 && bakerySprites[targetIdx]) {
      const s = bakerySprites[targetIdx];
      s.material.map = dotTex; s.scale.setScalar(0.032);
    }
    targetIdx = idx;
    if (idx >= 0 && bakerySprites[idx]) {
      const s = bakerySprites[idx];
      s.material.map = targetTex; s.scale.setScalar(0.05);
      const w = bakeryWorld[idx];
      setLine(beam, 0, 2, 0, w.x, 40, w.z);
      beam.visible = true;
    } else {
      beam.visible = false;
    }
  }

  function zoomTo(where) {
    if (where === 'statue') { camera.position.set(45, 40, 70); controls.target.set(0, 14, 0); buildLocal(); }
    else { camera.position.set(0, 34000, 42000); controls.target.set(0, 0, 0); }
    controls.update();
  }

  // --- build a textured ground plane from OSM tiles at a given zoom ---
  // Positions in world metres, so every plane (wide or hi-res) shares one frame.
  function buildTilePlane(halfM, zoom, y) {
    const g = 156543.03392 * Math.cos(origin.lat * DEG) / 2 ** zoom; // metres / pixel at this zoom
    const cX = lonToPixelX(origin.lon, zoom), cY = latToPixelY(origin.lat, zoom);
    const halfPx = halfM / g;
    const tMinX = Math.floor((cX - halfPx) / TILE), tMaxX = Math.floor((cX + halfPx) / TILE);
    const tMinY = Math.floor((cY - halfPx) / TILE), tMaxY = Math.floor((cY + halfPx) / TILE);
    const cols = tMaxX - tMinX + 1, rows = tMaxY - tMinY + 1;
    const cnv = document.createElement('canvas');
    cnv.width = cols * TILE; cnv.height = rows * TILE;
    const ctx = cnv.getContext('2d');
    ctx.fillStyle = '#1a1f27'; ctx.fillRect(0, 0, cnv.width, cnv.height);
    const tex = new THREE.CanvasTexture(cnv);
    tex.colorSpace = THREE.SRGBColorSpace;

    const left = (tMinX * TILE - cX) * g, right = ((tMaxX + 1) * TILE - cX) * g;
    const top = (tMinY * TILE - cY) * g, bottom = ((tMaxY + 1) * TILE - cY) * g;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(right - left, bottom - top).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: tex })
    );
    plane.position.set((left + right) / 2, y, (top + bottom) / 2);
    scene.add(plane);

    const subs = ['a', 'b', 'c'];
    for (let ty = tMinY; ty <= tMaxY; ty++) {
      for (let tx = tMinX; tx <= tMaxX; tx++) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const dx = (tx - tMinX) * TILE, dy = (ty - tMinY) * TILE;
        img.onload = () => { ctx.drawImage(img, dx, dy); tex.needsUpdate = true; };
        img.onerror = () => {};
        img.src = `https://${subs[((tx % 3) + 3) % 3]}.tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`;
      }
    }
    return plane;
  }

  // --- render loop (self-healing size: reconcile the renderer to the container
  //     every frame so the view is always centred and correctly proportioned) ---
  let lastW = 0, lastH = 0;
  function tick() {
    const w = container.clientWidth, h = container.clientHeight;
    if (w && h && (w !== lastW || h !== lastH)) {
      lastW = w; lastH = h;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    controls.update();
    // pull in the hi-res patch once the camera is close, however the zoom happened
    if (!localBuilt && camera.position.distanceTo(controls.target) < LOCAL_TRIGGER_M) buildLocal();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();

  return { loadModel, setHeading, updateSun, plotBakeries, setTarget, zoomTo };
}

// ---------- helpers ----------
function lonToPixelX(lon, z) { return (lon + 180) / 360 * TILE * 2 ** z; }
function latToPixelY(lat, z) {
  const s = Math.sin(lat * DEG);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z;
}

function makeLine(color, width) {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  return new THREE.Line(g, new THREE.LineBasicMaterial({ color, linewidth: width }));
}
function setLine(line, ax, ay, az, bx, by, bz) {
  const p = line.geometry.attributes.position;
  p.setXYZ(0, ax, ay, az); p.setXYZ(1, bx, by, bz); p.needsUpdate = true;
  line.geometry.computeBoundingSphere();
}
function makeSprite(tex, color, scale = 0.032) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, depthTest: false, sizeAttenuation: false }));
  s.scale.setScalar(scale);
  return s;
}
function makeDotTexture(fill, ring) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  x.beginPath(); x.arc(32, 32, 22, 0, Math.PI * 2);
  x.fillStyle = fill; x.fill();
  x.lineWidth = 6; x.strokeStyle = ring; x.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
