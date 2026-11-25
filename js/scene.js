// The Earth and the satellites. Three.js only DRAWS this scene. Every satellite position,
// measurement and answer comes from our own code: world.js makes the measurements, receiver.js
// solves them.
//
// In the story, everything on screen is a smooth function of one number, g: how far you have
// scrolled, counted in steps (step 2 is the first one in space, step 10 the last). Half-way
// between two steps shows the model half-way between them, so it glides as you scroll.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { C, R_GPS } from './core/constants.js';
import { llaToEcef, enuBasis, ecefToEnu } from './core/geo.js';
import { measure } from './core/world.js';
import { solveFix, solutionCurve3D, sphereIntersections } from './core/receiver.js';
import { dopFromSky } from './core/dop.js';
import { slantFactor } from './core/iono.js';
import { sub, norm } from './core/linalg.js';
import { gaussianSource } from './core/rng.js';
import { makeVeil } from './veil.js';

const U = 1e6;                                             // 1 scene unit = 1,000 km
const R = 6.371;                                           // Earth's radius in scene units
const toV = (p) => new THREE.Vector3(p[0] / U, p[2] / U, -p[1] / U); // ECEF metres → scene (y = north pole)
const toDir = (d) => new THREE.Vector3(d[0], d[2], -d[1]);
const DEG = Math.PI / 180;
export const SAT_COLORS = ['#0a84ff', '#ff375f', '#bf5af2', '#28a745', '#ff9f0a', '#5ac8fa', '#ffcc00', '#a2845e'];
const ORANGE = '#ff9500';
const LON = 127, STORY_LAT = 37.5, MASK = 10, CLOCK_MS = 1, STORY_T = 8;
const TEX = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/textures/planets/';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ramp = (g, a, b) => { const t = clamp01((g - a) / (b - a)); return t * t * (3 - 2 * t); }; // smooth 0 → 1 between a and b
const band = (g, a, b, c, d) => ramp(g, a, b) * (1 - ramp(g, c, d));                             // in at a–b, out at c–d

// The GPS constellation, simplified: 24 satellites in 6 circular orbits tilted 55°.
const PERIOD = 90;                                         // seconds per orbit when the lab's satellites move
const CONST = [];
for (let p = 0; p < 6; p++) for (let s = 0; s < 4; s++) CONST.push({ id: p * 4 + s + 1, raan: p * 60 * DEG, u0: (s * 90 + p * 15) * DEG });
function satPos(sat, t) {
  const u = sat.u0 + (2 * Math.PI * t) / PERIOD, i = 55 * DEG;
  const cu = Math.cos(u), su = Math.sin(u), cO = Math.cos(sat.raan), sO = Math.sin(sat.raan);
  return [R_GPS * (cu * cO - su * Math.cos(i) * sO), R_GPS * (cu * sO + su * Math.cos(i) * cO), R_GPS * su * Math.sin(i)];
}
// Satellites above your horizon (10° mask), with their direction in your sky.
function skyOf(P, B, positions) {
  return CONST.map((s, i) => {
    const [e, n, u] = ecefToEnu(sub(positions[i], P), B);
    const r = Math.hypot(e, n, u);
    return { id: s.id, i, pos: positions[i], az: ((Math.atan2(e, n) / DEG) + 360) % 360, el: Math.asin(u / r) / DEG };
  }).filter((q) => q.el > MASK);
}
// Every group of four visible satellites, scored by geometry (GDOP).
function fours(vis) {
  const out = [];
  const rec = (start, acc) => {
    if (acc.length === 4) { const d = dopFromSky(acc); if (d.ok) out.push({ g: d.gdop, set: [...acc] }); return; }
    for (let i = start; i < vis.length; i++) { acc.push(vis[i]); rec(i + 1, acc); acc.pop(); }
  };
  rec(0, []);
  return out;
}
const byAz = (a, b) => a.az - b.az;
// The best-spread n satellites: the best four, then the best extras one at a time.
function bestSet(vis, n) {
  const all = fours(vis);
  let used = all.length ? all.reduce((a, b) => (b.g < a.g ? b : a)).set : vis.slice(0, 4);
  while (used.length < Math.min(n, vis.length)) {
    let pick = null;
    for (const q of vis) if (!used.includes(q)) { const d = dopFromSky([...used, q]); if (d.ok && (!pick || d.gdop < pick.g)) pick = { g: d.gdop, q }; }
    if (!pick) break;
    used.push(pick.q);
  }
  used.sort(byAz);
  return n === 3 ? used.slice(0, 3) : used;
}

// ── Shaders: a soft blue rim of atmosphere, and glassy distance spheres ──
const glowMaterial = () => new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color('#5aa9ff') } },
  vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 color; varying vec3 vN; void main(){ float i = pow(clamp(0.78 - dot(vN, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 3.0); gl_FragColor = vec4(color, i * 1.1); }',
  side: THREE.BackSide, transparent: true, depthWrite: false,
});
const glassMaterial = (color) => new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: 0 } },
  vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
  fragmentShader: 'uniform vec3 color; uniform float opacity; varying vec3 vN; varying vec3 vV; void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); gl_FragColor = vec4(color, opacity * (0.035 + 0.6 * pow(f, 3.0))); }',
  side: THREE.DoubleSide, transparent: true, depthWrite: false,
});
function dotTexture(color) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  c.shadowColor = 'rgba(0,0,0,0.3)'; c.shadowBlur = 10; c.shadowOffsetY = 2;
  c.fillStyle = '#ffffff'; c.beginPath(); c.arc(64, 63, 28, 0, Math.PI * 2); c.fill();
  c.shadowColor = 'transparent';
  c.fillStyle = color; c.beginPath(); c.arc(64, 63, 20, 0, Math.PI * 2); c.fill();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createScene(canvas, { labelLayer, onReadout = () => {}, onPick = () => {} } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(34, 1, 0.02, 2000);
  camera.position.set(0, 6, 40);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.enablePan = false; controls.minDistance = 7.5; controls.maxDistance = 140; controls.enabled = false;
  const sunLight = new THREE.DirectionalLight(0xffffff, 2.1);
  scene.add(sunLight, new THREE.HemisphereLight(0xffffff, 0x8a9bb0, 0.7));

  // ── Earth: real imagery, a little cloud, and a blue rim of atmosphere ──
  const earth = new THREE.Group();
  const earthMat = new THREE.MeshStandardMaterial({ color: 0x5b8fc4, roughness: 0.85, metalness: 0 });
  earth.add(new THREE.Mesh(new THREE.SphereGeometry(R, 128, 96), earthMat));
  const cloudMat = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0, depthWrite: false, roughness: 1 });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(R * 1.008, 96, 72), cloudMat);
  earth.add(clouds);
  earth.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.07, 96, 72), glowMaterial()));
  scene.add(earth);
  const loader = new THREE.TextureLoader();
  const sharp = Math.min(window.innerWidth, window.innerHeight) > 700;   // big screens get the sharper imagery
  loader.load(`${TEX}earth_atmos_${sharp ? 4096 : 2048}.jpg`, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; earthMat.map = t; earthMat.color.set(0xffffff); earthMat.needsUpdate = true; });
  loader.load(`${TEX}earth_normal_2048.jpg`, (t) => { earthMat.normalMap = t; earthMat.normalScale.set(0.5, 0.5); earthMat.needsUpdate = true; });
  loader.load(`${TEX}earth_clouds_${sharp ? 2048 : 1024}.png`, (t) => { t.colorSpace = THREE.SRGBColorSpace; cloudMat.map = t; cloudMat.opacity = 0.35; cloudMat.needsUpdate = true; });

  // ── Satellites: gold body (tinted in its colour when in use), dark solar panels ──
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x1c2b4f, metalness: 0.55, roughness: 0.22 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, metalness: 0.2, roughness: 0.4 });
  const sats = CONST.map(() => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.55), new THREE.MeshStandardMaterial({ color: 0xd8a84a, metalness: 0.9, roughness: 0.32 }));
    g.add(body);
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.025, 0.4), panelMat); p.position.x = sx * 0.74; g.add(p); }
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.13, 0.18, 20), whiteMat);
    dish.rotation.x = Math.PI / 2; dish.position.z = 0.36;        // lookAt() points +z at the Earth
    g.add(dish);
    g.userData.body = body;
    g.visible = false;
    scene.add(g);
    return g;
  });
  const lineMats = [];
  const fat = (color, width, opts = {}) => { const m = new LineMaterial({ color, linewidth: width, transparent: true, opacity: 0, ...opts }); lineMats.push(m); return m; };
  const orbitMat = fat(0x9aa3ae, 1);
  const orbits = [];
  for (let p = 0; p < 6; p++) {
    const pts = [];
    for (let k = 0; k <= 180; k++) { const v = toV(satPos({ raan: p * 60 * DEG, u0: 0 }, (k / 180) * PERIOD)); pts.push(v.x, v.y, v.z); }
    const geo = new LineGeometry(); geo.setPositions(pts);
    const l = new Line2(geo, orbitMat); l.visible = false; scene.add(l); orbits.push(l);
  }

  // ── You, the phone's answer, the signal ──
  const spriteOf = (color, size, order) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(color), depthTest: false, sizeAttenuation: false, transparent: true })); s.scale.set(size, size, 1); s.renderOrder = order; scene.add(s); return s; };
  const youDot = spriteOf('#0a84ff', 0.045, 8);
  const veil = makeVeil(7.9);          // the haze the Earth comes out of (under the blue dot)
  scene.add(veil.mesh);
  const ansDot = spriteOf(ORANGE, 0.04, 9);
  const pulse = spriteOf('#ffcc00', 0.03, 7);

  // ── Lines and spheres ──
  const sight = SAT_COLORS.map((c) => { const l = new Line2(new LineGeometry(), fat(c, 1.6)); l.visible = false; scene.add(l); return l; });
  const arcs = Array.from({ length: 6 }, () => { const l = new Line2(new LineGeometry(), fat(0x2c2c2e, 2.2, { depthTest: false })); l.renderOrder = 6; l.visible = false; scene.add(l); return l; });
  const sphereGeo = new THREE.SphereGeometry(1, 96, 64);
  const spheres = SAT_COLORS.slice(0, 4).map((c) => { const m = new THREE.Mesh(sphereGeo, glassMaterial(c)); m.visible = false; scene.add(m); return m; });
  const curveMat = new THREE.MeshStandardMaterial({ color: ORANGE, emissive: ORANGE, emissiveIntensity: 0.35, transparent: true, opacity: 0 });
  const curveGhostMat = new THREE.MeshBasicMaterial({ color: ORANGE, transparent: true, opacity: 0, depthTest: false });
  let curveGroup = null, curveFor = '';
  function setCurve(points, key) {
    if (key === curveFor) return;
    curveFor = key;
    if (curveGroup) { scene.remove(curveGroup); curveGroup.children[0].geometry.dispose(); curveGroup = null; }
    const pts = points.map((q) => toV(q.p)).filter((v) => v.length() < 26);
    if (pts.length < 4) return;
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.min(500, pts.length * 2), 0.024, 8, false);
    curveGroup = new THREE.Group();
    curveGroup.add(new THREE.Mesh(tube, curveMat));
    const ghost = new THREE.Mesh(tube, curveGhostMat); ghost.renderOrder = 4; curveGroup.add(ghost);
    scene.add(curveGroup);
  }

  // ── Labels: crisp HTML tags that follow points in the scene ──
  const tags = new Map();
  function showTag(key, text, pos, alpha = 1, { below = false, cls = '', always = false } = {}) {
    if (!tags.has(key)) { const el = document.createElement('div'); el.className = 'tag'; labelLayer.append(el); tags.set(key, { el, text: null, cls: null, pos: new THREE.Vector3() }); }
    const t = tags.get(key);
    if (t.text !== text) { t.el.textContent = text; t.text = text; }
    if (t.cls !== cls) { t.el.className = `tag ${cls}`; t.cls = cls; }
    t.pos.copy(pos); t.alpha = alpha; t.below = below; t.always = always; t.used = true;
  }
  const tmp = new THREE.Vector3(), rayD = new THREE.Vector3();
  function placeTags(fade) {
    for (const t of tags.values()) {
      const a = (t.used ? t.alpha : 0) * fade;
      t.used = false;
      if (a < 0.02) { t.el.style.opacity = 0; continue; }
      // hidden if the Earth is in the way
      rayD.subVectors(t.pos, camera.position);
      const L = rayD.length(); rayD.divideScalar(L);
      const b = camera.position.dot(rayD), c = camera.position.lengthSq() - (R * 0.99) ** 2;
      const disc = b * b - c;
      const hit = !t.always && disc > 0 && -b - Math.sqrt(disc) > 0 && -b - Math.sqrt(disc) < L - 0.05;
      tmp.copy(t.pos).project(camera);
      if (hit || tmp.z > 1) { t.el.style.opacity = 0; continue; }
      const x = (tmp.x * 0.5 + 0.5) * W, y = (-tmp.y * 0.5 + 0.5) * H;
      t.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, ${t.below ? '16px' : 'calc(-100% - 16px)'})`;
      t.el.style.opacity = a.toFixed(3);
    }
  }

  // ── The story's set-up: you, the four satellites that matter, and the rest ──
  const story = (() => {
    const P = llaToEcef(STORY_LAT, LON), B = enuBasis(STORY_LAT, LON);
    const positions = CONST.map((s) => satPos(s, STORY_T));
    const vis = skyOf(P, B, positions);
    const four = bestSet(vis, 4);
    const extras = vis.filter((q) => !four.includes(q));
    const geo = measure({ truePos: P, clockError: 0, sats: four.map((q) => ({ id: q.id, pos: q.pos })) });
    const curve = solutionCurve3D(geo[0], geo[1], geo[2], -4.5e6, 4.5e6, 700, [0, 0, 0]);
    // the direction the orange curve runs through you (so the camera can look at it side-on)
    const near = curve.reduce((a, q) => (Math.abs(q.bias) < Math.abs(a.bias) ? q : a));
    const step = curve.find((q) => q.bias > near.bias + 2e5) || curve[curve.length - 1];
    return { P, B, positions, four, extras, curve, along: toV(step.p).sub(toV(near.p)).normalize() };
  })();

  // ── Camera: where it is at each step of the story ──
  const KEYS = (() => {
    const you = toV(story.P), up = you.clone().normalize();
    const east = toDir(story.B.e), north = toDir(story.B.n);
    const s1 = toV(story.four[0].pos);
    const O = new THREE.Vector3();
    const around = (dist, u, e, n) => ({ target: O.clone(), pos: up.clone().multiplyScalar(u).add(east.clone().multiplyScalar(e)).add(north.clone().multiplyScalar(n)).normalize().multiplyScalar(dist) });
    const above = (h) => ({ target: you.clone(), pos: you.clone().add(up.clone().multiplyScalar(h)).add(north.clone().multiplyScalar(-h * 0.35)) });
    let close = up.clone().multiplyScalar(0.25).add(east.clone().multiplyScalar(0.8)).add(north.clone().multiplyScalar(-0.5)).normalize();
    close.sub(story.along.clone().multiplyScalar(close.dot(story.along))).normalize().add(up.clone().multiplyScalar(0.95)).normalize();
    const nearYou = (d) => ({ target: you.clone(), pos: you.clone().add(close.clone().multiplyScalar(d)) });
    const perp = new THREE.Vector3().subVectors(s1, you).cross(up).normalize();
    const mid = (f) => you.clone().lerp(s1, f);
    // far enough out to see the first three satellites and all three spheres meeting at you
    const first3 = story.four.slice(0, 3).reduce((a, q) => a.add(toV(q.pos)), new THREE.Vector3()).multiplyScalar(1 / 3);
    const wideT = you.clone().lerp(first3, 0.42);
    const wide = { target: wideT, pos: wideT.clone().add(perp.clone().add(up.clone().multiplyScalar(0.3)).normalize().multiplyScalar(56)), fit: true };
    return [
      [1.4, { ...above(0.35), tspan: [1.95, 2.4] }],                                                   // just above you, out of the city's haze; stays on you until 1.95
      [2.4, { ...around(25, 0.9, 0.32, -0.28), fit: true }],                                           // the whole Earth, you near the middle
      [3.4, around(80, 0.8, 0.45, -0.3)],                                                              // the constellation
      [4.4, { target: mid(0.5), pos: mid(0.5).add(perp.clone().multiplyScalar(40)).add(up.clone().multiplyScalar(12)) }],  // one satellite and you
      [5.4, { target: mid(0.3), pos: mid(0.3).add(perp.clone().multiplyScalar(70)).add(up.clone().multiplyScalar(18)) }], // its sphere
      [6.45, wide],                                                                                    // three spheres meet
      [7.4, nearYou(6.5)],                                                                             // a wrong clock
      [8.6, nearYou(6.5)],                                                                             // the fourth satellite
      [9.45, { ...around(54, 0.85, 0.4, -0.35), tspan: [9.45, 9.9] }],                                // many satellites; then centre on you
      [10.3, above(0.35)],                                                                             // back down to the car, into the haze
    ];
  })();
  const offA = new THREE.Vector3(), offB = new THREE.Vector3();
  // a portrait screen sees much less from side to side, so wide shots marked `fit` step further back
  const fitK = (k) => (k.fit && W < H ? Math.min(2, 0.95 * Math.sqrt((1.6 * H) / W)) : 1);
  function cameraAt(g, outPos, outTarget) {
    let i = 0;
    while (i < KEYS.length - 2 && g > KEYS[i + 1][0]) i++;
    const [ta, a] = KEYS[i], [tb, b] = KEYS[i + 1];
    const f = ramp(g, ta, tb);
    // the look-at point can move on its own timetable (tspan), e.g. stay on you while zooming out
    outTarget.lerpVectors(a.target, b.target, a.tspan ? ramp(g, a.tspan[0], a.tspan[1]) : f);
    // glide: blend the viewing direction and the zoom (distance on a log scale)
    offA.subVectors(a.pos, a.target); offB.subVectors(b.pos, b.target);
    const da = offA.length() * fitK(a), db = offB.length() * fitK(b);
    const dir = offA.normalize().lerp(offB.normalize(), f).normalize();
    outPos.copy(outTarget).add(dir.multiplyScalar(Math.exp(Math.log(da) + (Math.log(db) - Math.log(da)) * f)));
  }

  // ── The story at scroll position g ──
  function storyFrame(g) {
    const you = toV(story.P);
    const four = story.four;
    const trueClock = CLOCK_MS * ramp(g, 7.12, 7.75);           // the phone's clock drifts…
    const meas = measure({ truePos: story.P, clockError: trueClock / 1000, sats: four.map((q) => ({ id: q.id, pos: q.pos })) });
    const fix = solveFix(meas);
    const est = (fix.ok ? fix.clock : 0) * ramp(g, 8.15, 8.65);  // …and the fourth satellite lets it solve for it
    const hit = sphereIntersections(meas[0].sat, meas[0].pr - est, meas[1].sat, meas[1].pr - est, meas[2].sat, meas[2].pr - est);
    const answer = hit ? (norm(hit[0]) < norm(hit[1]) ? hit[0] : hit[1]) : story.P;
    const off = norm(sub(answer, story.P));

    // satellites: the whole constellation only while step 4 is on screen; then only the ones that matter
    const constA = band(g, 2.6, 3.0, 3.75, 4.1);
    const show = [ramp(g, 3.8, 4.15), ramp(g, 5.8, 6.05), ramp(g, 5.9, 6.15), ramp(g, 7.9, 8.15)];
    const extraA = band(g, 9.0, 9.3, 9.85, 10.1);
    const keep = 1 - ramp(g, 9.85, 10.1);
    const usedIdx = new Map(four.map((q, k) => [q.id, k]));
    const extraIds = new Set(story.extras.map((q) => q.id));
    CONST.forEach((c, i) => {
      const k = usedIdx.get(c.id);
      const a = Math.max(constA * 0.85, k !== undefined ? show[k] * keep : extraIds.has(c.id) ? extraA : 0);
      placeSat(i, story.positions[i], a, k !== undefined && show[k] > 0.2 ? SAT_COLORS[k] : null);
    });
    orbitMat.opacity = constA * 0.5;
    orbits.forEach((l) => { l.visible = constA > 0.01; });
    four.forEach((q, k) => { if (show[k] > 0.3) showTag(`s${k}`, `S${k + 1}`, toV(q.pos).add(toV(q.pos).normalize().multiplyScalar(0.9)), show[k] * (1 - ramp(g, 9.0, 9.3)), { cls: `c${k}` }); });

    // lines of sight
    sight.forEach((l, k) => {
      const q = k < 4 ? four[k] : story.extras[k - 4];
      const a = k < 4 ? show[k] * keep * (0.9 - 0.4 * ramp(g, 9.0, 9.3)) : (q ? extraA * 0.55 : 0);
      setLine(l, q ? [you, toV(q.pos)] : null, a);
    });

    // the signal travelling from S1 to you
    const pulseA = band(g, 4.05, 4.3, 4.85, 5.05);
    pulse.visible = pulseA > 0.01;
    if (pulse.visible) { pulse.position.lerpVectors(toV(four[0].pos), you, (performance.now() / 1600) % 1); pulse.material.opacity = pulseA; }

    // spheres grow out from each satellite until they reach you: the signal's trip
    const grow = [ramp(g, 5.05, 5.7), ramp(g, 6.05, 6.5), ramp(g, 6.15, 6.6), ramp(g, 7.95, 8.2)];
    const sphA = (1 - 0.72 * ramp(g, 6.4, 6.9)) * (1 - ramp(g, 8.95, 9.3));
    spheres.forEach((m, k) => {
      const r = ((meas[k].pr - est) / U) * grow[k];
      m.visible = grow[k] > 0.001 && sphA > 0.01;
      m.position.copy(toV(four[k].pos)); m.scale.setScalar(Math.max(r, 0.001));
      m.material.uniforms.opacity.value = sphA * (k === 0 && g < 6 ? 1.0 : 0.85);
    });
    if (g > 5.05 && g < 6.2) showTag('dist', fmtKm(meas[0].pr * grow[0]), you.clone().lerp(toV(four[0].pos), 0.5), ramp(g, 5.1, 5.3) * (1 - ramp(g, 5.95, 6.15)));

    // where pairs of spheres meet: lines through the answer
    const arcA = ramp(g, 6.4, 6.7) * (1 - ramp(g, 8.95, 9.25));
    const pairs = [[0, 1], [0, 2], [1, 2], [0, 3], [1, 3], [2, 3]];
    pairs.forEach(([i, j], n) => {
      const a = arcA * (j === 3 ? ramp(g, 8.05, 8.2) : 1) * Math.min(grow[i], grow[j]);
      setArc(arcs[n], meas[i].sat, meas[i].pr - est, meas[j].sat, meas[j].pr - est, answer, 2.4e6, a);
    });

    // the orange curve: every place that fits three signals
    const curveA = ramp(g, 7.2, 7.5) * (1 - ramp(g, 8.95, 9.25));
    curveMat.opacity = curveA; curveGhostMat.opacity = curveA * 0.3;
    if (curveGroup) curveGroup.visible = curveA > 0.01;

    // you and the phone's answer
    youDot.position.copy(you); youDot.material.opacity = 1;
    const ansA = ramp(g, 6.45, 6.7) * (1 - ramp(g, 9.0, 9.3));
    ansDot.visible = ansA > 0.01 && off > 2000;
    ansDot.position.copy(toV(answer)); ansDot.material.opacity = ansA;
    showTag('you', off <= 2000 && ansA > 0.5 ? 'You = phone’s answer' : 'You', you, ramp(g, 1.9, 2.2) * keep, { cls: 'blue' });
    if (ansDot.visible) showTag('ans', `phone’s answer · ${fmtKm(off)} off`, toV(answer), ansA, { below: true, cls: 'orange', always: true });

    onReadout({ mode: 'story', t1: meas[0].pr / C, d1: meas[0].pr, trueClockMs: trueClock, estMs: (est / C) * 1000, off });
  }

  // ── The lab ──
  const lab = { n: 4, clockMs: 0.3, noise: 0, iono: 0, lat: STORY_LAT, spheres: false, move: false, ids: null, t: STORY_T, seed: 1 };
  let labView = null;
  function labFrame() {
    const P = llaToEcef(lab.lat, LON), B = enuBasis(lab.lat, LON);
    const you = toV(P);
    const positions = CONST.map((s) => satPos(s, lab.t));
    const vis = skyOf(P, B, positions);
    let used;
    if (lab.ids) used = lab.ids.map((id) => vis.find((q) => q.id === id)).filter(Boolean);
    else used = bestSet(vis, lab.n);
    used.sort(byAz);
    labView = { vis, used };
    const g = gaussianSource(lab.seed);
    const extra = {};
    for (const q of used) extra[q.id] = lab.noise * g() + lab.iono * slantFactor(q.el);
    const meas = measure({ truePos: P, clockError: lab.clockMs / 1000, sats: used.map((q) => ({ id: q.id, pos: q.pos })), extra });
    let answer = null, fix = null, est = 0;
    if (meas.length >= 4) { fix = solveFix(meas); if (fix.ok) { answer = fix.pos; est = fix.clock; } }
    else if (meas.length === 3) {
      const hit = sphereIntersections(meas[0].sat, meas[0].pr, meas[1].sat, meas[1].pr, meas[2].sat, meas[2].pr);
      if (hit) answer = norm(hit[0]) < norm(hit[1]) ? hit[0] : hit[1];
      const b = (lab.clockMs / 1000) * C;
      setCurve(solutionCurve3D(meas[0], meas[1], meas[2], b - 4.5e6, b + 4.5e6, 600, [0, 0, 0]), meas.map((m) => `${m.id}:${Math.round(m.pr)}`).join('|'));
    }
    // only the satellites above your horizon: coloured if used, small and grey if not (click to add)
    const usedIdx = new Map(used.map((q, k) => [q.id, k]));
    const visIds = new Set(vis.map((q) => q.id));
    CONST.forEach((c, i) => {
      const k = usedIdx.get(c.id);
      placeSat(i, positions[i], k !== undefined ? 1 : visIds.has(c.id) ? 0.45 : 0, k !== undefined ? SAT_COLORS[k % SAT_COLORS.length] : null);
    });
    orbits.forEach((l) => { l.visible = false; });
    used.forEach((q, k) => showTag(`s${k}`, `S${k + 1}`, toV(q.pos).add(toV(q.pos).normalize().multiplyScalar(0.9)), 1, { cls: `c${k % 8}` }));
    sight.forEach((l, k) => setLine(l, used[k] ? [you, toV(used[k].pos)] : null, used[k] ? 0.75 : 0));
    spheres.forEach((m, k) => {
      m.visible = lab.spheres && k < meas.length && meas.length <= 4;
      if (m.visible) { m.position.copy(toV(meas[k].sat)); m.scale.setScalar((meas[k].pr - est) / U); m.material.uniforms.opacity.value = 0.6; }
    });
    const pairs = [[0, 1], [0, 2], [1, 2], [0, 3], [1, 3], [2, 3]];
    pairs.forEach(([i, j], n) => {
      const on = lab.spheres && meas.length <= 4 && meas[i] && meas[j];
      setArc(arcs[n], on ? meas[i].sat : null, on ? meas[i].pr - est : 0, on ? meas[j].sat : null, on ? meas[j].pr - est : 0, answer || P, 2.4e6, on ? 1 : 0);
    });
    curveMat.opacity = meas.length === 3 ? 1 : 0; curveGhostMat.opacity = meas.length === 3 ? 0.3 : 0;
    if (curveGroup) curveGroup.visible = meas.length === 3;
    pulse.visible = false;
    youDot.position.copy(you); youDot.material.opacity = 1;
    const off = answer ? norm(sub(answer, P)) : NaN;
    ansDot.visible = !!answer && off > 2000;
    if (answer) { ansDot.position.copy(toV(answer)); ansDot.material.opacity = 1; }
    showTag('you', answer && off <= 2000 ? 'You = phone’s answer' : 'You', you, 1, { cls: 'blue' });
    if (ansDot.visible) showTag('ans', `phone’s answer · ${fmtKm(off)} off`, toV(answer), 1, { below: true, cls: 'orange', always: true });
    const dop = meas.length >= 4 ? dopFromSky(used) : null;
    onReadout({ mode: 'lab', n: meas.length, visible: vis.length, off, foundMs: fix && fix.ok ? (fix.clock / C) * 1000 : undefined, pdop: dop && dop.ok ? dop.pdop : undefined, custom: !!lab.ids });
  }

  // Click a satellite in the lab to use it or drop it.
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let downAt = null;
  function satUnder(e) {
    const r = canvas.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hits = ray.intersectObjects(sats.filter((s) => s.visible), true);
    if (!hits.length) return null;
    let o = hits[0].object;
    while (o.parent && !sats.includes(o)) o = o.parent;
    return CONST[sats.indexOf(o)];
  }
  canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (mode !== 'lab' || !downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5 || !labView) return;
    const s = satUnder(e);
    if (!s) return;
    const ids = labView.used.map((q) => q.id);
    const has = ids.includes(s.id);
    lab.ids = has ? ids.filter((id) => id !== s.id) : [...ids, s.id];
    onPick(lab.ids.length);
  });
  canvas.addEventListener('pointermove', (e) => { if (mode === 'lab' && !e.buttons) canvas.style.cursor = satUnder(e) ? 'pointer' : ''; });

  // ── Drawing helpers ──
  function placeSat(i, pos, a, tint) {
    const g = sats[i];
    g.visible = a > 0.01;
    if (!g.visible) return;
    g.position.copy(toV(pos));
    g.lookAt(0, 0, 0);
    g.scale.setScalar(0.25 + 0.85 * a);
    const m = g.userData.body.material;
    m.emissive.set(tint || '#000000');
    m.emissiveIntensity = tint ? 0.55 : 0;
  }
  function setLine(l, pts, a) {
    l.visible = !!pts && a > 0.01;
    l.material.opacity = a;
    if (!l.visible) return;
    const k = `${pts[0].x.toFixed(3)},${pts[0].y.toFixed(3)},${pts[1].x.toFixed(3)},${pts[1].y.toFixed(3)}`;
    if (l.userData.k !== k) { l.userData.k = k; l.geometry.dispose(); l.geometry = new LineGeometry(); l.geometry.setPositions([pts[0].x, pts[0].y, pts[0].z, pts[1].x, pts[1].y, pts[1].z]); }
  }
  // The part of the circle where two spheres meet that lies near `focus`.
  function setArc(line, c1, r1, c2, r2, focus, span, a) {
    line.visible = false;
    line.material.opacity = a;
    if (!c1 || a < 0.01) return;
    const d = sub(c2, c1), dist = norm(d);
    const x = (r1 * r1 - r2 * r2 + dist * dist) / (2 * dist);
    const h2 = r1 * r1 - x * x;
    if (h2 <= 0 || !(dist > 0)) return;
    const h = Math.sqrt(h2), e = d.map((v) => v / dist);
    const centre = c1.map((v, i) => v + x * e[i]);
    let f = sub(focus, centre);
    const al = f[0] * e[0] + f[1] * e[1] + f[2] * e[2];
    f = f.map((v, i) => v - al * e[i]);
    const fn = norm(f) || 1;
    const u = f.map((v) => v / fn);
    const w = [e[1] * u[2] - e[2] * u[1], e[2] * u[0] - e[0] * u[2], e[0] * u[1] - e[1] * u[0]];
    const half = Math.min(Math.PI, span / h), N = 96, arr = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) {
      const th = -half + (2 * half * k) / (N - 1);
      const p = centre.map((v, i) => v + h * (Math.cos(th) * u[i] + Math.sin(th) * w[i]));
      arr[3 * k] = p[0] / U; arr[3 * k + 1] = p[2] / U; arr[3 * k + 2] = -p[1] / U;
    }
    line.geometry.dispose();
    line.geometry = new LineGeometry();
    line.geometry.setPositions(arr);
    line.visible = true;
  }

  // ── Size ──
  let W = 1, H = 1, mode = 'intro';
  function applyOffset() {
    const wide = W > 820;
    let dx = 0, dy = 0;
    if (mode === 'story') { if (wide) dx = -Math.min(230, W * 0.15); else dy = H * 0.16; }
    if (mode === 'lab') { if (wide) dx = Math.min(210, W * 0.15); else dy = H * 0.24; }
    if (dx || dy) camera.setViewOffset(W, H, dx, dy, W, H); else camera.clearViewOffset();
  }
  function resize() {
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    applyOffset();
    for (const m of lineMats) m.resolution.set(W, H);
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // ── One frame (called by the page's animation loop) ──
  let g = 0, alpha = 0, veilA = 0, last = performance.now(), fly = null, lastSeed = 0;
  const goalPos = new THREE.Vector3(), goalTarget = new THREE.Vector3(), look = new THREE.Vector3();
  setCurve(story.curve, 'story');
  function tick(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    clouds.rotation.y += dt * 0.004;
    if (alpha < 0.003) { placeTags(0); return; }
    if (mode === 'story') {
      storyFrame(g);
      cameraAt(g, goalPos, goalTarget);
      camera.position.copy(goalPos);
      look.copy(goalTarget);
      camera.lookAt(look);
    } else if (mode === 'lab') {
      if (lab.move) { lab.t += dt; if (lab.noise > 0 && now - lastSeed > 300) { lab.seed++; lastSeed = now; } }
      labFrame();
      if (fly) {
        const f = Math.min(1, (now - fly.t0) / 1000), e = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
        camera.position.lerpVectors(fly.from, fly.to, e);
        controls.target.lerpVectors(fly.fromT, fly.toT, e);
        if (f >= 1) fly = null;
      }
      controls.update();
    }
    sunLight.position.copy(camera.position).add(new THREE.Vector3(18, 26, 10));
    veil.set(mode === 'story' ? veilA : 0);
    placeTags(mode === 'story' ? clamp01((alpha - 0.5) * 2) * (1 - veilA) : 1);
    renderer.render(scene, camera);
  }
  // Lab views: from space (you and every satellite you can hear), or close to you.
  function labPose(which) {
    const P = llaToEcef(lab.lat, LON), B = enuBasis(lab.lat, LON);
    const you = toV(P), up = you.clone().normalize(), east = toDir(B.e), north = toDir(B.n);
    if (which === 'you') return { pos: you.clone().add(up.clone().multiplyScalar(5).add(east.clone().multiplyScalar(3)).add(north.clone().multiplyScalar(-2.5))), target: you.clone() };
    return { pos: up.clone().add(east.clone().multiplyScalar(0.5)).add(north.clone().multiplyScalar(-0.4)).normalize().multiplyScalar(82), target: you.clone().multiplyScalar(0.9) };
  }
  function labCamera(which) {
    const p = labPose(which);
    fly = { from: camera.position.clone(), to: p.pos, fromT: controls.target.clone(), toT: p.target, t0: performance.now() };
  }

  return {
    tick,
    setStory(gg, a, v = 0) {
      if (mode !== 'story') {
        if (mode === 'lab') setCurve(story.curve, 'story');
        mode = 'story'; controls.enabled = false; applyOffset();
      }
      g = gg; alpha = a; veilA = v;
    },
    setLab(params = {}) {
      if (mode !== 'lab') {
        mode = 'lab'; alpha = 1;
        controls.enabled = true;
        const p = labPose('space');
        controls.target.copy(p.target);
        camera.position.copy(p.pos);
        applyOffset();
      }
      if ('n' in params) lab.ids = null;
      Object.assign(lab, params);
    },
    labCamera,
  };
}

function fmtKm(m) {
  const km = m / 1000;
  return `${km >= 100 ? Math.round(km).toLocaleString('en-GB') : km.toFixed(1)} km`;
}
