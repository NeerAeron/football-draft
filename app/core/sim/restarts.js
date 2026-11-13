// Set pieces and restarts: positioning and execution.
// Methods are installed on Match.prototype by match.js.
import { clamp } from '../util/math.js';
import { H, dist, hypot } from './constants.js';

const KICKOFFS = new Set(['Goal', 'Second half', 'Kickoff', 'Extra time']);
// A penalty taker starts his run this long before the strike and runs through the ball: from
// 3.4 m behind it he arrives as he hits it (starting at 0.8 s and stopping short of the ball
// he was still 1.5 m away at the strike, and jumped onto it).
const PENALTY_RUN_UP = 1.0;
// Free kicks that are built up from like a goal kick when they are deep in the taker's half.
const FREE_KICKS = new Set(['Free kick', 'Indirect free kick', 'Offside']),
  DEEP_FREE_KICK = 40,
  BUILD_SPOT = { x: 0, y: 0 };

export class RestartMethods {
  startRestart(type, team, x, y, timer) {
    timer ??=
      type === 'Goal kick' ? 1.7 : type === 'Corner' ? 2.8 : type === 'Throw-in' ? 1.15 : 1.2;
    // Goal kicks and deep free kicks are built up from: both sides run to a shape and the
    // taker waits for them (stepRestart), so the timer is only the least he waits.
    const build =
      type === 'Goal kick' || (FREE_KICKS.has(type) && this.rel(x, team) < DEEP_FREE_KICK);
    if (build) timer = 1;
    if (!KICKOFFS.has(type)) timer *= this.tuning.gameplay.restartSetup;
    // A side holding a lead takes its time over restarts; one chasing hurries.
    if (type !== 'Penalty') timer *= 1 + this.mentalityShift(team).restartTime;
    this.mode = 'restart';
    this.phase = type;
    const b = this.ball;
    b.owner = null;
    b.pendingPass = null;
    b.missedReceiver = false;
    b.previous = null;
    b.vx = b.vy = b.vz = b.z = 0;
    b.x = x;
    b.y = y;
    b.kind = 'loose';
    b.lastTouch = team;
    b.target = null;
    b.kicker = null;
    b.offside = false;
    b.offsideState = null;
    b.assist = null;
    b.goalCredit = null;
    b.deliveryOrigin = null;
    b.shotOrigin = null;
    b.shotType = null;
    b.shotRecord = null;
    b.penaltyKick = false;
    b.indirect = null;
    b.penaltyTaker = null;
    b.restartTaker = null;
    b.reboundTeam = null;
    this.lastPass = null;
    this.pendingTackle = null;
    let taker;
    if (KICKOFFS.has(type)) taker = this.kickoffTaker(team);
    else if (type === 'Goal kick') taker = this.keeper(team);
    else if (type === 'Penalty')
      taker = this.activePlayers
        .filter(p => p.team === team && p.role !== 'GK')
        .sort(
          (a, c) =>
            c.skill('penalties') +
            c.skill('composure') * 0.6 -
            (a.skill('penalties') + a.skill('composure') * 0.6),
        )[0];
    else {
      // A deep free kick is a defender's or a midfielder's to take when one is near.
      const near = this.activePlayers
        .filter(p => p.team === team && p.role !== 'GK')
        .sort((a, c) => dist(a, b) - dist(c, b));
      taker =
        (build &&
          near.find(p => this.formation(p)[0] < 58 && dist(p, b) < dist(near[0], b) + 12)) ||
        near[0];
    }
    this.restart = { type, team, x, y, timer, taker: taker.id, build, routine: null, waited: 0 };
    if (!['Goal', 'Second half', 'Extra time', 'Penalty', 'Free kick', 'Offside'].includes(type))
      this.addEvent(`${type} · ${this.teams[team].name}`, team, 'restart', { restart: type });
    this.planTimer = 0;
    for (const p of this.activePlayers) {
      p.rethinkAt = 0;
      p.markId = null;
      p.markUntil = 0;
    }
    this.plan();
    const wall =
      type === 'Free kick'
        ? this.activePlayers
            .filter(p => p.team !== team && p.role !== 'GK')
            .sort((a, b) => dist(a, this.ball) - dist(b, this.ball))
            .slice(0, 3)
        : [];
    for (const p of this.activePlayers) {
      p.cooldown = 0;
      p.stun = 0;
      p.animation = null;
      p.action = 'Taking position';
      if (KICKOFFS.has(type)) {
        const [base, by] = this.formation(p);
        p.tx = this.abs(Math.min(base * 0.67, 49), p.team);
        p.ty = this.direction(p.team) > 0 ? by : H - by;
      }
      if (type !== 'Penalty' && p.team !== team && dist(p, b) < 9.15) {
        const angle = Math.atan2(p.y - y, p.x - x);
        p.tx = clamp(x + Math.cos(angle) * 9.4, 1, 104);
        p.ty = clamp(y + Math.sin(angle) * 9.4, 1, 67);
      }
      const wallIndex = wall.indexOf(p);
      if (wallIndex >= 0) {
        const angle = Math.atan2(34 - y, this.abs(105, team) - x);
        p.tx = x + Math.cos(angle) * 9.3 - Math.sin(angle) * (wallIndex - 1);
        p.ty = y + Math.sin(angle) * 9.3 + Math.cos(angle) * (wallIndex - 1);
      }
    }
    if (type === 'Corner') this.setupCorner(team, taker, y);
    if (build) this.setupBuildUp(team, taker);
    if (type === 'Throw-in') this.setupThrowIn(team, taker, x, y);
    taker.tx = x - this.direction(team) * 0.6;
    taker.ty = clamp(y, 1, 67);
    if (type === 'Penalty') this.setupPenalty(team, taker);
  }
  // A penalty is set up like a real one, at once (the screen cuts to it): the keeper on his
  // line in the middle of the goal, the taker a few steps behind the ball, everybody else
  // outside the box and the arc, behind the ball — spread along the edge in the order they
  // stood across the pitch, two of the taker's defenders and one opposing forward staying up
  // the pitch. The taker waits, then runs up (stepRestart).
  setupPenalty(team, taker) {
    const dir = this.direction(team),
      depth = p => this.formation(p)[0],
      outfield = this.activePlayers.filter(p => p.role !== 'GK' && p.id !== taker.id),
      back = outfield
        .filter(p => p.team === team)
        .sort((a, c) => depth(a) - depth(c) || a.id - c.id)
        .slice(0, 2),
      up = outfield
        .filter(p => p.team !== team)
        .sort((a, c) => depth(c) - depth(a) || a.id - c.id)
        .slice(0, 1),
      edge = outfield
        .filter(p => !back.includes(p) && !up.includes(p))
        .sort((a, c) => a.y - c.y || a.id - c.id);
    const place = (p, rx, y) => {
      p.x = p.tx = this.abs(rx, team);
      p.y = p.ty = y;
      p.vx = p.vy = 0;
      p.facing = Math.atan2(34 - y, this.abs(94, team) - p.x);
      p.trail = [];
    };
    back.forEach((p, i) => place(p, 60, back.length > 1 ? 26 + i * 16 : 34));
    up.forEach(p => place(p, 66, 34));
    edge.forEach((p, i) => {
      const y = edge.length > 1 ? 13.5 + (41 * i) / (edge.length - 1) : 34,
        // Outside the box (88.5) and the arc (9.15 m from the spot); every other man a
        // couple of strides further back, so it is a crowd on the edge and not a wall.
        arc = 94 - Math.sqrt(Math.max(0, 9.9 * 9.9 - (y - 34) * (y - 34)));
      place(p, Math.min(87.4, arc) - (i % 2) * 2.3, y);
    });
    for (const p of this.activePlayers) {
      if (p.role !== 'GK') continue;
      if (p.team === team) {
        p.tx = this.abs(6, team);
        p.ty = 34;
      } else {
        place(p, 104.6, 34);
        p.action = 'On his line';
      }
    }
    place(taker, 94 - 3.4, 34 + dir * 1.1);
    taker.action = 'Stepping up';
  }
  // Throw-in: the two nearest team-mates show for the ball, one down the line and one
  // infield, so the thrower has a short throw to a player coming to meet it (their markers
  // went to where they stood, as at any check to the ball).
  setupThrowIn(team, taker, x, y) {
    const dir = this.direction(team),
      infield = y < 34 ? 1 : -1,
      line = [clamp(x + dir * 9, 2, 103), y + infield * 2.5],
      inside = [clamp(x - dir * 1.5, 2, 103), y + infield * 9.5];
    const near = this.activePlayers
      .filter(p => p.team === team && p.role !== 'GK' && p.id !== taker.id)
      .sort((a, c) => hypot(a.x - x, a.y - y) - hypot(c.x - x, c.y - y) || a.id - c.id)
      .slice(0, 2);
    if (near.length < 2) return;
    const to = (p, spot) => hypot(p.x - spot[0], p.y - spot[1]),
      [a, c] = near,
      swap = to(a, inside) + to(c, line) < to(a, line) + to(c, inside);
    for (const [p, spot] of [
      [a, swap ? inside : line],
      [c, swap ? line : inside],
    ]) {
      p.tx = spot[0];
      p.ty = spot[1];
      p.action = 'Showing for the throw';
    }
  }
  // A restart is unhurried: nobody presses the taker and the defence is set, so he does not
  // play the ball an opponent is standing on or one his team-mate is second to — he takes the
  // best ball that is on (still the forward one when it is). A throw is not a long pass.
  restartOption(opts, type) {
    const reach = type === 'Throw-in' ? 30 : Infinity;
    let safest = null,
      safety = -Infinity;
    for (const o of opts) {
      if (o.d > reach) continue;
      if (o.risk < 0.5 && o.margin > -0.1 && o.chance > 0.5) return o;
      const value = o.chance - o.risk * 0.5 + clamp(o.margin, -1, 0.5) * 0.3;
      if (value > safety) {
        safety = value;
        safest = o;
      }
    }
    return safest ?? opts[0];
  }
  // Building up from the back — a goal kick, a free kick deep in the taker's half (after an
  // offside or a foul) and the keeper with the ball in his hands share one shape. Nobody is
  // placed: every player gets a target and runs there (restart mode: stepRestart waits for
  // them; keeper's hands: planning.js aims them and decisions.js waits). The side without the
  // ball either drops into a mid-block (its front line 44 m from the goal line at a goal
  // kick) or, when it presses high or is chasing the game, comes up to the edge of the box.
  // The side with it answers: against a mid-block it splits its centre-backs beside the box,
  // full-backs wide and higher, and builds up short; against the press — or when it is the
  // one chasing — everybody pushes up and the ball goes long, to its best header with the
  // midfield around him for the second ball (buildUpOption decides at the kick).
  buildUpRoutine(team) {
    return this.buildUpPressed(team) || this.lean(team) > 0 ? 'long' : 'short';
  }
  buildUpPressed(team) {
    return this.teams[1 - team].tactics.press >= 4 || this.lean(1 - team) > 0;
  }
  // The offside line for `team`'s attackers right now: the second-last opponent, or halfway.
  offsideLine(team) {
    let deepest = -Infinity,
      second = -Infinity;
    for (const q of this.activePlayers) {
      if (q.team === team) continue;
      const x = this.rel(q.x, team);
      if (x > deepest) {
        second = deepest;
        deepest = x;
      } else if (x > second) second = x;
    }
    return Math.max(52.5, second);
  }
  // p's spot in that shape (absolute, in BUILD_SPOT — read it before the next call). `team`
  // has the ball, `o` is how far up the pitch it is from a goal kick's 5.5 m: both sides'
  // lines move up with it, the defending side never nearer than 11 m to the ball and the
  // attackers short of the last line (offside counts at a free kick).
  buildUpSpot(p, team, long, pressing, o = 0, line = Infinity) {
    const [base, by] = this.formation(p),
      y = this.direction(p.team) > 0 ? by : H - by,
      off = y - 34,
      wide = Math.abs(off) >= 14,
      last = 70 + o * 0.4;
    let x, ty;
    if (p.team === team) {
      if (base < 30) {
        // Back line: centre-backs either side of the box (the middle one of three stays
        // in front of it), full-backs wide and higher.
        x = (long ? (wide ? 33 : 29) : wide ? 22 : Math.abs(off) < 3 ? 21 : 11) + o * 0.6;
        ty =
          long || Math.abs(off) < 3
            ? y
            : wide
              ? 34 + Math.sign(off) * 24
              : 34 + Math.sign(off) * 16;
      } else if (base < 58) {
        x = (long ? 48 + (base - 30) * 0.3 : 30 + (base - 30) * 0.6) + o * 0.5;
        ty = long ? 34 + off * 0.8 : y;
      } else {
        x = Math.min((long ? 64 + (base - 58) * 0.1 : 62) + o * 0.5, last - 2);
        ty = long ? 34 + off * 0.7 : y;
      }
      // Onside: no further than the last line is right now (it is still dropping).
      x = Math.min(x, line - 1.5);
    } else {
      // Measured from the goal line of the side with the ball; the defenders stay goal-side
      // of the forwards they mark.
      x =
        base >= 58
          ? (pressing ? 23 : 44) + o * 0.45
          : base >= 30
            ? (pressing ? 40 : 56) + o * 0.45
            : last;
      x = Math.max(x, 16.5 + o);
      ty = 34 + off * (base < 30 ? 0.75 : 0.85);
    }
    BUILD_SPOT.x = this.abs(x, team);
    BUILD_SPOT.y = clamp(ty, 2, 66);
    return BUILD_SPOT;
  }
  setupBuildUp(team, taker) {
    const r = this.restart;
    r.routine = this.buildUpRoutine(team);
    this.aimBuildUp(r, taker);
    for (const p of this.activePlayers)
      if (p.id !== taker.id && p.role !== 'GK')
        p.action = p.team === team ? 'Offering for the build-up' : 'Dropping off';
  }
  // Everybody's target for the restart `r` (again every step of a free kick: the attackers
  // hold their runs at the last line while it drops; a goal kick has no offside).
  aimBuildUp(r, taker) {
    const team = r.team,
      pressing = this.buildUpPressed(team),
      o = Math.max(0, this.rel(r.x, team) - 5.5),
      line = r.type === 'Goal kick' ? Infinity : this.offsideLine(team);
    for (const p of this.activePlayers) {
      if (p.id === taker.id || p.role === 'GK') continue;
      const spot = this.buildUpSpot(p, team, r.routine === 'long', pressing, o, line);
      p.tx = spot.x;
      p.ty = spot.y;
    }
  }
  // Are the sides set? The back line and midfield of the side with the ball within 5 m of
  // their spots, everybody else within 14 m of his, the other side at its distance (out of
  // the box at a goal kick, 9.15 m at a free kick).
  buildUpSet(team, r = null) {
    for (const p of this.activePlayers) {
      if (p.role === 'GK' || p.id === r?.taker) continue;
      const own = p.team === team;
      if (hypot(p.tx - p.x, p.ty - p.y) > (own && this.formation(p)[0] < 58 ? 5 : 14)) return false;
      if (own || !r) continue;
      if (r.type === 'Goal kick' ? this.inBox(p, p.team) : dist(p, r) < 9.15) return false;
    }
    return true;
  }
  // Corner routine: near-post flick-on, far-post header or a ball to the
  // edge. The best headers take the box spots (the best of all attacks the
  // routine's zone); the defenders' best headers mark them goal-side and the
  // rest hold zones. The aerial duel at the delivery decides it.
  setupCorner(team, taker, cornerY) {
    const near = cornerY < 34 ? -1 : 1,
      aerial = q =>
        q.skill('heading') * 0.6 + q.skill('strength') * 0.25 + q.tendency('aerial') * 10,
      longShot = q => q.skill('longShots') * 0.6 + q.skill('shooting') * 0.4;
    const attackers = this.activePlayers
      .filter(p => p.team === team && p.role !== 'GK' && p.id !== taker.id)
      .sort((a, c) => aerial(c) - aerial(a) || a.id - c.id);
    const box = attackers.slice(0, 5),
      rest = attackers.slice(5);
    const shooter = [...attackers.slice(2)].sort(
      (a, c) => longShot(c) - longShot(a) || a.id - c.id,
    )[0];
    const routine = this.chooseWeighted([
      ['near post', 1],
      ['far post', 1.2],
      ['edge', shooter ? 0.25 + clamp((longShot(shooter) - 70) / 40, 0, 0.4) : 0],
    ]);
    // Spread across the box (a crowd, not a pile): front post, back post, the keeper's
    // six-yard line, the penalty spot and the edge.
    const spots = {
      'near post': [99, 34 + near * 4.2],
      'far post': [97.6, 34 - near * 5.2],
      six: [99.8, 34 - near * 0.8],
      spot: [93.5, 34 + near * 1.6],
      edge: [87.5, 34 - near * 2],
    };
    const order =
      routine === 'near post'
        ? ['near post', 'far post', 'six', 'spot', 'edge']
        : ['far post', 'near post', 'six', 'spot', 'edge'];
    const place = (p, [x, y]) => {
      p.tx = this.abs(x, team);
      p.ty = y;
    };
    const spotOf = new Map(box.map((p, i) => [p, spots[order[i]]]));
    let target = box[0];
    if (routine === 'edge' && shooter) {
      // The shooter takes the edge spot; whoever held it takes his place.
      const holder = box.find(p => spotOf.get(p) === spots.edge && p !== shooter);
      if (holder) spotOf.set(holder, spotOf.get(shooter) ?? [92, 34 - near * 4]);
      spotOf.set(shooter, spots.edge);
      target = shooter;
    }
    for (const [p, spot] of spotOf) place(p, spot);
    rest.filter(p => p !== target).forEach((p, i) => place(p, [i ? 67 : 58, i % 2 ? 22 : 46]));
    const defenders = this.activePlayers
      .filter(p => p.team !== team && p.role !== 'GK')
      .sort((a, c) => aerial(c) - aerial(a) || a.id - c.id);
    const marked = box.slice(0, 4);
    defenders.forEach((d, i) => {
      if (i < marked.length) {
        const a = marked[i];
        d.tx = a.tx + this.direction(team) * 1.4;
        d.ty = a.ty + (34 - a.ty) * 0.2;
        d.markId = a.id;
      } else {
        // Zonal defenders mark nobody (the plan() before this set-up assigned open-play marks).
        d.markId = null;
        const zones = [
          [103.6, 34 + near * 3.3],
          [102.2, 34 - near * 2.6],
          [89, 34 + near * 6],
          [80, 24],
          [80, 44],
          [72, 34],
        ];
        place(d, zones[Math.min(i - marked.length, zones.length - 1)]);
      }
    });
    // A corner is a cut in the action: everyone is in position when it is awarded, not
    // jumped there at the kick (a viewer sees the set-up, then the delivery).
    for (const p of this.activePlayers)
      if (p.id !== taker.id && p.role !== 'GK') {
        p.x = p.tx;
        p.y = p.ty;
        p.vx = p.vy = 0;
      }
    Object.assign(this.restart, {
      routine,
      target: target?.id ?? null,
      aim: target ? { x: target.tx, y: target.ty } : null,
    });
  }
  stepRestart(dt) {
    const r = this.restart;
    r.timer -= dt;
    r.waited += dt;
    const taker = this.players[r.taker],
      kickoff = KICKOFFS.has(r.type);
    // Penalty run-up: the taker stands over it, then comes at the ball in the last moments.
    if (r.type === 'Penalty' && r.timer < PENALTY_RUN_UP) {
      taker.tx = r.x + this.direction(r.team) * 1.2; // through the ball, not slowing for it
      taker.ty = r.y;
    }
    if (r.build && r.type !== 'Goal kick') this.aimBuildUp(r, taker);
    for (const p of this.activePlayers) this.move(p, dt, true);
    if (r.timer > 0) return;
    // Built up from: the taker waits until he is at the ball and the sides are set, or the
    // cap runs out (two seconds more for a taker who is still on his way).
    if (r.build) {
      const cap = this.tuning.gameplay.buildUpWait,
        there = hypot(taker.x - taker.tx, taker.y - taker.ty) < 1.2;
      if (r.waited < cap + (there ? 0 : 2) && !(there && this.buildUpSet(r.team, r))) return;
    }
    if (kickoff) this.positionKickoff(r.team);
    for (const p of this.activePlayers) {
      if (r.type === 'Penalty') {
        // Set up in setupPenalty; the keeper is on his line whatever happened since.
        if (p.team !== r.team && p.role === 'GK') {
          p.x = this.abs(104.6, r.team);
          p.y = 34;
          p.vx = p.vy = 0;
        }
      } else if (!kickoff && p.team !== r.team) {
        const radius = r.type === 'Throw-in' ? 2 : 9.15,
          distance = dist(p, r);
        if (distance < radius) {
          const angle = Math.atan2(p.y - r.y, p.x - r.x);
          p.x = clamp(r.x + Math.cos(angle) * (radius + 0.2), 0.5, 104.5);
          p.y = clamp(r.y + Math.sin(angle) * (radius + 0.2), 0.5, 67.5);
        }
        if (r.type === 'Goal kick' && this.inBox(p, p.team)) {
          p.x = this.abs(20, r.team);
        }
      }
    }
    // Corner positions are a set piece: everyone completes the walk to his spot.
    if (r.type === 'Corner')
      for (const p of this.activePlayers)
        if (p.id !== taker.id && p.role !== 'GK') {
          p.x = p.tx;
          p.y = p.ty;
          p.vx = p.vy = 0;
        }
    taker.x = clamp(r.x - this.direction(r.team) * 0.5, 0.5, 104.5);
    taker.y = clamp(r.y, 0.5, 67.5);
    taker.vx = taker.vy = 0;
    taker.facing = this.direction(r.team) > 0 ? 0 : Math.PI;
    this.ball.x = r.x;
    this.ball.y = r.y;
    this.ball.owner = taker.id;
    this.ball.lastTouch = r.team;
    this.ball.kind = 'dribble';
    this.mode = 'play';
    this.lastTeam = r.team;
    this.startChain(r.team, r.x, r.type);
    taker.hold = 0.2;
    taker.possessionAt = this.elapsed;
    this.planTimer = 0;
    if (r.type === 'Penalty') {
      taker.x = r.x;
      this.shoot(taker, { penalty: true });
      return;
    }
    const opts = this.options(taker);
    if (r.type === 'Corner') {
      const target = r.target != null ? this.players[r.target] : null;
      if (target && !target.sentOff && r.aim) {
        // Deliver to the routine's zone; the runner attacks it.
        const edge = r.routine === 'edge',
          aim = edge ? { x: target.x, y: target.y } : r.aim;
        this.pass(
          taker,
          {
            r: target,
            aim,
            d: dist(taker, aim),
            delivery: edge ? 'pass' : 'cross',
            loft: !edge,
            risk: 0.3,
            chance: 0.5,
          },
          r.type,
        );
        return;
      }
      const box = opts.filter(o => this.inBox(o.r)).sort((a, b) => b.score - a.score)[0];
      if (box) {
        this.pass(taker, { ...box, delivery: 'cross' }, r.type);
        return;
      }
    }
    if (r.build) {
      const kick = this.buildUpOption(taker, opts, r.routine, false, r.type === 'Goal kick');
      if (kick) this.pass(taker, kick, r.type);
      else if (opts.length) this.pass(taker, this.restartOption(opts, r.type), r.type);
      else this.own(taker);
      return;
    }
    if (
      r.type === 'Free kick' &&
      this.rel(taker.x, taker.team) > 77 &&
      Math.abs(taker.y - 34) < 19 &&
      this.rand() < 0.32 + taker.tendency('shoot') * 0.4
    )
      this.shoot(taker, { restart: true });
    else if (opts.length) this.pass(taker, this.restartOption(opts, r.type), r.type);
    else this.own(taker);
  }
}
