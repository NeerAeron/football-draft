// Match renderer: draw(ctx, view, state) paints one frame of a Match-like object.
//
//   view   { width, height (device px), dpr, orientation: 'landscape' | 'portrait',
//            camera? (world rect, geometry.js), reducedMotion? }
//   state  { match (players, activePlayers, ball, effects, mode, restart, teams),
//            kits: [{ primary, secondary, ink, gk, gkInk }] (kits.js),
//            trail: [{ x, y, z, kind }] recent ball positions (oldest first),
//            flash: 0–1 goal flash, flashColor, dim: 0–1 (paused / replay) }
//
// No DOM besides the canvas; no simulation RNG; labels only for the ball carrier and the
// intended receiver (no overlapping name soup).
import { commonName } from '../../../../core/players/player-labels.js';
import { WORLD, makeTransform } from './geometry.js';
import { pitchLayer } from './pitch.js';

const TAU = Math.PI * 2;
const SHOT_COLORS = { Curler: '#9fe2ff', Knuckleball: '#d8b8ff', default: '#ffd772' };
const LABELLED_EFFECTS = new Set(['shot', 'catch', 'parry', 'whistle']);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Pixel radius of a player token for this transform. */
export const tokenRadius = (t, dpr) => Math.max(1.15 * t.s, 7.5 * dpr);

export function draw(ctx, view, state) {
  const { width, height, dpr = 1, orientation = 'landscape', camera = WORLD } = view;
  const t = makeTransform({ width, height, orientation, camera });
  const m = state.match;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.drawImage(pitchLayer(t, width, height), 0, 0);
  if (!m) return t;
  const P = (x, y) => [t.a * x + t.c * y + t.e, t.b * x + t.d * y + t.f];
  const r = tokenRadius(t, dpr);
  const players = m.activePlayers || m.players;
  const ball = m.ball;

  drawEffects(ctx, t, P, m, state, dpr, 'under');

  // Shadows
  ctx.fillStyle = 'rgba(2, 8, 4, 0.38)';
  for (const p of players) {
    const [x, y] = P(p.x, p.y);
    ctx.beginPath();
    ctx.ellipse(x + r * 0.22, y + r * 0.34, r * 1.02, r * 0.78, 0, 0, TAU);
    ctx.fill();
  }

  // Intended pass: faint guide from the ball to the receiver
  const receiver =
    ball.kind === 'pass' && ball.target != null ? m.players[ball.target] || null : null;
  if (receiver && !receiver.sentOff) {
    const [bx, by] = P(ball.x, ball.y),
      [rx, ry] = P(receiver.x, receiver.y);
    ctx.save();
    ctx.setLineDash([3 * dpr, 4 * dpr]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 1.2 * dpr;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(rx, ry);
    ctx.stroke();
    ctx.restore();
  }

  drawTrail(ctx, P, state.trail, ball, t, dpr);

  // Ball shadow (ground position)
  {
    const [x, y] = P(ball.x, ball.y),
      z = Math.max(0, ball.z || 0),
      br = Math.max(0.42 * t.s, 3.4 * dpr);
    ctx.fillStyle = `rgba(0, 8, 2, ${clamp(0.45 - z * 0.05, 0.12, 0.45)})`;
    ctx.beginPath();
    ctx.ellipse(
      x + br * 0.25,
      y + br * 0.35,
      br * (1 + z * 0.12),
      br * 0.7 * (1 + z * 0.1),
      0,
      0,
      TAU,
    );
    ctx.fill();
  }

  const carrierId =
    ball.owner != null
      ? ball.owner
      : m.mode === 'restart' && m.restart?.taker != null
        ? m.restart.taker
        : null;

  // Tokens
  for (const p of players)
    drawToken(ctx, t, P, p, m, state, r, dpr, p.id === carrierId, p === receiver);

  drawBall(ctx, P, ball, t, dpr);
  drawEffects(ctx, t, P, m, state, dpr, 'over');

  // Labels: carrier (or set-piece taker) and receiver only
  const labels = [];
  const carrier = carrierId != null ? m.players[carrierId] : null;
  if (carrier && !carrier.sentOff) labels.push({ p: carrier, strong: true });
  if (receiver && receiver !== carrier) labels.push({ p: receiver, strong: false });
  drawLabels(ctx, P, labels, r, dpr, width, height);

  if (state.flash > 0) {
    ctx.globalAlpha = clamp(state.flash, 0, 1) * 0.32;
    ctx.fillStyle = state.flashColor || '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
  }
  if (state.dim > 0) {
    ctx.fillStyle = `rgba(4, 8, 18, ${clamp(state.dim, 0, 1) * 0.35})`;
    ctx.fillRect(0, 0, width, height);
  }
  return t;
}

function drawToken(ctx, t, P, p, m, state, r, dpr, isCarrier, isReceiver) {
  const kit = state.kits?.[p.team] || {},
    keeper = p.role === 'GK' || p.emergencyKeeper,
    fill = keeper ? kit.gk || '#f2e14c' : kit.primary || '#cdf545',
    ink = keeper ? kit.gkInk || '#0a0f1c' : kit.ink || '#0a0f1c',
    ring = keeper ? 'rgba(6,10,20,0.85)' : kit.secondary || '#ffffff';
  const [x, y] = P(p.x, p.y);
  const a = p.animation;
  if (a && (a.type === 'dive' || a.type === 'tackle')) {
    const k = clamp((m.elapsed - a.start) / a.duration, 0, 1),
      stretch = Math.sin(k * Math.PI);
    if (stretch > 0.02) {
      const ang = screenAngle(t, a.angle ?? p.facing);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.ellipse(r * stretch * 0.9, 0, r * (1 + stretch * 1.3), r * 0.72, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }
  // Speed lines for sprinting players
  const speed = Math.hypot(p.vx || 0, p.vy || 0);
  if (speed > 6.6 && !state.still) {
    const ang = Math.atan2(sy0(t, p.vx, p.vy), sx0(t, p.vx, p.vy)),
      len = clamp((speed - 6) * 0.9, 0, 3.2) * t.s;
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1.2 * dpr;
    ctx.beginPath();
    for (const off of [-0.45, 0.45]) {
      const ox = x - Math.cos(ang) * r * 1.2 - Math.sin(ang) * off * r,
        oy = y - Math.sin(ang) * r * 1.2 + Math.cos(ang) * off * r;
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox - Math.cos(ang) * len, oy - Math.sin(ang) * len);
    }
    ctx.stroke();
  }
  if (isCarrier || isReceiver) {
    ctx.beginPath();
    ctx.arc(x, y, r + 3.2 * dpr, 0, TAU);
    ctx.strokeStyle = isCarrier ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.55)';
    ctx.lineWidth = (isCarrier ? 2 : 1.4) * dpr;
    if (!isCarrier) ctx.setLineDash([3 * dpr, 3 * dpr]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Body
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5 * dpr, r * 0.2);
  ctx.strokeStyle = ring;
  ctx.stroke();
  // Facing notch
  const f = screenAngle(t, p.facing || 0);
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(f) * (r + 3.6 * dpr), y + Math.sin(f) * (r + 3.6 * dpr));
  ctx.lineTo(x + Math.cos(f + 0.42) * (r + 0.6 * dpr), y + Math.sin(f + 0.42) * (r + 0.6 * dpr));
  ctx.lineTo(x + Math.cos(f - 0.42) * (r + 0.6 * dpr), y + Math.sin(f - 0.42) * (r + 0.6 * dpr));
  ctx.closePath();
  ctx.fillStyle = ring;
  ctx.fill();
  // Shirt number
  ctx.fillStyle = ink;
  ctx.font = `800 ${Math.round(r * 1.12)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(p.number ?? ''), x, y + r * 0.06);
  // Booked
  if (p.yellowCards) {
    ctx.fillStyle = '#ffd43b';
    ctx.strokeStyle = 'rgba(10,10,10,0.7)';
    ctx.lineWidth = 1 * dpr;
    const w = r * 0.5,
      h = r * 0.7;
    ctx.beginPath();
    ctx.roundRect(x + r * 0.55, y - r * 1.25, w, h, 1.5 * dpr);
    ctx.fill();
    ctx.stroke();
  }
}

// World vector → screen vector (rotation only)
const sx0 = (t, x, y) => t.a * x + t.c * y;
const sy0 = (t, x, y) => t.b * x + t.d * y;
const screenAngle = (t, angle) =>
  Math.atan2(sy0(t, Math.cos(angle), Math.sin(angle)), sx0(t, Math.cos(angle), Math.sin(angle)));

function drawTrail(ctx, P, trail, ball, t, dpr) {
  if (!trail || trail.length < 2) return;
  const kind = ball.kind;
  if (kind !== 'shot' && kind !== 'pass') return;
  const color =
    kind === 'shot' ? SHOT_COLORS[ball.shotType] || SHOT_COLORS.default : 'rgba(255,255,255,1)';
  const strength = kind === 'shot' ? clamp(ball.strength || 0.5, 0.3, 1) : 0.3;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  // Glow for hard shots: a wide faint pass under the core line (no canvas shadows — they are
  // expensive to rasterise on phones).
  const glow = kind === 'shot' && strength > 0.7;
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1],
      b = trail[i];
    if (a.kind !== kind || b.kind !== kind) continue;
    if (Math.hypot(a.x - b.x, a.y - b.y) > 6) continue;
    const [ax, ay] = P(a.x, a.y),
      [bx, by] = P(b.x, b.y),
      k = i / trail.length;
    const width = Math.max(1.2 * dpr, (kind === 'shot' ? 0.32 + strength * 0.25 : 0.18) * t.s * k);
    ctx.beginPath();
    ctx.moveTo(ax, ay - (a.z || 0) * 0.6 * t.s);
    ctx.lineTo(bx, by - (b.z || 0) * 0.6 * t.s);
    if (glow) {
      ctx.globalAlpha = k * 0.22;
      ctx.lineWidth = width * 3;
      ctx.stroke();
    }
    ctx.globalAlpha = k * (kind === 'shot' ? 0.85 : 0.22);
    ctx.lineWidth = width;
    ctx.stroke();
  }
  ctx.restore();
}

function drawBall(ctx, P, ball, t, dpr) {
  const z = Math.max(0, ball.z || 0),
    [gx, gy] = P(ball.x, ball.y),
    x = gx,
    y = gy - z * 0.6 * t.s,
    br = Math.max(0.42 * t.s, 3.4 * dpr) * (1 + Math.min(z, 6) * 0.07);
  ctx.beginPath();
  ctx.arc(x, y, br * 1.7, 0, TAU);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.13)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, br, 0, TAU);
  ctx.fillStyle = '#fbfdf7';
  ctx.fill();
  ctx.lineWidth = Math.max(1, br * 0.18);
  ctx.strokeStyle = 'rgba(12, 22, 16, 0.85)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x - br * 0.08, y - br * 0.05, br * 0.36, 0, TAU);
  ctx.fillStyle = 'rgba(20, 30, 26, 0.75)';
  ctx.fill();
}

function drawLabels(ctx, P, labels, r, dpr, width, height) {
  const placed = [];
  ctx.font = `600 ${Math.round(11.5 * dpr)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const { p, strong } of labels) {
    const text = commonName(p) || p.name;
    if (!text) continue;
    const w = ctx.measureText(text).width + 12 * dpr,
      h = 19 * dpr;
    const [px, py] = P(p.x, p.y);
    const x = clamp(px, w / 2 + 4 * dpr, width - w / 2 - 4 * dpr);
    let y = py + r + 7 * dpr + h / 2;
    if (y + h / 2 > height - 2 * dpr) y = py - r - 7 * dpr - h / 2;
    for (const q of placed)
      if (Math.abs(q.x - x) < (q.w + w) / 2 && Math.abs(q.y - y) < h)
        y = q.y > py ? py - r - 7 * dpr - h / 2 : q.y + h + 2 * dpr;
    placed.push({ x, y, w });
    ctx.globalAlpha = strong ? 1 : 0.86;
    ctx.fillStyle = strong ? 'rgba(6, 10, 20, 0.86)' : 'rgba(6, 10, 20, 0.66)';
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
    ctx.fill();
    if (strong) {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1 * dpr;
      ctx.stroke();
    }
    ctx.fillStyle = strong ? '#ffffff' : 'rgba(235, 242, 255, 0.92)';
    ctx.fillText(text, x, y + 0.5 * dpr);
  }
  ctx.globalAlpha = 1;
}

function drawEffects(ctx, t, P, m, state, dpr, layer) {
  const effects = m.effects || [];
  for (const e of effects) {
    const life = e.maxLife ? clamp(e.life / e.maxLife, 0, 1) : 0,
      k = 1 - life,
      alpha = clamp(e.life * 3, 0, 1),
      [x, y] = P(e.x, e.y),
      color =
        e.type === 'shot'
          ? SHOT_COLORS[e.shotType] || SHOT_COLORS.default
          : e.type === 'catch' || e.type === 'parry'
            ? '#a9f0e4'
            : state.kits?.[e.team]?.primary || '#ffe0a8';
    ctx.save();
    ctx.globalAlpha = alpha;
    if (layer === 'under') {
      if (e.type === 'goal') {
        for (let j = 0; j < 3; j++) {
          ctx.beginPath();
          ctx.arc(x, y, (2.5 + k * 16 + j * 2.4) * t.s, 0, TAU);
          ctx.strokeStyle = j ? 'rgba(255,255,255,0.35)' : color;
          ctx.lineWidth = (j ? 1.5 : 3) * dpr;
          ctx.stroke();
        }
      } else if (e.type === 'delivery') {
        ctx.setLineDash([3 * dpr, 4 * dpr]);
        ctx.beginPath();
        ctx.arc(x, y, (1.6 + k * 1.4) * t.s, 0, TAU);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4 * dpr;
        ctx.stroke();
      } else if (e.type === 'tackle') {
        const n = 6;
        ctx.strokeStyle = '#ffd59a';
        ctx.lineWidth = 1.6 * dpr;
        ctx.beginPath();
        for (let j = 0; j < n; j++) {
          const ang = (j / n) * TAU,
            inner = (1.1 + k * 1.6) * t.s,
            outer = inner + (1.1 * (1 - k) + 0.3) * t.s;
          ctx.moveTo(x + Math.cos(ang) * inner, y + Math.sin(ang) * inner);
          ctx.lineTo(x + Math.cos(ang) * outer, y + Math.sin(ang) * outer);
        }
        ctx.stroke();
      }
    } else {
      if (e.type === 'shot') {
        ctx.beginPath();
        ctx.arc(x, y, (1.4 + k * 2.6) * t.s, 0, TAU);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();
      } else if (e.type === 'catch' || e.type === 'parry') {
        ctx.beginPath();
        ctx.arc(x, y, (1.5 + k * 2) * t.s, 0, TAU);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();
      } else if (e.type === 'whistle') {
        ctx.beginPath();
        ctx.arc(x, y, (1.2 + k * 1.8) * t.s, 0, TAU);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.5 * dpr;
        ctx.stroke();
      }
      if (LABELLED_EFFECTS.has(e.type) && e.label && m.mode !== 'shootout') {
        const text = String(e.label).toUpperCase();
        ctx.font = `800 ${Math.round(12 * dpr)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const w = ctx.measureText(text).width + 12 * dpr,
          h = 17 * dpr,
          lx = clamp(x, w / 2 + 2 * dpr, (ctx.canvas?.width || 1e4) - w / 2 - 2 * dpr),
          ly = Math.max(h, y - (3.4 + k * 0.8) * t.s - h / 2);
        ctx.fillStyle = 'rgba(6, 10, 20, 0.82)';
        ctx.beginPath();
        ctx.roundRect(lx - w / 2, ly - h / 2, w, h, 4 * dpr);
        ctx.fill();
        ctx.fillStyle = e.type === 'whistle' && /RED/.test(text) ? '#ff8a7f' : color;
        if (e.type === 'whistle' && /YELLOW/.test(text)) ctx.fillStyle = '#ffd43b';
        if (e.type === 'whistle' && !/RED|YELLOW/.test(text)) ctx.fillStyle = '#ffffff';
        ctx.fillText(text, lx, ly + 0.5 * dpr);
      }
    }
    ctx.restore();
  }
}
