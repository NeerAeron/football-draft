// The whistle at the end of a period. The referee does not blow in the middle of a promising
// attack, and a corner, an attacking free kick or a penalty that has been awarded is taken
// even when time is up. Bounded by tuning.periods.hold* (real seconds: an attack takes the same
// time on the pitch whatever the match length) and free of RNG: a match in which nothing is
// on when time runs out ends exactly as it did before.
// Methods are installed on Match.prototype by match.js. See docs/engine-events.md.
import { W, hypot } from './constants.js';

const THIRD = 70; // the attacking third starts here (m from the attackers' own goal line)
const BOX = 88.5; // the penalty area
const BOX_HALF = 20.16;
// The attack is over when the attackers have been without it this long: the ball cleared, a
// defender on it, a pass gone astray (a tackle that breaks back to an attacker is not).
const GRACE = 0.5;
// A set piece awarded in held time needs this long after its delivery to be worth taking.
const PLAY_OUT = 2;
// A struck shot, and the goal it scores, are never cut off (they were not before either).
const SETTLE = 3;

export class WhistleMethods {
  resetHold() {
    this.holdTeam = -1;
    this.holdSince = 0;
    this.holdSeen = 0;
    this.holdCorners = 0;
    this.holdPiece = false;
  }
  /**
   * The side with an attack on right now (0 / 1), or -1: it has the ball within
   * tuning.periods.holdRange metres of the goal line it attacks, a pass or cross of its own is
   * on its way there, its shot is in flight, a loose ball is in the box it attacks, or its
   * corner / free kick in the attacking third is being set up.
   * `holding`: the side the whistle is being held for — its attack lasts while it keeps the
   * ball anywhere in the attacking third, and a loose ball there is still its attack.
   */
  liveAttack(holding = -1) {
    const b = this.ball,
      near = W - this.tuning.periods.holdRange;
    if (this.mode === 'restart') {
      const r = this.restart;
      if (r.type === 'Corner') return r.team;
      if (
        (r.type === 'Free kick' || r.type === 'Indirect free kick') &&
        this.rel(r.x, r.team) >= THIRD
      )
        return r.team;
      return -1;
    }
    if (this.mode !== 'play') return -1;
    if (b.owner !== null) {
      const p = this.players[b.owner];
      return b.kind !== 'held' &&
        this.rel(b.x, p.team) >= (p.team === holding ? Math.min(near, THIRD) : near)
        ? p.team
        : -1;
    }
    if (b.kind === 'shot') return b.shotTeam ?? -1;
    if (b.kind === 'pass' && b.kicker != null && !b.missedReceiver) {
      const team = this.players[b.kicker].team;
      const from = team === holding ? Math.min(near, THIRD) : near;
      if (b.delivery === 'clearance') return -1;
      return this.rel(b.x, team) >= from ||
        (b.destination && this.rel(b.destination.x, team) >= from)
        ? team
        : -1;
    }
    // Loose (a rebound, a deflection, a pass nobody met).
    if (holding >= 0 && this.rel(b.x, holding) >= THIRD) return holding;
    if (Math.abs(b.y - 34) <= BOX_HALF) {
      if (this.rel(b.x, 0) >= BOX) return 0;
      if (this.rel(b.x, 1) >= BOX) return 1;
    }
    return -1;
  }
  /**
   * Time is up (`over` real seconds ago): does the referee let play go on? Called every step
   * from the deadline until it returns false.
   */
  whistleHeld(over) {
    const b = this.ball,
      r = this.restart,
      rules = this.tuning.periods,
      restart = this.mode === 'restart';
    // A penalty is always taken, and the kick decided.
    if (
      (restart && r.type === 'Penalty') ||
      (b.penaltyKick && (b.kind === 'shot' || b.kind === 'loose') && hypot(b.vx, b.vy) > 0.5)
    )
      return true;
    // A shot in flight, and the celebration of the goal it scored.
    if (
      ((b.kind === 'shot' && b.age < SETTLE) || (restart && r.type === 'Goal' && r.timer > 0.1)) &&
      over <= rules.holdMaximum + 4
    )
      return true;
    if (over > rules.holdMaximum) return false;
    const team = this.liveAttack(this.holdTeam);
    if (this.holdTeam < 0) {
      if (team < 0) return false;
      this.holdTeam = team;
      this.holdSince = this.holdSeen = this.elapsed;
      // A set piece already awarded when time ran out is not one of the extra corners.
      this.holdPiece = restart;
    }
    if (restart) {
      // A goal kick, a throw-in, a free kick to the defenders, offside: that was the attack.
      if (team !== this.holdTeam) return false;
      if (!this.holdPiece) {
        const corner = r.type === 'Corner';
        if (corner && this.holdCorners >= rules.holdCorners) return false;
        if (over + r.timer + PLAY_OUT > rules.holdMaximum) return false;
        if (corner) this.holdCorners++;
        this.holdPiece = true;
      }
      // Its allowance runs from the delivery.
      this.holdSince = this.holdSeen = this.elapsed;
      return true;
    }
    this.holdPiece = false;
    if (b.owner !== null && b.kind === 'held') return false; // the keeper has it
    if (team === this.holdTeam) this.holdSeen = this.elapsed;
    else if (this.elapsed - this.holdSeen > GRACE) return false;
    if (this.elapsed - this.holdSince <= rules.holdAttack) return true;
    // Out of time for this attack — but not with the cross on its way into the box.
    return (
      b.kind === 'pass' &&
      team === this.holdTeam &&
      !!b.destination &&
      this.rel(b.destination.x, team) >= BOX &&
      Math.abs(b.destination.y - 34) <= BOX_HALF
    );
  }
}
