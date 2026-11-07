import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../app/engine.js';

function reception({
  team = 0,
  half = 1,
  skill = 75,
  pace = 78,
  energy = 1,
  momentum = 0,
  seed = 173,
} = {}) {
  const m = new Match(seed, 300);
  m.mode = 'play';
  m.elapsed = 10;
  m.half = half;
  const dir = m.direction(team);
  for (const p of m.players)
    Object.assign(p, {
      x: m.abs(p.team === team ? 5 : 90, team),
      y: 4 + p.slot * 5.5,
      vx: 0,
      vy: 0,
      tags: [],
      energy: 1,
      sprint: 1,
      sprintRest: 0,
    });
  const a = m.players[(1 - team) * 11 + 9],
    d = m.players[team * 11 + 2];
  Object.assign(a, { x: m.abs(58, team), y: 34, facing: dir > 0 ? Math.PI : 0 });
  Object.assign(a.attrs, { pace: 78, acceleration: 78, dribbling: 78 });
  Object.assign(d, { x: m.abs(53, team), y: 31, vx: dir * momentum, vy: 1, energy });
  Object.assign(d.attrs, {
    pace,
    acceleration: 78,
    awareness: skill,
    defending: skill,
    vision: skill,
    composure: skill,
  });
  m.own(a);
  a.facing = dir > 0 ? Math.PI : 0;
  m.ball.x = a.x;
  m.ball.y = a.y;
  return { m, a, d, dir, team };
}

function follow(options = {}, lateral = 0, tackle = false) {
  const scene = reception(options),
    { m, a, d, dir, team } = scene;
  let minimumGap = 100,
    reachFrames = 0,
    attempts = 0;
  for (let i = 0; i < 180; i++) {
    if (i % 6 === 0) {
      const defense = m.assignDefense(team, a);
      d.aim(defense.point.x, defense.point.y, 'press', 'Closing the runner');
    }
    a.aim(
      i >= 12 ? a.x - dir * 20 : a.x,
      i >= 12 ? a.y + lateral : a.y,
      'carry',
      'Driving into space',
    );
    const velocity = { x: d.vx, y: d.vy },
      acceleration = (d.acceleration() * (0.72 + d.energy * 0.28)) / 60,
      speed = d.topSpeed();
    m.move(a, 1 / 60);
    m.move(d, 1 / 60);
    m.elapsed += 1 / 60;
    a.hold += 1 / 60;
    assert.ok(
      Math.hypot(d.vx - velocity.x, d.vy - velocity.y) <= acceleration + 1e-9,
      'tracking respects acceleration',
    );
    assert.ok(Math.hypot(d.vx, d.vy) <= speed + 0.01, 'tracking respects physical speed');
    Object.assign(m.ball, { x: a.x - dir * 0.65, y: a.y, vx: a.vx, vy: a.vy });
    minimumGap = Math.min(minimumGap, (a.x - d.x) * dir);
    if (Math.hypot(d.x - m.ball.x, d.y - m.ball.y) < 1.15 + d.skill('defending') * 0.006)
      reachFrames++;
    if (tackle) {
      m.duel(a, d);
      attempts = m.duelHistory.length;
      if (m.ball.owner !== a.id || m.mode !== 'play') break;
    }
  }
  return { ...scene, minimumGap, reachFrames, attempts };
}

test('a set defender anticipates a first touch and backs up goal-side through straight and diagonal runs', () => {
  for (const team of [0, 1])
    for (const half of [1, 2])
      for (const lateral of [-3, 0, 3]) {
        const result = follow({ team, half }, lateral);
        assert.ok(
          result.minimumGap > 0,
          'a normal acceleration cannot automatically leave a prepared marker behind',
        );
        assert.ok(result.reachFrames > 0, 'containing still leaves physical tackle opportunities');
        assert.ok(result.d.vx * result.dir < 0, 'the defender runs back with the attacker');
      }
});

test('reading quality improves tracking while fatigue, pace and overcommitting can still lose the duel', () => {
  const low = follow({ skill: 65 }),
    high = follow({ skill: 85 });
  assert.ok(high.minimumGap > low.minimumGap + 0.2);
  assert.ok(follow({ skill: 85, energy: 0.12 }).minimumGap < 0);
  assert.ok(follow({ skill: 85, pace: 48 }).minimumGap < 0);
  assert.ok(
    follow({ skill: 85, momentum: 5 }).minimumGap < 0,
    'a defender already lunging forward cannot turn instantly',
  );
});

test('first-touch anticipation uses observable facing and velocity, not a chosen future target', () => {
  const { m, a, d } = reception();
  const motion = m.carrierMotion(d, a);
  assert.ok(motion.vx < a.vx);
  a.tx = 90;
  a.ty = 3;
  assert.deepEqual(m.carrierMotion(d, a), motion);
  a.facing = 0;
  assert.deepEqual(
    m.carrierMotion(d, a),
    { vx: a.vx, vy: a.vy },
    'a backward-facing receiver is not assumed to sprint at goal',
  );
  a.facing = Math.PI;
  m.elapsed += 0.7;
  assert.deepEqual(
    m.carrierMotion(d, a),
    { vx: a.vx, vy: a.vy },
    'the launch estimate expires quickly',
  );
});

test('jockeying can produce ordinary tackle attempts and wins without granting possession', () => {
  let attempts = 0,
    wins = 0;
  for (const seed of [171, 173, 179, 181, 191, 193]) {
    const result = follow({ seed, skill: 85 }, 0, true);
    attempts += result.attempts;
    if (result.m.pendingTackle?.id === result.d.id) {
      wins++;
      assert.equal(result.m.ball.owner, null, 'a successful tackle still leaves a ball to collect');
    }
  }
  assert.ok(attempts > 0);
  assert.ok(wins > 0);
});
