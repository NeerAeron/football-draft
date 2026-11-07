import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../app/core/sim/engine.js';

// A carrier is still outside the pressing radius, but is running toward two
// goal-side backs. Previously the designated presser dropped toward his own
// box while the covering back stepped up alone.
function approach(half = 1, team = 0, speed = 7, style = 'balanced') {
  const m = new Match(83, 300);
  m.mode = 'play';
  m.elapsed = 10;
  m.half = half;
  m.teams[team].tactics.style = style;
  for (const p of m.players)
    Object.assign(p, {
      x: m.abs(p.team === team ? 90 : 82, team),
      y: 3 + p.slot * 6,
      vx: 0,
      vy: 0,
      rethinkAt: 0,
    });
  const carrier = m.players[(1 - team) * 11 + 9],
    press = m.players[team * 11 + 2],
    cover = m.players[team * 11 + 3];
  Object.assign(carrier, { x: m.abs(56, team), y: 34, vx: -m.direction(team) * speed });
  Object.assign(press, { x: m.abs(31, team), y: 31 });
  Object.assign(cover, { x: m.abs(28, team), y: 38 });
  m.own(carrier);
  m.ball.x = carrier.x;
  m.ball.y = carrier.y;
  return { m, team, carrier, press, cover };
}

test('an approaching carrier draws one back into a diagonal press while the other covers', () => {
  for (const half of [1, 2])
    for (const team of [0, 1]) {
      const { m, carrier, press, cover } = approach(half, team);
      const physical = m.players.map(p => [p.baseSpeed(), p.acceleration(), p.topSpeed(true)]);
      m.plan();
      assert.equal(
        press.intent,
        'press',
        'the assigned presser cannot fall back while cover steps up',
      );
      assert.equal(cover.intent, 'cover');
      assert.ok(
        m.rel(press.tx, team) > m.rel(press.x, team),
        'steps toward the approaching threat',
      );
      assert.ok(press.ty > press.y && cover.ty < cover.y, 'both close the central lane diagonally');
      assert.ok(
        m.rel(cover.tx, team) < m.rel(press.tx, team) - 3,
        'cover stays behind the challenge',
      );
      assert.ok(m.rel(press.tx, team) < m.rel(carrier.x, team), 'the press remains goal-side');
      assert.deepEqual(
        m.players.map(p => [p.baseSpeed(), p.acceleration(), p.topSpeed(true)]),
        physical,
      );
      const initial = m.rel(press.x, team);
      for (let i = 0; i < 45; i++) {
        m.move(press, 1 / 60);
        m.move(cover, 1 / 60);
      }
      assert.ok(
        m.rel(press.x, team) > initial + 1,
        'the actual player closes, not just his action label',
      );
      assert.ok(m.rel(cover.x, team) < m.rel(press.x, team));
    }
});

test('a distant stationary or receding carrier does not pull the back line into a chase', () => {
  for (const speed of [0, -5])
    for (const half of [1, 2])
      for (const team of [0, 1]) {
        const { m, press } = approach(half, team, speed);
        m.plan();
        assert.notEqual(press.intent, 'press');
        assert.ok(m.rel(press.tx, team) < m.rel(press.x, team));
      }
});

test('a low block retains its depth trigger against an approaching midfield carrier', () => {
  for (const half of [1, 2])
    for (const team of [0, 1]) {
      const { m, press } = approach(half, team, 7, 'bus');
      m.plan();
      assert.notEqual(press.intent, 'press');
    }
});
