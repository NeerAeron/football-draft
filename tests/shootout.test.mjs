import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../app/core/sim/engine.js';
import { matchClock } from '../app/core/sim/periods.js';
import {
  applyReplayFrame,
  selectHighlights,
  simulateHalf,
  EXTRA_TIME_REEL,
} from '../app/core/sim/replay.js';
import { gameStateMentality } from '../app/core/sim/coach.js';

// A knockout match that has just reached the end of regulation, level.
function levelAtFullTime(seed, competition = {}) {
  const m = new Match(seed, 180),
    c = m.exportConfig();
  c.competition = { mode: 'sandbox', knockout: true, ...competition };
  m.importConfig(c);
  m.half = 2;
  m.time = 5400;
  m.score = [1, 1];
  m.mode = 'play';
  return m;
}
function runShootout(m) {
  m.finishPeriod();
  for (let i = 0; i < 60 * 400 && !m.finished; i++) m.step(1 / 60);
  return m;
}

test('a level knockout match is decided by a deterministic penalty shootout', () => {
  const m = runShootout(levelAtFullTime(31)),
    again = runShootout(levelAtFullTime(31));
  const { shootout } = m;
  assert.equal(m.finished, true);
  assert.equal(m.mode, 'fulltime');
  assert.deepEqual(m.score, [1, 1]);
  assert.ok([0, 1].includes(shootout.winner));
  assert.equal(m.winner(), shootout.winner);
  assert.deepEqual(again.shootout, shootout);
  // Alternating kicks, both sides take the same number unless decided early.
  shootout.kicks.forEach((k, i) =>
    assert.equal(k.team, i % 2 === 0 ? shootout.first : 1 - shootout.first),
  );
  const scored = [0, 1].map(t => shootout.kicks.filter(k => k.team === t && k.scored).length);
  assert.deepEqual(shootout.score, scored);
  assert.ok(shootout.score[shootout.winner] > shootout.score[1 - shootout.winner]);
  assert.ok(shootout.kicks.length >= 6);
  const events = [...m.events].reverse();
  assert.equal(events.filter(e => e.type === 'shootout').length, shootout.kicks.length);
  assert.equal(events.filter(e => e.type === 'shootout-start').length, 1);
  const end = events.find(e => e.type === 'shootout-end');
  assert.equal(end.winner, shootout.winner);
  assert.ok(events.find(e => e.type === 'full').shootout);
  assert.ok(events.filter(e => e.type === 'shootout').at(-1).decisive);
  // Kicks are not match shots.
  assert.equal(m.stats[0].shots + m.stats[1].shots, 0);
  assert.equal(events.filter(e => e.type === 'shot').length, 0);
});

test('shootout rules: an unreachable lead ends it early; sudden death after five each', () => {
  const play = outcomes => {
    const m = levelAtFullTime(32);
    m.finishPeriod();
    for (const o of outcomes) {
      assert.equal(m.shootout.winner, null);
      m.recordKick(o);
      if (m.shootout.winner === null) m.nextKick();
    }
    return m.shootout;
  };
  // First side scores three, second misses three: decided after six kicks.
  const early = play(['goal', 'saved', 'goal', 'missed', 'goal', 'saved']);
  assert.equal(early.winner, early.first);
  assert.equal(early.kicks.length, 6);
  // 5-5, then the first side misses and the second scores.
  const sudden = play([...Array(10).fill('goal'), 'saved', 'goal']);
  assert.equal(sudden.winner, 1 - sudden.first);
  assert.equal(sudden.kicks.at(-1).suddenDeath, true);
  assert.equal(sudden.kicks.at(-1).round, 6);
});

test('shootout takers are ordered by penalties and composure, keeper last', () => {
  const m = levelAtFullTime(33);
  const order = m.shootoutOrder(0).map(id => m.players[id]);
  assert.equal(order.at(-1).role, 'GK');
  const key = p => p.skill('penalties') + p.skill('composure');
  for (let i = 1; i < order.length - 1; i++) assert.ok(key(order[i - 1]) >= key(order[i]));
});

test('extra time: a break at 90 minutes, two short periods, then penalties if still level', () => {
  const m = levelAtFullTime(34, { extraTime: true });
  m.pauseAtHalf = true;
  m.elapsed = m.duration;
  m.periodStart = m.duration / 2;
  m.players[3].sentOff = true;
  m.rebuildActive();
  m.finishPeriod();
  // The break: the match waits like at half-time, and is not over.
  assert.equal(m.mode, 'halftime');
  assert.equal(m.half, 2);
  assert.equal(m.finished, false);
  assert.equal(m.winner(), null);
  assert.equal(m.events[0].type, 'full');
  assert.equal(m.events[0].extraTime, true);
  m.step(1 / 60);
  const frozen = structuredClone(m);
  for (let i = 0; i < 50; i++) m.step(1 / 60);
  assert.deepEqual(structuredClone(m), frozen);
  // A team talk: tactics (and the formation) can change here as at half-time.
  assert.equal(m.lineupFixed(), false);
  assert.equal(m.setTactic(0, 'mentality', 'push'), true);
  for (const p of m.players) p.energy = 0.5;
  assert.equal(m.resumeHalf(), true);
  assert.equal(m.resumeHalf(), false);
  assert.equal(m.half, 3);
  assert.equal(m.time, 5400);
  assert.equal(m.mode, 'restart');
  assert.equal(m.restart.type, 'Extra time');
  assert.equal(m.direction(0), 1);
  assert.equal(m.teams[0].tactics.mentality, 'push');
  // Tired legs get a little back (a third of half-time's), a sending-off stands.
  for (const p of m.activePlayers) assert.ok(Math.abs(p.energy - 0.545) < 1e-9);
  assert.equal(m.activePlayers.length, 21);
  // Each period is a sixth of the match (15 minutes of 90) plus a minute of added time.
  const length = m.periodDeadline() - m.periodStart;
  assert.ok(Math.abs(length - 180 / 6 - (m.addedMinutes[2] * 180) / 90) < 1e-9);
  assert.deepEqual(m.addedMinutes.slice(2), [1, 1]);
  for (let i = 0; i < 120; i++) m.step(1 / 60);
  assert.ok(m.time > 5400 && m.time < 6300);
  assert.equal(matchClock(6330, 3), '105+00:30');
  assert.ok(m.events.some(e => e.type === 'extra-time' && e.period === 1));
  // The second period follows at once: the sides only change ends.
  m.mode = 'play';
  m.finishPeriod();
  assert.equal(m.half, 4);
  assert.equal(m.mode, 'restart');
  assert.equal(m.direction(0), -1);
  assert.ok(m.events.some(e => e.type === 'extra-time' && e.period === 2));
  m.score = [2, 2];
  m.mode = 'play';
  runShootout(m);
  assert.equal(m.finished, true);
  assert.ok(m.shootout.winner !== null);
  const whistle = m.events.find(e => e.type === 'full');
  assert.equal(whistle.shootout, true);
  assert.equal(whistle.afterExtraTime, true);
});

test('a goal in extra time decides it: no shootout, a winner after 120 minutes', () => {
  const m = levelAtFullTime(36, { extraTime: true });
  m.finishPeriod();
  m.step(1 / 60); // not paused: straight into extra time
  assert.equal(m.half, 3);
  m.score = [2, 1];
  m.mode = 'play';
  m.finishPeriod();
  assert.equal(m.half, 4, 'both periods are played whatever the score');
  m.mode = 'play';
  m.finishPeriod();
  assert.equal(m.finished, true);
  assert.equal(m.shootout, null);
  assert.equal(m.winner(), 0);
  assert.equal(m.events[0].type, 'full');
  assert.equal(m.events[0].afterExtraTime, true);
  // Without competition.extraTime a level knockout still goes straight to penalties.
  const direct = levelAtFullTime(36);
  direct.finishPeriod();
  assert.equal(direct.mode, 'shootout');
});

test('extra time is chased and protected: auto mentality and the AI coach read the score', () => {
  const m = levelAtFullTime(38, { extraTime: true, mode: 'ai', difficulty: 'hard' });
  for (const t of [0, 1]) m.setTactic(t, 'mentality', 'auto');
  m.finishPeriod();
  m.step(1 / 60);
  assert.equal(m.half, 3);
  assert.deepEqual([m.mentality(0), m.mentality(1)], ['balanced', 'balanced']);
  // The player's side on auto follows the score at once; the coach's at its next look.
  m.score = [2, 1];
  assert.equal(m.mentality(0), 'hold');
  assert.equal(gameStateMentality(m, 1), 'push');
  m.nextAI = 0;
  m.step(1 / 60);
  assert.equal(m.mentality(1), 'push');
  assert.equal(m.teams[1].tactics.tempo, 5, 'the coach chases the game');
  m.score = [1, 2];
  m.nextAI = 0;
  m.step(1 / 60);
  assert.equal(m.teams[1].tactics.style, 'bus', 'the coach shuts up shop');
  assert.deepEqual([m.mentality(0), m.mentality(1)], ['push', 'hold']);
});

test('extra time is the same match however it is played: stepped, paused, or as a recorded stretch', async () => {
  const start = seed => {
    const m = levelAtFullTime(seed, { extraTime: true, mode: 'ai', difficulty: 'hard' });
    m.elapsed = m.duration - 1;
    m.periodStart = m.duration / 2;
    m.time = 5400 - 30;
    return m;
  };
  for (const seed of [51, 52, 53]) {
    // Stepped straight through (Instant, auto-sims)
    const direct = start(seed);
    while (!direct.finished) direct.step(1 / 60);
    assert.ok(direct.half > 2, 'it went to extra time');
    // Paused at the break (Full)
    const paused = start(seed);
    paused.pauseAtHalf = true;
    let breaks = 0;
    while (!paused.finished) {
      paused.step(1 / 60);
      if (paused.mode === 'halftime') {
        breaks++;
        paused.resumeHalf();
      }
    }
    assert.equal(breaks, 1, 'one break, at 90 minutes; none between the two periods');
    // Two recorded stretches (Key Moments): to the break, then all of extra time
    const source = start(seed);
    source.pauseAtHalf = true;
    const second = await simulateHalf(source);
    assert.equal(second.result.mode, 'halftime');
    assert.equal(second.result.half, 2);
    const extra = await simulateHalf(second.result);
    assert.equal(extra.result.finished, true);
    assert.equal(extra.viewDuration, EXTRA_TIME_REEL);
    assert.equal(extra.viewOffset, 60);
    assert.equal(extra.frames[0].half, 3);
    for (const m of [paused, extra.result]) {
      assert.deepEqual(m.score, direct.score);
      assert.equal(m.elapsed, direct.elapsed);
      assert.deepEqual(m.shootout, direct.shootout);
      assert.equal(m.winner(), direct.winner());
      assert.deepEqual(m.stats, direct.stats);
      assert.deepEqual(
        m.players.map(p => p.energy),
        direct.players.map(p => p.energy),
      );
    }
    assert.ok([0, 1].includes(direct.winner()), 'a knockout match has a winner');
    // The reel covers both periods' goals and never the shootout.
    const end = direct.events.find(e => e.type === 'full' && e.afterExtraTime).elapsed;
    const total = extra.clips.reduce((sum, c) => sum + c.end - c.start, 0);
    assert.ok(Math.abs(total - EXTRA_TIME_REEL) < 1e-6);
    assert.ok(extra.clips.every(c => c.end <= end + 1e-9));
    for (const goal of direct.goalHistory.filter(g => g.half > 2))
      assert.ok(extra.clips.some(c => goal.elapsed >= c.start && goal.elapsed <= c.end));
    // Legs are heavier after 120 minutes than after 90, but nobody is out on his feet.
    const energy = m => {
      const outfield = m.activePlayers.filter(p => p.role !== 'GK');
      return outfield.reduce((sum, p) => sum + p.energy, 0) / outfield.length;
    };
    assert.ok(energy(direct) < energy(second.result));
  }
});

test('a non-knockout draw stays a draw', () => {
  const m = levelAtFullTime(35, { knockout: false });
  m.finishPeriod();
  assert.equal(m.finished, true);
  assert.equal(m.shootout, null);
  assert.equal(m.winner(), null);
});

test('highlights never show the shootout: the reel ends with the final whistle', () => {
  const kicks = Array.from({ length: 12 }, (_, i) => ({
    type: 'shootout',
    kickedAt: 300 + i * 3,
    elapsed: 301 + i * 3,
  }));
  const goals = [50, 120, 200].map(elapsed => ({ type: 'goal', elapsed }));
  const start = { type: 'shootout-start', elapsed: 298 };
  const clips = selectHighlights([...goals, start, ...kicks], 340, 60);
  assert.ok(Math.abs(clips.reduce((s, c) => s + c.end - c.start, 0) - 60) < 0.01);
  for (const e of goals) assert.ok(clips.some(c => e.elapsed >= c.start && e.elapsed <= c.end));
  assert.ok(clips.every(c => c.end <= 298));
});

test('a recorded half stops at the final whistle; the result carries every kick', async () => {
  const m = levelAtFullTime(37);
  m.elapsed = m.duration - 2;
  m.periodStart = m.duration / 2;
  const { result, frames, clips } = await simulateHalf(m);
  assert.equal(result.finished, true);
  assert.ok(result.shootout.winner !== null);
  assert.ok(result.shootout.kicks.length >= 6);
  const whistle = result.events.find(e => e.type === 'shootout-start').elapsed;
  assert.ok(frames.length > 1);
  assert.ok(frames.every(f => f.mode !== 'shootout' && f.elapsed <= whistle));
  assert.ok(clips.length > 0 && clips.every(c => c.end <= whistle));
  // The last picture of the reel is open play, not players lined up for the kicks
  const target = levelAtFullTime(37);
  const total = clips.reduce((s, c) => s + c.end - c.start, 0);
  applyReplayFrame(target, { frames, clips, result }, total);
  assert.notEqual(target.mode, 'shootout');
  assert.equal(target.shootout, null);
});

test('a shootout kick reads like a penalty: set up at once, keeper central, a run-up, a dive', () => {
  const m = levelAtFullTime(41);
  m.finishPeriod();
  const k = m.shootoutState.kick,
    kicker = m.players[k.kickerId],
    keeper = m.players[k.keeperId];
  // Everyone is in place from the first frame: nobody is in the box but the two of them.
  for (const p of m.activePlayers) {
    if (p.id === kicker.id || p.id === keeper.id) continue;
    if (p.role === 'GK')
      assert.ok(p.x > 100 && Math.abs(p.y - 34) > 7, 'waiting keeper beside the goal');
    else assert.ok(Math.abs(p.x - 52.5) < 3, 'both teams on halfway');
  }
  assert.ok(keeper.x > 104 && keeper.y === 34);
  const start = kicker.x;
  assert.ok(start < 91);
  let moved = 0;
  while (m.shootoutState.kick.phase === 'setup') {
    m.step(1 / 60);
    if (m.shootoutState.kick.phase !== 'setup') break;
    assert.ok(Math.abs(keeper.y - 34) < 1e-9, 'on his line, in the middle, until the kick');
    moved = Math.max(moved, kicker.x - start);
  }
  assert.ok(moved > 1, 'he runs at the ball');
  assert.ok(keeper.penaltyDive, 'the keeper commits at the kick');
  const target = keeper.penaltyDive.y;
  while (m.shootout.kicks.length === 0) m.step(1 / 60);
  // He stays where the dive left him while the verdict is shown.
  for (let i = 0; i < 30; i++) m.step(1 / 60);
  assert.equal(m.shootoutState.kick.phase, 'pause');
  assert.ok(Math.abs(keeper.y - target) < 0.6);
  // A scored kick ends in the net, not on the line.
  if (m.shootout.kicks[0].scored) assert.ok(m.ball.x > 105.5);
});
