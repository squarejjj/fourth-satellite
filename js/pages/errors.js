// Lab 3: the error budget, with the receiver clock as the biggest error of all.
import { C } from '../core/constants.js';
import { BUDGET_1995, rss, varianceShares, twoDrms } from '../core/errors.js';
import { IF_NOISE_FACTOR } from '../core/iono.js';
import { makeSky, ecefToEnu } from '../core/geo.js';
import { measure } from '../core/world.js';
import { solveFix } from '../core/receiver.js';
import { dopFromSky } from '../core/dop.js';
import { sub } from '../core/linalg.js';
import { gaussianSource } from '../core/rng.js';
import { createStage, label, roundRect } from '../ui/canvas.js';
import { palette, onThemeChange, alpha } from '../ui/theme.js';
import * as F from '../ui/format.js';
import { mountSite, labNav, paintRange } from '../ui/site.js';

mountSite('errors');
document.getElementById('labnav').innerHTML = labNav('errors');

const base = Object.fromEntries(BUDGET_1995.map((e) => [e.key, e.sigma]));
const PRESETS = {
  sa: { note: 'National Research Council 1995, Table 3-1: civilian GPS with selective availability on.', v: { ...base }, on: { sa: true } },
  off: { note: 'Table 3-3: the same with selective availability off (as it has been since May 2000).', v: { ...base }, on: { sa: false } },
  klob: { note: 'SA off, and the broadcast ionosphere model removing about half the delay (Navipedia’s figure).', v: { ...base, iono: 3.5 }, on: { sa: false } },
  dual: { note: `SA off, ionosphere removed by combining L1 and L5, which multiplies noise and multipath by ${F.num(IF_NOISE_FACTOR, 2)}.`, v: { ...base, iono: 0, noise: 1.5 * IF_NOISE_FACTOR, multipath: 1.2 * IF_NOISE_FACTOR }, on: { sa: false } },
  city: { note: 'SA off, with ~20 m echo errors per satellite, as measured on a phone in Hong Kong street canyons (L1).', v: { ...base, multipath: 20 }, on: { sa: false } },
};

const S = {
  fourth: false,
  clockMs: 0.5,
  hdop: 2,
  v: { ...base },
  on: Object.fromEntries(BUDGET_1995.map((e) => [e.key, e.key !== 'sa'])),
  preset: 'off',
};
let shownMax = null; // animated axis maximum
const SHORT = { sa: 'Selective availability', iono: 'Ionosphere', clockEph: 'Satellite clock, orbit', noise: 'Receiver noise', multipath: 'Multipath', tropo: 'Troposphere' };

function terms() {
  const list = BUDGET_1995.map((e) => ({ key: e.key, label: e.label, v: S.on[e.key] ? S.v[e.key] : 0, on: S.on[e.key] }));
  const clock = S.fourth ? 0 : S.clockMs * 1e-3 * C;
  return { list, clock };
}

// ── Controls for each error source ──
const ctl = document.getElementById('sources-ctl');
function buildControls() {
  ctl.innerHTML = '';
  for (const e of BUDGET_1995) {
    const row = document.createElement('div');
    row.className = 'control';
    row.innerHTML = `<label class="switch" style="justify-content:space-between"><span style="display:flex;gap:10px;align-items:center"><input type="checkbox" ${S.on[e.key] ? 'checked' : ''}> ${e.label}</span><span class="val">${F.num(S.v[e.key], 1)} m</span></label>
      <input type="range" min="0" max="30" step="0.1" value="${S.v[e.key]}" aria-label="${e.label} size in metres">`;
    const [cb, rng] = row.querySelectorAll('input');
    const val = row.querySelector('.val');
    const paint = paintRange(rng);
    cb.addEventListener('change', () => { S.on[e.key] = cb.checked; update(); });
    rng.addEventListener('input', () => { S.v[e.key] = +rng.value; val.textContent = `${F.num(S.v[e.key], 1)} m`; paint(); update(); });
    row.style.opacity = S.on[e.key] ? 1 : 0.55;
    cb.addEventListener('change', () => { row.style.opacity = cb.checked ? 1 : 0.55; });
    ctl.append(row);
  }
}

document.getElementById('presets').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  applyPreset(b.dataset.p);
});
function applyPreset(p) {
  const pr = PRESETS[p];
  S.preset = p;
  S.v = { ...pr.v };
  S.on = Object.fromEntries(BUDGET_1995.map((e) => [e.key, e.key === 'sa' ? pr.on.sa : S.v[e.key] > 0]));
  document.getElementById('preset-note').textContent = pr.note;
  document.querySelectorAll('#presets button').forEach((q) => q.classList.toggle('primary', q.dataset.p === p));
  buildControls();
  update();
}

const fourthEl = document.getElementById('fourth');
fourthEl.addEventListener('change', () => { S.fourth = fourthEl.checked; document.getElementById('clk').closest('.control').style.opacity = S.fourth ? 0.45 : 1; update(); });
const clk = document.getElementById('clk');
paintRange(clk);
clk.addEventListener('input', () => { S.clockMs = +clk.value; update(); });
const hd = document.getElementById('hdop');
paintRange(hd);
hd.addEventListener('input', () => { S.hdop = +hd.value; update(); });

// ── Bars ──
const bars = createStage(document.getElementById('bars'), {
  draw(ctx, w, h) {
    const P = palette();
    ctx.fillStyle = P.surface; ctx.fillRect(0, 0, w, h);
    const { list, clock } = terms();
    const uere = rss([...list.map((t) => t.v), clock]);
    const rows = [
      { label: S.fourth ? 'Phone’s clock (solved)' : 'Phone’s clock', v: clock, color: P.accent, clock: true },
      ...list.map((t, i) => ({ label: SHORT[t.key], v: t.v, color: [P.s5, P.s1, P.s4, P.s6, P.s3, P.s2][i], off: !t.on })),
      { label: 'Total (root-sum-square)', v: uere, color: P.ink, total: true },
    ];
    const target = Math.max(1, ...rows.map((r) => r.v)) * 1.12;
    if (shownMax === null) shownMax = target;
    const left = Math.min(190, w * 0.32), right = w - 20, top = 44, bottom = h - 64;
    const rowH = (bottom - top) / rows.length;
    const k = (right - left - 70) / shownMax;
    // axis ticks
    ctx.font = '500 11px Inter, sans-serif';
    const step = niceStep(shownMax / 4);
    for (let v = 0; v <= shownMax; v += step) {
      const x = left + v * k;
      ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, top - 6); ctx.lineTo(x, bottom); ctx.stroke();
      label(ctx, F.dist(v), x, bottom + 12, { color: P.muted, font: '500 11px Inter, sans-serif', align: 'center' });
    }
    rows.forEach((r, i) => {
      const y = top + i * rowH + rowH / 2;
      label(ctx, r.label, left - 10, y, { color: r.off ? P.muted : P.ink2, font: `${r.total || r.clock ? 700 : 500} 12.5px Inter, sans-serif`, align: 'right' });
      const bw = Math.max(r.v > 0 ? 2 : 0, r.v * k);
      ctx.fillStyle = r.total ? P.ink : alpha(r.color, r.off ? 0.25 : 0.9);
      roundRect(ctx, left, y - rowH * 0.3, bw, rowH * 0.6, 4);
      ctx.fill();
      const txt = r.clock && S.fourth ? '0 m  ✓ removed' : r.off ? 'off' : F.dist(r.v);
      label(ctx, txt, left + bw + 8, y, { color: r.clock && S.fourth ? P.good : P.ink, font: '600 12px JetBrains Mono, monospace' });
    });
    // variance shares (excluding nothing): who dominates the total
    const vals = rows.slice(0, -1).map((r) => r.v);
    const shares = varianceShares(vals);
    let x = left;
    const sy = h - 30, sw = right - left;
    label(ctx, 'share of the total', left - 10, sy + 7, { color: P.muted, font: '600 11.5px Inter, sans-serif', align: 'right' });
    shares.forEach((s, i) => {
      if (s <= 0) return;
      ctx.fillStyle = rows[i].clock ? P.accent : alpha(rows[i].color, 0.9);
      ctx.fillRect(x, sy, s * sw, 14);
      if (s * sw > 54) label(ctx, F.pct(s), x + 5, sy + 7.5, { color: '#fff', font: '700 10.5px Inter, sans-serif' });
      x += s * sw;
    });
    if (Math.abs(shownMax - target) > target * 0.002) {
      shownMax += (target - shownMax) * 0.18;
      bars.redraw();
    } else shownMax = target;
  },
});
const niceStep = (x) => {
  const p = 10 ** Math.floor(Math.log10(x));
  return [1, 2, 5, 10].map((m) => m * p).find((v) => v >= x) || p;
};

function setStat(id, v, d, cls = '') {
  const el = document.getElementById(id);
  el.className = `stat ${cls}`;
  el.querySelector('.v').innerHTML = v;
  if (d !== undefined) el.querySelector('.d').innerHTML = d;
}

function renderStats() {
  const { list, clock } = terms();
  const vals = [clock, ...list.map((t) => t.v)];
  const uere = rss(vals);
  const sum = vals.reduce((a, b) => a + b, 0);
  setStat('st-uere', F.dist(uere), S.fourth ? 'square root of the sum of squares' : 'swamped by the clock', S.fourth ? '' : 'bad');
  setStat('st-sum', F.dist(sum));
  setStat('st-horiz', S.fourth ? F.dist(twoDrms(uere, S.hdop)) : 'unusable', S.fourth ? `2 × HDOP ${F.num(S.hdop, 1)} × UERE` : 'every distance is off by the clock error');
  const shares = varianceShares(vals);
  const names = ['the phone’s clock', ...list.map((t) => t.label.split(' (')[0].toLowerCase())];
  const top = shares.indexOf(Math.max(...shares));
  setStat('st-top', names[top], `${F.pct(shares[top], 1)} of the total variance`);
  document.getElementById('clk-val').textContent = `${F.num(S.clockMs, 2)} ms = ${F.dist(S.clockMs * 1e-3 * C)}`;
  document.getElementById('hdop-val').textContent = F.num(S.hdop, 1);
}

// ── Check with the real solver ──
const SKY = [[10, 72], [60, 25], [115, 48], [170, 18], [215, 55], [260, 12], [300, 35], [345, 20]].map(([az, el], i) => ({ id: i + 1, az, el }));
document.getElementById('check').addEventListener('click', () => {
  const { list, clock } = terms();
  const sky = makeSky({ lat: 37.5, lon: 127 }, SKY);
  const dop = dopFromSky(SKY);
  const g = gaussianSource(99);
  let se = 0, sn = 0, meanE = 0, meanN = 0;
  const N = 500;
  for (let t = 0; t < N; t++) {
    const extra = {};
    for (const s of SKY) extra[s.id] = list.reduce((acc, term) => acc + term.v * g(), 0);
    const meas = measure({ truePos: sky.user, clockError: S.fourth ? 3e-4 : S.clockMs * 1e-3, sats: sky.sats, extra });
    const fix = S.fourth ? solveFix(meas) : solveFix(meas, { solveClock: false });
    const [e, n] = ecefToEnu(sub(fix.pos, sky.user), sky.basis);
    se += e * e; sn += n * n; meanE += e / N; meanN += n / N;
  }
  const rmsH = Math.sqrt((se + sn) / N);
  const uere = rss(list.map((t) => t.v));
  const out = document.getElementById('check-out');
  if (S.fourth) {
    out.innerHTML = `This sky has HDOP <b>${F.num(dop.hdop, 2)}</b>, so the rule predicts 2 drms ≈ 2 × ${F.num(dop.hdop, 2)} × ${F.num(uere, 2)} m = <b>${F.dist(2 * dop.hdop * uere)}</b>. The solver’s 500 fixes gave <b>${F.dist(2 * rmsH)}</b>. (The receiver also solved a 0.3 ms clock error each time.)`;
  } else {
    out.innerHTML = `Trusting its clock, the solver’s fixes were on average <b>${F.dist(Math.hypot(meanE, meanN))}</b> from the truth sideways, all pushed the same way, and much more in height. The clock’s ${F.dist(clock)} on every distance has nowhere to go but into the position. Switch on the fourth satellite and run it again.`;
  }
});

function update() {
  renderStats();
  bars.redraw();
}
onThemeChange(() => bars.redraw());
applyPreset('off');
