// Defensive assignment helpers: marking points, press/cover bids, marks, lane reading.
// Methods are installed on Match.prototype by match.js.
import { clamp, lerp } from '../util/math.js';
import { H, dist, hypot, PASS_ROLL } from './constants.js';

const NONE = [],
  THREAT = new Float64Array(22); // scratch: threat value by player id

export class DefenceMethods {
  markingPoint(team, attacker, defender, coordination = 0) {
    const dir = this.direction(team),
      depth = this.rel(attacker.x, team);
    const expertise = defender.defensiveReading(),
      reading = 0.25 + defender.awareness() * 0.004 + expertise * 0.16;
    const lead = clamp(
      reading + Math.max(0, dist(defender, attacker) - 4) * 0.025,
      0.25,
      0.85 + expertise * 0.15,
    );
    const goalward = Math.min(0, (attacker.vx || 0) * dir);
    const beaten = this.rel(defender.x, team) > depth - 1;
    const closingRun = Math.max(0, -goalward),
      speedGap = Math.max(0, attacker.topSpeed() - defender.topSpeed());
    // Tired markers give attackers more room late in a match. In and around his own box a
    // marker gets touch-tight: nobody is left free in front of goal.
    const tight =
      Math.abs(attacker.y - 34) < 22 ? clamp(0.55 + ((depth - 8) / 20) * 0.45, 0.55, 1) : 1;
    const cushion =
      (1.25 +
        (100 - defender.awareness()) * 0.012 +
        (beaten ? 1.1 : 0) +
        Math.min(0.9, closingRun * 0.07 + speedGap * 0.2) +
        (1 - defender.energy) * 0.9) *
      tight;
    // Read the runner, stay between them and goal, shade toward the passing lane.
    const x = clamp(
      depth + goalward * lead - cushion * this.tuning.gameplay.markingDistance,
      1,
      100,
    );
    const y = clamp(
      attacker.y +
        (attacker.vy || 0) * lead +
        (34 - attacker.y) * 0.04 +
        (this.ball.y - attacker.y) * 0.025,
      2,
      66,
    );
    const point = { x: this.abs(x, team), y },
      tac = this.teams[team].tactics;
    // In the opposition's build-up, a coordinated midfield/front line can
    // screen an outlet from the ball side. Backs and dangerous runners retain
    // their goal-side protection; this is a physical run, never a free steal.
    if (this.canScreenOutlet(team, attacker, defender, coordination)) {
      const length = dist(this.ball, attacker),
        step =
          clamp((defender.pressingReading() + coordination) * 1.2, 0, 0.98) *
          clamp((tac.press - 1) / 2, 0, 1);
      if (length > 4) {
        point.x = lerp(point.x, attacker.x + ((this.ball.x - attacker.x) / length) * 1.5, step);
        point.y = lerp(point.y, attacker.y + ((this.ball.y - attacker.y) / length) * 1.5, step);
      }
    }
    return point;
  }
  canScreenOutlet(team, attacker, defender, coordination) {
    const depth = this.rel(attacker.x, team);
    return (
      coordination > 0 &&
      depth > 64 &&
      depth >= this.rel(this.ball.x, team) - 2 &&
      (attacker.vx || 0) * this.direction(team) > -1 &&
      this.formation(defender)[0] >= 30 &&
      this.ball.owner !== attacker.id &&
      this.teams[team].tactics.style !== 'bus'
    );
  }
  threatValue(team, a) {
    const depth = this.rel(a.x, team),
      central = 1 - clamp(Math.abs(a.y - 34) / 32, 0, 1);
    return (
      clamp((65 - depth) / 45, 0, 1.4) * (1 + central * 0.55) +
      Math.max(0, -(a.vx || 0) * this.direction(team)) * 0.045
    );
  }
  assignmentCost(d, a) {
    const cache = this._costCache;
    let base;
    if (cache) {
      const k = d.id * 22 + a.id;
      base = cache[k];
      if (base !== base) cache[k] = base = this.assignmentBase(d, a);
    } else base = this.assignmentBase(d, a);
    return base === Infinity ? base : base - (d.markId === a.id ? 0.6 : 0);
  }
  assignmentBase(d, a) {
    const base = this.formation(d)[0],
      depth = this.rel(a.x, d.team);
    // The back line protects forward threats, rather than following opponents
    // well behind the ball upfield. Keep close marking around our box, where
    // a cutback is dangerous even when its receiver is behind the carrier.
    if (base < 30 && depth > 30 && depth > this.rel(this.ball.x, d.team) + 4) return Infinity;
    const point = this.markingPoint(d.team, a, d),
      behind = Math.max(0, this.rel(d.x, d.team) - depth);
    const lateral = Math.abs(this.formation(d)[1] - (this.direction(d.team) > 0 ? a.y : H - a.y)),
      binding = Math.max(0, 3 - this.teams[d.team].tactics.fluidity) * 0.025;
    return (
      d.arrival(point) +
      behind * 0.045 +
      (base < 30 && depth > 58 ? 0.7 : base > 60 && depth < 25 ? 0.45 : 0) +
      Math.max(0, lateral - 10) * binding * (depth < 35 ? 0.15 : 1)
    );
  }
  // How much leaving `defender`'s nearby threat to the next-best teammate
  // costs. Uses each attacker's three cheapest covering defenders, computed
  // once per team and planning pass (same result as scanning every pair).
  abandonment(team, defender, carrier, excluded = NONE) {
    const top = this.coverTop(team);
    let cost = 0;
    for (let i = 0; i < top.count; i++) {
      const a = this.players[top.attackers[i]];
      if (a.id === carrier?.id) continue;
      const own = this.assignmentCost(defender, a);
      let next = Infinity;
      for (let k = 0; k < 3; k++) {
        const id = top.ids[i * 3 + k];
        if (id < 0) break;
        if (id === defender.id || excluded.includes(id)) continue;
        next = top.costs[i * 3 + k];
        break;
      }
      if (own < 2.2 && next > own + 0.3)
        cost = Math.max(cost, (next - own) * this.threatValue(team, a));
    }
    return cost;
  }
  coverTop(team) {
    const cache = (this._coverTop ??= [0, 1].map(() => ({
      pass: -1,
      count: 0,
      attackers: new Int32Array(11),
      ids: new Int32Array(33),
      costs: new Float64Array(33),
    })))[team];
    // Reused only within one planning pass; direct calls (tests) always recompute.
    if (this._costCache && cache.pass === this._planPass) return cache;
    cache.pass = this._costCache ? this._planPass : -1;
    cache.count = 0;
    const players = this.activePlayers;
    for (const a of players) {
      if (a.team === team || a.role === 'GK' || this.rel(a.x, team) > 54) continue;
      const i = cache.count++,
        o = i * 3;
      cache.attackers[i] = a.id;
      for (let k = 0; k < 3; k++) {
        cache.ids[o + k] = -1;
        cache.costs[o + k] = Infinity;
      }
      for (const p of players) {
        if (p.team !== team || p.role === 'GK') continue;
        const c = this.assignmentCost(p, a);
        // Insert into the sorted top three (first-found wins ties, like Math.min).
        for (let k = 0; k < 3; k++)
          if (cache.ids[o + k] < 0 || c < cache.costs[o + k]) {
            for (let j = 2; j > k; j--) {
              cache.ids[o + j] = cache.ids[o + j - 1];
              cache.costs[o + j] = cache.costs[o + j - 1];
            }
            cache.ids[o + k] = p.id;
            cache.costs[o + k] = c;
            break;
          }
      }
    }
    return cache;
  }
  carrierMotion(defender, carrier) {
    // A fresh receiver's visible body direction hints at the next touch. Read
    // only a short launch, not the carrier's chosen target or future decisions.
    const fresh = clamp(1 - (this.elapsed - carrier.receivedAt) / 0.65, 0, 1);
    const forward = Math.max(0, -Math.cos(carrier.facing) * this.direction(defender.team));
    const launch =
      fresh *
      forward *
      Math.max(0, 4 - hypot(carrier.vx, carrier.vy)) *
      (0.55 + defender.pressingReading() * 0.25);
    return {
      vx: carrier.vx + Math.cos(carrier.facing) * launch,
      vy: carrier.vy + Math.sin(carrier.facing) * launch,
    };
  }
  assignDefense(team, carrier) {
    const defending = this.activePlayers.filter(p => p.team === team && p.role !== 'GK');
    const bids = defending
      .map(p => {
        let point = p.intercept(carrier, 1.5);
        const beaten = this.rel(p.x, team) > this.rel(carrier.x, team) + 0.7;
        // A beaten defender cuts toward the inside shoulder ahead of the runner,
        // instead of chasing their current position from behind.
        if (beaten && dist(p, carrier) > 3) {
          const ahead = this.markingPoint(team, carrier, p);
          point = { x: ahead.x, y: lerp(ahead.y, 34, 0.08) };
        } else if (!beaten) {
          // Leave enough room to brake when closing a controlled receiver.
          // A slow or exposed touch still brings the defender into tackle range.
          const gap = dist(p, carrier),
            close = this.ball.owner === carrier.id ? clamp((10 - gap) / 4, 0, 1) : 0;
          const motion = close ? this.carrierMotion(p, carrier) : carrier;
          if (close)
            // intercept() reads only the target's position and velocity.
            point = p.intercept(
              {
                x: carrier.x,
                y: carrier.y,
                vx: lerp(carrier.vx, motion.vx, close),
                vy: lerp(carrier.vy, motion.vy, close),
              },
              1.5,
            );
          const closing = Math.max(
            0,
            ((p.vx - motion.vx) * (carrier.x - p.x) + (p.vy - motion.vy) * (carrier.y - p.y)) /
              (gap || 1),
          );
          const braking =
            close *
            clamp((closing * closing) / (2 * p.acceleration() * (0.72 + p.energy * 0.28)), 0, 1.1);
          const goal = { x: this.abs(0, team), y: 34 },
            length = dist(point, goal) || 1;
          const cushion = 0.9 + p.pressingReading() * 0.25 + braking;
          point = {
            ...point,
            x: point.x + ((goal.x - point.x) / length) * cushion,
            y: point.y + ((goal.y - point.y) / length) * cushion,
          };
        }
        const abandon = this.abandonment(team, p, carrier);
        return {
          p,
          point,
          beaten,
          cost:
            p.arrival(point) +
            (beaten ? 0.25 : 0) +
            abandon * 0.75 * (1 + p.defensiveReading() * 0.25) -
            (p.has('ballwinner') ? 0.12 : 0) +
            (this.presser[team] === p.id ? -0.4 : 0),
        };
      })
      .sort((a, b) => a.cost - b.cost);
    const press = bids[0];
    this.presser[team] = press.p.id;
    const goal = { x: this.abs(0, team), y: 34 },
      gdist = dist(goal, press.point) || 1;
    const coverPoint = {
      x: clamp(press.point.x + ((goal.x - press.point.x) / gdist) * 5, 1, 104),
      y: clamp(press.point.y + ((34 - press.point.y) / gdist) * 5, 1, 67),
    };
    // Each candidate's run to the cover point is computed once, not per comparison.
    const excluded = [press.p.id];
    const alternatives = bids
      .slice(1)
      .map(b => ({
        ...b,
        abandonment: this.abandonment(team, b.p, carrier, excluded),
        arrival: b.p.arrival(coverPoint),
      }))
      .sort((a, b) => a.arrival + a.abandonment * 3 - b.arrival - b.abandonment * 3);
    const depth = this.rel(carrier.x, team),
      closing = -carrier.vx * this.direction(team),
      pressArrival = press.p.arrival(press.point);
    const breaking =
      depth < 65 &&
      Math.abs(carrier.y - 34) < 26 &&
      (press.beaten || press.p.stun > 0 || (closing > 2 && pressArrival > 0.8));
    const candidate = alternatives[0],
      needsCover = breaking || (depth < 45 && Math.abs(carrier.y - 34) < 22 && pressArrival > 0.5);
    const cover =
      needsCover && candidate.abandonment < 0.28 && candidate.arrival < 1.8 ? candidate.p.id : null;
    return { press: press.p.id, point: press.point, cover, coverPoint };
  }
  assignMarks(team, carrier, defence, coordination = 0) {
    const defenders = this.activePlayers.filter(
      p => p.team === team && p.role !== 'GK' && p.id !== defence?.press && p.id !== defence?.cover,
    );
    // Most dangerous first; each attacker's threat is computed once, not per comparison.
    const attackers = this.activePlayers.filter(
      p => p.team !== team && p.role !== 'GK' && p.id !== carrier?.id,
    );
    for (const a of attackers) THREAT[a.id] = this.threatValue(team, a);
    attackers.sort((a, b) => THREAT[b.id] - THREAT[a.id] || a.id - b.id);
    const marks = new Map();
    for (const id of [defence?.press, defence?.cover])
      if (id != null) this.players[id].markId = null;
    // Prioritize dangerous runners, with a switching cost to keep useful matches.
    // Expiring timers may never reserve the nearest defender for a harmless man.
    for (const a of attackers) {
      let best = null;
      for (const d of defenders) {
        if (marks.has(d.id)) continue;
        const cost = this.assignmentCost(d, a);
        if (!Number.isFinite(cost)) continue;
        if (!best || cost < best.cost) best = { d, cost };
      }
      if (best && (best.cost < 5.5 || this.rel(a.x, team) < 38)) marks.set(best.d.id, a);
    }
    // Organizers can hand over two marks rather than send teammates across
    // each other. Existing switching costs keep useful assignments stable;
    // a dangerous runner may not gain space just to improve the total cost.
    if (coordination > 0.2)
      for (let sweep = 0; sweep < 2; sweep++)
        for (let i = 0; i < defenders.length; i++)
          for (let j = i + 1; j < defenders.length; j++) {
            const a = defenders[i],
              b = defenders[j],
              ma = marks.get(a.id),
              mb = marks.get(b.id);
            if (!ma && !mb) continue;
            const aa = ma ? this.assignmentCost(a, ma) : 0,
              bb = mb ? this.assignmentCost(b, mb) : 0;
            const ba = ma ? this.assignmentCost(b, ma) : 0,
              ab = mb ? this.assignmentCost(a, mb) : 0;
            if (ba + ab + 0.18 / coordination >= aa + bb) continue;
            if (
              (ma && this.rel(ma.x, team) < 38 && ba > aa + 0.1) ||
              (mb && this.rel(mb.x, team) < 38 && ab > bb + 0.1)
            )
              continue;
            if (mb) marks.set(a.id, mb);
            else marks.delete(a.id);
            if (ma) marks.set(b.id, ma);
            else marks.delete(b.id);
          }
    for (const d of defenders) {
      const mark = marks.get(d.id);
      if (d.markId !== (mark?.id ?? null)) {
        d.markId = mark?.id ?? null;
        d.markUntil = this.elapsed + 0.75;
        d.rethinkAt = 0;
      }
    }
    return marks;
  }
  receiverPressPoint(team, receiver, defender, coordination = 0) {
    const point = this.markingPoint(team, receiver, defender, coordination),
      b = this.ball;
    if (
      b.kind !== 'pass' ||
      b.missedReceiver ||
      !b.destination ||
      b.z > 1 ||
      this.rel(defender.x, team) > this.rel(receiver.x, team) - 0.5
    )
      return point;
    if (this.rel(b.destination.x, team) < this.rel(b.deliveryOrigin?.x ?? b.x, team) - 4)
      return point;
    const reading = clamp(defender.pressingReading() * 0.8 + coordination * 0.6, 0, 0.9);
    if (!reading) return point;
    const goal = { x: this.abs(0, team), y: 34 },
      length = dist(b.destination, goal) || 1;
    const contact = {
      x: b.destination.x + ((goal.x - b.destination.x) / length) * 1.15,
      y: b.destination.y + ((goal.y - b.destination.y) / length) * 1.15,
    };
    return { x: lerp(point.x, contact.x, reading), y: lerp(point.y, contact.y, reading) };
  }
  readPassingLane(team, receiver) {
    const b = this.ball,
      speed = hypot(b.vx, b.vy);
    if (b.kind !== 'pass' || b.missedReceiver || b.z > 0.65 || b.vz > 1 || speed < 5) return null;
    let best = null;
    for (const p of this.activePlayers) {
      if (p.team !== team || p.role === 'GK' || p.stun > 0) continue;
      const reading = p.pressingReading();
      if (reading <= 0) continue;
      const reaction =
        0.08 +
        (100 - p.pressAwareness()) * 0.003 +
        Math.max(0, (b.passCraft ?? 60) - p.pressAwareness()) *
          0.004 *
          this.tuning.gameplay.passingQuality;
      for (const time of [0.18, 0.32, 0.48, 0.7, 0.9]) {
        if (time > 0.25 + reading * 0.75) break;
        const travel = Math.max(
          0,
          speed * time - (b.z < 0.15 ? (b.roll || PASS_ROLL) * time * time * 0.5 : 0),
        );
        const point = { x: b.x + (b.vx / speed) * travel, y: b.y + (b.vy / speed) * travel };
        if (
          point.x < 1 ||
          point.x > 104 ||
          point.y < 1 ||
          point.y > 67 ||
          (b.destination &&
            (point.x - b.destination.x) * b.vx + (point.y - b.destination.y) * b.vy > 0)
        )
          continue;
        if (receiver && receiver.arrival(point) < time - 0.06) break;
        const arrival = Math.max(
            p.arrival(point) + reaction,
            p.cooldown,
            (p.controlUntil || 0) - this.elapsed,
          ),
          lead = time - arrival;
        if (lead < -0.04 || (receiver && receiver.arrival(point) < arrival + 0.08)) continue;
        // A high-risk gamble cannot release a dangerous runner. A clearly
        // early interception can be attacked with the normal movement limits.
        const abandon = this.abandonment(team, p, receiver);
        if (abandon > 0.25 && (lead < 0.16 || this.formation(p)[0] < 30)) continue;
        const cost = arrival + abandon * 0.15 - reading * 0.08;
        if (!best || cost < best.cost) best = { p, point, cost };
        break;
      }
    }
    return best;
  }
}
