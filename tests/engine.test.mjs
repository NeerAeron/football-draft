import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, LENGTHS, ATTRS } from '../app/core/sim/engine.js';

test('full matches finish with finite positions, valid stats, and varied play', () => {
  for (const duration of [180, 300]) {
    const seed = 42;
    const m = new Match(seed, duration),
      seen = new Set();
    const log = m.addEvent;
    m.addEvent = function (text, team, type) {
      seen.add(type);
      return log.call(this, text, team, type);
    };
    let steps = 0;
    while (!m.finished && steps++ < 75000) {
      m.step(1 / 60);
      if (steps % 300 === 0) {
        for (const p of m.players)
          assert.ok(
            Number.isFinite(p.x) &&
              Number.isFinite(p.y) &&
              p.x >= 0 &&
              p.x <= 105 &&
              p.y >= 0 &&
              p.y <= 68,
          );
        assert.ok(Number.isFinite(m.ball.x) && Number.isFinite(m.ball.y));
      }
    }
    assert.equal(m.finished, true);
    assert.ok(m.time >= 5400);
    assert.equal(m.half, 2);
    for (const stat of m.stats) {
      assert.ok(stat.completed <= stat.passes);
      assert.ok(stat.onTarget <= stat.shots);
      assert.ok(stat.passes > 4);
      assert.ok(stat.possession > 0);
    }
    for (const event of ['half', 'full']) assert.ok(seen.has(event), event);
  }
});

test('same seed and inputs produce the same match state', () => {
  const a = new Match(88),
    b = new Match(88);
  for (let i = 0; i < 6000; i++) {
    a.step(1 / 60);
    b.step(1 / 60);
  }
  assert.deepEqual(a.ball, b.ball);
  assert.deepEqual(a.score, b.score);
  assert.deepEqual(a.stats, b.stats);
});

test('new match clears transient intentions while retaining user edits', () => {
  const m = new Match(42);
  m.players[6].runs = 800;
  m.players[6].think = 1;
  m.players[6].attrs.passing = 99;
  m.setTactic(0, 'formation', '442');
  m.reset();
  assert.equal(m.players[6].runs, 0);
  assert.equal(m.players[6].think, 0);
  assert.equal(m.players[6].attrs.passing, 99);
  assert.equal(m.teams[0].tactics.formation, '442');
  assert.equal(m.time, 0);
});

test('goals belong to the attacking team before and after switching ends', () => {
  for (const half of [1, 2]) {
    const m = new Match(1);
    m.half = half;
    m.mode = 'play';
    m.ball.x = half === 1 ? 106 : -1;
    m.ball.y = 34;
    m.ball.z = 0.1;
    m.checkBounds();
    assert.deepEqual(m.score, [1, 0]);
    assert.equal(m.restart.team, 1);
    assert.equal(m.restart.type, 'Goal');
  }
});

test('sideline and end-line exits produce the correct restart', () => {
  const m = new Match(1);
  m.mode = 'play';
  m.ball.x = 40;
  m.ball.y = -0.2;
  m.ball.lastTouch = 0;
  m.checkBounds();
  assert.equal(m.restart.type, 'Throw-in');
  assert.equal(m.restart.team, 1);
  m.mode = 'play';
  m.ball.x = 106;
  m.ball.y = 20;
  m.ball.lastTouch = 1;
  m.checkBounds();
  assert.equal(m.restart.type, 'Corner');
  assert.equal(m.restart.team, 0);
  m.mode = 'play';
  m.ball.x = 106;
  m.ball.y = 20;
  m.ball.lastTouch = 0;
  m.checkBounds();
  assert.equal(m.restart.type, 'Goal kick');
  assert.equal(m.restart.team, 1);
});

test('better shooting increases on-target rate in matched shot trials', () => {
  const outcomes = [];
  for (const shooting of [25, 90]) {
    const m = new Match(987);
    const p = m.players[9];
    for (const q of m.players) {
      q.x = 10;
      q.y = 2;
    }
    p.x = 85;
    p.y = 34;
    p.attrs.shooting = shooting;
    let target = 0;
    for (let i = 0; i < 1800; i++) {
      m.shoot(p);
      if (m.projectedOnTarget()) target++;
    }
    outcomes.push(target / 1800);
  }
  assert.ok(outcomes[1] > outcomes[0] + 0.2, JSON.stringify(outcomes));
});

test('better passing reduces delivery error in matched trials', () => {
  const errors = [];
  for (const passing of [25, 90]) {
    const m = new Match(987),
      p = m.players[6],
      r = m.players[8];
    for (const q of m.players) {
      q.x = 5;
      q.y = 5;
    }
    p.x = 40;
    p.y = 34;
    r.x = 65;
    r.y = 34;
    p.attrs.passing = passing;
    let total = 0;
    for (let i = 0; i < 1800; i++) {
      m.pass(p, { r, aim: { x: 65, y: 34 }, d: 25 });
      const b = m.ball;
      total += Math.abs(b.y + (b.vy * (65 - b.x)) / b.vx - 34);
    }
    errors.push(total / 1800);
  }
  assert.ok(errors[1] < errors[0] * 0.4, JSON.stringify(errors));
});

test('keeper-held possession is protected with an attacker at contact distance', () => {
  const m = new Match(14, 180);
  m.mode = 'play';
  const g = m.players[0],
    a = m.players[20];
  g.x = 5;
  g.y = 34;
  a.x = 5.6;
  a.y = 34;
  a.attrs.defending = 99;
  g.attrs.dribbling = 1;
  m.own(g, true);
  m.ball.x = g.x + 0.3;
  m.ball.y = g.y;
  for (let i = 0; i < 600; i++) {
    a.cooldown = 0;
    assert.equal(m.duel(g, a), false);
  }
  for (let i = 0; i < 35; i++) m.step(1 / 60);
  assert.equal(m.ball.owner, g.id);
  assert.equal(m.ball.kind, 'held');
  assert.equal(m.stats[1].tackles, 0);
});

test('keeper distribution does not roll the ball into an attacker immediately ahead', () => {
  const m = new Match(16, 180);
  m.mode = 'play';
  const g = m.players[0],
    a = m.players[20];
  for (const p of m.players) {
    p.x = p.team ? 60 : 28;
    p.y = p.slot % 2 ? 12 : 56;
    p.vx = p.vy = 0;
  }
  g.x = 5;
  g.y = 34;
  a.x = 8;
  a.y = 34;
  m.own(g, true);
  g.hold = 4;
  m.decide(g);
  assert.ok(m.ball.kind === 'held' || m.ball.kind === 'pass');
  if (m.ball.kind === 'pass')
    assert.ok(Math.abs(Math.atan2(m.ball.vy, m.ball.vx)) > 0.08 || m.ball.vz >= 5.5);
});

test('a goal-side defender closes diagonally after the original defender is beaten', () => {
  const m = new Match(3);
  m.mode = 'play';
  const carrier = m.players[9];
  for (const p of m.players) {
    p.x = p.team ? 96 : 30;
    p.y = 62;
    p.vx = p.vy = 0;
  }
  carrier.x = 67;
  carrier.y = 24;
  carrier.vx = 6;
  carrier.vy = 0;
  const beaten = m.players[13],
    interceptor = m.players[14],
    cover = m.players[12];
  beaten.x = 61;
  beaten.y = 24;
  interceptor.x = 75;
  interceptor.y = 32;
  cover.x = 80;
  cover.y = 19;
  m.own(carrier);
  carrier.vx = 6;
  m.ball.x = 67.7;
  m.ball.y = 24;
  m.presser[1] = beaten.id;
  m.plan();
  const closer = m.players[m.presser[1]];
  assert.notEqual(closer.id, beaten.id);
  assert.equal(closer.intent, 'press');
  assert.ok(Math.abs(closer.ty - closer.y) > 2);
  assert.ok(Math.abs(closer.tx - closer.x) > 0.4);
  const covers = m.players.filter(p => p.team === 1 && p.intent === 'cover');
  assert.equal(covers.length, 1);
  assert.ok(Math.hypot(covers[0].tx - closer.tx, covers[0].ty - closer.ty) > 2);
});

test('continuous lengths include regulation plus seeded added time', () => {
  assert.deepEqual(LENGTHS, { full: 300, quick: 180, highlights: 60, instant: 0 });
  for (const duration of [180, 300]) {
    const m = new Match(4, duration);
    let ticks = 0;
    while (!m.finished && ticks < (duration + 50) * 60) {
      m.step(1 / 60);
      ticks++;
    }
    assert.ok(m.finished);
    assert.ok(m.elapsed >= m.expectedDuration() - 0.001);
    assert.ok(m.elapsed < m.expectedDuration() + 10);
    assert.ok(m.time >= 5400);
  }
});

test('match length cannot multiply player movement or shot velocity', () => {
  const outcomes = [];
  for (const duration of [180, 300]) {
    const m = new Match(9, duration),
      p = m.players[9];
    for (const q of m.players) {
      q.x = 2;
      q.y = 2;
    }
    p.x = 30;
    p.y = 34;
    p.vx = p.vy = 0;
    p.aim(90, 34, 'run', 'Running');
    for (let i = 0; i < 120; i++) {
      p.energy = 1;
      m.move(p, 1 / 60);
    }
    p.energy = 1;
    const travel = { x: p.x, y: p.y, vx: p.vx };
    m.rng = 123;
    m.shoot(p);
    travel.shot = Math.hypot(m.ball.vx, m.ball.vy);
    outcomes.push(travel);
  }
  for (const key of ['x', 'y', 'vx', 'shot']) {
    assert.ok(Math.abs(outcomes[0][key] - outcomes[1][key]) < 1e-9);
  }
});

test('pace and shot power produce measurable physical differences', () => {
  const distances = [],
    velocities = [];
  for (const rating of [20, 95]) {
    const m = new Match(9),
      p = m.players[9];
    for (const q of m.players) {
      q.x = 2;
      q.y = 2;
    }
    p.x = 30;
    p.y = 34;
    p.vx = p.vy = 0;
    p.attrs.pace = rating;
    p.attrs.power = rating;
    p.aim(90, 34, 'run', 'Running');
    for (let i = 0; i < 180; i++) m.move(p, 1 / 60);
    distances.push(p.x - 30);
    m.shoot(p);
    velocities.push(Math.hypot(m.ball.vx, m.ball.vy));
    assert.equal(m.effects.at(-1).type, 'shot');
    assert.ok(m.effects.at(-1).speed > 0);
  }
  assert.ok(distances[1] > distances[0] * 1.5);
  assert.ok(velocities[1] > velocities[0] * 1.5);
});

test('neutral teams have identical attributes, tags, and all tactics at level3', () => {
  const m = new Match(21);
  for (let i = 0; i < 11; i++) assert.deepEqual(m.players[i].attrs, m.players[i + 11].attrs);
  for (const t of m.teams)
    for (const key of ['tempo', 'width', 'press']) assert.equal(t.tactics[key], 3);
});

test('goal kicks use the keeper safety decision instead of a forced short pass', () => {
  const m = new Match(3);
  m.startRestart('Goal kick', 0, 5.5, 34, 0.01);
  m.stepRestart(0.02);
  assert.equal(m.ball.kind, 'held');
  assert.equal(m.ball.owner, 0);
  assert.equal(m.stats[0].passes, 0);
  const g = m.players[0],
    r = m.players[2];
  g.x = 5;
  g.y = 34;
  r.x = 21;
  r.y = 28;
  const defender = m.players[20];
  defender.x = 23;
  defender.y = 28;
  defender.vx = -5;
  const option = {
    r,
    aim: { x: r.x, y: r.y },
    d: 17,
    risk: 0,
    score: 20,
    margin: m.receiverMargin(g, r, r),
  };
  assert.equal(
    m.keeperOutlet(g, [option]),
    null,
    'a closing marker makes an apparently clear lane unsafe',
  );
});

test('new possession and passes cannot inherit assists or shot types', () => {
  const m = new Match(2),
    p = m.players[10],
    r = m.players[6];
  m.ball.assist = 5;
  m.ball.shotType = 'Volley';
  m.ball.goalCredit = { shooter: 9, assist: 5 };
  m.own(p);
  assert.equal(m.ball.assist, null);
  assert.equal(m.ball.goalCredit, null);
  assert.equal(m.ball.shotType, null);
  m.pass(p, { r, aim: r, d: 25 });
  assert.equal(m.ball.assist, null);
  assert.equal(m.ball.shotType, null);
});

test('a deflected shot retains the original scorer and legitimate assist', () => {
  const m = new Match(2);
  m.mode = 'play';
  m.ball.x = 106;
  m.ball.y = 34;
  m.ball.z = 0.2;
  m.ball.kicker = 11;
  m.ball.goalCredit = {
    shooter: 9,
    assist: 6,
    origin: { x: 94, y: 34, box: true },
    shotType: 'Power shot',
  };
  m.checkBounds();
  assert.equal(m.players[9].stats.goals, 1);
  assert.equal(m.players[6].stats.assists, 1);
  assert.equal(m.goalHistory[0].ownGoal, false);
  assert.equal(m.stats[0].boxGoals, 1);
});

test('ordinary passes stay quiet, and tackle flair waits for secured possession', () => {
  const m = new Match(2),
    p = m.players[6],
    r = m.players[7];
  m.pass(p, { r, aim: r, d: 15 });
  assert.equal(m.effects.length, 0);
  assert.equal(m.events.filter(e => e.type === 'pass').length, 0);
  m.pendingTackle = { id: 13, team: 1, at: m.elapsed, chance: 0.65, strength: 0.7, hard: true };
  m.own(m.players[14]);
  assert.equal(m.stats[1].tackles, 1);
  assert.equal(m.players[13].stats.tackles, 1);
  assert.equal(m.events[0].type, 'tackle');
});

test('badge edits enforce eligibility, uniqueness and the tier minimum', () => {
  const m = new Match(1),
    p = m.players[0],
    valid = m.setTags(0, ['safehands', 'safehands', 'made-up', 'dribbler', 'reflexes']);
  assert.equal(new Set(valid).size, valid.length);
  assert.ok(valid.includes('safehands') && valid.includes('reflexes'));
  assert.ok(!valid.includes('dribbler') && !valid.includes('made-up'));
  assert.ok(valid.length >= 5 && valid.length <= 7);
  m.setTags(0, []);
  assert.equal(p.tags.length, 5);
});

test('pass launch speed accounts for the actual lead destination', () => {
  const m = new Match(22),
    p = m.players[6],
    r = m.players[9];
  p.x = 35;
  p.y = 34;
  r.x = 50;
  r.y = 34;
  p.attrs.passing = 99;
  m.pass(p, { r, aim: { x: 65, y: 34 }, d: 15 });
  const speed = Math.hypot(m.ball.vx, m.ball.vy),
    distance = Math.hypot(m.ball.destination.x - p.x, m.ball.destination.y - p.y);
  assert.ok(
    (speed * speed) / (2 * 3.8) > distance + 15,
    'the ball can reach the led runner without stopping short',
  );
});

test('a pass entering the goal records where it was actually kicked', () => {
  const m = new Match(4),
    p = m.players[6],
    r = m.players[9];
  p.x = 75;
  p.y = 34;
  m.pass(p, { r, aim: { x: 105, y: 34 }, d: 30 });
  p.x = 95;
  m.mode = 'play';
  m.ball.x = 106;
  m.ball.y = 34;
  m.ball.z = 0.2;
  m.checkBounds();
  assert.equal(m.goalHistory[0].origin.x, 75);
  assert.equal(m.goalHistory[0].box, false);
  assert.equal(m.goalHistory[0].assistId, undefined);
});

test('a keeper checks the release lane and can throw a clearance above a nearby attacker', () => {
  const m = new Match(1008),
    g = m.players[0],
    r = m.players[5],
    a = m.players[20];
  for (const p of m.players) {
    p.x = 60;
    p.y = 60;
  }
  g.x = 5;
  g.y = 34;
  r.x = 35;
  r.y = 34;
  a.x = 6.1;
  a.y = 34;
  const outlet = { r, aim: { x: 35, y: 34 }, d: 30, score: 8, margin: 2, risk: 0 };
  assert.equal(m.keeperReleaseClear(g, outlet.aim), false);
  assert.equal(m.keeperOutlet(g, [outlet]), null);
  m.own(g, true);
  m.pass(g, { ...outlet, loft: true, delivery: 'clearance' });
  assert.ok(m.ball.z > 1.5);
  assert.ok(m.ball.vz > 0);
  m.moveBall(1 / 60);
  assert.notEqual(m.ball.owner, a.id);
});

test('ratings read inside a step follow in-place edits made between steps', () => {
  const m = new Match(5, 180),
    p = m.players[7];
  // Run `read` while a step is active (the per-step cache and its memo are in use).
  const inStep = read => {
    let value;
    m.stepInner = () => (value = read());
    m.step(1 / 60);
    delete m.stepInner;
    return value;
  };
  // Outside a step every reader computes from scratch: the reference value.
  const check = (read, label) => {
    const before = inStep(read);
    return edit => {
      edit();
      const after = inStep(read);
      assert.equal(after, read(), `${label}: step value matches a fresh read`);
      assert.notEqual(after, before, `${label}: the edit is visible`);
    };
  };
  p.tags = [];
  for (const key of Object.keys(ATTRS))
    check(() => p.skill(key), `attrs.${key}`)(() => (p.attrs[key] += p.attrs[key] > 50 ? -20 : 20));
  check(() => p.skill('pace'), 'tags in place')(() => p.tags.push('speedster'));
  check(() => p.skill('pace'), 'tags entry')(() => (p.tags[0] = 'dribbler'));
  check(() => p.skill('dribbling'), 'attribute cap')(() => (m.tuning.badges.attributeCap = 1));
  check(() => p.skill('pace'), 'chemistry')(() => (p.chem = 2));
  check(() => p.skill('pace'), 'quality impact')(() => (m.tuning.gameplay.qualityImpact = 0.5));
  check(() => p.skill('pace'), 'new attrs object')(() => (p.attrs = { ...p.attrs, pace: 31 }));
  check(() => p.baseSpeed(), 'movement speed')(() => (m.tuning.gameplay.movementSpeed = 0.9));
  check(() => p.acceleration(), 'acceleration')(() => (m.tuning.gameplay.acceleration = 0.9));
  check(() => p.familiarity(), 'role')(() => (p.role = p.role === 'CB' ? 'ST' : 'CB'));
  check(() => p.familiarity(), 'primary position')(() => (p.primaryPosition = p.role));
  check(
    () => p.familiarity(),
    'familiarity tuning',
  )(() => {
    p.role = p.role === 'GK' ? 'ST' : 'GK';
    m.tuning.ratings.unfamiliarFit = 0.4;
  });
  check(() => p.awareness(), 'awareness')(() => (m.tuning.ratings.unfamiliarFit = 0.6));
  check(() => p.tendency('carry'), 'tendency attrs')(() => (p.attrs.dribbling = 99));
  check(() => p.tendency('carry'), 'stored tendency')(() => (p.tendencies.carry = 0.9));
  check(
    () => p.tendency('carry'),
    'tendency weight',
  )(() => (m.tuning.ratings.storedTendencyWeight = 0.1));
  check(
    () => p.tendency('carry'),
    'badge tendency',
  )(() => {
    p.tags = ['dribbler'];
    m.tuning.badges.tendencies.carry.dribbler = 0.3;
  });
  // A keeper's technique comes from the goalkeeping rating: the role matters.
  const keeper = m.players[0];
  check(() => keeper.skill('vision'), 'keeper role')(() => (keeper.role = 'CB'));
});
