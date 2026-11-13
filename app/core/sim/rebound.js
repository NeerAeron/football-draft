// Second balls: a shot the keeper parried, a defender blocked or the woodwork kept out is loose
// in front of goal. For a few seconds the defending side treats it as the emergency it is —
// its nearest two outfielders go for the ball (and hack it clear when an attacker is on them),
// the keeper claims a ball he reaches first, the rest stay with their men — while the
// attacking side follows in. Nothing is decided here: who gets there first is still run by
// legs and distance. Methods are installed on Match.prototype by match.js.
import { clamp } from '../util/math.js';
import { LOOSE_ROLL, LOOSE_DRAG, hypot } from './constants.js';

// How long after the save the ball counts as a rebound, and how far from the goal line.
export const REBOUND_SECONDS = 3,
  REBOUND_DEPTH = 30;
// How long the shooter cannot take the ball again after his shot was kept out.
const FOLLOW_THROUGH = 0.5;
const STEP = 0.1,
  HORIZON = 2.4;
// Scratch result of loosePoint (planning runs for one match at a time; no allocation).
const MEET = { x: 0, y: 0, time: 0 };

export class ReboundMethods {
  // The shot ended loose: `team` defends the goal it was struck at. Both sides see it in the
  // same instant (the next step plans, and nobody waits for his own rethink).
  startRebound(team) {
    const b = this.ball;
    b.reboundTeam = team;
    b.reboundAt = this.elapsed;
    if (!this.tuning.gameplay.secondBalls) return;
    // The man who struck it is still in his follow-through: a ball blocked back at him is
    // not at his feet again in the same instant (he used to shoot twice in a quarter second).
    const shooter = b.shotRecord ? this.players[b.shotRecord.player] : null;
    if (shooter && shooter.team !== team) {
      shooter.controlUntil = Math.max(shooter.controlUntil || 0, this.elapsed + FOLLOW_THROUGH);
      shooter.controlErrorAt = shooter.controlUntil; // no early touch on a ball at his feet
    }
    const players = this.activePlayers;
    for (let i = 0; i < players.length; i++) players[i].rethinkAt = 0;
    this.planTimer = 0;
  }
  // The side defending a live rebound, or -1.
  reboundSide() {
    const b = this.ball,
      team = b.reboundTeam;
    return team != null &&
      b.owner === null &&
      b.kind === 'loose' &&
      this.mode === 'play' &&
      this.elapsed - b.reboundAt < REBOUND_SECONDS &&
      this.rel(b.x, team) < REBOUND_DEPTH &&
      this.tuning.gameplay.secondBalls > 0
      ? team
      : -1;
  }
  // Where p can first meet the loose ball: its path is rolled forward (bounces, grass) and
  // the first point he reaches no later than the ball — turning included, which a straight
  // intercept ignores: a defender running back at his goal used to overrun a ball parried
  // out past him. `high`: he may take it up to this height. Returns a scratch object.
  loosePoint(p, high = 1.1) {
    const b = this.ball,
      speed = p.arrivalSpeed(),
      acceleration = p.acceleration(),
      wait = Math.max(p.stun, (p.controlUntil || 0) - this.elapsed, 0);
    let x = b.x,
      y = b.y,
      z = b.z,
      vx = b.vx,
      vy = b.vy,
      vz = b.vz,
      t = 0;
    for (;;) {
      MEET.x = x;
      MEET.y = y;
      MEET.time = t;
      if (t >= HORIZON) break;
      if (z <= high) {
        const dx = x - p.x,
          dy = y - p.y;
        // Next to it already: no turn to allow for.
        if (dx * dx + dy * dy < 1.2 && wait <= t) break;
        if (p.arrivalAt(MEET, speed, acceleration) + wait <= t) break;
      }
      x += vx * STEP;
      y += vy * STEP;
      z = Math.max(0, z + vz * STEP - 4.905 * STEP * STEP);
      vz -= 9.81 * STEP;
      if (z === 0) {
        vz = Math.abs(vz) > 0.9 ? -vz * 0.3 : 0;
        const pace = hypot(vx, vy),
          drag = Math.max(0, 1 - ((LOOSE_ROLL + LOOSE_DRAG * pace) * STEP) / (pace || 1));
        vx *= drag;
        vy *= drag;
      }
      if (x < 0.5 || x > 104.5 || y < 0.5 || y > 67.5) {
        // Going out: the last point on the pitch is as far as anyone can follow it.
        MEET.x = clamp(x, 0.5, 104.5);
        MEET.y = clamp(y, 0.5, 67.5);
        MEET.time = t + STEP;
        break;
      }
      t += STEP;
    }
    return MEET;
  }
  // True when defender p, reaching a live rebound in his own box with an attacker close,
  // should put his foot through it instead of taking a touch.
  shouldClearRebound(p) {
    const b = this.ball;
    if (p.role === 'GK' || b.z > 1.15 || this.reboundSide() !== p.team) return false;
    if (!this.inBox(p, 1 - p.team)) return false;
    const players = this.activePlayers;
    for (let i = 0; i < players.length; i++) {
      const q = players[i];
      if (q.team === p.team || q.role === 'GK' || q.stun > 0) continue;
      const dx = q.x - b.x,
        dy = q.y - b.y;
      if (dx * dx + dy * dy < 20.25) return true; // an attacker within 4.5 m of the ball
    }
    return false;
  }
  // The clearance: away from goal and out towards the nearer touchline, lofted. A hurried or
  // clumsy one is sliced — behind for a corner, or short and wide where it is fought for.
  clearRebound(p) {
    const b = this.ball,
      out = this.direction(p.team),
      side = Math.abs(b.y - 34) > 1.5 ? Math.sign(b.y - 34) : p.y > b.y ? -1 : 1,
      calm = p.skill('defending') * 0.5 + p.skill('composure') * 0.3 + p.skill('power') * 0.2,
      sliced = this.rand() < clamp(0.14 - (calm - 65) * 0.005, 0.04, 0.3);
    if (sliced) {
      // Off the outside of the boot: square towards the touchline, as often as not behind.
      b.vx = out * (this.rand() * 9 - 5);
      b.vy = side * (9 + this.rand() * 5);
      b.vz = 3 + this.rand() * 3;
    } else {
      // Upfield through the widest gap between the attackers closing in (five directions,
      // 60° either side of straight out), the touchline side preferred.
      const players = this.activePlayers;
      let angle = 0,
        best = -Infinity;
      for (let k = -2; k <= 2; k++) {
        const a = k * 0.52,
          ux = out * Math.cos(a),
          uy = Math.sin(a);
        let gap = 4;
        for (let i = 0; i < players.length; i++) {
          const q = players[i];
          if (q.team === p.team) continue;
          const rx = q.x - b.x,
            ry = q.y - b.y,
            along = rx * ux + ry * uy;
          if (along < -0.5 || along > 8) continue;
          gap = Math.min(gap, Math.abs(rx * uy - ry * ux) + Math.max(0, along - 3) * 0.6);
        }
        const score = gap + (uy * side > 0 ? 0.5 : 0) + (k === 0 ? 0.2 : 0);
        if (score > best) {
          best = score;
          angle = a;
        }
      }
      angle += (this.rand() - 0.5) * 0.3;
      const pace = 11 + this.rand() * 5 + p.skill('power') * 0.04;
      b.vx = out * Math.cos(angle) * pace;
      b.vy = Math.sin(angle) * pace;
      b.vz = 6 + this.rand() * 2.5;
    }
    b.kind = 'loose';
    b.owner = null;
    b.target = null;
    b.lastTouch = p.team;
    b.kicker = p.id;
    b.deflectedBy = p.id;
    b.deflectedAt = this.elapsed;
    b.age = 0;
    b.indirect = null;
    b.penaltyTaker = null;
    b.restartTaker = null;
    b.offsideState = null;
    b.pendingPass = null;
    b.missedReceiver = false;
    b.shotRecord = null;
    b.shotOrigin = null;
    b.shotType = null;
    b.goalCredit = null;
    p.cooldown = 0.4;
    p.action = 'Clearing the rebound';
    p.animation = {
      type: 'tackle',
      start: this.elapsed,
      duration: 0.3,
      angle: Math.atan2(b.vy, b.vx),
      hard: false,
    };
    this.planTimer = 0;
  }
}
