// 3D scene: loads the model, lights it with a "sun", and computes the
// farthest point of the cast shadow (the shadow tip) and its compass bearing.
//
// World axes:  +X = East,  -Z = North,  +Y = Up.  North is fixed in the scene;
// the model rotates about its base-centre vertical axis (the heading control).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

const DEG = Math.PI / 180;

export function createViewer(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0f14);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
  camera.position.set(2.4, 1.9, 2.8);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0.4, 0);
  controls.maxPolarAngle = Math.PI / 2 - 0.02; // stay above ground

  // --- lights ---
  scene.add(new THREE.AmbientLight(0x6b7686, 0.55));
  const fill = new THREE.HemisphereLight(0x8ea2b8, 0x14100a, 0.4);
  scene.add(fill);

  const sun = new THREE.DirectionalLight(0xfff2d6, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.near = 0.1; sc.far = 60;
  sc.left = -12; sc.right = 12; sc.top = 12; sc.bottom = -12;
  sun.shadow.bias = -0.0008;
  scene.add(sun);
  scene.add(sun.target); // target stays at origin

  // --- ground ---
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(60, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x11151c, roughness: 1, metalness: 0 })
  );
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(20, 40, 0x2a3340, 0x1b222c);
  grid.position.y = 0.001;
  scene.add(grid);

  addCompass(scene);

  // --- overlays (base → tip ray, tip marker, sun ray) ---
  const rayMat = new THREE.LineBasicMaterial({ color: 0x4fd0e3 });
  const rayGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const ray = new THREE.Line(rayGeom, rayMat);
  scene.add(ray);

  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 20, 16),
    new THREE.MeshBasicMaterial({ color: 0xffd166 })
  );
  tip.visible = false;
  scene.add(tip);

  const sunRayMat = new THREE.LineDashedMaterial({ color: 0xffb454, dashSize: 0.12, gapSize: 0.08 });
  const sunRayGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const sunRay = new THREE.Line(sunRayGeom, sunRayMat);
  scene.add(sunRay);
  const sunDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 20, 16),
    new THREE.MeshBasicMaterial({ color: 0xffb454 })
  );
  sunDot.visible = false;
  scene.add(sunDot);

  // --- model group ---
  const modelGroup = new THREE.Group();
  scene.add(modelGroup);

  let worldVerts = null;   // Float32Array of world-space vertices (recomputed on heading change)
  let baseCentroid = null; // local base centre {x,z}
  let modelRoot = null;
  let headingDeg = 0;

  function loadModel(dir, mtlName, objName) {
    return new Promise((resolve, reject) => {
      new MTLLoader().setPath(dir).load(mtlName, (materials) => {
        materials.preload();
        new OBJLoader().setMaterials(materials).setPath(dir).load(objName, (obj) => {
          modelRoot = obj;
          baseCentroid = computeBaseCentroid(obj);
          // recentre so the base centre sits on the vertical axis of rotation
          obj.position.x = -baseCentroid.x;
          obj.position.z = -baseCentroid.z;
          obj.traverse((c) => {
            if (c.isMesh) {
              c.castShadow = true;
              c.receiveShadow = false;
              if (c.material) c.material.side = THREE.DoubleSide;
            }
          });
          modelGroup.add(obj);
          setHeading(headingDeg);
          resolve(obj);
        }, undefined, reject);
      }, undefined, reject);
    });
  }

  // Base centre = centroid of the lowest ~5% of the model (in local coords).
  function computeBaseCentroid(obj) {
    let minY = Infinity, maxY = -Infinity;
    obj.traverse((c) => {
      if (!c.isMesh) return;
      const p = c.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    });
    const thresh = minY + (maxY - minY) * 0.05;
    let sx = 0, sz = 0, n = 0;
    obj.traverse((c) => {
      if (!c.isMesh) return;
      const p = c.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) <= thresh) { sx += p.getX(i); sz += p.getZ(i); n++; }
      }
    });
    return { x: sx / n, z: sz / n };
  }

  function setHeading(deg) {
    headingDeg = deg;
    modelGroup.rotation.y = deg * DEG;
    modelGroup.updateMatrixWorld(true);
    cacheWorldVerts();
  }

  // Snapshot every vertex in world space (so shadow projection is cheap per update).
  function cacheWorldVerts() {
    if (!modelRoot) return;
    let total = 0;
    modelRoot.traverse((c) => { if (c.isMesh) total += c.geometry.attributes.position.count; });
    worldVerts = new Float32Array(total * 3);
    const v = new THREE.Vector3();
    let o = 0;
    modelRoot.traverse((c) => {
      if (!c.isMesh) return;
      const p = c.geometry.attributes.position;
      c.updateWorldMatrix(true, false);
      for (let i = 0; i < p.count; i++) {
        v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(c.matrixWorld);
        worldVerts[o++] = v.x; worldVerts[o++] = v.y; worldVerts[o++] = v.z;
      }
    });
  }

  /**
   * Update the sun and recompute the shadow tip.
   * @param {number} azDeg  compass azimuth of the sun (0=N, clockwise)
   * @param {number} altDeg altitude above horizon
   * @returns {null | {bearingDeg:number, offsetEast:number, offsetNorth:number, tipDist:number}}
   */
  function updateSun(azDeg, altDeg) {
    const az = azDeg * DEG;
    const alt = altDeg * DEG;
    // unit vector pointing toward the sun in world space
    const toSun = new THREE.Vector3(
      Math.sin(az) * Math.cos(alt),   // East (+X)
      Math.sin(alt),                  // Up (+Y)
      -Math.cos(az) * Math.cos(alt)   // North is -Z, so +N component -> -Z
    );

    // place sun light + gizmo
    sun.position.copy(toSun).multiplyScalar(20);
    sun.target.position.set(0, 0, 0);
    const gizmoR = 3.2;
    sunDot.position.copy(toSun).multiplyScalar(gizmoR);
    sunDot.visible = altDeg > 0;
    setLine(sunRay, new THREE.Vector3(0, 0, 0), sunDot.position);
    sunRay.computeLineDistances();
    sunRay.visible = altDeg > 0;

    if (altDeg <= 0.05 || !worldVerts) {
      tip.visible = false;
      ray.visible = false;
      return null;
    }

    // project every vertex to the ground along the light direction, keep the
    // farthest from the base centre (world origin) — that's the shadow tip.
    const k = 1 / Math.tan(alt);
    const sinAz = Math.sin(az), cosAz = Math.cos(az);
    let bestX = 0, bestZ = 0, bestD2 = -1;
    for (let i = 0; i < worldVerts.length; i += 3) {
      const x = worldVerts[i], y = worldVerts[i + 1], z = worldVerts[i + 2];
      const sx = x - y * sinAz * k;
      const sz = z + y * cosAz * k;
      const d2 = sx * sx + sz * sz;
      if (d2 > bestD2) { bestD2 = d2; bestX = sx; bestZ = sz; }
    }

    tip.position.set(bestX, 0, bestZ);
    tip.visible = true;
    setLine(ray, new THREE.Vector3(0, 0.01, 0), new THREE.Vector3(bestX, 0.01, bestZ));
    ray.visible = true;

    const offsetEast = bestX;
    const offsetNorth = -bestZ;
    let bearing = Math.atan2(offsetEast, offsetNorth) / DEG;
    if (bearing < 0) bearing += 360;

    return { bearingDeg: bearing, offsetEast, offsetNorth, tipDist: Math.sqrt(bestD2) };
  }

  function setLine(line, a, b) {
    const pos = line.geometry.attributes.position;
    pos.setXYZ(0, a.x, a.y, a.z);
    pos.setXYZ(1, b.x, b.y, b.z);
    pos.needsUpdate = true;
    line.geometry.computeBoundingSphere();
  }

  // --- render loop & resize ---
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  function tick() {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();

  return { loadModel, setHeading, updateSun };
}

// N/E/S/W labels + a north arrow on the ground plane.
function addCompass(scene) {
  const R = 1.7;
  const dirs = [
    { t: 'N', x: 0, z: -R, c: '#ff5d6c' },
    { t: 'E', x: R, z: 0, c: '#97a3b4' },
    { t: 'S', x: 0, z: R, c: '#97a3b4' },
    { t: 'W', x: -R, z: 0, c: '#97a3b4' },
  ];
  for (const d of dirs) scene.add(makeLabel(d.t, d.c, d.x, d.z));

  // north arrow
  const mat = new THREE.LineBasicMaterial({ color: 0xff5d6c });
  const g = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0.01, 0), new THREE.Vector3(0, 0.01, -R * 0.8),
    new THREE.Vector3(-0.06, 0.01, -R * 0.8 + 0.12), new THREE.Vector3(0, 0.01, -R * 0.8),
    new THREE.Vector3(0.06, 0.01, -R * 0.8 + 0.12),
  ]);
  scene.add(new THREE.Line(g, mat));
}

function makeLabel(text, color, x, z) {
  const cnv = document.createElement('canvas');
  cnv.width = cnv.height = 128;
  const ctx = cnv.getContext('2d');
  ctx.fillStyle = color;
  ctx.font = 'bold 84px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(cnv);
  tex.anisotropy = 4;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.position.set(x, 0.18, z);
  spr.scale.set(0.28, 0.28, 0.28);
  return spr;
}
