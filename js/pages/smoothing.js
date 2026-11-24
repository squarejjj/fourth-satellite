// Lab 6: a constant-velocity Kalman filter smoothing GPS fixes on a walk.
import { makeFilter, steadyGain } from '../core/kalman.js';
import { gaussianSource } from '../core/rng.js';
import { eig2 } from '../core/linalg.js';
import { createStage, label, tag } from '../ui/canvas.js';
import { palette, onThemeChange, alpha } from '../ui/theme.js';
import { lineChart, legend } from '../ui/chart.js';
import * as F from '../ui/format.js';
import { mountSite, labNav, paintRange } from '../ui/site.js';

mountSite('smoothing');
document.getElementById('labnav').innerHTML = labNav('smoothing');

const T = 120, SPEED = 1.4;
const truthAt = (t) => (t <= 60 ? [SPEED * t, 0] : [SPEED * 60, SPEED * (t - 60)]);
const S = { q: 10 ** -0.3, r: 5, tunnel: false, t: 0, phase: 'corrected', playing: false };
let run = null;

function simulate() {
  const g = gaussianSource(2024);
  const fixes = [];
  for (let t = 0; t <= T; t++) {
    const p = truthAt(t);
    const noise = [g(), g()];
    const lost = S.tunnel && t >= 70 && t < 90;
    fixes.push(lost ? null : [p[0] + S.r * noise[0], p[1] + S.r * noise[1]]);
  }
  const f = makeFilter({ q: S.q, r: S.r, x0: [fixes[0][0], fixes[0][1], 0, 0], p0: S.r * S.r });
  const pred = [null], corr = [{ x: [...f.x], P: f.P.map((r) => [...r]) }];
  const gains = [null];
  for (let t = 1; t <= T; t++) {
    f.predict();
    pred.push({ x: [...f.x], P: f.P.map((r) => [...r]) });
    if (fixes[t]) { f.correct(fixes[t]); gains.push(f.K[0][0]); } else gains.push(null);
    corr.push({ x: [...f.x], P: f.P.map((r) => [...r]) });
  }
  const err = (a, t) => Math.hypot(a[0] - truthAt(t)[0], a[1] - truthAt(t)[1]);
  let sr = 0, sk = 0, n = 0, turn = 0, nt = 0;
  for (let t = 10; t <= T; t++) {
    if (fixes[t]) { sr += err(fixes[t], t) ** 2; sk += err(corr[t].x, t) ** 2; n++; }
    if (t >= 60 && t < 75) { turn += err(corr[t].x, t); nt++; }
  }
  run = { fixes, pred, corr, gains, rmsRaw: Math.sqrt(sr / n), rmsKf: Math.sqrt(sk / n), turn: turn / nt, err };
}

// What the filter shows at the current moment (after predicting, or after correcting).
const now = () => (S.t === 0 ? run.corr[0] : S.phase === 'predicted' ? run.pred[S.t] : run.corr[S.t]);

const walk = createStage(document.getElementById('walk'), {
  draw(ctx, w, h) {
    const P = palette();
    ctx.fillStyle = P.surface; ctx.fillRect(0, 0, w, h);
    const pad = 30, minX = -20, maxX = 105, minY = -20, maxY = 100;
    const k = Math.min((w - 2 * pad) / (maxX - minX), (h - 2 * pad) / (maxY - minY));
    const ox = (w - (maxX - minX) * k) / 2 - minX * k, oy = h - ((h - (maxY - minY) * k) / 2 - minY * k);
    const X = (x) => ox + x * k, Y = (y) => oy - y * k;
    // grid every 10 m
    ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
    for (let v = -20; v <= 100; v += 10) {
      ctx.beginPath(); ctx.moveTo(X(v), Y(minY)); ctx.lineTo(X(v), Y(maxY)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X(minX), Y(v)); ctx.lineTo(X(maxX), Y(v)); ctx.stroke();
    }
    if (S.tunnel) {
      const a = truthAt(70), b = truthAt(90);
      ctx.fillStyle = alpha(P.ink2, 0.12);
      ctx.fillRect(X(a[0]) - 14, Y(b[1]), 28, Y(a[1]) - Y(b[1]));
      label(ctx, 'tunnel', X(a[0]) + 18, Y((a[1] + b[1]) / 2), { color: P.muted, font: '600 11px Inter, sans-serif' });
    }
    // true path
    ctx.strokeStyle = alpha(P.ink, 0.35); ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(84), Y(0)); ctx.lineTo(X(84), Y(84)); ctx.stroke();
    ctx.lineCap = 'butt';
    // fixes so far
    for (let t = 0; t <= S.t; t++) {
      const f = run.fixes[t];
      if (!f) continue;
      const isNow = t === S.t && S.phase === 'corrected';
      ctx.fillStyle = isNow ? P.accent : alpha(P.muted, 0.7);
      ctx.beginPath(); ctx.arc(X(f[0]), Y(f[1]), isNow ? 5 : 2.6, 0, Math.PI * 2); ctx.fill();
    }
    // filtered track
    ctx.strokeStyle = P.s1; ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let t = 0; t <= S.t; t++) {
      const st = t === S.t ? now() : run.corr[t];
      t ? ctx.lineTo(X(st.x[0]), Y(st.x[1])) : ctx.moveTo(X(st.x[0]), Y(st.x[1]));
    }
    ctx.stroke();
    // uncertainty ellipse (2σ) at the current estimate
    const st = now();
    const e = eig2(st.P[0][0], st.P[0][1], st.P[1][1]);
    ctx.fillStyle = alpha(P.s1, 0.12); ctx.strokeStyle = P.s1; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(X(st.x[0]), Y(st.x[1]), 2 * Math.sqrt(e.l1) * k, 2 * Math.sqrt(Math.max(e.l2, 0)) * k, -e.angle, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = P.s1; ctx.beginPath(); ctx.arc(X(st.x[0]), Y(st.x[1]), 4.5, 0, Math.PI * 2); ctx.fill();
    // you
    const tp = truthAt(S.t);
    ctx.strokeStyle = P.true; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(X(tp[0]), Y(tp[1]), 6, 0, Math.PI * 2); ctx.stroke();
    tag(ctx, `t = ${S.t} s`, 12, 18, { bg: P.surface3, fg: P.ink });
    legendRow(ctx, P, w);
  },
});
function legendRow(ctx, P, w) {
  legend(ctx, [{ label: 'where you walked', color: alpha(P.ink, 0.35) }, { label: 'GPS fixes', color: P.muted }, { label: 'filter', color: P.s1 }], w - 12, 18);
}

const errStage = createStage(document.getElementById('err'), {
  draw(ctx, w, h) {
    const P = palette();
    ctx.fillStyle = P.surface; ctx.fillRect(0, 0, w, h);
    const raw = [], kf = [];
    for (let t = 0; t <= T; t++) {
      raw.push([t, run.fixes[t] ? run.err(run.fixes[t], t) : NaN]);
      kf.push([t, run.err(run.corr[t].x, t)]);
    }
    const ymax = Math.max(12, ...kf.map((p) => p[1]), ...raw.filter((p) => Number.isFinite(p[1])).map((p) => p[1])) * 1.05;
    lineChart(ctx, { x: 46, y: 26, w: w - 60, h: h - 58 }, {
      x: { min: 0, max: T, format: (v) => `${v}s`, count: 8 },
      y: { min: 0, max: ymax, format: (v) => `${F.num(v, 0)} m`, count: 3 },
      bands: S.tunnel ? [{ x0: 70, x1: 90, color: alpha(P.ink2, 0.1) }] : [],
      series: [{ points: raw, color: alpha(P.muted, 0.8), width: 1.3 }, { points: kf, color: P.s1, width: 2.2 }],
      vlines: [{ x: S.t, color: P.ink, dash: [3, 3], width: 1.2 }, { x: 60, color: alpha(P.warn, 0.9), dash: [2, 4], width: 1, label: 'turn' }],
    });
  },
});

function renderStats() {
  const set = (id, v, cls = '') => { const el = document.getElementById(id); el.className = `stat ${cls}`; el.querySelector('.v').textContent = v; };
  set('st-raw', F.dist(run.rmsRaw));
  set('st-kf', F.dist(run.rmsKf), run.rmsKf < run.rmsRaw ? 'good' : 'bad');
  set('st-turn', F.dist(run.turn), run.turn > 6 ? 'accent' : '');
  set('st-gain', F.pct(steadyGain({ q: S.q, r: S.r })));
  document.getElementById('q-val').textContent = `q = ${F.num(S.q, S.q < 0.1 ? 3 : 2)} m/s²`;
  document.getElementById('r-val').textContent = `${F.num(S.r, 1)} m`;
  const note = document.getElementById('phase-note');
  const st = now();
  const sd = Math.sqrt((st.P[0][0] + st.P[1][1]) / 2);
  if (S.t === T && S.phase === 'corrected' && !timer) note.innerHTML = 'The whole two-minute walk is shown. Press <b>Restart</b>, then <b>Predict</b> and <b>Correct</b> to step through it, or <b>Play</b>.';
  else if (S.t === 0) note.innerHTML = 'Start: the filter takes the first fix as its guess. Press <b>Predict</b>.';
  else if (S.phase === 'predicted') note.innerHTML = `Predicted second ${S.t}: moved on at ${F.num(Math.hypot(st.x[2], st.x[3]), 1)} m/s. Uncertainty grew to ±${F.num(sd, 1)} m. ${run.fixes[S.t] ? 'Now press <b>Correct</b>.' : '<b>No fix here</b> (tunnel): press Predict again.'}`;
  else note.innerHTML = run.fixes[S.t] ? `Corrected with the fix: moved <b>${F.pct(run.gains[S.t])}</b> of the way towards it. Uncertainty shrank to ±${F.num(sd, 1)} m.` : `No fix to correct with. Uncertainty ±${F.num(sd, 1)} m.`;
}

function draw() { renderStats(); walk.redraw(); errStage.redraw(); }

function predict() {
  if (S.t >= T) return;
  if (S.phase === 'predicted' && run.fixes[S.t]) correct();
  S.t += 1; S.phase = 'predicted'; draw();
}
function correct() {
  if (S.t === 0 || S.phase === 'corrected') return;
  S.phase = 'corrected'; draw();
}

document.getElementById('predict').addEventListener('click', () => { stop(); predict(); });
document.getElementById('correct').addEventListener('click', () => { stop(); correct(); });
document.getElementById('restart').addEventListener('click', () => { stop(); S.t = 0; S.phase = 'corrected'; draw(); });
let timer = null;
const playBtn = document.getElementById('play');
function stop() { if (timer) clearInterval(timer); timer = null; playBtn.textContent = 'Play'; }
playBtn.addEventListener('click', () => {
  if (timer) { stop(); return; }
  if (S.t >= T) { S.t = 0; S.phase = 'corrected'; }
  playBtn.textContent = 'Pause';
  timer = setInterval(() => {
    if (S.phase === 'predicted') correct();
    else if (S.t >= T) stop();
    else predict();
  }, 90);
});

const bind = (id, fn) => { const el = document.getElementById(id); paintRange(el); el.addEventListener('input', () => { fn(+el.value); simulate(); draw(); }); };
bind('q', (v) => { S.q = 10 ** v; });
bind('r', (v) => { S.r = v; });
document.getElementById('tunnel').addEventListener('change', (e) => { S.tunnel = e.target.checked; simulate(); draw(); });
onThemeChange(() => { walk.redraw(); errStage.redraw(); });
simulate();
S.t = T; S.phase = 'corrected';
draw();
