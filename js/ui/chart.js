// A small line-chart helper for canvas. Every chart on the site is drawn from numbers our
// code computes at that moment; nothing is pre-drawn.

import { palette } from './theme.js';

export function niceTicks(min, max, count = 5) {
  if (!(max > min)) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const out = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

/**
 * @param ctx canvas context
 * @param box {x, y, w, h} plotting area in CSS px (axes drawn around it)
 * @param o { x:{min,max,label,format,ticks}, y:{...}, series:[{points:[[x,y]], color, width, dash, fill, label}],
 *            vlines:[{x, color, label, dash}], hlines:[...], bands:[{x0,x1,color}] , dots:[{x,y,color,r,label}] }
 */
export function lineChart(ctx, box, o) {
  const P = palette();
  const { x: X, y: Y } = o;
  const sx = (v) => box.x + ((v - X.min) / (X.max - X.min)) * box.w;
  const sy = (v) => box.y + box.h - ((v - Y.min) / (Y.max - Y.min)) * box.h;
  ctx.save();
  ctx.font = '500 11.5px Inter, system-ui, sans-serif';
  // grid + ticks
  const xt = X.ticks || niceTicks(X.min, X.max, X.count || 6);
  const yt = Y.ticks || niceTicks(Y.min, Y.max, Y.count || 4);
  ctx.strokeStyle = P.grid;
  ctx.lineWidth = 1;
  ctx.fillStyle = P.muted;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of yt) {
    const y = Math.round(sy(v)) + 0.5;
    ctx.beginPath(); ctx.moveTo(box.x, y); ctx.lineTo(box.x + box.w, y); ctx.stroke();
    ctx.fillText((Y.format || String)(v), box.x - 6, y);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const v of xt) {
    const x = Math.round(sx(v)) + 0.5;
    ctx.beginPath(); ctx.moveTo(x, box.y); ctx.lineTo(x, box.y + box.h); ctx.stroke();
    ctx.fillText((X.format || String)(v), x, box.y + box.h + 6);
  }
  ctx.strokeStyle = P.lineStrong;
  ctx.beginPath();
  ctx.moveTo(box.x, box.y + box.h + 0.5); ctx.lineTo(box.x + box.w, box.y + box.h + 0.5);
  ctx.stroke();
  if (X.label) {
    ctx.fillStyle = P.muted;
    ctx.font = '600 11.5px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(X.label, box.x + box.w / 2, box.y + box.h + 24);
  }
  if (Y.label) {
    ctx.save();
    ctx.translate(box.x - (Y.labelGap || 46), box.y + box.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = P.muted;
    ctx.font = '600 11.5px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Y.label, 0, 0);
    ctx.restore();
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y - 2, box.w, box.h + 4);
  ctx.clip();
  for (const b of o.bands || []) {
    ctx.fillStyle = b.color;
    ctx.fillRect(sx(b.x0), box.y, sx(b.x1) - sx(b.x0), box.h);
  }
  for (const s of o.series || []) {
    if (!s.points.length) continue;
    if (s.fill) {
      ctx.fillStyle = s.fill;
      ctx.beginPath();
      ctx.moveTo(sx(s.points[0][0]), sy(s.base ?? Math.max(Y.min, 0)));
      for (const [a, b] of s.points) ctx.lineTo(sx(a), sy(b));
      ctx.lineTo(sx(s.points[s.points.length - 1][0]), sy(s.base ?? Math.max(Y.min, 0)));
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width || 2.2;
    ctx.setLineDash(s.dash || []);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let pen = false;
    for (const pt of s.points) {
      if (!pt || !Number.isFinite(pt[1])) { pen = false; continue; }
      const x = sx(pt[0]), y = sy(pt[1]);
      if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const v of o.vlines || []) {
    ctx.strokeStyle = v.color || P.ink;
    ctx.lineWidth = v.width || 1.5;
    ctx.setLineDash(v.dash || [4, 4]);
    const x = sx(v.x);
    ctx.beginPath(); ctx.moveTo(x, box.y); ctx.lineTo(x, box.y + box.h); ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const v of o.hlines || []) {
    ctx.strokeStyle = v.color || P.ink;
    ctx.lineWidth = v.width || 1.5;
    ctx.setLineDash(v.dash || [4, 4]);
    const y = sy(v.y);
    ctx.beginPath(); ctx.moveTo(box.x, y); ctx.lineTo(box.x + box.w, y); ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const d of o.dots || []) {
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.arc(sx(d.x), sy(d.y), d.r || 4.5, 0, Math.PI * 2);
    ctx.fill();
    if (d.ring) { ctx.strokeStyle = d.ring; ctx.lineWidth = 2; ctx.stroke(); }
  }
  ctx.restore();
  for (const v of o.vlines || []) {
    if (!v.label) continue;
    ctx.font = '600 11.5px Inter, system-ui, sans-serif';
    ctx.fillStyle = v.color || P.ink;
    ctx.textAlign = sx(v.x) > box.x + box.w * 0.7 ? 'right' : 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(v.label, sx(v.x) + (ctx.textAlign === 'right' ? -5 : 5), box.y + 2);
  }
  ctx.restore();
  return { sx, sy };
}

// A legend row drawn in the top-right of a chart box.
export function legend(ctx, items, x, y, { align = 'right' } = {}) {
  const P = palette();
  ctx.save();
  ctx.font = '600 11.5px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const widths = items.map((it) => ctx.measureText(it.label).width + 26);
  let cx = align === 'right' ? x - widths.reduce((a, b) => a + b, 0) : x;
  items.forEach((it, i) => {
    ctx.strokeStyle = it.color;
    ctx.lineWidth = 3;
    ctx.setLineDash(it.dash || []);
    ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(cx + 14, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = P.ink2;
    ctx.textAlign = 'left';
    ctx.fillText(it.label, cx + 19, y);
    cx += widths[i];
  });
  ctx.restore();
}
