import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../app/core/sim/engine.js';
import { simulateHalf, applyReplayFrame } from '../app/core/sim/replay.js';
import { runSimJob, hydrateMatch, trimFrames, transferables } from '../app/services/sim-worker.js';
import { createSimClient } from '../app/services/sim-client.js';

// postMessage is a structured clone: emulate the worker round trip in-process.
const viaWorker = async job => {
  const out = await runSimJob(structuredClone(job));
  if (!out) return null;
  const back = structuredClone(out);
  return { ...back, result: hydrateMatch(back.result) };
};

const fingerprint = m => ({
  elapsed: m.elapsed,
  score: [...m.score],
  mode: m.mode,
  events: m.events.map(e => `${e.id}:${e.type}:${e.elapsed.toFixed(4)}`),
  positions: m.players.map(p => [p.x, p.y, p.energy]),
  ball: [m.ball.x, m.ball.y, m.ball.z, m.ball.owner],
  stats: m.stats,
});

// A match a few seconds before half-time (cheap: the 180 s profile), simulated once.
let base = null;
function nearHalfTime() {
  if (!base) {
    base = new Match(11, 180);
    base.pauseAtHalf = true;
    while (base.elapsed < base.periodDeadline() - 3) base.step(1 / 60);
  }
  return hydrateMatch(structuredClone(base));
}

test('a structured-cloned, hydrated match continues exactly like the original', () => {
  const a = new Match(5, 180);
  for (let i = 0; i < 900; i++) a.step(1 / 60);
  const b = hydrateMatch(structuredClone(a));
  assert.ok(b instanceof Match);
  assert.equal(b.players[3].skill('pace'), a.players[3].skill('pace'));
  for (let i = 0; i < 900; i++) {
    a.step(1 / 60);
    b.step(1 / 60);
  }
  assert.deepEqual(fingerprint(b), fingerprint(a));
});

test('a Key Moments half through the worker protocol equals simulateHalf in-thread', async () => {
  const source = nearHalfTime();
  const direct = await simulateHalf(source);
  const remote = await viaWorker({ type: 'half', match: source });
  assert.equal(remote.result.mode, 'halftime');
  assert.deepEqual(fingerprint(remote.result), fingerprint(direct.result));
  assert.deepEqual(remote.clips, direct.clips);
  assert.equal(remote.viewDuration, 30);
  // The second half starts from the returned (hydrated) match like from the original.
  for (const m of [remote.result, direct.result]) {
    m.resumeHalf();
    for (let i = 0; i < 300; i++) m.step(1 / 60);
  }
  assert.deepEqual(fingerprint(remote.result), fingerprint(direct.result));
});

test('trimmed frames replay identically inside every clip', async () => {
  const { frames, result } = await simulateHalf(nearHalfTime());
  const t0 = frames[0].elapsed;
  const clips = [
    { start: t0 + 0.7, end: t0 + 0.9, offset: 0 },
    { start: t0 + 2.4, end: t0 + 2.5, offset: 0.2 },
  ];
  const trimmed = trimFrames(frames, clips);
  assert.ok(trimmed.length < frames.length - 10);
  const a = new Match(11, 180),
    b = new Match(11, 180);
  for (let t = 0; t <= 0.3; t += 0.013) {
    applyReplayFrame(a, { frames, clips, result }, t);
    applyReplayFrame(b, { frames: trimmed, clips, result }, t);
    assert.deepEqual(
      b.players.map(p => [p.x, p.y]),
      a.players.map(p => [p.x, p.y]),
    );
    assert.deepEqual(b.ball, a.ball);
    assert.deepEqual(b.ballTrail, a.ballTrail);
  }
  assert.ok(transferables({ frames: trimmed }).every(x => x instanceof ArrayBuffer));
});

test('the client falls back to the main thread and can cancel', async () => {
  const sim = createSimClient({ useWorker: false });
  assert.equal(sim.usingWorker, false);
  const source = nearHalfTime();
  const progress = [];
  const job = sim.half(source, { onProgress: p => progress.push(p) });
  const out = await job.promise;
  const direct = await simulateHalf(source);
  assert.deepEqual(fingerprint(out.result), fingerprint(direct.result));
  assert.ok(progress.length > 0);
  const cancelled = sim.complete(new Match(1, 180).exportConfig(), 1);
  cancelled.cancel();
  assert.equal(await cancelled.promise, null);
  await assert.rejects(runSimJob({ type: 'nope' }), /Unknown simulation job/);
  sim.dispose();
});
