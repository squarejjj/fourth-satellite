// A canvas that stays sharp on high-density screens, redraws when resized, and reports
// pointer drags in CSS pixels. Each page supplies its own draw function.

export function createStage(canvas, { draw, onDown, onMove, onUp, onHover, cursor } = {}) {
  const ctx = canvas.getContext('2d');
  const stage = { canvas, ctx, w: 0, h: 0, dpr: 1, dragging: false };
  let queued = false;

  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === stage.w && h === stage.h && dpr === stage.dpr) return;
    stage.w = w; stage.h = h; stage.dpr = dpr;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    // Draw on the next frame, so a page can finish setting up before its first draw.
    queued = false;
    stage.redraw();
  }

  function redrawNow() {
    queued = false;
    if (!stage.w) return;
    ctx.setTransform(stage.dpr, 0, 0, stage.dpr, 0, 0);
    ctx.clearRect(0, 0, stage.w, stage.h);
    draw && draw(ctx, stage.w, stage.h, stage);
  }

  stage.redraw = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(redrawNow);
  };
  stage.redrawNow = redrawNow;

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  canvas.addEventListener('pointerdown', (e) => {
    const p = pos(e);
    if (onDown && onDown(p, e) !== false) {
      stage.dragging = true;
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pos(e);
    if (stage.dragging) onMove && onMove(p, e);
    else if (onHover) {
      const c = onHover(p, e);
      canvas.style.cursor = c || cursor || 'default';
    }
  });
  const end = (e) => {
    if (!stage.dragging) return;
    stage.dragging = false;
    onUp && onUp(pos(e), e);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  new ResizeObserver(resize).observe(canvas);
  resize();
  return stage;
}

// Draw a polyline through screen points, breaking it where points are missing.
export function polyline(ctx, pts) {
  let pen = false;
  ctx.beginPath();
  for (const p of pts) {
    if (!p) { pen = false; continue; }
    if (!pen) { ctx.moveTo(p[0], p[1]); pen = true; } else ctx.lineTo(p[0], p[1]);
  }
  ctx.stroke();
}

export function label(ctx, text, x, y, { color, font = '600 12px Inter, system-ui, sans-serif', align = 'left', base = 'middle', halo } = {}) {
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = base;
  if (halo) {
    ctx.lineWidth = 4;
    ctx.strokeStyle = halo;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

// A pill-shaped tag with text, used for on-canvas labels.
export function tag(ctx, text, x, y, { bg, fg, font = '600 11.5px Inter, system-ui, sans-serif', align = 'left', pad = 6 } = {}) {
  ctx.font = font;
  const w = ctx.measureText(text).width + pad * 2, h = 20;
  let x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.fillStyle = bg;
  roundRect(ctx, x0, y - h / 2, w, h, 6);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x0 + pad, y + 0.5);
  return { x: x0, y: y - h / 2, w, h };
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// A small satellite glyph centred at (x, y).
export function satelliteGlyph(ctx, x, y, color, { size = 9, dim = false, angle = 0 } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = dim ? 0.4 : 1;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  // solar panels
  ctx.fillRect(-size * 1.9, -size * 0.42, size * 1.1, size * 0.84);
  ctx.fillRect(size * 0.8, -size * 0.42, size * 1.1, size * 0.84);
  ctx.beginPath();
  ctx.moveTo(-size * 0.8, 0); ctx.lineTo(size * 0.8, 0); ctx.stroke();
  // body
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.62, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();
  ctx.restore();
}

// A phone glyph (the true position) centred at (x, y).
export function phoneGlyph(ctx, x, y, color, bg, s = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = color;
  roundRect(ctx, -6, -10, 12, 20, 3);
  ctx.fill();
  ctx.fillStyle = bg;
  roundRect(ctx, -4.2, -7.5, 8.4, 13.5, 1.5);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 7.8, 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// The receiver's answer: a crosshair ring.
export function fixGlyph(ctx, x, y, color, r = 9) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - r - 5, y); ctx.lineTo(x - r + 3, y);
  ctx.moveTo(x + r - 3, y); ctx.lineTo(x + r + 5, y);
  ctx.moveTo(x, y - r - 5); ctx.lineTo(x, y - r + 3);
  ctx.moveTo(x, y + r - 3); ctx.lineTo(x, y + r + 5);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function arrow(ctx, x1, y1, x2, y2, color, { width = 2, head = 8 } = {}) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2 - Math.cos(a) * head * 0.8, y2 - Math.sin(a) * head * 0.8);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - Math.cos(a - 0.42) * head, y2 - Math.sin(a - 0.42) * head);
  ctx.lineTo(x2 - Math.cos(a + 0.42) * head, y2 - Math.sin(a + 0.42) * head);
  ctx.closePath();
  ctx.fill();
}
