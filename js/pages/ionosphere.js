// Lab 4: the ionosphere — the Klobuchar model, where the delay goes, and two frequencies.
import { klobuchar, gpsSecondsForLocalTime, GAMMA_L1_L5, IF_WEIGHTS, IF_NOISE_FACTOR, ionoFromPair, ionoFree } from '../core/iono.js';
import { makeSky, ecefToEnu } from '../core/geo.js';
import { measure } from '../core/world.js';
import { solveFix } from '../core/receiver.js';
import { sub } from '../core/linalg.js';
import { gaussianSource } from '../core/rng.js';
import { createStage, label, roundRect, satelliteGlyph, phoneGlyph } from '../ui/canvas.js';
import { palette, onThemeChange, alpha } from '../ui/theme.js';
import { lineChart } from '../ui/chart.js';
import * as F from '../ui/format.js';
import { mountSite, labNav, paintRange } from '../ui/site.js';

mountSite('ionosphere');
document.getElementById('labnav').innerHTML = labNav('ionosphere');

const LAT = 37.5, LON = 127, AZ = 180;
const S = { hour: 14, elev: 30, model: 'slant', zen: 6, solveClk: true, noise: 1 };
const delayAt = (hour, elev) => klobuchar({ latDeg: LAT, lonDeg: LON, azDeg: AZ, elDeg: elev, gpsSeconds: gpsSecondsForLocalTime(hour, LON) });
const slantFactor = (elDeg) => 1 + 16 * (0.53 - elDeg / 180) ** 3;

// ── Part 1 ──
const day = createStage(document.getElementById('day'), {
  draw(ctx, w, h) {
    const P = palette();
    ctx.fillStyle = P.surface; ctx.fillRect(0, 0, w, h);
    const pts = [], zen = [];
    for (let t = 0; t <= 24.001; t += 0.1) { pts.push([t, delayAt(t, S.elev).metres]); zen.push([t, delayAt(t, 90).metres]); }
    const ymax = Math.max(...pts.map((p) => p[1]), ...zen.map((p) => p[1])) * 1.15;
    const box = { x: 52, y: 40, w: w - 70, h: h - 84 };
    const cur = delayAt(S.hour, S.elev).metres;
    lineChart(ctx, box, {
      x: { min: 0, max: 24, ticks: [0, 4, 8, 12, 16, 20, 24], format: (v) => `${String(v).padStart(2, '0')}:00`, label: 'local time' },
      y: { min: 0, max: ymax, format: (v) => `${F.num(v, 0)} m`, count: 4 },
      series: [
        { points: zen, color: P.muted, dash: [5, 4], width: 1.6 },
        { points: pts, color: P.s5, width: 2.8, fill: alpha(P.s5, 0.12) },
      ],
      vlines: [{ x: S.hour, color: P.ink, label: hh(S.hour) }],
      dots: [{ x: S.hour, y: cur, color: P.s5, r: 5.5 }],
    });
    label(ctx, `at ${S.elev}° elevation`, box.x + box.w - 4, box.y + 4, { color: P.s5, font: '600 11.5px Inter, sans-serif', align: 'right' });
    label(ctx, 'straight up (dashed)', box.x + box.w - 4, box.y + 20, { color: P.muted, font: '600 11.5px Inter, sans-serif', align: 'right' });
  },
});
const hh = (x) => `${String(Math.floor(x) % 24).padStart(2, '0')}:${String(Math.round((x % 1) * 60)).padStart(2, '0')}`;

const side = createStage(document.getElementById('side'), {
  draw(ctx, w, h) {
    const P = palette();
    ctx.fillStyle = P.sky; ctx.fillRect(0, 0, w, h);
    const gx = w * 0.72, gy = h - 34;          // the phone
    const layer0 = gy - h * 0.38, layer1 = gy - h * 0.6; // the charged layer (heights exaggerated)
    ctx.fillStyle = alpha(P.s5, 0.16);
    ctx.fillRect(0, layer1, w, layer0 - layer1);
    label(ctx, 'ionosphere', 10, (layer0 + layer1) / 2, { color: P.s5, font: '600 11.5px Inter, sans-serif' });
    ctx.fillStyle = P.ground; ctx.fillRect(0, gy, w, h - gy);
    ctx.strokeStyle = P.groundLine; ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
    const el = (S.elev * Math.PI) / 180;
    const dir = [-Math.cos(el), -Math.sin(el)];
    const len = (gy - 18) / Math.sin(el);
    const end = [gx + dir[0] * len, gy + dir[1] * len];
    // the signal
    ctx.strokeStyle = alpha(P.ink2, 0.6); ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(end[0], end[1]); ctx.stroke(); ctx.setLineDash([]);
    const t0 = (gy - layer0) / Math.sin(el), t1 = (gy - layer1) / Math.sin(el);
    ctx.strokeStyle = P.s5; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(gx + dir[0] * t0, gy + dir[1] * t0); ctx.lineTo(gx + dir[0] * t1, gy + dir[1] * t1); ctx.stroke();
    // straight-up path through the layer, for comparison
    ctx.strokeStyle = alpha(P.muted, 0.9); ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(gx + 26, layer0); ctx.lineTo(gx + 26, layer1); ctx.stroke();
    label(ctx, 'straight up', gx + 34, (layer0 + layer1) / 2, { color: P.muted, font: '600 11px Inter, sans-serif' });
    satelliteGlyph(ctx, Math.max(16, end[0]), Math.max(14, end[1]), P.s1, { size: 7 });
    phoneGlyph(ctx, gx, gy - 10, P.true, P.sky, 0.8);
    label(ctx, `${S.elev}°`, gx - 34, gy - 10, { color: P.ink, font: '700 12px Inter, sans-serif' });
  },
});

function renderPart1() {
  const k = delayAt(S.hour, S.elev);
  document.getElementById('hour-val').textContent = hh(S.hour);
  document.getElementById('elev-val').textContent = `${S.elev}°`;
  const st = document.getElementById('st-l1');
  st.querySelector('.v').textContent = F.dist(k.metres);
  st.querySelector('.d').textContent = `${F.num(k.seconds * 1e9, 1)} ns late · on L5 ×${F.num(GAMMA_L1_L5, 2)} = ${F.dist(k.metres * GAMMA_L1_L5)}${k.night ? ' · night floor' : ''}`;
  document.getElementById('st-slant').querySelector('.v').textContent = `× ${F.num(k.slant, 2)}`;
  day.redraw(); side.redraw();
}

// ── Part 2: where does the delay go? ──
const SKY = [[10, 72], [60, 25], [115, 48], [170, 18], [215, 55], [260, 12], [300, 35], [345, 20]].map(([az, el], i) => ({ id: i + 1, az, el }));
const sky = makeSky({ lat: LAT, lon: LON }, SKY);
let whereRes = null;
function computeWhere() {
  const extra = {};
  for (const s of SKY) extra[s.id] = S.zen * (S.model === 'same' ? slantFactor(45) : slantFactor(s.el));
  const meas0 = measure({ truePos: sky.user, clockError: 0, sats: sky.sats });
  const meas = measure({ truePos: sky.user, clockError: 0, sats: sky.sats, extra });
  const opts = S.solveClk ? {} : { solveClock: false };
  const a = solveFix(meas0, opts), b = solveFix(meas, opts);
  const enu = ecefToEnu(sub(b.pos, a.pos), sky.basis);
  const mean = Object.values(extra).reduce((p, q) => p + q, 0) / SKY.length;
  whereRes = { enu, clock: S.solveClk ? b.clock - a.clock : 0, mean, extra };
}
const where = createStage(document.getElementById('where'), {
  draw(ctx, w, h) {
    const P = palette();
    ctx.fillStyle = P.surface; ctx.fillRect(0, 0, w, h);
    const r = whereRes;
    const rows = [
      { name: 'Average delay added', v: r.mean, c: P.s5 },
      { name: 'Went into the clock', v: r.clock, c: P.good },
      { name: 'Moved you east', v: r.enu[0], c: P.accent },
      { name: 'Moved you north', v: r.enu[1], c: P.accent },
      { name: 'Moved you up', v: r.enu[2], c: P.accent },
    ];
    const max = Math.max(5, ...rows.map((q) => Math.abs(q.v))) * 1.15;
    const left = Math.min(200, w * 0.3), zero = left + (w - left - 30) / 2, half = (w - left - 30) / 2;
    const top = 40, rowH = (h - top - 22) / rows.length;
    ctx.strokeStyle = P.lineStrong; ctx.beginPath(); ctx.moveTo(zero, top - 8); ctx.lineTo(zero, h - 18); ctx.stroke();
    rows.forEach((q, i) => {
      const y = top + i * rowH + rowH / 2;
      label(ctx, q.name, left - 10, y, { color: P.ink2, font: '600 12.5px Inter, sans-serif', align: 'right' });
      const bw = (q.v / max) * half;
      ctx.fillStyle = alpha(q.c, 0.9);
      roundRect(ctx, Math.min(zero, zero + bw), y - rowH * 0.28, Math.max(1.5, Math.abs(bw)), rowH * 0.56, 4);
      ctx.fill();
      label(ctx, F.dist(q.v, { sign: true }), zero + bw + (bw >= 0 ? 8 : -8), y, { color: P.ink, font: '600 12px JetBrains Mono, monospace', align: bw >= 0 ? 'left' : 'right' });
    });
  },
});

// ── Part 3: one frequency or two ──
let freqRes = null;
function computeFreq() {
  const I = delayAt(S.hour, S.elev).metres;
  const g = gaussianSource(7);
  let a = 0, b = 0, c = 0;
  const N = 2000;
  for (let t = 0; t < N; t++) {
    const n1 = S.noise * g(), n5 = S.noise * g();
    a += (I + n1) ** 2;                         // L1 alone, no correction
    b += (I / 2 + n1) ** 2;                     // L1 with a model that removes half
    c += (IF_WEIGHTS[0] * n1 + IF_WEIGHTS[1] * n5) ** 2; // L1 + L5 combined: I cancels
  }
  freqRes = { I, rms: [Math.sqrt(a / N), Math.sqrt(b / N), Math.sqrt(c / N)] };
  // one worked example
  const g2 = gaussianSource(3);
  const rho = 22000000, n1 = S.noise * g2(), n5 = S.noise * g2();
  const R1 = rho + I + n1, R5 = rho + GAMMA_L1_L5 * I + n5;
  document.getElementById('worked').innerHTML = `<b>One measurement.</b> True distance 22,000,000.00 m, delay on L1 ${F.num(I, 2)} m.<br>
    L1 measures <span class="num">${F.num(R1, 2)}</span> m, L5 measures <span class="num">${F.num(R5, 2)}</span> m.<br>
    Delay worked out from the gap: (R5 − R1) ÷ ${F.num(GAMMA_L1_L5 - 1, 4)} = <b class="num">${F.num(ionoFromPair(R1, R5), 2)} m</b>.<br>
    Corrected distance: <b class="num">${F.num(ionoFree(R1, R5), 2)} m</b> (off by ${F.dist(ionoFree(R1, R5) - rho, { sign: true })}).`;
  document.getElementById('iused').textContent = `${F.dist(I)} on L1 at ${hh(S.hour)}, ${S.elev}°`;
}
const freq = createStage(document.getElementById('freq'), {
  draw(ctx, w, h) {
    const P = palette();
    ctx.fillStyle = P.surface; ctx.fillRect(0, 0, w, h);
    const r = freqRes;
    const rows = [
      { name: 'L1 only, no correction', v: r.rms[0], c: P.s5 },
      { name: 'L1 + broadcast model (½ removed)', v: r.rms[1], c: P.s1 },
      { name: `L1 + L5 combined (noise × ${F.num(IF_NOISE_FACTOR, 2)})`, v: r.rms[2], c: P.s3 },
    ];
    const best = rows.reduce((p, q) => (q.v < p.v ? q : p));
    const max = Math.max(...rows.map((q) => q.v)) * 1.25;
    const left = Math.min(260, w * 0.4), top = 44, rowH = (h - top - 24) / rows.length;
    rows.forEach((q, i) => {
      const y = top + i * rowH + rowH / 2;
      label(ctx, q.name, left - 10, y, { color: P.ink2, font: `${q === best ? 700 : 500} 12.5px Inter, sans-serif`, align: 'right' });
      const bw = (q.v / max) * (w - left - 80);
      ctx.fillStyle = alpha(q.c, 0.9);
      roundRect(ctx, left, y - rowH * 0.27, bw, rowH * 0.54, 4); ctx.fill();
      label(ctx, `${F.dist(q.v)}${q === best ? '  ← smallest' : ''}`, left + bw + 8, y, { color: q === best ? P.good : P.ink, font: '600 12px JetBrains Mono, monospace' });
    });
  },
});

// ── Controls ──
const bind = (id, key, after) => {
  const el = document.getElementById(id);
  paintRange(el);
  el.addEventListener('input', () => { S[key] = +el.value; after(); });
};
bind('hour', 'hour', () => { renderPart1(); computeFreq(); freq.redraw(); });
bind('elev', 'elev', () => { renderPart1(); computeFreq(); freq.redraw(); });
bind('zen', 'zen', () => { document.getElementById('zen-val').textContent = F.dist(S.zen); computeWhere(); where.redraw(); });
bind('noise', 'noise', () => { document.getElementById('noise-val').textContent = F.dist(S.noise); computeFreq(); freq.redraw(); });
document.querySelectorAll('#model button').forEach((b) => b.addEventListener('click', () => {
  S.model = b.dataset.m;
  document.querySelectorAll('#model button').forEach((q) => q.setAttribute('aria-pressed', q === b));
  computeWhere(); where.redraw();
}));
document.getElementById('solveclk').addEventListener('change', (e) => { S.solveClk = e.target.checked; computeWhere(); where.redraw(); });

onThemeChange(() => { day.redraw(); side.redraw(); where.redraw(); freq.redraw(); });
document.getElementById('zen-val').textContent = F.dist(S.zen);
document.getElementById('noise-val').textContent = F.dist(S.noise);
renderPart1();
computeWhere();
computeFreq();
where.redraw();
freq.redraw();
