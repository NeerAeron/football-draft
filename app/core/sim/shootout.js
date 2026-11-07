// Knockout endings: optional extra time and the penalty shootout.
// Every kick reuses the penalty mechanics (shoot with { penalty }, keeper
// dive, ball flight and save model), taken at one end of the pitch. Fully
// deterministic: the coin toss and dives draw from the match RNG only.
// Methods are installed on Match.prototype by match.js. See docs/engine-events.md.
import { clamp, lerp } from '../util/math.js';
import { W, H, GOAL, hypot } from './constants.js';
import { PERIOD_START } from './periods.js';

const SETUP = 1.5; // real seconds to place the ball and the kicker
const FLIGHT_LIMIT = 3; // a kick that has not resolved by then is over
const PAUSE = 1; // show the outcome before the next kick
const CELEBRATE = 1.6; // after the decisive kick, before the final whistle
const SPOT_X = 94;

export class ShootoutMethods {
  // End of regulation (or of extra time) in a knockout match.
  knockoutLevel() {
    return !!this.competition?.knockout && this.score[0] === this.score[1];
  }
  clearTransient() {
    for (const p of this.activePlayers) {
      p.runs = 0;
      p.comboRun = null;
      p.finishUntil = 0;
      p.finishTarget = null;
      p.beatChain = [];
      p.penaltyDive = null;
      p.receivedAt = -10;
      p.possessionAt = -10;
      p.lastReceipt = null;
      p.goalKickExempt = false;
      p.markId = null;
      p.markUntil = 0;
      p.animation = null;
      p.stun = 0;
      p.feintCooldown = 0;
      p.feintTarget = null;
      p.cooldown = 0;
      p.controlUntil = 0;
      p.controlErrorAt = -10;
      p.rethinkAt = 0;
      p.hold = 0;
      p.think = 0;
      p.touch = 0;
      p.displayedAction = null;
      p.pendingAction = null;
    }
    this.pendingTackle = null;
    this.keeperRelease = null;
    this.lastPass = null;
    this.presser = [null, null];
    this.ballTrail = [];
  }
  // Two 15-minute halves, no pause between them; ends swap like a normal half.
  startExtraHalf(half) {
    this.half = half;
    this.periodStart = this.elapsed;
    this.time = PERIOD_START[half - 1];
    this.momentumNext = this.time + this.momentum.step;
    if (half === 3) {
      this.addedMinutes = [...this.addedMinutes.slice(0, 2), 1, 1];
      this.addedAnnounced = [...this.addedAnnounced.slice(0, 2), false, false];
      for (const p of this.activePlayers) {
        p.energy = clamp(p.energy + this.tuning.stamina.halftimeRecovery * 0.3, 0.001, 1);
        p.sprint = 1;
        p.sprintRest = 0;
      }
    }
    this.clearTransient();
    const team = half === 3 ? this.kickoffTeam : 1 - this.kickoffTeam;
    this.addEvent(
      half === 3 ? 'Level after 90 minutes. Extra time.' : 'Extra time · second half.',
      null,
      'extra-time',
      { period: half - 2 },
    );
    this.positionKickoff(team);
    this.startRestart('Extra time', team, 52.5, 34, 1.25);
  }
  // Takers: outfield players by penalties + composure, the keeper last.
  shootoutOrder(team) {
    return this.activePlayers
      .filter(p => p.team === team)
      .map(p => ({
        p,
        key: (p.role === 'GK' ? -1000 : 0) + p.skill('penalties') + p.skill('composure'),
      }))
      .sort((a, b) => b.key - a.key || a.p.slot - b.p.slot)
      .map(o => o.p.id);
  }
  startShootout() {
    const first = this.rand() < 0.5 ? 0 : 1;
    this.mode = 'shootout';
    this.phase = 'Penalty shootout';
    this.clearTransient();
    this.shootout = { first, kicks: [], score: [0, 0], winner: null };
    this.shootoutState = {
      order: [this.shootoutOrder(0), this.shootoutOrder(1)],
      taken: [0, 0],
      kick: null,
    };
    this.addEvent(`Penalties. ${this.teams[first].name} kick first.`, first, 'shootout-start', {
      first,
    });
    this.nextKick();
  }
  shootoutKicker(team) {
    const s = this.shootoutState,
      order = s.order[team].filter(id => !this.players[id].sentOff);
    return this.players[order[s.taken[team] % order.length]];
  }
  // Line everybody up for the next kick: kicker behind the spot, the
  // defending keeper on the line, everyone else in the centre circle.
  nextKick() {
    const sh = this.shootout,
      s = this.shootoutState,
      n = sh.kicks.length,
      team = n % 2 === 0 ? sh.first : 1 - sh.first;
    const kicker = this.shootoutKicker(team),
      keeper = this.keeper(1 - team) || this.shootoutKicker(1 - team);
    this.penaltyEnd = team;
    s.kick = {
      team,
      kickerId: kicker.id,
      keeperId: keeper.id,
      phase: 'setup',
      timer: SETUP,
      kickedAt: null,
      hitPost: false,
      outcome: null,
    };
    const b = this.ball;
    Object.assign(b, {
      x: SPOT_X,
      y: 34,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      owner: null,
      kind: 'loose',
      kicker: null,
      target: null,
      age: 0,
      previous: null,
      shotRecord: null,
      shotTeam: null,
      penaltyKick: false,
      penaltyTaker: null,
      restartTaker: null,
      offsideState: null,
      indirect: null,
      saver: null,
    });
    const line = [0, 0];
    for (const p of this.activePlayers) {
      p.vx = p.vy = 0;
      p.penaltyDive = null;
      p.animation = null;
      p.cooldown = 0;
      p.stun = 0;
      if (p.id === kicker.id) {
        p.x = SPOT_X - 2.6;
        p.y = 34.6;
        p.facing = 0;
        p.aim(SPOT_X - 0.5, 34, 'hold', 'Placing the ball');
      } else if (p.id === keeper.id) {
        p.x = W - 0.4;
        p.y = 34;
        p.facing = Math.PI;
        p.aim(W - 0.4, 34, 'keeper', 'On the line');
      } else if (p.role === 'GK') {
        p.aim(SPOT_X - 7, 52, 'shape', 'Waiting at the edge of the box');
      } else {
        const i = line[p.team]++;
        p.aim(52.5 + (p.team ? 1.4 : -1.4), 30 + i * 0.85, 'shape', 'Watching from halfway');
      }
    }
  }
  stepShootout(dt) {
    const s = this.shootoutState,
      k = s.kick,
      b = this.ball;
    // Walk into place between kicks; full speed while the keeper dives.
    for (const p of this.activePlayers) this.move(p, dt, k.phase !== 'flight');
    if (k.phase === 'setup') {
      k.timer -= dt;
      if (k.timer > 0) return;
      const kicker = this.players[k.kickerId];
      kicker.x = SPOT_X - 0.5;
      kicker.y = 34;
      kicker.vx = kicker.vy = 0;
      kicker.facing = 0;
      b.owner = kicker.id;
      b.kind = 'dribble';
      this.lastTeam = k.team;
      this.shoot(kicker, { penalty: true, shootout: true });
      k.phase = 'flight';
      k.kickedAt = this.elapsed;
      return;
    }
    if (k.phase === 'flight') {
      const g = this.players[k.keeperId];
      if (g.penaltyDive?.until > this.elapsed)
        g.aim(W - 0.25, g.penaltyDive.y, 'save', 'Diving for the penalty');
      if (b.owner === null) {
        b.age += dt;
        this.moveBall(dt);
      }
      const outcome = this.kickOutcome();
      if (outcome) this.recordKick(outcome);
      return;
    }
    k.timer -= dt;
    if (k.timer > 0) return;
    if (this.shootout.winner !== null) this.endShootout();
    else this.nextKick();
  }
  // Has the current kick been decided? A parry that still crosses the line
  // counts; nobody may follow up a rebound.
  kickOutcome() {
    const b = this.ball,
      k = this.shootoutState.kick,
      saved = b.shotRecord?.status === 'saved' || b.owner === k.keeperId;
    if (b.owner === k.keeperId) return 'saved';
    if (b.x > W) {
      let crossY = b.y,
        crossZ = b.z;
      if (b.previous && b.previous.x <= W) {
        const f = (W - b.previous.x) / (b.x - b.previous.x || 1);
        crossY = lerp(b.previous.y, b.y, f);
        crossZ = lerp(b.previous.z, b.z, f);
      }
      const post =
        (Math.abs(Math.abs(crossY - 34) - GOAL / 2) < 0.16 && crossZ < 2.6) ||
        (Math.abs(crossZ - 2.44) < 0.13 && Math.abs(crossY - 34) < GOAL / 2 + 0.1);
      if (post && !k.hitPost) {
        k.hitPost = true;
        b.x = W - 0.2;
        b.y = crossY;
        b.z = crossZ;
        b.vx *= -0.55;
        b.vy += this.noise() * 2;
        b.kind = 'loose';
        b.previous = null;
        return null;
      }
      if (Math.abs(crossY - 34) < GOAL / 2 && crossZ < 2.44) return 'goal';
      return saved ? 'saved' : k.hitPost ? 'post' : 'missed';
    }
    const elapsed = this.elapsed - k.kickedAt,
      stopped = b.z < 0.05 && hypot(b.vx, b.vy) < 0.8 && elapsed > 0.5;
    if (b.y < 0 || b.y > H || b.x < W - 25 || stopped || elapsed > FLIGHT_LIMIT)
      return saved ? 'saved' : k.hitPost ? 'post' : 'missed';
    return null;
  }
  recordKick(outcome) {
    const sh = this.shootout,
      s = this.shootoutState,
      k = s.kick,
      team = k.team,
      kicker = this.players[k.kickerId],
      keeper = this.players[k.keeperId];
    const scored = outcome === 'goal';
    s.taken[team]++;
    if (scored) sh.score[team]++;
    const round = Math.ceil((sh.kicks.length + 1) / 2),
      suddenDeath = round > 5;
    sh.kicks.push({
      team,
      playerId: kicker.id,
      keeperId: keeper.id,
      round,
      outcome,
      scored,
      suddenDeath,
    });
    // Decided when one side cannot catch up within five kicks each, or after
    // a complete sudden-death round with different results.
    const [a, c] = sh.score,
      [ta, tc] = s.taken,
      left = [Math.max(0, 5 - ta), Math.max(0, 5 - tc)];
    let winner = null;
    if (ta <= 5 && tc <= 5) {
      if (a > c + left[1]) winner = 0;
      else if (c > a + left[0]) winner = 1;
    } else if (ta === tc && a !== c) winner = a > c ? 0 : 1;
    const verb =
      outcome === 'goal'
        ? 'scores'
        : outcome === 'saved'
          ? `is denied by ${keeper.name.split(' ').pop()}`
          : outcome === 'post'
            ? 'hits the woodwork'
            : 'misses';
    this.addEvent(
      `${kicker.name.split(' ').pop()} ${verb} · ${sh.score[0]}–${sh.score[1]} on penalties`,
      team,
      'shootout',
      {
        playerId: kicker.id,
        keeperId: keeper.id,
        round,
        suddenDeath,
        outcome,
        shootoutScore: [...sh.score],
        decisive: winner !== null,
        kickedAt: k.kickedAt,
        strength: winner !== null ? 1 : 0.7,
      },
    );
    this.effect('whistle', { x: W - 3, y: 34, team }, 1, {
      label: scored ? 'SCORED' : outcome === 'saved' ? 'SAVED' : 'MISSED',
      strength: winner !== null ? 1 : 0.5,
    });
    k.phase = 'pause';
    k.outcome = outcome;
    k.timer = winner === null ? PAUSE : CELEBRATE;
    if (winner !== null) sh.winner = winner;
  }
  // After the decisive kick has been shown.
  endShootout() {
    const sh = this.shootout,
      winner = sh.winner,
      [a, c] = sh.score;
    this.penaltyEnd = null;
    this.shootoutState.kick = null;
    this.finished = true;
    this.mode = 'fulltime';
    this.phase = 'Full time';
    for (const p of this.activePlayers) p.vx = p.vy = 0;
    this.addEvent(
      `${this.teams[winner].name} win ${Math.max(a, c)}–${Math.min(a, c)} on penalties.`,
      winner,
      'shootout-end',
      { winner, shootoutScore: [...sh.score] },
    );
  }
}
