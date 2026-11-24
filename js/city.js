// The opening (and closing) scene: a car finding its way through a city, with GPS's blue dot.
// Pure scenery: no GPS maths happens here. It is drawn in metres, in its own scene, because a
// street and a planet are too far apart in size to share one 3-D scene.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mulberry32 } from './core/rng.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (t) => t * t * (3 - 2 * t);

const BLOCK = 120, ROAD = 16;         // city blocks every 120 m, streets 16 m wide
const XB = 5, ZB0 = -22, ZB1 = 7;     // blocks across, and along the car's street
const LANE_X = 4;                     // the car drives north (−z) in the right-hand lane of the street at x = 0
const SPEED = 8;                      // m/s
const START_Z = 700, END_Z = -2300;
const SKY = '#eef2f7';

// Where the camera is, relative to the car, along the story (g = how far you have scrolled, in steps).
// off: camera position; look: point it looks at.
const KEYS = [
  { t: 0.0, off: [3.4, 2.9, 10.5], look: [0, 1.4, -14] },
  { t: 0.45, off: [3.4, 2.9, 10.5], look: [0, 1.4, -14] },
  { t: 1.35, off: [36, 96, 66], look: [0, 0, -8] },
  { t: 2.1, off: [0, 4200, 1700], look: [0, 0, -300] },
  { t: 9.6, off: [0, 4200, 1700], look: [0, 0, -300] },
  { t: 10.45, off: [-12.5, 5.5, -14.5], look: [0, 1.1, -1] },
];

export function createCity(canvas, { labelLayer } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 200, 1400);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 80000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd3d7de, 1.1));
  const sun = new THREE.DirectionalLight(0xfff6ea, 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(window.innerWidth < 820 ? 1024 : 2048, window.innerWidth < 820 ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -190, right: 190, top: 190, bottom: -190, near: 1, far: 700 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  // ── The ground and the streets ──
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80000, 80000), new THREE.MeshStandardMaterial({ color: '#e6e8ec', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const roadMat = new THREE.MeshStandardMaterial({ color: '#c9cdd4', roughness: 0.95 });
  const flat = (w, l, mat, x, z, y) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  const zMid = ((ZB0 + ZB1) / 2) * BLOCK, zLen = (ZB1 - ZB0 + 1) * BLOCK;
  for (let i = -XB; i <= XB; i++) flat(ROAD, zLen, roadMat, i * BLOCK, zMid, 0.03);
  for (let j = ZB0; j <= ZB1; j++) flat((2 * XB + 1) * BLOCK, ROAD, roadMat, 0, j * BLOCK, 0.031);
  // lane markings on the car's street
  const paint = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  flat(0.18, zLen, paint, 0, zMid, 0.05);
  const dashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.16, 3), paint, Math.ceil(zLen / 9) * 2);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), one = new THREE.Vector3(1, 1, 1);
  let d = 0;
  for (let z = ZB0 * BLOCK; z < (ZB1 + 1) * BLOCK && d < dashes.count - 1; z += 9) {
    for (const x of [-LANE_X, LANE_X]) { m4.compose(new THREE.Vector3(x, 0.05, z), q, one); dashes.setMatrixAt(d++, m4); }
  }
  dashes.count = d;
  scene.add(dashes);

  // ── Buildings: plain white blocks, like an architect's model ──
  const rand = mulberry32(31);
  const boxes = [];
  for (let i = -XB; i < XB; i++) for (let j = ZB0; j < ZB1; j++) {
    const x0 = i * BLOCK + ROAD / 2 + 4, z0 = j * BLOCK + ROAD / 2 + 4, inner = BLOCK - ROAD - 8;
    const park = rand() < 0.08;
    if (park) continue;
    const split = rand() < 0.5 ? 2 : 1;
    const cell = inner / split;
    for (let a = 0; a < split; a++) for (let b = 0; b < split; b++) {
      const w = cell - 6 - rand() * 6, dd = cell - 6 - rand() * 6;
      const near = Math.abs(i * BLOCK + BLOCK / 2) < BLOCK ? 1 : 0.8;
      const h = (14 + rand() ** 2 * 95) * near;
      boxes.push({ x: x0 + a * cell + cell / 2, z: z0 + b * cell + cell / 2, w, d: dd, h, tint: 0.9 + rand() * 0.1 });
    }
  }
  const buildings = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), boxes.length);
  buildings.castShadow = true;
  buildings.receiveShadow = true;
  const col = new THREE.Color();
  const flatM = new THREE.Matrix4();
  boxes.forEach((b, k) => {
    col.setRGB(b.tint, b.tint, b.tint * 1.01); buildings.setColorAt(k, col);
    flatM.compose(new THREE.Vector3(b.x, 0, b.z), new THREE.Quaternion(), new THREE.Vector3(b.w, 0.0001, b.d)); buildings.setMatrixAt(k, flatM);
  });
  scene.add(buildings);

  // ── Trees along the car's street ──
  const crowns = new THREE.InstancedMesh(new THREE.SphereGeometry(2.3, 14, 10), new THREE.MeshStandardMaterial({ color: '#8fc48a', roughness: 0.9 }), 400);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.28, 4, 8), new THREE.MeshStandardMaterial({ color: '#9c8a74', roughness: 1 }), 400);
  crowns.castShadow = trunks.castShadow = true;
  let tcount = 0;
  for (let z = ZB0 * BLOCK; z < (ZB1 + 1) * BLOCK && tcount < 400; z += 16) {
    if (Math.abs(((z % BLOCK) + BLOCK) % BLOCK) < ROAD) continue; // not in a crossing
    for (const x of [-(ROAD / 2 + 2.5), ROAD / 2 + 2.5]) {
      const s = 0.85 + ((tcount * 7919) % 30) / 100;
      m4.compose(new THREE.Vector3(x, 2, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)); trunks.setMatrixAt(tcount, m4);
      m4.compose(new THREE.Vector3(x, 5.2 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)); crowns.setMatrixAt(tcount, m4);
      tcount++;
    }
  }
  crowns.count = trunks.count = tcount;
  scene.add(crowns, trunks);

  // ── The car ──
  const car = new THREE.Group();
  const carPaint = new THREE.MeshPhysicalMaterial({ color: '#f4f5f7', metalness: 0.35, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#1b2230', metalness: 0.3, roughness: 0.06, clearcoat: 1 });
  const tyre = new THREE.MeshStandardMaterial({ color: '#1c1c1e', roughness: 0.75 });
  const lamp = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1.2 });
  const tail = new THREE.MeshStandardMaterial({ color: '#ff3b30', emissive: '#ff3b30', emissiveIntensity: 0.9 });
  const part = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; car.add(m); return m; };
  part(new RoundedBoxGeometry(1.95, 0.72, 4.6, 5, 0.3), carPaint, 0, 0.74, 0);
  part(new RoundedBoxGeometry(1.74, 0.62, 2.5, 5, 0.27), glass, 0, 1.3, 0.25);
  part(new RoundedBoxGeometry(1.6, 0.07, 2.05, 3, 0.03), carPaint, 0, 1.62, 0.3);
  for (const sx of [-0.96, 0.96]) for (const sz of [-1.5, 1.45]) { const w = part(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 28), tyre, sx, 0.38, sz); w.rotation.z = Math.PI / 2; }
  for (const sx of [-0.62, 0.62]) { part(new THREE.BoxGeometry(0.42, 0.12, 0.05), lamp, sx, 0.86, -2.3); part(new THREE.BoxGeometry(0.42, 0.1, 0.05), tail, sx, 0.88, 2.3); }
  scene.add(car);

  // ── The navigation route and the blue dot ──
  const route = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1), new THREE.MeshBasicMaterial({ color: '#0a84ff', transparent: true, opacity: 0.85 }));
  route.rotation.x = -Math.PI / 2;
  scene.add(route);
  const halo = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: '#0a84ff', transparent: true, opacity: 0.14, depthWrite: false }));
  halo.rotation.x = -Math.PI / 2;
  scene.add(halo);
  const dotTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const c = cv.getContext('2d');
    c.shadowColor = 'rgba(0,0,0,0.35)'; c.shadowBlur = 10; c.shadowOffsetY = 3;
    c.fillStyle = '#ffffff'; c.beginPath(); c.arc(64, 62, 30, 0, Math.PI * 2); c.fill();
    c.shadowColor = 'transparent';
    c.fillStyle = '#0a84ff'; c.beginPath(); c.arc(64, 62, 22, 0, Math.PI * 2); c.fill();
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, depthTest: false, sizeAttenuation: false }));
  dot.scale.set(0.055, 0.055, 1);
  dot.renderOrder = 10;
  scene.add(dot);

  // A label that follows the dot.
  const tag = document.createElement('div');
  tag.className = 'tag blue';
  tag.textContent = 'GPS: you are here';
  labelLayer.append(tag);

  // ── Size ──
  let W = 1, H = 1;
  function resize() {
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    // keep the car clear of the text: right of centre on wide screens, above it on narrow ones
    if (W > 820) camera.setViewOffset(W, H, -Math.min(230, W * 0.15), 0, W, H);
    else camera.setViewOffset(W, H, 0, H * 0.16, W, H);
    // on a narrow screen, follow from straight behind so the car stays in frame
    const side = W > 820 ? 3.4 : 0.6;
    KEYS[0].off[0] = KEYS[1].off[0] = side;
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // ── State and drawing ──
  let born = null, g = 0, alpha = 1, t0 = performance.now();
  const carPos = new THREE.Vector3();
  const target = new THREE.Vector3(), rel = new THREE.Vector3(), relB = new THREE.Vector3(), tB = new THREE.Vector3();
  function cameraAt(gg, out, look) {
    let i = 0;
    while (i < KEYS.length - 2 && gg > KEYS[i + 1].t) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const f = smooth(clamp01((gg - a.t) / (b.t - a.t)));
    look.set(...a.look).lerp(tB.set(...b.look), f);
    rel.set(...a.off).sub(target.set(...a.look));
    relB.set(...b.off).sub(tB);
    const la = rel.length(), lb = relB.length();
    rel.normalize().lerp(relB.normalize(), f).normalize().multiplyScalar(Math.exp(Math.log(la) + (Math.log(lb) - Math.log(la)) * f));
    out.copy(look).add(rel);
  }

  function animateBuildings(now) {
    if (born === null) return false;
    const k = (now - born) / 1000;
    const m = new THREE.Matrix4();
    let done = true;
    boxes.forEach((b, i) => {
      const dist = Math.hypot(b.x - LANE_X, b.z - carPos.z);
      const f = clamp01((k - dist / 900) / 0.9);
      if (f < 1) done = false;
      const e = f === 0 ? 0.0001 : 1 - (1 - f) ** 3;
      const h = Math.max(0.01, b.h * e);
      m.compose(new THREE.Vector3(b.x, h / 2, b.z), new THREE.Quaternion(), new THREE.Vector3(b.w, h, b.d));
      buildings.setMatrixAt(i, m);
    });
    buildings.instanceMatrix.needsUpdate = true;
    return done;
  }
  let built = false;

  const look = new THREE.Vector3(), camPos = new THREE.Vector3(), tmp = new THREE.Vector3();
  function tick(now) {
    const time = (now - t0) / 1000;
    const span = START_Z - END_Z;
    carPos.set(LANE_X, 0, START_Z - ((time * SPEED) % span));
    car.position.copy(carPos);
    if (!built) built = animateBuildings(now);
    if (alpha < 0.003) { tag.style.opacity = 0; return; }
    // the route: from the car's nose, 380 m up the street
    route.scale.set(1, 380, 1);
    route.position.set(LANE_X, 0.06, carPos.z - 2.4 - 190);
    halo.position.set(carPos.x, 0.07, carPos.z);
    halo.scale.setScalar(6 + Math.sin(time * 2.4) * 0.8);
    dot.position.set(carPos.x, 2.4, carPos.z);
    // camera
    cameraAt(g, camPos, look);
    camera.position.copy(carPos).add(camPos);
    camera.lookAt(tmp.copy(carPos).add(look));
    const hgt = camera.position.y;
    scene.fog.near = 180 + hgt * 0.9;
    scene.fog.far = 1300 + hgt * 3.4;
    sun.position.set(carPos.x + 90, 170, carPos.z + 70);
    sun.target.position.copy(carPos);
    renderer.render(scene, camera);
    // the label over the blue dot, only while the story talks about it
    const ta = smooth(clamp01((g - 0.55) / 0.3)) * (1 - smooth(clamp01((g - 1.45) / 0.25))) * alpha;
    tmp.copy(dot.position).project(camera);
    tag.style.transform = `translate(${((tmp.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-tmp.y * 0.5 + 0.5) * H).toFixed(1)}px) translate(-50%, calc(-100% - 22px))`;
    tag.style.opacity = ta.toFixed(3);
  }

  return {
    generate() { born = performance.now(); t0 = born; built = false; },
    set(gg, a) { g = gg; alpha = a; },
    tick,
  };
}
