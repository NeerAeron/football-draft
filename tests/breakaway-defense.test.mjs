import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Match } from '../app/engine.js';

// Captured before the last CB abandoned the line in seed 90540. Preserve the
// positions instead of depending on an identical sequence of random actions.
const capture = JSON.parse(
  readFileSync(new URL('./fixtures/midfield-turnover.json', import.meta.url)),
);
function turnover() {
  const m = new Match(capture.seed, capture.duration);
  m.mode = 'play';
  m.elapsed = capture.elapsed;
  m.half = capture.half;
  capture.rows.forEach(([x, y, vx, vy, markId, energy, sprint], i) =>
    Object.assign(m.players[i], { x, y, vx, vy, markId, energy, sprint, rethinkAt: 0 }),
  );
  m.own(m.players[capture.carrier]);
  return m;
}

test('the spare center back stops following a harmless opponent upfield after the turnover', () => {
  const m = turnover(),
    back = m.players[2],
    opponent = m.players[15];
  assert.ok(opponent.x > m.ball.x + 4);
  assert.equal(back.markId, opponent.id);
  assert.ok(back.vx > 0);
  const start = back.x;
  m.plan();
  assert.notEqual(back.markId, opponent.id);
  assert.ok(back.tx < start - 5, 'holds the space behind the press');
  for (let i = 0; i < 90; i++) m.move(back, 1 / 60);
  assert.ok(back.vx < 0, 'turns back toward his own goal with his existing acceleration');
  assert.ok(back.x < start);
});

test('a free defender covers a beaten midfield presser immediately in either direction and half', () => {
  for (const half of [1, 2])
    for (const team of [0, 1]) {
      const m = new Match(83, 300);
      m.mode = 'play';
      m.half = half;
      const attack = 1 - team;
      for (const p of m.players) {
        p.x = m.abs(p.team === team ? 10 : 30, attack);
        p.y = 5 + p.slot * 5.8;
        p.vx = p.vy = 0;
        p.rethinkAt = 0;
      }
      const carrier = m.players[attack * 11 + 9],
        press = m.players[team * 11 + 5],
        cover = m.players[team * 11 + 2];
      Object.assign(carrier, { x: m.abs(52.5, attack), y: 34, vx: m.direction(attack) * 7 });
      Object.assign(press, { x: m.abs(54, attack), y: 34, stun: 0.35 });
      Object.assign(cover, { x: m.abs(60, attack), y: 38 });
      m.own(carrier);
      m.presser[team] = press.id;
      cover.rethinkAt = 100;
      m.plan();
      assert.equal(press.intent, 'press');
      assert.equal(cover.intent, 'cover');
      assert.ok(m.rel(cover.tx, attack) > m.rel(carrier.x, attack) + 3);
      assert.ok(cover.ty < cover.y, 'cuts diagonally into the lane');
    }
});

test('dropping a bad mark triggers urgent recovery when a back is stranded behind the ball', () => {
  const m = turnover(),
    back = m.players[2],
    carrier = m.players[capture.carrier];
  carrier.x = 58;
  carrier.y = 48;
  back.x = 64;
  back.y = 15;
  back.vx = back.vy = 0;
  m.own(carrier);
  m.plan();
  assert.equal(back.markId, null);
  assert.equal(back.intent, 'recover');
  assert.ok(back.tx < carrier.x);
});

test('a back still marks the dangerous cutback receiver behind the ball inside the box', () => {
  const m = new Match(74),
    carrier = m.players[6],
    runner = m.players[9],
    back = m.players[13];
  m.mode = 'play';
  for (const p of m.players) {
    p.x = p.team ? 50 : 30;
    p.y = 5 + p.slot * 5;
    p.vx = p.vy = 0;
    p.rethinkAt = 0;
  }
  Object.assign(carrier, { x: 100, y: 12 });
  Object.assign(runner, { x: 92, y: 34 });
  Object.assign(back, { x: 94, y: 36 });
  Object.assign(m.players[15], { x: 101, y: 12 });
  m.own(carrier);
  m.plan();
  assert.equal(back.markId, runner.id);
  assert.ok(back.tx > runner.x);
});

test('fixing defensive decisions leaves physical pace, acceleration, and dribbling speed unchanged', () => {
  const m = turnover(),
    before = m.players.map(p => [p.baseSpeed(), p.acceleration(), p.topSpeed(), p.topSpeed(true)]);
  m.plan();
  assert.deepEqual(
    m.players.map(p => [p.baseSpeed(), p.acceleration(), p.topSpeed(), p.topSpeed(true)]),
    before,
  );
});
