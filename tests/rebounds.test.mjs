// Second balls (app/core/sim/rebound.js) and the rebound detector of the calibration tools.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../app/core/sim/engine.js';
import { reboundTracker, reboundKind } from '../tools/calibration/lib/rebounds.mjs';

// Team 0 defends the goal at x = 0 (first half). The keeper has just parried: the ball is
// loose 7 m out, two defenders and one attacker are near it, everybody else far away.
function scene({ secondBalls = 1 } = {}) {
  const m = new Match(4411, 180);
  m.tuning.gameplay.secondBalls = secondBalls;
  m.mode = 'play';
  m.elapsed = 20;
  for (const p of m.players)
    Object.assign(p, { x: p.team ? 70 : 45, y: 6 + (p.id % 11) * 5, vx: 0, vy: 0 });
  const keeper = m.players[0],
    near = m.players[3],
    second = m.players[4],
    far = m.players[6],
    attacker = m.players[20];
  Object.assign(keeper, { x: 2.8, y: 34 });
  Object.assign(near, { x: 11, y: 38 });
  Object.assign(second, { x: 13, y: 29 });
  Object.assign(far, { x: 24, y: 40 });
  Object.assign(attacker, { x: 17, y: 34, vx: -5 });
  Object.assign(m.ball, {
    x: 7,
    y: 34,
    z: 0,
    vx: 2,
    vy: 0,
    vz: 0,
    kind: 'loose',
    owner: null,
    target: null,
    kicker: keeper.id,
    deflectedBy: keeper.id,
    deflectedAt: m.elapsed,
    age: 0,
    lastTouch: 0,
  });
  return { m, keeper, near, second, far, attacker };
}

test('a rebound: both sides re-plan at once and the defending side is the one defending', () => {
  const { m, near, second, far, attacker } = scene();
  for (const p of m.players) p.rethinkAt = 99;
  m.planTimer = 0.1;
  m.startRebound(0);
  assert.equal(m.reboundSide(), 0);
  assert.equal(m.planTimer, 0);
  assert.ok(m.players.every(p => p.rethinkAt === 0));
  m.plan();
  // The nearest two defenders go for the ball, the attacker follows in.
  assert.equal(near.action, 'Attacking the loose ball');
  assert.equal(second.action, 'Attacking the second ball');
  assert.equal(attacker.action, 'Attacking the loose ball');
  for (const p of [near, second]) {
    assert.equal(p.intent, 'recover');
    assert.ok(Math.hypot(p.tx - m.ball.x, p.ty - m.ball.y) < 6, 'runs at the ball');
  }
  // The rest of the side defends (marks or holds its line): nobody runs out to support.
  assert.ok(!['support', 'run'].includes(far.intent), far.intent);
  // … and the side that shot is still attacking, although the keeper touched it last.
  const attackers = m.players.filter(p => p.team === 1 && p.role !== 'GK' && p !== attacker);
  assert.ok(attackers.every(p => !['mark', 'track', 'shape'].includes(p.intent)));
});

test('a rebound ends when somebody has the ball, after 3 s, or away from the goal', () => {
  const { m, near } = scene();
  m.startRebound(0);
  m.ball.x = 40;
  assert.equal(m.reboundSide(), -1);
  m.ball.x = 7;
  m.elapsed += 3.1;
  assert.equal(m.reboundSide(), -1);
  m.elapsed -= 3.1;
  assert.equal(m.reboundSide(), 0);
  m.own(near);
  assert.equal(m.ball.reboundTeam, null);
  assert.equal(m.reboundSide(), -1);
});

test('gameplay.secondBalls 0 keeps the old behaviour: one chaser, the rest back to shape', () => {
  const { m, near, second } = scene({ secondBalls: 0 });
  m.startRebound(0);
  assert.equal(m.reboundSide(), -1);
  m.plan();
  assert.equal(near.intent, 'recover');
  assert.notEqual(second.intent, 'recover');
});

test('a defender who reaches the rebound with an attacker on it clears it', () => {
  const { m, near, attacker } = scene();
  m.rand = () => 0.5;
  m.startRebound(0);
  Object.assign(near, { x: 7.9, y: 34.5 });
  Object.assign(attacker, { x: 10, y: 34, vx: -6 });
  assert.equal(m.shouldClearRebound(near), true);
  m.moveBall(1 / 60);
  assert.equal(m.ball.owner, null);
  assert.equal(m.ball.kind, 'loose');
  assert.equal(m.ball.kicker, near.id);
  assert.equal(m.ball.lastTouch, 0);
  assert.equal(near.action, 'Clearing the rebound');
  assert.ok(m.ball.vx > 5, 'away from his goal');
  assert.ok(m.ball.vz > 4, 'lofted');
  // Not at the attacker closing in from straight ahead.
  assert.ok(Math.abs(m.ball.vy) > 2);
});

test('with no attacker near he takes the rebound instead, and the keeper never hacks at it', () => {
  const { m, near, keeper, attacker } = scene();
  m.rand = () => 0;
  m.startRebound(0);
  Object.assign(near, { x: 7.6, y: 34.3 });
  Object.assign(attacker, { x: 30, y: 34 });
  assert.equal(m.shouldClearRebound(near), false);
  assert.equal(m.shouldClearRebound(keeper), false);
  m.moveBall(1 / 60);
  assert.equal(m.ball.owner, near.id);
});

test('the keeper claims a rebound he reaches before any attacker, and stays when he cannot', () => {
  const a = scene();
  Object.assign(a.m.ball, { x: 5, vx: 0.5, deflectedAt: a.m.elapsed - 0.4 });
  Object.assign(a.attacker, { x: 24, y: 34 });
  Object.assign(a.near, { x: 20, y: 50 });
  Object.assign(a.second, { x: 20, y: 18 });
  a.m.startRebound(0);
  a.m.plan();
  assert.equal(a.keeper.action, 'Claiming the loose ball');
  assert.equal(a.keeper.intent, 'sweep');

  const b = scene();
  Object.assign(b.m.ball, { x: 9, vx: 3 });
  Object.assign(b.attacker, { x: 11, y: 34, vx: -6 });
  b.m.startRebound(0);
  b.m.plan();
  assert.notEqual(b.keeper.action, 'Claiming the loose ball');
});

test('the shooter is in his follow-through: a blocked ball is not his again at once', () => {
  const { m, attacker } = scene();
  m.ball.shotRecord = { team: 1, player: attacker.id, status: 'blocked' };
  Object.assign(attacker, { x: 7.5, y: 34 });
  m.startRebound(0);
  assert.equal(m.canCollect(attacker), false);
  m.elapsed += 0.3;
  assert.equal(m.canCollect(attacker), false);
  m.elapsed += 0.25;
  assert.equal(m.canCollect(attacker), true);
});

test('loosePoint: a man running the wrong way meets the ball later and further on', () => {
  const { m, near } = scene();
  Object.assign(m.ball, { x: 7, vx: 5 });
  Object.assign(near, { x: 5, y: 36.5, vx: 0, vy: 0 });
  const standing = { ...m.loosePoint(near) };
  Object.assign(near, { vx: -7, vy: 0 });
  const overrunning = { ...m.loosePoint(near) };
  assert.ok(overrunning.time > standing.time);
  assert.ok(overrunning.x > standing.x);
  assert.ok(standing.x > m.ball.x, 'ahead of the ball, on its path');
});

// ---- the detector (tools/calibration/lib/rebounds.mjs), on a scripted stand-in for a match
function fake() {
  const players = [
    { id: 0, team: 0, role: 'GK', x: 2, y: 34 },
    { id: 1, team: 0, role: 'CB', x: 8, y: 36 },
    { id: 2, team: 1, role: 'ST', x: 14, y: 34 },
  ];
  return {
    events: [],
    ball: { x: 6, y: 34, owner: null },
    players,
    activePlayers: players,
    stats: [{ shots: 0 }, { shots: 1 }],
    score: [0, 0],
    elapsed: 50,
    time: 1500,
    mode: 'play',
    finished: false,
  };
}
const advance = (m, track, seconds) => {
  const out = [];
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    m.elapsed += 1 / 60;
    out.push(...track.step());
  }
  return out;
};

test('reboundKind: parries, blocked shots and the woodwork — not catches or blocked crosses', () => {
  assert.equal(reboundKind({ type: 'save', saveType: 'parry into danger' }), 'parry');
  assert.equal(reboundKind({ type: 'save', saveType: 'catch' }), null);
  assert.equal(reboundKind({ type: 'block', shotEventId: 4 }), 'block');
  assert.equal(reboundKind({ type: 'block', cross: true, shotEventId: null }), null);
  assert.equal(reboundKind({ type: 'post' }), 'post');
  assert.equal(reboundKind({ type: 'goal' }), null);
});

test('detector: a second shot within 3 s with a defender closer at the save is a rebound left', () => {
  const m = fake(),
    track = reboundTracker(m);
  m.events.unshift({ type: 'save', team: 0, saveType: 'parry' });
  assert.deepEqual(advance(m, track, 1), []);
  m.stats[1].shots++;
  assert.deepEqual(advance(m, track, 0.5), []);
  m.score[1]++;
  const [r] = advance(m, track, 0.1);
  assert.equal(r.kind, 'parry');
  assert.equal(r.team, 0);
  assert.ok(r.defender < r.attacker);
  assert.ok(Math.abs(r.shotAfter - 1) < 0.05);
  assert.equal(r.left, true);
  assert.equal(r.goal, true);
});

test('detector: no blunder when the attacker was the closer man, or the shot comes late', () => {
  const a = fake(),
    trackA = reboundTracker(a);
  a.players[2].x = 7; // the poacher is on it
  a.events.unshift({ type: 'post', team: 1 });
  advance(a, trackA, 0.5);
  a.stats[1].shots++;
  const [r] = advance(a, trackA, 3);
  assert.equal(r.kind, 'post');
  assert.equal(r.team, 0, 'the woodwork event belongs to the shooter: the other side defends');
  assert.equal(r.left, false);
  assert.equal(r.goal, false);

  const b = fake(),
    trackB = reboundTracker(b);
  b.events.unshift({ type: 'block', team: 0, shotEventId: 9 });
  const early = advance(b, trackB, 3.2);
  assert.equal(early.length, 1);
  assert.equal(early[0].shotAfter, null);
  b.stats[1].shots++;
  assert.deepEqual(advance(b, trackB, 1), []);
});

test('detector: a catch, or a save that goes straight out of play, is not a rebound', () => {
  const m = fake(),
    track = reboundTracker(m);
  m.events.unshift({ type: 'save', team: 0, saveType: 'catch' });
  assert.deepEqual(advance(m, track, 4), []);
  m.mode = 'restart';
  m.events.unshift({ type: 'save', team: 0, saveType: 'tip over' });
  assert.deepEqual(advance(m, track, 4), []);
});
