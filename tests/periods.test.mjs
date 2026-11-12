import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../app/core/sim/engine.js';
import { stoppageMinutes, matchClock } from '../app/core/sim/periods.js';
import { simulateHalf, applyReplayFrame } from '../app/core/sim/replay.js';

test('seeded added time varies around a bell curve without consuming match randomness', () => {
  // Means of 1.5 and 2 minutes (the whistle is held for attacks instead, whistle.test.mjs),
  // never under the minimum of one: 1.6 and 2.1 once rounded and clamped.
  const samples = Array.from({ length: 4000 }, (_, i) => stoppageMinutes(i));
  for (const half of [0, 1]) {
    const values = samples.map(s => s[half]),
      mean = values.reduce((a, b) => a + b, 0) / values.length;
    assert.ok(Math.abs(mean - (half ? 2.08 : 1.61)) < 0.1, `mean ${mean}`);
    assert.ok(values.every(n => Number.isInteger(n) && n >= 1 && n <= (half ? 6 : 5)));
    assert.ok(
      values.filter(n => n === (half ? 2 : 1)).length >
        values.filter(n => n === (half ? 4 : 3)).length * 2,
    );
  }
  assert.deepEqual(stoppageMinutes(912), stoppageMinutes(912));
  assert.equal(matchClock(2820, 1), '45+02:00');
  assert.equal(matchClock(2700, 2), '45:00');
  assert.equal(matchClock(5580, 2), '90+03:00');
});

test('halftime freezes the simulation, recovers about fifteen points once, and resumes with edited tactics', () => {
  const m = new Match(44, 300);
  m.pauseAtHalf = true;
  m.mode = 'play';
  m.elapsed = m.periodDeadline() - 0.01;
  for (const p of m.players) {
    p.energy = 0.5;
    p.sprint = 0.1;
    p.runs = 4;
    p.finishTarget = { x: 103, y: 34 };
    p.finishUntil = 999;
    p.comboRun = { x: 98, y: 34, until: 999 };
  }
  m.step(1 / 60);
  assert.equal(m.mode, 'halftime');
  assert.equal(m.half, 1);
  const outfield = m.players.filter(p => p.role !== 'GK');
  assert.ok(Math.abs(outfield.reduce((s, p) => s + p.energy, 0) / 20 - 0.65) < 1e-9);
  assert.ok(new Set(outfield.map(p => p.energy)).size > 1);
  const frozen = structuredClone(m);
  for (let i = 0; i < 100; i++) m.step(1 / 60);
  assert.deepEqual(structuredClone(m), frozen);
  m.setTactic(0, 'tempo', 5);
  m.setTactic(1, 'formation', '442');
  assert.equal(m.resumeHalf(), true);
  assert.equal(m.resumeHalf(), false);
  assert.equal(m.time, 2700);
  assert.equal(m.half, 2);
  assert.equal(m.teams[0].tactics.tempo, 5);
  assert.equal(m.teams[1].tactics.formation, '442');
  for (const p of m.players) {
    assert.equal(p.finishTarget, null);
    assert.equal(p.comboRun, null);
    assert.equal(p.sprint, 1);
    assert.equal(p.runs, 0);
  }
  assert.deepEqual(
    m.players.map(p => p.energy),
    frozen.players.map(p => p.energy),
  );
});

test('goal kicks and corners allow physical repositioning before the ball returns to play', () => {
  for (const type of ['Goal kick', 'Corner', 'Throw-in']) {
    const m = new Match(12),
      p = m.players[2];
    p.x = 65;
    p.y = 20;
    m.startRestart(type, 0, type === 'Corner' ? 104.7 : 5.5, type === 'Goal kick' ? 34 : 0.3);
    const old = { x: p.x, y: p.y },
      target = { x: p.tx, y: p.ty },
      timer = m.restart.timer;
    assert.ok(timer >= 1);
    assert.deepEqual({ x: p.x, y: p.y }, old, 'outfield players are not teleported on the whistle');
    assert.ok(m.rel(m.players[11].tx, 1) < 15, 'opposing keeper stays near own goal');
    for (let i = 0; i < 30; i++) m.step(1 / 60);
    assert.equal(m.mode, 'restart');
    assert.ok(Math.hypot(p.x - old.x, p.y - old.y) > 0.2);
    assert.ok(
      Math.hypot(p.x - target.x, p.y - target.y) < Math.hypot(old.x - target.x, old.y - target.y),
    );
  }
});

test('the whistle lets a final shot and goal celebration settle', () => {
  const m = new Match(12);
  m.half = 2;
  m.periodStart = 150;
  m.elapsed = m.periodDeadline() - 0.01;
  m.mode = 'play';
  const p = m.players[9];
  p.x = m.abs(94, 0);
  p.y = 34;
  m.shoot(p);
  m.step(1 / 60);
  assert.equal(m.finished, false);
  m.startRestart('Goal', 1, 52.5, 34, 2.5);
  for (let i = 0; i < 60; i++) m.step(1 / 60);
  assert.equal(m.finished, false);
  for (let i = 0; i < 240 && !m.finished; i++) m.step(1 / 60);
  assert.ok(m.finished);
  assert.equal(m.mode, 'fulltime');
});

test('two AI highlight halves preserve authoritative state and include halftime tactics edits', async () => {
  const source = new Match(321, 300);
  source.competition = { mode: 'ai', difficulty: 'hard' };
  const initial = source.exportConfig();
  source.pauseAtHalf = true;
  const first = await simulateHalf(source);
  assert.equal(source.elapsed, 0);
  assert.equal(first.result.mode, 'halftime');
  assert.equal(first.result.finished, false);
  const direct = new Match(321, 300);
  direct.importConfig(initial);
  direct.pauseAtHalf = true;
  while (direct.mode !== 'halftime') direct.step(1 / 60);
  assert.deepEqual(first.result.stats, direct.stats);
  assert.deepEqual(first.result.score, direct.score);
  first.result.setTactic(0, 'tempo', 5);
  first.result.setTactic(0, 'style', 'counter');
  direct.setTactic(0, 'tempo', 5);
  direct.setTactic(0, 'style', 'counter');
  for (const m of [first.result, direct]) {
    assert.ok(m.swapLineup(6, 9));
    m.setTactic(0, 'formation', '442');
    assert.equal(m.teams[0].tactics.formation, '442');
  }
  const second = await simulateHalf(first.result);
  direct.resumeHalf();
  while (!direct.finished) direct.step(1 / 60);
  assert.deepEqual(second.result.stats, direct.stats);
  assert.deepEqual(second.result.goalHistory, direct.goalHistory);
  assert.deepEqual(
    second.result.players.map(p => p.energy),
    direct.players.map(p => p.energy),
  );
  assert.deepEqual(
    second.result.players.map(p => [p.id, p.slot, p.role]),
    direct.players.map(p => [p.id, p.slot, p.role]),
  );
  assert.equal(second.result.players[6].slot, 9);
  assert.equal(second.result.teams[0].tactics.formation, '442');
  assert.equal(second.frames[0].time, 2700);
  assert.equal(second.viewOffset, 30);
  for (const segment of [first, second]) {
    assert.ok(Math.abs(segment.clips.reduce((s, c) => s + c.end - c.start, 0) - 30) < 1e-7);
    const half = segment === first ? 1 : 2;
    for (const goal of segment.result.goalHistory.filter(g => g.half === half))
      assert.ok(segment.clips.some(c => goal.elapsed >= c.start && goal.elapsed <= c.end));
    const view = new Match(321, 300);
    applyReplayFrame(view, segment, 29.9);
    assert.ok(Number.isFinite(view.time));
    assert.equal(view.half, half);
  }
});
