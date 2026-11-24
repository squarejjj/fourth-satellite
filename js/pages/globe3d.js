// The 3-D model on the home page: the real problem in three dimensions.
// Three.js only DRAWS the scene (Earth, orbits, satellite models, spheres). Every position,
// measurement and solution comes from our own code: world.js makes the measurements and
// receiver.js solves them, exactly as on the flat slice.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { C, R_GPS } from '../core/constants.js';
import { llaToEcef, enuBasis, ecefToEnu } from '../core/geo.js';
import { measure } from '../core/world.js';
import { solveFix, solutionCurve3D, sphereIntersections } from '../core/receiver.js';
import { dopFromSky } from '../core/dop.js';
import { sub, norm } from '../core/linalg.js';
import { palette, onThemeChange } from '../ui/theme.js';
import * as F from '../ui/format.js';
import { paintRange } from '../ui/site.js';

const DEG = Math.PI / 180;
const U = 1e6;                                  // 1 scene unit = 1,000 km
const toV = (p) => new THREE.Vector3(p[0] / U, p[2] / U, -p[1] / U); // ECEF → scene (y up = north pole)
const RX = { lat: 37.5, lon: 127 };            // Seoul, as in the research notes
const ME = llaToEcef(RX.lat, RX.lon);
const BASIS = enuBasis(RX.lat, RX.lon);
const MASK = 10;                                // satellites below 10° are ignored
const PERIOD = 90;                              // seconds per orbit in the animation (real: ~11 h 58 min)

// The GPS constellation, simplified: 6 orbit planes tilted 55°, 4 satellites in each.
const CONST = [];
for (let p = 0; p < 6; p++) for (let s = 0; s < 4; s++) CONST.push({ id: p * 4 + s + 1, raan: p * 60 * DEG, u0: (s * 90 + p * 15) * DEG });
const INC = 55 * DEG;
function satPos(sat, t) {
  const u = sat.u0 + (2 * Math.PI * t) / PERIOD;
  const cu = Math.cos(u), su = Math.sin(u), cO = Math.cos(sat.raan), sO = Math.sin(sat.raan);
  return [R_GPS * (cu * cO - su * Math.cos(INC) * sO), R_GPS * (cu * sO + su * Math.cos(INC) * cO), R_GPS * su * Math.sin(INC)];
}
function azEl(pos) {
  const [e, n, u] = ecefToEnu(sub(pos, ME), BASIS);
  const r = Math.hypot(e, n, u);
  return { az: ((Math.atan2(e, n) / DEG) + 360) % 360, el: Math.asin(u / r) / DEG };
}

export function mountGlobe() {
  const canvas = document.getElementById('globe');
  const box = canvas.parentElement;
  const S = { n: 4, clockMs: 0.3, spheres: true, move: !matchMedia('(prefers-reduced-motion: reduce)').matches, t: 8, used: [] };

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch {
    box.insertAdjacentHTML('beforeend', '<div class="hint" style="top:50%;text-align:center;right:12px">Your browser could not start 3-D graphics (WebGL).</div>');
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 1000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.minDistance = 7.5;
  controls.maxDistance = 140;
  controls.enablePan = false;

  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(40, 30, 60);
  scene.add(sun);

  // Earth: a sphere with a latitude/longitude grid.
  const earth = new THREE.Mesh(new THREE.SphereGeometry(6.371, 72, 48), new THREE.MeshStandardMaterial({ color: 0x2f6f95, roughness: 0.85, metalness: 0.05 }));
  scene.add(earth);
  const grid = [];
  for (let lat = -60; lat <= 60; lat += 30) for (let lon = 0; lon < 360; lon += 4) grid.push(llaToEcef(lat, lon, 1000), llaToEcef(lat, lon + 4, 1000));
  for (let lon = 0; lon < 360; lon += 30) for (let lat = -88; lat < 88; lat += 4) grid.push(llaToEcef(lat, lon, 1000), llaToEcef(lat + 4, lon, 1000));
  scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(grid.map(toV)), new THREE.LineBasicMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0.22 })));
  const glow = new THREE.Mesh(new THREE.SphereGeometry(6.371 * 1.04, 48, 32), new THREE.MeshBasicMaterial({ color: 0x7fc4ff, transparent: true, opacity: 0.08, side: THREE.BackSide }));
  scene.add(glow);

  // The six orbit planes.
  for (let p = 0; p < 6; p++) {
    const pts = [];
    for (let k = 0; k <= 128; k++) pts.push(toV(satPos({ raan: p * 60 * DEG, u0: 0 }, (k / 128) * PERIOD)));
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x8fa6d6, transparent: true, opacity: 0.25 })));
  }

  // Satellite models: a gold body, two solar panels and an antenna pointing at the Earth.
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8b25a, metalness: 0.55, roughness: 0.35 });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x23408f, metalness: 0.3, roughness: 0.5, emissive: 0x0a1433 });
  const satModels = CONST.map(() => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.7), bodyMat.clone());
    g.add(body);
    for (const sgn of [-1, 1]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.03, 0.55), panelMat);
      panel.position.x = sgn * 1.05;
      g.add(panel);
    }
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.14, 0.35, 10), bodyMat);
    ant.rotation.x = Math.PI / 2;
    ant.position.z = 0.5;               // lookAt() below points +z at the Earth
    g.add(ant);
    const label = makeLabel('');
    label.position.set(0, 1.0, 0);
    g.add(label);
    g.userData = { body, label };
    scene.add(g);
    return g;
  });

  // You: a pin on the surface.
  const you = new THREE.Group();
  const youPos = toV(ME);
  const pin = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  you.add(pin);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.03, 8, 40), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  ring.lookAt(youPos.clone().multiplyScalar(2));
  you.add(ring);
  const youLabel = makeLabel('You', '#ffffff');
  youLabel.position.copy(youPos.clone().normalize().multiplyScalar(0.7));
  you.add(youLabel);
  you.position.copy(youPos);
  scene.add(you);

  // Things that change: lines of sight, distance spheres, the curve, the answer, the solver's guesses.
  const dynamic = new THREE.Group();
  scene.add(dynamic);
  const sphereGeo = new THREE.SphereGeometry(1, 64, 48);
  const wireGeo = new THREE.WireframeGeometry(new THREE.SphereGeometry(1, 24, 16));
  const dotGeo = new THREE.SphereGeometry(0.16, 16, 12);
  const shared = new Set([sphereGeo, wireGeo, dotGeo]);
  function clearDynamic() {
    for (const o of dynamic.children) {
      if (o.geometry && !shared.has(o.geometry) && !o.userData.sharesGeometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    }
    dynamic.clear();
  }

  function satColors() {
    const P = palette();
    return P.sat.slice(0, 5).map((c) => new THREE.Color(c));
  }

  function chooseSatellites(positions) {
    const vis = CONST.map((s, i) => ({ s, i, pos: positions[i], ...azEl(positions[i]) })).filter((q) => q.el > MASK);
    // keep the current choice while all of it stays in view (stops the picture jumping about)
    if (S.used.length >= S.n && S.used.slice(0, S.n).every((id) => vis.some((q) => q.s.id === id))) return vis;
    let best = null;
    const combos = (arr, k, start = 0, acc = []) => {
      if (acc.length === k) {
        const d = dopFromSky(acc.map((q) => ({ az: q.az, el: q.el })));
        if (d.ok && (!best || d.gdop < best.g)) best = { g: d.gdop, set: [...acc] };
        return;
      }
      for (let i = start; i < arr.length; i++) { acc.push(arr[i]); combos(arr, k, i + 1, acc); acc.pop(); }
    };
    combos(vis, Math.min(4, vis.length));
    let chosen = best ? best.set : vis.slice(0, 4);
    if (S.n === 5) {
      const rest = vis.filter((q) => !chosen.includes(q));
      let pick = null;
      for (const q of rest) { const d = dopFromSky([...chosen, q].map((x) => ({ az: x.az, el: x.el }))); if (d.ok && (!pick || d.gdop < pick.g)) pick = { g: d.gdop, q }; }
      if (pick) chosen = [...chosen, pick.q];
    }
    chosen.sort((a, b) => a.az - b.az);
    S.used = chosen.map((q) => q.s.id);
    return vis;
  }

  let last = null;
  function compute() {
    const positions = CONST.map((s) => satPos(s, S.t));
    const vis = chooseSatellites(positions);
    const ids = S.used.slice(0, S.n === 3 ? 3 : S.n);
    const used = ids.map((id) => ({ id, pos: positions[id - 1] }));
    const meas = measure({ truePos: ME, clockError: S.clockMs / 1000, sats: used });
    const out = { positions, vis, used, meas };
    if (meas.length >= 4) {
      out.fix = solveFix(meas);
      out.clockEst = out.fix.ok ? out.fix.clock : 0;
    } else if (meas.length === 3) {
      // One satellite short: show every place that fits, and where the phone would land if it trusted its clock.
      const b = (S.clockMs / 1000) * C;
      out.curve = solutionCurve3D(meas[0], meas[1], meas[2], b - 2.5e6, b + 2.5e6, 500, [0, 0, 0]);
      const hit = sphereIntersections(meas[0].sat, meas[0].pr, meas[1].sat, meas[1].pr, meas[2].sat, meas[2].pr);
      out.trust = hit ? (norm(hit[0]) < norm(hit[1]) ? hit[0] : hit[1]) : null;
      out.clockEst = 0;
    }
    last = out;
    return out;
  }

  function rebuildDynamic() {
    const r = last;
    const cols = satColors();
    const P = palette();
    clearDynamic();
    // satellite models: used ones glow in their colour, others are dimmed
    CONST.forEach((s, i) => {
      const g = satModels[i];
      const p = toV(r.positions[i]);
      g.position.copy(p);
      g.lookAt(0, 0, 0);
      const k = r.used.findIndex((q) => q.id === s.id);
      const visible = r.vis.some((q) => q.s.id === s.id);
      g.userData.body.material.emissive = k >= 0 ? cols[k] : new THREE.Color(0x000000);
      g.userData.body.material.emissiveIntensity = k >= 0 ? 0.9 : 0;
      g.scale.setScalar(k >= 0 ? 1.25 : visible ? 0.85 : 0.6);
      setLabel(g.userData.label, k >= 0 ? `S${k + 1}` : '', k >= 0 ? `#${cols[k].getHexString()}` : '#ffffff');
    });
    r.used.forEach((u, k) => {
      const sp = toV(u.pos);
      // line of sight
      dynamic.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([youPos, sp]), new THREE.LineBasicMaterial({ color: cols[k], transparent: true, opacity: 0.75 })));
      // distance sphere (corrected by the receiver's clock estimate, if it has one)
      if (S.spheres) {
        const rad = (r.meas[k].pr - (r.clockEst || 0)) / U;
        const m = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: cols[k], transparent: true, opacity: 0.055, depthWrite: false, side: THREE.DoubleSide }));
        m.scale.setScalar(rad);
        m.position.copy(sp);
        dynamic.add(m);
        const wire = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: cols[k], transparent: true, opacity: 0.07, depthWrite: false }));
        wire.scale.setScalar(rad);
        wire.position.copy(sp);
        dynamic.add(wire);
      }
    });
    const accent = new THREE.Color(P.accent);
    if (r.curve && r.curve.length > 3) {
      const pts = r.curve.map((q) => toV(q.p)).filter((v) => v.length() < 30);
      if (pts.length > 3) {
        const path = new THREE.CatmullRomCurve3(pts);
        const tube = new THREE.TubeGeometry(path, Math.min(400, pts.length * 2), 0.035, 8, false);
        dynamic.add(new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ color: accent })));
        const ghost = new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.28, depthTest: false }));
        ghost.renderOrder = 4;
        dynamic.add(ghost);
        ghost.userData.sharesGeometry = true;
      }
    }
    const answer = r.fix && r.fix.ok ? r.fix.pos : r.trust;
    if (answer) {
      const a = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: accent, depthTest: false }));
      a.position.copy(toV(answer));
      a.renderOrder = 5;
      dynamic.add(a);
      if (r.fix && r.fix.ok) {
        // the solver's guesses, from the centre of the Earth
        const path = r.fix.iterations.map((it) => toV(it.pos));
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(path), new THREE.LineDashedMaterial({ color: accent, dashSize: 0.3, gapSize: 0.2, depthTest: false, transparent: true, opacity: 0.8 }));
        line.computeLineDistances();
        dynamic.add(line);
      }
    }
  }

  // ── readouts ──
  function readouts() {
    const r = last;
    const set = (id, v, d, cls = '') => { const el = document.getElementById(id); el.className = `stat ${cls}`; el.querySelector('.v').innerHTML = v; el.querySelector('.d').innerHTML = d; };
    const n = r.meas.length;
    set('g-count', `4 unknowns · ${n} satellites`, 'x, y, z and the clock', n >= 4 ? 'good' : 'bad');
    const note = document.getElementById('g-note');
    if (n >= 4 && r.fix && r.fix.ok) {
      const e = norm(sub(r.fix.pos, ME));
      set('g-err', `${F.dist(e)} away`, 'from where you really are', e < 1 ? 'good' : 'accent');
      set('g-time', `${F.signed((r.fix.clock / C) * 1000, 3)} ms`, `found (truth ${F.signed(S.clockMs, 2)} ms)`, 'good');
      note.className = 'live good';
      note.innerHTML = n === 4
        ? '<b>Four spheres, one point.</b> The solver found x, y, z and the clock error together. The dashed line is its guesses, starting at the centre of the Earth.'
        : '<b>Five satellites:</b> one more than needed. The spare lets the phone check that the measurements agree (see Lab 5).';
    } else if (n === 3) {
      const e = r.trust ? norm(sub(r.trust, ME)) : NaN;
      set('g-err', r.trust ? `${F.dist(e)} away` : '—', 'if it trusts its own clock', 'accent');
      set('g-time', 'Can’t tell', 'one satellite short', 'bad');
      note.className = 'live';
      note.innerHTML = Math.abs(S.clockMs) < 0.005
        ? 'With a perfect clock, three spheres meet at you. Now move the clock slider.'
        : 'Three spheres, four unknowns. <b>Every point on the orange curve fits these three signals</b>, each with a different clock error. Switch to 4 satellites to pin it down.';
    } else {
      set('g-err', '—', '', '');
      set('g-time', '—', '', '');
      note.className = 'live warn';
      note.textContent = 'Not enough satellites above the horizon right now.';
    }
    document.getElementById('g-clock-val').textContent = `${F.signed(S.clockMs, 2)} ms`;
  }

  // ── labels as sprites ──
  function makeLabel(text, color = '#ffffff') {
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 64;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
    sp.scale.set(0.085, 0.0425, 1);
    sp.renderOrder = 10;
    sp.userData = { cv, tex, text: null, color: null };
    setLabel(sp, text, color);
    return sp;
  }
  function setLabel(sp, text, color) {
    if (sp.userData.text === text && sp.userData.color === color) return;
    sp.userData.text = text; sp.userData.color = color;
    const { cv, tex } = sp.userData;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (text) {
      ctx.font = '700 34px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(8,12,24,0.85)';
      ctx.strokeText(text, 64, 32);
      ctx.fillStyle = color;
      ctx.fillText(text, 64, 32);
    }
    tex.needsUpdate = true;
  }

  // ── camera ──
  const far = () => { const d = youPos.clone().normalize(); return { pos: d.multiplyScalar(62).add(new THREE.Vector3(18, 22, 10)), target: new THREE.Vector3(0, 0, 0) }; };
  const near = () => { const d = youPos.clone().normalize(); const side = new THREE.Vector3(0, 1, 0).cross(d).normalize(); return { pos: youPos.clone().add(d.clone().multiplyScalar(7)).add(side.multiplyScalar(7)), target: youPos.clone() }; };
  let fly = null;
  function flyTo(v) { fly = { from: camera.position.clone(), fromT: controls.target.clone(), to: v.pos, toT: v.target, t0: performance.now() }; }
  const start = far();
  camera.position.copy(start.pos);
  controls.target.copy(start.target);

  // ── controls ──
  document.querySelectorAll('#g-n button').forEach((b) => b.addEventListener('click', () => {
    S.n = +b.dataset.n;
    document.querySelectorAll('#g-n button').forEach((q) => q.setAttribute('aria-pressed', q === b));
    refresh();
  }));
  const clk = document.getElementById('g-clock');
  paintRange(clk);
  clk.addEventListener('input', () => { S.clockMs = +clk.value; refresh(); });
  const sph = document.getElementById('g-spheres');
  sph.addEventListener('change', () => { S.spheres = sph.checked; refresh(); });
  const mv = document.getElementById('g-move');
  mv.checked = S.move;
  mv.addEventListener('change', () => { S.move = mv.checked; });
  document.getElementById('g-far').addEventListener('click', () => flyTo(far()));
  document.getElementById('g-near').addEventListener('click', () => flyTo(near()));

  function refresh() {
    scene.background = new THREE.Color(palette().space);
    compute(); rebuildDynamic(); readouts();
  }

  // ── size and loop ──
  function resize() {
    const r = box.getBoundingClientRect();
    renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
    camera.aspect = r.width / Math.max(1, r.height);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(box);
  resize();

  let visible = true;
  new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); }).observe(box);
  let lastTick = performance.now(), lastCompute = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - lastTick) / 1000);
    lastTick = now;
    if (!visible) return;
    if (S.move) S.t += dt;
    if (S.move && now - lastCompute > 120) { lastCompute = now; refresh(); }
    if (fly) {
      const f = Math.min(1, (now - fly.t0) / 1100);
      const e = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
      camera.position.lerpVectors(fly.from, fly.to, e);
      controls.target.lerpVectors(fly.fromT, fly.toT, e);
      if (f >= 1) fly = null;
    }
    ring.scale.setScalar(1 + 0.25 * Math.sin(now / 300));
    controls.update();
    renderer.render(scene, camera);
  }
  onThemeChange(refresh);
  refresh();
  requestAnimationFrame(loop);
}
