// Unified 3D scene: the map is a texture on a ground plane (Web-Mercator OSM
// tiles), the monument stands at true scale at the centre, its real shadow falls
// on the map, and a green "matrix" triangle points along the shadow's bearing.
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
  camera.position.set(45, 40, 70); // default: zoomed to the statue

  // logarithmicDepthBuffer: the scene spans 0.5 m to 300 km, so a linear z-buffer
  // z-fights between the near-coplanar map planes — a log buffer fixes the flicker.
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 14, 0);
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

  // wide city map, and a hi-res patch built lazily when the camera zooms in.
  // Only one is ever visible (toggled by distance) so their tiles never z-fight.
  const cityPlane = buildTilePlane(MAP_HALF_M, MAP_ZOOM, -0.1);
  let localPlane = null, localBuilt = false;
  function buildLocal() {
    if (localBuilt) return;
    localBuilt = true;
    localPlane = buildTilePlane(LOCAL_HALF_M, LOCAL_ZOOM, 0.03);
  }

  // shadow-catcher near the statue (keeps the map bright but shows the shadow)
  const catcher = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
    new THREE.ShadowMaterial({ opacity: 0.42 })
  );
  catcher.position.y = 0.05;
  catcher.receiveShadow = true;
  scene.add(catcher);

  // --- shadow-vector pointer: a vertical translucent-green 10° triangle with a
  //     falling ASCII-bagel "matrix", from the statue centre off along the shadow ---
  const POINTER_LEN = 60000;
  const POINTER_LOW = Math.tan(1 * DEG);    // bottom edge lifted 1° so it clears the ground
  const POINTER_HIGH = Math.tan(11 * DEG);  // top edge → 10° apex angle
  const triGeo = new THREE.BufferGeometry();
  triGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  triGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0.5, 1, 0, 1, 1]), 2));
  triGeo.setIndex([0, 1, 2]);
  const mCanvas = document.createElement('canvas'); mCanvas.width = 512; mCanvas.height = 256;
  const mCtx = mCanvas.getContext('2d');
  const mTex = new THREE.CanvasTexture(mCanvas);
  const pointer = new THREE.Group();
  pointer.add(new THREE.Mesh(triGeo, new THREE.MeshBasicMaterial({
    color: 0x27ff86, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })));
  const matrixMesh = new THREE.Mesh(triGeo, new THREE.MeshBasicMaterial({
    map: mTex, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
  matrixMesh.renderOrder = 3;
  pointer.add(matrixMesh);
  pointer.add(new THREE.LineLoop(triGeo, new THREE.LineBasicMaterial({
    color: 0x9dffc4, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending })));
  pointer.visible = false;
  scene.add(pointer);

  const MGLYPHS = ['◯', '⊙', '0', 'O', 'o', '()', '◎', 'Ø', 'Q', '🥯'];
  const MCELL = 18, MCOLS = Math.floor(mCanvas.width / MCELL);
  const mDrops = Array.from({ length: MCOLS }, () => (Math.random() * 16) | 0);
  function drawMatrix() {
    mCtx.fillStyle = 'rgba(0,12,5,0.16)'; mCtx.fillRect(0, 0, mCanvas.width, mCanvas.height);
    mCtx.font = `${MCELL}px monospace`; mCtx.textBaseline = 'top';
    for (let i = 0; i < MCOLS; i++) {
      const x = i * MCELL, y = mDrops[i] * MCELL;
      mCtx.fillStyle = '#2bff86'; mCtx.fillText(MGLYPHS[(Math.random() * MGLYPHS.length) | 0], x, y - MCELL);
      mCtx.fillStyle = '#e9fff0'; mCtx.fillText(MGLYPHS[(Math.random() * MGLYPHS.length) | 0], x, y); // bright head
      mDrops[i]++;
      if (y > mCanvas.height && Math.random() > 0.955) mDrops[i] = 0;
    }
    mTex.needsUpdate = true;
  }
  function updatePointer(bearingDeg) {
    const dx = Math.sin(bearingDeg * DEG), dz = -Math.cos(bearingDeg * DEG);
    const L = POINTER_LEN, p = triGeo.attributes.position.array;
    p[0] = 0;      p[1] = 0;                p[2] = 0;       // apex at the centre of the base
    p[3] = dx * L; p[4] = L * POINTER_LOW;  p[5] = dz * L;  // bottom edge
    p[6] = dx * L; p[7] = L * POINTER_HIGH; p[8] = dz * L;  // top edge (+10°)
    triGeo.attributes.position.needsUpdate = true;
    triGeo.computeBoundingSphere();
  }

  // --- model ---
  const modelGroup = new THREE.Group();
  scene.add(modelGroup);
  let baseCentroid = null, apexLocal = null, modelRoot = null, headingDeg = 0;
  let dialShops = null, dial = null, baseRadius = 20, dialItems = [];

  // Loads a single decimated OBJ with baked vertex colours (no MTL/texture).
  function loadModel(objPath) {
    return new Promise((resolve, reject) => {
      new OBJLoader().load(objPath, (obj) => {
        modelRoot = obj;
        obj.traverse((c) => {
          if (!c.isMesh) return;
          c.geometry.computeVertexNormals();
          const hasColor = !!c.geometry.getAttribute('color');
          c.material = new THREE.MeshStandardMaterial({
            vertexColors: hasColor, color: hasColor ? 0xffffff : 0xb9bcc2,
            roughness: 0.9, metalness: 0.03, side: THREE.DoubleSide,
          });
          c.castShadow = true;
        });
        baseCentroid = centroid(obj, 0.05, false);
        apexLocal = centroid(obj, 0.98, true);
        obj.position.x = -baseCentroid.x;
        obj.position.z = -baseCentroid.z;
        // scale raw model (~0.93 units tall) up to true height in metres
        const rawH = apexLocal.y - baseCentroid.y;
        modelGroup.scale.setScalar(STATUE_HEIGHT_M / rawH);
        modelGroup.add(obj);
        setHeading(headingDeg);
        const box = new THREE.Box3().setFromObject(modelGroup);
        const sz = new THREE.Vector3(); box.getSize(sz);
        baseRadius = Math.max(sz.x, sz.z) / 2;
        tryBuildDial();
        resolve(obj);
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
      pointer.visible = false;
      return null;
    }
    modelGroup.updateMatrixWorld(true);
    const apex = apexLocal.clone().applyMatrix4(modelRoot.matrixWorld);
    const k = 1 / Math.tan(alt);
    const sx = apex.x - apex.y * Math.sin(az) * k;
    const sz = apex.z + apex.y * Math.cos(az) * k;

    const offsetEast = sx, offsetNorth = -sz;
    let bearing = Math.atan2(offsetEast, offsetNorth) / DEG;
    if (bearing < 0) bearing += 360;

    updatePointer(bearing);
    pointer.visible = true;

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
    // dial shows the nearest 10 shops (map still shows all); each name is placed
    // at the shop's real bearing from the statue, so the shadow triangle sweeps to it
    dialShops = list.map((b, i) => {
      const w = bakeryWorld[i];
      return { idx: i, name: b.name, bearing: (Math.atan2(w.x, -w.z) / DEG + 360) % 360 };
    });
    tryBuildDial();
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
    }
    setDialHighlight(idx);
  }

  // light up the selected shop's name + dot on the dial in bright green
  function setDialHighlight(idx) {
    for (const it of dialItems) {
      const on = it.idx === idx;
      if (it.on === on) continue;
      it.on = on;
      it.label.material.map.dispose();
      it.label.material.map = makeTextTexture(it.name, on);
      it.label.material.needsUpdate = true;
      it.dot.material.map.dispose();
      it.dot.material.map = makeGlyphTex(on);
      it.dot.material.needsUpdate = true;
    }
  }

  // --- dial: a raised 3D watch bezel (milled-steel ring) around the statue base,
  //     radius 25% larger than the base, with each carved-stone shop name placed
  //     at that shop's true bearing so the shadow triangle sweeps straight to it ---
  function tryBuildDial() {
    if (dial || !dialShops || !modelRoot) return;
    try {
      dial = buildDial(dialShops, baseRadius * 1.25);
      scene.add(dial);
    } catch (e) {
      console.error('dial build failed', e);   // never let a dial hiccup break model loading
    }
  }
  function buildDial(shops, dialR) {
    const H = 1.6, innerR = baseRadius;     // low raised bezel with a flat top face
    const g = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0xbcc2c9, metalness: 0.7, roughness: 0.38, side: THREE.DoubleSide });

    const wallO = new THREE.Mesh(new THREE.CylinderGeometry(dialR, dialR, H, 96, 1, true), steel); wallO.position.y = H / 2; g.add(wallO);
    const wallI = new THREE.Mesh(new THREE.CylinderGeometry(innerR, innerR, H, 96, 1, true), steel); wallI.position.y = H / 2; g.add(wallI);

    // flat top face — the inscribable surface
    const top = new THREE.Mesh(
      new THREE.RingGeometry(innerR, dialR, 96).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: makeSteelTexture(), metalness: 0.45, roughness: 0.5, side: THREE.DoubleSide })
    );
    top.position.y = H; g.add(top);

    // Each name sits at its shop's true bearing; a text dot marks the anchor and
    // the name is staggered outward along the radius (all shops, so several tiers)
    // so nothing overlaps. Refs are kept so the selected shop can glow green.
    dialItems = [];
    const rText = (innerR + dialR) / 2, y = H + 0.06, up = new THREE.Vector3(0, 1, 0);
    const stemMat = new THREE.LineBasicMaterial({ color: 0x8a9099, transparent: true, opacity: 0.7 });
    const ph = 5.2, pw = ph * 2, dd = 2.4;   // ~2× larger labels
    const LANES = 6, RBASE = dialR * 1.04, RSTEP = ph * 1.15;   // radial gap > label height → no overlap
    const sorted = shops.slice().sort((a, b) => a.bearing - b.bearing);
    sorted.forEach((s, i) => {
      try {
        const b = s.bearing * DEG;
        const ux = Math.sin(b), uz = -Math.cos(b);
        const rOut = new THREE.Vector3(ux, 0, uz);
        const tang = new THREE.Vector3(Math.cos(b), 0, Math.sin(b));
        const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(tang, rOut, up));
        const nameR = RBASE + (i % LANES) * RSTEP;

        const dot = new THREE.Mesh(new THREE.PlaneGeometry(dd, dd),
          new THREE.MeshBasicMaterial({ map: makeGlyphTex(false), transparent: true, depthWrite: false }));
        dot.position.set(ux * rText, y, uz * rText); dot.quaternion.copy(q); g.add(dot);

        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(ux * rText, y, uz * rText), new THREE.Vector3(ux * nameR, y, uz * nameR)]), stemMat));

        const label = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph),
          new THREE.MeshBasicMaterial({ map: makeTextTexture(s.name, false), transparent: true, depthWrite: false }));
        label.position.set(ux * nameR, y, uz * nameR); label.quaternion.copy(q); g.add(label);

        dialItems.push({ idx: s.idx, name: s.name, label, dot, on: false });
      } catch (e) {
        console.error('dial label failed for', s && s.name, e);
      }
    });
    return g;
  }

  function makeSteelTexture() {
    const w = 128, h = 128;
    const cnv = document.createElement('canvas'); cnv.width = w; cnv.height = h;
    const x = cnv.getContext('2d');
    const grad = x.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#aeb4bb'); grad.addColorStop(0.5, '#cdd3d9');
    grad.addColorStop(0.52, '#7f858d'); grad.addColorStop(1, '#a7adb4');
    x.fillStyle = grad; x.fillRect(0, 0, w, h);
    for (let i = 0; i < w; i += 2) {        // vertical knurl
      x.strokeStyle = (i & 2) ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.12)';
      x.beginPath(); x.moveTo(i, 0); x.lineTo(i, h); x.stroke();
    }
    const tex = new THREE.CanvasTexture(cnv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(64, 1);
    return tex;
  }

  // engraved "•" dot texture — dark normally, bright-green glow when selected
  function makeGlyphTex(on) {
    const s = 128;
    const cnv = document.createElement('canvas'); cnv.width = cnv.height = s;
    const x = cnv.getContext('2d');
    x.font = `700 ${s}px "Cinzel", Georgia, serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    if (on) {
      x.shadowColor = 'rgba(43,255,134,0.95)'; x.shadowBlur = 16;
      x.fillStyle = '#39ff9c'; x.fillText('•', s / 2, s * 0.46);
      x.shadowBlur = 0; x.fillStyle = '#eafff0'; x.fillText('•', s / 2, s * 0.46);
    } else {
      x.fillStyle = 'rgba(255,255,255,0.5)'; x.fillText('•', s / 2 + 1, s * 0.46 + 1);
      x.fillStyle = '#111316'; x.fillText('•', s / 2, s * 0.46);
    }
    const tex = new THREE.CanvasTexture(cnv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    return tex;
  }

  // carved-stone name texture — engraved normally, bright-green glow when selected
  function makeTextTexture(name, on) {
    const cw = 512, ch = 256;
    const cnv = document.createElement('canvas'); cnv.width = cw; cnv.height = ch;
    const x = cnv.getContext('2d');
    const label = name.toUpperCase().replace(/U/g, 'V');
    const fs = 58;
    x.font = `700 ${fs}px "Cinzel", "Trajan Pro", Georgia, serif`;
    try { x.letterSpacing = '2px'; } catch (_) {}
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const lines = wrapToWidth(x, label, cw * 0.92).slice(0, 3);
    const lh = fs * 1.02, tot = (lines.length - 1) * lh;
    lines.forEach((ln, li) => {
      const yy = ch / 2 + li * lh - tot / 2;
      if (on) {
        x.shadowColor = 'rgba(43,255,134,0.95)'; x.shadowBlur = 22;
        x.fillStyle = '#39ff9c'; x.fillText(ln, cw / 2, yy);
        x.shadowBlur = 0; x.fillStyle = '#eafff0'; x.fillText(ln, cw / 2, yy);
      } else {
        x.fillStyle = 'rgba(255,255,255,0.5)'; x.fillText(ln, cw / 2 + 1, yy + 1);
        x.fillStyle = '#111316'; x.fillText(ln, cw / 2, yy);
      }
    });
    const tex = new THREE.CanvasTexture(cnv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    return tex;
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
    if (pointer.visible) drawMatrix();
    // pull in the hi-res patch once the camera is close, however the zoom happened
    const camDist = camera.position.distanceTo(controls.target);
    if (!localBuilt && camDist < LOCAL_TRIGGER_M) buildLocal();
    // show exactly one map plane so the two tile sets never overlap / flicker
    if (localPlane) {
      const close = camDist < LOCAL_HALF_M * 4;
      localPlane.visible = close;
      cityPlane.visible = !close;
    }
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

function wrapToWidth(ctx, text, maxW) {
  const words = text.split(/\s+/);
  const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (cur && ctx.measureText(t).width > maxW) { lines.push(cur); cur = w; }
    else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
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
