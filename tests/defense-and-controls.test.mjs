import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../app/core/sim/engine.js';
import { OVERALL_WEIGHTS, OVERALL_OFFSETS, overallRating } from '../app/core/players/ratings.js';
import { PlaybackClock } from '../app/services/playback.js';

test('every role has a normalized overall, with heading contributing to striker ability', () => {
  const m = new Match(60),
    p = m.players[9];
  for (const [role, weights] of Object.entries(OVERALL_WEIGHTS)) {
    assert.ok(Math.abs(Object.values(weights).reduce((a, b) => a + b, 0) - 100) < 1e-9, role);
    assert.ok(Object.values(weights).every(w => w > 0));
    const equal = { role, attrs: Object.fromEntries(Object.keys(p.attrs).map(k => [k, 70])) };
    // (Unrounded: with a half-point offset the weighted sum sits on the rounding edge.)
    assert.ok(Math.abs(overallRating(equal, false) - (70 + OVERALL_OFFSETS[role])) < 1e-9, role);
    assert.equal(overallRating(equal), Math.round(overallRating(equal, false)));
  }
  // Heading's weight, measured without the stretch of the top ratings.
  m.tuning.ratings.topLift = 0;
  p.role = 'ST';
  p.attrs.heading = 40;
  const lower = overallRating(p, false);
  p.attrs.heading = 80;
  assert.ok(Math.abs(overallRating(p, false) - lower - 5.6) < 1e-9);
  p.energy = 0.01;
  p.tags = ['target', 'finisher'];
  assert.ok(Math.abs(overallRating(p, false) - lower - 5.6) < 1e-9);
  const striker = overallRating(p);
  p.role = 'CB';
  assert.notEqual(overallRating(p), striker);
});

test('a paused playback clock freezes the actual match; resuming continues it', () => {
  const clock = new PlaybackClock(),
    m = new Match(401, 180);
  let now = 0;
  const frame = () => {
    now += 20;
    for (let i = clock.ticks(clock.frame(now)); i > 0; i--) m.step(1 / 60);
  };
  clock.setPaused(false, now);
  for (let n = 0; n < 10; n++) frame();
  assert.ok(m.elapsed > 0);
  for (let n = 0; n < 20; n++) {
    frame();
    clock.setPaused(true, now);
    const elapsed = m.elapsed,
      positions = m.players.map(p => [p.x, p.y]);
    for (let f = 0; f < 12; f++) frame();
    assert.equal(m.elapsed, elapsed);
    assert.deepEqual(
      m.players.map(p => [p.x, p.y]),
      positions,
    );
    clock.setPaused(false, now);
    frame();
    assert.ok(m.elapsed > elapsed);
  }
});

test('markers predict forward runs and remain goal-side in both halves and directions', () => {
  for (const half of [1, 2])
    for (const team of [0, 1]) {
      const m = new Match(54);
      m.half = half;
      const d = m.players[team * 11 + 2],
        a = m.players[(1 - team) * 11 + 9],
        dir = m.direction(team);
      d.x = m.abs(24, team);
      d.y = 40;
      a.x = m.abs(18, team);
      a.y = 36;
      a.vx = -dir * 6;
      a.vy = -1;
      m.ball.x = a.x;
      m.ball.y = 30;
      const point = m.markingPoint(team, a, d);
      assert.ok(
        m.rel(point.x, team) < m.rel(a.x, team) - 2,
        'recovery point is ahead of the runner toward the defending goal',
      );
      assert.ok(point.y < a.y, 'reads lateral movement toward the middle');
    }
});

test('a deep runner is tracked urgently without blending the marker behind the attacker', () => {
  const m = new Match(912);
  m.mode = 'play';
  const a = m.players[9],
    carrier = m.players[6];
  for (const p of m.players) {
    p.x = p.team ? 85 : 65;
    p.y = 5 + p.slot * 5;
    p.vx = p.vy = 0;
  }
  a.x = 94;
  a.y = 37;
  carrier.x = 82;
  carrier.y = 23;
  m.own(carrier);
  m.plan();
  const marker = m.players.find(p => p.team === 1 && p.markId === a.id);
  assert.ok(marker);
  assert.ok(marker.tx > a.x, 'target stays on the goal side');
  assert.ok(Math.abs(marker.ty - a.y) < 2, 'formation does not pull the marker out of the lane');
  assert.equal(marker.intent, 'track');
});

test('cover does not take a close marker away from an unprotected box runner', () => {
  const m = new Match(74),
    carrier = m.players[6],
    runner = m.players[9];
  for (const p of m.players) {
    p.x = p.team ? 50 : 30;
    p.y = 5 + p.slot * 5;
    p.vx = p.vy = 0;
  }
  carrier.x = 82;
  carrier.y = 28;
  runner.x = 91;
  runner.y = 38;
  Object.assign(m.players[16], { x: 84, y: 28 });
  Object.assign(m.players[13], { x: 94, y: 38 });
  m.ball.x = carrier.x;
  m.ball.y = carrier.y;
  const defence = m.assignDefense(1, carrier);
  assert.notEqual(defence.cover, 13);
  const marks = m.assignMarks(1, carrier, defence);
  assert.equal(marks.get(13)?.id, runner.id);
});

test('arrival time accounts for a defender turning and an exhausted sprint reserve', () => {
  const m = new Match(12),
    p = m.players[2];
  p.x = 50;
  p.y = 34;
  p.vx = 6;
  p.vy = 0;
  const forward = p.arrival({ x: 60, y: 34 }),
    turn = p.arrival({ x: 40, y: 34 });
  assert.ok(turn > forward + 0.2);
  p.sprint = 0.05;
  assert.ok(p.arrival({ x: 60, y: 34 }) > forward);
});

test('center backs protect against a counter while their team has the ball', () => {
  const m = new Match(28);
  m.mode = 'play';
  const carrier = m.players[6],
    outlet = m.players[20],
    back = m.players[2];
  carrier.x = 88;
  carrier.y = 34;
  outlet.x = 54;
  outlet.y = 26;
  back.x = 55;
  back.y = 26;
  for (const id of [19, 21]) {
    m.players[id].x = 72;
    m.players[id].y = 62;
  }
  m.own(carrier);
  m.ball.x = 88;
  m.ball.y = 34;
  m.plan();
  assert.ok(back.tx < outlet.x - 1, 'does not advance beyond the opposition outlet');
});

test('higher stamina preserves more match energy under the same work', () => {
  const m = new Match(19, 300),
    low = m.players[9],
    high = m.players[20];
  low.attrs.stamina = 35;
  high.attrs.stamina = 95;
  for (let i = 0; i < 6000; i++) {
    for (const p of [low, high]) {
      p.x = 50;
      p.y = p.team ? 50 : 10;
      p.vx = 4;
      p.vy = 0;
      p.aim(60, p.y, 'support', 'Supporting');
      m.move(p, 1 / 60);
    }
  }
  // Same work, clearly less energy spent (relative, independent of the drain scale).
  assert.ok(1 - low.energy > (1 - high.energy) * 1.15);
  assert.ok(high.energy < 0.97);
});
