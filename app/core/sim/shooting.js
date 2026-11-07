// Shooting: shot type choice, shot execution, outcome bookkeeping, on-target projection.
// Methods are installed on Match.prototype by match.js.
import { clamp, lerp } from '../util/math.js';
import { footExecution } from './player-model.js';
import { offsideSnapshot, targetChance } from './rules.js';
import { shootingAbility } from '../players/ratings.js';
import { GOAL } from './constants.js';

export class ShootingMethods {
  shotWeights(p, d, aerialHeight = 0, penalty = false) {
    if (penalty) return [['Penalty', 1]];
    if (aerialHeight > 1.15)
      return [
        ['Header', 0.9 + p.skill('heading') / 100],
        ['Volley', aerialHeight < 1.7 ? (p.has('volley') ? 0.65 : 0.3) : 0.02],
      ];
    if (aerialHeight > 0.4)
      return [
        ['Volley', 1],
        ['Driven shot', 0.25],
      ];
    return [
      ['Placed finish', d < 16 ? 1.2 + p.skill('composure') / 100 : 0.12],
      ['Driven shot', 1.1],
      ['Power shot', 0.25 + p.skill('power') * 0.006 + (p.has('power') ? 1.4 : 0)],
      ['Curler', (d > 10 ? 0.12 : 0.015) + (p.has('curve') && d > 10 ? 1.4 : 0)],
      ['Knuckleball', d > 19 ? 0.022 + (p.has('knuckle') ? 0.85 : 0) : 0.001],
    ];
  }
  chooseWeighted(options) {
    let n = this.rand() * options.reduce((sum, [, weight]) => sum + weight, 0);
    for (const [value, weight] of options) {
      n -= weight;
      if (n <= 0) return value;
    }
    return options.at(-1)[0];
  }
  shoot(p, context = {}) {
    if (p.sentOff) return;
    p.beatChain = [];
    const b = this.ball,
      goalX = this.abs(105, p.team),
      d = Math.hypot(goalX - p.x, 34 - p.y),
      pressure = this.pressure(p),
      box = this.inBox(p),
      spatial = this.location(p),
      penalty = !!context.penalty;
    const shotType = this.chooseWeighted(
        this.shotWeights(p, d, context.aerialHeight || 0, penalty),
      ),
      header = shotType === 'Header';
    const skill = shootingAbility(p, d, { header, penalty }) / 100,
      foot = header
        ? { quality: 1, foot: null }
        : footExecution(p, Math.atan2(34 - p.y, goalX - p.x));
    const curve = shotType === 'Curler' ? (p.y < 34 ? 1 : -1) * this.direction(p.team) * 3.6 : 0;
    const aimY = 34 + (this.rand() > 0.5 ? 1 : -1) * (penalty ? 2.35 : 1.25 + this.rand() * 1.2);
    const balance =
      1 +
      (100 - p.skill('composure')) * 0.004 +
      Math.max(0, Math.hypot(p.vx, p.vy) - 5) * 0.045 +
      (1 - p.energy) * 0.6;
    const spread = penalty
      ? (0.3 + (1 - skill) * 1.8 + (100 - p.skill('composure')) * 0.008) /
        this.tuning.gameplay.penaltyPrecision
      : ((this.profile.spread *
          this.tuning.gameplay.shotScatter *
          (0.7 + (1 - skill) * 7.5) *
          (box ? 0.65 + d / 30 : 1.45 + d / 23) *
          (1 + pressure * 0.5) *
          balance) /
          foot.quality) *
        (header ? 1.18 : 1) *
        (p.has('finisher') && box ? 0.93 : 1) *
        (1 + (1 - spatial.openness) * 0.4) *
        clamp(1 / Math.sqrt(spatial.quality), 0.9, 1.2);
    const ty = aimY + this.noise() * spread,
      angle = Math.atan2(ty - p.y, goalX - p.x);
    const speed =
      (14 + p.skill('power') * 0.22 + this.rand() * 1.5) *
      (header ? 0.65 : shotType === 'Placed finish' ? 0.82 : 1) *
      (header ? 1 : Math.sqrt(foot.quality)) *
      this.tuning.gameplay.shotPower;
    const flight = d / speed,
      startZ = header
        ? context.aerialHeight
        : shotType === 'Volley'
          ? Math.max(0.5, context.aerialHeight)
          : 0.2;
    const height = penalty
      ? 0.5 + this.rand() * 0.9 + this.noise() * 0.25
      : 0.7 + this.rand() * 0.9 + this.noise() * spread * 0.42;
    b.x = p.x;
    b.y = p.y;
    b.offsideState = offsideSnapshot(this, p);
    b.owner = null;
    b.x += Math.cos(angle) * 0.6;
    b.y += Math.sin(angle) * 0.6;
    b.z = startZ;
    b.vx = Math.cos(angle) * speed;
    b.vy = Math.sin(angle) * speed - curve * flight * 0.5;
    b.vz = (height - startZ + 4.905 * flight * flight) / flight;
    b.kind = 'shot';
    b.deliveryOrigin = null;
    b.kicker = p.id;
    b.target = null;
    b.age = 0;
    b.lastTouch = p.team;
    b.shotTeam = p.team;
    b.offside = false;
    b.saver = null;
    b.curve = curve;
    b.shotType = shotType;
    b.strength = clamp((speed - 15) / 22, 0.12, 1);
    b.shotOrigin = this.origin(p);
    b.assist =
      !penalty && this.lastPass?.to === p.id && this.elapsed - this.lastPass.at < 8
        ? this.lastPass.from
        : null;
    b.goalCredit = { shooter: p.id, assist: b.assist, origin: { ...b.shotOrigin }, shotType };
    if (b.assist !== null) this.players[b.assist].stats.keyPasses++;
    b.penaltyTaker = penalty ? p.id : null;
    b.restartTaker = penalty || context.restart ? p.id : null;
    b.penaltyKick = penalty;
    b.indirect = null;
    this.lastShotSpeed = speed * 3.6;
    p.lastShotSpeed = speed * 3.6;
    p.lastShotType = shotType;
    p.animation = {
      type: 'shot',
      start: this.elapsed,
      duration: 0.4,
      angle,
      power: p.skill('power'),
    };
    const stat = this.stats[p.team];
    stat.shots++;
    p.stats.shots++;
    if (box) stat.boxShots++;
    if (penalty) p.stats.penalties++;
    const chance = targetChance(
      aimY,
      spread,
      penalty ? 0.99 : clamp(1 - spread * 0.055, 0.55, 0.98),
    );
    stat.xg += penalty
      ? 0.74
      : clamp((spatial.rate * (0.55 + skill)) / (1 + pressure * 0.45), 0.005, 0.7);
    p.cooldown = 0.65;
    p.action = shotType;
    p.think = 0.5;
    p.lastShotChance = chance;
    const e = this.addEvent(
      `${p.name.split(' ').pop()} · ${shotType.toLowerCase()}`,
      p.team,
      'shot',
      {
        playerId: p.id,
        chance,
        chanceLabel: 'on target',
        strength: b.strength,
        shotType,
        box,
        zone: spatial.zone,
        origin: { ...b.shotOrigin },
        outcome: 'in flight',
        foot: foot.foot,
        penalty,
      },
    );
    b.shotRecord = { team: p.team, player: p.id, eventId: e.id, status: null, penalty };
    this.flair(
      'shot',
      p,
      1.05,
      {
        tx: goalX,
        ty,
        power: p.skill('power'),
        speed: speed * 3.6,
        strength: b.strength,
        label: shotType,
        shotType,
      },
      true,
    );
    if (penalty) {
      const g = this.keeper(1 - p.team);
      g.penaltyDive = {
        until: this.elapsed + 0.8,
        y: 34 + (this.rand() < 0.5 ? -1 : 1) * (2 + this.rand() * 1.2),
      };
    }
  }
  resolveShot(outcome) {
    const record = this.ball.shotRecord;
    if (!record || record.status === outcome) return;
    const key = o =>
      o === 'goal' || o === 'saved'
        ? 'onTarget'
        : o === 'blocked'
          ? 'blocked'
          : o === 'post'
            ? 'woodwork'
            : 'offTarget';
    const previous = record.status,
      stat = this.stats[record.team],
      p = this.players[record.player];
    if (previous) {
      if (outcome !== 'goal') return;
      stat[key(previous)]--;
      p.stats[key(previous)]--;
    }
    stat[key(outcome)]++;
    p.stats[key(outcome)]++;
    record.status = outcome;
    if (record.penalty && outcome === 'goal') {
      stat.penaltyGoals++;
      p.stats.penaltyGoals++;
    }
    const event = this.events.find(e => e.id === record.eventId);
    if (event) {
      event.outcome = outcome;
      event.resolvedAt = this.elapsed;
    }
  }
  projectedOnTarget() {
    const b = this.ball,
      team =
        b.shotTeam ??
        b.shotRecord?.team ??
        this.players[b.goalCredit?.shooter ?? b.kicker]?.team ??
        b.lastTouch;
    if (team === undefined || team === null) return false;
    const directTime = (this.abs(105, team) - b.x) / (b.vx || 0.001);
    if (directTime <= 0 || directTime > 3) return false;
    let x = b.x,
      y = b.y,
      z = b.z,
      vx = b.vx,
      vy = b.vy,
      vz = b.vz,
      age = b.age;
    const goal = this.abs(105, team),
      dir = this.direction(team);
    if (vx * dir <= 0) return false;
    for (let i = 0; i < 300; i++) {
      const dt = 0.01;
      if (b.shotType === 'Curler') vy += (b.curve || 0) * dt;
      if (b.shotType === 'Knuckleball') vy += Math.sin(age * 23) * 7 * dt;
      const old = { x, y, z };
      x += vx * dt;
      y += vy * dt;
      z = Math.max(0, z + vz * dt);
      vz -= 9.81 * dt;
      age += dt;
      if (z === 0) {
        vz = Math.abs(vz) > 0.9 ? -vz * 0.3 : 0;
        const speed = Math.hypot(vx, vy),
          drag = Math.max(0, 1 - (2 * dt) / (speed || 1));
        vx *= drag;
        vy *= drag;
      }
      if ((x - goal) * dir >= 0) {
        const f = (goal - old.x) / (x - old.x || 1);
        return Math.abs(lerp(old.y, y, f) - 34) < GOAL / 2 && lerp(old.z, z, f) < 2.44;
      }
    }
    return false;
  }
}
