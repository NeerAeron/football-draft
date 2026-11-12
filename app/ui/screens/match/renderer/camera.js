// Action camera: a smooth follow of the ball with a moderate zoom, easing out for long
// balls, shots and set pieces and never cutting the ball off. Pure presentation state: it
// reads the match (ball, restart, players) and never touches it or any RNG.
//
//   const cam = new ActionCamera();
//   cam.resize(canvas.width, canvas.height, 'portrait');
//   cam.update(dt, match, 'follow', 1.5);   // every frame → cam.rect (world rectangle)
//   cam.snap();                             // the next update jumps (cuts, replays)
//
// Modes: 'wide' (the whole pitch) and 'follow'.
import { WORLD, fullView } from './geometry.js';

const W = 105,
  H = 68;
/** Default zoom levels (× the full-pitch view). */
export const CAMERA_ZOOM = Object.freeze({ follow: 1.5, replay: 1.7 });

const WIDE_RESTARTS = new Set(['Kickoff', 'Goal', 'Second half', 'Extra time', 'Goal kick']);
const POS_TIME = 0.42, // seconds to close most of a gap (critically damped)
  ZOOM_TIME = 0.75,
  MAX_PUSH = 80; // m/s the "keep the ball in frame" guard may move the camera

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (a, b, v) => {
  const k = clamp((v - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};

let dampVelocity = 0;
/** Critically damped spring step; the new velocity is left in `dampVelocity`. */
function damp(current, target, velocity, time, dt) {
  const omega = 2 / time,
    x = omega * dt,
    exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x),
    change = current - target,
    temp = (velocity + omega * change) * dt;
  dampVelocity = (velocity - omega * temp) * exp;
  return target + (change + temp) * exp;
}

/** One axis of keepInFrame: centre `c`, ball at `p`, `extent` metres visible. */
function guard(c, p, extent, lean, max) {
  const soft = extent / 2 - Math.max(5, extent * 0.17),
    hard = extent / 2 - Math.max(2.5, extent * 0.06),
    d = p - c;
  if (d > soft) c += (d - soft) * lean;
  else if (d < -soft) c += (d + soft) * lean;
  const e = p - c;
  if (e > hard) c += Math.min(e - hard, max);
  else if (e < -hard) c -= Math.min(-e - hard, max);
  return c;
}

export class ActionCamera {
  constructor() {
    this.full = { ...WORLD };
    this.rect = { ...WORLD };
    this.orientation = 'landscape';
    this.ex0 = WORLD.x1 - WORLD.x0;
    this.ey0 = WORLD.y1 - WORLD.y0;
    this.cx = this.tx = (WORLD.x0 + WORLD.x1) / 2;
    this.cy = this.ty = (WORLD.y0 + WORLD.y1) / 2;
    this.zoom = this.tz = 1;
    this.vx = this.vy = this.vz = 0;
    this.slack = 1;
    this.pending = true;
    this.settled = true;
  }

  /** Canvas size in device pixels (any unit: only the aspect matters). */
  resize(width, height, orientation = 'landscape') {
    this.orientation = orientation;
    fullView(width, height, orientation, this.full);
    this.ex0 = this.full.x1 - this.full.x0;
    this.ey0 = this.full.y1 - this.full.y0;
    // A stage much wider (or taller) than the pitch shows the full view letterboxed; the
    // follow zoom grows with that slack so the action still fills the stage.
    this.slack = clamp(
      Math.max(this.ex0 / (WORLD.x1 - WORLD.x0), this.ey0 / (WORLD.y1 - WORLD.y0)),
      1,
      1.45,
    );
    this.place();
  }

  /** True while the view is not the plain full pitch. */
  get zoomed() {
    return this.zoom > 1.0005;
  }

  /** Jump to the target on the next update (clip cuts, replays, reduced motion). */
  snap() {
    this.pending = true;
  }

  /** The zoom that shows `dx` × `dy` metres (along × across the pitch). */
  fit(dx, dy) {
    return Math.min(this.ex0 / dx, this.ey0 / dy);
  }

  aimWide() {
    this.tx = (WORLD.x0 + WORLD.x1) / 2;
    this.ty = (WORLD.y0 + WORLD.y1) / 2;
    this.tz = 1;
  }

  /** Where a follow camera wants to be for this match state. */
  aimFollow(m, base) {
    const b = m.ball;
    if (!b || m.finished || m.mode === 'halftime' || m.mode === 'fulltime') return this.aimWide();
    const restart = m.mode === 'restart' ? m.restart : null;
    if (restart && WIDE_RESTARTS.has(restart.type)) return this.aimWide();
    let fx = b.x,
      fy = b.y,
      z = base;
    if (restart && restart.x != null) {
      // Set piece: frame the taker and the goal he is aiming at when it is within reach.
      const dir =
          typeof m.direction === 'function'
            ? m.direction(restart.team)
            : restart.x > W / 2
              ? 1
              : -1,
        gx = dir > 0 ? W : 0,
        d = Math.abs(gx - restart.x);
      if (restart.type === 'Penalty') {
        // The duel: the taker, the spot and the keeper on his line, closer than open play.
        fx = restart.x + (gx - restart.x) * 0.45;
        fy = H / 2;
        z = Math.min(2.4, this.fit(d + 14, 32));
      } else if (d < 42) {
        fx = restart.x + (gx - restart.x) * 0.5;
        fy = restart.y + (H / 2 - restart.y) * 0.5;
        z = Math.min(z, this.fit(d + 16, Math.abs(H / 2 - restart.y) + 22));
      } else {
        fx = restart.x + dir * 8;
        fy = restart.y;
        z = Math.min(z, 1.3);
      }
    } else {
      const speed = Math.hypot(b.vx || 0, b.vy || 0),
        owner = b.owner != null ? m.players[b.owner] : null;
      if (owner) {
        fx += clamp((owner.vx || 0) * 0.5, -4, 4);
        fy += clamp((owner.vy || 0) * 0.5, -4, 4);
      } else if (speed > 1) {
        const lead = Math.min(speed * 0.28, 8);
        fx += (b.vx / speed) * lead;
        fy += (b.vy / speed) * lead;
      }
      const receiver = b.kind === 'pass' && b.target != null ? m.players[b.target] : null;
      if (b.kind === 'shot') {
        const gx = (b.vx || 0) > 0 || (!b.vx && b.x > W / 2) ? W : 0;
        fx = b.x + (gx - b.x) * 0.6;
        fy = b.y + (H / 2 - b.y) * 0.5;
        z = Math.min(z, this.fit(Math.abs(gx - b.x) + 16, Math.abs(H / 2 - b.y) + 18));
      } else if (receiver && !receiver.sentOff) {
        // A pass: hold both ends of it, easing out when it is a long one.
        fx = b.x + (receiver.x - b.x) * 0.5;
        fy = b.y + (receiver.y - b.y) * 0.5;
        z = Math.min(z, this.fit(Math.abs(receiver.x - b.x) + 18, Math.abs(receiver.y - b.y) + 18));
      } else {
        // Final third: lean towards the goal so the keeper and the posts are in the picture.
        const gx = fx > W / 2 ? W : 0,
          d = Math.abs(gx - fx);
        if (d < 34) fx += (gx - fx) * 0.32 * (1 - d / 34);
      }
      if (!owner && speed > 14) z *= 1 - 0.2 * smoothstep(14, 30, speed);
      z *= 1 - 0.1 * clamp((b.z || 0) / 6, 0, 1);
    }
    this.tx = fx;
    this.ty = fy;
    this.tz = Math.max(1, z);
  }

  /**
   * Advance by `dt` seconds towards the view for `mode`; returns `this.rect`.
   * `base` is the follow zoom (CAMERA_ZOOM.follow, lower at 2× / 4× playback).
   */
  update(dt, m, mode = 'wide', base = CAMERA_ZOOM.follow) {
    if (mode === 'follow' && m) this.aimFollow(m, base * this.slack);
    else this.aimWide();
    if (this.pending) {
      this.pending = false;
      this.cx = this.tx;
      this.cy = this.ty;
      this.zoom = this.tz;
      this.vx = this.vy = this.vz = 0;
    } else if (dt > 0) {
      const step = Math.min(dt, 0.1);
      this.cx = damp(this.cx, this.tx, this.vx, POS_TIME, step);
      this.vx = dampVelocity;
      this.cy = damp(this.cy, this.ty, this.vy, POS_TIME, step);
      this.vy = dampVelocity;
      this.zoom = damp(this.zoom, this.tz, this.vz, ZOOM_TIME, step);
      this.vz = dampVelocity;
      if (mode === 'follow' && m?.ball && this.zoom > 1.0005) this.keepInFrame(m.ball, step);
    }
    this.settled =
      Math.abs(this.cx - this.tx) < 0.03 &&
      Math.abs(this.cy - this.ty) < 0.03 &&
      Math.abs(this.zoom - this.tz) < 0.002 &&
      Math.abs(this.vx) + Math.abs(this.vy) < 0.05;
    if (this.settled && this.tz === 1) this.zoom = 1;
    return this.place();
  }

  /**
   * The ball never leaves the picture. Past a soft margin the view leans after it (easing in,
   * so a fast pass does not jerk the camera); a hard margin near the edge is absolute.
   */
  keepInFrame(b, dt) {
    const ex = this.ex0 / this.zoom,
      ey = this.ey0 / this.zoom,
      lean = Math.min(1, dt * 9),
      max = MAX_PUSH * dt;
    this.cx = guard(this.cx, b.x, ex, lean, max);
    this.cy = guard(this.cy, b.y, ey, lean, max);
  }

  /** Clamp to the pitch surround and write the rectangle. */
  place() {
    const ex = this.ex0 / this.zoom,
      ey = this.ey0 / this.zoom,
      wx = WORLD.x1 - WORLD.x0,
      wy = WORLD.y1 - WORLD.y0;
    this.cx =
      ex >= wx ? (WORLD.x0 + WORLD.x1) / 2 : clamp(this.cx, WORLD.x0 + ex / 2, WORLD.x1 - ex / 2);
    this.cy =
      ey >= wy ? (WORLD.y0 + WORLD.y1) / 2 : clamp(this.cy, WORLD.y0 + ey / 2, WORLD.y1 - ey / 2);
    const r = this.rect;
    r.x0 = this.cx - ex / 2;
    r.x1 = this.cx + ex / 2;
    r.y0 = this.cy - ey / 2;
    r.y1 = this.cy + ey / 2;
    return r;
  }
}
