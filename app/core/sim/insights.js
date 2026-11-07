// Presentation insights derived from the simulation, never feeding back into
// it: shot quality (xG, big chance, one-on-one), play situation (open play /
// counter / regain / set piece / penalty), goal story tags and the rolling
// momentum series. Nothing here draws from the match RNG.
// Methods are installed on Match.prototype by match.js. See docs/engine-events.md.
import { clamp } from '../util/math.js';
import { GOAL, segment, sigmoid, hypot } from './constants.js';

// Restart types that start a set-piece attack, and how long (sim seconds of
// the same possession) a shot still counts as coming from it.
const SET_PIECES = {
  Corner: ['corner', 12],
  'Free kick': ['free kick', 12],
  'Indirect free kick': ['free kick', 12],
  Offside: ['free kick', 10],
  'Throw-in': ['throw-in', 8],
};
export const MENTALITIES = ['push', 'balanced', 'hold'];
export const SHOT_SITUATIONS = ['open play', 'counter', 'regain', 'set piece', 'penalty'];
const LATE = 80 * 60;
const MOMENTUM_STEP = 60; // match-clock seconds per sample
const NEAR_MISS = 0.6; // metres outside a post or over the bar

// Geometric shot quality, fitted to public open-play conversion by location
// (StatsBomb zone rates in goal-zones.js): ~0.80 from 3 m, ~0.43 from 6 m,
// ~0.17 from the penalty spot, ~0.09 from the box edge, ~0.04 from 25 m.
// Shot quality, not shooter quality: finishing skill shows as goals minus xG.
export function geometricXg(distance, angle) {
  return sigmoid(-2.34 + 2.2 * angle - 0.06 * distance);
}

export class InsightMethods {
  resetInsights() {
    this.chain = { team: this.kickoffTeam ?? 0, at: 0, x: 52.5, restart: 'Kickoff', regain: false };
    this.trailed = [false, false];
    this.momentum = { step: MOMENTUM_STEP, samples: [], current: [0, 0] };
    this.momentumAcc = [0, 0];
    this.momentumEma = [0, 0];
    this.momentumNext = MOMENTUM_STEP;
  }
  // How the current attack began. Called when a team regains the ball or
  // takes a restart; the chain lasts until the other team owns the ball.
  startChain(team, x, restart = null, regain = false) {
    const c = this.chain;
    c.team = team;
    c.at = this.elapsed;
    c.x = this.rel(x, team);
    c.restart = restart;
    c.regain = regain;
  }
  situation(team, penalty = false) {
    if (penalty) return { situation: 'penalty', setPiece: null };
    const c = this.chain,
      since = this.elapsed - c.at;
    if (c.team === team) {
      const set = SET_PIECES[c.restart];
      if (set && since < set[1]) return { situation: 'set piece', setPiece: set[0] };
      if (c.regain && c.x < 52.5 && since < 15) return { situation: 'counter', setPiece: null };
      if (c.regain && c.x >= 62 && since < 10) return { situation: 'regain', setPiece: null };
    }
    return { situation: 'open play', setPiece: null };
  }
  // xG of a shot from p's position. Blockers are outfield opponents inside
  // the shooter-posts triangle; one-on-one means none of them and only light
  // pressure inside 20 m; a keeper away from the shot line opens the goal.
  shotQuality(p, header = false, penalty = false) {
    if (penalty) return { xg: 0.76, bigChance: true, oneOnOne: false, distance: 11 };
    const spatial = this.location(p),
      goalX = this.abs(105, p.team),
      rx = this.rel(p.x, p.team);
    let blockers = 0;
    for (const q of this.activePlayers) {
      if (q.team === p.team || q.role === 'GK') continue;
      const qx = this.rel(q.x, p.team);
      if (qx <= rx + 0.3) continue;
      // Inside the triangle (shooter, both posts)? Compare lateral offset at q's depth.
      const t = (qx - rx) / Math.max(0.1, 105 - rx),
        lo = p.y + (34 - GOAL / 2 - p.y) * t - 0.4,
        hi = p.y + (34 + GOAL / 2 - p.y) * t + 0.4;
      if (q.y > lo && q.y < hi && t <= 1) blockers++;
    }
    const pressure = this.pressure(p),
      distance = spatial.distance;
    const oneOnOne =
      blockers === 0 && pressure < 0.35 && distance < 16 && Math.abs(p.y - 34) < 12 && !header;
    let xg =
      geometricXg(distance, spatial.angle) *
      (header ? 0.55 : 1) *
      0.78 ** Math.min(blockers, 3) *
      (1 / (1 + pressure * 0.5)) *
      (oneOnOne ? 2.2 : 1);
    const g = this.keeper(1 - p.team);
    if (g && distance < 24) {
      // A keeper well off the line between the ball and goal leaves it open.
      const exposed = clamp((segment(g, p, { x: goalX, y: 34 }).d - 2) / 4, 0, 1);
      xg *= 1 + exposed * 1.6;
    } else if (!g) xg *= 1.8;
    xg = clamp(xg, 0.01, 0.95);
    return {
      xg,
      bigChance: xg >= 0.3 || (oneOnOne && xg >= 0.2),
      oneOnOne,
      distance,
    };
  }
  // Story tags known when the goal is scored (team = benefiting team).
  goalStory(team, scorerId, ownGoal) {
    const tags = [],
      s = this.score,
      before = s[team] - 1,
      other = s[1 - team];
    if (this.goalHistory.length === 0) tags.push('opener');
    if (s[team] === other) tags.push('equaliser');
    if (before === other) tags.push('go-ahead');
    if (before === other && this.trailed[team]) tags.push('comeback');
    if (!ownGoal && scorerId != null) {
      const n = this.players[scorerId].stats.goals;
      if (n === 2) tags.push('brace');
      else if (n === 3) tags.push('hat-trick');
      else if (n >= 4) tags.push('haul');
    }
    if (this.time >= LATE) tags.push('late');
    if (this.time >= this.half * 2700) tags.push('stoppage');
    for (const t of [0, 1]) if (s[t] < s[1 - t]) this.trailed[t] = true;
    return tags;
  }
  // At full time: the winning side's last go-ahead goal is the winner.
  finalizeStory() {
    const result = Math.sign(this.score[0] - this.score[1]);
    if (!result) return;
    const winner = result > 0 ? 0 : 1,
      s = [0, 0];
    let decisive = null;
    for (const g of this.goalHistory) {
      s[g.team]++;
      if (g.team === winner && s[winner] - s[1 - winner] === 1) decisive = g;
    }
    if (!decisive) return;
    decisive.story ??= [];
    if (!decisive.story.includes('winner')) decisive.story.push('winner');
    if (decisive.time >= LATE && !decisive.story.includes('late winner'))
      decisive.story.push('late winner');
  }
  // Rolling momentum: per match minute, each side's share of time on the
  // ball in the final third plus 2.5 x its xG, smoothed (EMA) into 0..1.
  trackMomentum(dt) {
    const b = this.ball,
      acc = this.momentumAcc;
    if (this.mode === 'play' && b.owner !== null) {
      const p = this.players[b.owner];
      if (this.rel(p.x, p.team) > 70) acc[p.team] += (dt * 5400) / (this.duration * MOMENTUM_STEP);
    }
    if (this.time < this.momentumNext) return;
    const m = this.momentum,
      ema = this.momentumEma;
    for (let t = 0; t < 2; t++) {
      ema[t] = ema[t] * 0.6 + acc[t] * 0.4;
      m.current[t] = 1 - Math.exp(-2.2 * ema[t]);
      acc[t] = 0;
    }
    m.samples.push({
      time: this.momentumNext,
      half: this.half,
      values: [m.current[0], m.current[1]],
    });
    this.momentumNext += MOMENTUM_STEP;
  }
  addMomentumShot(team, xg) {
    this.momentumAcc[team] += xg * 2.5;
  }
  // A shot crossing the goal line just wide of a post or over the bar.
  nearMiss(crossY, crossZ) {
    const b = this.ball,
      record = b.shotRecord;
    if (b.kind !== 'shot' || !record || record.status) return null;
    const wide = Math.abs(crossY - 34) - GOAL / 2,
      over = crossZ - 2.44;
    const by = wide > 0 ? (over > 0 ? hypot(wide, over) : wide) : over;
    if (!(by > 0) || by >= NEAR_MISS) return null;
    const p = this.players[record.player];
    return this.addEvent(
      `${p.name.split(' ').pop()} · just ${wide > 0 ? 'wide' : 'over'}`,
      p.team,
      'near-miss',
      {
        playerId: p.id,
        shotEventId: record.eventId,
        xg: record.xg,
        bigChance: record.bigChance,
        miss: wide > 0 ? 'wide' : 'over',
        by,
        strength: clamp(0.5 + record.xg, 0.5, 1),
      },
    );
  }
  // After a parry: can an attacker reach the rebound first, inside the box?
  reboundDanger(keeper) {
    const b = this.ball,
      point = { x: b.x + b.vx * 0.45, y: b.y + b.vy * 0.45 };
    if (this.rel(point.x, keeper.team) > 16.5 || Math.abs(point.y - 34) > 20.16) return false;
    let attack = Infinity,
      defend = Infinity;
    for (const q of this.activePlayers) {
      if (q.id === keeper.id) continue;
      const t = q.arrival(point);
      if (q.team === keeper.team) defend = Math.min(defend, t);
      else attack = Math.min(attack, t);
    }
    return attack < defend + 0.1;
  }
}
