// The home page: the clock puzzle.
// A flat slice through the Earth and the GPS orbits, drawn to scale. The simulator (world.js)
// makes the measurements; the receiver (receiver.js) solves them; this file only draws and
// handles the controls.

import { C, R_EARTH, R_GPS } from '../core/constants.js';
import { measure } from '../core/world.js';
import { solveFix, solutionCurve2D, circleIntersections } from '../core/receiver.js';
import { norm, sub } from '../core/linalg.js';
import { createStage, satelliteGlyph, phoneGlyph, fixGlyph, tag, label, arrow } from '../ui/canvas.js';
import { palette, onThemeChange, alpha } from '../ui/theme.js';
import { lineChart, legend } from '../ui/chart.js';
import * as F from '../ui/format.js';
import { mountSite, LABS, href, paintRange } from '../ui/site.js';

mountSite('home');

const DEG = Math.PI / 180;
const polar = (r, deg) => [r * Math.cos(deg * DEG), r * Math.sin(deg * DEG)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const START = () => ({
  phone: 90,
  sats: [
    { id: 1, short: 'S1', name: 'Satellite 1', angle: 128, on: true },
    { id: 2, short: 'S2', name: 'Satellite 2', angle: 50, on: true },
    { id: 3, short: 'S3', name: 'Satellite 3', angle: 97, on: false },
    { id: 4, short: 'S4', name: 'Satellite 4', angle: 24, on: false },
  ],
  clockMs: 0,
  mode: 'trust',
  step: 1,
  done: {},
  showCurve: true,
  showRaw: true,
  zoom: 600e3, // half-width of the close-up, metres
});
let S = START();
let anim = null;      // the "Solve" animation in progress
let trail = null;     // the solver's guesses, shown after a solve
let cur = null;       // everything computed from S

// ───────────────────────── Computation ─────────────────────────

function compute() {
  const P = polar(R_EARTH, S.phone);
  const up = [Math.cos(S.phone * DEG), Math.sin(S.phone * DEG)];
  const right = [Math.sin(S.phone * DEG), -Math.cos(S.phone * DEG)];
  const sats = S.sats.map((s, i) => {
    const pos = polar(R_GPS, s.angle);
    const d = sub(pos, P);
    const range = norm(d);
    const el = Math.asin((d[0] * up[0] + d[1] * up[1]) / range) / DEG;
    const visible = el > 0;
    return { ...s, i, pos, el, visible, heard: s.on && visible, range };
  });
  const heard = sats.filter((s) => s.heard);
  // THE WORLD: turn the truth into measurements …
  const meas = measure({ truePos: P, clockError: S.clockMs / 1000, sats: heard.map((s) => ({ id: s.id, pos: s.pos })) });
  // … and THE RECEIVER: solve them, two ways.
  const trust = meas.length >= 2 ? solveFix(meas, { solveClock: false }) : null;
  const solve = meas.length >= 3 ? solveFix(meas) : null;
  const fix = S.mode === 'solve' ? solve : trust;
  const curve = meas.length === 2 ? solutionCurve2D(meas[0], meas[1], -2.4e6, 2.4e6, 480, [0, 0]) : null;
  return { P, up, right, sats, heard, meas, trust, solve, fix, curve };
}

// What the receiver is showing right now (the solve animation overrides the final answer).
function shown() {
  if (anim) return { pos: anim.pos, clock: anim.clock, k: anim.k };
  if (!cur.fix || !cur.fix.ok) return null;
  return { pos: cur.fix.pos, clock: S.mode === 'solve' ? cur.fix.clock : 0 };
}

// Where the circles (corrected by the clock estimate) cross, pair by pair.
function crossings(est) {
  const pts = [];
  const ms = cur.meas;
  for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
    const hit = circleIntersections(ms[i].sat, ms[i].pr - est, ms[j].sat, ms[j].pr - est);
    if (!hit) continue;
    pts.push(norm(hit[0]) < norm(hit[1]) ? hit[0] : hit[1]);
  }
  return pts;
}

// ───────────────────────── Space view ─────────────────────────

const STARS = Array.from({ length: 90 }, (_, i) => [((i * 7919) % 1000) / 1000, ((i * 104729) % 997) / 997, (i % 3) * 0.35 + 0.4]);
let spaceGeom = null;

const space = createStage(document.getElementById('space'), {
  draw: drawSpace,
  onDown(p) {
    const g = spaceGeom;
    if (!g) return false;
    let best = null;
    cur.sats.forEach((s) => {
      const [x, y] = g.toScr(s.pos);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < 22 && (!best || d < best.d)) best = { d, what: 'sat', s };
    });
    const [px, py] = g.toScr(cur.P);
    const dp = Math.hypot(p.x - px, p.y - py);
    if (dp < 22 && (!best || dp < best.d)) best = { d: dp, what: 'phone' };
    if (!best) return false;
    dragging = best;
    stopAnim();
    return true;
  },
  onMove(p) {
    if (!dragging) return;
    const g = spaceGeom;
    const ang = Math.atan2(-(p.y - g.cy), p.x - g.cx) / DEG;
    if (dragging.what === 'phone') S.phone = ang;
    else S.sats[dragging.s.i].angle = ang;
    trail = null;
    if (S.step === 1) markDone(1);
    update();
  },
  onUp() { dragging = null; },
  onHover(p) {
    const g = spaceGeom;
    if (!g) return null;
    const near = cur.sats.some((s) => { const [x, y] = g.toScr(s.pos); return Math.hypot(p.x - x, p.y - y) < 22; });
    const [px, py] = g.toScr(cur.P);
    return near || Math.hypot(p.x - px, p.y - py) < 22 ? 'grab' : null;
  },
});
let dragging = null;

function drawSpace(ctx, w, h) {
  if (!cur) return;
  const P = palette();
  // Earth sits a little low, because the satellites you can hear are above you.
  const cx = w / 2, cy = Math.min(h * 0.6, h / 2 + w * 0.1);
  const k = Math.min(w / 2 - 16, cy - 38) / R_GPS;
  const toScr = (X) => [cx + X[0] * k, cy - X[1] * k];
  spaceGeom = { cx, cy, k, toScr };
  const est = shown();
  const clockEst = est ? est.clock : 0;

  // background stars
  ctx.fillStyle = P.space;
  ctx.fillRect(0, 0, w, h);
  for (const [sx, sy, a] of STARS) {
    ctx.fillStyle = `rgba(220,230,255,${a * 0.5})`;
    ctx.fillRect(sx * w, sy * h, 1.4, 1.4);
  }
  // orbit ring
  ctx.strokeStyle = 'rgba(180,200,240,0.28)';
  ctx.setLineDash([3, 5]);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, R_GPS * k, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);

  // your horizon: satellites below this line can't be heard
  const [px, py] = toScr(cur.P);
  const t = [-cur.up[1], cur.up[0]];
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(px - t[0] * w * 2, py + t[1] * w * 2);
  ctx.lineTo(px + t[0] * w * 2, py - t[1] * w * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // the Earth
  const er = R_EARTH * k;
  const grad = ctx.createRadialGradient(cx - er * 0.35, cy - er * 0.35, er * 0.1, cx, cy, er);
  grad.addColorStop(0, P.earth1);
  grad.addColorStop(1, P.earth2);
  ctx.fillStyle = 'rgba(120,180,255,0.10)';
  ctx.beginPath(); ctx.arc(cx, cy, er + 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(cx, cy, er, 0, Math.PI * 2); ctx.fill();

  // circles of distance (measured, minus the receiver's clock estimate)
  cur.meas.forEach((m) => {
    const s = cur.sats.find((q) => q.id === m.id);
    const [sx, sy] = toScr(m.sat);
    ctx.strokeStyle = alpha(P.sat[s.i], 0.75);
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(sx, sy, Math.max(0, (m.pr - clockEst) * k), 0, Math.PI * 2); ctx.stroke();
  });
  // lines of sight
  cur.sats.forEach((s) => {
    if (!s.heard) return;
    const [sx, sy] = toScr(s.pos);
    ctx.strokeStyle = alpha(P.sat[s.i], 0.35);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(sx, sy); ctx.stroke();
  });

  // the solver's guesses, starting from the centre of the Earth
  const path = anim ? anim.path : trail;
  if (path && path.length) {
    ctx.strokeStyle = alpha(P.accent, 0.8);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    path.forEach((q, i) => { const [x, y] = toScr(q); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.setLineDash([]);
    path.forEach((q, i) => {
      const [x, y] = toScr(q);
      ctx.fillStyle = P.accent;
      ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fill();
      if (i === 0) label(ctx, 'first guess: Earth’s centre', x + 7, y + 12, { color: '#ffd2c2', font: '600 11px Inter, sans-serif' });
    });
  }

  // satellites
  cur.sats.forEach((s) => {
    const [sx, sy] = toScr(s.pos);
    const col = P.sat[s.i];
    const rot = Math.atan2(sy - cy, sx - cx) + Math.PI / 2;
    satelliteGlyph(ctx, sx, sy, s.on ? col : '#8a96b3', { size: 8, dim: !s.heard, angle: rot });
    const out = [sx + (sx - cx) * 0.09, sy + (sy - cy) * 0.09];
    let text = s.short;
    if (!s.on) text += ' · off';
    else if (!s.visible) text += ' · below horizon';
    ctx.font = '600 11.5px Inter, sans-serif';
    const half = ctx.measureText(text).width / 2 + 4;
    const lx = Math.max(half, Math.min(w - half, out[0])), ly = Math.max(40, Math.min(h - 30, out[1]));
    label(ctx, text, lx, ly, { color: s.heard ? '#eef3ff' : '#8f9bb8', font: '600 11.5px Inter, sans-serif', align: 'center', halo: 'rgba(11,18,34,0.85)' });
  });

  // the receiver's current answer (if it is visible at this scale)
  if (est) {
    const [fx, fy] = toScr(est.pos);
    if (Math.hypot(fx - px, fy - py) > 6) fixGlyph(ctx, fx, fy, P.accent, 6);
  }
  // you
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath(); ctx.arc(px, py, 13, 0, Math.PI * 2); ctx.fill();
  phoneGlyph(ctx, px, py, '#ffffff', P.earth2, 0.9);
  label(ctx, 'You', px + cur.up[0] * 24, py - cur.up[1] * 24, { color: '#ffffff', font: '700 12px Inter, sans-serif', align: 'center', halo: 'rgba(11,18,34,0.85)' });
}

// ───────────────────────── Close-up ─────────────────────────

const close = createStage(document.getElementById('close'), { draw: drawClose });

function drawClose(ctx, w, h) {
  if (!cur) return;
  const P = palette();
  const cx = w / 2, cy = h * 0.6;
  const k = w / 2 / S.zoom;
  const toScr = (X) => {
    const d = sub(X, cur.P);
    return [cx + (d[0] * cur.right[0] + d[1] * cur.right[1]) * k, cy - (d[0] * cur.up[0] + d[1] * cur.up[1]) * k];
  };
  const inView = ([x, y], m = 0) => x >= -m && x <= w + m && y >= -m && y <= h + m;
  const est = shown();
  const clockEst = est ? est.clock : 0;

  ctx.fillStyle = P.sky;
  ctx.fillRect(0, 0, w, h);

  // the ground: the curved surface of the Earth around you
  const span = (S.zoom * 3) / R_EARTH;
  const ground = [];
  for (let i = 0; i <= 160; i++) {
    const a = S.phone * DEG + span - (2 * span * i) / 160;
    ground.push(toScr([R_EARTH * Math.cos(a), R_EARTH * Math.sin(a)]));
  }
  ctx.beginPath();
  ctx.moveTo(ground[0][0], ground[0][1]);
  ground.forEach((g) => ctx.lineTo(g[0], g[1]));
  ctx.lineTo(w + 100, h + 400); ctx.lineTo(-100, h + 400); ctx.closePath();
  ctx.fillStyle = P.ground;
  ctx.fill();
  ctx.strokeStyle = P.groundLine;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ground.forEach((g, i) => (i ? ctx.lineTo(g[0], g[1]) : ctx.moveTo(g[0], g[1])));
  ctx.stroke();
  label(ctx, 'ground', 12, Math.min(h - 14, cy + 22), { color: P.muted, font: '600 11px Inter, sans-serif' });

  // the curve of every place that fits two signals (one point per clock error)
  if (cur.curve && S.showCurve && S.step >= 2) {
    ctx.strokeStyle = P.ink2;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    let pen = false, labelAt = null;
    for (const c of cur.curve) {
      const q = toScr(c.p);
      if (!inView(q, 400)) { pen = false; continue; }
      if (!pen) { ctx.moveTo(q[0], q[1]); pen = true; } else ctx.lineTo(q[0], q[1]);
      if (q[1] > 70 && q[1] < cy - 40 && q[0] > 30 && q[0] < w - 30 && (!labelAt || q[1] < labelAt[1])) labelAt = q;
    }
    ctx.stroke();
    ctx.setLineDash([]);
    if (labelAt) {
      const left = labelAt[0] > w / 2;
      tag(ctx, 'every place that fits 2 signals', labelAt[0] + (left ? -8 : 8), Math.max(labelAt[1], 58), { bg: alpha(P.surface, 0.92), fg: P.ink2, align: left ? 'right' : 'left' });
    }
  }

  // circles: dashed = straight from the measurements, solid = after removing the clock estimate
  const drawCircle = (m, radius, col, dashed) => {
    const a0 = Math.atan2(cur.P[1] - m.sat[1], cur.P[0] - m.sat[0]);
    const halfSpan = (S.zoom * 2.6) / Math.max(radius, 1);
    const pts = [];
    for (let i = 0; i <= 200; i++) {
      const a = a0 - halfSpan + (2 * halfSpan * i) / 200;
      pts.push(toScr([m.sat[0] + radius * Math.cos(a), m.sat[1] + radius * Math.sin(a)]));
    }
    ctx.strokeStyle = col;
    ctx.lineWidth = dashed ? 1.5 : 2.6;
    ctx.setLineDash(dashed ? [5, 5] : []);
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.stroke();
    ctx.setLineDash([]);
    return pts;
  };
  const corrected = Math.abs(clockEst) > 1;
  if (corrected && S.showRaw) cur.meas.forEach((m) => { const s = cur.sats.find((q) => q.id === m.id); drawCircle(m, m.pr, alpha(P.sat[s.i], 0.45), true); });
  const tags = [];
  cur.meas.forEach((m) => {
    const s = cur.sats.find((q) => q.id === m.id);
    const pts = drawCircle(m, m.pr - clockEst, P.sat[s.i], false);
    // label each circle near the top of the view
    let best = null;
    for (const p of pts) if (p[0] > 26 && p[0] < w - 60 && p[1] > 34 && p[1] < cy - 20 && (!best || p[1] < best[1])) best = p;
    if (best) tags.push({ s, p: best });
  });

  // where the circles disagree: shade the region between their crossings
  if (cur.meas.length >= 3) {
    const pts = crossings(clockEst).map(toScr);
    const hull = convexHull(pts);
    if (hull.length >= 3) {
      ctx.fillStyle = alpha(P.accent, 0.16);
      ctx.beginPath();
      hull.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = P.accent;
    pts.forEach((p) => { if (inView(p)) { ctx.beginPath(); ctx.arc(p[0], p[1], 3, 0, Math.PI * 2); ctx.fill(); } });
  }

  // you (the truth)
  phoneGlyph(ctx, cx, cy, P.true, P.sky, 1.05);
  label(ctx, 'You', cx - 13, cy + 1, { color: P.true, font: '700 12.5px Inter, sans-serif', align: 'right', halo: P.sky });

  // where the phone thinks it is
  if (est) {
    const q = toScr(est.pos);
    const errM = norm(sub(est.pos, cur.P));
    if (inView(q, -8)) {
      const apart = Math.hypot(q[0] - cx, q[1] - cy) > 14;
      if (apart) {
        ctx.strokeStyle = alpha(P.accent, 0.9);
        ctx.setLineDash([3, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(q[0], q[1]); ctx.stroke();
        ctx.setLineDash([]);
      }
      fixGlyph(ctx, q[0], q[1], P.accent, 9);
      const below = q[1] > cy;
      tag(ctx, apart ? `phone’s answer · ${F.dist(errM)} off` : 'phone’s answer', q[0] + 15, q[1] + (below ? 16 : -16), { bg: P.accent, fg: '#fff' });
    } else {
      // off screen: point to it from the edge
      const ang = Math.atan2(q[1] - cy, q[0] - cx);
      const r = Math.min(w, h) * 0.4;
      const ex = cx + Math.cos(ang) * r, ey = cy + Math.sin(ang) * r;
      arrow(ctx, cx + Math.cos(ang) * (r - 40), cy + Math.sin(ang) * (r - 40), ex, ey, P.accent, { width: 2.5, head: 10 });
      tag(ctx, `phone’s answer: ${F.dist(errM)} this way`, Math.min(Math.max(ex, 90), w - 90), ey + (Math.sin(ang) > 0 ? -18 : 18), { bg: P.accent, fg: '#fff', align: 'center' });
    }
  }
  for (const t of tags) tag(ctx, t.s.short, t.p[0] + 6, t.p[1] + 2, { bg: P.sat[t.s.i], fg: '#fff' });

  // scale bar
  const target = w * 0.26 / k;
  const pow = 10 ** Math.floor(Math.log10(target));
  const nice = [1, 2, 5, 10].map((m) => m * pow).filter((v) => v <= target).pop() || pow;
  const bw = nice * k;
  const bx = w - bw - 16, by = h - 18;
  ctx.strokeStyle = P.ink;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(bx, by - 5); ctx.lineTo(bx, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by - 5); ctx.stroke();
  label(ctx, F.dist(nice), bx + bw / 2, by - 11, { color: P.ink, font: '600 11.5px Inter, sans-serif', align: 'center', halo: P.ground });
}

function convexHull(points) {
  const p = points.filter((q) => Number.isFinite(q[0]) && Number.isFinite(q[1])).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.slice().reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// ───────────────────────── Chart: error vs clock error ─────────────────────────

let sweepData = null;
const sweepStage = createStage(document.getElementById('sweep'), { draw: drawSweep });

function computeSweep() {
  const sats = cur.heard.map((s) => ({ id: s.id, pos: s.pos }));
  const xs = Array.from({ length: 81 }, (_, i) => -1 + i * 0.025);
  const trust = [], solve = [];
  for (const x of xs) {
    const m = measure({ truePos: cur.P, clockError: x / 1000, sats });
    const t = m.length >= 2 ? solveFix(m, { solveClock: false }) : null;
    const s = m.length >= 3 ? solveFix(m) : null;
    trust.push([x, t && t.ok ? norm(sub(t.pos, cur.P)) / 1000 : NaN]);
    solve.push([x, s && s.ok ? norm(sub(s.pos, cur.P)) / 1000 : NaN]);
  }
  sweepData = { trust, solve, n: sats.length };
}

function drawSweep(ctx, w, h) {
  const P = palette();
  ctx.fillStyle = P.surface;
  ctx.fillRect(0, 0, w, h);
  if (!sweepData) return;
  const box = { x: 62, y: 34, w: w - 80, h: h - 82 };
  const finite = sweepData.trust.map((p) => p[1]).filter(Number.isFinite);
  const ymax = Math.max(10, ...finite) * 1.08;
  lineChart(ctx, box, {
    x: { min: -1, max: 1, label: 'phone’s clock error (milliseconds)', format: (v) => F.num(v, 1) },
    y: { min: 0, max: ymax, label: 'position error (km)', format: (v) => F.num(v, 0) },
    series: [
      { points: sweepData.trust, color: P.accent, width: 2.6 },
      { points: sweepData.solve, color: P.good, width: 3 },
    ],
    vlines: [{ x: S.clockMs, color: P.ink, label: `now: ${F.signed(S.clockMs, 2)} ms` }],
    dots: [
      ...(Number.isFinite(at(sweepData.trust)) ? [{ x: S.clockMs, y: at(sweepData.trust), color: P.accent }] : []),
      ...(Number.isFinite(at(sweepData.solve)) ? [{ x: S.clockMs, y: at(sweepData.solve), color: P.good }] : []),
    ],
  });
  legend(ctx, [
    { label: 'trusting its clock', color: P.accent },
    { label: sweepData.n >= 3 ? 'solving for the time' : 'solving for the time (needs 3)', color: P.good, dash: sweepData.n >= 3 ? [] : [3, 3] },
  ], w - 14, 14);
}
const at = (series) => {
  const i = Math.round((S.clockMs + 1) / 0.025);
  return series[Math.max(0, Math.min(series.length - 1, i))][1];
};

// ───────────────────────── The guided steps ─────────────────────────

const stepsEl = document.getElementById('steps');
const STEP_TITLES = ['Time becomes distance', 'Your phone’s clock is cheap', 'Add one more satellite', 'Solve for the time too'];

function travelLine(id) {
  const m = cur.meas.find((q) => q.id === id);
  if (!m) return '';
  const s = cur.sats.find((q) => q.id === id);
  return `${s.name}’s signal took <b class="num">${F.num((m.pr / C) * 1000, 3)} ms</b> → <b class="num">${F.num(m.pr / 1000, 0)} km</b>.`;
}

function stepHtml() {
  const st = S.step;
  const fixErr = cur.fix && cur.fix.ok ? norm(sub(cur.fix.pos, cur.P)) : NaN;
  const bias = (S.clockMs / 1000) * C;
  let body = '', task = '', taskDone = !!S.done[st], live = '', liveClass = '', extra = '';
  if (st === 1) {
    body = `<p>Each satellite broadcasts the exact time it sent its signal. Your phone notes when the signal arrives. <b>Travel time × speed of light = distance.</b></p>
      <p>So you are somewhere on a circle around each satellite. Where two circles cross, near the Earth, is you.</p>`;
    task = 'Drag a satellite or your phone in the space view.';
    live = `${travelLine(1)} ${travelLine(2)}`;
    if (cur.meas.length < 2) { live = 'One of the two satellites is below your horizon, so the phone can’t hear it. Drag it back up into your sky.'; liveClass = 'warn'; }
  } else if (st === 2) {
    body = `<p>The satellites carry atomic clocks. Your phone has a cheap quartz crystal that drifts. Light covers about <b>300 km in a thousandth of a second</b>, so a tiny clock error is a huge distance error.</p>
      <p>If the phone’s clock runs ahead, every signal seems to take longer, so <b>every circle grows by the same amount</b>.</p>`;
    task = 'Move the clock slider away from zero.';
    if (Math.abs(S.clockMs) < 0.05) live = 'Try +0.30 ms: a clock just three ten-thousandths of a second fast.';
    else if (cur.fix && cur.fix.ok) {
      live = `Every circle is now <b>${F.dist(Math.abs(bias))} too ${bias > 0 ? 'big' : 'small'}</b>. They still cross, <b>${F.dist(fixErr)} from where you are</b>, and nothing looks wrong. The dashed line is every place that fits these two signals, one for each possible clock error. Two satellites can’t tell them apart.`;
    }
  } else if (st === 3) {
    body = `<p>Two circles always cross somewhere, so the phone had no way to notice its mistake. A third satellite changes that.</p>`;
    task = 'Switch on Satellite 3.';
    const s3 = cur.sats[2];
    if (!s3.on) live = 'Satellite 3 is the grey one in the space view. Use its button below.';
    else if (!s3.visible) { live = 'Satellite 3 is below your horizon, so the phone can’t hear it. Drag it up into your sky.'; liveClass = 'warn'; }
    else {
      const pts = crossings(0);
      let spread = 0;
      for (const a of pts) for (const b of pts) spread = Math.max(spread, norm(sub(a, b)));
      live = `Three circles, and no point where all three meet: they miss each other by up to <b>${F.dist(spread)}</b>. That mismatch is the clock error giving itself away.`;
    }
  } else if (st === 4) {
    body = `<p>So the phone treats its own clock error as one more unknown. It guesses, checks every circle against its guess, corrects, and repeats, until all the circles meet at one point. Real receivers do exactly this.</p>`;
    task = 'Press “Solve for position and time”.';
    extra = `<button class="btn ${S.done[4] ? 'sm' : 'accent pulse'}" type="button" id="solve-btn" style="margin-top:12px;width:100%">${S.done[4] ? 'Watch it solve again' : 'Solve for position and time'}</button>`;
    if (anim) {
      const e = norm(sub(anim.pos, cur.P));
      live = `Guess ${anim.k} of ${anim.n}: <b>${F.dist(e)}</b> from where you are, clock estimate <b class="num">${F.signed(anim.clock / C * 1000, 3)} ms</b>.`;
    } else if (S.done[4] && cur.solve && cur.solve.ok) {
      const errS = norm(sub(cur.solve.pos, cur.P));
      liveClass = 'good';
      live = `Clock error found: <b class="num">${F.signed((cur.solve.clock / C) * 1000, 3)} ms</b> (truth: ${F.signed(S.clockMs, 3)} ms). Position: <b>${F.dist(errS)}</b> from you, after ${cur.solve.iterations.length - 1} guesses.<br><br><b>That is the fourth satellite.</b> On this flat slice it takes 3: x, y and the time. The real world adds height, so your phone needs <b>4</b>. <a href="#three-d">See it in 3-D ↓</a>`;
    } else if (cur.meas.length < 3) {
      live = 'The phone needs to hear three satellites here. Switch Satellite 3 on, or drag it above your horizon.';
      liveClass = 'warn';
    }
  } else {
    body = `<p>Everything is unlocked. Things to try:</p>
      <ul style="padding-left:1.1em;margin:0">
        <li>Drag two satellites close together. The circles cross at a shallow angle, so the answer gets touchy (more in <a href="labs/geometry.html">Lab 2</a>).</li>
        <li>Switch satellites off until two are left. The dashed line shows every place that fits.</li>
        <li>Turn the clock to ±1 ms and flip between the two buttons under “What the phone does”.</li>
        <li>Drag a satellite below your horizon: the phone can’t hear it any more.</li>
      </ul>`;
    if (cur.fix && cur.fix.ok) {
      live = S.mode === 'solve'
        ? `Solving for the time: ${F.dist(fixErr)} from the truth, clock estimate ${F.signed((cur.fix.clock / C) * 1000, 3)} ms.`
        : `Trusting its clock: ${F.dist(fixErr)} from the truth.`;
      liveClass = S.mode === 'solve' && fixErr < 1 ? 'good' : '';
    } else if (cur.fix && cur.fix.reason === 'too-few') {
      live = `Not enough satellites: ${cur.fix.nUnknowns} unknowns but only ${cur.fix.have} heard.`;
      liveClass = 'warn';
    } else if (!cur.fix) {
      live = S.mode === 'solve' ? 'Solving for the time needs at least 3 satellites here.' : 'Trusting its clock still needs at least 2 satellites here.';
      liveClass = 'warn';
    }
    extra = `<button class="btn ${S.mode === 'solve' ? 'accent' : ''}" type="button" id="solve-btn" style="margin-top:12px;width:100%">${S.mode === 'solve' ? 'Replay the solve, guess by guess' : 'Solve for position and time'}</button>`;
  }

  const dots = [1, 2, 3, 4].map((i) => `<button type="button" class="${S.step === i ? 'now' : S.done[i] ? 'done' : ''}" data-step="${i}" aria-label="Step ${i}: ${STEP_TITLES[i - 1]}">${i}</button><span class="line"></span>`).join('')
    + `<button type="button" class="free ${S.step === 5 ? 'now' : ''}" data-step="5">Explore</button>`;
  const title = st <= 4 ? STEP_TITLES[st - 1] : 'Explore on your own';
  return `<div class="step-dots">${dots}</div>
    <div class="step-title">${st <= 4 ? `${st}. ` : ''}${title}</div>
    <div class="step-body">${body}</div>
    ${task ? `<div class="task ${taskDone ? 'done' : ''}"><span class="tick"></span><span>${task}</span></div>` : ''}
    ${live ? `<div class="live ${liveClass}">${live}</div>` : ''}
    ${extra}
    <div class="step-nav">
      <button class="btn ghost sm" type="button" data-go="${st - 1}" ${st === 1 ? 'disabled' : ''}>← Back</button>
      ${st < 5 ? `<button class="btn ${taskDone ? 'primary' : ''} sm" type="button" data-go="${st + 1}">${st === 4 ? 'Explore freely →' : 'Next →'}</button>` : `<button class="btn sm" type="button" data-go="1">Start the tour again</button>`}
    </div>`;
}

stepsEl.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.step) goStep(+b.dataset.step);
  else if (b.dataset.go) goStep(+b.dataset.go);
  else if (b.id === 'solve-btn') startSolve();
});

function goStep(n) {
  n = Math.max(1, Math.min(5, n));
  stopAnim();
  trail = null;
  if (n === 1 && S.step !== 1) { S.clockMs = 0; }
  if (n <= 3) S.mode = 'trust';
  if (n <= 2) { S.sats[2].on = false; S.sats[3].on = false; }
  if (n === 3 && Math.abs(S.clockMs) < 0.05) S.clockMs = 0.3;
  if (n === 4) {
    if (Math.abs(S.clockMs) < 0.05) S.clockMs = 0.3;
    S.sats[2].on = true;
    S.mode = S.done[4] ? 'solve' : 'trust';
  }
  if (n === 5) S.mode = 'solve';
  S.step = n;
  update();
  if (n === 3 || n === 4) fitZoom();
}

// Zoom the close-up so the phone's (wrong) answer and the circles' disagreement fill it nicely.
function fitZoom() {
  if (!cur.trust || !cur.trust.ok) return;
  let r = norm(sub(cur.trust.pos, cur.P));
  for (const p of crossings(0)) r = Math.max(r, norm(sub(p, cur.P)));
  S.zoom = Math.min(1500e3, Math.max(120e3, r * 2.2));
  close.redraw();
}

function markDone(n) {
  if (!S.done[n]) { S.done[n] = true; }
}

// ───────────────────────── Solve animation ─────────────────────────

function startSolve() {
  stopAnim();
  if (cur.meas.length < 3) { update(); return; }
  S.mode = 'solve';
  const fix = solveFix(cur.meas);
  if (!fix.ok) { update(); return; }
  const its = fix.iterations;
  const per = reduceMotion ? 220 : 900;
  anim = { its, t0: performance.now(), per, n: its.length - 1, k: 0, pos: its[0].pos, clock: its[0].clocks[0], path: [its[0].pos] };
  tick();
}

function tick() {
  if (!anim) return;
  const t = (performance.now() - anim.t0) / anim.per;
  const k = Math.floor(t);
  if (k >= anim.n) {
    trail = anim.its.map((it) => it.pos);
    anim = null;
    if (S.step === 4) markDone(4);
    update();
    return;
  }
  const f = Math.min(1, (t - k) / 0.7);
  const e = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
  const a = anim.its[k], b = anim.its[k + 1];
  anim.k = k + 1;
  anim.pos = a.pos.map((v, i) => v + (b.pos[i] - v) * e);
  anim.clock = a.clocks[0] + (b.clocks[0] - a.clocks[0]) * e;
  anim.path = anim.its.slice(0, k + 1).map((it) => it.pos).concat([anim.pos]);
  // follow the guess: zoom the close-up out while it is far away, back in as it arrives
  const far = norm(sub(anim.pos, cur.P));
  S.zoom = Math.min(3000e3, Math.max(600e3, far * 1.35));
  renderAll();
  requestAnimationFrame(tick);
}

function stopAnim() {
  if (anim) { anim = null; S.zoom = 600e3; }
}

// ───────────────────────── Controls ─────────────────────────

const clockEl = document.getElementById('clock');
const repaintClock = paintRange(clockEl);
clockEl.addEventListener('input', () => {
  stopAnim();
  trail = null;
  S.clockMs = +clockEl.value;
  if (S.step === 2 && Math.abs(S.clockMs) >= 0.05) markDone(2);
  update();
});

const chipsEl = document.getElementById('chips');
chipsEl.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  stopAnim();
  trail = null;
  const s = S.sats[+b.dataset.i];
  s.on = !s.on;
  if (S.step === 3 && S.sats[2].on) markDone(3);
  update();
});

document.querySelectorAll('#ctl-mode button').forEach((b) => b.addEventListener('click', () => {
  stopAnim();
  trail = null;
  S.mode = b.dataset.mode;
  if (S.mode === 'solve' && S.step === 4) { startSolve(); return; }
  update();
}));
document.getElementById('show-curve').addEventListener('change', (e) => { S.showCurve = e.target.checked; renderAll(); });
document.getElementById('show-raw').addEventListener('change', (e) => { S.showRaw = e.target.checked; renderAll(); });
document.getElementById('reset').addEventListener('click', () => { stopAnim(); trail = null; S = START(); update(); });
document.getElementById('zoom-in').addEventListener('click', () => { S.zoom = Math.max(20e3, S.zoom / 2); close.redraw(); });
document.getElementById('zoom-out').addEventListener('click', () => { S.zoom = Math.min(4000e3, S.zoom * 2); close.redraw(); });

function renderControls() {
  clockEl.value = S.clockMs;
  repaintClock();
  const bias = (S.clockMs / 1000) * C;
  document.getElementById('clock-val').textContent = `${F.signed(S.clockMs, 2)} ms`;
  document.getElementById('clock-sub').innerHTML = Math.abs(S.clockMs) < 0.005
    ? '0 ms: the phone’s clock agrees with the satellites.'
    : `${S.clockMs > 0 ? 'Fast' : 'Slow'} by ${F.num(Math.abs(S.clockMs), 2)} ms, so every distance is <b>${F.dist(Math.abs(bias))}</b> too ${bias > 0 ? 'long' : 'short'}.`;
  const lockClock = S.step === 1;
  document.getElementById('ctl-clock').classList.toggle('disabled', lockClock);
  clockEl.disabled = lockClock;

  const P = palette();
  chipsEl.innerHTML = '';
  S.sats.forEach((s, i) => {
    if (i === 3 && S.step < 5 && !s.on) return; // the fourth one appears in free play
    const c = cur.sats[i];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip${c.visible ? '' : ' blocked'}${S.step === 3 && i === 2 && !s.on ? ' pulse' : ''}`;
    b.style.setProperty('--c', P.sat[i]);
    b.dataset.i = i;
    b.setAttribute('aria-pressed', s.on);
    b.disabled = S.step < 3 || (S.step === 3 && i !== 2);
    b.innerHTML = `<span class="dot"></span>${s.name}${c.visible ? '' : ' (below horizon)'}`;
    chipsEl.append(b);
  });
  document.getElementById('ctl-sats').classList.toggle('disabled', S.step < 3);
  document.querySelectorAll('#ctl-mode button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === S.mode));
  document.getElementById('ctl-mode').classList.toggle('disabled', S.step < 4);
}

function renderStats() {
  const set = (id, v, d, cls = '') => {
    const el = document.getElementById(id);
    el.className = `stat ${cls}`;
    el.querySelector('.v').innerHTML = v;
    el.querySelector('.d').innerHTML = d;
  };
  const est = shown();
  if (est) {
    const e = norm(sub(est.pos, cur.P));
    set('st-err', `${F.dist(e)} away`, anim ? `guess ${anim.k} of ${anim.n}` : 'from where you really are', e < 1 ? 'good' : 'accent');
  } else if (S.mode === 'solve' && cur.meas.length < 3) {
    set('st-err', 'Can’t tell', `${cur.meas.length} satellites for 3 unknowns`, 'bad');
  } else {
    set('st-err', 'Can’t tell', 'not enough satellites heard', 'bad');
  }
  const truth = `${F.signed(S.clockMs, 2)} ms`;
  if (S.mode === 'solve' && est) {
    set('st-clock', `${F.signed((est.clock / C) * 1000, 3)} ms`, `the phone’s estimate (truth: ${truth})`, anim ? '' : 'good');
  } else {
    const off = Math.abs(S.clockMs) < 0.005 ? 'Spot on' : `${F.num(Math.abs(S.clockMs), 2)} ms ${S.clockMs > 0 ? 'fast' : 'slow'}`;
    set('st-clock', off, S.mode === 'solve' ? 'not solved yet' : 'the phone assumes it is spot on', Math.abs(S.clockMs) > 0.004 ? 'accent' : '');
  }
  const nU = S.mode === 'solve' ? 3 : 2;
  const n = cur.meas.length;
  set('st-count', `${nU} unknowns · ${n} heard`, S.mode === 'solve' ? 'x, y and the clock' : 'x and y (the clock is trusted)', n >= nU ? '' : 'bad');
}

function renderTable() {
  const tbl = document.getElementById('mtable');
  const est = shown();
  const fix = !anim && cur.fix && cur.fix.ok ? cur.fix : null;
  const res = new Map((fix ? fix.residuals : []).map((r) => [r.id, r.r]));
  const rows = cur.sats.map((s) => {
    const m = cur.meas.find((q) => q.id === s.id);
    const status = !s.on ? 'off' : !s.visible ? 'below horizon' : '';
    const name = `<span class="swatch" style="background:var(--s${s.id})"></span>${s.short}${status ? ` <span class="muted">· ${status}</span>` : ''}`;
    if (!m) return `<tr class="dim"><td class="text">${name}</td><td>—</td><td>—</td><td class="sim">${F.num(s.range / 1000, 1)} km</td><td class="sim">—</td><td>—</td></tr>`;
    const off = m.pr - s.range;
    return `<tr><td class="text">${name}</td>
      <td>${F.num((m.pr / C) * 1000, 4)} ms</td><td>${F.num(m.pr / 1000, 1)} km</td>
      <td class="sim">${F.num(s.range / 1000, 1)} km</td><td class="sim">${F.dist(off, { sign: true })}</td>
      <td>${res.has(s.id) ? F.dist(res.get(s.id), { sign: true }) : '—'}</td></tr>`;
  }).join('');
  tbl.innerHTML = `<thead><tr><th>Satellite</th><th>Travel time<br>(phone’s clock)</th><th>× speed<br>of light</th><th class="sim">True<br>distance</th><th class="sim">Off<br>by</th><th>Mismatch<br>after the fix</th></tr></thead><tbody>${rows}</tbody>`;
  const note = document.getElementById('mtable-note');
  note.innerHTML = Math.abs(S.clockMs) >= 0.005 && cur.meas.length
    ? `Every heard satellite is off by the <b>same</b> amount: ${F.dist((S.clockMs / 1000) * C, { sign: true })}. That is what makes the clock error solvable: it is one number, not one per satellite. “Mismatch after the fix” is the gap between each measurement and the phone’s answer (the residual).`
    : '“Mismatch after the fix” is the gap between each measurement and what the phone’s answer predicts (the residual). Big mismatches mean the measurements disagree.';
  void est;
}

function renderHub() {
  const hub = document.getElementById('hub');
  if (hub.childElementCount) return;
  hub.innerHTML = LABS.map((l, i) => `<a class="lab-card" href="${href(`labs/${l.slug}.html`)}"><span class="n">LAB ${i + 1}</span><h3>${l.title}</h3><p>${l.blurb}</p><span class="go">Open lab →</span></a>`).join('');
}

function renderAll() {
  stepsEl.innerHTML = stepHtml();
  renderControls();
  renderStats();
  renderTable();
  space.redraw();
  close.redraw();
  sweepStage.redraw();
}

function update() {
  cur = compute();
  if (!anim) computeSweep();
  renderAll();
}

onThemeChange(() => renderAll());
cur = compute();
computeSweep();
renderHub();
renderAll();

// ───────────────────────── The 3-D model ─────────────────────────
// It loads its drawing library (Three.js) only when you scroll near it.
const globeSection = document.getElementById('three-d');
const globeObserver = new IntersectionObserver(async (entries) => {
  if (!entries.some((e) => e.isIntersecting)) return;
  globeObserver.disconnect();
  try {
    const m = await import('./globe3d.js');
    m.mountGlobe();
  } catch (err) {
    const n = document.getElementById('g-note');
    n.className = 'live warn';
    n.textContent = 'The 3-D model could not load. It needs an internet connection to fetch its drawing library (Three.js).';
    console.error(err);
  }
}, { rootMargin: '600px 0px' });
globeObserver.observe(globeSection);
