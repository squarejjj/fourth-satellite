// The 3-D world. Three.js only DRAWS it. Every satellite position, measurement and answer
// comes from our own code: world.js makes the measurements, receiver.js solves them.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
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

const U = 1e6;                                         // 1 scene unit = 1,000 km
const R = 6.371;                                       // Earth's radius in scene units
const toV = (p) => new THREE.Vector3(p[0] / U, p[2] / U, -p[1] / U); // ECEF metres → scene (y = north pole)
const toDir = (d) => new THREE.Vector3(d[0], d[2], -d[1]);
const DEG = Math.PI / 180;
const BG = 0xf4f6f8;
export const SAT_COLORS = ['#2563eb', '#db2777', '#7c3aed', '#059669', '#ca8a04', '#0891b2', '#9333ea', '#65a30d', '#e11d48', '#0d9488'];
const ORANGE = '#f97316';
const INK = '#1d1d1f';
const LON = 127, STORY_LAT = 37.5, MASK = 10, CLOCK_MS = 1;
// "?still" in the address: move the camera instantly instead of gliding (for screenshots and slow devices).
const STILL = new URLSearchParams(location.search).has('still') || matchMedia('(prefers-reduced-motion: reduce)').matches;

// The GPS constellation, simplified: 24 satellites in 6 orbit planes tilted 55°.
const PERIOD = 60;                                     // seconds per orbit on screen (real: about 12 hours)
const CONST = [];
for (let p = 0; p < 6; p++) for (let s = 0; s < 4; s++) CONST.push({ id: p * 4 + s + 1, raan: p * 60 * DEG, u0: (s * 90 + p * 15) * DEG });
function satPos(sat, t) {
  const u = sat.u0 + (2 * Math.PI * t) / PERIOD, i = 55 * DEG;
  const cu = Math.cos(u), su = Math.sin(u), cO = Math.cos(sat.raan), sO = Math.sin(sat.raan);
  return [R_GPS * (cu * cO - su * Math.cos(i) * sO), R_GPS * (cu * sO + su * Math.cos(i) * cO), R_GPS * su * Math.sin(i)];
}

// Smooth value noise, used only to colour the blocks of the generated world.
function makeNoise(seed) {
  const hash = (x, y, z) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177) ^ Math.imul(seed, 1103515245);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const sm = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const vn = (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = sm(x - xi), yf = sm(y - yi), zf = sm(z - zi);
    const c = (a, b, d) => hash(xi + a, yi + b, zi + d);
    return lerp(lerp(lerp(c(0, 0, 0), c(1, 0, 0), xf), lerp(c(0, 1, 0), c(1, 1, 0), xf), yf),
      lerp(lerp(c(0, 0, 1), c(1, 0, 1), xf), lerp(c(0, 1, 1), c(1, 1, 1), xf), yf), zf);
  };
  return (x, y, z) => {
    let s = 0, a = 0.5, f = 1;
    for (let o = 0; o < 4; o++) { s += a * vn(x * f + o * 7.3, y * f + o * 3.1, z * f + o * 5.7); f *= 2; a *= 0.5; }
    return s;
  };
}

export function createScene(canvas, { onReadout = () => {} } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.02, 2000);
  camera.position.set(14, 18, 60);
  const look = new THREE.Vector3();
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 1.5;
  controls.maxDistance = 170;
  controls.enabled = false;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa6b2, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(30, 45, 40);
  scene.add(sun);

  // ── The generated world: about 5,000 blocks, each 320 km across ──
  const world = new THREE.Group();
  scene.add(world);
  let blocks = null, cells = [], genStart = null;
  function buildWorld(seed) {
    world.clear();
    const s = 0.32, n = Math.ceil(R / s) + 1, noise = makeNoise(seed);
    cells = [];
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) {
      const x = i * s, y = j * s, z = k * s, r = Math.hypot(x, y, z);
      if (r > R || r <= R - s) continue;
      cells.push({ x, y, z, lat: Math.asin(y / r) / DEG, v: noise(x / r * 1.8 + 11, y / r * 1.8, z / r * 1.8) });
    }
    // colour by rank, so every world has the same share of sea and land
    const sorted = cells.map((c) => c.v).sort((a, b) => a - b);
    const q = (f) => sorted[Math.floor(f * (sorted.length - 1))];
    const t = [q(0.42), q(0.6), q(0.64), q(0.86), q(0.95)];
    const pal = { deep: 0x2f6fb3, sea: 0x4a90d9, sand: 0xe3d391, grass: 0x6bb04a, forest: 0x3f8a3a, stone: 0x8d8f8a, ice: 0xf1f5f8 };
    const geo = new THREE.BoxGeometry(s, s, s);
    blocks = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), cells.length);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    cells.forEach((c, i) => {
      const key = Math.abs(c.lat) > 74 - c.v * 10 ? 'ice' : c.v < t[0] ? 'deep' : c.v < t[1] ? 'sea' : c.v < t[2] ? 'sand' : c.v < t[3] ? 'grass' : c.v < t[4] ? 'forest' : 'stone';
      col.setHex(pal[key]).offsetHSL(0, 0, ((i * 7919) % 13) / 200 - 0.03);
      blocks.setColorAt(i, col);
      c.delay = 0.5 - c.y / (2 * R) + ((i * 104729) % 97) / 600; // sweep from the north pole down
      m.makeScale(0.0001, 0.0001, 0.0001).setPosition(c.x, c.y, c.z);
      blocks.setMatrixAt(i, m);
    });
    world.add(blocks);
    const core = new THREE.Mesh(new THREE.SphereGeometry(R - s * 0.9, 48, 32), new THREE.MeshLambertMaterial({ color: 0x2c5f99 }));
    world.add(core);
    core.visible = false;
    world.userData.core = core;
  }
  function animateWorld(now) {
    if (genStart === null || !blocks) return;
    const tt = (now - genStart) / 1000;
    const m = new THREE.Matrix4();
    let done = true;
    cells.forEach((c, i) => {
      const f = Math.min(1, Math.max(0, (tt - c.delay * 1.3) / 0.35));
      if (f < 1) done = false;
      const k = f <= 0 ? 0.0001 : Math.min(1, f * 1.4) * (1 + 0.25 * Math.sin(f * Math.PI) * (1 - f)); // pop in, with a little bounce
      m.makeScale(k, k, k).setPosition(c.x, c.y, c.z);
      blocks.setMatrixAt(i, m);
    });
    blocks.instanceMatrix.needsUpdate = true;
    if (tt > 0.4) world.userData.core.visible = true;
    if (done) genStart = null;
  }

  // ── Orbits and satellite models ──
  const orbits = new THREE.Group();
  for (let p = 0; p < 6; p++) {
    const pts = [];
    for (let k = 0; k <= 160; k++) pts.push(toV(satPos({ raan: p * 60 * DEG, u0: 0 }, (k / 160) * PERIOD)));
    orbits.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x9aa3ad, transparent: true, opacity: 0.55 })));
  }
  scene.add(orbits);
  const gold = new THREE.MeshLambertMaterial({ color: 0xf2c14e }), blue = new THREE.MeshLambertMaterial({ color: 0x2f5bd3 }), grey = new THREE.MeshLambertMaterial({ color: 0x7b8086 });
  const sats = CONST.map(() => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.62), gold.clone());
    g.add(body);
    for (const sx of [-1, 1]) { const pnl = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 0.44), blue); pnl.position.x = sx * 0.8; g.add(pnl); }
    const ant = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.24), grey);
    ant.position.z = 0.42;                                  // lookAt() points +z at the Earth
    g.add(ant);
    const label = makeLabel();
    label.position.y = 0.95;
    g.add(label);
    g.userData = { body, label };
    scene.add(g);
    return g;
  });

  // ── You, and the receiver's answer ──
  const you = new THREE.Group();
  const youCube = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), new THREE.MeshBasicMaterial({ color: INK }));
  you.add(youCube);
  const youLabel = makeLabel('You', INK);
  you.add(youLabel);
  scene.add(you);
  const answer = new THREE.Group();
  answer.add(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15), new THREE.MeshBasicMaterial({ color: ORANGE, depthTest: false })));
  const answerLabel = makeLabel('', ORANGE);
  answer.add(answerLabel);
  answer.children[0].renderOrder = 6;
  scene.add(answer);
  const pulse = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
  scene.add(pulse);
  const distLabel = makeLabel('', INK);
  scene.add(distLabel);

  // ── Things redrawn as the state changes ──
  const sphereGeo = new THREE.SphereGeometry(1, 64, 48);
  const wireGeo = new THREE.WireframeGeometry(new THREE.SphereGeometry(1, 28, 18));
  const spheres = SAT_COLORS.map((c) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide })));
    g.add(new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.16, depthWrite: false })));
    g.visible = false;
    scene.add(g);
    return g;
  });
  const sightLines = SAT_COLORS.map((c) => {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: c }));
    l.frustumCulled = false; l.visible = false; scene.add(l); return l;
  });
  const ARC_N = 129;
  const arcMat = new LineMaterial({ color: 0x1d1d1f, linewidth: 2.5, transparent: true, opacity: 0.85, depthTest: false });
  const arcs = Array.from({ length: 10 }, () => {
    const l = new Line2(new LineGeometry(), arcMat);
    l.renderOrder = 5;
    l.frustumCulled = false; l.visible = false; scene.add(l); return l;
  });
  let curveMesh = null;
  const curveMat = new THREE.MeshBasicMaterial({ color: ORANGE });
  const curveGhost = new THREE.MeshBasicMaterial({ color: ORANGE, transparent: true, opacity: 0.3, depthTest: false });

  // ── State ──
  const st = {
    mode: 'intro', step: 0, prog: 0, t: 6, ids: [], idsFor: null,
    lab: { n: 4, clockMs: 0.3, noise: 0, iono: 0, lat: STORY_LAT, spheres: true, move: true },
    seed: 1, noiseSeed: 1,
  };
  world.visible = false;

  function pickSatellites(P, B, positions, n) {
    const vis = CONST.map((s, i) => {
      const [e, nn, u] = ecefToEnu(sub(positions[i], P), B);
      const r = Math.hypot(e, nn, u);
      return { id: s.id, pos: positions[i], az: ((Math.atan2(e, nn) / DEG) + 360) % 360, el: Math.asin(u / r) / DEG };
    }).filter((q) => q.el > MASK);
    const key = `${n}`;
    if (st.idsFor === key && st.ids.length && st.ids.every((id) => vis.some((q) => q.id === id))) {
      return { vis, used: st.ids.map((id) => vis.find((q) => q.id === id)) };
    }
    let used;
    if (n === 'all' || n >= vis.length) used = vis.slice();
    else {
      // the 4 visible satellites with the best geometry (lowest GDOP), then add the best extras
      let best = null;
      const rec = (start, acc) => {
        if (acc.length === 4) { const d = dopFromSky(acc); if (d.ok && (!best || d.gdop < best.g)) best = { g: d.gdop, set: [...acc] }; return; }
        for (let i = start; i < vis.length; i++) { acc.push(vis[i]); rec(i + 1, acc); acc.pop(); }
      };
      rec(0, []);
      used = best ? best.set : vis.slice(0, 4);
      while (used.length < n) {
        let pick = null;
        for (const q of vis) if (!used.includes(q)) { const d = dopFromSky([...used, q]); if (d.ok && (!pick || d.gdop < pick.g)) pick = { g: d.gdop, q }; }
        if (!pick) break;
        used.push(pick.q);
      }
      used.sort((a, b) => a.az - b.az);
      if (n === 3) used = used.slice(0, 3);
    }
    st.ids = used.map((q) => q.id);
    st.idsFor = key;
    return { vis, used };
  }

  // Everything the picture and the text need, for the current mode/step.
  function compute() {
    const lat = st.mode === 'lab' ? st.lab.lat : STORY_LAT;
    const P = llaToEcef(lat, LON), B = enuBasis(lat, LON);
    const positions = CONST.map((s) => satPos(s, st.t));
    const out = { P, B, positions, lat };
    let n, trueClockMs = 0, correction = 1, extra = {};
    if (st.mode === 'lab') {
      n = st.lab.n;
      trueClockMs = st.lab.clockMs;
    } else {
      const s = st.step, p = st.prog;
      const ramp = (x) => { const v = Math.min(1, Math.max(0, (x - 0.12) / 0.66)); return v * v * (3 - 2 * v); };
      n = s <= 1 ? 0 : s <= 3 ? 1 : s <= 5 ? 3 : s === 6 ? 4 : 'all';
      trueClockMs = s < 5 ? 0 : s === 5 ? CLOCK_MS * ramp(p) : CLOCK_MS;
      correction = s < 6 ? 0 : s === 6 ? ramp(p) : 1;
    }
    out.trueClockMs = trueClockMs;
    if (n === 0) { out.vis = []; out.used = []; out.meas = []; return out; }
    // in the story the first satellite chosen for steps 2–3 is S1 of the four
    const pickN = n === 'all' ? 'all' : st.mode === 'lab' ? n : Math.max(4, n);
    const { vis, used: chosen } = pickSatellites(P, B, positions, pickN);
    const used = n === 'all' || st.mode === 'lab' ? chosen : chosen.slice(0, n);
    out.vis = vis; out.used = used;
    if (st.mode === 'lab') {
      const g = gaussianSource(st.noiseSeed);
      for (const q of used) extra[q.id] = st.lab.noise * g() + st.lab.iono * slantFactor(q.el);
    }
    const meas = measure({ truePos: P, clockError: trueClockMs / 1000, sats: used.map((q) => ({ id: q.id, pos: q.pos })), extra });
    out.meas = meas;
    if (meas.length >= 4) {
      const fix = solveFix(meas);
      out.fix = fix;
      out.solvedClock = fix.ok ? fix.clock : 0;
    }
    // The receiver's current clock estimate (metres of range). In step 6 of the story we show it being
    // adjusted from 0 to the solved value; everywhere else it is the solver's answer (or 0 with 3 satellites).
    const est = meas.length >= 4 ? (out.solvedClock ?? 0) * correction : 0;
    out.est = est;
    if (meas.length === 3 || (st.mode === 'story' && st.step === 6)) {
      const m = meas.slice(0, 3);
      const hit = sphereIntersections(m[0].sat, m[0].pr - est, m[1].sat, m[1].pr - est, m[2].sat, m[2].pr - est);
      out.answer = hit ? (norm(hit[0]) < norm(hit[1]) ? hit[0] : hit[1]) : null;
      out.curveFor = m;
    } else if (out.fix && out.fix.ok) out.answer = out.fix.pos;
    if (meas.length === 1) out.answer = null;
    if (out.answer) out.off = norm(sub(out.answer, P));
    if (meas.length >= 4) out.dop = dopFromSky(used);
    return out;
  }

  // ── Drawing the computed state ──
  let curveKey = '', curveBuilt = 0;
  function draw(o) {
    const story = st.mode === 'story', s = st.step;
    const youV = toV(o.P);
    you.position.copy(youV.clone().multiplyScalar((R + 0.26) / R)); // sit on top of the blocks
    you.visible = st.mode !== 'intro';
    const showSats = st.mode === 'lab' || (story && s >= 1);
    orbits.visible = showSats && !(story && s >= 4 && s <= 6);
    const usedIdx = new Map(o.used ? o.used.map((q, k) => [q.id, k]) : []);
    CONST.forEach((c, i) => {
      const g = sats[i];
      g.visible = showSats;
      g.position.copy(toV(o.positions[i]));
      g.lookAt(0, 0, 0);
      const k = usedIdx.get(c.id);
      g.userData.body.material.color.set(k === undefined ? 0xf2c14e : SAT_COLORS[k]);
      g.scale.setScalar(k === undefined ? 0.8 : 1.2);
      setLabel(g.userData.label, k === undefined ? '' : `S${k + 1}`, k === undefined ? INK : SAT_COLORS[k]);
    });
    // lines of sight
    sightLines.forEach((l, k) => {
      const q = o.used && o.used[k];
      l.visible = !!q;
      if (q) { l.geometry.attributes.position.setXYZ(0, youV.x, youV.y, youV.z); const sv = toV(q.pos); l.geometry.attributes.position.setXYZ(1, sv.x, sv.y, sv.z); l.geometry.attributes.position.needsUpdate = true; }
    });
    // spheres of distance, corrected by the receiver's clock estimate
    const nSph = story ? (s === 3 ? 1 : s === 4 || s === 5 ? 3 : s === 6 ? 4 : 0) : st.lab.spheres && o.meas.length <= 6 ? o.meas.length : 0;
    spheres.forEach((g, k) => {
      const m = o.meas && o.meas[k];
      g.visible = k < nSph && !!m;
      if (g.visible) { g.position.copy(toV(m.sat)); g.scale.setScalar((m.pr - o.est) / U); g.children[0].material.opacity = story && s === 3 ? 0.12 : 0.07; }
    });
    // where pairs of spheres meet: arcs near the answer
    const showArcs = story ? s >= 4 && s <= 6 : o.meas.length <= 5 && st.lab.spheres;
    let a = 0;
    const focus = o.answer || o.P;
    if (showArcs && o.meas.length >= 2) {
      const ms = o.meas.slice(0, story ? (s === 6 ? 4 : 3) : 5);
      for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
        if (a >= arcs.length) break;
        if (setArc(arcs[a], ms[i].sat, ms[i].pr - o.est, ms[j].sat, ms[j].pr - o.est, focus, 2.6e6)) a++;
      }
    }
    arcs.forEach((l, k) => { l.visible = k < a; });
    // the curve of every place that fits three satellites (one point per clock guess)
    const showCurve = story ? s === 5 || s === 6 : o.meas.length === 3;
    if (showCurve && o.curveFor) {
      const key = o.curveFor.map((m) => `${m.id}:${Math.round(m.sat[0])}:${Math.round(m.pr - (o.trueClockMs / 1000) * C)}`).join('|');
      if (key !== curveKey && performance.now() - curveBuilt > 160) {
        curveKey = key;
        curveBuilt = performance.now();
        if (curveMesh) { scene.remove(curveMesh); curveMesh.geometry.dispose(); }
        const [m1, m2, m3] = o.curveFor;
        const b = (o.trueClockMs / 1000) * C;
        const pts = solutionCurve3D(m1, m2, m3, b - 4.5e6, b + 4.5e6, 600, [0, 0, 0]).map((q) => toV(q.p)).filter((v) => v.length() < 28);
        if (pts.length > 4) {
          const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.min(600, pts.length * 2), 0.028, 6, false);
          curveMesh = new THREE.Group();
          curveMesh.add(new THREE.Mesh(tube, curveMat));
          const ghost = new THREE.Mesh(tube, curveGhost); ghost.renderOrder = 4; curveMesh.add(ghost);
          curveMesh.geometry = tube;
          scene.add(curveMesh);
        } else curveMesh = null;
      }
      if (curveMesh) curveMesh.visible = true;
    } else if (curveMesh) curveMesh.visible = false;
    // the answer
    const showAnswer = !!o.answer && (story ? s >= 4 : true);
    answer.visible = showAnswer;
    if (showAnswer) {
      answer.position.copy(toV(o.answer));
      setLabel(answerLabel, o.off > 2000 ? `phone’s answer · ${fmtKm(o.off)} off` : '', ORANGE);
      answerLabel.position.set(0, 0, 0);
    }
    setLabel(youLabel, answer.visible && o.off <= 2000 ? 'You = phone’s answer' : 'You', INK);
    // the signal pulse and the distance label (steps 2–3)
    const q1 = o.used && o.used[0];
    pulse.visible = story && s === 2 && !!q1;
    distLabel.visible = story && s === 3 && !!q1;
    if (q1 && (pulse.visible || distLabel.visible)) {
      const sv = toV(q1.pos);
      if (pulse.visible) { const f = (performance.now() / 1400) % 1; pulse.position.lerpVectors(sv, youV, f); }
      if (distLabel.visible) { distLabel.position.lerpVectors(sv, youV, 0.5); setLabel(distLabel, fmtKm(o.meas[0].pr), INK); }
    }
  }

  // The part of the circle where two spheres meet that lies near `focus`.
  function setArc(line, c1, r1, c2, r2, focus, span) {
    const d = sub(c2, c1), dist = norm(d);
    if (dist === 0) return false;
    const a = (r1 * r1 - r2 * r2 + dist * dist) / (2 * dist);
    const h2 = r1 * r1 - a * a;
    if (h2 <= 0) return false;
    const h = Math.sqrt(h2), e = d.map((v) => v / dist);
    const centre = c1.map((v, i) => v + a * e[i]);
    let f = sub(focus, centre);
    const along = f[0] * e[0] + f[1] * e[1] + f[2] * e[2];
    f = f.map((v, i) => v - along * e[i]);
    let fn = norm(f);
    let u = fn > 1 ? f.map((v) => v / fn) : [e[1], -e[0], 0];
    if (fn <= 1) { const un = norm(u) || 1; u = u.map((v) => v / un); }
    const w = [e[1] * u[2] - e[2] * u[1], e[2] * u[0] - e[0] * u[2], e[0] * u[1] - e[1] * u[0]];
    const half = Math.min(Math.PI, span / h);
    const arr = new Float32Array(ARC_N * 3);
    for (let k = 0; k < ARC_N; k++) {
      const th = -half + (2 * half * k) / (ARC_N - 1);
      const p = centre.map((v, i) => v + h * (Math.cos(th) * u[i] + Math.sin(th) * w[i]));
      arr[3 * k] = p[0] / U; arr[3 * k + 1] = p[2] / U; arr[3 * k + 2] = -p[1] / U;
    }
    line.geometry.dispose();
    line.geometry = new LineGeometry();
    line.geometry.setPositions(arr);
    return true;
  }

  // ── Camera ──
  const goal = { pos: new THREE.Vector3(14, 18, 60), target: new THREE.Vector3() };
  function cameraGoal(o) {
    const youV = toV(o.P);
    const up = toDir(o.B.u), east = toDir(o.B.e), north = toDir(o.B.n);
    const s = st.step;
    if (st.mode === 'intro') { goal.target.set(0, 0, 0); goal.pos.set(Math.sin(performance.now() / 9000) * 34, 14, Math.cos(performance.now() / 9000) * 34); return; }
    if (s === 0) { goal.target.set(0, 0, 0); goal.pos.copy(youV.clone().normalize().multiplyScalar(30).add(east.clone().multiplyScalar(-8)).add(new THREE.Vector3(0, 6, 0))); return; }
    if (s === 1 || s >= 7) {
      const spin = s >= 7 ? performance.now() / 16000 : 0;
      goal.target.set(0, 0, 0);
      const d = youV.clone().normalize().multiplyScalar(s >= 7 ? 58 : 78);
      goal.pos.copy(d.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.5 + spin).add(new THREE.Vector3(0, 22, 0)));
      return;
    }
    const q1 = o.used && o.used[0];
    if ((s === 2 || s === 3) && q1) {
      const sv = toV(q1.pos);
      goal.target.copy(youV.clone().lerp(sv, s === 2 ? 0.45 : 0.3));
      const side = new THREE.Vector3().subVectors(sv, youV).cross(up).normalize();
      const back = s === 2 ? 30 : 58;
      goal.pos.copy(goal.target.clone().add(side.multiplyScalar(back)).add(up.clone().multiplyScalar(back * 0.35)));
      return;
    }
    // close-up around you and the phone's answer
    const focus = o.answer ? youV.clone().lerp(toV(o.answer), 0.5) : youV.clone();
    const sep = o.answer ? youV.distanceTo(toV(o.answer)) : 0;
    const dist = Math.min(16, Math.max(W > 820 ? 7.5 : 9.5, sep * 3.2));
    // look at the gap between you and the answer side-on, so it isn't foreshortened
    let dir = up.clone().multiplyScalar(0.55).add(east.clone().multiplyScalar(0.7)).add(north.clone().multiplyScalar(-0.45)).normalize();
    if (sep > 0.02) {
      const d = toV(o.answer).sub(youV).normalize();
      dir.sub(d.multiplyScalar(dir.dot(d))).normalize().add(up.clone().multiplyScalar(0.3)).normalize();
    }
    goal.target.copy(focus);
    goal.pos.copy(focus.clone().add(dir.multiplyScalar(dist)));
  }

  // Keep the model clear of the text panel (left on wide screens, bottom on narrow ones).
  let W = 1, H = 1;
  function applyOffset() {
    const wide = W > 820;
    let dx = 0, dy = 0;
    if (st.mode === 'story') { if (wide) dx = -Math.min(230, W * 0.15); else dy = H * 0.17; }
    if (st.mode === 'lab') { if (wide) dx = Math.min(190, W * 0.13); else dy = H * 0.2; }
    if (dx || dy) camera.setViewOffset(W, H, dx, dy, W, H); else camera.clearViewOffset();
  }
  function resize() {
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    renderer.setSize(W, H, false);
    arcMat.resolution.set(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    applyOffset();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // ── Loop ──
  let last = performance.now(), lastReseed = 0, lastReadout = 0, dirty = true, cur = null;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const moving = (st.mode === 'story' && st.step <= 1) || (st.mode === 'lab' && st.lab.move);
    if (moving && world.visible) { st.t += dt; dirty = true; }
    // moving satellites with noise: draw fresh noise a few times a second, so the answer jitters like a real fix
    if (st.mode === 'lab' && st.lab.move && st.lab.noise > 0 && now - lastReseed > 300) { st.noiseSeed++; lastReseed = now; }
    if (dirty || (st.mode === 'story' && st.step === 2)) {
      if (dirty) {
        cur = compute();
        dirty = false;
        if (now - lastReadout > 120 || !moving) { onReadout(readout(cur)); lastReadout = now; }
      }
      draw(cur);
    }
    animateWorld(now);
    if (cur) cameraGoal(cur);
    if (st.mode === 'lab') controls.update();
    else {
      const k = STILL ? 1 : 1 - Math.exp(-dt * 2.6);
      camera.position.lerp(goal.pos, k);
      look.lerp(goal.target, k);
      camera.lookAt(look);
    }
    flipLabels();
    renderer.render(scene, camera);
  }

  // Keep labels on screen: centre each label over (you) or under (the answer) its point,
  // nudged sideways if it would run off either edge.
  const tmpV = new THREE.Vector3();
  function flipLabels() {
    for (const [obj, label, below] of [[you, youLabel, false], [answer, answerLabel, true]]) {
      if (!obj.visible) continue;
      tmpV.setFromMatrixPosition(obj.matrixWorld).project(camera);
      const w = Math.max(1e-6, label.scale.x * camera.projectionMatrix.elements[0]); // on-screen width, in −1…1 units
      let left = tmpV.x - w / 2;
      left = Math.min(Math.max(left, -0.94), 0.9 - w);
      label.center.set((tmpV.x - left) / w, below ? 1.45 : -0.5);
    }
  }

  function readout(o) {
    const r = { mode: st.mode, step: st.step, n: o.meas ? o.meas.length : 0, trueClockMs: o.trueClockMs };
    if (o.meas && o.meas[0]) { r.t1 = o.meas[0].pr / C; r.d1 = o.meas[0].pr; }
    r.off = o.off;
    if (o.fix && o.fix.ok) { r.foundMs = (o.fix.clock / C) * 1000; r.fixErr = norm(sub(o.fix.pos, o.P)); r.iterations = o.fix.iterations.length - 1; }
    r.estMs = (o.est / C) * 1000;
    if (o.dop && o.dop.ok) r.pdop = o.dop.pdop;
    r.visible = o.vis ? o.vis.length : 0;
    return r;
  }

  // ── Labels drawn with the page's pixel font ──
  function makeLabel(text = '', color = INK) {
    const cv = document.createElement('canvas');
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
    sp.renderOrder = 10;
    sp.userData = { cv, tex, text: null, color: null };
    setLabel(sp, text, color);
    return sp;
  }
  function setLabel(sp, text, color) {
    if (sp.userData.text === text && sp.userData.color === color) return;
    sp.userData.text = text; sp.userData.color = color;
    const { cv } = sp.userData;
    const ctx = cv.getContext('2d');
    const font = '600 40px "Pixelify Sans", system-ui, sans-serif';
    ctx.font = font;
    const w = Math.max(8, Math.ceil(ctx.measureText(text).width) + 24);
    if (cv.width !== w || cv.height !== 64) {
      cv.width = w; cv.height = 64;
      // a texture can't change size on the GPU: make a fresh one for the new canvas size
      sp.material.map.dispose();
      const fresh = new THREE.CanvasTexture(cv);
      fresh.colorSpace = THREE.SRGBColorSpace;
      fresh.minFilter = THREE.LinearFilter;
      sp.material.map = fresh;
      sp.userData.tex = fresh;
      sp.material.needsUpdate = true;
    }
    const tex = sp.userData.tex;
    ctx.font = font;
    ctx.clearRect(0, 0, w, 64);
    if (text) {
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.fillRect(0, 6, w, 52);
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 12, 34);
    }
    tex.needsUpdate = true;
    const hgt = 0.038;
    sp.scale.set((hgt * w) / 64, hgt, 1);
    sp.visible = !!text;
  }

  requestAnimationFrame(frame);

  return {
    generate(seed) {
      st.seed = seed;
      buildWorld(seed);
      world.visible = true;
      genStart = performance.now();
      dirty = true;
    },
    setStory(step, prog) {
      const was = st.mode;
      if (st.mode !== 'story') { st.mode = 'story'; controls.enabled = false; applyOffset(); }
      if (step <= 1 && st.step > 1) st.idsFor = null;     // pick fresh satellites after they move again
      if (was === 'lab') { st.idsFor = null; look.copy(controls.target); }
      st.step = step; st.prog = prog;
      dirty = true;
    },
    setLab(params) {
      if (st.mode !== 'lab') {
        st.mode = 'lab';
        st.idsFor = null;
        controls.enabled = true;
        controls.target.copy(look);
        applyOffset();
      }
      Object.assign(st.lab, params);
      if ('n' in params || 'lat' in params) st.idsFor = null;
      dirty = true;
    },
    reseedNoise() { st.noiseSeed++; dirty = true; },
  };
}

function fmtKm(m) {
  const km = m / 1000;
  return `${km >= 100 ? Math.round(km).toLocaleString('en-GB') : km.toFixed(1)} km`;
}
