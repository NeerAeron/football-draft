import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../app/core/sim/engine.js';
import {
  selectHighlights,
  simulateComplete,
  applyReplayFrame,
  performanceRating,
} from '../app/core/sim/replay.js';

test('highlights keep every goal, run chronologically, and total exactly one minute', () => {
  for (const goalCount of [0, 4, 12]) {
    const events = Array.from({ length: goalCount }, (_, i) => ({
      type: 'goal',
      elapsed: 12 + i * 22,
    }));
    events.push(
      ...Array.from({ length: 20 }, (_, i) => ({ type: 'shot', elapsed: 5 + i * 13, level: 2 })),
    );
    const clips = selectHighlights(events, 300, 60);
    assert.ok(Math.abs(clips.reduce((n, c) => n + c.end - c.start, 0) - 60) < 0.01);
    for (const g of events.filter(e => e.type === 'goal'))
      assert.ok(clips.some(c => g.elapsed >= c.start && g.elapsed <= c.end));
    for (let i = 1; i < clips.length; i++) assert.ok(clips[i].start >= clips[i - 1].end);
  }
});

test('AI recorded, instant, and direct full simulations resolve the same match', async () => {
  const config = new Match(54).exportConfig();
  config.competition = { mode: 'ai', difficulty: 'hard' };
  const record = await simulateComplete(config, 54, true);
  const instant = await simulateComplete(config, 54, false);
  const direct = new Match(54, 300);
  direct.importConfig(config);
  while (!direct.finished) direct.step(1 / 60);
  assert.deepEqual(record.result.score, direct.score);
  assert.deepEqual(instant.result.stats, direct.stats);
  assert.deepEqual(record.result.goalHistory, direct.goalHistory);
  assert.equal(instant.frames.length, 0);
  const target = new Match(54, 300);
  target.importConfig(config);
  applyReplayFrame(target, record, 10);
  assert.ok(target.elapsed >= 0 && target.elapsed <= record.result.elapsed);
  assert.ok(target.events.every(e => e.elapsed <= target.elapsed));
  assert.equal(target.finished, false);
  for (const p of direct.players) assert.ok(Number.isFinite(performanceRating(p, direct)));
});

test('recording can be cancelled without returning a stale result', async () => {
  const result = await simulateComplete(
    new Match(1).exportConfig(),
    1,
    true,
    () => {},
    () => true,
  );
  assert.equal(result, null);
});

test('sparse highlights extend contiguous buildup without tiny filler clips', () => {
  const clips = selectHighlights(
    [0.1, 149.98, 299.99].map(elapsed => ({ type: 'goal', elapsed })),
    300,
    60,
  );
  assert.ok(clips.length <= 3);
  assert.ok(clips.every(c => c.end - c.start > 1));
});

test('replay does not sweep players across a restart teleport', () => {
  const target = new Match(1, 300),
    a = new Float32Array(22 * 9),
    b = new Float32Array(22 * 9);
  a[0] = 95;
  a[1] = 30;
  b[0] = 15;
  b[1] = 40;
  const base = {
    elapsed: 0,
    half: 1,
    score: [0, 0],
    stats: target.stats,
    states: target.players.map(p => ({ action: p.action, intent: p.intent, animation: null })),
    ball: target.ball,
    effects: [],
    mode: 'play',
    phase: 'Build-up',
    restart: target.restart,
  };
  const recording = {
    clips: [{ start: 0, end: 60, offset: 0 }],
    frames: [
      { ...base, positions: a },
      { ...base, elapsed: 0.05, positions: b },
    ],
    result: { events: [] },
  };
  applyReplayFrame(target, recording, 0.025);
  assert.equal(target.players[0].x, 95);
  assert.equal(target.players[0].y, 30);
});
