// Shots from a tight angle: wider scatter, a keeper at his near post, no shooting from the
// byline (docs/calibration.md, "Tight angles").
import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, GOAL } from '../app/core/sim/engine.js';

/** A striker of team 0 (attacking x = 105) with the ball at (x, y), everyone else far away. */
function shooterAt(seed, x, y) {
  const m = new Match(seed, 180),
    p = m.players[9];
  m.mode = 'play';
  for (const q of m.players)
    if (q !== p && q.role !== 'GK') Object.assign(q, { x: 20 + q.slot, y: 60, tx: 20, ty: 60 });
  Object.assign(p, { x, y, vx: 0, vy: 0, tx: x, ty: y, hold: 0.6, energy: 1 });
  Object.assign(m.ball, { x, y, z: 0, vx: 0, vy: 0, vz: 0, owner: p.id, kind: 'dribble' });
  m.lastTeam = 0;
  return { m, p };
}

/** Where a shot just struck crosses the goal line (y), ignoring the keeper. */
const crossingY = m => m.ball.y + (m.ball.vy / m.ball.vx) * (105 - m.ball.x);

test('the same shot is far less accurate from a tight angle than from in front', () => {
  // 12 m from the middle of the goal: straight on, and about 75° off the centre line
  const spots = { front: [93, 34], side: [105 - 12 * Math.cos(1.31), 34 - 12 * Math.sin(1.31)] },
    onTarget = { front: 0, side: 0 },
    n = 240;
  for (const [name, [x, y]] of Object.entries(spots))
    for (let seed = 1; seed <= n; seed++) {
      const { m, p } = shooterAt(7, x, y);
      m.rng = seed * 7919;
      m.shoot(p);
      if (Math.abs(crossingY(m) - 34) < GOAL / 2) onTarget[name]++;
    }
  assert.ok(onTarget.front / n > 0.9, `front on target ${onTarget.front}/${n}`);
  assert.ok(onTarget.side < onTarget.front * 0.9, `side on target ${onTarget.side}/${n}`);
});

test('with the ball wide on the byline the keeper stands at his near post, near his line', () => {
  const m = new Match(3, 180),
    g = m.players[11]; // defends x = 105 in the first half
  m.mode = 'play';
  for (const side of [-1, 1]) {
    const carrier = m.players[9];
    Object.assign(carrier, { x: 104.2, y: 34 + side * 12, vx: 0, vy: 0 });
    Object.assign(m.ball, { x: 104.2, y: 34 + side * 12, owner: carrier.id, kind: 'dribble' });
    for (const p of m.players) p.rethinkAt = 0;
    m.plan();
    assert.ok(m.rel(g.tx, 1) <= 1, `off his line by ${m.rel(g.tx, 1)}`);
    assert.ok(Math.abs(g.ty - (34 + side * (GOAL / 2 - 0.6))) < 0.2, `aims at y ${g.ty}`);
  }
  // An opponent's pass on its way to the byline is read before it gets there
  Object.assign(m.ball, {
    x: 88,
    y: 20,
    owner: null,
    kind: 'pass',
    vx: 18,
    vy: 0,
    z: 0,
    kicker: 9,
    destination: { x: 103, y: 21 },
    missedReceiver: false,
  });
  for (const p of m.players) p.rethinkAt = 0;
  m.plan();
  assert.ok(m.rel(g.tx, 1) < 1.6 && g.ty < 31.2, `reads the pass: ${m.rel(g.tx, 1)} / ${g.ty}`);
  // In front of goal nothing changes: he comes off his line to narrow the angle
  Object.assign(m.ball, {
    x: 101,
    y: 35,
    owner: null,
    kind: 'loose',
    vx: 0,
    vy: 0,
    destination: null,
  });
  for (const p of m.players) p.rethinkAt = 0;
  m.plan();
  assert.ok(m.rel(g.tx, 1) >= 2.4);
});

test('a carrier on the byline does not shoot; from the penalty spot he does', () => {
  const shots = { byline: 0, spot: 0 },
    n = 150;
  for (const [name, [x, y]] of Object.entries({ byline: [103.6, 23], spot: [94, 34] }))
    for (let seed = 1; seed <= n; seed++) {
      const { m, p } = shooterAt(11, x, y);
      m.rng = seed * 104729;
      m.decide(p);
      if (m.ball.kind === 'shot') shots[name]++;
    }
  assert.equal(shots.byline, 0);
  assert.ok(shots.spot > n * 0.2, `shots from the spot: ${shots.spot}/${n}`);
});

test("a tight-angle shot within the keeper's reach is mostly kept out", () => {
  const saved = { side: 0, front: 0 },
    n = 200;
  for (const name of ['side', 'front'])
    for (let seed = 1; seed <= n; seed++) {
      const m = new Match(5, 180),
        g = m.players[11],
        shooter = m.players[9];
      m.mode = 'play';
      Object.assign(g, { x: 104.2, y: 34, vx: 0, vy: 0 });
      // The same ball, 0.7 m to the keeper's side, struck from 6 m: only its origin differs
      Object.assign(m.ball, {
        x: 103.2,
        y: 34.7,
        z: 0.6,
        vx: 24,
        vy: 0,
        vz: 0,
        owner: null,
        kind: 'shot',
        age: 0.12,
        shotTeam: 0,
        kicker: shooter.id,
        saver: null,
        shotType: 'Driven shot',
        shotOrigin:
          name === 'side'
            ? { x: 103.5, y: 28, attackX: 103.5, box: true, zone: 'wide_box' }
            : { x: 99, y: 34, attackX: 99, box: true, zone: 'near_central' },
        shotRecord: { team: 0, player: shooter.id, eventId: 1, xg: 0.3, status: 'in flight' },
      });
      m.rng = seed * 31337;
      if (m.keeperSave(g)) saved[name]++;
    }
  assert.ok(saved.side / n > 0.78, `side saved ${saved.side}/${n}`);
  assert.ok(saved.side > saved.front + n * 0.05, `front saved ${saved.front}/${n}`);
});
