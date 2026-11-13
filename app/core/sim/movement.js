// Movement and contact: player motion, stamina, challenges, duels.
// Methods are installed on Match.prototype by match.js.
import { clamp } from '../util/math.js';
import { offenceInBox } from './rules.js';
import { sigmoid, dist, hypot } from './constants.js';

const URGENT = new Set([
  'press',
  'cover',
  'recover',
  'receive',
  'intercept',
  'sweep',
  'dribble',
  'track',
  'reset',
]);

// Braking into a turn for a rebound, against plain acceleration.
const SCRAMBLE_BRAKE = 1.6;

export class MovementMethods {
  // A keeper's penalty dive (shooting.js startPenaltyDive): a committed lunge along a fixed
  // path, far quicker than a player accelerates on his feet. He stays where he lands until
  // the dive is over. Returns false once it is.
  stepDive(p, dt) {
    const d = p.penaltyDive;
    if (this.elapsed >= d.until) {
      p.penaltyDive = null;
      return false;
    }
    const k = clamp((this.elapsed - d.at) / 0.34, 0, 1),
      ease = k * (2 - k),
      x = d.x0 + (d.x - d.x0) * ease,
      y = d.y0 + (d.y - d.y0) * ease;
    p.vx = k < 1 ? (x - p.x) / dt : 0;
    p.vy = k < 1 ? (y - p.y) / dt : 0;
    p.x = x;
    p.y = y;
    p.tx = d.x;
    p.ty = d.y;
    return true;
  }
  move(p, dt, restart = false) {
    if (p.sentOff) return;
    if (p.penaltyDive != null && this.stepDive(p, dt)) return;
    let dx = p.tx - p.x,
      dy = p.ty - p.y;
    // Separation from nearby players. Runs 22 x 22 times per step: reject on x
    // before touching y (most pairs are far apart along the pitch).
    const players = this.activePlayers,
      px = p.x,
      py = p.y;
    for (let i = 0; i < players.length; i++) {
      const q = players[i],
        ox = px - q.x;
      if (ox > 1.55 || ox < -1.55 || q === p) continue;
      const oy = py - q.y;
      if (oy > 1.55 || oy < -1.55) continue;
      const d2 = ox * ox + oy * oy;
      if (d2 > 0.0001 && d2 < 2.4025) {
        const d = Math.sqrt(d2),
          force = (1.55 - d) * (q.team === p.team ? 2 : 0.55);
        dx += (ox / d) * force;
        dy += (oy / d) * force;
      }
    }
    const d = hypot(dx, dy),
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
      URGENT.has(p.intent) ||
      (p.intent === 'mark' && (d > 3 || hypot(p.vx, p.vy) > p.topSpeed() * 0.55)) ||
      (p.intent === 'run' && d > 5) ||
      (carrying && d > 4 && p.tendency('advance') > 0.48);
    if (p.sprint < 0.08) p.sprintRest = Math.max(p.sprintRest, 1.8);
    p.sprintRest = Math.max(0, p.sprintRest - dt);
    const trackingRun = jockey > 0 && hypot(carrier.vx, carrier.vy) > p.topSpeed() * 0.65;
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
      !restart && (p.intent === 'mark' || p.intent === 'track') && p.markId != null
        ? this.players[p.markId]
        : null;
    // A moving mark is not a stationary arrival point. Match their velocity
    // before braking, otherwise the defender trails just behind the runner.
    const targetSpeed = Math.min(max, d * 2.1),
      followX =
        (mark?.vx || 0) + (motion?.vx || 0) * jockey + (d > 0.02 ? (dx / d) * targetSpeed : 0),
      followY =
        (mark?.vy || 0) + (motion?.vy || 0) * jockey + (d > 0.02 ? (dy / d) * targetSpeed : 0);
    const followScale = Math.min(1, max / (hypot(followX, followY) || 1)),
      vx = followX * followScale,
      vy = followY * followScale;
    // A scramble for a rebound (either side): he plants a foot and turns harder than he
    // can accelerate — running the wrong way when the ball came back out cost a full second.
    const scramble =
      p.intent === 'recover' &&
      this.ball.reboundTeam != null &&
      vx * p.vx + vy * p.vy < 0 &&
      this.reboundSide() >= 0
        ? SCRAMBLE_BRAKE
        : 1;
    const accel = p.acceleration() * (0.72 + p.energy * 0.28) * dt * scramble,
      dv = hypot(vx - p.vx, vy - p.vy),
      weight = Math.min(1, accel / (dv || 1));
    p.vx += (vx - p.vx) * weight;
    p.vy += (vy - p.vy) * weight;
    const speed = hypot(p.vx, p.vy);
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
      (this.half === 2 ? 1.1 : this.half > 2 ? 1.2 : 1) *
      this.tacticalLoad(p);
    p.energy = clamp(p.energy - drain * lowReserve * this.tuning.stamina.drain, 0.001, 1);
    p.cooldown = Math.max(0, p.cooldown - dt);
    p.stun = Math.max(0, p.stun - dt);
    p.feintCooldown = Math.max(0, p.feintCooldown - dt);
    if (p.animation && this.elapsed - p.animation.start > p.animation.duration) p.animation = null;
  }
  // E5: tactics cost energy. Out of possession the press level (and the press
  // style) sets the effort, in possession the tempo; pushing for a goal costs a
  // little more, holding saves a little. Balanced settings cost exactly 1.
  tacticalLoad(p) {
    const t = this.teams[p.team].tactics,
      attacking = this.lastTeam === p.team && this.ball.owner !== null;
    return (
      (attacking
        ? 1 + (t.tempo - 3) * 0.07
        : 1 + (t.press - 3) * 0.11 + (t.style === 'press' ? 0.08 : 0)) *
      (1 + this.mentalityShift(p.team).load)
    );
  }
  challengeModel(p, q) {
    const bearing =
      ((q.x - p.x) * Math.cos(p.facing) + (q.y - p.y) * Math.sin(p.facing)) / (dist(p, q) || 1);
    const closing = hypot(q.vx - p.vx, q.vy - p.vy),
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
      // A tackle at the defender's own byline often squirts behind.
      const byline = this.rel(q.x, q.team) < 7 && Math.abs(q.y - 34) > 7;
      if (byline && this.rand() < 0.4) {
        b.vx = -this.direction(q.team) * (2.5 + this.rand() * 2);
        b.vy = (this.rand() - 0.5) * 3;
        b.lastTouch = q.team;
      } else {
        const escape = this.carryTarget(q),
          angle = Math.atan2(escape.y - q.y, escape.x - q.x);
        b.vx = Math.cos(angle) * (1.3 + this.rand() * 1.5);
        b.vy = Math.sin(angle) * (1.3 + this.rand() * 1.5);
      }
      b.vz = model.hard ? 1.1 : 0.3;
      q.action = 'Collecting the tackle';
      q.cooldown = 0.1;
      this.planTimer = 0;
      return true;
    }
    return false;
  }
  // Aerial duel for a high ball that reached p first. Heading, strength and
  // aerial tendency decide it; defenders in front of their own goal read the
  // flight better. Returns true when the duel ended p's touch (a foul, or the
  // rival won the header), false when p wins and plays on.
  contestAerial(p) {
    let rival = null,
      nearest = 2.1;
    for (const q of this.activePlayers) {
      if (q.team === p.team || q.role === 'GK' || q.cooldown > 0 || q.stun > 0) continue;
      const d = dist(q, p);
      if (d < nearest) {
        nearest = d;
        rival = q;
      }
    }
    if (!rival) return false;
    const model = this.challengeModel(p, rival);
    rival.cooldown = 0.7;
    if (this.rand() < model.foul * (0.7 + rival.tendency('aggression'))) {
      this.awardFoul(rival, p);
      return true;
    }
    const power = q =>
      q.skill('heading') * 0.6 +
      q.skill('strength') * 0.3 +
      q.tendency('aerial') * 12 +
      (q.has('aerial') ? 5 : 0);
    const home = q => this.inBox(q, 1 - q.team);
    // First contact helps a little; defenders facing the ball in front of
    // their own goal (or rising with the keeper behind them) help a lot.
    const wins = sigmoid(
      (power(p) - power(rival)) / 9 + 0.15 + (home(p) ? 0.7 : 0) - (home(rival) ? 0.7 : 0),
    );
    if (this.rand() < wins) return false;
    const height = this.ball.z;
    this.flair('header', rival, 0.6, { label: 'WON IN THE AIR', strength: 0.45 });
    if (home(rival)) this.headClear(rival);
    else if (this.inBox(rival) && this.own(rival)) this.shoot(rival, { aerialHeight: height });
    else if (this.own(rival)) rival.hold = 0;
    return true;
  }
  // A defender heads a high ball away from goal; a glancing one goes behind.
  headClear(d) {
    const b = this.ball,
      out = this.direction(d.team),
      side = b.y >= 34 ? 1 : -1;
    b.kind = 'loose';
    b.owner = null;
    b.target = null;
    b.lastTouch = d.team;
    b.kicker = d.id;
    b.deflectedBy = d.id;
    b.deflectedAt = this.elapsed;
    b.age = 0;
    b.indirect = null;
    b.penaltyTaker = null;
    b.restartTaker = null;
    b.offsideState = null;
    // A header under challenge from an attacker is glanced behind more often.
    let contest = 0;
    const k = this.tuning.gameplay.deliveryDeflections;
    if (k)
      for (const q of this.activePlayers)
        if (q.team !== d.team && q.role !== 'GK' && dist(q, d) < 2) contest = 0.14 * k;
    const glancing =
      Math.abs(b.y - 34) > 5 &&
      this.rand() < 0.24 + clamp((72 - d.skill('heading')) / 100, 0, 0.15) + contest;
    if (glancing) {
      b.vx = -out * (5 + this.rand() * 4);
      b.vy = side * (3 + this.rand() * 4);
      b.vz = 2 + this.rand();
    } else {
      b.vx = out * (9 + this.rand() * 6 + d.skill('heading') * 0.03);
      b.vy = side * (2 + this.rand() * 4);
      b.vz = 3 + this.rand() * 3;
    }
    b.z = Math.max(b.z, 1.6);
    d.cooldown = 0.5;
    d.action = 'Heading clear';
    this.planTimer = 0;
  }
  // A defender in his own box meets a fast low delivery with an attacker on
  // him: he stabs a leg at it instead of controlling it. Faster balls, closer
  // attackers and poorer technique make the deflection likelier.
  deflectChance(d, speed) {
    const k = this.tuning.gameplay.deliveryDeflections;
    if (!k || speed < 9) return 0;
    let near = 9;
    for (const q of this.activePlayers)
      if (q.team !== d.team && q.role !== 'GK') near = Math.min(near, dist(q, d));
    if (near > 3) return 0;
    const calm = d.skill('control') * 0.5 + d.skill('composure') * 0.5;
    return (
      clamp(
        (0.12 + (speed - 9) * 0.022 + (3 - near) * 0.07) * (1 + (75 - calm) * 0.02),
        0.02,
        0.6,
      ) * k
    );
  }
  // A cross struck into a defender standing near the crosser: it deflects,
  // often behind for a corner. `deflection`: a stab at a delivery in the box.
  blockCross(d, deflection = false) {
    const b = this.ball,
      out = this.direction(d.team);
    if (deflection) {
      const side = Math.abs(d.y - 34) > 0.5 ? Math.sign(d.y - 34) : b.vy >= 0 ? 1 : -1,
        central = Math.abs(d.y - 34) < 6;
      if (this.rand() < 0.7) {
        b.vx = -out * (central ? 2.5 + this.rand() * 3 : 4 + this.rand() * 5);
        b.vy = side * (central ? 5 + this.rand() * 3 : 1.5 + this.rand() * 3) + b.vy * 0.15;
      } else {
        b.vx = out * (2 + this.rand() * 5);
        b.vy = this.noise() * 4;
      }
    }
    b.kind = 'loose';
    b.owner = null;
    b.target = null;
    b.lastTouch = d.team;
    b.kicker = d.id;
    b.deflectedBy = d.id;
    b.deflectedAt = this.elapsed;
    b.age = 0;
    b.offsideState = null;
    b.restartTaker = null;
    if (deflection) b.vz = 0.6 + this.rand() * 2.2;
    else {
      if (this.rand() < 0.65) {
        b.vx = -out * (6 + this.rand() * 6);
        b.vy = b.vy * 0.3 + this.noise() * 2;
      } else {
        b.vx *= -0.25;
        b.vy = this.noise() * 4;
      }
      b.vz = 1.5 + this.rand() * 1.5;
    }
    d.cooldown = 0.3;
    d.stats.blocks++;
    const who = d.name.split(' ').pop();
    this.addEvent(
      deflection ? `${who} deflects it.` : `${who} blocks the cross.`,
      d.team,
      'block',
      {
        playerId: d.id,
        strength: 0.35,
        cross: true,
        shotEventId: null,
        shooterId: null,
        xg: null,
        bigChance: false,
      },
    );
    this.planTimer = 0;
  }
}
