// Lab 5: city canyons — blocked signals, echoes (NLOS), a residual check, and code multipath.
import { C, CHIP_RATE_CA, CHIP_RATE_L5 } from '../core/constants.js';
import { makeSky, ecefToEnu } from '../core/geo.js';
import { measure } from '../core/world.js';
import { solveFix } from '../core/receiver.js';
import { dopFromSky } from '../core/dop.js';
import { sub, eig2 } from '../core/linalg.js';
import { gaussianSource } from '../core/rng.js';
import { composite, trackingError, envelope } from '../core/multipath.js';
import { createStage, label, tag, arrow, satelliteGlyph, phoneGlyph, fixGlyph } from '../ui/canvas.js';
import { palette, onThemeChange, alpha } from '../ui/theme.js';
import { skyLayout, skyToScreen, drawSkyGrid } from '../ui/sky.js';
import { lineChart, legend } from '../ui/chart.js';
import * as F from '../ui/format.js';
import { mountSite, labNav, paintRange } from '../ui/site.js';

mountSite('city');
document.getElementById('labnav').innerHTML = labNav('city');

const DEG = Math.PI / 180;
// The street runs north–south. Satellites by azimuth/elevation (degrees).
const SATS = [
  [12, 68], [75, 40], [118, 22], [165, 55], [200, 30], [248, 62],
  [285, 25], [330, 45], [350, 18], [95, 72], [178, 50], [5, 35],
].map(([az, el], i) => ({ id: i + 1, az, el }));
const NOISE = 1;          // ordinary noise per measurement, m
const BUILDING = '#56627a';
const THRESH = 3;         // residual check: flag if the rms mismatch exceeds this, m

const S = { H: 70, W: 24, pos: 0.3, echoes: true, raim: false };
let R = null;

// Classify every satellite as direct, echo or blocked, with the echo's extra path.
function classify() {
  const x = S.pos * S.W;
  return SATS.map((s) => {
    const ux = Math.cos(s.el * DEG) * Math.sin(s.az * DEG);   // east component of the direction
    const uz = Math.sin(s.el * DEG);
    const side = ux >= 0 ? 'E' : 'W';
    const ax = Math.abs(ux);
    const slope = ax < 1e-9 ? Infinity : uz / ax;            // metres climbed per metre across
    const dNear = side === 'E' ? S.W - x : x;                // to the wall that could block it
    const dFar = S.W - dNear;                                // to the wall that could reflect it
    const hitNear = dNear * slope;
    if (hitNear >= S.H || S.H === 0) return { ...s, side, slope, status: 'direct', hitNear };
    const hRefl = dFar * slope, clear = (dFar + S.W) * slope;
    if (S.echoes && hRefl < S.H && clear > S.H) {
      return { ...s, side, slope, status: 'echo', hitNear, hRefl, extra: 2 * dFar * ax };
    }
    return { ...s, side, slope, status: 'blocked', hitNear };
  });
}

function solveWithCheck(meas) {
  let used = meas.slice();
  const dropped = [];
  let fix = solveFix(used);
  if (!S.raim) return { fix, used, dropped };
  for (;;) {
    if (!fix.ok || used.length - fix.nUnknowns < 1) break;
    const red = used.length - fix.nUnknowns;
    const rms = Math.sqrt(fix.residuals.reduce((a, r) => a + r.r * r.r, 0) / red);
    if (rms <= THRESH) break;
    if (used.length - 1 < 4) break;
    const worst = fix.residuals.reduce((a, b) => (Math.abs(b.r) > Math.abs(a.r) ? b : a)).id;
    dropped.push(worst);
    used = used.filter((m) => m.id !== worst);
    fix = solveFix(used);
  }
  return { fix, used, dropped };
}

function compute() {
  const sats = classify();
  const heard = sats.filter((s) => s.status !== 'blocked');
  const sky = makeSky({ lat: 37.5, lon: 127 }, heard);
  const g = gaussianSource(17);
  const noise = Object.fromEntries(SATS.map((s) => [s.id, NOISE * g()]));
  const extra = Object.fromEntries(heard.map((s) => [s.id, noise[s.id] + (s.status === 'echo' ? s.extra : 0)]));
  // the phone stands at x across the street; put that offset into the true position
  const truth = sky.user;
  const meas = measure({ truePos: truth, clockError: 2e-4, sats: sky.sats, extra });
  const all = solveFix(meas);
  const checked = solveWithCheck(meas);
  const enu = (f) => (f && f.ok ? ecefToEnu(sub(f.pos, truth), sky.basis) : null);
  const usedIds = new Set(checked.used.map((m) => m.id));
  const dopAll = dopFromSky(heard);
  const dopUsed = dopFromSky(heard.filter((s) => usedIds.has(s.id)));
  R = { sats, heard, all, allE: enu(all), chk: checked, chkE: enu(checked.fix), dopAll, dopUsed };
}

// ── Cross-section ──
const section = createStage(document.getElementById('section'), {
  draw(ctx, w, h) {
    const P = palette();
    ctx.fillStyle = P.sky; ctx.fillRect(0, 0, w, h);
    const Bw = Math.max(14, S.W * 0.55);
    const k = Math.min((w - 40) / (S.W + 2 * Bw), (h - 56) / Math.max(40, S.H * 1.25));
    const gx = (w - S.W * k) / 2, gy = h - 30;
    const X = (x) => gx + x * k, Y = (z) => gy - z * k;
    // ground and buildings
    ctx.fillStyle = P.ground; ctx.fillRect(0, gy, w, h - gy);
    ctx.fillStyle = BUILDING;
    ctx.fillRect(X(-Bw) - 400, Y(S.H), Bw * k + 400, S.H * k);
    ctx.fillRect(X(S.W), Y(S.H), Bw * k + 400, S.H * k);
    ctx.fillStyle = alpha(P.sky, 0.25);
    for (let z = 4; z < S.H - 2; z += 7) for (const x0 of [X(-Bw) + 6, X(S.W) + 6]) for (let c = 0; c < 4; c++) ctx.fillRect(x0 + c * (Bw * k - 12) / 4, Y(z + 4), (Bw * k - 12) / 4 - 4, 4 * k > 3 ? 3 : 2);
    label(ctx, `${S.H} m`, X(-Bw) + 6, Y(S.H) - 10, { color: P.ink2, font: '600 11px Inter, sans-serif' });
    label(ctx, 'west', 10, gy + 14, { color: P.muted, font: '600 11px Inter, sans-serif' });
    label(ctx, 'east', w - 10, gy + 14, { color: P.muted, font: '600 11px Inter, sans-serif', align: 'right' });
    const x = S.pos * S.W;
    const px = X(x), py = gy - 1;
    // rays
    const edge = (x0, y0, dx, dy) => { // extend from (x0,y0) in direction (dx,dy) to the canvas edge
      let t = Infinity;
      if (dx > 0) t = Math.min(t, (w - x0) / dx); if (dx < 0) t = Math.min(t, -x0 / dx);
      if (dy < 0) t = Math.min(t, -y0 / dy);
      return [x0 + dx * t, y0 + dy * t];
    };
    for (const s of R.sats) {
      const sgn = s.side === 'E' ? 1 : -1;
      const ang = s.slope === Infinity ? Math.PI / 2 : Math.atan(s.slope);
      const dx = sgn * Math.cos(ang), dy = -Math.sin(ang);
      if (s.status === 'direct') {
        const [ex, ey] = edge(px, py, dx, dy);
        ctx.strokeStyle = alpha(P.s1, 0.85); ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.stroke();
        satelliteGlyph(ctx, ex - dx * 10, Math.max(12, ey - dy * 10), P.s1, { size: 5.5 });
      } else if (s.status === 'blocked') {
        const hx = X(s.side === 'E' ? S.W : 0), hy = Y(s.hitNear);
        ctx.strokeStyle = alpha(P.muted, 0.7); ctx.lineWidth = 1.3; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(hx, hy); ctx.stroke(); ctx.setLineDash([]);
        ctx.strokeStyle = P.bad; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(hx - 4, hy - 4); ctx.lineTo(hx + 4, hy + 4); ctx.moveTo(hx + 4, hy - 4); ctx.lineTo(hx - 4, hy + 4); ctx.stroke();
      } else {
        // echo: from the sky, over the near building, off the far wall, down to the phone
        const rx = X(s.side === 'E' ? 0 : S.W), ry = Y(s.hRefl);
        const [ex, ey] = edge(rx, ry, dx, dy);
        ctx.strokeStyle = P.accent; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(rx, ry); ctx.stroke();
        arrow(ctx, rx, ry, px + (rx - px) * 0.08, py + (ry - py) * 0.08, P.accent, { width: 2.2, head: 8 });
        satelliteGlyph(ctx, ex - dx * 10, Math.max(12, ey - dy * 10), P.accent, { size: 5.5 });
        tag(ctx, `+${F.num(s.extra, 1)} m`, rx + (s.side === 'E' ? 8 : -8), ry, { bg: P.accent, fg: '#fff', align: s.side === 'E' ? 'left' : 'right' });
      }
    }
    phoneGlyph(ctx, px, py - 10, P.true, P.sky, 0.85);
    // legend
    const items = [['direct', P.s1], ['echo only', P.accent], ['blocked', P.muted]];
    let lx = w - 12;
    ctx.font = '600 11.5px Inter, sans-serif';
    for (const [t, c] of items.reverse()) {
      const tw = ctx.measureText(t).width;
      label(ctx, t, lx - tw, 16, { color: c === P.muted ? P.muted : c, font: '600 11.5px Inter, sans-serif' });
      ctx.fillStyle = c; ctx.fillRect(lx - tw - 16, 13, 10, 4);
      lx -= tw + 30;
    }
  },
  onDown(p) { return dragPos(p); },
  onMove(p) { dragPos(p); },
  onHover() { return 'ew-resize'; },
});
function dragPos(p) {
  const w = section.w;
  const Bw = Math.max(14, S.W * 0.55);
  const k = Math.min((w - 40) / (S.W + 2 * Bw), (section.h - 56) / Math.max(40, S.H * 1.25));
  const gx = (w - S.W * k) / 2;
  S.pos = Math.max(0.05, Math.min(0.95, (p.x - gx) / k / S.W));
  document.getElementById('pos').value = S.pos;
  update();
  return true;
}

// ── Sky with the buildings' shadow ──
const skyStage = createStage(document.getElementById('sky'), {
  draw(ctx, w, h) {
    const P = palette();
    ctx.fillStyle = P.surface; ctx.fillRect(0, 0, w, h);
    const L = skyLayout(w, h, 26);
    drawSkyGrid(ctx, L);
    // mask: for every azimuth, how high the buildings reach
    const x = S.pos * S.W;
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, L.R, 0, Math.PI * 2);
    for (let a = 0; a <= 360; a += 2) {
      const sa = Math.sin(a * DEG);
      const d = sa >= 0 ? S.W - x : x;
      const m = S.H === 0 || Math.abs(sa) < 1e-6 ? 0 : Math.atan((S.H * Math.abs(sa)) / d) / DEG;
      const [sx, sy] = skyToScreen(L, a, m);
      a ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
    }
    ctx.closePath();
    ctx.fillStyle = alpha(BUILDING, 0.55);
    ctx.fill('evenodd');
    for (const s of R.sats) {
      const [sx, sy] = skyToScreen(L, s.az, s.el);
      const col = s.status === 'direct' ? P.s1 : s.status === 'echo' ? P.accent : P.muted;
      satelliteGlyph(ctx, sx, sy, col, { size: 6.5, dim: s.status === 'blocked' });
      const dropped = R.chk.dropped.includes(s.id);
      if (dropped) { ctx.strokeStyle = P.good; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(sx, sy, 13, 0, Math.PI * 2); ctx.stroke(); }
      label(ctx, `G${s.id}${dropped ? ' dropped' : ''}`, sx, sy + 15, { color: s.status === 'blocked' ? P.muted : P.ink, font: '600 10.5px Inter, sans-serif', align: 'center', halo: alpha(P.surface, 0.8) });
    }
  },
});

// ── Map from above ──
const map = createStage(document.getElementById('map'), {
  draw(ctx, w, h) {
    const P = palette();
    ctx.fillStyle = P.surface; ctx.fillRect(0, 0, w, h);
    const x = S.pos * S.W;
    const pts = [[0, 0]];
    if (R.allE) pts.push(R.allE);
    if (S.raim && R.chkE) pts.push(R.chkE);
    let span = Math.max(S.W * 0.9, 25);
    for (const p of pts) span = Math.max(span, Math.abs(p[0] + x - S.W / 2) * 1.25, Math.abs(p[1]) * 1.25);
    const k = (Math.min(w, h) / 2 - 24) / span;
    const cx = w / 2, cy = h / 2 + 8;
    const X = (e) => cx + (e - S.W / 2) * k, Y = (n) => cy - n * k;   // e measured from the west wall
    ctx.fillStyle = BUILDING;
    ctx.fillRect(0, 0, X(0), h);
    ctx.fillRect(X(S.W), 0, w - X(S.W), h);
    ctx.fillStyle = P.ground; ctx.fillRect(X(0), 0, S.W * k, h);
    ctx.strokeStyle = alpha(P.groundLine, 0.8); ctx.setLineDash([8, 8]);
    ctx.beginPath(); ctx.moveTo(X(S.W / 2), 0); ctx.lineTo(X(S.W / 2), h); ctx.stroke(); ctx.setLineDash([]);
    label(ctx, 'N ↑', 8, 16, { color: '#fff', font: '700 11px Inter, sans-serif' });
    // expected spread for the satellites used (σ = 3 m), as an ellipse at the receiver's answer
    const shown = S.raim ? R.chkE : R.allE;
    const dop = S.raim ? R.dopUsed : R.dopAll;
    if (shown && dop.ok) {
      const [[a, b], [, d]] = dop.covEN;
      const e = eig2(a, b, d);
      ctx.strokeStyle = alpha(S.raim ? P.good : P.accent, 0.8); ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(X(x + shown[0]), Y(shown[1]), Math.sqrt(e.l1) * 3 * k, Math.sqrt(Math.max(0, e.l2)) * 3 * k, -e.angle, 0, Math.PI * 2);
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (R.allE) { fixGlyph(ctx, X(x + R.allE[0]), Y(R.allE[1]), P.accent, 8); tag(ctx, 'every signal', X(x + R.allE[0]) + 12, Y(R.allE[1]) - 14, { bg: P.accent, fg: '#fff' }); }
    if (S.raim && R.chkE) { fixGlyph(ctx, X(x + R.chkE[0]), Y(R.chkE[1]), P.good, 8); tag(ctx, 'after check', X(x + R.chkE[0]) + 12, Y(R.chkE[1]) + 14, { bg: P.good, fg: '#fff' }); }
    phoneGlyph(ctx, X(x), Y(0), P.true, P.ground, 0.85);
    // scale
    const sb = span > 60 ? 20 : 10;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(10, h - 14); ctx.lineTo(10 + sb * k, h - 14); ctx.stroke();
    label(ctx, `${sb} m`, 14 + sb * k, h - 14, { color: '#fff', font: '600 11px Inter, sans-serif' });
  },
});

function setStat(id, v, d, cls = '') {
  const el = document.getElementById(id);
  el.className = `stat ${cls}`;
  el.querySelector('.v').innerHTML = v;
  el.querySelector('.d').innerHTML = d;
}
function renderStats() {
  const n = (st) => R.sats.filter((s) => s.status === st).length;
  setStat('st-sats', `${n('direct')} direct · ${n('echo')} echo`, `${n('blocked')} hidden behind buildings`);
  const desc = (e) => `${F.dist(Math.abs(e[0]))} across, ${F.dist(Math.abs(e[1]))} along`;
  if (R.allE) setStat('st-all', F.dist(Math.hypot(R.allE[0], R.allE[1])), desc(R.allE), Math.hypot(R.allE[0], R.allE[1]) > 10 ? 'accent' : '');
  else setStat('st-all', 'No fix', `${R.heard.length} signals: needs 4`, 'bad');
  if (!S.raim) setStat('st-raim', 'Off', 'switch on the residual check');
  else if (!R.chkE) setStat('st-raim', 'No fix', 'not enough satellites', 'bad');
  else {
    const e = Math.hypot(R.chkE[0], R.chkE[1]);
    const names = R.chk.dropped.map((id) => `G${id}${R.sats.find((s) => s.id === id).status === 'echo' ? ' (an echo ✓)' : ' (a good one ✗)'}`);
    setStat('st-raim', F.dist(e), R.chk.dropped.length ? `dropped ${names.join(', ')}` : (R.chk.fix.have - R.chk.fix.nUnknowns >= 1 ? 'nothing looked wrong' : 'no spare satellites to check with'), e < 8 ? 'good' : 'accent');
  }
  const dop = S.raim ? R.dopUsed : R.dopAll;
  setStat('st-dop', dop.ok ? `${F.num(dop.east, 1)} across · ${F.num(dop.north, 1)} along` : '—', dop.ok ? 'bigger number = errors stretched that way' : 'not enough satellites');
}

// ── Multipath: the bent peak and the envelope ──
const RX = {
  l1w: { name: 'L1, standard', chip: C / CHIP_RATE_CA, d: 1 },
  l1n: { name: 'L1, narrow', chip: C / CHIP_RATE_CA, d: 0.1 },
  l5: { name: 'L5', chip: C / CHIP_RATE_L5, d: 1 },
};
const M = { extra: 60, amp: 0.5, phase: 0, rx: 'l1w' };
const peak = createStage(document.getElementById('peak'), {
  draw(ctx, w, h) {
    const P = palette();
    ctx.fillStyle = P.surface; ctx.fillRect(0, 0, w, h);
    const rx = RX[M.rx];
    const delta = M.extra / rx.chip, phase = M.phase ? Math.PI : 0;
    const tau = trackingError(delta, M.amp, phase, rx.d);
    const xmin = -1.4, xmax = Math.max(1.6, Math.min(delta + 1.3, 3));
    const pts = (f) => { const out = []; for (let i = 0; i <= 300; i++) { const t = xmin + ((xmax - xmin) * i) / 300; out.push([t, f(t)]); } return out; };
    const box = { x: 40, y: 34, w: w - 56, h: h - 80 };
    const ys = [-0.9, 1.6];
    const { sx, sy } = lineChart(ctx, box, {
      x: { min: xmin, max: xmax, label: `offset of the copy (chips; 1 chip = ${F.num(rx.chip, 1)} m)`, format: (v) => F.num(v, 1), count: 5 },
      y: { min: ys[0], max: ys[1], format: (v) => F.num(v, 1), count: 4 },
      series: [
        { points: pts((t) => composite(t, 0, 0, 0)), color: alpha(P.muted, 0.9), width: 1.4, dash: [4, 3] },
        { points: pts((t) => M.amp * Math.cos(phase) * composite(t - delta, 0, 0, 0)), color: P.accent, width: 1.4, dash: [4, 3] },
        { points: pts((t) => composite(t, delta, M.amp, phase)), color: P.ink, width: 2.6 },
      ],
      vlines: [{ x: 0, color: P.muted, dash: [2, 3], width: 1 }, { x: tau, color: P.good, dash: [], width: 2, label: `locks ${F.dist(Math.abs(tau * rx.chip))} ${tau >= 0 ? 'late' : 'early'}` }],
      dots: [{ x: tau - rx.d / 2, y: composite(tau - rx.d / 2, delta, M.amp, phase), color: P.good }, { x: tau + rx.d / 2, y: composite(tau + rx.d / 2, delta, M.amp, phase), color: P.good }],
    });
    void sx; void sy;
    legend(ctx, [{ label: 'direct', color: P.muted, dash: [4, 3] }, { label: 'echo', color: P.accent, dash: [4, 3] }, { label: 'what arrives', color: P.ink }], w - 12, 16);
  },
});
const env = createStage(document.getElementById('env'), {
  draw(ctx, w, h) {
    const P = palette();
    ctx.fillStyle = P.surface; ctx.fillRect(0, 0, w, h);
    const box = { x: 46, y: 34, w: w - 62, h: h - 80 };
    const series = [];
    const cols = { l1w: P.s1, l1n: P.s5, l5: P.s3 };
    let ymax = 10;
    for (const key of Object.keys(RX)) {
      const rx = RX[key];
      const e = envelope({ chipMetres: rx.chip, spacing: rx.d, amp: M.amp, maxExtra: 500, points: 250 });
      ymax = Math.max(ymax, ...e.map((p) => Math.max(Math.abs(p.constructive), Math.abs(p.destructive))));
      const strong = key === M.rx;
      series.push({ points: e.map((p) => [p.extra, p.constructive]), color: alpha(cols[key], strong ? 1 : 0.35), width: strong ? 2.6 : 1.4 });
      series.push({ points: e.map((p) => [p.extra, p.destructive]), color: alpha(cols[key], strong ? 1 : 0.35), width: strong ? 2.6 : 1.4 });
    }
    ymax *= 1.1;
    const rx = RX[M.rx];
    const tau = trackingError(M.extra / rx.chip, M.amp, M.phase ? Math.PI : 0, rx.d) * rx.chip;
    lineChart(ctx, box, {
      x: { min: 0, max: 500, label: 'echo’s extra path (m)', format: (v) => F.num(v, 0) },
      y: { min: -ymax, max: ymax, format: (v) => F.num(v, 0), count: 4 },
      series,
      hlines: [{ y: 0, color: P.lineStrong, dash: [], width: 1 }],
      vlines: [{ x: M.extra, color: P.ink, dash: [3, 3], width: 1.2 }],
      dots: [{ x: M.extra, y: tau, color: cols[M.rx], r: 5, ring: P.surface }],
    });
    legend(ctx, [{ label: 'L1 standard', color: P.s1 }, { label: 'L1 narrow', color: P.s5 }, { label: 'L5', color: P.s3 }], w - 12, 16);
  },
});

// ── Controls ──
const bind = (id, fn) => { const el = document.getElementById(id); el._paint = paintRange(el); el.addEventListener('input', () => fn(+el.value)); return el; };
const posEl = bind('pos', (v) => { S.pos = v; update(); });
bind('height', (v) => { S.H = v; update(); });
bind('width', (v) => { S.W = v; update(); });
document.getElementById('echoes').addEventListener('change', (e) => { S.echoes = e.target.checked; update(); });
document.getElementById('raim').addEventListener('change', (e) => { S.raim = e.target.checked; update(); });
bind('extra', (v) => { M.extra = v; renderMP(); });
bind('amp', (v) => { M.amp = v; renderMP(); });
const seg = (id, key, attr) => document.querySelectorAll(`#${id} button`).forEach((b) => b.addEventListener('click', () => {
  M[key] = attr === 'ph' ? +b.dataset.ph : b.dataset.rx;
  document.querySelectorAll(`#${id} button`).forEach((q) => q.setAttribute('aria-pressed', q === b));
  renderMP();
}));
seg('phase', 'phase', 'ph');
seg('rx', 'rx', 'rx');

function renderMP() {
  document.getElementById('extra-val').textContent = `${M.extra} m`;
  document.getElementById('amp-val').textContent = `${Math.round(M.amp * 100)}%`;
  peak.redraw(); env.redraw();
}

function update() {
  compute();
  document.getElementById('height-val').textContent = `${S.H} m`;
  document.getElementById('width-val').textContent = `${S.W} m`;
  document.getElementById('pos-val').textContent = `${F.num(S.pos * S.W, 1)} m from the west side`;
  posEl._paint();
  renderStats();
  section.redraw(); skyStage.redraw(); map.redraw();
}
onThemeChange(() => { section.redraw(); skyStage.redraw(); map.redraw(); peak.redraw(); env.redraw(); });
update();
renderMP();
