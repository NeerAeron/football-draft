// Carrier decisions: decide (cross / shoot / carry / pass / feint), carry targets, take-ons, pressure.
// Methods are installed on Match.prototype by match.js.
import { clamp, lerp } from '../util/math.js';
import { shootingAbility } from '../players/ratings.js';
import { segment, sigmoid, dist, hypot } from './constants.js';

const CARRY_OFFSETS = [-2.8, -2.2, -1.55, -1.0, -0.55, 0, 0.55, 1.0, 1.55, 2.2, 2.8];

export class DecisionMethods {
  decide(p) {
    if (this.ball.owner !== p.id) return;
    const rx = this.rel(p.x, p.team),
      dGoal = hypot(105 - rx, p.y - 34),
      pressure = this.pressure(p),
      opts = this.options(p),
      tac = this.settings(p.team);
    let best = opts[0];
    p.think =
      ((0.19 + (100 - p.vision()) * 0.003 + this.rand() * 0.08) *
        (1.18 - tac.tempo * 0.06) *
        (1 + (1 - p.energy) * 0.4) *
        this.profile.decisionTime) /
      p.familiarity() ** 2;
    if (p.role === 'GK') {
      p.action = 'Checking the receiver’s next touch';
      if (p.hold < (this.ball.kind === 'held' ? this.profile.release : 0.55)) return;
      if (p.goalKickExempt) {
        const kick = this.goalKickOption(p, opts);
        if (kick) {
          this.pass(p, kick);
          return;
        }
      }
      const outlet = this.keeperOutlet(p, opts);
      if (outlet) {
        this.pass(p, outlet);
        return;
      }
      if (
        p.hold > (p.has('distributor') ? 3.2 : 2.5) ||
        (this.ball.kind !== 'held' && pressure > 0.8)
      )
        this.clearKeeper(p, opts);
      return;
    }
    // Building up from the keeper: the man he gave it to in their own half has time. For
    // two seconds he plays only a ball that is really on (no first-time pass into the
    // midfield's press); with none and nobody on him he carries it and looks again.
    if (
      p.lastReceipt &&
      rx < 45 &&
      this.elapsed - p.receivedAt < 2 &&
      this.players[p.lastReceipt.from]?.role === 'GK'
    ) {
      let safe = null;
      for (const o of opts)
        if (o.risk < 0.3 && o.margin > 0.3 && o.chance > 0.72 && o.r.role !== 'GK') {
          safe = o;
          break;
        }
      if (safe) best = safe;
      else if (pressure < 0.5) {
        p.action = 'Looking up';
        return;
      }
    }
    const quickTouch = !!p.lastReceipt && this.elapsed - p.receivedAt < 0.8,
      releaseAfter = quickTouch ? (p.has('onetouch') ? 0.07 : 0.1) : 0.16;
    if (p.hold < (quickTouch ? (p.has('onetouch') ? 0.07 : 0.1) : 0.15)) return;
    const spatial = this.location(p),
      box = spatial.inside,
      wide = Math.abs(p.y - 34) > 14;
    const judgment =
      clamp((p.vision() * 0.6 + p.skill('composure') * 0.4 - 72) / 22, 0, 1) *
      clamp(this.tuning.gameplay.creativeQuality, 0, 1);
    // Crossing willingness: discerning passers want a likelier delivery that is not much
    // worse than the best option; crossWillingness relaxes both.
    const willing = this.tuning.gameplay.crossWillingness,
      minChance = (0.3 + judgment * 0.35) / willing,
      window = (2.4 - judgment * 1.8) * willing;
    const delivery = opts.find(
      o =>
        ['cross', 'cutback'].includes(o.delivery) &&
        o.risk < 1.1 &&
        o.margin > -0.45 &&
        (!judgment || (o.chance > minChance && o.score > best.score - window)),
    );
    // Final-third flow: a carrier at the byline delivers (cross / cutback) or
    // recycles within about a second; no corner-flag stalls.
    const byline = rx > 88 && Math.abs(p.y - 34) > 9;
    if (byline) p.bylineAt ??= this.elapsed;
    if (byline && (this.elapsed - p.bylineAt > 0.55 || p.hold > 1.4)) {
      const dir = this.direction(p.team);
      let forced = null,
        recycle = null;
      for (const o of opts) {
        if ((o.delivery === 'cross' || o.delivery === 'cutback') && o.margin > -0.9 && o.risk < 1.6)
          forced ??= o;
        else if ((o.aim.x - p.x) * dir < -3 && o.chance > 0.55) recycle ??= o;
      }
      if (forced || recycle || best) {
        this.pass(p, forced || recycle || best);
        return;
      }
    }
    if (
      wide &&
      rx > 73 &&
      delivery &&
      p.hold > 0.28 &&
      (p.has('crosser') ||
        p.has('byline') ||
        rx > 84 ||
        tac.style === 'wings' ||
        delivery.score > 3 ||
        this.boxRunners(p.team) >= 2)
    ) {
      this.pass(p, delivery);
      return;
    }
    if (dGoal < 34 && Math.abs(p.y - 34) < 22) {
      let blocks = 99;
      for (const targetY of [31.5, 34, 36.5]) {
        let count = 0;
        for (const q of this.activePlayers)
          if (q.team !== p.team && q.role !== 'GK') {
            const a = segment(q, p, { x: this.abs(105, p.team), y: targetY });
            if (a.t > 0.04 && a.t < 1 && a.d < 1.2) count++;
          }
        blocks = Math.min(blocks, count);
      }
      const better = opts.find(
        o =>
          this.inBox({ x: o.aim.x, y: o.aim.y, team: p.team }) &&
          o.margin > -0.1 &&
          o.risk < 0.65 &&
          Math.abs(o.aim.y - 34) < Math.abs(p.y - 34) - 3,
      );
      if (better && pressure > 0.3) {
        this.pass(p, better);
        return;
      }
      // Outside the box with a team-mate free inside it: play him in rather than shoot
      // from range (the pass is the better chance).
      const feed =
        !box &&
        opts.find(
          o =>
            o.delivery !== 'cross' &&
            this.inBox({ x: o.aim.x, y: o.aim.y, team: p.team }) &&
            o.margin > 0.05 &&
            o.risk < 0.5 &&
            o.chance > 0.62,
        );
      if (feed && p.hold > releaseAfter) {
        this.pass(p, feed);
        return;
      }
      const nextTouch = {
          x: p.x + this.direction(p.team) * Math.min(4, dGoal - 8),
          y: lerp(p.y, 34, 0.25),
        },
        arrival = p.arrival(nextTouch);
      const canImprove =
        box &&
        dGoal > 11 &&
        Math.abs(p.y - 34) < 14 &&
        p.hold < this.profile.finishPatience &&
        !better &&
        this.activePlayers.every(q => q.team === p.team || q.arrival(nextTouch) > arrival + 0.22);
      if (canImprove) {
        p.action = 'Taking a touch toward goal';
        p.finishTarget = nextTouch;
        p.finishUntil = this.elapsed + 0.38;
        return;
      }
      const specialist = p.has('longshot') || p.has('knuckle') || p.has('curve');
      let urge = box
        ? clamp(
            (0.28 +
              (22 - dGoal) * 0.032 +
              (shootingAbility(p, dGoal) - 65) * 0.004 -
              blocks * 0.13 -
              pressure * 0.04) *
              spatial.quality,
            0.035,
            0.9,
          )
        : // From outside the box: likelier the closer and more central the shot,
          // for specialists, and with fewer bodies in the way (blocked shots
          // are part of the game; a crowd in front is not a hard veto).
          0.3 *
          (specialist ? 1.6 : 1) *
          (spatial.central ? 1 : 0.5) *
          // Having a go from range is part of the fun: specialists from anywhere in
          // sight of goal, everyone else from inside about 30 m.
          (specialist ? clamp((34 - dGoal) / 12, 0.1, 1) : clamp((31 - dGoal) / 11, 0, 1)) *
          0.55 ** blocks;
      if (spatial.zone === 'deep_central') urge *= this.profile.deepUrge;
      // No shooting from a hopeless angle: the urge fades from 50° off the centre line and is
      // gone by about 78° (the byline) — he cuts it back or crosses instead.
      urge *= clamp(((105 - rx) / (dGoal || 1) - 0.2) / 0.45, 0, 1);
      if (!box && (blocks > 2 || pressure > 1.1 || p.hold < 0.2)) urge = 0;
      // He has just beaten his man: the space he made is for shooting.
      const beat = p.beatChain.length ? p.beatChain[p.beatChain.length - 1] : null;
      if (beat && this.elapsed - beat.at < 1.3 && dGoal < 27) urge *= 2;
      if (
        this.rand() <
        urge *
          (0.7 + p.tendency('shoot') * 0.6) *
          (1 + tac.shift.shotUrge) *
          (box ? this.profile.shotUrge : this.profile.rangeUrge) *
          this.tuning.gameplay.shotFrequency
      ) {
        this.shoot(p);
        return;
      }
    }
    const runway = this.openCarry(p);
    if (runway) {
      const release = opts.find(
        o =>
          o.delivery === 'through' &&
          o.score > 2.5 &&
          o.chance > 0.75 &&
          o.margin > 0.35 &&
          o.risk < 0.45 &&
          this.rel(o.aim.x, p.team) > this.rel(runway.x, p.team) + 7 &&
          Math.abs(o.aim.y - 34) < Math.abs(runway.y - 34) + 5,
      );
      if (release) {
        this.pass(p, release);
        return;
      }
      p.finishTarget = runway;
      p.finishUntil = this.elapsed + p.think;
      p.aim(runway.x, runway.y, 'carry', 'Driving into space');
      return;
    }
    // A composed carrier facing a press releases to a genuinely available
    // outlet instead of waiting for another dribble/decision cycle.
    const retention = clamp(
      (p.skill('shortPassing') + p.skill('control') + p.skill('composure') + p.vision() - 280) / 90,
      0,
      1,
    );
    const safe = opts.find(o => o.chance > 0.76 && o.risk < 0.32 && o.margin > 0.2);
    if (
      pressure > 0.28 &&
      safe &&
      safe.score > best.score - retention * (tac.style === 'possession' ? 1.5 : 0.85) &&
      p.hold > 0.15
    ) {
      this.pass(p, safe);
      return;
    }
    const urgency =
      0.52 +
      (tac.style === 'possession' ? 0.28 * this.tuning.gameplay.teamCharacter : 0) +
      pressure * 0.85 +
      Math.max(0, p.hold - 1.2) * 0.38 +
      (tac.tempo - 3) * 0.1 +
      this.profile.passUrge +
      (1 - p.tendency('carry')) * 0.25 +
      (quickTouch ? 0.04 : 0);
    const clearance = this.outfieldClearance(p, opts);
    if (clearance) {
      this.pass(p, clearance);
      return;
    }
    if (
      best &&
      p.hold > releaseAfter &&
      best.score > 2.0 - urgency &&
      (this.rand() < clamp(0.2 + urgency * 0.3, 0.2, 0.9) || p.hold > 3.5)
    ) {
      this.pass(p, best);
      return;
    }
    if (rx > 98 && best) {
      this.pass(p, best);
      return;
    }
    if (p.feintCooldown <= 0 && p.hold > 0.35) {
      const q = this.activePlayers
        .filter(q => q.team !== p.team && q.role !== 'GK' && dist(q, p) < 3.1 && dist(q, p) > 1.2)
        .sort((a, b) => dist(a, p) - dist(b, p))[0];
      if (
        q &&
        this.rand() <
          (0.17 + p.tendency('carry') * 0.5) *
            (tac.style === 'possession' ? 1 - retention * 0.45 : 1)
      )
        this.feint(p, q);
    }
    if (p.animation?.type !== 'feint')
      p.action = pressure > 0.5 ? 'Protecting the ball' : 'Driving into space';
  }
  // Teammates (outfield) currently inside the opponent's box.
  boxRunners(team) {
    let n = 0;
    for (const q of this.activePlayers)
      if (q.team === team && q.role !== 'GK' && this.inBox(q)) n++;
    return n;
  }
  carryTarget(p) {
    const br = this.rel(p.x, p.team),
      dir = this.direction(p.team),
      pressure = this.pressure(p),
      goalAngle = Math.atan2(
        (p.has('byline') && br < 92 ? 0 : 34 - p.y) *
          (br > 65 ? 1 : 0.3 + 0.7 * p.tendency('inside')),
        dir * (105 - br),
      );
    let best = null;
    const advance = p.tendency('advance'),
      escapeBadge = p.has('pressescape');
    for (const offset of CARRY_OFFSETS) {
      const angle = goalAngle + offset,
        length = Math.abs(offset) > 1.5 ? 4.5 : 6;
      const c = {
        x: clamp(p.x + Math.cos(angle) * length, 1, 104),
        y: clamp(p.y + Math.sin(angle) * length, 2, 66),
      };
      // Clipping an outward dribble at the touchline can collapse a six-metre
      // route into a few centimetres. It is not a safe escape or a reason to stop.
      if (dist(p, c) < length * 0.65) continue;
      let clearance = 6,
        landing = 9;
      // Opponents a quarter-second ahead: distance to the route (past its first
      // 12%) and to its end. Inline segment maths, no allocation.
      const ex = c.x - p.x,
        ey = c.y - p.y,
        len2 = ex * ex + ey * ey || 1;
      for (const q of this.activePlayers)
        if (q.team !== p.team) {
          const ax = q.x + q.vx * 0.25,
            ay = q.y + q.vy * 0.25,
            t = clamp(((ax - p.x) * ex + (ay - p.y) * ey) / len2, 0, 1);
          if (t > 0.12)
            clearance = Math.min(clearance, hypot(ax - p.x - ex * t, ay - p.y - ey * t));
          landing = Math.min(landing, hypot(ax - c.x, ay - c.y));
        }
      const heading = Math.atan2(c.y - p.y, c.x - p.x),
        progress = (c.x - p.x) * dir,
        turn = Math.abs(Math.atan2(Math.sin(heading - p.facing), Math.cos(heading - p.facing)));
      const score =
        clearance * (0.85 + pressure * 0.75) +
        landing * 0.12 +
        progress * (0.45 + advance * 0.32) -
        turn * 0.12 -
        Math.abs(c.y - 34) * 0.013;
      const escape = escapeBadge && progress < 0 ? Math.min(pressure, 1.5) * 0.4 : 0;
      if (!best || score + escape > best.score) best = { ...c, score: score + escape };
    }
    return best;
  }
  openCarry(p) {
    const target = this.carryTarget(p),
      dir = this.direction(p.team);
    if ((target.x - p.x) * dir < 4 || this.rel(p.x, p.team) > 97) return null;
    // Check the route as well as its end, including whether a beaten defender
    // can actually catch the next touch. Empty-looking space alone is not safe.
    for (const fraction of [0.5, 1]) {
      const point = { x: lerp(p.x, target.x, fraction), y: lerp(p.y, target.y, fraction) };
      const time = (p.arrival(point) * p.topSpeed()) / p.topSpeed(true);
      if (this.activePlayers.some(q => q.team !== p.team && q.arrival(point) < time + 0.18))
        return null;
    }
    return target;
  }
  feint(p, q) {
    const escape = this.carryTarget(p),
      angle = Math.atan2(escape.y - p.y, escape.x - p.x),
      side = p.y < q.y ? -1 : 1;
    const support = this.activePlayers
      .filter(r => r.team !== p.team && r.id !== q.id && r.role !== 'GK')
      .reduce((sum, r) => sum + clamp(1 - r.arrival(escape) / 1.65, 0, 1), 0);
    const chain = p.beatChain.filter(b => this.elapsed - b.at < 7),
      balance = (p.skill('strength') - q.skill('strength')) * 0.004;
    const chance = clamp(
      sigmoid(
        (p.skill('dribbling') - q.tackling()) / 27 +
          0.1 +
          balance +
          (p.energy - q.energy) * 0.5 +
          (p.sprint - 0.5) * 0.25 -
          support * 0.95 -
          chain.length * 0.36,
      ) * this.tuning.gameplay.dribbleSuccess,
      0.035,
      0.9,
    );
    p.feintCooldown = p.has('dribbler') ? 1.5 : 2.1;
    p.animation = { type: 'feint', start: this.elapsed, duration: 0.55, side, angle };
    p.sprint = clamp(p.sprint - 0.07, 0, 1);
    p.feintTarget = escape;
    p.action = 'Feinting past the defender';
    p.intent = 'dribble';
    p.stats.dribbleAttempts++;
    this.stats[p.team].dribbleAttempts++;
    if (this.rand() < chance) {
      q.stun = 0.22 + p.skill('dribbling') * 0.002;
      q.cooldown = 0.48;
      q.animation = { type: 'beaten', start: this.elapsed, duration: 0.55, side };
      this.stats[p.team].takeons++;
      p.stats.takeons++;
      p.beatChain = chain.filter(b => b.id !== q.id);
      p.beatChain.push({ id: q.id, at: this.elapsed });
      const strength = clamp(0.2 + support * 0.15 + p.beatChain.length * 0.16, 0, 1);
      this.flair('feint', p, 0.7, {
        side,
        angle,
        strength,
        label: p.beatChain.length > 1 ? 'SLALOM' : 'BEATEN',
      });
      this.addEvent(
        `${p.name.split(' ').pop()} beats ${q.name.split(' ').pop()}.`,
        p.team,
        'dribble',
        { playerId: p.id, chance, chanceLabel: 'take-on', strength },
      );
    } else {
      p.stun = 0.12;
      p.cooldown = 0.18;
      p.animation = { type: 'stumble', start: this.elapsed, duration: 0.3 };
      p.feintTarget = { x: p.x - Math.cos(angle), y: p.y - Math.sin(angle) };
      if (this.rand() < 0.4 + support * 0.12) {
        this.ball.owner = null;
        this.ball.kind = 'loose';
        this.ball.kicker = p.id;
        this.ball.lastTouch = p.team;
        this.ball.age = 0;
        this.ball.vx = Math.cos(angle) * 3;
        this.ball.vy = Math.sin(angle) * 3;
        p.stats.turnovers++;
        this.planTimer = 0;
      }
    }
  }
  pressure(p) {
    const players = this.activePlayers,
      range = 4.5 * this.tuning.gameplay.pressDistance;
    let sum = 0;
    for (let i = 0; i < players.length; i++) {
      const q = players[i];
      if (q.team !== p.team && q.role !== 'GK') sum += Math.max(0, 1 - dist(p, q) / range);
    }
    return sum;
  }
  // Technique changes execution under pressure, not the physical space
  // perceived by tactics, shooting decisions, or supporting teammates.
  executionPressure(p) {
    const calm =
      clamp((p.skill('composure') * 0.55 + p.skill('control') * 0.45 - 75) / 20, 0, 1) *
      (0.65 + 0.35 * p.energy);
    const resistance = 1 + calm * 0.3 * this.tuning.gameplay.controlQuality;
    let n = 0;
    for (const q of this.activePlayers)
      if (q.team !== p.team && q.role !== 'GK') {
        const proximity = Math.max(0, 1 - dist(p, q) / (4.5 * this.tuning.gameplay.pressDistance));
        if (proximity)
          n +=
            proximity *
            (1 +
              clamp((q.pressAwareness() - 72) / 22, 0, 1) *
                0.2 *
                this.tuning.gameplay.defensiveQuality);
      }
    return n / resistance;
  }
}
