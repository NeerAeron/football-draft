// Movement and contact: player motion, stamina, challenges, duels.
// Methods are installed on Match.prototype by match.js.
import { clamp, dist } from '../util/math.js';
import { offenceInBox } from './rules.js';
import { sigmoid } from './constants.js';

export class MovementMethods {
  move(p, dt, restart = false) {
    if (p.sentOff) return;
    let dx = p.tx - p.x,
      dy = p.ty - p.y;
    for (const q of this.activePlayers) {
      if (q.id === p.id) continue;
      const d = dist(p, q);
      if (d > 0.01 && d < 1.55) {
        const force = (1.55 - d) * (q.team === p.team ? 2 : 0.55);
        dx += ((p.x - q.x) / d) * force;
        dy += ((p.y - q.y) / d) * force;
      }
    }
    const d = Math.hypot(dx, dy),
      carrying = this.ball.owner === p.id && this.ball.kind !== 'held';
    const owner =
      !restart && p.intent === 'press' && this.ball.owner !== null
        ? this.players[this.ball.owner]
        : null;
    const carrier = owner && owner.team !== p.team ? owner : null;
    const goalSide = carrier && this.rel(p.x, p.team) < this.rel(carrier.x, p.team) + 0.4;
    const jockey = goalSide
      ? clamp((10 - dist(p, carrier)) / 4, 0, 1) * clamp(0.75 + p.pressingReading() * 0.35, 0, 1)
      : 0;
    const motion = jockey ? this.carrierMotion(p, carrier) : carrier;
    const urgent =
      [
        'press',
        'cover',
        'recover',
        'receive',
        'intercept',
        'sweep',
        'dribble',
        'track',
        'reset',
      ].includes(p.intent) ||
      (p.intent === 'mark' && (d > 3 || Math.hypot(p.vx, p.vy) > p.topSpeed() * 0.55)) ||
      (p.intent === 'run' && d > 5) ||
      (carrying && d > 4 && p.tendency('advance') > 0.48);
    if (p.sprint < 0.08) p.sprintRest = Math.max(p.sprintRest, 1.8);
    p.sprintRest = Math.max(0, p.sprintRest - dt);
    const trackingRun = jockey > 0 && Math.hypot(carrier.vx, carrier.vy) > p.topSpeed() * 0.65;
    const sprint = urgent && p.sprint > 0.16 && p.sprintRest === 0 && (d > 2 || trackingRun);
    let max =
      p.topSpeed(carrying) *
      (restart
        ? 0.6
        : sprint
          ? 0.84 + 0.16 * clamp(p.sprint / 0.45, 0, 1)
          : p.intent === 'hold'
            ? 0.25
            : 0.7);
    if (p.stun > 0) max *= 0.2;
    const mark =
      !restart && ['mark', 'track'].includes(p.intent) && p.markId != null
        ? this.players[p.markId]
        : null;
    // A moving mark is not a stationary arrival point. Match their velocity
    // before braking, otherwise the defender trails just behind the runner.
    const targetSpeed = Math.min(max, d * 2.1),
      followX =
        (mark?.vx || 0) + (motion?.vx || 0) * jockey + (d > 0.02 ? (dx / d) * targetSpeed : 0),
      followY =
        (mark?.vy || 0) + (motion?.vy || 0) * jockey + (d > 0.02 ? (dy / d) * targetSpeed : 0);
    const followScale = Math.min(1, max / (Math.hypot(followX, followY) || 1)),
      vx = followX * followScale,
      vy = followY * followScale;
    const accel = p.acceleration() * (0.72 + p.energy * 0.28) * dt,
      dv = Math.hypot(vx - p.vx, vy - p.vy),
      weight = Math.min(1, accel / (dv || 1));
    p.vx += (vx - p.vx) * weight;
    p.vy += (vy - p.vy) * weight;
    const speed = Math.hypot(p.vx, p.vy);
    p.stats.distance += speed * dt;
    p.x = clamp(p.x + p.vx * dt, 0.5, 104.5);
    p.y = clamp(p.y + p.vy * dt, 0.5, 67.5);
    if (speed > 0.3) p.facing = Math.atan2(p.vy, p.vx);
    const effort = speed / p.baseSpeed(),
      stamina = p.skill('stamina') / 100;
    const burst = sprint && effort > 0.72 && !restart;
    p.sprint = clamp(
      p.sprint +
        dt *
          (burst
            ? -this.tuning.stamina.sprintDrain / (3.1 + stamina * 4.5)
            : this.tuning.stamina.sprintRecovery *
              (0.065 + stamina * 0.065) *
              Math.max(0.2, 1 - effort)),
      0,
      1,
    );
    // Work is normalized by match fraction; sprint reserve remains in real seconds.
    const relativeEffort = effort / (0.72 + p.energy * 0.28);
    const workload =
      0.55 +
      relativeEffort * relativeEffort * 1.05 +
      (burst ? 0.32 : 0) +
      Math.min(dv / dt, 12) * 0.005;
    const lowReserve = p.energy < 0.18 ? 0.35 + (0.65 * p.energy) / 0.18 : 1;
    const drain =
      (dt / this.duration) *
      workload *
      (1.12 - stamina * 0.33) *
      (p.has('engine') ? 0.96 : 1) *
      (restart ? 0.65 : 1) *
      (this.half === 2 ? 1.1 : 1);
    p.energy = clamp(p.energy - drain * lowReserve * this.tuning.stamina.drain, 0.001, 1);
    p.cooldown = Math.max(0, p.cooldown - dt);
    p.stun = Math.max(0, p.stun - dt);
    p.feintCooldown = Math.max(0, p.feintCooldown - dt);
    if (p.animation && this.elapsed - p.animation.start > p.animation.duration) p.animation = null;
  }
  challengeModel(p, q) {
    const bearing =
      ((q.x - p.x) * Math.cos(p.facing) + (q.y - p.y) * Math.sin(p.facing)) / (dist(p, q) || 1);
    const closing = Math.hypot(q.vx - p.vx, q.vy - p.vy),
      behind = Math.max(0, -bearing),
      reach = dist(q, this.ball);
    const fatigue = 1 - q.energy,
      aggression = q.tendency('aggression'),
      discipline = q.tendency('discipline');
    const caution = offenceInBox(this, q, p) ? 0.75 : 1;
    const foul = clamp(
      (0.009 +
        behind * 0.052 +
        (closing / 9) ** 2 * 0.04 +
        (reach > 1.1 ? 0.022 : 0) +
        (1 - discipline) * 0.044 +
        (100 - q.tackling()) * 0.00035 +
        fatigue * 0.035) *
        (0.7 + aggression * 0.65) *
        caution,
      0.007,
      0.34,
    );
    const protection =
      p.skill('dribbling') * 0.65 +
      p.skill('control') * 0.2 +
      p.skill('strength') * 0.15 +
      (p.has('control') ? 4 : 0);
    const shielding =
      clamp((p.skill('control') + p.skill('composure') - 140) / 70, 0, 0.55) *
      (0.75 + p.energy * 0.25);
    const win = clamp(
      sigmoid(
        (q.tackling() - protection) / 26 +
          bearing * 0.55 -
          0.55 +
          (q.skill('strength') - p.skill('strength')) * 0.004 +
          (q.energy - p.energy) * 0.7,
      ) *
        (1 - shielding * 0.45),
      0.04,
      0.84,
    );
    const cautionFactor = q.yellowCards === 1 ? this.tuning.discipline.bookedFoulRisk : 1;
    return {
      foul: clamp(foul * this.tuning.gameplay.foulFrequency * cautionFactor, 0, 0.8),
      win: clamp(win * this.tuning.gameplay.tackleSuccess, 0.01, 0.99),
      hard: closing > 4,
      bearing,
      closing,
    };
  }
  duel(p, q) {
    if (p.sentOff || q.sentOff) return false;
    const b = this.ball;
    if (
      b.kind === 'held' ||
      q.cooldown > 0 ||
      q.stun > 0 ||
      (dist(q, b) > 1.15 + q.skill('defending') * 0.006 + (q.has('ballwinner') ? 0.12 : 0) &&
        dist(q, p) > 0.85)
    )
      return false;
    const press = this.teams[q.team].tactics.press,
      model = this.challengeModel(p, q);
    if (
      q.yellowCards === 1 &&
      (model.bearing < -0.1 || model.closing > 6) &&
      this.rand() < this.tuning.discipline.bookedRiskAversion
    ) {
      q.cooldown = 0.35 + q.tendency('discipline') * 0.25;
      q.action = 'Staying on feet after booking';
      return false;
    }
    q.cooldown =
      0.55 + (5 - press) * 0.11 + (1 - q.tendency('aggression')) * 0.25 + this.rand() * 0.2;
    if (q.yellowCards === 1) q.cooldown *= 1.35;
    q.animation = {
      type: 'tackle',
      start: this.elapsed,
      duration: 0.38,
      angle: Math.atan2(b.y - q.y, b.x - q.x),
      hard: model.hard,
    };
    this.duelHistory.push({
      at: this.elapsed,
      team: q.team,
      foulChance: model.foul,
      winChance: model.win,
      box: offenceInBox(this, q, p),
    });
    if (this.rand() < model.foul) {
      this.awardFoul(q, p);
      return true;
    }
    if (this.rand() < model.win) {
      this.pendingTackle = {
        id: q.id,
        team: q.team,
        at: this.elapsed,
        hard: model.hard,
        chance: model.win * (1 - model.foul),
        strength: clamp(model.closing / 10, 0.2, 1),
      };
      p.stats.turnovers++;
      p.cooldown = 0.5;
      p.stun = 0.28;
      p.animation = { type: 'stumble', start: this.elapsed, duration: 0.4 };
      b.owner = null;
      b.kind = 'loose';
      b.target = null;
      b.kicker = p.id;
      b.age = 0;
      b.lastTouch = q.team;
      b.offsideState = null;
      const escape = this.carryTarget(q),
        angle = Math.atan2(escape.y - q.y, escape.x - q.x);
      b.vx = Math.cos(angle) * (1.3 + this.rand() * 1.5);
      b.vy = Math.sin(angle) * (1.3 + this.rand() * 1.5);
      b.vz = model.hard ? 1.1 : 0.3;
      q.action = 'Collecting the tackle';
      q.cooldown = 0.1;
      this.planTimer = 0;
      return true;
    }
    return false;
  }
  contestAerial(p) {
    const rival = this.activePlayers
      .filter(q => q.team !== p.team && q.role !== 'GK' && q.cooldown <= 0 && dist(q, p) < 1.35)
      .sort((a, b) => dist(a, p) - dist(b, p))[0];
    if (!rival) return false;
    const model = this.challengeModel(p, rival);
    rival.cooldown = 0.7;
    if (this.rand() < model.foul * (0.7 + rival.tendency('aggression'))) {
      this.awardFoul(rival, p);
      return true;
    }
    return false;
  }
}
