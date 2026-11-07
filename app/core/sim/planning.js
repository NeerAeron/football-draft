// Planning: every player picks a target (keeper, carrier, press, marking, support runs).
// Methods are installed on Match.prototype by match.js.
import { clamp, lerp } from '../util/math.js';
import { H, GOAL, segment, dist, hypot } from './constants.js';

export class PlanningMethods {
  plan() {
    this._costCache = (this._costBuffer ??= new Float64Array(484)).fill(NaN);
    this._planPass = (this._planPass ?? 0) + 1;
    try {
      this.planInner();
    } finally {
      this._costCache = null;
    }
  }
  planInner() {
    const b = this.ball,
      owner = b.owner !== null ? this.players[b.owner] : null,
      attack = this.mode === 'restart' ? this.restart.team : owner ? owner.team : b.lastTouch;
    for (let t = 0; t < 2; t++) this.planTeam(t, owner, attack === t);
    this.phase = owner
      ? b.kind === 'held'
        ? 'Keeper possession'
        : this.rel(owner.x, owner.team) > 72
          ? 'Final third'
          : this.rel(owner.x, owner.team) < 37
            ? 'Build-up'
            : 'In transition'
      : b.kind === 'shot'
        ? 'Shot on goal'
        : b.kind === 'pass'
          ? 'Moving the ball'
          : 'Ball in dispute';
  }
  planTeam(t, owner, has) {
    const b = this.ball,
      dir = this.direction(t),
      tac = this.settings(t),
      team = this.activePlayers.filter(p => p.team === t),
      enemies = this.activePlayers.filter(p => p.team !== t),
      br = this.rel(b.x, t);
    // The strongest readers organize nearby teammates' marking. This is
    // derived from the active players, with no club-tier or score modifier.
    const organizers = team
      .filter(p => p.role !== 'GK')
      .map(p => ({
        ability: p.awareness() * 0.7 + p.skill('composure') * 0.3,
        readiness: 0.75 + 0.25 * p.energy,
      }))
      .sort((a, b) => b.ability - a.ability)
      .slice(0, 5);
    const coordination =
      Math.pow(
        clamp(
          (organizers.reduce((sum, p) => sum + p.ability, 0) / (organizers.length || 1) - 74) / 16,
          0,
          1,
        ),
        1.5,
      ) *
      (organizers.reduce((sum, p) => sum + p.readiness, 0) / (organizers.length || 1)) *
      this.tuning.gameplay.defensiveQuality;
    const threat =
      owner ||
      (!has && b.kind === 'pass' && !b.missedReceiver && b.target !== null
        ? this.players[b.target]
        : null);
    const defence = threat && !has && b.kind !== 'held' ? this.assignDefense(t, threat) : null;
    const anticipation = defence ? this.readPassingLane(t, threat) : null;
    if (anticipation) {
      defence.press = anticipation.p.id;
      defence.point = anticipation.point;
      defence.lane = true;
      if (defence.cover === defence.press) defence.cover = null;
      this.presser[t] = defence.press;
    }
    const marks = !has ? this.assignMarks(t, threat, defence, coordination) : new Map();
    const freeBall = this.mode !== 'restart' && !owner && (b.kind === 'loose' || b.missedReceiver);
    const loose = team
      .filter(p => p.role !== 'GK')
      .map(p => ({
        p,
        time: Math.max(
          p.arrival(p.intercept(b, 0.8)),
          p.stun,
          (p.controlUntil || 0) - this.elapsed,
        ),
      }))
      .sort((a, b) => a.time - b.time);
    const oppLine = enemies.map(q => this.rel(q.x, t)).sort((a, b) => b - a)[1] || 96;
    // A high cross dropping into our box: the two quickest defenders attack it.
    let crossers = null;
    const drop = b.destination;
    if (
      !has &&
      b.kind === 'pass' &&
      !b.missedReceiver &&
      (b.delivery === 'cross' || b.vz > 2) &&
      drop &&
      this.inBox({ x: drop.x, y: drop.y, team: 1 - t })
    )
      crossers = team
        .filter(p => p.role !== 'GK' && p.stun <= 0)
        .map(p => ({ p, time: p.arrival(drop) }))
        .sort((a, b) => a.time - b.time)
        .slice(0, 2)
        .map(o => o.p.id);
    const c = {
      t,
      dir,
      tac,
      team,
      enemies,
      has,
      br,
      owner,
      coordination,
      threat,
      defence,
      marks,
      freeBall,
      loose,
      oppLine,
      crossers,
      drop,
    };
    for (const p of team) {
      const [base, by, role] = this.formation(p);
      p.role = role;
      const sideY = dir > 0 ? by : H - by;
      if (
        this.elapsed < p.rethinkAt &&
        p.id !== owner?.id &&
        p.id !== defence?.press &&
        p.id !== defence?.cover &&
        !(b.kind === 'pass' && b.target === p.id) &&
        !(freeBall && loose[0]?.p.id === p.id) &&
        !crossers?.includes(p.id)
      )
        continue;
      p.rethinkAt =
        this.elapsed +
        ((0.08 + (100 - (has ? p.vision() : p.awareness())) * 0.002 + (p.id % 3) * 0.017) /
          p.familiarity() ** 2) *
          (has ? 1 : 1 - clamp(p.defensiveReading() * 0.3, 0, 0.5));
      this.planPlayer(p, c, base, sideY, role);
    }
  }
  planPlayer(p, c, base, sideY, role) {
    const b = this.ball,
      { owner, freeBall, loose, defence, has } = c;
    // Receiving a backpass takes priority over a keeper's default goal
    // position, including when a nearby attacker makes sweeping unsafe.
    if (!owner && b.kind === 'pass' && b.target === p.id) {
      const aim = b.missedReceiver
        ? p.intercept(b, 0.8)
        : dist(p, b) < 7
          ? p.intercept(b, 0.18)
          : b.destination || p.intercept(b, 0.4);
      p.aim(aim.x, aim.y, 'receive', 'Moving to receive');
      return;
    }
    if (role === 'GK') {
      this.planKeeper(p, c);
      return;
    }
    if (c.crossers?.includes(p.id)) {
      const goal = this.abs(0, p.team),
        toward = Math.sign(goal - c.drop.x);
      p.aim(c.drop.x + toward * 0.5, c.drop.y, 'intercept', 'Attacking the cross');
      return;
    }
    if (owner?.id === p.id) {
      this.planCarrier(p, c);
      return;
    }
    if (freeBall && loose[0]?.p.id === p.id) {
      const aim = p.intercept(b, 0.9);
      p.aim(aim.x, aim.y, 'recover', 'Attacking the loose ball');
      return;
    }
    if (defence && p.id === defence.press && this.planPress(p, c, base)) return;
    if (defence && p.id === defence.cover) {
      p.aim(defence.coverPoint.x, defence.coverPoint.y, 'cover', 'Covering behind the press');
      return;
    }
    if (!has) this.planDefender(p, c, base, sideY);
    else this.planSupport(p, c, base, sideY, role);
  }
  // Keeper: hold, track shots, penalty dives, sweeping, or guard the goal.
  planKeeper(p, c) {
    const b = this.ball,
      { t, dir, br, owner, enemies } = c;
    let x, y;
    if (owner?.id === p.id) {
      p.aim(
        this.abs(6, t),
        clamp(p.y, 27, 41),
        'hold',
        b.kind === 'held' ? 'Ball secured in hands' : 'Preparing distribution',
      );
      return;
    }
    x = clamp(2.5 + br * 0.035, 2.5, 6);
    // Narrow the angle, but stay inside the frame: a keeper outside his near
    // post leaves the far post empty. Shade toward a cross's landing point.
    y = clamp(34 + ((b.y - 34) * x) / Math.max(br, 6), 34 - GOAL / 2 + 0.6, 34 + GOAL / 2 - 0.6);
    if (b.kind === 'pass' && b.z > 0.8 && b.destination && this.rel(b.destination.x, t) < 17)
      y = lerp(y, clamp(b.destination.y, 30.5, 37.5), 0.45);
    if (b.kind === 'shot' && b.shotTeam !== t && p.penaltyDive?.until > this.elapsed) {
      p.aim(this.abs(0.25, t), p.penaltyDive.y, 'save', 'Diving for the penalty');
      return;
    }
    if (
      !owner &&
      ((b.kind === 'shot' && b.shotTeam !== t) ||
        (this.rel(b.x, t) < 27 && b.vx * dir < 0 && this.projectedOnTarget()))
    ) {
      x = 2.8;
      const crossing = (this.abs(x, t) - b.x) / (b.vx || 0.001);
      if (
        crossing > 0 &&
        crossing < 2 &&
        b.age > (p.has('reflexes') ? 0.03 : 0.07) + (100 - p.skill('goalkeeping')) * 0.002
      ) {
        y = clamp(b.y + b.vy * crossing, 28.5, 39.5);
        p.aim(this.abs(x, t), y, 'save', 'Tracking the shot');
        return;
      }
    }
    // Come for a high cross dropping into the six-yard area and claim it.
    const drop = b.kind === 'pass' && !b.missedReceiver && b.vz < 2 ? b.destination : null;
    if (
      !owner &&
      drop &&
      b.z > 1 &&
      this.players[b.kicker]?.team !== t &&
      this.rel(drop.x, t) < 4.5 + p.skill('goalkeeping') * 0.015 &&
      Math.abs(drop.y - 34) < 9 &&
      p.arrival(drop) < dist(b, drop) / (hypot(b.vx, b.vy) || 1) - 0.05
    ) {
      p.aim(drop.x, drop.y, 'sweep', 'Coming for the cross');
      return;
    }
    if (
      !owner &&
      br < 15 &&
      Math.abs(b.y - 34) < 18 &&
      b.kind !== 'shot' &&
      dist(p, b) < 11 + 7 * p.tendency('sweep') &&
      p.arrival(p.intercept(b, 0.7)) < Math.min(...enemies.map(q => q.arrival(b)))
    ) {
      p.aim(b.x, b.y, 'sweep', 'Sweeping');
      return;
    }
    p.aim(this.abs(x, t), y, 'keeper', 'Guarding the goal');
  }
  // Ball carrier: follow a feint, a committed finishing touch, or the best carry.
  planCarrier(p, c) {
    const { dir } = c;
    if (p.animation?.type === 'feint') {
      p.aim(p.feintTarget.x, p.feintTarget.y, 'dribble', 'Feinting past the defender');
      return;
    }
    const best = p.finishUntil > this.elapsed ? p.finishTarget : this.carryTarget(p);
    p.aim(
      best.x,
      best.y,
      'carry',
      (best.x - p.x) * dir < -0.5 ? 'Carrying away from pressure' : 'Driving into space',
    );
  }
  // Designated presser: read the lane, track the receiver or close the runner.
  // Returns false when the presser holds shape instead (falls through).
  planPress(p, c, base) {
    const b = this.ball,
      { t, dir, tac, br, has, threat, defence, coordination } = c;
    if (defence.lane) {
      p.aim(defence.point.x, defence.point.y, 'intercept', 'Reading the passing lane');
      return true;
    }
    if (b.kind === 'pass' && !has) {
      const lane = segment(p, b, b.destination || threat),
        intercept = p.intercept(b, 0.7);
      if (lane.d < 4 && p.arrival(intercept) < 0.8) {
        p.aim(intercept.x, intercept.y, 'intercept', 'Closing the passing lane');
      } else {
        const point = this.receiverPressPoint(t, threat, p, coordination);
        p.aim(point.x, point.y, 'track', 'Reading the receiver');
      }
      return true;
    }
    // An approaching runner can enter the pressing zone before the ball
    // reaches it. Use the assigned interception point as well, so the
    // presser does not retreat while his covering teammate steps up.
    const approaching = (threat.vx || 0) * dir < -1;
    const pressDistance = approaching ? Math.min(dist(p, b), dist(p, defence.point)) : dist(p, b);
    const urgent =
      tac.style === 'bus'
        ? br < 35 && pressDistance < 8 + tac.pressing * 0.15
        : br < 43 ||
          pressDistance <
            10 +
              tac.pressing * 0.25 +
              (coordination * 5 * (tac.press - 1)) / 4 +
              (tac.style === 'press' ? 9 * this.tuning.gameplay.teamCharacter : 0);
    if (urgent) {
      p.aim(defence.point.x, defence.point.y, 'press', 'Closing the runner');
      return true;
    }
    if (tac.style !== 'bus' && base >= 30 && coordination > 0) {
      const approach = clamp((coordination * coordination * (tac.press - 1)) / 3, 0, 1);
      if (approach > 0) {
        p.aim(
          lerp(p.x, defence.point.x, approach),
          lerp(p.y, defence.point.y, approach),
          'shape',
          'Advancing the press',
        );
        return true;
      }
    }
    return false;
  }
  // Out of possession: hold the defensive line or mark an assigned runner.
  planDefender(p, c, base, sideY) {
    const b = this.ball,
      { t, tac, br, marks, coordination } = c;
    let x, y;
    const block =
      coordination *
      4 *
      clamp((br - 65) / 30, 0, 1) *
      clamp((tac.press - 1) / 3, 0, 1) *
      (tac.style === 'bus' ? 0 : 1);
    const line = clamp(22 + (br - 52) * 0.34 + (tac.line - 50) * 0.13 + block, 7, 48);
    x = base < 30 ? line : base < 58 ? line + 13 : line + 28;
    y = 34 + (sideY - 34) * 0.74 + (b.y - 34) * 0.13;
    const q = marks.get(p.id);
    if (q) {
      const qr = this.rel(q.x, t),
        danger = clamp((62 - qr) / 30, 0, 1),
        point = this.markingPoint(t, q, p, coordination);
      const outlet = (clamp(1 - dist(q, b) / 35, 0, 1) * (tac.press - 1)) / 4;
      const unit = coordination * (0.3 + 1.25 * outlet) * clamp(1 - dist(p, q) / 45, 0, 1);
      const weight = clamp(
        0.72 +
          (tac.fluidity - 3) * 0.06 +
          danger * 0.28 +
          (p.defensiveReading() * 0.14 + unit) * (1 - danger),
        0.5,
        1,
      );
      const cushion = this.canScreenOutlet(t, q, p, coordination) ? 0.25 : 1;
      const lapse = this.markLapse(p, q, qr, coordination);
      if (lapse) {
        // Ball-watching: the marker holds his line and loses the runner.
        const hold = weight * (1 - lapse);
        x = lerp(x, this.rel(point.x, t), hold);
        y = lerp(y, point.y, hold);
        p.aim(this.abs(x, t), y, 'shape', 'Ball-watching');
        return;
      }
      x = Math.min(lerp(x, this.rel(point.x, t), weight), qr - cushion);
      y = lerp(y, point.y, weight);
      const recovering = this.rel(p.x, t) > qr - 0.7 || (dist(p, point) > 4.5 && qr < 55);
      p.aim(
        this.abs(x, t),
        y,
        recovering ? 'track' : 'mark',
        recovering ? 'Recovering goal-side' : 'Watching the runner',
      );
    } else {
      const recovering = base < 30 && br < 65 && this.rel(p.x, t) > br - 3;
      p.aim(
        this.abs(x, t),
        y,
        recovering
          ? 'recover'
          : tac.fluidity < 3 && dist(p, { x: this.abs(x, t), y }) > 5
            ? 'reset'
            : 'shape',
        recovering || tac.fluidity < 3 ? 'Recovering defensive shape' : 'Keeping defensive shape',
      );
    }
  }
  // Concentration: a marker near his own goal sometimes watches the ball and
  // loses his runner. Deterministic (a slow per-player rhythm, no RNG); far
  // likelier for poor readers, tired legs and a badly organised back line.
  markLapse(p, q, qr, coordination) {
    const k = this.tuning.gameplay.markingLapses;
    if (!k || qr > 40) return 0;
    const b = this.ball;
    if (b.owner === q.id || dist(q, b) < 9) return 0;
    const focus = p.awareness() * 0.7 + p.skill('composure') * 0.3,
      share =
        clamp((90 - focus) / 45, 0, 0.6) * (1.4 - 0.4 * p.energy) * (1 - coordination * 0.5) * k;
    if (share <= 0) return 0;
    return Math.sin(this.elapsed * 0.9 + p.id * 2.39) > Math.cos(Math.PI * Math.min(share, 0.5))
      ? 0.7
      : 0;
  }
  // A run in behind: an attacker level with the second-last defender bursts
  // past the line while a teammate on the ball can still play it, and keeps
  // going for about a second. Starts onside; the passer still has to time it.
  // Deterministic: a per-player rhythm and the tendencies decide when.
  runBehind(p, c, base) {
    const k = this.tuning.gameplay.runsInBehind,
      { owner, oppLine, t } = c;
    if (!k || !owner || owner.id === p.id || owner.role === 'GK') return null;
    if (p.runBehind && p.runBehind.until > this.elapsed) return p.runBehind;
    if (base < 45 || (base <= 60 && p.tendency('advance') < 0.6)) return null;
    if (p.runBehind && this.elapsed < p.runBehind.until + 2.5) return null;
    const rx = this.rel(p.x, t),
      ownerRx = this.rel(owner.x, t),
      gap = dist(owner, p);
    if (rx > oppLine + 0.05 || rx < oppLine - 7 || oppLine > 90 || ownerRx > oppLine - 3)
      return null;
    if (gap < 8 || gap > 40) return null;
    c.ownerPressure ??= this.pressure(owner);
    if (c.ownerPressure > 1.1) return null;
    const timing = p.tendency('timing') * p.familiarity(),
      urge = clamp((0.24 + (p.tendency('advance') + timing) * 0.54) * k, 0, 1.8);
    if (Math.sin(this.elapsed * 0.7 + p.id * 2.3) < 1 - urge) return null;
    p.runBehind = {
      until: this.elapsed + 1.1 + timing * 0.5,
      x: Math.min(101, oppLine + 7 + timing * 4),
      y: clamp(lerp(p.y, 34, 0.35), 8, 60),
    };
    // The run is the cue: the carrier looks up now rather than after his next touch.
    if (owner.think > 0.06) owner.think = 0.06;
    return p.runBehind;
  }
  // In possession: support positions, runs, overlaps and box attacks.
  planSupport(p, c, base, sideY, role) {
    const b = this.ball,
      { t, tac, team, enemies, br, owner, oppLine } = c;
    let x, y;
    const attackBias = (tac.attacking - 50) * 0.1;
    if (base < 30) {
      x = clamp(br - 24 + (base - 22) * 0.7 + attackBias, 20, 70);
      if (role === 'CB') {
        const recovery = 0.55 * p.skill('pace') + 0.45 * p.skill('acceleration'),
          slow = clamp((75 - recovery) / 30, 0, 1),
          security = owner ? clamp(1 - this.pressure(owner) * 0.5, 0, 1) : 0.5,
          cover = this.activePlayers.filter(
            q => q.team === t && q.id !== p.id && q.role !== 'GK' && this.rel(q.x, t) < br - 10,
          ).length;
        x -=
          (2 + slow * 6 + (1 - security) * 3 + (cover < 2 ? 2 : 0)) *
          (1 - 0.35 * p.tendency('advance'));
      }
    } else if (base < 58) {
      const advanced =
        ['CM', 'AM', 'LM', 'RM'].includes(role) &&
        p.id !== owner?.id &&
        p.tendency('advance') + p.tendency('timing') * 0.4 > 0.72 &&
        Math.abs(p.y - b.y) < 22 &&
        this.activePlayers.filter(
          q => q.team === t && q.id !== p.id && q.role !== 'GK' && this.rel(q.x, t) < br,
        ).length >= 3;
      x = clamp(
        br + (advanced ? 8 : 1) + (base - 45) * 0.35 + attackBias + this.profile.runSupport * 0.55,
        25,
        94,
      );
    } else x = clamp(Math.max(br + 13 + attackBias, base + 5 + this.profile.runSupport), 45, 99);
    y =
      34 +
      (sideY - 34) *
        (0.58 +
          tac.widthValue * 0.007 +
          (tac.style === 'wings' ? 0.15 * this.tuning.gameplay.teamCharacter : 0)) +
      (b.y - 34) * 0.1;
    const anchor = { x, y };
    if (base > 60) anchor.x = Math.min(anchor.x, Math.max(br, oppLine - 0.5));
    let action =
        base < 30
          ? 'Supporting the build-up'
          : base < 58
            ? 'Creating a passing angle'
            : 'Stretching the defense',
      intent = 'support';
    if (base > 60 && br < 66) {
      x = Math.min(x, br + 17 + p.tendency('roam') * 6);
      action = 'Offering a forward link';
    }
    if (base > 60) {
      const timing = p.tendency('timing') * p.familiarity(),
        margin = 0.45 + (1 - timing) * 0.8;
      x = Math.min(x, Math.max(oppLine - margin, br));
      if (br > 62 && Math.sin(this.elapsed * 0.55 + p.slot * 1.7) > 1 - p.tendency('advance')) {
        x = Math.min(100, Math.max(br, oppLine) + 0.8 + (1 - timing) * 1.1);
        action = 'Timing a forward run';
        intent = 'run';
      }
    }
    if (p.runs > this.elapsed && base > 30) {
      x = clamp(br + 9, 24, 96);
      action = 'Pass and move';
      intent = 'run';
    }
    if (owner?.role === 'GK' && base < 58) {
      x = base < 30 ? 19 : 35;
      y = base < 30 ? 34 + (sideY - 34) * 1.35 : 34 + (sideY - 34) * 1.55;
      action = 'Opening a safe outlet';
      const marker = enemies.reduce((a, q) => (!a || dist(q, p) < dist(a, p) ? q : a), null);
      if (marker && dist(marker, p) < 9) {
        y += p.y < marker.y ? -6 : 6;
        x += 4;
      }
    }
    if (base >= 30 && base < 60 && p.tendency('hold') < 0.64 && (dist(p, b) > 12 || br > 64)) {
      intent = 'run';
      action = 'Joining the attack';
    }
    if (base > 60 && br > 72 && Math.abs(b.y - 34) < 13) {
      y = lerp(y, 34, 0.25);
      action = 'Attacking an inside channel';
      intent = 'run';
    }
    if (role === 'DM') {
      const hold = clamp((p.tendency('hold') - 0.35) * 1.5, 0, 0.85);
      x = lerp(x, Math.min(x, br - 13), hold);
      y = lerp(y, 34, hold * 0.45);
    }
    if (p.has('latearrival') && base >= 30 && base < 60 && br < 70) {
      x -= 2;
      action = 'Waiting to join the move';
    }
    if ((role === 'LB' || role === 'RB') && owner?.role !== 'GK') {
      const sameSide = (b.y - 34) * (sideY - 34) > 0,
        backCover = team.filter(
          q => q.id !== p.id && ['CB', 'DM'].includes(q.role) && this.rel(q.x, t) < br - 6,
        ).length;
      const opposite = team.find(q => q.id !== p.id && ['LB', 'RB'].includes(q.role)),
        otherHigh = opposite && this.rel(opposite.x, t) > br;
      const security = owner ? clamp(1 - this.pressure(owner) * 0.5, 0, 1) : 0.4;
      const join = clamp(
        p.tendency('overlap') * 0.55 +
          security * 0.2 +
          (sameSide ? 0.16 : 0) +
          Math.min(backCover, 3) * 0.06 -
          (otherHigh ? 0.25 : 0) -
          (tac.style === 'bus' ? 0.17 : 0) +
          tac.lean * 0.12,
        0.05,
        0.97,
      );
      const height = clamp(br - 14 + join * 24, 22, 94);
      x = lerp(x, height, clamp((br - 35) / 35, 0, 1));
      if (p.skill('shortPassing') - p.skill('crossing') > 5 && p.tendency('inside') > 0.5) {
        y = lerp(y, 34 + (sideY < 34 ? -8 : 8), join * p.tendency('inside'));
        action = 'Offering an inside outlet';
      } else if (join > 0.66 && sameSide) {
        y = lerp(y, sideY < 34 ? 5 : 63, join);
        action = 'Choosing an overlap';
      } else action = 'Supporting from full-back';
      if (x > this.rel(p.x, t) + 8 && join > 0.56) intent = 'run';
    }
    if (
      ((base >= 30 && p.tendency('timing') > 0.68 && p.tendency('advance') > 0.6) || base > 60) &&
      br > 68 &&
      Math.abs(b.y - 34) > 13 &&
      owner?.role !== 'GK'
    ) {
      x = clamp(br + 4 + (p.slot % 3) * 2, 88, 99);
      y = 25 + (p.slot % 3) * 9;
      intent = 'run';
      action = 'Attacking the delivery';
    } else if (
      base >= 30 &&
      base < 60 &&
      role !== 'DM' &&
      br > 74 &&
      Math.abs(b.y - 34) > 11 &&
      p.tendency('hold') < 0.6 &&
      p.tendency('advance') > 0.42 - tac.lean * 0.1 &&
      owner?.role !== 'GK'
    ) {
      // Late run to the edge / penalty spot: the cutback zone.
      x = Math.max(x, p.has('latearrival') ? 90 : 87.5);
      y = 34 + (p.slot % 2 ? 4.5 : -4.5);
      intent = 'run';
      action = 'Arriving late in the box';
    }
    if (role === 'ST' && br > 84) {
      const attack = p.tendency('timing') * p.tendency('shoot');
      x = lerp(x, Math.max(x, 96), attack);
      y = lerp(y, 34 + (p.slot % 2 ? 4 : -4), attack);
    }
    if (role === 'ST' && br > 70 && Math.abs(b.y - 34) > 13) {
      const aerial = p.tendency('aerial');
      x = lerp(x, Math.max(x, 91), aerial);
      y = lerp(y, 31 + (p.slot % 2) * 6, aerial);
    }
    if (tac.style === 'counter' && this.elapsed - this.possessionStart < 7 && base > 60) {
      x = Math.min(100, Math.max(br, oppLine) - 0.2);
      intent = 'run';
      action = 'Breaking into the channel';
    }
    if (tac.style === 'bus' && base < 60) x -= 6 * this.tuning.gameplay.teamCharacter;
    if (tac.style === 'possession' && base >= 30 && base < 60) {
      x = lerp(x, br - 3, 0.35 * this.tuning.gameplay.teamCharacter);
      y = lerp(y, b.y, 0.18 * this.tuning.gameplay.teamCharacter);
    }
    if (base > 60 && intent !== 'run') x = Math.min(x, Math.max(br, oppLine - 0.5));
    if (base >= 30 && p.tendency('hold') < 0.64) {
      const freedom = p.tendency('roam') * (0.4 + (tac.fluidity - 1) * 0.3);
      y += Math.sin(this.elapsed * 0.24 + p.slot * 1.9) * 3.5 * freedom;
      x += Math.sin(this.elapsed * 0.19 + p.slot) * 1.8 * freedom;
    }
    if (p.comboRun?.until > this.elapsed && owner?.role !== 'GK') {
      x = this.rel(p.comboRun.x, t);
      y = p.comboRun.y;
      intent = 'run';
      action = 'Making a third-man run';
    }
    const behind = this.runBehind(p, c, base);
    if (behind) {
      x = behind.x;
      y = behind.y;
      intent = 'run';
      action = 'Running in behind';
    }
    if (owner && dist(p, b) < 7) {
      y += sideY < 34 ? -5 : 5;
      x -= 3;
    }
    // Move away from markers into a nearby reachable passing pocket.
    if (base >= 30 && base < 60) {
      const mark = enemies.find(q => dist(q, { x: this.abs(x, t), y }) < 3);
      if (mark) y += p.y < mark.y ? -3.8 : 3.8;
    }
    const openRun = intent === 'run' && enemies.every(q => dist(q, { x: this.abs(x, t), y }) > 3);
    ({ x, y } = this.supportTarget(p, { x, y }, anchor, openRun));
    if (tac.fluidity < 3 && !openRun && dist(p, { x: this.abs(x, t), y }) > 5) {
      intent = 'reset';
      action = 'Recovering position';
    }
    if (base > 60 && intent !== 'run') x = Math.min(x, Math.max(br, oppLine - 0.5));
    if (role === 'CB' && owner?.role !== 'GK') {
      const outlet = enemies
        .filter(q => this.formation(q)[0] > 60 && this.rel(q.x, t) < 72)
        .sort((a, b) => Math.abs(a.y - p.y) - Math.abs(b.y - p.y))[0];
      if (outlet) {
        const buffer = 1.2 + Math.max(0, outlet.topSpeed() - p.topSpeed()) * 0.8;
        x = Math.min(x, this.rel(outlet.x, t) - buffer);
        action = 'Protecting against the counter';
      }
    }
    p.markId = null;
    p.aim(this.abs(x, t), y, intent, action);
  }
  supportTarget(p, target, anchor, openRun = false) {
    const f = (this.teams[p.team].tactics.fluidity - 1) / 4;
    // Shape moves with the ball. Clear runs are exempt from the strong pull;
    // even the most structured team can attack an opening.
    const pull = openRun ? 0.06 * (1 - f) : 0.55 * Math.max(0, 1 - f * 2);
    const lateral = 8 + f * 16 + (openRun ? 16 : 0);
    return {
      x: lerp(target.x, anchor.x, pull),
      y: clamp(lerp(target.y, anchor.y, pull), anchor.y - lateral, anchor.y + lateral),
    };
  }
  startCombination(receiver, passer) {
    const available = this.activePlayers
      .filter(
        p =>
          p.team === receiver.team &&
          p.id !== receiver.id &&
          p.id !== passer?.id &&
          p.role !== 'GK' &&
          p.tendency('hold') < 0.64 &&
          this.formation(p)[0] >= 45 &&
          dist(p, receiver) < 27,
      )
      .map(p => ({
        p,
        cost: dist(p, receiver) * 0.07 - p.tendency('timing') - p.skill('pace') * 0.006,
      }))
      .sort((a, b) => a.cost - b.cost);
    const cover = this.activePlayers.filter(
      p =>
        p.team === receiver.team &&
        ['CB', 'DM'].includes(p.role) &&
        this.rel(p.x, p.team) < this.rel(receiver.x, receiver.team) - 5,
    ).length;
    const count =
      this.profile.runSupport > 10 && cover >= 2 && this.pressure(receiver) < 0.8 ? 2 : 1;
    for (const [index, { p: runner }] of available.slice(0, count).entries()) {
      const x = this.abs(
          clamp(
            this.rel(receiver.x, receiver.team) + 10 + this.profile.runSupport * 0.4 + index * 2,
            45,
            97,
          ),
          receiver.team,
        ),
        y = 34 + (index === 0 ? (runner.y < 34 ? -8 : 8) : available[0].p.y < 34 ? 8 : -8);
      if (this.activePlayers.some(q => q.team !== runner.team && dist(q, { x, y }) < 3)) continue;
      runner.comboRun = {
        x,
        y,
        until: this.elapsed + 2.0 + (this.teams[runner.team].tactics.fluidity - 1) * 0.4,
      };
      runner.rethinkAt = 0;
    }
  }
}
