import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../app/engine.js';
import { commonName, receiptLabel } from '../app/player-labels.js';
import { snapshot, applyReplayFrame } from '../app/replay.js';

test('receipt names preserve football names, appear on control, fade and reset on the next receipt', () => {
  for (const [name, expected] of [
    ['E. Haaland', 'Haaland'],
    ['V. van Dijk', 'van Dijk'],
    ['A. Mac Allister', 'Mac Allister'],
    ['Rodri', 'Rodri'],
    ['Vinícius Jr.', 'Vinícius Jr.'],
    ['Bruno Fernandes', 'Bruno Fernandes'],
  ])
    assert.equal(commonName({ name }), expected);
  const m = new Match(3),
    p = m.players[9];
  assert.equal(receiptLabel(p, 0), null);
  m.elapsed = 10;
  m.own(p);
  const rng = m.rng,
    initial = receiptLabel(p, 10);
  assert.ok(initial.opacity > 0.7);
  assert.equal(receiptLabel(p, 10.5).opacity, initial.opacity);
  assert.ok(Math.abs(receiptLabel(p, 10.875).opacity - initial.opacity / 2) < 1e-9);
  assert.ok(receiptLabel(p, 11.24).opacity < 0.001);
  assert.equal(receiptLabel(p, 11.25), null);
  for (let tick = 31; tick < 75; tick++)
    assert.ok(
      receiptLabel(p, 10 + tick / 60).opacity < receiptLabel(p, 10 + (tick - 1) / 60).opacity,
    );
  assert.equal(m.rng, rng);
  m.elapsed = 14;
  m.own(p);
  assert.equal(receiptLabel(p, 14).opacity, initial.opacity);
  m.reset();
  assert.equal(receiptLabel(p, 0), null);
});
test('replay restores receipt times when seeking through highlights', () => {
  const m = new Match(5),
    p = m.players[9];
  m.elapsed = 10;
  m.own(p);
  const a = snapshot(m);
  m.elapsed = 14;
  const b = snapshot(m);
  m.elapsed = 20;
  m.own(p);
  const c = snapshot(m);
  const recording = {
      frames: [a, b, c],
      clips: [{ start: 10, end: 21, offset: 0 }],
      result: { events: [] },
    },
    target = new Match(5);
  applyReplayFrame(target, recording, 0);
  assert.ok(receiptLabel(target.players[9], target.elapsed));
  applyReplayFrame(target, recording, 5);
  assert.equal(receiptLabel(target.players[9], target.elapsed), null);
  applyReplayFrame(target, recording, 10);
  assert.ok(receiptLabel(target.players[9], target.elapsed));
  applyReplayFrame(target, recording, 0);
  assert.equal(target.players[9].possessionAt, 10);
});
test('an average fresh player crosses the usable pitch in 12–13 seconds with finite sprint reserve', () => {
  const times = [];
  for (const duration of [180, 300]) {
    const m = new Match(1, duration),
      p = m.players[9];
    m.players = [p];
    m.mode = 'play';
    m.ball.owner = null;
    Object.assign(p, { x: 0.5, y: 34, vx: 0, vy: 0, tx: 104.5, ty: 34, intent: 'run', tags: [] });
    Object.assign(p.attrs, { pace: 70, acceleration: 70, stamina: 70 });
    let time = 0;
    while (p.x < 103.5 && time < 25) {
      p.energy = 1;
      m.move(p, 1 / 60);
      time += 1 / 60;
    }
    assert.ok(time >= 12 && time <= 13, `Crossing took ${time}s`);
    assert.ok(p.sprint < 0.3);
    times.push(time);
  }
  assert.equal(times[0], times[1]);
});
