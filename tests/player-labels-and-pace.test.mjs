import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../app/core/sim/engine.js';
import { commonName } from '../app/core/players/player-labels.js';
import { snapshot, applyReplayFrame } from '../app/core/sim/replay.js';

test('common names preserve football names', () => {
  for (const [name, expected] of [
    ['E. Haaland', 'Haaland'],
    ['V. van Dijk', 'van Dijk'],
    ['A. Mac Allister', 'Mac Allister'],
    ['Rodri', 'Rodri'],
    ['Vinícius Jr.', 'Vinícius Jr.'],
    ['Bruno Fernandes', 'Bruno Fernandes'],
  ])
    assert.equal(commonName({ name }), expected);
});
test('receiving stamps the possession time without RNG; reset and replay restore it', () => {
  const m = new Match(3),
    p = m.players[9];
  assert.equal(p.possessionAt, -10);
  m.elapsed = 10;
  const rng = m.rng;
  m.own(p);
  assert.equal(p.possessionAt, 10);
  assert.equal(m.rng, rng);
  m.elapsed = 14;
  m.own(p);
  assert.equal(p.possessionAt, 14);
  m.reset();
  assert.equal(p.possessionAt, -10);
  const r = new Match(5),
    q = r.players[9];
  r.elapsed = 10;
  r.own(q);
  const a = snapshot(r);
  r.elapsed = 14;
  const b = snapshot(r);
  r.elapsed = 20;
  r.own(q);
  const c = snapshot(r);
  const recording = {
      frames: [a, b, c],
      clips: [{ start: 10, end: 21, offset: 0 }],
      result: { events: [] },
    },
    target = new Match(5);
  for (const [t, at] of [
    [0, 10],
    [5, 10],
    [10, 20],
    [0, 10],
  ]) {
    applyReplayFrame(target, recording, t);
    assert.equal(target.players[9].possessionAt, at);
  }
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
