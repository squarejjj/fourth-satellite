// Lab 9: inside the solver — Gauss–Newton convergence and Bancroft's two roots.
import { C, R_EARTH } from '../core/constants.js';
import { makeSky } from '../core/geo.js';
import { measure } from '../core/world.js';
import { solveFix } from '../core/receiver.js';
import { bancroft } from '../core/bancroft.js';
import { norm, sub } from '../core/linalg.js';
import { createStage, label, tag, fixGlyph, phoneGlyph } from '../ui/canvas.js';
import { palette, onThemeChange, alpha } from '../ui/theme.js';
import { lineChart } from '../ui/chart.js';
import * as F from '../ui/format.js';
import { mountSite, labNav, paintRange } from '../ui/site.js';

mountSite('solvers');
document.getElementById('labnav').innerHTML = labNav('solvers');

const SKY = [[0, 70], [80, 30], [150, 45], [215, 25], [290, 40], [340, 20]].map(([az, el], i) => ({ id: i + 1, az, el }));
const S = { alt: 20200, start: 'centre', damp: true };
let run = null;

// Undamped Gauss–Newton, written out here so the safety net can be switched off.
function plainGaussNewton(meas, start, iters = 15) {
  let x = [...start, 0];
  const out = [{ pos: start, clock: 0 }];
  for (let k = 0; k < iters; k++) {
    const G = [], y = [];
    for (const m of meas) {
      const d = sub(x.slice(0, 3), m.sat), r = norm(d);
      G.push([...d.map((v) => v / r), 1]);
      y.push(m.pr - (r + x[3]));
    }
    const fix = solveLinear(G, y);
    if (!fix) break;
    x = x.map((v, i) => v + fix[i]);
    if (!x.every(Number.isFinite)) break;
    out.push({ pos: x.slice(0, 3), clock: x[3] });
  }
  return out;
}
function solveLinear(G, y) {
  // normal equations, small and plain (the same maths as linalg.leastSquares)
  const n = G[0].length;
  const N = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => G.reduce((s, r) => s + r[i] * r[j], 0)));
  const b = Array.from({ length: n }, (_, i) => G.reduce((s, r, k) => s + r[i] * y[k], 0));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(N[r][c]) > Math.abs(N[p][c])) p = r;
    if (Math.abs(N[p][c]) < 1e-14) return null;
    [N[c], N[p]] = [N[p], N[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = N[r][c] / N[c][c]; for (let j = c; j < n; j++) N[r][j] -= f * N[c][j]; b[r] -= f * b[c]; }
  }
  return b.map((v, i) => v / N[i][i]);
}

function compute() {
  const sky = makeSky({ lat: 37.5, lon: 127 }, SKY, R_EARTH + S.alt * 1000);
  const meas = measure({ truePos: sky.user, clockError: 3e-4, sats: sky.sats });
  const start = S.start === 'centre' ? [0, 0, 0] : sky.user.map((v) => -v);
  let its;
  if (S.damp) its = solveFix(meas, { start }).iterations.map((it) => ({ pos: it.pos, clock: it.clocks[0], factor: it.factor }));
  else its = plainGaussNewton(meas, start);
  const errs = its.map((it) => norm(sub(it.pos, sky.user)));
  const range = norm(sub(sky.sats[0].pos, sky.user));
  run = { its, errs, range };
}

const conv = createStage(document.getElementById('conv'), {
  draw(ctx, w, h) {
    const P = palette();
    ctx.fillStyle = P.surface; ctx.fillRect(0, 0, w, h);
    const pts = run.errs.map((e, k) => [k, Math.log10(Math.max(e, 1e-9))]);
    lineChart(ctx, { x: 64, y: 30, w: w - 84, h: h - 72 }, {
      x: { min: 0, max: Math.max(6, run.errs.length - 1), label: 'guess number', format: (v) => F.num(v, 0), count: Math.min(15, Math.max(6, run.errs.length - 1)) },
      y: { min: -6, max: 9, ticks: [-6, -3, 0, 3, 6, 9], format: (v) => ({ '-6': '1 µm', '-3': '1 mm', 0: '1 m', 3: '1 km', 6: '1,000 km', 9: '10⁶ km' }[v] ?? ''), count: 5 },
      series: [{ points: pts, color: P.accent, width: 2.4 }],
      hlines: [{ y: Math.log10(R_EARTH), color: alpha(P.muted, 0.8), dash: [4, 4], width: 1 }],
      dots: pts.map(([x, y]) => ({ x, y, color: P.accent, r: 4 })),
    });
    label(ctx, 'size of the Earth', w - 24, 30 + (h - 72) * (1 - (Math.log10(R_EARTH) + 6) / 15) - 9, { color: P.muted, font: '600 11px Inter, sans-serif', align: 'right' });
  },
});

function renderTable() {
  const rows = run.its.map((it, k) => {
    const e = run.errs[k];
    const ratio = k >= 1 && run.errs[k - 1] > 1e-6 && e > 1e-9 ? e / run.errs[k - 1] ** 2 : null;
    return `<tr><td>${k}</td><td>${F.dist(e)}</td><td>${F.num(it.clock / 1000, 3)} km</td><td>${ratio ? ratio.toExponential(1) : '—'}</td><td>${it.factor === undefined || it.factor === 1 ? 'full' : it.factor ? `× ${F.num(it.factor, 3)}` : '—'}</td></tr>`;
  }).join('');
  document.getElementById('iters').innerHTML = `<thead><tr><th>Guess</th><th>Distance from the truth</th><th>Clock estimate (× c)</th><th>error ÷ previous error²</th><th>Step taken</th></tr></thead><tbody>${rows}</tbody>`;
  document.getElementById('alt-val').textContent = `${F.num(S.alt, 0)} km`;
}

// ── Bancroft on a flat plane ──
const B = { beacons: [[-30, 22], [4, 38], [36, 18]], you: [3, -4], clockUs: 6, drag: null }; // km
let broots = null, bgeom = null;
function computeBancroft() {
  const meas = measure({ truePos: B.you.map((v) => v * 1000), clockError: B.clockUs * 1e-6, sats: B.beacons.map((p, i) => ({ id: i + 1, pos: p.map((v) => v * 1000) })) });
  const bc = bancroft(meas);
  broots = { bc, meas };
  const rows = bc.ok ? bc.roots.map((r, i) => `<tr${r.maxResidual > 1 ? ' class="dim"' : ''}><td class="text">${i === 0 ? 'Answer A' : 'Answer B'}</td><td>(${F.num(r.pos[0] / 1000, 2)}, ${F.num(r.pos[1] / 1000, 2)}) km</td><td>${F.num((r.bias / C) * 1e6, 2)} µs</td><td>${r.maxResidual < 0.01 ? '<b style="color:var(--good)">yes</b>' : `no, by ${F.dist(r.maxResidual)}`}</td></tr>`).join('') : `<tr><td class="text" colspan="4">${bc.reason === 'no-real-root' ? 'No real answer' : 'Beacons pin nothing down'}</td></tr>`;
  document.getElementById('roots').innerHTML = `<thead><tr><th></th><th>Position</th><th>Clock</th><th>Fits?</th></tr></thead><tbody>${rows}</tbody>`;
  document.getElementById('bclk-val').textContent = `${F.signed(B.clockUs, 1)} µs`;
}
const plane = createStage(document.getElementById('plane'), {
  draw(ctx, w, h) {
    const P = palette();
    ctx.fillStyle = P.surface; ctx.fillRect(0, 0, w, h);
    const k = Math.min(w, h) / 120;
    const cx = w / 2, cy = h / 2 + 10;
    const X = (p) => [cx + p[0] * k, cy - p[1] * k];
    bgeom = { X, k, cx, cy };
    ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
    for (let v = -60; v <= 60; v += 10) {
      ctx.beginPath(); ctx.moveTo(...X([v, -60])); ctx.lineTo(...X([v, 60])); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(...X([-80, v])); ctx.lineTo(...X([80, v])); ctx.stroke();
    }
    const { bc, meas } = broots;
    // circles corrected by answer A's clock: they all meet at answer A
    if (bc.ok) {
      const a = bc.roots[0];
      meas.forEach((m, i) => {
        const [x, y] = X(m.sat.map((v) => v / 1000));
        ctx.strokeStyle = alpha(P.sat[i], 0.7); ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(x, y, Math.max(0, (m.pr - a.bias) / 1000) * k, 0, Math.PI * 2); ctx.stroke();
      });
    }
    B.beacons.forEach((b, i) => {
      const [x, y] = X(b);
      ctx.fillStyle = P.sat[i];
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = P.surface; ctx.lineWidth = 2; ctx.stroke();
      label(ctx, `B${i + 1}`, x, y - 17, { color: P.ink, font: '700 11.5px Inter, sans-serif', align: 'center' });
    });
    if (bc.ok) bc.roots.forEach((r, i) => {
      const [x, y] = X(r.pos.map((v) => v / 1000));
      if (x < -50 || x > w + 50 || y < -50 || y > h + 50) return;
      fixGlyph(ctx, x, y, r.maxResidual < 0.01 ? P.good : P.muted, 8);
      tag(ctx, i === 0 ? 'A' : 'B', x + 12, y - 12, { bg: r.maxResidual < 0.01 ? P.good : P.muted, fg: '#fff' });
    });
    const [yx, yy] = X(B.you);
    phoneGlyph(ctx, yx, yy, P.true, P.surface, 0.9);
    label(ctx, 'You', yx - 12, yy, { color: P.true, font: '700 12px Inter, sans-serif', align: 'right' });
    label(ctx, '10 km grid', 10, h - 12, { color: P.muted, font: '600 11px Inter, sans-serif' });
  },
  onDown(p) {
    const pts = [...B.beacons, B.you];
    let best = null;
    pts.forEach((q, i) => { const [x, y] = bgeom.X(q); const d = Math.hypot(p.x - x, p.y - y); if (d < 18 && (!best || d < best.d)) best = { d, i }; });
    if (!best) return false;
    B.drag = best.i; return true;
  },
  onMove(p) {
    const q = [(p.x - bgeom.cx) / bgeom.k, (bgeom.cy - p.y) / bgeom.k];
    if (B.drag === 3) B.you = q; else B.beacons[B.drag] = q;
    computeBancroft(); plane.redraw();
  },
  onUp() { B.drag = null; },
  onHover(p) { return [...B.beacons, B.you].some((q) => { const [x, y] = bgeom.X(q); return Math.hypot(p.x - x, p.y - y) < 18; }) ? 'grab' : null; },
});

// ── Controls ──
const altEl = document.getElementById('alt');
paintRange(altEl);
altEl.addEventListener('input', () => { S.alt = +altEl.value; update(); });
document.querySelectorAll('#start button').forEach((b) => b.addEventListener('click', () => {
  S.start = b.dataset.s;
  document.querySelectorAll('#start button').forEach((q) => q.setAttribute('aria-pressed', q === b));
  update();
}));
document.getElementById('damp').addEventListener('change', (e) => { S.damp = e.target.checked; update(); });
const bclk = document.getElementById('bclk');
paintRange(bclk);
bclk.addEventListener('input', () => { B.clockUs = +bclk.value; computeBancroft(); plane.redraw(); });
document.getElementById('line').addEventListener('click', () => { B.beacons = [[-36, 28], [2, 28], [38, 28]]; computeBancroft(); plane.redraw(); });
document.getElementById('spread').addEventListener('click', () => { B.beacons = [[-30, 22], [4, 38], [36, 18]]; computeBancroft(); plane.redraw(); });

function update() { compute(); renderTable(); conv.redraw(); }
onThemeChange(() => { conv.redraw(); plane.redraw(); });
update();
computeBancroft();
