// Match renderer: draw(ctx, view, state) paints one frame of a Match-like object.
//
//   view   { width, height (device px), dpr, orientation: 'landscape' | 'portrait',
//            camera? (world rect, geometry.js), zoomed? (camera is not the full pitch),
//            pitch?: false when the pitch is a layer of its own under a transparent canvas
//                    (pitch.js paintPitch — the match screen does this),
//            dt? (seconds since the last frame; omit to snap eased values) }
//   state  { match (players, activePlayers, ball, effects, mode, restart, teams),
//            kits: [{ primary, secondary, ink, gk, gkInk }] (kits.js),
//            fx: createRenderState() — the renderer's own memory between frames (ball trail,
//                crowd scales, label placement); reuse one per canvas,
//            scorerId?: player to label after a goal,
//            flair?: { text, tone, x, y, age, life } a moment caption ("OFF THE POST!"),
//            flash: 0–1 goal flash, flashColor, dim: 0–1 (paused) }
//
// No DOM besides the canvas; no simulation RNG. The frame loop allocates nothing: positions,
// trail and label boxes live in typed arrays on `fx`, text widths and font strings are cached.
// Crowds stay readable: tokens shrink a little when others are within a couple of metres, the
// draw order is stable (by id, then receiver, scorer and carrier on top) and only the players
// who matter are labelled (carrier or set-piece taker, intended receiver, goalscorer), each
// label placed where it covers the fewest tokens.
import { commonName } from '../../../../core/players/player-labels.js';
import { WORLD, makeTransform } from './geometry.js';
import { pitchLayer, blitPitch } from './pitch.js';

const TAU = Math.PI * 2;
const SHOT_COLORS = { Curler: '#9fe2ff', Knuckleball: '#d8b8ff', default: '#ffd772' };
const SAVE_COLOR = '#a9f0e4';
const LABELLED_EFFECTS = new Set(['shot', 'catch', 'parry', 'whistle']);
const FLAIR_TONES = { gold: '#ffd772', save: SAVE_COLOR, miss: '#ffffff', card: '#ffd43b' };
const TRAIL = 20;
const KIND_PASS = 1,
  KIND_SHOT = 2;
const MIN_CROWD_SCALE = 0.66;
const DISPLAY = '"Barlow Condensed", "Arial Narrow", sans-serif';
const TEXT = 'Inter, system-ui, sans-serif';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Pixel radius of a player token for this transform (before crowd shrinking). */
export const tokenRadius = (t, dpr) => clamp(1.06 * t.s, 6.4 * dpr, 16 * dpr);
/** Pixel radius of the ball on the ground. */
export const ballRadius = (t, dpr) => clamp(0.5 * t.s, 4 * dpr, 7.5 * dpr);

/** The renderer's memory between frames. One per canvas; `resetRenderState` after a cut. */
export function createRenderState() {
  return {
    t: {},
    sx: new Float32Array(22),
    sy: new Float32Array(22),
    rad: new Float32Array(22),
    scale: new Float32Array(22).fill(1),
    slot: new Int8Array(22).fill(-1),
    boxes: new Float32Array(4 * 4),
    boxCount: 0,
    ballX: 0,
    ballY: 0,
    ballR: 0,
    fontPx: 0,
    trail: {
      x: new Float32Array(TRAIL),
      y: new Float32Array(TRAIL),
      z: new Float32Array(TRAIL),
      kind: new Uint8Array(TRAIL),
      head: 0,
      count: 0,
      match: null,
    },
  };
}

/** Forget the ball trail and label placement (clip cuts, replays, restarts that jump). */
export function resetRenderState(fx) {
  if (!fx) return;
  fx.trail.count = 0;
  fx.trail.head = 0;
  fx.slot.fill(-1);
}

// ---------- caches (nothing below allocates once warm) ----------

const NUMBERS = Array.from({ length: 100 }, (_, i) => String(i));
const fonts = { display: new Map(), text: new Map() };
const fontOf = (kind, px) => {
  const cache = fonts[kind];
  let f = cache.get(px);
  if (!f) {
    f = kind === 'display' ? `800 ${px}px ${DISPLAY}` : `600 ${px}px ${TEXT}`;
    cache.set(px, f);
  }
  return f;
};
const widths = new Map(); // font string → Map(text → width)
function textWidth(ctx, font, text) {
  let byText = widths.get(font);
  if (!byText) widths.set(font, (byText = new Map()));
  let w = byText.get(text);
  if (w === undefined) {
    if (byText.size > 400) byText.clear();
    ctx.font = font;
    w = ctx.measureText(text).width;
    byText.set(text, w);
  }
  return w;
}
// Widths measured before the web fonts arrived are wrong: start over when they load.
globalThis.document?.fonts?.addEventListener?.('loadingdone', () => widths.clear());

const names = new WeakMap();
function nameOf(p) {
  let n = names.get(p);
  if (n === undefined) {
    n = commonName(p) || p.name || '';
    names.set(p, n);
  }
  return n;
}
const uppers = new Map();
function upper(label) {
  let u = uppers.get(label);
  if (u === undefined) {
    if (uppers.size > 200) uppers.clear();
    u = String(label).toUpperCase();
    uppers.set(label, u);
  }
  return u;
}

// ---------- frame ----------

export function draw(ctx, view, state) {
  const { width, height, dpr = 1, orientation = 'landscape', camera = WORLD } = view;
  const fx = state.fx || (state.fx = createRenderState());
  const t = makeTransform({ width, height, orientation, camera }, fx.t);
  const m = state.match;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  if (view.pitch === false) ctx.clearRect(0, 0, width, height);
  else if (view.zoomed) blitPitch(ctx, t, width, height, orientation);
  else ctx.drawImage(pitchLayer(t, width, height), 0, 0);
  if (!m) return t;
  const r = tokenRadius(t, dpr);
  const players = m.activePlayers || m.players;
  const n = players.length;
  const ball = m.ball;
  fx.fontPx = 0;
  dashes(dpr);

  // Screen positions and crowd scales
  for (let i = 0; i < n; i++) {
    const p = players[i];
    fx.sx[p.id] = t.a * p.x + t.c * p.y + t.e;
    fx.sy[p.id] = t.b * p.x + t.d * p.y + t.f;
  }
  const carrierId =
    ball.owner != null
      ? ball.owner
      : m.mode === 'restart' && m.restart?.taker != null && m.restart.type !== 'Goal'
        ? m.restart.taker
        : -1;
  const receiver =
    ball.kind === 'pass' && ball.target != null ? m.players[ball.target] || null : null;
  const receiverId = receiver && !receiver.sentOff ? receiver.id : -1;
  const scorer = state.scorerId != null ? m.players[state.scorerId] || null : null;
  const scorerId = scorer && !scorer.sentOff ? scorer.id : -1;
  const ease = view.dt == null ? 1 : Math.min(1, view.dt * 10);
  for (let i = 0; i < n; i++) {
    const p = players[i],
      x = fx.sx[p.id],
      y = fx.sy[p.id];
    let near = Infinity;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const q = players[j],
        dx = fx.sx[q.id] - x,
        dy = fx.sy[q.id] - y,
        d = dx * dx + dy * dy;
      if (d < near) near = d;
    }
    let target = clamp(Math.sqrt(near) / (2.1 * r), MIN_CROWD_SCALE, 1);
    if (p.id === carrierId) target = Math.max(target, 0.86);
    const s = fx.scale[p.id] + (target - fx.scale[p.id]) * ease;
    fx.scale[p.id] = s;
    fx.rad[p.id] = r * s;
  }

  drawEffects(ctx, t, m, state, dpr, width, r, false);

  // Shadows (one path)
  ctx.fillStyle = 'rgba(2, 8, 4, 0.38)';
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const id = players[i].id,
      pr = fx.rad[id],
      x = fx.sx[id] + pr * 0.22,
      y = fx.sy[id] + pr * 0.34;
    ctx.moveTo(x + pr * 1.02, y);
    ctx.ellipse(x, y, pr * 1.02, pr * 0.78, 0, 0, TAU);
  }
  ctx.fill();

  // Where the ball is drawn: at the carrier's feet it sits just outside his token.
  const br = ballRadius(t, dpr);
  let bx = t.a * ball.x + t.c * ball.y + t.e,
    by = t.b * ball.x + t.d * ball.y + t.f;
  const holder = ball.owner != null ? m.players[ball.owner] : null;
  if (holder && !holder.sentOff) {
    const ox = fx.sx[holder.id],
      oy = fx.sy[holder.id],
      reach = fx.rad[holder.id] + br * 0.5;
    let dx = bx - ox,
      dy = by - oy,
      d = Math.hypot(dx, dy);
    if (d < reach) {
      if (d < 0.5) {
        const f = holder.facing || 0;
        dx = t.a * Math.cos(f) + t.c * Math.sin(f);
        dy = t.b * Math.cos(f) + t.d * Math.sin(f);
        d = Math.hypot(dx, dy) || 1;
      }
      bx = ox + (dx / d) * reach;
      by = oy + (dy / d) * reach;
    }
  }
  const bz = Math.max(0, ball.z || 0);
  fx.ballX = bx;
  fx.ballY = by - bz * 0.6 * t.s;
  fx.ballR = br * (1 + Math.min(bz, 6) * 0.07);

  // Intended pass: faint guide from the ball to the receiver
  if (receiverId >= 0) {
    ctx.setLineDash(DASH_GUIDE);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1.2 * dpr;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(fx.sx[receiverId], fx.sy[receiverId]);
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
  }

  updateTrail(fx.trail, m, ball);
  drawTrail(ctx, t, fx.trail, ball, dpr, br);

  // Ball shadow on the ground (drifts away and fades as the ball rises)
  ctx.globalAlpha = clamp(0.5 - bz * 0.05, 0.14, 0.5);
  ctx.fillStyle = '#000802';
  ctx.beginPath();
  ctx.ellipse(
    bx + br * (0.25 + bz * 0.1),
    by + br * (0.35 + bz * 0.06),
    br * (1 + bz * 0.1),
    br * 0.72 * (1 + bz * 0.08),
    0,
    0,
    TAU,
  );
  ctx.fill();
  ctx.globalAlpha = 1;

  // Tokens: stable order (by id), then the players who matter on top
  for (let i = 0; i < n; i++) {
    const p = players[i];
    if (p.id === carrierId || p.id === receiverId || p.id === scorerId) continue;
    drawToken(ctx, t, fx, p, m, state, dpr, 0);
  }
  if (receiverId >= 0 && receiverId !== carrierId)
    drawToken(ctx, t, fx, m.players[receiverId], m, state, dpr, 2);
  if (scorerId >= 0 && scorerId !== carrierId && scorerId !== receiverId)
    drawToken(ctx, t, fx, scorer, m, state, dpr, 3);
  if (carrierId >= 0 && !m.players[carrierId].sentOff)
    drawToken(ctx, t, fx, m.players[carrierId], m, state, dpr, 1);

  drawBall(ctx, fx, dpr);
  drawEffects(ctx, t, m, state, dpr, width, r, true);

  // Labels: carrier (or set-piece taker), receiver, goalscorer
  fx.boxCount = 0;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (carrierId >= 0 && !m.players[carrierId].sentOff)
    drawLabel(ctx, fx, players, m.players[carrierId], 1, dpr, width, height);
  if (scorerId >= 0 && scorerId !== carrierId)
    drawLabel(ctx, fx, players, scorer, 3, dpr, width, height);
  if (receiverId >= 0 && receiverId !== carrierId && receiverId !== scorerId)
    drawLabel(ctx, fx, players, receiver, 2, dpr, width, height);
  ctx.globalAlpha = 1;

  if (state.flair) drawFlair(ctx, t, state.flair, dpr, width, height);

  if (state.flash > 0) {
    ctx.globalAlpha = clamp(state.flash, 0, 1) * 0.32;
    ctx.fillStyle = state.flashColor || '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
  }
  if (state.dim > 0) {
    ctx.globalAlpha = clamp(state.dim, 0, 1) * 0.35;
    ctx.fillStyle = '#040812';
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
  }
  return t;
}

const NO_DASH = [];
let dashDpr = 0,
  DASH_GUIDE = NO_DASH,
  DASH_RING = NO_DASH;
function dashes(dpr) {
  if (dashDpr === dpr) return;
  dashDpr = dpr;
  DASH_GUIDE = [3 * dpr, 4 * dpr];
  DASH_RING = [3 * dpr, 3 * dpr];
}

// World angle → screen angle (rotation only)
const screenAngle = (t, angle) => {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return Math.atan2(t.b * c + t.d * s, t.a * c + t.c * s);
};

/** role: 0 plain · 1 carrier · 2 receiver · 3 goalscorer */
function drawToken(ctx, t, fx, p, m, state, dpr, role) {
  const kit = state.kits?.[p.team] || EMPTY,
    keeper = p.role === 'GK' || p.emergencyKeeper,
    fill = keeper ? kit.gk || '#f2e14c' : kit.primary || '#cdf545',
    ink = keeper ? kit.gkInk || '#0a0f1c' : kit.ink || '#0a0f1c',
    ring = keeper ? 'rgba(6,10,20,0.85)' : kit.secondary || '#ffffff';
  const x = fx.sx[p.id],
    y = fx.sy[p.id],
    r = fx.rad[p.id];
  const a = p.animation;
  if (a && (a.type === 'dive' || a.type === 'tackle')) {
    const k = clamp((m.elapsed - a.start) / a.duration, 0, 1),
      stretch = Math.sin(k * Math.PI);
    if (stretch > 0.02) {
      const ang = screenAngle(t, a.angle ?? p.facing);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.ellipse(r * stretch * 0.9, 0, r * (1 + stretch * 1.3), r * 0.72, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }
  // Speed lines for sprinting players
  const vx = p.vx || 0,
    vy = p.vy || 0,
    speed2 = vx * vx + vy * vy;
  if (speed2 > 43.5 && !state.still) {
    const speed = Math.sqrt(speed2),
      ang = Math.atan2(t.b * vx + t.d * vy, t.a * vx + t.c * vy),
      cos = Math.cos(ang),
      sin = Math.sin(ang),
      len = clamp((speed - 6) * 0.9, 0, 3.2) * t.s,
      bx = x - cos * r * 1.2,
      by = y - sin * r * 1.2,
      ox = -sin * 0.45 * r,
      oy = cos * 0.45 * r;
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1.2 * dpr;
    ctx.beginPath();
    ctx.moveTo(bx + ox, by + oy);
    ctx.lineTo(bx + ox - cos * len, by + oy - sin * len);
    ctx.moveTo(bx - ox, by - oy);
    ctx.lineTo(bx - ox - cos * len, by - oy - sin * len);
    ctx.stroke();
  }
  if (role) {
    ctx.beginPath();
    ctx.arc(x, y, r + 3.2 * dpr, 0, TAU);
    ctx.strokeStyle =
      role === 1 ? 'rgba(255,255,255,0.92)' : role === 3 ? '#ffd772' : 'rgba(255,255,255,0.6)';
    ctx.lineWidth = (role === 2 ? 1.4 : 2) * dpr;
    if (role === 2) ctx.setLineDash(DASH_RING);
    ctx.stroke();
    if (role === 2) ctx.setLineDash(NO_DASH);
  }
  // Body
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1.4 * dpr, r * 0.2);
  ctx.strokeStyle = ring;
  ctx.stroke();
  // Facing notch
  const f = screenAngle(t, p.facing || 0),
    tip = r + Math.max(2.4 * dpr, r * 0.38),
    base = r + 0.6 * dpr;
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(f) * tip, y + Math.sin(f) * tip);
  ctx.lineTo(x + Math.cos(f + 0.42) * base, y + Math.sin(f + 0.42) * base);
  ctx.lineTo(x + Math.cos(f - 0.42) * base, y + Math.sin(f - 0.42) * base);
  ctx.closePath();
  ctx.fillStyle = ring;
  ctx.fill();
  // Shirt number (dropped when a crowd squeezes the token too small to read it)
  const px = Math.round(r * 1.14);
  if (px >= 6 * dpr) {
    if (fx.fontPx !== px) {
      ctx.font = fontOf('display', px);
      fx.fontPx = px;
    }
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(NUMBERS[p.number] ?? '', x, y + r * 0.06);
  }
  // Booked
  if (p.yellowCards) {
    ctx.fillStyle = '#ffd43b';
    ctx.strokeStyle = 'rgba(10,10,10,0.7)';
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.rect(x + r * 0.55, y - r * 1.25, r * 0.5, r * 0.7);
    ctx.fill();
    ctx.stroke();
  }
}
const EMPTY = {};

function updateTrail(trail, m, ball) {
  const last = (trail.head + TRAIL - 1) % TRAIL;
  if (trail.count) {
    const dx = trail.x[last] - ball.x,
      dy = trail.y[last] - ball.y;
    if (trail.match !== m || dx * dx + dy * dy > 36) trail.count = 0;
    else if (dx === 0 && dy === 0) return;
  }
  trail.match = m;
  const i = trail.count ? trail.head : (trail.head = 0);
  trail.x[i] = ball.x;
  trail.y[i] = ball.y;
  trail.z[i] = ball.z || 0;
  trail.kind[i] = ball.kind === 'pass' ? KIND_PASS : ball.kind === 'shot' ? KIND_SHOT : 0;
  trail.head = (i + 1) % TRAIL;
  if (trail.count < TRAIL) trail.count++;
}

function drawTrail(ctx, t, trail, ball, dpr, br) {
  const count = trail.count;
  if (count < 2) return;
  const kind = ball.kind === 'shot' ? KIND_SHOT : ball.kind === 'pass' ? KIND_PASS : 0;
  if (!kind) return;
  const shot = kind === KIND_SHOT,
    strength = shot ? clamp(ball.strength || 0.5, 0.3, 1) : 0.3,
    // Glow for hard shots: a wide faint pass under the core line (no canvas shadows — they
    // are expensive to rasterise on phones).
    glow = shot && strength > 0.7,
    lift = 0.6 * t.s,
    wide = shot ? br * (1.1 + strength * 0.7) : br * 0.95,
    alpha = shot ? 0.9 : 0.42;
  ctx.lineCap = 'round';
  ctx.strokeStyle = shot ? SHOT_COLORS[ball.shotType] || SHOT_COLORS.default : '#ffffff';
  const start = (trail.head + TRAIL - count) % TRAIL;
  for (let n = 1; n < count; n++) {
    const i = (start + n) % TRAIL,
      j = (start + n - 1) % TRAIL;
    if (trail.kind[i] !== kind || trail.kind[j] !== kind) continue;
    const k = n / count,
      width = Math.max(1.2 * dpr, wide * k);
    ctx.beginPath();
    ctx.moveTo(
      t.a * trail.x[j] + t.c * trail.y[j] + t.e,
      t.b * trail.x[j] + t.d * trail.y[j] + t.f - trail.z[j] * lift,
    );
    ctx.lineTo(
      t.a * trail.x[i] + t.c * trail.y[i] + t.e,
      t.b * trail.x[i] + t.d * trail.y[i] + t.f - trail.z[i] * lift,
    );
    if (glow) {
      ctx.globalAlpha = k * 0.22;
      ctx.lineWidth = width * 2.6;
      ctx.stroke();
    }
    ctx.globalAlpha = k * k * alpha;
    ctx.lineWidth = width;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.lineCap = 'butt';
}

function drawBall(ctx, fx, dpr) {
  const x = fx.ballX,
    y = fx.ballY,
    br = fx.ballR;
  // Soft halo, then a dark keyline so the ball reads on grass, lines and kits alike
  ctx.beginPath();
  ctx.arc(x, y, br * 1.9, 0, TAU);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, br + 1.1 * dpr, 0, TAU);
  ctx.fillStyle = 'rgba(6, 14, 10, 0.92)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, br, 0, TAU);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x - br * 0.06, y - br * 0.04, br * 0.36, 0, TAU);
  ctx.fillStyle = 'rgba(16, 26, 22, 0.82)';
  ctx.fill();
}

// Label placements around a token, in order of preference: below, above, right, left, then
// the four diagonals. Outputs go to module variables (no allocation).
const SLOT_COST = [0, 0.3, 0.6, 0.6, 0.9, 0.9, 1, 1];
let slotX = 0,
  slotY = 0;
function slotPosition(slot, px, py, r, w, h, gap) {
  const dx = r + gap + w / 2,
    dy = r + gap + h / 2,
    side = r * 0.5 + w / 2;
  slotX = px;
  slotY = py;
  switch (slot) {
    case 0:
      slotY = py + dy;
      break;
    case 1:
      slotY = py - dy;
      break;
    case 2:
      slotX = px + dx;
      break;
    case 3:
      slotX = px - dx;
      break;
    case 4:
      slotX = px + side;
      slotY = py + dy;
      break;
    case 5:
      slotX = px - side;
      slotY = py + dy;
      break;
    case 6:
      slotX = px + side;
      slotY = py - dy;
      break;
    default:
      slotX = px - side;
      slotY = py - dy;
  }
}

const circleHitsBox = (cx, cy, cr, x, y, w, h) => {
  const dx = Math.max(Math.abs(cx - x) - w / 2, 0),
    dy = Math.max(Math.abs(cy - y) - h / 2, 0);
  return dx * dx + dy * dy < cr * cr;
};

/** role: 1 carrier · 2 receiver · 3 goalscorer */
function drawLabel(ctx, fx, players, p, role, dpr, width, height) {
  const text = nameOf(p);
  if (!text) return;
  const font = fontOf('text', Math.round(11.5 * dpr)),
    w = textWidth(ctx, font, text) + 12 * dpr,
    h = 18 * dpr,
    gap = 5 * dpr,
    edge = 3 * dpr,
    px = fx.sx[p.id],
    py = fx.sy[p.id],
    r = fx.rad[p.id] + (role ? 3.2 * dpr : 0),
    n = players.length;
  let best = 0,
    bestCost = Infinity;
  for (let slot = 0; slot < 8; slot++) {
    slotPosition(slot, px, py, r, w, h, gap);
    const x = clamp(slotX, w / 2 + edge, width - w / 2 - edge),
      y = slotY;
    let cost = SLOT_COST[slot] - (fx.slot[p.id] === slot ? 0.8 : 0);
    if (y - h / 2 < edge || y + h / 2 > height - edge) cost += 50;
    if (x !== slotX) cost += 1.5 + (circleHitsBox(px, py, r, x, y, w, h) ? 6 : 0);
    for (let i = 0; i < n && cost < bestCost; i++) {
      const q = players[i];
      if (q === p) continue;
      if (circleHitsBox(fx.sx[q.id], fx.sy[q.id], fx.rad[q.id], x, y, w, h)) cost += 1.2;
    }
    if (circleHitsBox(fx.ballX, fx.ballY, fx.ballR * 1.6, x, y, w, h)) cost += 2.5;
    for (let b = 0; b < fx.boxCount; b++) {
      const o = b * 4;
      if (
        Math.abs(fx.boxes[o] - x) < (fx.boxes[o + 2] + w) / 2 &&
        Math.abs(fx.boxes[o + 1] - y) < (fx.boxes[o + 3] + h) / 2
      )
        cost += 20;
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = slot;
    }
  }
  fx.slot[p.id] = best;
  slotPosition(best, px, py, r, w, h, gap);
  const x = clamp(slotX, w / 2 + edge, width - w / 2 - edge),
    y = clamp(slotY, h / 2 + edge, height - h / 2 - edge);
  if (fx.boxCount < 4) {
    const o = fx.boxCount++ * 4;
    fx.boxes[o] = x;
    fx.boxes[o + 1] = y;
    fx.boxes[o + 2] = w;
    fx.boxes[o + 3] = h;
  }
  const strong = role !== 2;
  ctx.globalAlpha = strong ? 1 : 0.88;
  ctx.fillStyle = strong ? 'rgba(6, 10, 20, 0.88)' : 'rgba(6, 10, 20, 0.68)';
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fill();
  if (strong) {
    ctx.strokeStyle = role === 3 ? 'rgba(255, 215, 114, 0.9)' : 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1 * dpr;
    ctx.stroke();
  }
  ctx.font = font;
  ctx.fillStyle = role === 3 ? '#ffe7a8' : strong ? '#ffffff' : 'rgba(235, 242, 255, 0.92)';
  ctx.fillText(text, x, y + 0.5 * dpr);
}

function effectColor(e, state) {
  return e.type === 'shot'
    ? SHOT_COLORS[e.shotType] || SHOT_COLORS.default
    : e.type === 'catch' || e.type === 'parry'
      ? SAVE_COLOR
      : state.kits?.[e.team]?.primary || '#ffe0a8';
}

function drawEffects(ctx, t, m, state, dpr, width, r, over) {
  const effects = m.effects;
  if (!effects || !effects.length) return;
  for (let i = 0; i < effects.length; i++) {
    const e = effects[i],
      type = e.type,
      life = e.maxLife ? clamp(e.life / e.maxLife, 0, 1) : 0,
      k = 1 - life,
      x = t.a * e.x + t.c * e.y + t.e,
      y = t.b * e.x + t.d * e.y + t.f;
    ctx.globalAlpha = clamp(e.life * 3, 0, 1);
    if (!over) {
      if (type === 'goal') {
        const color = effectColor(e, state);
        for (let j = 0; j < 3; j++) {
          ctx.beginPath();
          ctx.arc(x, y, (2.5 + k * 16 + j * 2.4) * t.s, 0, TAU);
          ctx.strokeStyle = j ? 'rgba(255,255,255,0.35)' : color;
          ctx.lineWidth = (j ? 1.5 : 3) * dpr;
          ctx.stroke();
        }
      } else if (type === 'delivery') {
        ctx.setLineDash(DASH_GUIDE);
        ctx.beginPath();
        ctx.arc(x, y, (1.6 + k * 1.4) * t.s, 0, TAU);
        ctx.strokeStyle = effectColor(e, state);
        ctx.lineWidth = 1.4 * dpr;
        ctx.stroke();
        ctx.setLineDash(NO_DASH);
      } else if (type === 'tackle') {
        ctx.strokeStyle = '#ffd59a';
        ctx.lineWidth = 1.6 * dpr;
        ctx.beginPath();
        const inner = (1.1 + k * 1.6) * t.s,
          outer = inner + (1.1 * (1 - k) + 0.3) * t.s;
        for (let j = 0; j < 6; j++) {
          const cos = Math.cos((j / 6) * TAU),
            sin = Math.sin((j / 6) * TAU);
          ctx.moveTo(x + cos * inner, y + sin * inner);
          ctx.lineTo(x + cos * outer, y + sin * outer);
        }
        ctx.stroke();
      }
      continue;
    }
    const save = type === 'catch' || type === 'parry';
    if (type === 'shot' || save || type === 'whistle') {
      const color = type === 'whistle' ? 'rgba(255,255,255,0.7)' : effectColor(e, state);
      ctx.beginPath();
      ctx.arc(x, y, ((save ? 1.5 : 1.3) + k * (save ? 2.6 : 2.4)) * t.s, 0, TAU);
      ctx.strokeStyle = color;
      ctx.lineWidth = (save ? 2.4 : 2) * dpr;
      ctx.stroke();
      if (save) {
        // A second, faster ring: a save should pop
        ctx.globalAlpha *= 0.5;
        ctx.beginPath();
        ctx.arc(x, y, (2.2 + k * 4.4) * t.s, 0, TAU);
        ctx.lineWidth = 1.4 * dpr;
        ctx.stroke();
        ctx.globalAlpha = clamp(e.life * 3, 0, 1);
      }
    }
    // In a shootout only the verdict of each kick is captioned (SCORED / SAVED / MISSED)
    const kick = m.mode === 'shootout';
    if (LABELLED_EFFECTS.has(type) && e.label && (!kick || type === 'whistle')) {
      const text = upper(e.label),
        card = type === 'whistle' && (text === 'YELLOW CARD' || text === 'RED CARD'),
        // Saves, cards and penalties are the moments: a size up, with a quick pop on entry
        big = save || card || kick || (type === 'whistle' && text === 'PENALTY'),
        pop = big ? 1 + 0.35 * Math.max(0, 1 - k * 7) : 1,
        font = fontOf('display', Math.round((big ? 15 : 12) * dpr)),
        pad = (big ? 8 : 6) * dpr,
        cardW = card ? 9 * dpr : 0,
        w = textWidth(ctx, font, text) + pad * 2 + (card ? cardW + 5 * dpr : 0),
        h = (big ? 21 : 17) * dpr,
        lx = clamp(x, w / 2 + 2 * dpr, width - w / 2 - 2 * dpr),
        ly = Math.max(h, y - r - (1.6 + k * 0.8) * t.s - h / 2 - 4 * dpr);
      if (pop !== 1) {
        ctx.translate(lx, ly);
        ctx.scale(pop, pop);
        ctx.translate(-lx, -ly);
      }
      ctx.fillStyle = 'rgba(6, 10, 20, 0.86)';
      ctx.beginPath();
      ctx.roundRect(lx - w / 2, ly - h / 2, w, h, 4 * dpr);
      ctx.fill();
      if (card) {
        ctx.fillStyle = text === 'RED CARD' ? '#ff5d52' : '#ffd43b';
        ctx.beginPath();
        ctx.roundRect(lx - w / 2 + pad, ly - 6.5 * dpr, cardW, 13 * dpr, 1.5 * dpr);
        ctx.fill();
      }
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle =
        type !== 'whistle'
          ? effectColor(e, state)
          : text === 'RED CARD' || text === 'MISSED'
            ? '#ff8a7f'
            : text === 'YELLOW CARD'
              ? '#ffd43b'
              : text === 'SCORED'
                ? '#7ee6a1'
                : text === 'SAVED'
                  ? SAVE_COLOR
                  : '#ffffff';
      ctx.fillText(text, lx + (card ? (cardW + 5 * dpr) / 2 : 0), ly + 0.5 * dpr);
      if (pop !== 1) ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  }
  ctx.globalAlpha = 1;
}

/** A moment caption from the controller (woodwork, near miss, big save): pops in, fades out. */
function drawFlair(ctx, t, flair, dpr, width, height) {
  const k = clamp(flair.age / flair.life, 0, 1);
  if (k >= 1) return;
  const color = FLAIR_TONES[flair.tone] || '#ffffff',
    x = t.a * flair.x + t.c * flair.y + t.e,
    y = t.b * flair.x + t.d * flair.y + t.f,
    alpha = k < 0.75 ? 1 : (1 - k) * 4,
    pop = 1 + 0.4 * Math.max(0, 1 - flair.age * 7);
  // Ring burst where it happened
  ctx.globalAlpha = alpha * (1 - k) * 0.9;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.4 * dpr;
  ctx.beginPath();
  ctx.arc(x, y, (1.2 + k * 5) * t.s, 0, TAU);
  ctx.stroke();
  const font = fontOf('display', Math.round(19 * dpr)),
    w = textWidth(ctx, font, flair.text) + 22 * dpr,
    h = 28 * dpr,
    // The caption sits towards the middle of the pitch from the spot, clear of the goal mouth
    cx = t.a * 52.5 + t.c * 34 + t.e,
    cy = t.b * 52.5 + t.d * 34 + t.f,
    d = Math.hypot(cx - x, cy - y) || 1,
    off = Math.min(d, 9 * t.s + h),
    lx = clamp(x + ((cx - x) / d) * off, w / 2 + 4 * dpr, width - w / 2 - 4 * dpr),
    ly = clamp(y + ((cy - y) / d) * off, h / 2 + 4 * dpr, height - h / 2 - 4 * dpr);
  if (pop !== 1) {
    ctx.translate(lx, ly);
    ctx.scale(pop, pop);
    ctx.translate(-lx, -ly);
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(6, 10, 20, 0.9)';
  ctx.beginPath();
  ctx.roundRect(lx - w / 2, ly - h / 2, w, h, 6 * dpr);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * dpr;
  ctx.stroke();
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(flair.text, lx, ly + 1 * dpr);
  if (pop !== 1) ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
}
