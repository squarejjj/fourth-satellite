// Page flow: home ("Generate World") → a scroll-through story → the lab.
// One animation loop drives both 3-D scenes from a single number, g: how far you have scrolled,
// counted in steps. It is smoothed, so the model glides even when the mouse wheel jumps.
import { createScene } from './scene.js';
import { createCity } from './city.js';

const body = document.body;
const KM_PER_MS = 299.792458;                     // light travels this many km in a millisecond
const steps = [...document.querySelectorAll('.step')];
const copies = steps.map((s) => s.querySelector('.copy'));
const dotsNav = document.getElementById('dots');
const hint = document.getElementById('hint');
const cityCanvas = document.getElementById('city');
const labelLayer = document.getElementById('labels');
const STILL = new URLSearchParams(location.search).has('still') || matchMedia('(prefers-reduced-motion: reduce)').matches;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (t) => t * t * (3 - 2 * t);
const ramp = (g, a, b) => smooth(clamp01((g - a) / (b - a)));
const fmtInt = (x) => Math.round(x).toLocaleString('en-GB');
const sign = (x) => (x < -0.0005 ? '−' : '+');
function dist(m) {
  if (!Number.isFinite(m)) return '—';
  if (m < 0.05) return '0 m';
  if (m < 1000) return `${m.toFixed(m < 10 ? 1 : 0)} m`;
  return m < 100000 ? `${(m / 1000).toFixed(1)} km` : `${fmtInt(m / 1000)} km`;
}
const live = new Map();
function setLive(key, text) {
  if (live.get(key) === text) return;
  live.set(key, text);
  document.querySelectorAll(`[data-live="${key}"]`).forEach((el) => { el.textContent = text; });
}

let earth = null, city = null;
try {
  city = createCity(cityCanvas, { labelLayer });
  earth = createScene(document.getElementById('world'), { labelLayer, onReadout, onPick });
} catch (err) {
  console.error(err);
  document.getElementById('home-note').textContent = 'This page needs a browser with 3-D graphics (WebGL) switched on.';
  document.getElementById('generate').disabled = true;
}

// ── Home → story ──
document.getElementById('generate').addEventListener('click', () => {
  body.classList.replace('mode-intro', 'mode-story');
  window.scrollTo(0, 0);
  gShown = gFromScroll();
  city.generate();
});

// ── Story ──
steps.forEach((sp, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('aria-label', `Step ${i + 1}`);
  b.addEventListener('click', () => window.scrollTo({ top: sp.offsetTop - innerHeight * 0.5 + sp.offsetHeight * 0.42, behavior: 'smooth' }));
  dotsNav.append(b);
});
const dots = [...dotsNav.children];
document.getElementById('to-top').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

// How far through the story the middle of the screen is, in steps.
function gFromScroll() {
  const mid = innerHeight * 0.5;
  let g = 0;
  steps.forEach((s, i) => { const r = s.getBoundingClientRect(); if (r.top <= mid) g = i + clamp01((mid - r.top) / r.height); });
  return Math.min(g, steps.length - 0.35);
}
// Text fades in as it arrives and out as it leaves.
function fadeCopies() {
  const vh = innerHeight;
  copies.forEach((c) => {
    const r = c.getBoundingClientRect();
    // in from the bottom of the screen, out as it rises past the top quarter
    const a = smooth(Math.min(clamp01((vh * 0.97 - r.top) / (vh * 0.28)), clamp01((r.top + vh * 0.02) / (vh * 0.18))));
    c.style.opacity = a.toFixed(3);
  });
}

// ── The loop ──
let gShown = 0, last = performance.now(), activeDot = -1;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!earth) return;
  if (body.classList.contains('mode-story')) {
    const gTarget = gFromScroll();
    gShown = STILL ? gTarget : gShown + (gTarget - gShown) * (1 - Math.exp(-dt * 6));
    // Street ⇄ planet. Both scenes keep zooming out around your blue dot; the street fades into a
    // haze of sky colour, the canvases swap while the screen is all haze, and the Earth comes out
    // of it. (And the same in reverse on the way back down.)
    const cityA = clamp01(1 - ramp(gShown, 1.77, 1.81) + ramp(gShown, 10.07, 10.11));
    const cityVeil = gShown < 6 ? ramp(gShown, 1.5, 1.78) : 1 - ramp(gShown, 10.1, 10.32);
    const earthVeil = gShown < 6 ? 1 - ramp(gShown, 1.8, 2.12) : ramp(gShown, 9.88, 10.08);
    cityCanvas.style.opacity = cityA.toFixed(3);
    city.set(gShown, cityA, cityVeil);
    earth.setStory(gShown, 1 - cityA, earthVeil);
    city.tick(now);
    earth.tick(now);
    fadeCopies();
    const d = Math.min(steps.length - 1, Math.floor(gTarget));
    if (d !== activeDot) { activeDot = d; dots.forEach((b, i) => b.classList.toggle('on', i === d)); }
    hint.classList.toggle('gone', window.scrollY > 40);
  } else if (body.classList.contains('mode-lab')) {
    earth.tick(now);
  }
}
requestAnimationFrame(loop);

// ── Numbers from the model ──
function onReadout(r) {
  if (r.mode === 'story') {
    setLive('t1', `${r.t1.toFixed(4)} s`);
    setLive('d1', `${fmtInt(r.d1 / 1000)} km`);
    setLive('clk', `${r.trueClockMs.toFixed(2)} ms`);
    setLive('km', `${fmtInt(r.trueClockMs * KM_PER_MS)} km`);
    setLive('off', dist(r.off));
    setLive('found', `${sign(r.estMs)}${Math.abs(r.estMs).toFixed(3)} ms`);
    setLive('err', dist(r.off));
    return;
  }
  labReadout(r);
}

// ── Lab ──
const DEFAULTS = { n: 4, clockMs: 0.3, noise: 0, iono: 0, lat: 37.5, spheres: false, move: false };
const lab = { ...DEFAULTS };
let savedScroll = 0, picked = null;          // picked: how many satellites you chose by clicking them
document.getElementById('open-lab').addEventListener('click', () => {
  savedScroll = window.scrollY;
  body.classList.replace('mode-story', 'mode-lab');
  earth.setLab({ ...lab });
  syncControls();
});
document.getElementById('back').addEventListener('click', () => {
  body.classList.replace('mode-lab', 'mode-story');
  requestAnimationFrame(() => { window.scrollTo(0, savedScroll); gShown = gFromScroll(); });
});
document.getElementById('reset').addEventListener('click', () => {
  Object.assign(lab, DEFAULTS);
  picked = null;
  earth.setLab({ ...DEFAULTS });
  earth.labCamera('space');
  syncControls();
});
document.querySelectorAll('#lab-n button').forEach((b) => b.addEventListener('click', () => {
  lab.n = +b.dataset.n;
  picked = null;
  earth.setLab({ n: lab.n });
  syncControls();
}));
for (const [id, key] of [['lab-clock', 'clockMs'], ['lab-noise', 'noise'], ['lab-iono', 'iono'], ['lab-lat', 'lat']]) {
  const el = document.getElementById(id);
  el.addEventListener('input', () => { lab[key] = +el.value; earth.setLab({ [key]: lab[key] }); syncControls(); });
}
for (const [id, key] of [['lab-spheres', 'spheres'], ['lab-move', 'move']]) {
  const el = document.getElementById(id);
  el.addEventListener('change', () => { lab[key] = el.checked; earth.setLab({ [key]: lab[key] }); });
}
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => earth.labCamera(b.dataset.view)));
function onPick(count) { picked = count; syncControls(); }
function syncControls() {
  const set = (id, v) => { document.getElementById(id).value = v; };
  set('lab-clock', lab.clockMs); set('lab-noise', lab.noise); set('lab-iono', lab.iono); set('lab-lat', lab.lat);
  document.getElementById('lab-spheres').checked = lab.spheres;
  document.getElementById('lab-move').checked = lab.move;
  document.getElementById('o-clock').textContent = `${sign(lab.clockMs)}${Math.abs(lab.clockMs).toFixed(2)} ms`;
  document.getElementById('o-noise').textContent = `${lab.noise} m`;
  document.getElementById('o-iono').textContent = `${lab.iono} m`;
  document.getElementById('o-lat').textContent = lab.lat === 0 ? 'equator' : `${Math.round(Math.abs(lab.lat))}°${lab.lat > 0 ? 'N' : 'S'}`;
  const n = picked ?? lab.n;
  document.querySelectorAll('#lab-n button').forEach((q) => q.setAttribute('aria-pressed', String(+q.dataset.n === n)));
}
function labReadout(r) {
  const set = (id, text, cls = '') => { const el = document.getElementById(id); if (el.textContent !== text) el.textContent = text; el.className = `v ${cls}`; };
  const status = r.off < 10 ? 'good' : r.off < 1000 ? 'warn' : 'bad';
  set('r-off', dist(r.off), status);
  const card = document.getElementById('r-main');
  if (card.className !== `main ${status}`) card.className = `main ${status}`;
  set('r-clock', r.n >= 4 && r.foundMs !== undefined ? `${sign(r.foundMs)}${Math.abs(r.foundMs).toFixed(3)} ms` : 'can’t tell', r.n >= 4 ? '' : 'bad');
  set('r-count', `${r.n} of ${r.visible}`, r.n >= 4 ? '' : 'bad');
  set('r-dop', r.pdop ? r.pdop.toFixed(1) : '—', r.pdop > 4 ? 'warn' : '');
  // one short sentence on what happened (at most three lines, so the controls below never jump)
  let note;
  if (r.n < 3) note = 'Too few satellites to say anything. Click a grey satellite to add one.';
  else if (r.n === 3) note = 'Three satellites, four unknowns: every point on the orange line fits. Click a grey satellite to add a fourth.';
  else if (lab.noise > 0 && r.pdop > 4) note = 'These satellites are bunched together, so their spheres cross at shallow angles and errors grow. Spread them out.';
  else if (lab.noise > 0) note = 'Random errors move the answer by about PDOP × the error. Add satellites, or spread them out, to shrink it.';
  else if (lab.iono > 0) note = 'The ionosphere delays low satellites most. The shared part goes into the clock; the rest moves you, mostly up or down.';
  else note = 'Solved exactly, clock and all. Move the clock slider: the phone still finds you, because the clock is one more unknown.';
  const el = document.getElementById('r-note');
  if (el.textContent !== note) el.textContent = note;
}
