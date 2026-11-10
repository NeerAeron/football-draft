// Pitch metres → canvas pixels. The pitch is 105 × 68 m (x along the length, y across);
// `landscape` draws x to the right, `portrait` rotates it a quarter turn so x = 105 is at the
// top (a rotation, not a mirror: the attacking side's left wing stays on screen-left).
// A camera is a world rectangle in landscape metres; the transform letterboxes it.

/** Whole pitch plus the goals and a small margin. */
export const WORLD = Object.freeze({ x0: -4.4, x1: 109.4, y0: -3.8, y1: 71.8 });
/** Penalty-shootout close-up of the x = 105 goal, framed for each orientation. */
export const SHOOTOUT_CAMERA = Object.freeze({
  landscape: Object.freeze({ x0: 50, x1: 109.4, y0: 14.3, y1: 53.7 }),
  portrait: Object.freeze({ x0: 55, x1: 109.4, y0: 15.8, y1: 52.2 }),
});

export const worldAspect = (camera = WORLD, orientation = 'landscape') => {
  const w = camera.x1 - camera.x0,
    h = camera.y1 - camera.y0;
  return orientation === 'portrait' ? h / w : w / h;
};

/**
 * Affine transform for a canvas of width × height device pixels:
 * screen = (a·x + c·y + e, b·x + d·y + f); `s` = pixels per metre.
 * Pass `out` to reuse an object (the frame loop allocates nothing).
 */
export function makeTransform(
  { width, height, orientation = 'landscape', camera = WORLD },
  out = {},
) {
  const portrait = orientation === 'portrait',
    ww = camera.x1 - camera.x0,
    wh = camera.y1 - camera.y0,
    sw = portrait ? wh : ww,
    sh = portrait ? ww : wh,
    s = Math.min(width / sw, height / sh),
    ox = (width - sw * s) / 2,
    oy = (height - sh * s) / 2;
  out.s = s;
  out.portrait = portrait;
  if (portrait) {
    out.a = 0;
    out.b = -s;
    out.c = s;
    out.d = 0;
    out.e = ox - camera.y0 * s;
    out.f = oy + camera.x1 * s;
  } else {
    out.a = s;
    out.b = 0;
    out.c = 0;
    out.d = s;
    out.e = ox - camera.x0 * s;
    out.f = oy - camera.y0 * s;
  }
  return out;
}

export const sx = (t, x, y) => t.a * x + t.c * y + t.e;
export const sy = (t, x, y) => t.b * x + t.d * y + t.f;

/** Screen pixel → pitch metres (inverse transform), e.g. for pointer hit tests. */
export function toWorld(t, px, py) {
  const det = t.a * t.d - t.b * t.c;
  const x = px - t.e,
    y = py - t.f;
  return { x: (t.d * x - t.c * y) / det, y: (-t.b * x + t.a * y) / det };
}

/** Interpolate two cameras (0 → a, 1 → b). */
export function mixCamera(a, b, k, out = {}) {
  out.x0 = a.x0 + (b.x0 - a.x0) * k;
  out.x1 = a.x1 + (b.x1 - a.x1) * k;
  out.y0 = a.y0 + (b.y0 - a.y0) * k;
  out.y1 = a.y1 + (b.y1 - a.y1) * k;
  return out;
}

/**
 * The world rectangle a width × height canvas shows at zoom 1: WORLD grown along one axis to
 * the canvas aspect (what the letterboxed full-pitch view covers, run-off included).
 */
export function fullView(width, height, orientation = 'landscape', out = {}) {
  const portrait = orientation === 'portrait',
    ww = WORLD.x1 - WORLD.x0,
    wh = WORLD.y1 - WORLD.y0,
    s = Math.min(width / (portrait ? wh : ww), height / (portrait ? ww : wh)),
    ex = (portrait ? height : width) / s,
    ey = (portrait ? width : height) / s,
    cx = (WORLD.x0 + WORLD.x1) / 2,
    cy = (WORLD.y0 + WORLD.y1) / 2;
  out.x0 = cx - ex / 2;
  out.x1 = cx + ex / 2;
  out.y0 = cy - ey / 2;
  out.y1 = cy + ey / 2;
  return out;
}
