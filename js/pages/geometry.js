// Lab 2: satellite geometry and dilution of precision.
import { makeSky, ecefToEnu } from '../core/geo.js';
import { measure } from '../core/world.js';
import { solveFix } from '../core/receiver.js';
import { dopFromSky } from '../core/dop.js';
import { sub, eig2 } from '../core/linalg.js';
import { gaussianSource } from '../core/rng.js';
import { createStage, label, tag } from '../ui/canvas.js';
import { palette, onThemeChange, alpha } from '../ui/theme.js';
import { skyLayout, skyToScreen, screenToSky, drawSkyGrid, drawSkySat } from '../ui/sky.js';
import * as F from '../ui/format.js';
import { mountSite, labNav, paintRange } from '../ui/site.js';

mountSite('geometry');
document.getElementById('labnav').innerHTML = labNav('geometry');

const PRESETS = {
  spread: [[0, 78], [65, 32], [130, 48], [188, 22], [245, 55], [305, 28], [25, 14], [160, 70]],
  bunched: [[40, 62], [58, 48], [72, 66], [50, 38], [85, 52], [30, 45], [65, 30], [45, 75]],
  high: [[0, 80], [90, 72], [180, 75], [270, 70], [45, 65], [225, 68], [135, 62], [315, 64]],
  canyon: [[350, 62], [8, 45], [175, 55], [190, 40], [5, 78], [185, 70], [170, 36], [12, 38]],
};
const N_FIXES = 300;

const S = {
  sats: PRESETS.spread.map(([az, el], i) => ({ id: i + 1, az, el, on: i < 6 })),
  sigma: 5,
  clockKnown: false,
  galileo: false,
  cloud: true,
};
let result = null;

function compute() {
  const on = S.sats.filter((s) => s.on).map((s) => ({ ...s, sys: S.galileo && s.id >= 5 ? 'GAL' : 'GPS' }));
  const dop = dopFromSky(on, { clockKnown: S.clockKnown });
  const fixes = [];
  if (S.cloud && dop.ok) {
    const sky = makeSky({ lat: 37.5, lon: 127 }, on);
    const g = gaussianSource(42); // the same noise every time, so set-ups can be compared fairly
    for (let t = 0; t < N_FIXES; t++) {
      const extra = {};
      for (let i = 0; i < 8; i++) {
        const v = S.sigma * g();
        if (S.sats[i].on) extra[S.sats[i].id] = v;
      }
      const meas = measure({ truePos: sky.user, clockError: 0, sats: sky.sats, extra, systemOffset: S.clockKnown ? {} : { GAL: 40e-9 } });
      const fix = S.clockKnown ? solveFix(meas, { solveClock: false, fixedClock: 0 }) : solveFix(meas);
      if (fix.ok) fixes.push(ecefToEnu(sub(fix.pos, sky.user), sky.basis));
    }
  }
  const rms = [0, 1, 2].map((k) => (fixes.length ? Math.sqrt(fixes.reduce((s, f) => s + f[k] * f[k], 0) / fixes.length) : NaN));
  result = { on, dop, fixes, rms };
}

// ── Sky plot ──
let skyL = null, drag = null;
const sky = createStage(document.getElementById('sky'), {
  draw(ctx, w, h) {
    const P = palette();
    ctx.fillStyle = P.surface; ctx.fillRect(0, 0, w, h);
    skyL = skyLayout(w, h, 30);
    drawSkyGrid(ctx, skyL);
    S.sats.forEach((s, i) => {
      const col = S.galileo && s.id >= 5 ? P.s5 : P.sat[i % 4];
      drawSkySat(ctx, skyL, s, s.on ? col : P.muted, { dim: !s.on, text: `${S.galileo && s.id >= 5 ? 'E' : 'G'}${s.id}${s.on ? '' : ' off'}` });
    });
  },
  onDown(p) {
    if (!skyL) return false;
    let best = null;
    S.sats.forEach((s, i) => {
      const [x, y] = skyToScreen(skyL, s.az, s.el);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < 20 && (!best || d < best.d)) best = { d, i };
    });
    if (!best) return false;
    drag = best.i;
    return true;
  },
  onMove(p) {
    if (drag === null) return;
    const { az, el } = screenToSky(skyL, p.x, p.y, 5);
    S.sats[drag].az = az;
    S.sats[drag].el = el;
    update();
  },
  onUp() { drag = null; },
  onHover(p) {
    if (!skyL) return null;
    return S.sats.some((s) => { const [x, y] = skyToScreen(skyL, s.az, s.el); return Math.hypot(p.x - x, p.y - y) < 20; }) ? 'grab' : null;
  },
});

// ── Cloud of fixes: east–north map plus a height strip on the same scale ──
const cloud = createStage(document.getElementById('cloud-cv'), {
  draw(ctx, w, h) {
    const P = palette();
    ctx.fillStyle = P.surface; ctx.fillRect(0, 0, w, h);
    const { dop, fixes } = result;
    if (!dop.ok) {
      label(ctx, dop.reason === 'too-few' ? `Can’t solve: ${dop.nUnknowns} unknowns, ${dop.have} satellites` : 'Can’t solve: the satellites don’t pin down every direction', w / 2, h / 2, { color: P.bad, font: '600 14px Inter, sans-serif', align: 'center' });
      return;
    }
    const stripW = Math.max(70, w * 0.2);
    const mapW = w - stripW - 16;
    const top = 34, bottom = h - 30;
    const size = Math.min(mapW - 30, bottom - top);
    const cx = 18 + (mapW - 18) / 2, cy = top + (bottom - top) / 2;
    // scale: fit 3.2σ of the largest axis (horizontal or vertical) into the half-size
    const sE = dop.east * S.sigma, sN = dop.north * S.sigma, sU = dop.up * S.sigma;
    const span = Math.max(sE, sN, sU) * 3.2;
    const k = size / 2 / span;
    // grid
    ctx.strokeStyle = P.grid;
    ctx.lineWidth = 1;
    const step = niceStep(span / 2);
    for (let v = -Math.floor(span / step) * step; v <= span; v += step) {
      ctx.beginPath(); ctx.moveTo(cx + v * k, cy - size / 2); ctx.lineTo(cx + v * k, cy + size / 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - size / 2, cy - v * k); ctx.lineTo(cx + size / 2, cy - v * k); ctx.stroke();
    }
    ctx.strokeStyle = P.lineStrong;
    ctx.strokeRect(cx - size / 2, cy - size / 2, size, size);
    label(ctx, 'north ↑', cx - size / 2 + 6, cy - size / 2 + 12, { color: P.muted, font: '600 11px Inter, sans-serif' });
    label(ctx, 'east →', cx + size / 2 - 6, cy + size / 2 - 10, { color: P.muted, font: '600 11px Inter, sans-serif', align: 'right' });
    // fixes
    ctx.fillStyle = alpha(P.accent, 0.45);
    for (const f of fixes) {
      const x = cx + f[0] * k, y = cy - f[1] * k;
      if (Math.abs(f[0]) < span && Math.abs(f[1]) < span) ctx.fillRect(x - 1.6, y - 1.6, 3.2, 3.2);
    }
    // predicted ellipses
    const [[a, b], [, d]] = dop.covEN;
    const e = eig2(a, b, d);
    for (const [mult, dash] of [[1, [5, 4]], [2.4477, []]]) {
      ctx.strokeStyle = P.ink;
      ctx.lineWidth = 1.8;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.sqrt(e.l1) * S.sigma * mult * k, Math.sqrt(Math.max(e.l2, 0)) * S.sigma * mult * k, -e.angle, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // you
    ctx.strokeStyle = P.true; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx - 7, cy); ctx.lineTo(cx + 7, cy); ctx.moveTo(cx, cy - 7); ctx.lineTo(cx, cy + 7); ctx.stroke();
    // scale bar
    const sb = step;
    ctx.strokeStyle = P.ink; ctx.lineWidth = 2;
    const sx0 = cx - size / 2 + 8, sy0 = cy + size / 2 + 16;
    ctx.beginPath(); ctx.moveTo(sx0, sy0 - 4); ctx.lineTo(sx0, sy0); ctx.lineTo(sx0 + sb * k, sy0); ctx.lineTo(sx0 + sb * k, sy0 - 4); ctx.stroke();
    label(ctx, `${F.num(sb, sb < 1 ? 1 : 0)} m`, sx0 + sb * k + 6, sy0 - 2, { color: P.ink, font: '600 11px Inter, sans-serif' });

    // height strip, same metres per pixel
    const hx = w - stripW / 2 - 6;
    ctx.fillStyle = P.surface2;
    ctx.fillRect(hx - stripW / 2 + 6, cy - size / 2, stripW - 12, size);
    ctx.strokeStyle = P.lineStrong;
    ctx.strokeRect(hx - stripW / 2 + 6, cy - size / 2, stripW - 12, size);
    label(ctx, 'height', hx, cy - size / 2 - 10, { color: P.muted, font: '600 11px Inter, sans-serif', align: 'center' });
    ctx.fillStyle = alpha(P.accent, 0.45);
    fixes.forEach((f, i) => {
      if (Math.abs(f[2]) > span) return;
      const jitter = ((i * 37) % 100) / 100 - 0.5;
      ctx.fillRect(hx + jitter * (stripW - 30) - 1.6, cy - f[2] * k - 1.6, 3.2, 3.2);
    });
    for (const [mult, dash] of [[1, [5, 4]], [2, []]]) {
      ctx.strokeStyle = P.ink; ctx.lineWidth = 1.8; ctx.setLineDash(dash);
      for (const sgn of [-1, 1]) {
        const y = cy - sgn * sU * mult * k;
        if (Math.abs(y - cy) < size / 2) { ctx.beginPath(); ctx.moveTo(hx - stripW / 2 + 8, y); ctx.lineTo(hx + stripW / 2 - 8, y); ctx.stroke(); }
      }
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = P.true; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(hx - 8, cy); ctx.lineTo(hx + 8, cy); ctx.stroke();
    if (!S.cloud) tag(ctx, 'fixes hidden', cx, cy - size / 2 + 14, { bg: P.surface3, fg: P.muted, align: 'center' });
  },
});

function niceStep(x) {
  const p = 10 ** Math.floor(Math.log10(x));
  return [1, 2, 5, 10].map((m) => m * p).find((v) => v >= x * 0.6) || p;
}

// ── Controls ──
const chips = document.getElementById('chips');
function renderChips() {
  const P = palette();
  chips.innerHTML = '';
  S.sats.forEach((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.style.setProperty('--c', S.galileo && s.id >= 5 ? P.s5 : P.sat[i % 4]);
    b.setAttribute('aria-pressed', s.on);
    b.innerHTML = `<span class="dot"></span>${S.galileo && s.id >= 5 ? 'E' : 'G'}${s.id}`;
    b.addEventListener('click', () => { s.on = !s.on; update(); });
    chips.append(b);
  });
  document.getElementById('count').textContent = `${S.sats.filter((s) => s.on).length} on`;
}
document.getElementById('presets').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  PRESETS[b.dataset.p].forEach(([az, el], i) => { S.sats[i].az = az; S.sats[i].el = el; });
  update();
});
const sig = document.getElementById('sigma');
paintRange(sig);
sig.addEventListener('input', () => { S.sigma = +sig.value; document.getElementById('sigma-val').textContent = `${F.num(S.sigma, 1)} m`; update(); });
document.getElementById('clock-known').addEventListener('change', (e) => { S.clockKnown = e.target.checked; update(); });
document.getElementById('galileo').addEventListener('change', (e) => { S.galileo = e.target.checked; update(); });
document.getElementById('cloud').addEventListener('change', (e) => { S.cloud = e.target.checked; update(); });

function renderStats() {
  const { dop, rms, fixes } = result;
  const set = (id, v) => { document.getElementById(id).innerHTML = v; };
  if (!dop.ok) {
    ['hdop', 'vdop', 'corr', 'spread'].forEach((id) => set(id, '—'));
    document.getElementById('spread-d').textContent = dop.reason === 'too-few' ? `needs ${dop.nUnknowns} satellites` : 'geometry too weak';
    return;
  }
  set('hdop', F.num(dop.hdop, 2));
  set('vdop', F.num(dop.vdop, 2));
  set('corr', S.clockKnown ? 'no clock' : F.pct(Math.abs(dop.corrUpClock)));
  if (fixes.length) {
    set('spread', `${F.num(rms[0], 1)} / ${F.num(rms[1], 1)} / ${F.num(rms[2], 1)} m`);
    document.getElementById('spread-d').textContent = `measured; formula says ${F.num(dop.east * S.sigma, 1)} / ${F.num(dop.north * S.sigma, 1)} / ${F.num(dop.up * S.sigma, 1)}`;
  } else {
    set('spread', `${F.num(dop.east * S.sigma, 1)} / ${F.num(dop.north * S.sigma, 1)} / ${F.num(dop.up * S.sigma, 1)} m`);
    document.getElementById('spread-d').textContent = 'east / north / up, from the formula';
  }
}

function update() {
  compute();
  renderChips();
  renderStats();
  sky.redraw();
  cloud.redraw();
}
onThemeChange(() => { renderChips(); sky.redraw(); cloud.redraw(); });
update();
