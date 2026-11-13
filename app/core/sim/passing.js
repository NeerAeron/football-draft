// Passing: option scoring, lane risk, flight, keeper distribution, clearances, pass execution.
// Methods are installed on Match.prototype by match.js.
import { clamp, lerp } from '../util/math.js';
import { footExecution } from './player-model.js';
import { offsideSnapshot } from './rules.js';
import { shootingAbility } from '../players/ratings.js';
import { segment, sigmoid, skillError, dist, hypot, PASS_ROLL, PASS_ARRIVAL } from './constants.js';

// players/ratings.js passingAbility, without allocating per call (hot path).
function passingAbility(p, distance, delivery = 'pass') {
  if (delivery === 'cross') return p.skill('crossing') * 0.8 + p.skill('longPassing') * 0.2;
  if (delivery === 'cutback') return p.skill('shortPassing') * 0.7 + p.skill('crossing') * 0.3;
  const long = clamp((distance - 16) / 20, 0, 1);
  return p.skill('shortPassing') * (1 - long) + p.skill('longPassing') * long;
}

const LANE_SAMPLES = [0.18, 0.36, 0.54, 0.72, 0.9],
  LANE_X = new Float64Array(5),
  LANE_Y = new Float64Array(5),
  LANE_T = new Float64Array(5),
  LANE_Z = new Float64Array(5),
  LANE_POINT = { x: 0, y: 0 };

export class PassingMethods {
  receiverMargin(p, r, aim, loft = false) {
    const flight = this.flightTime(dist(p, aim), loft),
      receive = Math.max(flight, r.arrival(aim));
    let opponent = 99;
    for (const q of this.activePlayers)
      if (q.team !== p.team) opponent = Math.min(opponent, q.arrival(aim));
    // Time to take a touch and choose a second action, after both players travel.
    return opponent - receive;
  }
  passSpeed(length, loft = false) {
    return (
      (loft
        ? clamp(18 + length * 0.12, 19, 29)
        : clamp(Math.sqrt(PASS_ARRIVAL ** 2 + 2 * PASS_ROLL * length), 15, 30)) *
      this.tuning.gameplay.passSpeed
    );
  }
  deliveryDemand({ d = 0, aim, r, loft = false, delivery = 'pass' }) {
    const lead = aim && r ? dist(aim, r) : 0;
    return clamp(
      clamp((d - 22) / 32, 0, 1) * 0.55 +
        clamp((lead - 2) / 7, 0, 1) * 0.3 +
        (delivery === 'through'
          ? 0.3
          : delivery === 'cross'
            ? 0.32
            : delivery === 'clearance'
              ? 0.22
              : 0) +
        (loft ? 0.2 : 0),
      0,
      1,
    );
  }
  flightTime(length, loft = false, fraction = 1) {
    const speed = this.passSpeed(length, loft),
      remaining = speed * speed - 2 * PASS_ROLL * length * fraction;
    return loft
      ? (length * fraction) / speed
      : remaining < 0
        ? Infinity
        : (speed - Math.sqrt(remaining)) / PASS_ROLL;
  }
  laneRisk(p, r, end, loft = null, delivery = 'pass') {
    const length = dist(p, end);
    if (loft === null) {
      loft =
        Math.abs(p.y - 34) > 14 &&
        this.rel(p.x, p.team) > 70 &&
        this.rel(p.x, p.team) < 95 &&
        this.inBox({ x: end.x, y: end.y, team: p.team });
      if (loft) delivery = 'cross';
    }
    const total = loft ? this.flightTime(length, true) : 0,
      start = this.ball.owner === p.id && this.ball.kind === 'held' ? 1.65 : 0.12,
      landing = delivery === 'cross' ? 1.65 : 0.45;
    const craft = passingAbility(p, length, delivery) * 0.65 + p.vision() * 0.35;
    // The five sample points along the lane, their flight times and ball heights
    // do not depend on the defender: compute them once per lane.
    for (let i = 0; i < 5; i++) {
      const f = LANE_SAMPLES[i],
        flight = this.flightTime(length, loft, f);
      LANE_X[i] = lerp(p.x, end.x, f);
      LANE_Y[i] = lerp(p.y, end.y, f);
      LANE_T[i] = flight;
      // Use the launch arc, so midfield traffic can be cleared but defenders
      // near takeoff and landing still have a realistic interception chance.
      LANE_Z[i] = !loft
        ? 0
        : delivery === 'cross'
          ? 9.81 * total * 0.46 * flight - 4.905 * flight * flight
          : lerp(start, landing, f) + 4.905 * total * total * f * (1 - f);
    }
    const point = LANE_POINT,
      laneX = end.x - p.x,
      laneY = end.y - p.y,
      launch = loft ? 1 : this.passSpeed(length, false);
    let risk = 0;
    for (const q of this.activePlayers) {
      if (q.team === p.team) continue;
      const reaction = 0.1 + (100 - q.pressAwareness()) * 0.002,
        reach = delivery === 'cross' ? 2 : 1.6 + q.skill('heading') * 0.007,
        speed = q.arrivalSpeed(),
        acceleration = q.acceleration();
      let threat = 0;
      // A defender already standing in the lane of a ground pass does not have to get
      // anywhere: the ball is played into him. (The arrival times below include turning and
      // accelerating, which understates a body that is simply in the way.)
      // He is judged where his run takes him by the time the ball gets there, so a presser
      // charging across the lane counts too.
      if (!loft && length > 1) {
        const now = ((q.x - p.x) * laneX + (q.y - p.y) * laneY) / (length * length);
        if (now > 0 && now < 1) {
          const when = (now * length) / launch,
            qx = q.x + q.vx * when - p.x,
            qy = q.y + q.vy * when - p.y,
            along = (qx * laneX + qy * laneY) / (length * length);
          if (along > 0.05 && along < 0.92) {
            const off = Math.abs(qx * laneY - qy * laneX) / length;
            if (off < 1.6) threat = 2 * clamp((1.6 - off) / 0.8, 0, 1);
          }
        }
      }
      for (let i = 0; i < 5; i++) {
        if (loft && LANE_Z[i] > reach) continue;
        point.x = LANE_X[i];
        point.y = LANE_Y[i];
        const arrival = q.arrivalAt(point, speed, acceleration) + reaction;
        threat = Math.max(threat, sigmoid((LANE_T[i] - arrival + 0.04) * 5));
      }
      const disguise =
        1 -
        clamp((craft - q.pressAwareness()) / 30, 0, 1) * 0.12 * this.tuning.gameplay.passingQuality;
      risk += threat * (0.55 + q.skill('defending') * 0.004) * disguise;
    }
    return risk;
  }
  targetForPass(p, r, loft = false) {
    const d = dist(p, r),
      forward = this.rel(r.x, p.team) > this.rel(p.x, p.team) + 6;
    const lead = clamp(this.flightTime(d, loft), 0.2, loft ? 2.2 : 1.8);
    let x = r.x + r.vx * lead * 0.72,
      y = r.y + r.vy * lead * 0.72;
    if (forward && this.formation(r)[0] > 60 && this.rel(p.x, p.team) > (loft ? 24 : 54)) {
      const run =
        clamp(
          r.topSpeed() * lead * 0.4 * (loft ? 0.65 + r.tendency('timing') * 0.55 : 1),
          1,
          loft ? 8 : 6,
        ) * (p.has('through') ? 1.18 : 1);
      x += this.direction(p.team) * run;
      y += clamp(34 - y, -2, 2);
    }
    return { x: clamp(x, 1, 103), y: clamp(y, 1, 67) };
  }
  options(p) {
    const list = [],
      dir = this.direction(p.team),
      tac = this.settings(p.team),
      held = p.role === 'GK',
      pressure = this.pressure(p),
      identity = this.tuning.gameplay.teamCharacter;
    const patient =
      tac.style === 'possession'
        ? clamp((p.skill('shortPassing') + p.skill('composure') + p.vision() - 210) / 60, 0, 1)
        : 0;
    const line = this.activePlayers
      .filter(q => q.team !== p.team)
      .map(q => this.rel(q.x, p.team))
      .sort((a, b) => b - a)[1];
    const counter = tac.style === 'counter' && this.elapsed - this.possessionStart < 7;
    const fromX = this.rel(p.x, p.team);
    for (const r of this.activePlayers) {
      if (r.team !== p.team || r.id === p.id) continue;
      const distance = dist(p, r);
      if (
        distance < 3 ||
        distance > (held ? (p.has('distributor') ? 88 : 72) : 58) + (p.vision() - 50) * 0.16
      )
        continue;
      // Compare a grounded delivery with a lofted one; badges improve the
      // preference and execution, but every player can attempt either.
      for (const aerial of distance >= 24 ? [false, true] : [false]) {
        const aim = this.targetForPass(p, r, aerial),
          d = dist(p, aim),
          progress = (aim.x - p.x) * dir;
        let space = 14;
        for (const q of this.activePlayers)
          if (q.team !== p.team) space = Math.min(space, dist(q, aim));
        const box = this.inBox({ x: aim.x, y: aim.y, team: p.team }),
          wide = Math.abs(p.y - 34) > 14 && this.rel(p.x, p.team) > 70;
        // From the byline zone a flat or backward ball into the box is a cutback.
        const delivery =
          wide && box
            ? this.rel(p.x, p.team) > 95 || (this.rel(p.x, p.team) > 86 && progress < 1)
              ? 'cutback'
              : 'cross'
            : progress > 9 && this.formation(r)[0] > 60 && this.rel(aim.x, p.team) > line - 3
              ? 'through'
              : 'pass';
        if (aerial && ['cross', 'cutback'].includes(delivery)) continue;
        // Keep the established conservative crossing assessment; the new flight
        // comparison applies to long distribution, switches and through balls.
        const loft = aerial || delivery === 'cross',
          risk = this.laneRisk(p, r, aim, loft, delivery),
          margin = this.receiverMargin(p, r, aim, aerial);
        if (!Number.isFinite(this.flightTime(d, loft))) continue;
        const goalAccess = box
          ? (0.6 + this.location({ x: aim.x, y: aim.y, team: p.team }).quality * 0.95) *
            (0.65 + shootingAbility(r, hypot(105 - this.rel(aim.x, p.team), 34 - aim.y)) * 0.007)
          : clamp((this.rel(aim.x, p.team) - 60) / 30, 0, 1) * 0.7;
        const foot = footExecution(p, Math.atan2(aim.y - p.y, aim.x - p.x));
        const ability = passingAbility(p, d, delivery),
          reading = clamp(
            (p.vision() * 0.5 + p.skill('composure') * 0.3 + ability * 0.2 - 65) / 25,
            0,
            1,
          );
        let control =
          (0.7 + r.skill('control') * 0.0026 - Math.max(0, d - 22) * 0.002) *
          (aerial ? 0.8 + r.skill('control') * 0.001 : 1);
        const demand = this.deliveryDemand({ r, aim, d, loft, delivery }),
          arrivalPressure = clamp(1 - space / (4.5 * this.tuning.gameplay.pressDistance), 0, 1);
        const reception = this.firstTouchChance(
          r,
          loft ? (delivery === 'cross' ? 1.65 : 0.45) : 0,
          this.passSpeed(d, loft),
          arrivalPressure,
          true,
          0,
          demand,
        );
        control = loft
          ? Math.min(control, reception)
          : lerp(control, reception, reading * clamp(this.tuning.gameplay.passingQuality, 0, 1));
        const execution = skillError(
          ability * 0.75 + p.skill('composure') * 0.15 + p.vision() * 0.1,
          this.tuning.gameplay.passingQuality,
        );
        // Better delivery reduces the passer's error; it cannot erase an
        // intercepted lane, a late receiver, or the receiver's poor control.
        const technical = clamp(
          1 - (1 - clamp(0.83 + ability * 0.0017, 0, 0.995)) * execution,
          0.1,
          0.999,
        );
        const completion = clamp(
          control *
            Math.exp(-risk * 0.4) *
            sigmoid(2.8 + margin * 1.4) *
            technical *
            foot.quality *
            this.tuning.gameplay.passCompletion,
          0.06,
          0.98,
        );
        const creative =
          clamp((p.vision() * 0.5 + ability * 0.35 + p.skill('composure') * 0.15 - 75) / 20, 0, 1) *
          this.tuning.gameplay.creativeQuality;
        const ambition =
          0.08 +
          p.tendency('advance') * 0.1 +
          (tac.tempo - 3) * 0.009 +
          (counter ? 0.09 * identity : 0) -
          (tac.style === 'possession' ? 0.013 * identity : 0) +
          tac.shift.ambition;
        const judgment =
          1 +
          clamp((p.vision() + p.skill('composure') - 140) * 0.006, 0, 0.35) +
          (tac.style === 'possession' ? 0.25 * identity : 0);
        const turnoverCost =
          (held ? 7 : 4.8 + Math.max(0, 55 - fromX) * 0.035) *
          (1.25 - p.tendency('risk') * 0.55) *
          judgment *
          (1 + tac.shift.turnoverCost);
        let score =
          completion *
            (2 +
              clamp(progress, -20, 30 - patient * 12) *
                ambition *
                (1 - patient * 0.18) *
                this.profile.directness +
              goalAccess *
                (p.has('creator') ? 1.35 : 1) *
                // E7: teammates look for an elite finisher in a scoring position.
                (1 + clamp((r.skill('shooting') - 82) / 8, 0, 1) * 0.45)) -
          (1 - completion) * turnoverCost +
          Math.min(space, 6) * 0.07 +
          clamp(margin, -2, 1) * 0.35;
        score -= patient * risk * (1 + Math.max(0, d - 22) / 18) * identity;
        if (progress < -4) score -= 0.22;
        if (r.role === 'GK') score -= 1.5;
        if (!held && margin < -0.35) score -= 1.6 + Math.abs(margin) * 1.4;
        if (delivery === 'cross' && risk > 0.45) score -= risk * 0.8;
        if (aerial) score -= 0.25 + (100 - p.skill('longPassing')) * 0.009 + pressure * 0.15;
        if (delivery !== 'pass')
          score +=
            delivery === 'through'
              ? p.has('through')
                ? 0.45
                : 0.1
              : p.has('crosser') || p.has('byline')
                ? 0.95
                : 0.35 + (tac.style === 'wings' ? 0.6 * identity : 0);
        if (tac.style === 'possession' && d < 22) score += (0.28 + patient * 0.65) * identity;
        // Skill supports ambition when there is a real progressive option;
        // it does not make a crowded or late pass automatically worthwhile.
        if (progress > 4 && margin > -0.35)
          score += creative * completion * (clamp(progress / 24, 0, 1) * 0.55 + goalAccess * 0.3);
        if (p.has('longball') && Math.abs(aim.y - p.y) > 25 && margin > 0.25 && risk < 0.6)
          score += 0.3;
        if (d >= 28 && (progress > 8 || Math.abs(aim.y - p.y) > 24)) {
          const switchSpace =
            (aim.y - 34) * (p.y - 34) < 0
              ? clamp((Math.abs(aim.y - p.y) - 20) / 22, 0, 1) * clamp((space - 2) / 8, 0, 1)
              : 0;
          const craft = clamp((p.skill('longPassing') - 55) / 40, 0, 1),
            intent =
              0.4 +
              p.tendency('risk') * 0.35 +
              (tac.tempo - 3) * 0.08 +
              (counter ? 0.5 * identity : 0) -
              (tac.style === 'possession' ? 0.25 * identity : 0);
          score +=
            this.tuning.gameplay.longBallPreference *
            0.7 *
            completion *
            (intent +
              craft * 0.4 +
              (p.has('longball') ? 0.3 : 0) +
              switchSpace *
                (0.35 + (tac.width - 1) * 0.1 + (tac.style === 'wings' ? 0.4 * identity : 0)));
        }
        const perceivedOffside =
          this.rel(r.x, p.team) - Math.max(52.5, this.rel(p.x, p.team), line);
        // Players assess a moving line imperfectly. The referee later uses the exact snapshot.
        if (perceivedOffside > 0.1 + (100 - p.vision()) * 0.024) score -= 3 + perceivedOffside;
        // Players do not all read the same perfect map. Rushed, tired or
        // pressured decisions expose weak scanning; excellent readers retain
        // a precise assessment. This changes the choice, never the ball result.
        const scanDemand =
          0.55 +
          clamp(pressure, 0, 1) * 0.7 +
          (this.elapsed - p.receivedAt < 0.65 ? 0.35 : 0) +
          (1 - p.energy) * 0.2;
        const uncertainty =
          (1 - reading) ** 2 * this.tuning.gameplay.passingQuality * scanDemand * 0.25;
        score +=
          this.noise() *
          (((100 - p.vision()) / 240) *
            (1 - reading * 0.5 * clamp(this.tuning.gameplay.passingQuality, 0, 1)) +
            uncertainty);
        list.push({ r, aim, score, risk, d, margin, delivery, loft, chance: completion });
      }
    }
    return list.sort((a, b) => b.score - a.score);
  }
  // The ball out of a build-up shape (restarts.js buildUpSpot): a goal kick, a deep free kick,
  // the keeper's kick or throw from his hands. Short (never when the routine is 'long'): only
  // a ball that is really on — along the ground to a team-mate with nobody within 13 m of
  // where he takes it, no opponent near the lane and a second to spare. Otherwise long: to
  // the best header of the ball up the pitch (onside, unless it is a goal kick), away from
  // the touchlines, where the midfield is waiting for the second ball. Losing that one costs
  // a header on halfway, not a chance. `shortOnly`: null when no short ball is on.
  buildUpOption(p, opts, routine, shortOnly = false, goalKick = false) {
    if (routine !== 'long') {
      let best = null,
        value = -Infinity;
      for (const o of opts) {
        if (o.loft || o.r.role === 'GK' || o.d < 8 || o.d > 31) continue;
        if (o.risk > 0.25 || o.margin < 0.8 || !this.keeperReleaseClear(p, o.aim)) continue;
        if (o.aim.y < 6 || o.aim.y > 62) continue;
        let space = 99;
        for (const q of this.activePlayers)
          if (q.team !== p.team) space = Math.min(space, dist(q, o.aim));
        if (space < 13) continue;
        const v = o.score + o.margin * 0.8 + Math.min(space, 25) * 0.12;
        if (v > value) {
          value = v;
          best = o;
        }
      }
      if (best) return best;
    }
    if (shortOnly) return null;
    const dir = this.direction(p.team),
      reach = 56 + p.skill('power') * 0.15,
      from = this.rel(p.x, p.team),
      beyond = Math.max(52, from + 30);
    // The offside line: the second-last opponent, the ball or halfway.
    let line = Math.max(52.5, from),
      deepest = -Infinity,
      second = -Infinity;
    for (const q of this.activePlayers) {
      if (q.team === p.team) continue;
      const x = this.rel(q.x, p.team);
      if (x > deepest) {
        second = deepest;
        deepest = x;
      } else if (x > second) second = x;
    }
    line = goalKick ? Infinity : Math.max(line, second) - 0.5;
    let target = null,
      value = -Infinity;
    for (const r of this.activePlayers) {
      if (r.team !== p.team || r.role === 'GK' || r === p) continue;
      const depth = this.rel(r.x, p.team);
      if (depth > line) continue;
      let v =
        r.skill('heading') * 0.6 +
        r.skill('strength') * 0.25 +
        r.tendency('aerial') * 10 +
        (r.has('aerial') ? 5 : 0) -
        Math.max(0, beyond - depth) * 2 -
        Math.max(0, dist(p, r) - reach) * 1.5 -
        Math.max(0, Math.abs(r.y - 34) - 16) * 1.2;
      // Team-mates near him for the knock-down; opponents beside him make it a duel.
      for (const q of this.activePlayers) {
        if (q === r || q.role === 'GK') continue;
        const d = dist(q, r);
        if (q.team === p.team) v += d < 16 ? 1.5 : 0;
        else if (d < 4) v -= 3;
      }
      if (v > value) {
        value = v;
        target = r;
      }
    }
    if (!target) return null;
    // Dropped just short of him, so he comes onto it facing the play, and never by the line.
    const aim = { x: target.x - dir * 1.5, y: clamp(target.y, 13, 55) },
      length = dist(p, aim);
    if (length > reach) {
      aim.x = p.x + ((aim.x - p.x) * reach) / length;
      aim.y = p.y + ((aim.y - p.y) * reach) / length;
    }
    return {
      r: target,
      aim,
      d: dist(p, aim),
      delivery: 'pass',
      loft: true,
      risk: 0.3,
      chance: 0.5,
    };
  }
  keeperReleaseClear(p, aim) {
    const length = dist(p, aim) || 1,
      end = {
        x: p.x + ((aim.x - p.x) / length) * Math.min(6, length),
        y: p.y + ((aim.y - p.y) / length) * Math.min(6, length),
      };
    return this.activePlayers.every(
      q => q.team === p.team || dist(q, p) > 7 || segment(q, p, end).d > 1.7,
    );
  }
  keeperOutlet(p, opts) {
    // A clear lane is insufficient: the receiver must survive the next touch.
    const safe = opts.filter(
      o =>
        o.d > 10 &&
        this.keeperReleaseClear(p, o.aim) &&
        o.risk < 0.28 &&
        o.margin > 0.4 &&
        this.rel(o.aim.x, p.team) > 13 &&
        this.activePlayers.some(
          r =>
            r.team === p.team &&
            r.id !== p.id &&
            r.id !== o.r.id &&
            dist(r, o.aim) < 23 &&
            this.pressure(r) < 0.4,
        ),
    );
    safe.sort((a, b) => b.margin * 0.8 + b.score - (a.margin * 0.8 + a.score));
    if (safe.length) return safe[0];
    return null;
  }
  clearKeeper(p, opts) {
    const outlets = opts
      .filter(o => o.d > 28 && Math.abs(o.aim.y - 34) > 10)
      .sort((a, b) => b.margin + b.d * 0.025 - (a.margin + a.d * 0.025));
    const o = outlets[0] || opts.filter(o => o.d > 25).sort((a, b) => b.d - a.d)[0];
    if (o) this.pass(p, { ...o, delivery: 'clearance', loft: true });
    else {
      const r = this.activePlayers
        .filter(q => q.team === p.team && q.role !== 'GK')
        .sort((a, b) => this.rel(b.x, p.team) - this.rel(a.x, p.team))[0];
      this.pass(p, {
        r,
        aim: { x: this.abs(63, p.team), y: p.y < 34 ? 8 : 60 },
        d: 58,
        delivery: 'clearance',
        loft: true,
        risk: 0,
      });
    }
  }
  outfieldClearance(p, opts) {
    const depth = this.rel(p.x, p.team),
      pressure = this.pressure(p),
      tac = this.settings(p.team);
    if (depth > 38 || pressure < 0.45) return null;
    // Pinned near his own byline with an attacker on him and no clean exit, a
    // defender puts the ball out behind: concede the corner, not the chance.
    if (
      depth < 12 &&
      Math.abs(p.y - 34) > 6 &&
      pressure > 0.6 &&
      !opts.some(o => o.chance > 0.7 && o.margin > 0.3 && o.risk < 0.4)
    ) {
      const aim = { x: this.abs(-3, p.team), y: p.y + (p.y < 34 ? -2 : 2) };
      return {
        r: opts[0]?.r ?? this.activePlayers.find(q => q.team === p.team && q.id !== p.id),
        aim,
        d: dist(p, aim),
        delivery: 'clearance',
        loft: false,
        risk: 0,
        conceding: true,
      };
    }
    const craft =
      0.4 * p.skill('shortPassing') +
      0.2 * p.skill('control') +
      0.2 * p.skill('dribbling') +
      0.2 * p.vision();
    const simpleExit =
      p.role === 'CB' ? 0.22 * clamp((74 - craft) / 25, 0, 1) * clamp(pressure, 0.45, 1.5) : 0;
    const danger =
      (pressure * (1.2 + (38 - depth) / 45) +
        (70 - p.skill('composure')) * 0.006 +
        (p.tendency('hold') - 0.5) * 0.25 -
        (p.tendency('carry') - 0.5) * 0.25 +
        (tac.style === 'bus' ? 0.2 : tac.style === 'possession' ? -0.2 : 0) *
          this.tuning.gameplay.teamCharacter +
        simpleExit) *
      this.tuning.gameplay.clearanceWillingness;
    // A modest preference for safety must not override an available short exit.
    if (
      danger < 1.7 ||
      (danger < 3.1 &&
        opts.some(
          o =>
            o.chance > 0.72 &&
            o.margin > 0 &&
            o.risk < 0.65 &&
            o.d < 28 &&
            this.rel(o.aim.x, p.team) > 9,
        ))
    )
      return null;
    const outlets = opts.filter(
      o => o.loft && o.d >= 28 && (o.aim.x - p.x) * this.direction(p.team) > 18,
    );
    const value = o =>
      clamp(o.margin, -2, 2) * 0.5 +
      Math.abs(o.aim.y - 34) * 0.025 +
      o.r.skill('heading') * 0.006 +
      o.r.skill('strength') * 0.003 -
      o.risk * 0.35;
    const outlet = outlets.sort((a, b) => value(b) - value(a))[0];
    if (outlet) return { ...outlet, delivery: 'clearance', loft: true };
    // When nobody is free, clear into a wide area and contest the second ball.
    const aim = {
      x: this.abs(clamp(depth + 34 + p.skill('power') * 0.14, 44, 82), p.team),
      y: p.y < 34 ? 9 : 59,
    };
    const r = this.activePlayers
      .filter(q => q.team === p.team && q.id !== p.id && q.role !== 'GK')
      .sort((a, b) => a.arrival(aim) - b.arrival(aim))[0];
    return { r, aim, d: dist(p, aim), delivery: 'clearance', loft: true };
  }
  pass(p, option, restart = null) {
    if (!option || p.sentOff || option.r?.sentOff) return;
    p.beatChain = [];
    const b = this.ball,
      held = b.kind === 'held',
      { r, aim, d } = option,
      delivery = option.delivery || 'pass',
      pressure = this.executionPressure(p),
      tempo = this.teams[p.team].tactics.tempo;
    const foot = footExecution(p, Math.atan2(aim.y - p.y, aim.x - p.x));
    const ability = passingAbility(p, d, delivery);
    const loft = option.loft || delivery === 'cross',
      demand = this.deliveryDemand({ ...option, delivery, loft }),
      difficulty = clamp(pressure * 0.9 + demand, 0, 1);
    const context = lerp(
      this.tuning.gameplay.routinePassError,
      this.tuning.gameplay.difficultPassError,
      difficulty,
    );
    const execution = skillError(
      ability * 0.75 + p.skill('composure') * 0.15 + p.vision() * 0.1,
      this.tuning.gameplay.passingQuality,
    );
    const rawError =
      (((0.16 + (100 - ability) * 0.03 + 0.035 * clamp((ability - 78) / 20, 0, 1)) *
        (1 + pressure * 0.45 + Math.max(0, tempo - 3) * 0.07 + (1 - p.energy) * 0.3) *
        Math.max(0.6, d / 24)) /
        foot.quality) *
      this.profile.deliveryError *
      this.tuning.gameplay.passError *
      context *
      execution;
    const error = Math.min(rawError, 0.8 + d * 0.08 + pressure * 0.3);
    const tx = clamp(aim.x + this.noise() * error, 0.1, 104.9),
      ty = aim.y + this.noise() * error,
      length = hypot(tx - p.x, ty - p.y),
      angle = Math.atan2(ty - p.y, tx - p.x);
    const speed = this.passSpeed(length, loft);
    const restartType = p.goalKickExempt
      ? 'Goal kick'
      : typeof restart === 'string'
        ? restart
        : null;
    b.x = p.x;
    b.y = p.y;
    b.offsideState = offsideSnapshot(this, p, restartType);
    b.restartTaker = restartType ? p.id : null;
    p.goalKickExempt = false;
    b.owner = null;
    b.x += Math.cos(angle) * 0.6;
    b.y += Math.sin(angle) * 0.6;
    b.z = held && loft ? 1.65 : 0.12;
    b.vx = Math.cos(angle) * speed;
    b.vy = Math.sin(angle) * speed;
    b.vz = loft
      ? ((delivery === 'cross' ? 1.65 : 0.45) - b.z + 4.905 * (length / speed) ** 2) /
        (length / speed)
      : 0;
    b.kind = 'pass';
    b.delivery = delivery;
    b.strength = clamp(d / 70 + (option.risk || 0) * 0.12, 0.1, 1);
    b.chance = option.chance ?? clamp(0.9 - error * 0.04 - (option.risk || 0) * 0.15, 0.1, 0.98);
    b.pendingPass = null;
    b.destination = { x: tx, y: ty };
    b.deliveryDemand = demand;
    b.missedReceiver = false;
    b.saver = null;
    b.deliveryOrigin = this.origin(p);
    b.passCraft = passingAbility(p, d, delivery) * 0.65 + p.vision() * 0.35;
    b.roll = PASS_ROLL;
    b.kicker = p.id;
    b.target = r.id;
    b.age = 0;
    b.lastTouch = p.team;
    b.curve = 0;
    b.offside = b.offsideState?.candidates.includes(r.id) || false;
    this.stats[p.team].passes++;
    p.stats.passes++;
    const progress = (aim.x - p.x) * this.direction(p.team);
    const category = progress > 3 ? 'forwardPasses' : progress < -3 ? 'backwardPasses' : null;
    if (category) {
      this.stats[p.team][category]++;
      p.stats[category]++;
    }
    if (delivery === 'cross' || delivery === 'cutback') this.stats[p.team].crosses++;
    if (delivery === 'through') this.stats[p.team].throughBalls++;
    if (p.role === 'GK') {
      this.stats[p.team].keeperDistributions++;
      this.keeperRelease = { team: p.team, at: this.elapsed };
    }
    p.cooldown = 0.35;
    p.think = 0.4;
    p.animation = { type: 'pass', start: this.elapsed, duration: 0.2, angle };
    p.action =
      delivery === 'clearance'
        ? 'Clearing beyond the press'
        : delivery === 'cross'
          ? 'Crossing'
          : delivery === 'cutback'
            ? 'Cutting it back'
            : delivery === 'through'
              ? loft
                ? 'Lifting a ball behind the defense'
                : 'Releasing the runner'
              : loft && d >= 28
                ? Math.abs(aim.y - p.y) > 24
                  ? 'Switching play'
                  : 'Playing long'
                : 'Passing';
    r.aim(tx, ty, 'receive', 'Moving to receive');
    // A cross struck while a defender is closing the crosser down can be blocked.
    if ((delivery === 'cross' || delivery === 'cutback') && !restart) {
      for (const q of this.activePlayers) {
        if (q.team === p.team || q.role === 'GK' || q.stun > 0) continue;
        const ahead = (q.x - p.x) * Math.cos(angle) + (q.y - p.y) * Math.sin(angle),
          side = Math.abs(-(q.x - p.x) * Math.sin(angle) + (q.y - p.y) * Math.cos(angle));
        if (ahead > 0.3 && ahead < 2.2 && side < 1.1) {
          const block = clamp(
            0.25 +
              (q.skill('defending') - p.skill('crossing')) * 0.006 +
              (q.has('ballwinner') ? 0.05 : 0),
            0.08,
            0.5,
          );
          if (this.rand() < block) {
            b.x = q.x;
            b.y = q.y;
            this.blockCross(q);
          }
          break;
        }
      }
    }
    r.rethinkAt = 0;
    this.planTimer = 0;
    p.runs =
      this.elapsed +
      1.6 +
      (this.teams[p.team].tactics.fluidity - 1) * 0.35 +
      (p.has('givego') ? 0.75 : 0);
    b.shotTeam = null;
    b.shotOrigin = null;
    b.shotType = null;
    b.shotRecord = null;
    b.assist = null;
    b.goalCredit = null;
    b.indirect = ['Offside', 'Indirect free kick'].includes(restart) ? p.id : null;
    b.penaltyTaker = null;
  }
}
