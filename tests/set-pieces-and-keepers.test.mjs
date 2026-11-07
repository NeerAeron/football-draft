import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, GOAL } from '../app/core/sim/engine.js';

const aerial = q =>
  q.skill('heading') * 0.6 + q.skill('strength') * 0.25 + q.tendency('aerial') * 10;

test('corner routines: best header attacks the zone, defenders mark goal-side', () => {
  const routines = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const m = new Match(seed, 300);
    for (let i = 0; i < 120; i++) m.step(1 / 60);
    m.mode = 'play';
    m.startRestart('Corner', 0, 104.7, 0.3);
    const r = m.restart;
    routines.add(r.routine);
    assert.ok(['near post', 'far post', 'edge'].includes(r.routine));
    assert.equal(m.events[0].restart, 'Corner');
    const target = m.players[r.target];
    assert.equal(target.team, 0);
    if (r.routine !== 'edge') {
      const best = m.activePlayers
        .filter(p => p.team === 0 && p.role !== 'GK' && p.id !== r.taker)
        .sort((a, c) => aerial(c) - aerial(a) || a.id - c.id)[0];
      assert.equal(target.id, best.id);
      assert.ok(m.inBox({ x: r.aim.x, y: r.aim.y, team: 0 }));
      // Its marker stands between him and the goal.
      const marker = m.players.find(p => p.team === 1 && p.markId === target.id);
      assert.ok(marker && m.rel(marker.tx, 0) > m.rel(target.tx, 0));
    } else assert.ok(m.rel(r.aim.x, 0) < 90);
  }
  assert.ok(routines.size >= 2);
});

test('a keeper stays inside his posts while the ball is at the corner flag', () => {
  const m = new Match(3, 300);
  m.mode = 'play';
  const g = m.players[11];
  Object.assign(m.ball, { x: 104.6, y: 0.4, owner: null, kind: 'loose', vx: 0, vy: 0 });
  m.plan();
  assert.ok(Math.abs(g.ty - 34) < GOAL / 2, `keeper aims at y ${g.ty}`);
});

test('a high shot tipped over the bar goes behind for a corner', () => {
  const m = new Match(4, 300),
    g = m.players[11];
  m.mode = 'play';
  Object.assign(g, { x: 104, y: 34 });
  Object.assign(m.ball, {
    x: 103.5,
    y: 34.5,
    z: 2.3,
    vx: 25,
    vy: 0,
    vz: 0,
    kind: 'shot',
    owner: null,
  });
  m.ball.shotTeam = 0;
  const type = m.deflectSave(g, 1, 0.8, 0.8, 80);
  assert.equal(type, 'tip over');
  for (let i = 0; i < 120 && m.mode === 'play'; i++) {
    m.moveBall(1 / 60);
    m.checkBounds();
  }
  assert.equal(m.mode, 'restart');
  assert.equal(m.restart.type, 'Corner');
  assert.equal(m.restart.team, 0);
});

test('keepers react and reach further with rating, and a stretched save is harder', () => {
  const m = new Match(5, 300),
    g = m.players[0];
  g.attrs.goalkeeping = 60;
  const slow = [m.keeperReaction(g), m.keeperReach(g, 0.5)];
  g.attrs.goalkeeping = 90;
  const fast = [m.keeperReaction(g), m.keeperReach(g, 0.5)];
  assert.ok(fast[0] < slow[0] && fast[1] > slow[1]);
  // No dive yet at the moment of the strike; reach grows with time.
  assert.ok(m.keeperReach(g, 0) < m.keeperReach(g, 0.3));
});

test('the player who deflects a ball cannot collect it again a frame later', () => {
  const m = new Match(6, 300),
    d = m.players[2];
  m.mode = 'play';
  Object.assign(d, { x: 20, y: 30 });
  Object.assign(m.ball, { x: 20.2, y: 30, z: 1.8, vx: 8, vy: 0, vz: 0, kind: 'pass', owner: null });
  m.headClear(d);
  assert.equal(m.canCollect(d), false);
  m.elapsed += 0.5;
  assert.equal(m.canCollect(d), true);
});
