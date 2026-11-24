// Lab 1: how a receiver measures travel time by correlating with a copy of the code.
import { C } from '../core/constants.js';
import { caCode, codeSamples } from '../core/signal.js';
import { gaussianSource, mulberry32 } from '../core/rng.js';
import { createStage, label, tag } from '../ui/canvas.js';
import { palette, onThemeChange, alpha } from '../ui/theme.js';
import { lineChart } from '../ui/chart.js';
import * as F from '../ui/format.js';
import { mountSite, labNav, paintRange } from '../ui/site.js';

mountSite('timing');
document.getElementById('labnav').innerHTML = labNav('timing');

const SPC = 2;                    // samples per chip
const N = 1023 * SPC;             // samples in one code repeat (1 ms)
const PRNS = [1, 7, 19];
const CODES = Object.fromEntries(PRNS.map((p) => [p, codeSamples(caCode(p), SPC)]));
const CHIP_S = 1 / 1.023e6;

const S = { prn: 1, snr: -20, ms: 4, others: true, hidden: false, shift: 600, seed: 1, ranges: {}, delay: {} };
let rx = null, corr = null, best = null, sweep = null;

function newScenario() {
  const rand = mulberry32(S.seed * 7919 + 3);
  for (const p of PRNS) {
    const range = 20.2e6 + rand() * 4.5e6;              // a plausible satellite distance, metres
    S.ranges[p] = range;
    const within = ((range / C) % 1e-3) / 1e-3;           // fraction of a code repeat
    S.delay[p] = Math.round(within * N) % N;             // in samples
  }
}

function buildSignal() {
  const A = 10 ** (S.snr / 20);
  rx = new Float32Array(N);
  const g = gaussianSource(S.seed);
  for (let k = 0; k < S.ms; k++) for (let i = 0; i < N; i++) rx[i] += g(); // fresh noise each millisecond
  for (const p of S.others ? PRNS : [S.prn]) {
    const c = CODES[p], d = S.delay[p];
    for (let i = 0; i < N; i++) rx[i] += S.ms * A * c[(i - d + N) % N];   // the same code every millisecond
  }
  // correlate with the phone's copy of the chosen satellite's code, at every shift
  const copy = CODES[S.prn];
  corr = new Float32Array(N);
  const norm = 1 / (N * S.ms * A);
  for (let k = 0; k < N; k++) {
    let s = 0;
    for (let i = 0; i < N; i++) s += rx[(i + k) % N] * copy[i];
    corr[k] = s * norm;
  }
  // the best match, and how far it stands above everything else
  let arg = 0;
  for (let k = 1; k < N; k++) if (corr[k] > corr[arg]) arg = k;
  let m = 0, v = 0, n = 0;
  for (let k = 0; k < N; k++) {
    const dk = Math.min(Math.abs(k - arg), N - Math.abs(k - arg));
    if (dk <= 2) continue;
    m += corr[k]; v += corr[k] * corr[k]; n++;
  }
  m /= n;
  const sd = Math.sqrt(Math.max(v / n - m * m, 1e-12));
  const truth = S.delay[S.prn];
  const offBy = Math.min(Math.abs(arg - truth), N - Math.abs(arg - truth));
  best = { arg, peak: corr[arg], z: (corr[arg] - m) / sd, sd, right: offBy <= 1 };
}

// ── Strip: received samples, the copy, and where they agree ──
const strip = createStage(document.getElementById('strip'), {
  draw(ctx, w, h) {
    const P = palette();
    ctx.fillStyle = P.surface; ctx.fillRect(0, 0, w, h);
    if (!rx) return;
    const chips = 48, n = chips * SPC;
    const x0 = 118, x1 = w - 14, dx = (x1 - x0) / n;
    const rows = [
      { y: h * 0.3, hgt: h * 0.2, name: 'What arrives' },
      { y: h * 0.6, hgt: h * 0.11, name: 'Phone’s copy' },
      { y: h * 0.84, hgt: h * 0.1, name: 'Agree?' },
    ];
    rows.forEach((r) => {
      label(ctx, r.name, 14, r.y, { color: P.ink2, font: '600 12px Inter, sans-serif' });
      ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, r.y); ctx.lineTo(x1, r.y); ctx.stroke();
    });
    const A = 10 ** (S.snr / 20);
    const avg = (i) => rx[i] / S.ms;                       // what arrives, averaged over the listening time
    const scaleRx = rows[0].hgt / Math.max(2.5, A + 2.5 / Math.sqrt(S.ms));
    // received (noisy)
    ctx.strokeStyle = alpha(P.ink2, 0.75); ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const lim = rows[0].hgt * 1.25;
      const y = rows[0].y - Math.max(-lim, Math.min(lim, avg(i) * scaleRx));
      i ? ctx.lineTo(x0 + (i + 0.5) * dx, y) : ctx.moveTo(x0 + 0.5 * dx, y);
    }
    ctx.stroke();
    if (S.hidden) {
      const c = CODES[S.prn], d = S.delay[S.prn];
      ctx.strokeStyle = P.s3; ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const y = rows[0].y - A * c[(i - d + N) % N] * scaleRx;
        ctx.lineTo(x0 + i * dx, y); ctx.lineTo(x0 + (i + 1) * dx, y);
      }
      ctx.stroke();
    }
    // the copy, positioned by the slider
    const copy = CODES[S.prn];
    const shift = Math.round(S.shift * SPC);
    ctx.strokeStyle = P.accent; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const v = copy[(i - shift + N * 4) % N];
      const y = rows[1].y - v * rows[1].hgt;
      if (i === 0) ctx.moveTo(x0, y); else ctx.lineTo(x0 + i * dx, y);
      ctx.lineTo(x0 + (i + 1) * dx, y);
    }
    ctx.stroke();
    // products: green where they agree, red where they don't
    for (let i = 0; i < n; i++) {
      const prod = avg(i) * copy[(i - shift + N * 4) % N];
      const hgt = Math.max(-1, Math.min(1, prod / 2)) * rows[2].hgt;
      ctx.fillStyle = prod >= 0 ? alpha(P.good, 0.8) : alpha(P.bad, 0.7);
      ctx.fillRect(x0 + i * dx + 0.5, hgt >= 0 ? rows[2].y - hgt : rows[2].y, Math.max(1, dx - 1), Math.abs(hgt));
    }
    if (S.hidden) tag(ctx, 'hidden signal', x1, rows[0].y - rows[0].hgt - 6, { bg: P.s3, fg: '#fff', align: 'right' });
  },
});

// ── Correlation over every shift ──
const corrStage = createStage(document.getElementById('corr'), {
  draw(ctx, w, h) {
    const P = palette();
    ctx.fillStyle = P.surface; ctx.fillRect(0, 0, w, h);
    if (!corr) return;
    const box = { x: 54, y: 32, w: w - 70, h: h - 72 };
    const upto = sweep ? sweep.k : N;
    const pts = [];
    for (let k = 0; k < upto; k++) pts.push([k / SPC, corr[k]]);
    let ymin = Infinity, ymax = -Infinity;
    for (let k = 0; k < N; k++) { ymin = Math.min(ymin, corr[k]); ymax = Math.max(ymax, corr[k]); }
    ymax = Math.max(1.15, ymax * 1.08);
    ymin = Math.min(-0.3, ymin * 1.08);
    const noiseLine = best.sd * 4.5;
    lineChart(ctx, box, {
      x: { min: 0, max: 1023, label: 'position of the copy (chips; 1,023 chips = 1 millisecond)', format: (v) => F.num(v, 0) },
      y: { min: ymin, max: ymax, format: (v) => F.num(v, 1), count: 4 },
      series: [{ points: pts, color: P.ink2, width: 1.3 }],
      hlines: [{ y: noiseLine, color: alpha(P.warn, 0.9), dash: [5, 4], width: 1.2 }],
      vlines: [{ x: S.shift, color: P.accent, width: 2, dash: [], label: 'your copy' }],
      dots: sweep ? [] : [{ x: best.arg / SPC, y: best.peak, color: best.right ? P.good : P.bad, r: 5 }],
    });
    label(ctx, 'noise can reach about here', box.x + 6, box.y + box.h - ((noiseLine - ymin) / (ymax - ymin)) * box.h - 9, { color: P.warn, font: '600 11px Inter, sans-serif' });
  },
});

// ── Readouts ──
function setStat(id, v, d, cls = '') {
  const el = document.getElementById(id);
  el.className = `stat ${cls}`;
  el.querySelector('.v').innerHTML = v;
  el.querySelector('.d').innerHTML = d;
}

function renderStats() {
  const k = Math.round(S.shift * SPC) % N;
  const score = corr[k];
  setStat('st-score', F.num(score, 2), score > 0.7 && Math.abs(k - best.arg) <= 1 ? 'lined up' : '1 = perfect match', score > 0.7 ? 'good' : '');
  const chips = best.arg / SPC;
  setStat('st-peak', `${F.num(chips, 1)} chips`, `${best.right ? 'the true delay' : `wrong: the true delay is ${F.num(S.delay[S.prn] / SPC, 1)} chips`}`, best.right ? '' : 'bad');
  const wholeMs = Math.floor((S.ranges[S.prn] / C) * 1000);
  const t = wholeMs / 1000 + chips * CHIP_S;
  setStat('st-time', `${F.num(t * 1000, 4)} ms`, `${wholeMs} whole ms + ${F.num(chips, 1)} × 977.5 ns → ${F.num((t * C) / 1000, 1)} km`);
  const z = best.z;
  if (z >= 6.5 && best.right) setStat('st-lock', 'Yes', `the peak is ${F.num(z, 1)}× the noise’s typical size`, 'good');
  else if (z >= 5 && best.right) setStat('st-lock', 'Just about', `peak only ${F.num(z, 1)}× the noise: listen longer`, '');
  else setStat('st-lock', 'No fresh position', `the peak (${F.num(z, 1)}× the noise) could be a noise spike`, 'bad');
  document.getElementById('shift-val').textContent = `${F.num(S.shift, 1)} chips`;
  document.getElementById('snr-val').textContent = `${S.snr > 0 ? '+' : ''}${S.snr} dB`;
  document.getElementById('ms-val').textContent = `${S.ms} ms`;
}

function rebuild() {
  buildSignal();
  renderStats();
  strip.redraw();
  corrStage.redraw();
}

// ── Controls ──
const shiftEl = document.getElementById('shift');
const paintShift = paintRange(shiftEl);
shiftEl.addEventListener('input', () => { sweep = null; S.shift = +shiftEl.value; renderStats(); strip.redraw(); corrStage.redraw(); });
const snrEl = document.getElementById('snr');
paintRange(snrEl);
snrEl.addEventListener('input', () => { S.snr = +snrEl.value; rebuild(); });
const msEl = document.getElementById('ms');
paintRange(msEl);
msEl.addEventListener('input', () => { S.ms = +msEl.value; rebuild(); });
document.querySelectorAll('#prn button').forEach((b) => b.addEventListener('click', () => {
  S.prn = +b.dataset.prn;
  document.querySelectorAll('#prn button').forEach((q) => q.setAttribute('aria-pressed', q === b));
  rebuild();
}));
document.getElementById('others').addEventListener('change', (e) => { S.others = e.target.checked; rebuild(); });
document.getElementById('hidden').addEventListener('change', (e) => { S.hidden = e.target.checked; strip.redraw(); });
document.getElementById('reroll').addEventListener('click', () => { S.seed++; newScenario(); rebuild(); });

// Search: sweep the copy across every position, then jump to the best one.
document.getElementById('search').addEventListener('click', () => {
  const t0 = performance.now(), dur = matchMedia('(prefers-reduced-motion: reduce)').matches ? 200 : 2200;
  sweep = { k: 0 };
  const step = () => {
    if (!sweep) return;
    const f = Math.min(1, (performance.now() - t0) / dur);
    sweep.k = Math.max(1, Math.floor(f * N));
    S.shift = (sweep.k - 1) / SPC;
    shiftEl.value = S.shift; paintShift();
    renderStats(); strip.redraw(); corrStage.redraw();
    if (f < 1) requestAnimationFrame(step);
    else {
      sweep = null;
      S.shift = best.arg / SPC;
      shiftEl.value = S.shift; paintShift();
      renderStats(); strip.redraw(); corrStage.redraw();
    }
  };
  requestAnimationFrame(step);
});

onThemeChange(() => { strip.redraw(); corrStage.redraw(); });
newScenario();
rebuild();
