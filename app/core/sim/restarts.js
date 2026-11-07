// Set pieces and restarts: positioning and execution.
// Methods are installed on Match.prototype by match.js.
import { clamp } from '../util/math.js';
import { H, dist } from './constants.js';

const KICKOFFS = new Set(['Goal', 'Second half', 'Kickoff', 'Extra time']);

export class RestartMethods {
  startRestart(type, team, x, y, timer) {
    timer ??=
      type === 'Goal kick' ? 1.7 : type === 'Corner' ? 2.1 : type === 'Throw-in' ? 1.15 : 1.2;
    if (!KICKOFFS.has(type)) timer *= this.tuning.gameplay.restartSetup;
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
    else
      taker = this.activePlayers
        .filter(p => p.team === team && p.role !== 'GK')
        .sort((a, c) => dist(a, b) - dist(c, b))[0];
    this.restart = { type, team, x, y, timer, taker: taker.id };
    if (!['Goal', 'Second half', 'Extra time', 'Penalty', 'Free kick', 'Offside'].includes(type))
      this.addEvent(`${type} · ${this.teams[team].name}`, team, 'restart');
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
    const cornerAttack =
      type === 'Corner'
        ? this.activePlayers
            .filter(p => p.team === team && p.role !== 'GK' && p.id !== taker.id)
            .sort(
              (a, c) =>
                c.skill('heading') * 0.6 +
                c.skill('strength') * 0.25 +
                c.skill('shooting') * 0.15 -
                (a.skill('heading') * 0.6 +
                  a.skill('strength') * 0.25 +
                  a.skill('shooting') * 0.15),
            )
            .slice(0, 5)
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
      if (type === 'Goal kick' && p.id !== taker.id && p.role !== 'GK') {
        const [base, by] = this.formation(p),
          own = p.team === team;
        p.tx = this.abs(
          own ? (base < 30 ? 18 : base < 58 ? 37 : 62) : base < 30 ? 36 : base < 58 ? 54 : 77,
          p.team,
        );
        p.ty = this.direction(p.team) > 0 ? by : H - by;
      }
      if (type === 'Corner' && p.role !== 'GK' && p.id !== taker.id) {
        if (p.team !== team || cornerAttack.includes(p)) {
          p.tx = this.abs(team === p.team ? 89 + this.rand() * 10 : 9 + this.rand() * 8, p.team);
          p.ty = 18 + this.rand() * 32;
        } else {
          p.tx = this.abs(55 + (p.slot % 2) * 12, p.team);
          p.ty = 20 + (p.slot % 3) * 14;
        }
      }
      if (type === 'Penalty') {
        if (p.team !== team && p.role === 'GK') {
          p.tx = this.abs(105, team);
          p.ty = 34;
        } else if (p.id !== taker.id) {
          p.tx = this.abs(82 - (p.slot % 3) * 2, team);
          p.ty = 18 + (p.slot % 6) * 7;
        }
      } else if (p.team !== team && dist(p, b) < 9.15) {
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
    taker.tx = x - this.direction(team) * 0.6;
    taker.ty = clamp(y, 1, 67);
  }
  stepRestart(dt) {
    const r = this.restart;
    r.timer -= dt;
    for (const p of this.activePlayers) this.move(p, dt, true);
    if (r.timer > 0) return;
    const taker = this.players[r.taker],
      kickoff = KICKOFFS.has(r.type);
    if (kickoff) this.positionKickoff(r.team);
    for (const p of this.activePlayers) {
      if (r.type === 'Penalty') {
        if (p.team !== r.team && p.role === 'GK') {
          p.x = this.abs(105, r.team);
          p.y = 34;
          p.vx = p.vy = 0;
        } else if (p.id !== taker.id) {
          p.x = this.abs(82 - (p.slot % 3) * 2, r.team);
          p.y = 18 + (p.slot % 6) * 7;
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
    taker.x = clamp(r.x - this.direction(r.team) * 0.5, 0.5, 104.5);
    taker.y = clamp(r.y, 0.5, 67.5);
    taker.vx = taker.vy = 0;
    taker.facing = this.direction(r.team) > 0 ? 0 : Math.PI;
    this.ball.x = r.x;
    this.ball.y = r.y;
    this.ball.owner = taker.id;
    this.ball.lastTouch = r.team;
    this.ball.kind = r.type === 'Goal kick' ? 'held' : 'dribble';
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
    if (r.type === 'Goal kick') {
      taker.hold = 0;
      taker.think = 0.2;
      taker.goalKickExempt = true;
      this.plan();
      return;
    }
    if (r.type === 'Corner') {
      const box = opts.filter(o => this.inBox(o.r)).sort((a, b) => b.score - a.score)[0];
      if (box) {
        this.pass(taker, { ...box, delivery: 'cross' }, r.type);
        return;
      }
    }
    if (
      r.type === 'Free kick' &&
      this.rel(taker.x, taker.team) > 77 &&
      Math.abs(taker.y - 34) < 19 &&
      this.rand() < 0.32 + taker.tendency('shoot') * 0.4
    )
      this.shoot(taker, { restart: true });
    else if (opts.length) this.pass(taker, opts[0], r.type);
    else this.own(taker);
  }
}
