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

test('restarts: the taker plays the best ball that is on, and a throw is short', () => {
  const m = new Match(7, 180);
  const option = (score, risk, margin, chance, d) => ({ score, risk, margin, chance, d });
  // Sorted by score, as options() returns them.
  const blocked = option(3, 1.2, 0.4, 0.45, 18),
    late = option(2.6, 0.1, -0.4, 0.6, 20),
    long = option(2.4, 0.1, 0.5, 0.8, 44),
    on = option(2, 0.3, 0.2, 0.7, 14),
    back = option(1, 0.02, 1, 0.9, 9);
  assert.equal(m.restartOption([blocked, late, long, on, back], 'Free kick'), long);
  assert.equal(m.restartOption([blocked, late, long, on, back], 'Throw-in'), on, 'no 44 m throw');
  // Nothing clean: the safest ball rather than the most ambitious one.
  assert.equal(m.restartOption([blocked, late], 'Free kick'), late);
  assert.equal(m.restartOption([blocked], 'Throw-in'), blocked);

  // At a throw-in two team-mates come to offer a short ball, one up the line, one infield.
  for (let i = 0; i < 240; i++) m.step(1 / 60);
  m.mode = 'play';
  m.startRestart('Throw-in', 0, 60, 0.2);
  const taker = m.players[m.restart.taker],
    showing = m.activePlayers.filter(p => p.action === 'Showing for the throw');
  assert.equal(showing.length, 2);
  for (const p of showing) {
    assert.equal(p.team, 0);
    assert.notEqual(p.id, taker.id);
    assert.ok(Math.hypot(p.tx - 60, p.ty - 0.2) < 11, 'within a short throw');
  }
});

test('a tip over goes over the bar from anywhere in front of the line: never into the net', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const m = new Match(seed, 180);
    m.mode = 'play';
    const g = m.players[11],
      depth = 0.3 + (seed % 12) * 0.5; // 0.3 … 5.8 m off his line
    g.x = 105 - depth;
    g.y = 34 + ((seed % 5) - 2) * 0.8;
    Object.assign(m.ball, {
      x: g.x - 0.3,
      y: g.y + 0.4,
      z: 2.1 + (seed % 4) * 0.12,
      vx: 24,
      vy: ((seed % 3) - 1) * 2,
      vz: 1,
      owner: null,
      kind: 'shot',
      shotTeam: 0,
      lastTouch: 0,
    });
    assert.equal(m.deflectSave(g, 1, 0.8, 0.7, 80), 'tip over');
    let crossed = false;
    for (let i = 0; i < 240 && m.mode === 'play'; i++) {
      m.ball.age += 1 / 60;
      m.moveBall(1 / 60);
      m.checkBounds();
      assert.deepEqual(m.score, [0, 0], `seed ${seed}: tipped over, not in`);
      if (m.mode !== 'play') crossed = true;
    }
    assert.ok(crossed, 'it goes behind');
    assert.equal(m.restart.type, 'Corner');
    assert.equal(m.restart.team, 0);
  }
});

test("a parry never carries the ball into the keeper's own net", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const m = new Match(seed, 180);
    m.mode = 'play';
    const g = m.players[11];
    g.x = 105 - 0.4 - (seed % 6) * 0.6;
    g.y = 34 + ((seed % 7) - 3) * 0.9;
    Object.assign(m.ball, {
      x: g.x - 0.2,
      y: g.y + ((seed % 3) - 1) * 0.5,
      z: 0.6,
      vx: 22,
      vy: ((seed % 5) - 2) * 3,
      vz: 0,
      owner: null,
      kind: 'shot',
      shotTeam: 0,
      lastTouch: 0,
    });
    for (const p of m.players) if (p.id !== g.id) p.stun = 5; // nobody else touches it
    assert.match(m.deflectSave(g, 0, 0.5, 0.5, 80), /^parry/);
    for (let i = 0; i < 180 && m.mode === 'play'; i++) {
      m.ball.age += 1 / 60;
      m.moveBall(1 / 60);
      m.checkBounds();
    }
    assert.deepEqual(m.score, [0, 0], `seed ${seed}`);
  }
});

// Building up from the back: a goal kick, a deep free kick (offside, foul) and the keeper's
// hands share one shape. Nobody is placed — both sides run to it and the taker waits until
// they are set or `gameplay.buildUpWait`. Against a mid-block the ball goes short to a man
// with room; against a high press it goes long, to a header of the ball up the pitch and
// away from the touchlines. Never to an opponent, never straight out.
function crowded(seed, press) {
  const m = new Match(seed);
  for (let i = 0; i < 90; i++) m.step(1 / 60);
  m.teams[0].tactics.mentality = m.teams[1].tactics.mentality = 'balanced';
  m.teams[1].tactics.press = press;
  // Everybody crowded around the box, as after an attack.
  for (const p of m.players)
    if (p.role !== 'GK') {
      p.x = m.abs(8 + (p.id % 11) * 2, 0);
      p.y = 20 + (p.id % 7) * 4;
      p.vx = p.vy = 0;
    }
  m.mode = 'play';
  return m;
}
const nearestOpponent = (m, team, at) =>
  Math.min(
    ...m.activePlayers.filter(q => q.team !== team).map(q => Math.hypot(q.x - at.x, q.y - at.y)),
  );
// Steps until `done`, checking that nobody is moved faster than a man can run.
function runUntil(m, done, limit = 600) {
  let steps = 0;
  while (!done() && steps++ < limit) {
    const before = m.activePlayers.map(q => [q.x, q.y]);
    m.step(1 / 60);
    if (!done())
      m.activePlayers.forEach((q, i) =>
        assert.ok(Math.hypot(q.x - before[i][0], q.y - before[i][1]) < 0.2, `${q.name} jumped`),
      );
  }
  return steps / 60;
}
// The kick out of a build-up shape: to a team-mate, short with room or long to a header.
function assertBuildUpKick(m, kicker, { long = null, goalKick = false } = {}) {
  assert.equal(m.ball.kind, 'pass');
  assert.equal(m.ball.kicker, kicker.id);
  const target = m.players[m.ball.target],
    aim = m.ball.destination,
    length = Math.hypot(aim.x - kicker.x, aim.y - kicker.y),
    isLong = m.ball.vz > 0;
  assert.equal(target.team, kicker.team);
  assert.notEqual(target.id, kicker.id);
  assert.ok(aim.y > 4 && aim.y < 64, 'never at the touchline');
  if (long !== null) assert.equal(isLong, long, `kick of ${length}`);
  if (isLong) {
    assert.ok(length > 22, `long kick of ${length}`);
    assert.ok(m.rel(aim.x, kicker.team) > 44, `lands up the pitch (${m.rel(aim.x, kicker.team)})`);
    assert.ok(Math.abs(aim.y - 34) < 24);
    if (!goalKick) assert.equal(m.ball.offside, false, 'the target is onside');
  } else assert.ok(nearestOpponent(m, kicker.team, aim) > 12, 'the receiver has room');
  return isLong;
}

test('goal kick: both sides run to their shape; the keeper waits, then short or long', () => {
  for (let seed = 1; seed <= 8; seed++) {
    for (const press of [3, 5]) {
      const m = crowded(seed, press),
        long = press === 5,
        keeper = m.keeper(0);
      m.startRestart('Goal kick', 0, m.abs(5.5, 0), 34);
      assert.equal(m.restart.routine, long ? 'long' : 'short');
      const waited = runUntil(m, () => m.mode !== 'restart');
      assert.ok(waited <= m.tuning.gameplay.buildUpWait + 2.1, `waited ${waited}`);
      const front = Math.min(...m.activePlayers.filter(p => p.team === 1).map(p => m.rel(p.x, 0)));
      assert.ok(front > 16.5, `the defending side is outside the box (${front})`);
      for (const p of m.activePlayers) assert.ok(p.y >= 0.5 && p.y <= 67.5);
      // The centre-backs have split either side of the box (short) or pushed up (long).
      const back = m.activePlayers.filter(
        p => p.team === 0 && p.role !== 'GK' && m.formation(p)[0] < 30,
      );
      for (const p of back)
        assert.ok(Math.hypot(p.tx - p.x, p.ty - p.y) < 14, `${p.role} near his spot`);
      const went = assertBuildUpKick(m, keeper, { goalKick: true });
      if (long) assert.ok(went, 'long against the press');
    }
  }
});

test('goal kick against a mid-block that is set: short to a free man at once', () => {
  const m = crowded(3, 3);
  m.startRestart('Goal kick', 0, m.abs(5.5, 0), 34);
  // Both sides already in the shape.
  for (const p of m.activePlayers)
    if (p.role !== 'GK') {
      p.x = p.tx;
      p.y = p.ty;
    }
  const waited = runUntil(m, () => m.mode !== 'restart');
  assert.ok(waited < 1.6, `no waiting when everybody is set (${waited})`);
  assertBuildUpKick(m, m.keeper(0), { long: false, goalKick: true });
});

test('free kick after an offside deep in the own half: set up and played like a goal kick', () => {
  let short = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const m = crowded(seed, seed % 2 ? 3 : 5),
      spot = { x: m.abs(24, 0), y: 30 };
    m.startRestart('Offside', 0, spot.x, spot.y, 0.75);
    const r = m.restart,
      taker = m.players[r.taker];
    assert.ok(r.build);
    assert.equal(r.routine, seed % 2 ? 'short' : 'long');
    assert.ok(taker.role !== 'GK' && m.formation(taker)[0] < 58, 'a defender or midfielder');
    const waited = runUntil(m, () => m.mode !== 'restart');
    assert.ok(waited >= 0.99 && waited <= m.tuning.gameplay.buildUpWait + 2.1, `waited ${waited}`);
    for (const p of m.activePlayers)
      if (p.team === 1)
        assert.ok(Math.hypot(p.x - spot.x, p.y - spot.y) >= 9.15, `${p.name} keeps his distance`);
    if (!assertBuildUpKick(m, taker)) short++;
    assert.equal(m.ball.indirect, taker.id);
  }
  assert.ok(short >= 1, 'a short ball when it is on');
});

test('a free kick in midfield is not built up from', () => {
  const m = crowded(2, 3);
  m.startRestart('Free kick', 0, m.abs(60, 0), 30, 0.85);
  assert.equal(m.restart.build, false);
  assert.ok(m.restart.timer < 1);
});

test('keeper with the ball in his hands: the sides spread, he waits, then plays to a team-mate', () => {
  for (let seed = 1; seed <= 8; seed++) {
    const m = crowded(seed, seed % 2 ? 3 : 5),
      keeper = m.keeper(0);
    keeper.x = m.abs(6, 0);
    keeper.y = 34;
    m.ball.x = keeper.x;
    m.ball.y = keeper.y;
    m.own(keeper, true);
    assert.equal(m.ball.kind, 'held');
    const held = runUntil(m, () => m.ball.owner !== keeper.id);
    // He does not kick into the crowd at once, and not later than the cap (plus a thought).
    assert.ok(held > 1.5 && held <= m.tuning.gameplay.buildUpWait + 1, `held ${held}`);
    const spread = m.activePlayers.filter(p => p.team === 1 && m.rel(p.x, 0) > 22).length;
    assert.ok(spread >= 6, `${spread} opponents have dropped off`);
    assertBuildUpKick(m, keeper, seed % 2 ? {} : { long: true });
  }
});

test('keeper with the ball in his hands throws at once to a free defender', () => {
  const m = crowded(5, 3),
    keeper = m.keeper(0);
  // The opponents are up the pitch already; a centre-back is alone beside the box.
  for (const p of m.activePlayers) if (p.team === 1 && p.role !== 'GK') p.x = m.abs(60, 0);
  const cb = m.activePlayers.find(p => p.team === 0 && p.role === 'CB');
  cb.x = m.abs(12, 0);
  cb.y = 50;
  keeper.x = m.abs(6, 0);
  keeper.y = 34;
  m.ball.x = keeper.x;
  m.ball.y = keeper.y;
  m.own(keeper, true);
  const held = runUntil(m, () => m.ball.owner !== keeper.id);
  assert.ok(held < 2, `released after ${held}`);
  assertBuildUpKick(m, keeper, { long: false });
});

test('the long ball of a build-up never goes to a man in an offside position', () => {
  const m = crowded(6, 5),
    keeper = m.keeper(0);
  for (const p of m.activePlayers) {
    if (p.role === 'GK') continue;
    // Our forwards beyond their whole back line.
    p.x = p.tx = m.abs(p.team === 0 ? (m.formation(p)[0] >= 58 ? 66 : 45) : 60, 0);
  }
  m.own(keeper, true);
  const kick = m.buildUpOption(keeper, m.options(keeper), 'long');
  assert.ok(m.rel(kick.r.x, 0) <= 60, 'an onside target');
  const free = m.buildUpOption(keeper, m.options(keeper), 'long', false, true);
  assert.ok(m.rel(free.r.x, 0) > 60, 'a goal kick has no offside');
});

test('goal kick: the side that is chasing the game goes long', () => {
  const m = crowded(4, 3);
  m.startRestart('Goal kick', 0, m.abs(5.5, 0), 34);
  assert.equal(m.restart.routine, 'short');
  m.teams[0].tactics.mentality = 'push';
  m.mode = 'play';
  m.startRestart('Goal kick', 0, m.abs(5.5, 0), 34);
  assert.equal(m.restart.routine, 'long');
});
