// Page flow: home ("Generate World") → a scroll-through story with the model in the middle → the lab.
import { createScene } from './scene.js';

const body = document.body;
const KM_PER_MS = 299.792458; // light travels this many km in a millisecond
const cards = [...document.querySelectorAll('.card')];
const spaces = [...document.querySelectorAll('#track .space')];
const dotsNav = document.getElementById('dots');
const hint = document.getElementById('hint');

const fmtInt = (x) => Math.round(x).toLocaleString('en-GB');
const sign = (x) => (x < -0.0005 ? '−' : '+');
function dist(m) {
  if (!Number.isFinite(m)) return '—';
  if (m < 0.01) return '0 m';
  if (m < 1000) return `${m.toFixed(m < 10 ? 1 : 0)} m`;
  return m < 100000 ? `${(m / 1000).toFixed(1)} km` : `${fmtInt(m / 1000)} km`;
}
const setLive = (key, text) => document.querySelectorAll(`[data-live="${key}"]`).forEach((el) => { el.textContent = text; });

let scene = null;
try {
  scene = createScene(document.getElementById('world'), { onReadout });
} catch (err) {
  console.error(err);
  document.getElementById('home-note').textContent = 'This page needs a browser with 3-D graphics (WebGL) switched on.';
  document.getElementById('generate').disabled = true;
}

// ── Home → story ──
document.getElementById('generate').addEventListener('click', async () => {
  try { await document.fonts.load('600 40px "Pixelify Sans"'); } catch { /* fall back to the system font */ }
  body.classList.replace('mode-intro', 'mode-story');
  window.scrollTo(0, 0);
  scene.generate(Math.floor(Math.random() * 1e6)); // a new world every time, like a new seed
  step = -1;
  onScroll();
});

// ── Story: the page scrolls, the model stays put and changes ──
spaces.forEach((sp, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('aria-label', i < spaces.length - 1 ? `Step ${i + 1}` : 'Try it yourself');
  b.addEventListener('click', () => window.scrollTo({ top: sp.offsetTop + (sp.offsetHeight > innerHeight * 1.2 ? sp.offsetHeight - innerHeight * 0.6 : 0), behavior: 'smooth' }));
  dotsNav.append(b);
});
const dots = [...dotsNav.children];
let step = -1, ticking = false;
addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { ticking = false; onScroll(); });
}, { passive: true });
addEventListener('resize', () => onScroll());

function onScroll() {
  if (!scene || !body.classList.contains('mode-story')) return;
  const mid = innerHeight * 0.5;
  let s = 0, p = 0;
  spaces.forEach((sp, i) => {
    const r = sp.getBoundingClientRect();
    if (r.top <= mid) { s = i; p = Math.min(1, Math.max(0, (mid - r.top) / r.height)); }
  });
  if (s !== step) {
    step = s;
    cards.forEach((c) => c.classList.toggle('on', +c.dataset.step === s));
    dots.forEach((d, i) => d.classList.toggle('on', i === s));
  }
  hint.classList.toggle('gone', s > 0 || window.scrollY > 40);
  scene.setStory(s, p);
}

// ── Lab ──
const lab = { n: 4, clockMs: 0.3, noise: 0, iono: 0, lat: 37.5, spheres: true, move: true };
document.getElementById('open-lab').addEventListener('click', () => {
  body.classList.replace('mode-story', 'mode-lab');
  window.scrollTo(0, 0);
  scene.setLab(lab);
  renderOutputs();
});
document.getElementById('back').addEventListener('click', () => {
  body.classList.replace('mode-lab', 'mode-story');
  step = -1;
  requestAnimationFrame(() => { window.scrollTo(0, spaces[spaces.length - 1].offsetTop); onScroll(); });
});
document.querySelectorAll('#lab-n button').forEach((b) => b.addEventListener('click', () => {
  lab.n = +b.dataset.n;
  document.querySelectorAll('#lab-n button').forEach((q) => q.setAttribute('aria-pressed', String(q === b)));
  scene.setLab({ n: lab.n });
}));
for (const [id, key] of [['lab-clock', 'clockMs'], ['lab-noise', 'noise'], ['lab-iono', 'iono'], ['lab-lat', 'lat']]) {
  const el = document.getElementById(id);
  el.addEventListener('input', () => { lab[key] = +el.value; renderOutputs(); scene.setLab({ [key]: lab[key] }); });
}
for (const [id, key] of [['lab-spheres', 'spheres'], ['lab-move', 'move']]) {
  const el = document.getElementById(id);
  el.addEventListener('change', () => { lab[key] = el.checked; scene.setLab({ [key]: lab[key] }); });
}
function renderOutputs() {
  document.getElementById('o-clock').textContent = `${sign(lab.clockMs)}${Math.abs(lab.clockMs).toFixed(2)} ms`;
  document.getElementById('o-noise').textContent = `${lab.noise} m`;
  document.getElementById('o-iono').textContent = `${lab.iono} m`;
  document.getElementById('o-lat').textContent = lab.lat === 0 ? 'equator' : `${Math.round(Math.abs(lab.lat))}°${lab.lat > 0 ? 'N' : 'S'}`;
}

// ── Numbers from the model ──
function onReadout(r) {
  if (r.mode === 'story') {
    if (r.t1) { setLive('t1', `${r.t1.toFixed(4)} s`); setLive('d1', `${fmtInt(r.d1 / 1000)} km`); }
    setLive('clk', `${r.trueClockMs.toFixed(2)} ms`);
    setLive('km', `${fmtInt(r.trueClockMs * KM_PER_MS)} km`);
    setLive('off', dist(r.off));
    setLive('found', `${sign(r.estMs)}${Math.abs(r.estMs).toFixed(3)} ms`);
    setLive('err', dist(r.off));
    return;
  }
  if (r.mode !== 'lab') return;
  const set = (id, text, cls = '') => { const el = document.getElementById(id); el.textContent = text; el.className = cls; };
  set('r-count', r.n >= 4 ? `4 · ${r.n}` : `4 · ${r.n}`, r.n >= 4 ? 'good' : 'bad');
  set('r-off', dist(r.off), r.off < 10 ? 'good' : r.off < 1000 ? 'warn' : 'bad');
  set('r-clock', r.n >= 4 && r.foundMs !== undefined ? `${sign(r.foundMs)}${Math.abs(r.foundMs).toFixed(3)} ms` : 'can’t tell', r.n >= 4 ? '' : 'bad');
  set('r-dop', r.pdop ? r.pdop.toFixed(2) : '—');
  let note;
  if (r.visible < lab.n) note = `Only ${r.visible} satellites are above the horizon here, so the phone uses those. `;
  else note = '';
  if (r.n < 4) note += 'One satellite short: every point on the orange line fits. Add a fourth to pin down where you are and the time.';
  else if (!lab.noise && !lab.iono) note += 'With four or more satellites and no other errors, the answer is exact whatever the clock error. Try adding noise.';
  else if (lab.iono && !lab.noise) note += 'The air delays low satellites more than high ones. The shared part goes into the clock; the rest mostly moves your height.';
  else note += 'Random errors move the answer by roughly PDOP × the noise. Spread-out satellites (low PDOP) and more of them keep it small.';
  document.getElementById('r-note').textContent = note;
}
