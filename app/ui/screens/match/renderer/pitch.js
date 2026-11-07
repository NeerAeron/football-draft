// The static pitch layer ("Floodlit night"): stadium surround, mowed stripes, floodlight
// pools, crisp markings and goal nets. Drawn once per size/orientation/camera into an
// offscreen canvas and blitted every frame.

const W = 105,
  H = 68,
  GOAL = 7.32,
  GOAL_DEPTH = 2.1,
  STRIPES = 12;

const COLORS = {
  night: '#050913',
  surround: '#0b2a1b',
  stripeA: '#17633b',
  stripeB: '#1b7043',
  line: 'rgba(242, 255, 246, 0.86)',
  lineSoft: 'rgba(242, 255, 246, 0.5)',
  net: 'rgba(235, 245, 255, 0.28)',
  post: '#f7fbff',
};

let grain = null;
function grainPattern(ctx) {
  if (!grain) {
    grain = document.createElement('canvas');
    grain.width = grain.height = 96;
    const g = grain.getContext('2d');
    // Presentation-only noise (never simulation RNG).
    for (let i = 0; i < 900; i++) {
      const light = Math.random() < 0.5;
      g.fillStyle = light ? 'rgba(220,255,220,0.035)' : 'rgba(0,20,8,0.06)';
      g.fillRect(Math.random() * 96, Math.random() * 96, 1 + Math.random() * 1.5, 1);
    }
  }
  return ctx.createPattern(grain, 'repeat');
}

function markings(ctx, s) {
  const lw = Math.max(0.12, 1.15 / s);
  ctx.lineWidth = lw;
  ctx.strokeStyle = COLORS.line;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const box = (x, y, w, h) => ctx.strokeRect(x, y, w, h);
  box(0, 0, W, H);
  ctx.beginPath();
  ctx.moveTo(W / 2, 0);
  ctx.lineTo(W / 2, H);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 9.15, 0, Math.PI * 2);
  ctx.stroke();
  // Penalty and goal areas
  box(0, 13.84, 16.5, 40.32);
  box(W - 16.5, 13.84, 16.5, 40.32);
  box(0, 24.84, 5.5, 18.32);
  box(W - 5.5, 24.84, 5.5, 18.32);
  // Penalty arcs (outside the box only)
  ctx.beginPath();
  ctx.arc(11, H / 2, 9.15, -0.9273, 0.9273);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(W - 11, H / 2, 9.15, Math.PI - 0.9273, Math.PI + 0.9273);
  ctx.stroke();
  // Corner arcs
  for (const [x, y, a] of [
    [0, 0, 0],
    [W, 0, Math.PI / 2],
    [W, H, Math.PI],
    [0, H, -Math.PI / 2],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, 1, a, a + Math.PI / 2);
    ctx.stroke();
  }
  // Spots
  ctx.fillStyle = COLORS.line;
  for (const [x, y, r] of [
    [W / 2, H / 2, 0.32],
    [11, H / 2, 0.24],
    [W - 11, H / 2, 0.24],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(r, lw * 1.2), 0, Math.PI * 2);
    ctx.fill();
  }
}

function goals(ctx, s) {
  const top = H / 2 - GOAL / 2;
  for (const side of [0, 1]) {
    const x0 = side ? W : -GOAL_DEPTH;
    // net shadow + mesh
    ctx.fillStyle = 'rgba(4, 10, 8, 0.35)';
    ctx.fillRect(x0, top, GOAL_DEPTH, GOAL);
    ctx.strokeStyle = COLORS.net;
    ctx.lineWidth = Math.max(0.05, 0.6 / s);
    ctx.beginPath();
    for (let i = 0.42; i < GOAL_DEPTH; i += 0.42) {
      ctx.moveTo(x0 + i, top);
      ctx.lineTo(x0 + i, top + GOAL);
    }
    for (let j = 0.42; j < GOAL; j += 0.42) {
      ctx.moveTo(x0, top + j);
      ctx.lineTo(x0 + GOAL_DEPTH, top + j);
    }
    ctx.stroke();
    ctx.strokeStyle = COLORS.lineSoft;
    ctx.lineWidth = Math.max(0.1, 1 / s);
    ctx.strokeRect(x0, top, GOAL_DEPTH, GOAL);
    // posts
    ctx.fillStyle = COLORS.post;
    const px = side ? W : -0.12,
      r = Math.max(0.2, 1.6 / s);
    for (const y of [top, top + GOAL]) {
      ctx.beginPath();
      ctx.arc(px + 0.06, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Draw the pitch for transform `t` onto ctx (device pixels, width × height).
 * `t` from geometry.makeTransform.
 */
export function drawPitch(ctx, t, width, height) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Stadium night
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#0a1222');
  sky.addColorStop(1, COLORS.night);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  ctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
  // Surround (run-off grass beyond the lines)
  ctx.fillStyle = COLORS.surround;
  ctx.fillRect(-6, -5, W + 12, H + 10);
  // Mowed stripes across the length
  const band = W / STRIPES;
  for (let i = 0; i < STRIPES; i++) {
    ctx.fillStyle = i % 2 ? COLORS.stripeB : COLORS.stripeA;
    ctx.fillRect(i * band, -1.5, band + 0.02, H + 3);
  }

  // Floodlight pools + vignette in screen space
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const pattern = grainPattern(ctx);
  if (pattern) {
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, width, height);
  }
  const corners = [
    [0, 0],
    [W, 0],
    [0, H],
    [W, H],
  ];
  ctx.globalCompositeOperation = 'lighter';
  for (const [x, y] of corners) {
    const px = t.a * x + t.c * y + t.e,
      py = t.b * x + t.d * y + t.f,
      r = 62 * t.s;
    const g = ctx.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(190, 230, 255, 0.10)');
    g.addColorStop(0.55, 'rgba(160, 210, 255, 0.035)');
    g.addColorStop(1, 'rgba(160, 210, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.globalCompositeOperation = 'source-over';
  const cx = t.a * (W / 2) + t.c * (H / 2) + t.e,
    cy = t.b * (W / 2) + t.d * (H / 2) + t.f,
    reach = Math.hypot(width, height) * 0.62;
  const vignette = ctx.createRadialGradient(cx, cy, reach * 0.35, cx, cy, reach);
  vignette.addColorStop(0, 'rgba(2, 6, 14, 0)');
  vignette.addColorStop(1, 'rgba(2, 6, 14, 0.5)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  ctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
  goals(ctx, t.s);
  markings(ctx, t.s);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

const cache = { key: '', canvas: null };

/** The pitch layer for this transform, cached while size/orientation/camera are unchanged. */
export function pitchLayer(t, width, height) {
  const key = `${width}x${height}:${t.a.toFixed(4)},${t.b.toFixed(4)},${t.e.toFixed(2)},${t.f.toFixed(2)}`;
  if (cache.key === key && cache.canvas) return cache.canvas;
  const canvas = cache.canvas || document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  drawPitch(canvas.getContext('2d'), t, width, height);
  cache.key = key;
  cache.canvas = canvas;
  return canvas;
}
