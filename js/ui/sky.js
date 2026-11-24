// A sky plot: looking straight up. The centre is overhead, the edge is the horizon,
// north at the top and east on the right, the usual way GPS receivers draw it.
import { palette, alpha } from './theme.js';
import { satelliteGlyph, label } from './canvas.js';

const DEG = Math.PI / 180;

export function skyLayout(w, h, pad = 28) {
  return { cx: w / 2, cy: h / 2, R: Math.min(w, h) / 2 - pad };
}

export function skyToScreen(L, az, el) {
  const r = (L.R * (90 - Math.max(el, 0))) / 90;
  return [L.cx + r * Math.sin(az * DEG), L.cy - r * Math.cos(az * DEG)];
}

export function screenToSky(L, x, y, minEl = 0) {
  const dx = x - L.cx, dy = y - L.cy;
  const r = Math.hypot(dx, dy);
  let az = Math.atan2(dx, -dy) / DEG;
  if (az < 0) az += 360;
  const el = Math.max(minEl, Math.min(90, 90 - (r / L.R) * 90));
  return { az, el };
}

export function drawSkyGrid(ctx, L, { bg } = {}) {
  const P = palette();
  ctx.fillStyle = bg || P.surface2;
  ctx.beginPath(); ctx.arc(L.cx, L.cy, L.R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = P.lineStrong;
  ctx.lineWidth = 1;
  for (const el of [0, 30, 60]) {
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, (L.R * (90 - el)) / 90, 0, Math.PI * 2);
    ctx.setLineDash(el ? [3, 4] : []);
    ctx.stroke();
  }
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(L.cx - L.R, L.cy); ctx.lineTo(L.cx + L.R, L.cy);
  ctx.moveTo(L.cx, L.cy - L.R); ctx.lineTo(L.cx, L.cy + L.R);
  ctx.stroke();
  ctx.setLineDash([]);
  const f = '600 11px Inter, system-ui, sans-serif';
  label(ctx, 'N', L.cx, L.cy - L.R - 12, { color: P.muted, font: f, align: 'center' });
  label(ctx, 'S', L.cx, L.cy + L.R + 12, { color: P.muted, font: f, align: 'center' });
  label(ctx, 'E', L.cx + L.R + 12, L.cy, { color: P.muted, font: f, align: 'center' });
  label(ctx, 'W', L.cx - L.R - 12, L.cy, { color: P.muted, font: f, align: 'center' });
  label(ctx, '30°', L.cx + 4, L.cy - (L.R * 60) / 90 + 9, { color: P.muted, font: '500 10px Inter, sans-serif' });
  label(ctx, '60°', L.cx + 4, L.cy - (L.R * 30) / 90 + 9, { color: P.muted, font: '500 10px Inter, sans-serif' });
}

// Draw one satellite on the sky plot with a short label.
export function drawSkySat(ctx, L, s, color, { dim = false, ring = null, text = null } = {}) {
  const P = palette();
  const [x, y] = skyToScreen(L, s.az, s.el);
  if (ring) {
    ctx.strokeStyle = ring;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.stroke();
  }
  satelliteGlyph(ctx, x, y, color, { size: 7.5, dim });
  if (text) label(ctx, text, x, y + 17, { color: dim ? P.muted : P.ink, font: '600 11px Inter, sans-serif', align: 'center', halo: alpha(P.surface, 0.85) });
  return [x, y];
}
