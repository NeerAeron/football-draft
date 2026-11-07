// Possession: taking the ball (own), first-touch quality, collection reach.
// Methods are installed on Match.prototype by match.js.
import { clamp, lerp } from '../util/math.js';
import { skillError, dist, hypot } from './constants.js';

export class PossessionMethods {
  own(p, handling = false) {
    if (p.sentOff) return false;
    handling = handling && this.canHandle(p);
    if (this.checkRestartTouch(p) || this.checkOffside(p)) return false;
    const b = this.ball,
      passer =
        b.kind === 'pass' && b.kicker !== null
          ? this.players[b.kicker]
          : b.pendingPass
            ? this.players[b.pendingPass.from]
            : null;
    const regain = this.lastTeam !== p.team,
      arrivalHeight = b.z;
    p.lastReceipt = null;
    if (passer && passer.team === p.team && p.id !== passer.id) {
      this.stats[p.team].completed++;
      passer.stats.completed++;
      p.lastReceipt = {
        from: passer.id,
        at: this.elapsed,
        type: b.pendingPass?.delivery || b.delivery || 'pass',
        chance: b.pendingPass?.chance ?? b.chance,
        height: arrivalHeight,
      };
      this.lastPass = { ...p.lastReceipt, to: p.id };
      if (['cross', 'cutback', 'through'].includes(b.delivery) && this.rel(p.x, p.team) > 73) {
        const label =
          b.delivery === 'through'
            ? 'Through ball'
            : b.delivery === 'cutback'
              ? 'Cutback'
              : 'Cross';
        this.addEvent(
          `${passer.name.split(' ').pop()} → ${p.name.split(' ').pop()} · ${label.toLowerCase()}`,
          p.team,
          b.delivery,
          {
            playerId: passer.id,
            chance: b.chance,
            chanceLabel: 'completion',
            strength: b.strength,
          },
        );
        this.flair('delivery', p, 0.7, { label, strength: b.strength });
      }
    } else {
      this.lastPass = null;
      if (passer && passer.team !== p.team) p.stats.interceptions++;
    }
    if (regain) {
      if (b.owner !== null && this.players[b.owner].team !== p.team)
        this.players[b.owner].stats.turnovers++;
      this.possessionStart = this.elapsed;
      this.startChain(p.team, p.x, null, true);
      if (
        this.keeperRelease &&
        this.keeperRelease.team !== p.team &&
        this.elapsed - this.keeperRelease.at < 5
      )
        this.stats[this.keeperRelease.team].keeperLosses++;
      this.keeperRelease = null;
    }
    if (this.pendingTackle) {
      const win = this.pendingTackle;
      if (p.team === win.team && this.elapsed - win.at < 3) {
        const q = this.players[win.id];
        q.stats.tackles++;
        this.stats[p.team].tackles++;
        this.addEvent(`${q.name.split(' ').pop()} wins possession.`, p.team, 'tackle', {
          playerId: q.id,
          chance: win.chance,
          chanceLabel: 'clean win',
          strength: win.strength,
        });
        this.flair('tackle', q, 0.65, {
          hard: win.hard,
          strength: win.strength,
          label: 'BALL WON',
        });
      }
      this.pendingTackle = null;
    }
    b.owner = p.id;
    b.pendingPass = null;
    b.missedReceiver = false;
    b.previous = null;
    b.kind = handling ? 'held' : 'dribble';
    b.heldSince = handling ? this.elapsed : null;
    b.z = b.vz = 0;
    b.vx = p.vx;
    b.vy = p.vy;
    b.lastTouch = p.team;
    b.kicker = null;
    b.target = null;
    b.offside = false;
    b.offsideState = null;
    b.age = 0;
    b.shotOrigin = null;
    b.shotType = null;
    b.shotRecord = null;
    b.assist = null;
    b.goalCredit = null;
    b.deliveryOrigin = null;
    b.curve = 0;
    b.indirect = null;
    b.penaltyTaker = null;
    b.restartTaker = null;
    b.penaltyKick = false;
    p.beatChain = [];
    p.finishUntil = 0;
    p.hold = 0;
    p.receivedAt = this.elapsed;
    p.possessionAt = this.elapsed;
    p.think = p.has('onetouch') ? 0.07 : 0.1 + (100 - p.skill('composure')) / 700;
    p.touch = 0;
    p.controlUntil = 0;
    p.cooldown = Math.min(p.cooldown, 0.08);
    p.stun = 0;
    p.animation = null;
    this.lastTeam = p.team;
    for (const q of this.activePlayers) q.rethinkAt = 0;
    this.planTimer = 0;
    if (
      p.lastReceipt &&
      Math.abs(p.y - 34) < 16 &&
      this.rel(p.x, p.team) > 40 &&
      this.rel(p.x, p.team) < 85
    )
      this.startCombination(p, passer);
    if (handling) p.aim(this.abs(6, p.team), clamp(p.y, 27, 41), 'hold', 'Ball secured in hands');
    else {
      const escape = this.carryTarget(p);
      p.aim(
        escape.x,
        escape.y,
        'carry',
        regain ? 'Turning away with the ball' : 'Taking a first touch',
      );
      if (hypot(p.vx, p.vy) < 1) p.facing = Math.atan2(escape.y - p.y, escape.x - p.x);
    }
    return true;
  }
  firstTouchChance(
    p,
    height,
    speed,
    pressure,
    teammate = false,
    contactGap = 0,
    expectedDemand = null,
  ) {
    const backpass =
      teammate ||
      (this.ball.pendingPass &&
        this.players[this.ball.pendingPass.from]?.team === p.team &&
        this.ball.lastTouch === p.team);
    const catching = this.canHandle(p) && !backpass,
      ability = p.skill(catching ? 'goalkeeping' : height > 1.15 ? 'heading' : 'control');
    const control = clamp(
      0.66 +
        ability * 0.0031 +
        (p.has('interceptor') ? 0.06 : 0) -
        Math.max(0, speed - 17) * 0.02 -
        pressure * 0.04 -
        (1 - p.energy) * 0.12 -
        (1 - p.familiarity()) * 0.12 -
        (height > 1 ? 0.12 : 0),
      0.3,
      0.99,
    );
    // Routine receptions are much more dependable than contested, fast or
    // aerial deliveries. Preserve those demands and the receiver's ability.
    const demand =
      expectedDemand ??
      (teammate && this.ball.kind === 'pass' ? (this.ball.deliveryDemand ?? 0) : 0);
    const stretch = clamp((contactGap - 0.6) / 0.65, 0, 1) * 0.22;
    const difficulty = clamp(
      Math.max(0, height - 0.3) / 1.3 +
        Math.max(0, speed - 18) / 12 +
        pressure * 1.1 +
        demand * 0.8 +
        stretch,
      0,
      1,
    );
    const technique = clamp(
      1 -
        Math.max(p.skill('control') - 75, 0) * 0.008 +
        Math.max(75 - p.skill('control'), 0) * 0.012,
      0.8,
      1.15,
    );
    const reception = teammate
      ? lerp(
          this.tuning.gameplay.receptionError * technique,
          this.tuning.gameplay.difficultReceptionError,
          difficulty,
        )
      : 1;
    const execution = skillError(
      ability,
      this.tuning.gameplay.controlQuality * (teammate ? difficulty : 0.5),
    );
    return clamp(
      1 -
        ((1 - control) * reception * execution * this.tuning.gameplay.firstTouchError) /
          (teammate ? this.tuning.gameplay.passCompletion : 1),
      0.01,
      0.999,
    );
  }
  collectionReach(p) {
    const b = this.ball,
      base = b.z > 1.1 ? 1.05 : 0.85;
    const receiving =
      b.kind === 'pass' && b.target === p.id && this.players[b.kicker]?.team === p.team;
    // A small reach for the intended receiver, not a larger interception
    // radius for everybody. High balls still require heading and timing.
    const settled = b.kind === 'loose' && b.z < 0.3 && hypot(b.vx, b.vy) < 5;
    return (
      (base +
        (receiving && b.z < 0.6
          ? 0.21 + clamp((p.skill('control') - 50) * 0.002, 0, 0.1)
          : settled
            ? 0.1
            : 0)) *
      this.tuning.gameplay.interceptionReach
    );
  }
  canCollect(p) {
    const b = this.ball;
    if (p.sentOff || p.stun > 0) return false;
    // In a shootout only the keeper may touch the kick; no follow-ups.
    if (this.mode === 'shootout' && p.id !== this.shootoutState?.kick?.keeperId) return false;
    if (p.id === b.kicker && b.age < 0.45 && ['pass', 'shot'].includes(b.kind)) return false;
    // A tackle cooldown is not a ban on taking a loose ball. Keep a separate,
    // short first-touch recovery, with an escape for a ball settled at the feet.
    const settled =
      (b.kind === 'loose' || b.missedReceiver) &&
      b.z < 0.3 &&
      hypot(b.vx, b.vy) < 3.2 &&
      dist(p, b) < 1;
    if (
      (p.controlUntil || 0) > this.elapsed &&
      !(settled && this.elapsed - (p.controlErrorAt ?? -10) > 0.12)
    )
      return false;
    const receiving =
      b.kind === 'pass' && b.target === p.id && this.players[b.kicker]?.team === p.team;
    return receiving || b.kind === 'loose' || b.missedReceiver || p.cooldown <= 0;
  }
  // The ball at a player's feet (or in a keeper's hands): decisions when the
  // thinking time runs out, duels, dribbling contact and heavy touches.
  stepCarrier(dt) {
    const b = this.ball;
    const p = this.players[b.owner];
    p.hold += dt;
    p.think -= dt;
    p.touch += dt;
    if (p.think <= 0) {
      if (b.kind !== 'held')
        for (const q of this.activePlayers) if (q.team !== p.team && this.duel(p, q)) break;
      if (b.owner === p.id && this.mode === 'play') this.decide(p);
    }
    if (b.owner !== null) {
      const held = b.kind === 'held';
      const gait = Math.sin(p.touch * (6 + p.skill('dribbling') * 0.055));
      const firstTouch = clamp((this.elapsed - p.receivedAt) / 0.6, 0, 1),
        protection = this.pressure(p);
      const lead = held
        ? 0.36
        : (((p.has('control') ? 0.3 : 0.42) +
            (1 - p.skill('dribbling') / 100) * 0.6 +
            (0.08 + hypot(p.vx, p.vy) * 0.025) * (gait + 1)) *
            (0.62 + firstTouch * 0.38)) /
          (1 + protection * 0.1 + p.skill('strength') * 0.001);
      let angle = p.facing;
      if (p.animation?.type === 'feint')
        angle +=
          Math.sin(((this.elapsed - p.animation.start) / p.animation.duration) * Math.PI * 2) *
          0.65 *
          p.animation.side;
      b.previous = null;
      b.x = p.x + Math.cos(angle) * lead;
      b.y = p.y + Math.sin(angle) * lead;
      b.vx = p.vx;
      b.vy = p.vy;
      b.z = held ? 0.8 : 0.05;
      b.lastTouch = p.team;
      if (!held) {
        for (const q of this.activePlayers) if (q.team !== p.team && this.duel(p, q)) break;
        if (
          b.owner !== null &&
          hypot(p.vx, p.vy) > 4 &&
          this.rand() <
            ((dt * 0.07 * this.tuning.gameplay.dribbleLoss * (100 - p.skill('dribbling'))) / 70) *
              skillError(
                p.skill('control') * 0.65 + p.skill('dribbling') * 0.35,
                this.tuning.gameplay.controlQuality,
              ) *
              (1 + this.executionPressure(p) * 0.35 + (1 - p.energy))
        ) {
          b.owner = null;
          b.kind = 'loose';
          b.kicker = p.id;
          b.target = null;
          b.age = 0;
          b.vx = p.vx * 1.4;
          b.vy = p.vy * 1.4;
          p.cooldown = 0.25;
          p.controlUntil = this.elapsed + 0.16;
          p.controlErrorAt = this.elapsed;
          p.action = 'Heavy touch';
          p.stats.miscontrols++;
          this.stats[p.team].miscontrols++;
          p.stats.turnovers++;
          this.planTimer = 0;
        }
      }
    }
  }
}
