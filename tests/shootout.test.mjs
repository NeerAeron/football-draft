import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../app/core/sim/engine.js';
import { matchClock } from '../app/core/sim/periods.js';
import { simulateComplete, applyReplayFrame, selectHighlights } from '../app/core/sim/replay.js';

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
  for (let i = 0; i < 60 * 120 && !m.finished; i++) m.step(1 / 60);
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

test('optional extra time: two short halves, then penalties if still level', () => {
  const m = levelAtFullTime(34, { extraTime: true });
  m.finishPeriod();
  assert.equal(m.half, 3);
  assert.equal(m.time, 5400);
  assert.equal(m.mode, 'restart');
  assert.equal(m.restart.type, 'Extra time');
  assert.equal(m.direction(0), 1);
  const length = m.periodDeadline() - m.periodStart;
  assert.ok(Math.abs(length - 180 / 6 - (m.addedMinutes[2] * 180) / 90) < 1e-9);
  for (let i = 0; i < 120; i++) m.step(1 / 60);
  assert.ok(m.time > 5400 && m.time < 6300);
  assert.equal(matchClock(6330, 3), '105+00:30');
  assert.ok(m.events.some(e => e.type === 'extra-time' && e.period === 1));
  m.finishPeriod();
  assert.equal(m.half, 4);
  assert.equal(m.direction(0), -1);
  m.score = [2, 2];
  runShootout(m);
  assert.equal(m.finished, true);
  assert.ok(m.shootout.winner !== null);
});

test('a non-knockout draw stays a draw', () => {
  const m = levelAtFullTime(35, { knockout: false });
  m.finishPeriod();
  assert.equal(m.finished, true);
  assert.equal(m.shootout, null);
  assert.equal(m.winner(), null);
});

test('highlights show every shootout kick', () => {
  const kicks = Array.from({ length: 12 }, (_, i) => ({
    type: 'shootout',
    kickedAt: 300 + i * 3,
    elapsed: 301 + i * 3,
  }));
  const goals = [50, 120, 200].map(elapsed => ({ type: 'goal', elapsed }));
  const clips = selectHighlights([...goals, ...kicks], 340, 60);
  assert.ok(Math.abs(clips.reduce((s, c) => s + c.end - c.start, 0) - 60) < 0.01);
  for (const e of [...goals, ...kicks])
    assert.ok(clips.some(c => e.elapsed >= c.start && e.elapsed <= c.end));
});

test('shootout survives recording: instant result and replay frames agree', async () => {
  const config = new Match(3, 300).exportConfig();
  config.competition = { mode: 'sandbox', knockout: true };
  const record = await simulateComplete(config, 1, true);
  const direct = new Match(1, 300);
  direct.importConfig(config);
  while (!direct.finished) direct.step(1 / 60);
  assert.ok(direct.shootout, 'seed 1 is level after 90 minutes');
  assert.deepEqual(record.result.shootout, direct.shootout);
  const target = new Match(1, 300);
  target.importConfig(config);
  const total = record.clips.reduce((s, c) => s + c.end - c.start, 0);
  applyReplayFrame(target, record, total - 0.05);
  assert.ok(target.shootout);
  assert.equal(target.shootout.kicks.length, direct.shootout.kicks.length);
  assert.equal(target.shootout.winner, direct.shootout.winner);
});
