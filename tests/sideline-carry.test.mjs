import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../app/engine.js';

function trapped(half, team, bottom) {
  const m = new Match(561, 300);
  m.mode = 'play';
  m.half = half;
  const y = value => (bottom ? 68 - value : value);
  for (const q of m.players) {
    q.x = m.abs(q.team === team ? 25 : 98, team);
    q.y = 34;
    q.vx = q.vy = 0;
  }
  const p = m.players[team * 11 + 10];
  Object.assign(p, {
    x: m.abs(48, team),
    y: y(1.99658),
    tags: ['cutback'],
    hold: 1,
    think: 0.1,
    stun: 0,
  });
  p.facing = Math.atan2(bottom ? 1 : -1, m.direction(team) * 0.167);
  for (const [slot, x, nearY] of [
    [1, 53.2402, 3.2362],
    [5, 47.599, 4.9594],
    [8, 53.563, 2.1903],
  ]) {
    Object.assign(m.players[(1 - team) * 11 + slot], { x: m.abs(x, team), y: y(nearY) });
  }
  Object.assign(m.ball, { owner: p.id, kind: 'dribble', x: p.x, y: p.y });
  return { m, p };
}

test('touchline pressure cannot make a clipped, nearly stationary dribble the winning route', () => {
  for (const half of [1, 2])
    for (const team of [0, 1])
      for (const bottom of [false, true]) {
        const { m, p } = trapped(half, team, bottom),
          start = { x: p.x, y: p.y },
          target = m.carryTarget(p);
        assert.ok(Math.hypot(target.x - p.x, target.y - p.y) > 2.8);
        for (let i = 0; i < 60; i++) {
          m.elapsed += 1 / 60;
          m.plan();
          m.move(p, 1 / 60);
          m.ball.x = p.x;
          m.ball.y = p.y;
        }
        assert.ok(
          Math.hypot(p.x - start.x, p.y - start.y) > 1.5,
          'the carrier keeps moving instead of braking at a collapsed waypoint',
        );
        assert.ok(p.y > 1 && p.y < 67);
      }
});

test('carrier routes remain finite and usable at all four corners', () => {
  for (const half of [1, 2])
    for (const [x, y] of [
      [0.5, 0.5],
      [0.5, 67.5],
      [104.5, 0.5],
      [104.5, 67.5],
    ]) {
      const { m, p } = trapped(half, 0, false);
      p.x = x;
      p.y = y;
      const target = m.carryTarget(p);
      assert.ok(target && Number.isFinite(target.x) && Number.isFinite(target.y));
      assert.ok(Math.hypot(target.x - x, target.y - y) > 2.8);
      assert.ok(target.x >= 1 && target.x <= 104 && target.y >= 2 && target.y <= 66);
    }
});
