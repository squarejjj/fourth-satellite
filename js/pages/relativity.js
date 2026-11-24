// Lab 7: relativistic clock rates, what an uncorrected drift would do, and the eccentricity wobble.
import { C, R_EARTH } from '../core/constants.js';
import { clockRates, breakEvenRadius, orbitPosition, eccentricityTerm, orbitalPeriod } from '../core/relativity.js';
import { makeSky, ecefToEnu } from '../core/geo.js';
import { measure } from '../core/world.js';
import { solveFix } from '../core/receiver.js';
import { sub, norm } from '../core/linalg.js';
import { mulberry32 } from '../core/rng.js';
import { createStage, label, satelliteGlyph } from '../ui/canvas.js';
import { palette, onThemeChange, alpha } from '../ui/theme.js';
import { lineChart, legend } from '../ui/chart.js';
import * as F from '../ui/format.js';
import { mountSite, labNav, paintRange } from '../ui/site.js';

mountSite('relativity');
document.getElementById('labnav').innerHTML = labNav('relativity');

const S = { altKm: 20189, days: 1, mode: 'diff', ecc: 0.02 };
const us = (s) => s * 1e6;

// ── Part 1: rates against height ──
const rates = createStage(document.getElementById('rates'), {
  draw(ctx, w, h) {
    const P = palette();
    ctx.fillStyle = P.surface; ctx.fillRect(0, 0, w, h);
    const mo = [], gr = [], net = [];
    for (let a = 200; a <= 40000; a += 100) {
      const r = clockRates(R_EARTH + a * 1000);
      mo.push([a, us(r.motion)]); gr.push([a, us(r.gravity)]); net.push([a, us(r.net)]);
    }
    const cur = clockRates(R_EARTH + S.altKm * 1000);
    const be = (breakEvenRadius() - R_EARTH) / 1000;
    lineChart(ctx, { x: 58, y: 38, w: w - 76, h: h - 82 }, {
      x: { min: 0, max: 40000, label: 'orbit height (km)', format: (v) => F.num(v, 0), count: 8 },
      y: { min: -35, max: 60, label: 'µs per day', format: (v) => F.num(v, 0), count: 5 },
      series: [
        { points: mo, color: P.s1, width: 2 },
        { points: gr, color: P.s2, width: 2 },
        { points: net, color: P.ink, width: 3 },
      ],
      hlines: [{ y: 0, color: P.lineStrong, dash: [], width: 1 }],
      vlines: [
        { x: be, color: alpha(P.muted, 0.9), dash: [2, 4], width: 1, label: 'they cancel' },
        { x: S.altKm, color: P.accent, dash: [], width: 2, label: `${F.num(S.altKm, 0)} km` },
      ],
      dots: [{ x: S.altKm, y: us(cur.net), color: P.ink, r: 5 }, { x: S.altKm, y: us(cur.motion), color: P.s1, r: 4 }, { x: S.altKm, y: us(cur.gravity), color: P.s2, r: 4 }],
    });
    legend(ctx, [{ label: 'motion', color: P.s1 }, { label: 'gravity', color: P.s2 }, { label: 'together', color: P.ink }], w - 14, 16);
  },
});

function renderRates() {
  const r = clockRates(R_EARTH + S.altKm * 1000);
  document.getElementById('alt-val').textContent = `${F.num(S.altKm, 0)} km`;
  document.getElementById('v').textContent = `${F.num(r.v / 1000, 2)} km/s`;
  document.getElementById('mo').textContent = `${F.signed(us(r.motion), 2)} µs`;
  document.getElementById('gr').textContent = `${F.signed(us(r.gravity), 2)} µs`;
  document.getElementById('net').textContent = `${F.signed(us(r.net), 2)} µs`;
  document.getElementById('net-d').textContent = `= ${F.dist(Math.abs(r.net) * C)} of light travel per day`;
  rates.redraw();
}

// ── Part 2: what an uncorrected drift does to a fix ──
const SKY = [[10, 72], [60, 25], [115, 48], [170, 18], [215, 55], [260, 12], [300, 35], [345, 20]].map(([az, el], i) => ({ id: i + 1, az, el }));
const sky = makeSky({ lat: 37.5, lon: 127 }, SKY);
const rate = clockRates(26560000).net;                  // seconds gained per day at GPS height
const lastSet = (() => { const r = mulberry32(5); return SKY.map(() => r()); })(); // fraction of a day before "day 0"

function renderDrift() {
  const offs = {};
  SKY.forEach((s, i) => {
    const age = S.days + (S.mode === 'diff' ? lastSet[i] : 0);   // days since this clock was set
    offs[s.id] = rate * age;                                     // seconds this clock is ahead
  });
  // A clock that runs ahead stamps its signals late, so each signal seems to have travelled less far.
  const extra = Object.fromEntries(SKY.map((s) => [s.id, -C * offs[s.id]]));
  const fix = solveFix(measure({ truePos: sky.user, clockError: 0, sats: sky.sats, extra }));
  const e = ecefToEnu(sub(fix.pos, sky.user), sky.basis);
  const posErr = norm(e);
  const timeErr = fix.clock / C;                                  // what the receiver thinks its clock is off by
  const mean = SKY.reduce((a, s) => a + offs[s.id], 0) / SKY.length;
  const set = (id, v, d, cls = '') => { const el = document.getElementById(id); el.className = `stat ${cls}`; el.querySelector('.v').textContent = v; if (d !== undefined) el.querySelector('.d').textContent = d; };
  set('d-light', F.dist(mean * C), `average satellite clock ${F.num(us(mean), 1)} µs ahead`);
  set('d-pos', F.dist(posErr), S.mode === 'same' ? 'the shared drift went into the clock unknown' : `${F.dist(Math.hypot(e[0], e[1]))} sideways, ${F.dist(Math.abs(e[2]))} in height`, posErr > 100 ? 'bad' : 'good');
  set('d-time', F.time(Math.abs(timeErr)), S.mode === 'same' ? 'every clock is equally wrong, so “GPS time” itself is off' : 'the shared part of the drift', Math.abs(timeErr) > 1e-6 ? 'accent' : '');
  document.getElementById('days-val').textContent = `${F.num(S.days, 2)} days`;
}

// ── Part 3: the eccentricity wobble ──
const A = 26560000;
let phase = 0, lastT = performance.now();
const orbit = createStage(document.getElementById('orbit'), {
  draw(ctx, w, h) {
    const P = palette();
    ctx.fillStyle = P.space; ctx.fillRect(0, 0, w, h);
    const eDraw = Math.min(0.6, S.ecc * 5);                       // exaggerated shape
    const k = (Math.min(w, h) / 2 - 24) / (A * (1 + eDraw));
    const cx = w / 2 + A * eDraw * k * 0.5, cy = h / 2;           // keep the drawing centred
    const ePos = (M) => orbitPosition(A, eDraw, M);
    ctx.strokeStyle = 'rgba(180,200,240,0.35)'; ctx.setLineDash([3, 5]);
    ctx.beginPath();
    for (let i = 0; i <= 200; i++) { const p = ePos((i / 200) * 2 * Math.PI); const x = cx + p.x * k, y = cy - p.y * k; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = P.earth1;
    ctx.beginPath(); ctx.arc(cx, cy, R_EARTH * k, 0, Math.PI * 2); ctx.fill();
    const p = ePos(phase);
    satelliteGlyph(ctx, cx + p.x * k, cy - p.y * k, P.s4, { size: 7 });
    const real = orbitPosition(A, S.ecc, phase);
    label(ctx, `speed ${F.num(real.speed / 1000, 3)} km/s`, 12, h - 16, { color: '#dfe7f7', font: '600 11.5px Inter, sans-serif' });
    label(ctx, 'closest', cx + A * (1 - eDraw) * k + 6, cy - 12, { color: '#9fb0d3', font: '600 10.5px Inter, sans-serif' });
  },
});
const wobble = createStage(document.getElementById('wobble'), {
  draw(ctx, w, h) {
    const P = palette();
    ctx.fillStyle = P.surface; ctx.fillRect(0, 0, w, h);
    const T = orbitalPeriod(A) / 3600;
    const pts = [];
    for (let i = 0; i <= 240; i++) {
      const M = (i / 240) * 2 * Math.PI;
      const E = orbitPosition(A, S.ecc, M).E;
      pts.push([(i / 240) * T, eccentricityTerm(A, S.ecc, E) * 1e9]);
    }
    const ymax = Math.max(10, Math.max(...pts.map((p) => Math.abs(p[1]))) * 1.25);
    const curE = orbitPosition(A, S.ecc, phase).E;
    lineChart(ctx, { x: 56, y: 34, w: w - 72, h: h - 78 }, {
      x: { min: 0, max: T, label: 'hours since closest approach', format: (v) => F.num(v, 0), count: 6 },
      y: { min: -ymax, max: ymax, label: 'nanoseconds', format: (v) => F.num(v, 0), count: 4 },
      series: [{ points: pts, color: P.s4, width: 2.6 }],
      hlines: [{ y: 0, color: P.lineStrong, dash: [], width: 1 }],
      dots: [{ x: (phase / (2 * Math.PI)) * T, y: eccentricityTerm(A, S.ecc, curE) * 1e9, color: P.s4, r: 5, ring: P.surface }],
    });
  },
});
function renderEcc() {
  const peak = Math.abs(eccentricityTerm(A, S.ecc, Math.PI / 2));
  document.getElementById('ecc-val').textContent = F.num(S.ecc, 3);
  document.getElementById('wob').textContent = `±${F.num(peak * 1e9, 1)} ns`;
  document.getElementById('wob-d').textContent = `= ±${F.dist(peak * C)} of range, repeating every ${F.num(orbitalPeriod(A) / 3600, 2)} h (not piling up)`;
  wobble.redraw();
}
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
function animate(t) {
  const dt = (t - lastT) / 1000; lastT = t;
  if (!reduce) { phase = (phase + dt * 0.5) % (2 * Math.PI); orbit.redraw(); wobble.redraw(); }
  requestAnimationFrame(animate);
}

// ── Controls ──
const altEl = document.getElementById('alt');
const paintAlt = paintRange(altEl);
altEl.addEventListener('input', () => { S.altKm = +altEl.value; renderRates(); });
document.querySelectorAll('[data-alt]').forEach((b) => b.addEventListener('click', () => { S.altKm = +b.dataset.alt; altEl.value = S.altKm; paintAlt(); renderRates(); }));
const daysEl = document.getElementById('days');
paintRange(daysEl);
daysEl.addEventListener('input', () => { S.days = +daysEl.value; renderDrift(); });
document.querySelectorAll('#mode button').forEach((b) => b.addEventListener('click', () => {
  S.mode = b.dataset.m;
  document.querySelectorAll('#mode button').forEach((q) => q.setAttribute('aria-pressed', q === b));
  renderDrift();
}));
const eccEl = document.getElementById('ecc');
paintRange(eccEl);
eccEl.addEventListener('input', () => { S.ecc = +eccEl.value; renderEcc(); orbit.redraw(); });

onThemeChange(() => { rates.redraw(); orbit.redraw(); wobble.redraw(); });
renderRates();
renderDrift();
renderEcc();
requestAnimationFrame(animate);
