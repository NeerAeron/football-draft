import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../app/core/sim/engine.js';
import { CONFIG_FIELDS, DEFAULT_CONFIG, normalizeConfig } from '../app/core/config/config.js';

function scene(half = 1, team = 0) {
  const m = new Match(239, 300);
  m.mode = 'play';
  m.elapsed = 10;
  m.half = half;
  for (const p of m.players)
    Object.assign(p, {
      x: m.abs(p.team === team ? 5 : 98, team),
      y: 4 + p.slot * 0.1,
      vx: 0,
      vy: 0,
      energy: 1,
      sprint: 1,
      sprintRest: 0,
      tags: [],
    });
  const p = m.players[team * 11 + 6],
    r = m.players[team * 11 + 7],
    q = m.players[(1 - team) * 11 + 2];
  Object.assign(p, { x: m.abs(38, team), y: 34, facing: m.direction(team) > 0 ? 0 : Math.PI });
  Object.assign(r, { x: m.abs(53, team), y: 32 });
  Object.assign(q, { x: m.abs(60, team), y: 36 });
  return { m, p, r, q };
}

test('control quality adds a modest advantage primarily on demanding touches', () => {
  const { m, r } = scene();
  Object.assign(m.ball, { kind: 'pass', deliveryDemand: 0.45 });
  const failure = (skill, influence) => {
    r.attrs.control = skill;
    m.tuning.gameplay.controlQuality = influence;
    return 1 - m.firstTouchChance(r, 0.35, 21, 0.7, true);
  };
  const oldRatio = failure(65, 0) / failure(90, 0),
    newRatio = failure(65, 0.9) / failure(90, 0.9);
  assert.ok(newRatio > oldRatio && newRatio < oldRatio * 1.5);
  assert.ok(failure(90, 0.9) < failure(90, 0));
  r.attrs.control = 60;
  m.ball.deliveryDemand = 0;
  assert.ok(
    m.firstTouchChance(r, 0, 16, 0, true) > 0.94,
    'ordinary passes to feet remain dependable for limited players',
  );
  r.attrs.control = 90;
  const fresh = m.firstTouchChance(r, 0.3, 22, 0.8, true);
  r.energy = 0.15;
  assert.ok(
    m.firstTouchChance(r, 0.3, 22, 0.8, true) < fresh,
    'elite technique does not remove fatigue',
  );
});

test('technical passing quality adds bounded scatter improvement without forcing completion', () => {
  const { m, p, r } = scene();
  m.noise = () => 1;
  m.executionPressure = () => 0.7;
  const error = (skill, influence) => {
    p.attrs.shortPassing = p.attrs.longPassing = p.attrs.composure = p.attrs.vision = skill;
    m.tuning.gameplay.passingQuality = influence;
    const aim = { x: r.x, y: r.y };
    m.pass(p, { r, aim, d: 15, delivery: 'pass' });
    assert.equal(m.ball.owner, null);
    return Math.hypot(m.ball.destination.x - aim.x, m.ball.destination.y - aim.y);
  };
  const oldRatio = error(65, 0) / error(90, 0),
    newRatio = error(65, 1) / error(90, 1);
  assert.ok(newRatio > oldRatio && newRatio < oldRatio * 1.5);
  assert.ok(error(90, 1) < error(90, 0));
  assert.equal(m.stats[p.team].completed, 0);
});

test('better defending adds anticipation in both directions without changing low-rated positioning', () => {
  for (const half of [1, 2])
    for (const team of [0, 1]) {
      const { m, p, q } = scene(half, team);
      p.vx = m.direction(team) * 6;
      q.attrs.awareness = q.attrs.defending = 65;
      m.tuning.gameplay.defensiveQuality = 0;
      const lowOld = m.markingPoint(q.team, p, q);
      m.tuning.gameplay.defensiveQuality = 1;
      assert.equal(q.defensiveReading(), 0);
      assert.deepEqual(m.markingPoint(q.team, p, q), lowOld);
      q.attrs.awareness = q.attrs.defending = 90;
      m.tuning.gameplay.defensiveQuality = 0;
      const old = m.markingPoint(q.team, p, q),
        speed = q.topSpeed(),
        acceleration = q.acceleration();
      m.tuning.gameplay.defensiveQuality = 1;
      const improved = m.markingPoint(q.team, p, q);
      assert.ok(
        (improved.x - old.x) * m.direction(team) > 0.5,
        'read ahead of the goalward runner',
      );
      assert.equal(q.topSpeed(), speed);
      assert.equal(q.acceleration(), acceleration);
      const fresh = q.defensiveReading();
      q.energy = 0.1;
      assert.ok(q.defensiveReading() < fresh);
    }
});

test('elite close defending follows the carrier while respecting physical speed and acceleration', () => {
  const follow = influence => {
    const { m, p, q } = scene();
    m.tuning.gameplay.defensiveQuality = influence;
    q.attrs.awareness = q.attrs.defending = 90;
    p.vx = 5;
    p.y = q.y;
    q.x = p.x + 2;
    q.vx = 0;
    m.ball.owner = p.id;
    // Give both defenders time to accelerate before comparing their tracking.
    for (let i = 0; i < 45; i++) {
      p.x += p.vx / 60;
      q.aim(q.x + 0.25, q.y, 'press', 'Closing the runner');
      const before = { vx: q.vx, vy: q.vy },
        limit = (q.acceleration() * (0.72 + q.energy * 0.28)) / 60;
      m.move(q, 1 / 60);
      assert.ok(Math.hypot(q.vx - before.vx, q.vy - before.vy) <= limit + 1e-9);
      assert.ok(Math.hypot(q.vx, q.vy) <= q.topSpeed() + 0.02);
    }
    return q.vx;
  };
  assert.ok(follow(1) > follow(0) + 0.5);
});

test('creative skill favors progressive opportunities rather than every passing option', () => {
  const { m, p, r, q } = scene();
  q.x = 95;
  q.y = 60;
  m.own(p);
  m.noise = () => 0;
  const value = (skill, influence, forward = true) => {
    p.attrs.shortPassing = p.attrs.longPassing = p.attrs.vision = p.attrs.composure = skill;
    m.tuning.gameplay.creativeQuality = influence;
    r.x = forward ? 53 : 28;
    return m.options(p).find(o => o.r === r && !o.loft).score;
  };
  assert.equal(value(65, 1), value(65, 0));
  assert.ok(value(90, 1) > value(90, 0) + 0.1);
  assert.equal(value(90, 1, false), value(90, 0, false));
});

test('elite passing technique cannot erase a blocked lane or a late receiver in decision estimates', () => {
  const { m, p, r } = scene();
  Object.assign(p.attrs, { shortPassing: 99, longPassing: 99, vision: 99, composure: 99 });
  r.attrs.control = 99;
  m.noise = () => 0;
  m.laneRisk = () => 0.8;
  m.receiverMargin = () => 0;
  const contested = m.options(p).find(o => o.r === r && !o.loft).chance;
  assert.ok(contested < 0.8);
  m.laneRisk = () => 0;
  m.receiverMargin = () => 1;
  assert.ok(m.options(p).find(o => o.r === r && !o.loft).chance > contested + 0.1);
  m.receiverMargin = () => -1.5;
  assert.ok(m.options(p).find(o => o.r === r && !o.loft).chance < contested);
});

test('a composed winger does not override a good feet pass to force a poor aerial delivery', () => {
  const { m, p, r, q } = scene();
  Object.assign(p, { x: 92, y: 9, hold: 0.6, receivedAt: 0 });
  Object.assign(p.attrs, { vision: 95, composure: 95 });
  m.ball.owner = p.id;
  m.pressure = () => 0.8;
  m.openCarry = () => null;
  const safe = { r, aim: r, d: 12, delivery: 'pass', chance: 0.94, score: 3, risk: 0.1, margin: 1 };
  const cross = {
    r: q,
    aim: q,
    d: 25,
    delivery: 'cross',
    chance: 0.35,
    score: 1.5,
    risk: 0.4,
    margin: 0.1,
  };
  m.options = () => [safe, cross];
  let chosen;
  m.pass = (_p, o) => {
    chosen = o;
  };
  m.decide(p);
  assert.equal(chosen, safe);
  cross.chance = 0.85;
  cross.score = 3.4;
  m.options = () => [cross, safe];
  m.decide(p);
  assert.equal(chosen, cross, 'a worthwhile cross remains an attacking option');
});

test('quality tuning is configurable and retains custom values through replay', () => {
  const input = structuredClone(DEFAULT_CONFIG);
  for (const key of ['controlQuality', 'passingQuality', 'defensiveQuality', 'creativeQuality']) {
    assert.ok(CONFIG_FIELDS.some(f => f.path === 'gameplay.' + key && f.min === 0));
    input.gameplay[key] = 0.37;
  }
  const { m } = scene();
  m.tuning = normalizeConfig(input);
  const replay = m.exportConfig();
  const other = new Match(240, 300);
  other.importConfig(replay);
  for (const key of ['controlQuality', 'passingQuality', 'defensiveQuality', 'creativeQuality'])
    assert.equal(other.tuning.gameplay[key], 0.37);
});

test('natural keeper technique uses the single GK rating without outfield placeholder penalties', () => {
  const { m, p } = scene(),
    g = m.players[0];
  Object.assign(g, { x: 4, y: 34 });
  Object.assign(g.attrs, { control: 30, heading: 12, goalkeeping: 90 });
  Object.assign(m.ball, { kind: 'loose', pendingPass: null, lastTouch: 1 });
  const strong = m.firstTouchChance(g, 1.3, 14, 0.2, false);
  g.attrs.goalkeeping = 60;
  assert.ok(m.firstTouchChance(g, 1.3, 14, 0.2, false) < strong);
  Object.assign(m.ball, {
    kind: 'pass',
    kicker: p.id,
    target: g.id,
    lastTouch: 0,
    deliveryDemand: 0,
  });
  const foot = m.firstTouchChance(g, 0, 16, 0, true);
  g.attrs.goalkeeping = 90;
  assert.ok(m.firstTouchChance(g, 0, 16, 0, true) > foot);
  assert.ok(foot > 0.95);
  g.attrs.shortPassing = 33;
  g.attrs.longPassing = 35;
  assert.equal(g.skill('shortPassing'), g.skill('goalkeeping'));
  assert.equal(g.skill('control'), g.skill('goalkeeping'));
  g.primaryPosition = 'CM';
  assert.ok(g.skill('control') < 40, 'an emergency keeper retains real outfield technique');
});

test('weak passing produces plausible visible errors instead of extreme random kicks', () => {
  const { m, p, r } = scene();
  p.attrs.shortPassing = p.attrs.longPassing = p.attrs.composure = p.attrs.vision = 35;
  r.x = p.x + 35;
  m.noise = () => 1;
  m.executionPressure = () => 1;
  m.pass(p, { r, aim: r, d: 35, delivery: 'through', loft: true });
  assert.ok(Math.hypot(m.ball.destination.x - r.x, m.ball.destination.y - r.y) < 8);
});

test('strong defensive organizers tighten teammates marking without changing their running attributes', () => {
  const { m, p, r, q } = scene();
  m.own(p);
  Object.assign(r, { x: 50, y: 38 });
  Object.assign(q, { x: 55, y: 40 });
  q.attrs.awareness = q.attrs.defending = 65;
  m.assignDefense = () => null;
  m.assignMarks = team => (team === q.team ? new Map([[q.id, r]]) : new Map());
  const gap = (quality, energy = 1) => {
    for (const a of m.players.filter(a => a.team === q.team && a.id !== q.id && a.role !== 'GK')) {
      a.attrs.awareness = a.attrs.composure = quality;
      a.energy = energy;
    }
    q.rethinkAt = 0;
    m.plan();
    const point = m.markingPoint(q.team, r, q);
    return Math.hypot(q.tx - point.x, q.ty - point.y);
  };
  const speed = q.topSpeed(),
    poor = gap(65),
    organized = gap(85),
    tired = gap(85, 0.1);
  assert.ok(organized < poor);
  assert.equal(q.topSpeed(), speed);
  assert.equal(q.defensiveReading(), 0);
  assert.ok(
    poor - tired > (poor - organized) * 0.65,
    'fatigue reduces coordination without erasing defensive knowledge',
  );
});

test('vision and composure help forwards read build-up without giving them tackling or pace', () => {
  const { m, p } = scene();
  p.attrs.awareness = 40;
  p.attrs.defending = 35;
  p.attrs.vision = p.attrs.composure = 90;
  m.tuning.gameplay.defensiveQuality = 1;
  const awareness = p.awareness(),
    tackle = p.tackling(),
    speed = p.topSpeed();
  assert.ok(p.pressAwareness() > awareness + 30);
  assert.ok(p.pressingReading() > 0.4);
  assert.equal(p.tackling(), tackle);
  assert.equal(p.topSpeed(), speed);
  assert.equal(p.defensiveReading(), 0);
  m.tuning.gameplay.defensiveQuality = 0;
  assert.equal(p.pressAwareness(), awareness);
  p.attrs.vision = p.attrs.composure = 45;
  m.tuning.gameplay.defensiveQuality = 1;
  assert.equal(p.pressAwareness(), awareness);
});

test('aerial pass decisions account for the recipients heading ability', () => {
  const { m, p, r } = scene();
  p.x = 80;
  p.y = 15;
  r.x = 95;
  r.y = 34;
  m.noise = () => 0;
  p.attrs.crossing = 90;
  r.attrs.control = 90;
  const chance = heading => {
    r.attrs.heading = heading;
    return m.options(p).find(o => o.r === r && o.delivery === 'cross').chance;
  };
  const strong = chance(90),
    weak = chance(35);
  // (He is alone here: with a man on him the gap is wider — gameplay.freeTouch.)
  assert.ok(strong > weak + 0.15, `${strong} against ${weak}`);
});

test('possession includes a traveling pass but excludes unresolved loose balls and restarts', () => {
  const { m, p } = scene();
  Object.assign(m.ball, {
    owner: null,
    kind: 'pass',
    kicker: p.id,
    target: null,
    missedReceiver: false,
    x: 35,
    y: 20,
    z: 0,
    vx: 10,
    vy: 0,
    vz: 0,
    age: 0,
  });
  m.step(1 / 60);
  assert.equal(m.stats[p.team].possession, 1 / 60);
  Object.assign(m.ball, { owner: null, kind: 'loose' });
  m.step(1 / 60);
  assert.equal(m.stats[p.team].possession, 1 / 60);
  m.startRestart('Throw-in', p.team, 35, 0.2, 1);
  m.step(1 / 60);
  assert.equal(m.stats[p.team].possession, 1 / 60);
});

test('technical composure resists nearby pressure while intelligent pressing raises it', () => {
  const { m, p, q } = scene();
  Object.assign(q, { x: p.x + 2, y: p.y });
  p.attrs.control = p.attrs.composure = 65;
  q.attrs.awareness = q.attrs.vision = q.attrs.composure = 65;
  const ordinary = m.executionPressure(p),
    physical = m.pressure(p);
  p.attrs.control = p.attrs.composure = 90;
  const composed = m.executionPressure(p);
  assert.ok(
    composed < ordinary && composed > ordinary * 0.85,
    'composure softens pressure without cancelling it',
  );
  q.attrs.awareness = q.attrs.vision = q.attrs.composure = 90;
  assert.ok(m.executionPressure(p) > composed);
  assert.ok(m.executionPressure(p) < ordinary);
  assert.equal(
    m.pressure(p),
    physical,
    'composure does not hide congestion from tactical decisions',
  );
  q.x = p.x + 6;
  assert.equal(m.executionPressure(p), 0, 'reading never creates pressure beyond physical reach');
});

test('coordinated outlet screening preserves backs and dangerous runners in both directions', () => {
  for (const half of [1, 2])
    for (const team of [0, 1]) {
      const { m, p, r, q } = scene(half, team),
        mid = m.players[(1 - team) * 11 + 6],
        defending = 1 - team;
      Object.assign(p, { x: m.abs(78, defending), y: 12 });
      Object.assign(r, { x: m.abs(82, defending), y: 33 });
      m.own(p);
      Object.assign(m.ball, { x: p.x, y: p.y });
      Object.assign(mid.attrs, { awareness: 90, defending: 90, vision: 90, composure: 90 });
      const old = m.markingPoint(defending, r, mid, 0),
        screen = m.markingPoint(defending, r, mid, 0.8);
      assert.ok(Math.hypot(screen.x - p.x, screen.y - p.y) < Math.hypot(old.x - p.x, old.y - p.y));
      assert.deepEqual(
        m.markingPoint(defending, r, q, 0.8),
        m.markingPoint(defending, r, q, 0),
        'backs keep goal-side cover',
      );
      r.vx = -m.direction(defending) * 8;
      assert.deepEqual(
        m.markingPoint(defending, r, mid, 0.8),
        m.markingPoint(defending, r, mid, 0),
        'a goalward runner is anticipated even high up the pitch',
      );
      r.vx = 0;
      r.x = m.abs(70, defending);
      assert.deepEqual(
        m.markingPoint(defending, r, mid, 0.8),
        m.markingPoint(defending, r, mid, 0),
        'forward outlets retain goal-side protection',
      );
      r.x = m.abs(35, defending);
      assert.deepEqual(
        m.markingPoint(defending, r, mid, 0.8),
        m.markingPoint(defending, r, mid, 0),
        'dangerous runners retain goal-side marking',
      );
    }
});

test('an organized frontline approaches deep build-up without overriding conservative tactics', () => {
  const { m, p } = scene(),
    team = 1 - p.team,
    q = m.players[team * 11 + 6];
  Object.assign(p, { x: m.abs(88, team), y: 34 });
  Object.assign(q, { x: m.abs(60, team), y: 34 });
  m.own(p);
  Object.assign(m.ball, { x: p.x, y: p.y });
  for (const a of m.players.filter(a => a.team === team))
    Object.assign(a.attrs, { awareness: 90, composure: 90 });
  m.assignDefense = t =>
    t === team ? { press: q.id, point: { x: p.x, y: p.y }, cover: null } : null;
  m.assignMarks = () => new Map();
  const approach = () => {
    q.rethinkAt = 0;
    m.plan();
    return q.action;
  };
  assert.equal(approach(), 'Advancing the press');
  assert.ok(Math.hypot(q.tx - p.x, q.ty - p.y) < Math.hypot(q.x - p.x, q.y - p.y));
  assert.ok(Math.hypot(q.tx - p.x, q.ty - p.y) > 0, 'approach remains a physical movement');
  m.teams[team].tactics.press = 1;
  assert.notEqual(approach(), 'Advancing the press');
  m.teams[team].tactics.press = 3;
  m.teams[team].tactics.style = 'bus';
  assert.notEqual(approach(), 'Advancing the press');
});

test('elite anticipation attacks a reachable passing lane without predicting past reception', () => {
  for (const half of [1, 2])
    for (const team of [0, 1]) {
      const { m, p, r } = scene(half, team),
        q = m.players[(1 - team) * 11 + 6],
        dir = m.direction(team);
      for (const a of m.players)
        if (a.team !== team)
          Object.assign(a.attrs, { awareness: 60, defending: 60, vision: 60, composure: 60 });
      Object.assign(q, { x: m.abs(54, team), y: 34.7 });
      Object.assign(r, { x: m.abs(68, team), y: 34 });
      Object.assign(m.ball, {
        owner: null,
        kind: 'pass',
        kicker: p.id,
        target: r.id,
        x: m.abs(45, team),
        y: 34,
        z: 0,
        vx: dir * 18,
        vy: 0,
        vz: 0,
        passCraft: 65,
        missedReceiver: false,
        destination: { x: r.x, y: r.y },
      });
      assert.equal(m.readPassingLane(q.team, r), null);
      Object.assign(q.attrs, { awareness: 95, defending: 95, vision: 95, composure: 95 });
      const reading = m.readPassingLane(q.team, r);
      assert.equal(reading?.p.id, q.id);
      assert.ok((reading.point.x - m.ball.x) * dir > 0);
      assert.ok((reading.point.x - r.x) * dir < 0);
      q.cooldown = 1;
      assert.equal(
        m.readPassingLane(q.team, r),
        null,
        'an unavailable touch cannot be anticipated',
      );
      q.cooldown = 0;
      m.ball.destination = { x: m.abs(48, team), y: 34 };
      assert.equal(
        m.readPassingLane(q.team, r),
        null,
        'do not chase the ball after the intended reception',
      );
    }
});

test('coordinated marking avoids crossing assignments without freeing a dangerous runner', () => {
  const { m, p, r, q } = scene(),
    s = m.players[q.id + 1];
  m.activePlayers = [p, r, q, s];
  q.x = s.x = 55;
  m.threatValue = () => 0;
  const costs = new Map([
    [
      p.id,
      new Map([
        [q.id, 1],
        [s.id, 1.2],
      ]),
    ],
    [
      r.id,
      new Map([
        [q.id, 2],
        [s.id, 5],
      ]),
    ],
  ]);
  m.assignmentCost = (d, a) => costs.get(d.id).get(a.id);
  const ordinary = m.assignMarks(p.team, null, null, 0);
  assert.equal(ordinary.get(p.id), q);
  assert.equal(ordinary.get(r.id), s);
  const organized = m.assignMarks(p.team, null, null, 0.8);
  assert.equal(organized.get(p.id), s);
  assert.equal(organized.get(r.id), q);
  q.x = 25;
  const protectedRunner = m.assignMarks(p.team, null, null, 0.8);
  assert.equal(
    protectedRunner.get(p.id),
    q,
    'a shorter total route cannot leave the dangerous runner farther away',
  );
});

test('good readers close the expected first touch without losing recovery positioning', () => {
  for (const half of [1, 2])
    for (const team of [0, 1]) {
      const { m, r, q } = scene(half, team),
        defending = q.team;
      Object.assign(r, { x: m.abs(55, team), vx: m.direction(team) * 5, y: 34 });
      Object.assign(q, { x: m.abs(59, team), y: 35 });
      Object.assign(m.ball, {
        kind: 'pass',
        target: r.id,
        owner: null,
        missedReceiver: false,
        z: 0,
        deliveryOrigin: { x: m.abs(60, team), y: 34 },
        destination: { x: m.abs(57, team), y: 34 },
      });
      Object.assign(q.attrs, { awareness: 65, defending: 65, vision: 65, composure: 65 });
      assert.deepEqual(m.receiverPressPoint(defending, r, q), m.markingPoint(defending, r, q));
      Object.assign(q.attrs, { awareness: 95, defending: 95, vision: 95, composure: 95 });
      const old = m.markingPoint(defending, r, q),
        next = m.receiverPressPoint(defending, r, q, 0.6),
        end = m.ball.destination;
      assert.ok(
        Math.hypot(next.x - end.x, next.y - end.y) < Math.hypot(old.x - end.x, old.y - end.y),
      );
      assert.ok(m.rel(next.x, defending) < m.rel(end.x, defending), 'close from the goal side');
      m.ball.deliveryOrigin = { x: m.abs(35, team), y: 34 };
      assert.deepEqual(
        m.receiverPressPoint(defending, r, q, 0.6),
        m.markingPoint(defending, r, q, 0.6),
        'a forward delivery retains anticipation of the goalward runner',
      );
      m.ball.deliveryOrigin = { x: m.abs(60, team), y: 34 };
      m.ball.z = 1.5;
      assert.deepEqual(
        m.receiverPressPoint(defending, r, q, 0.6),
        m.markingPoint(defending, r, q, 0.6),
        'an aerial contest keeps its normal marking geometry',
      );
      m.ball.z = 0;
      q.x = m.abs(52, team);
      assert.deepEqual(
        m.receiverPressPoint(defending, r, q, 0.6),
        m.markingPoint(defending, r, q, 0.6),
        'a beaten defender still prioritizes recovery',
      );
    }
});

test('a coordinated outlet screen remains on the passing lane after team shape is applied', () => {
  for (const half of [1, 2])
    for (const team of [0, 1]) {
      const { m, p, r } = scene(half, team),
        defending = 1 - team,
        q = m.players[defending * 11 + 6];
      m.tuning.gameplay.defensiveQuality = 1;
      Object.assign(p, { x: m.abs(78, defending), y: 12 });
      Object.assign(r, { x: m.abs(82, defending), y: 58 });
      Object.assign(q, { x: m.abs(81, defending), y: 56 });
      for (const a of m.players.filter(a => a.team === defending))
        Object.assign(a.attrs, { awareness: 95, defending: 95, vision: 95, composure: 95 });
      m.own(p);
      Object.assign(m.ball, { x: p.x, y: p.y });
      m.assignDefense = () => null;
      m.assignMarks = t => (t === defending ? new Map([[q.id, r]]) : new Map());
      q.rethinkAt = 0;
      m.plan();
      const dx = r.x - p.x,
        dy = r.y - p.y,
        laneOffset = Math.abs((q.tx - p.x) * dy - (q.ty - p.y) * dx) / Math.hypot(dx, dy);
      assert.ok(
        laneOffset < 0.35,
        'a blanket x cushion must not pull the screen off a diagonal lane',
      );
      assert.ok(m.rel(q.tx, defending) < m.rel(r.x, defending), 'the screen remains goal-side');
    }
});

test('vision and composure stabilize passing reads, especially during pressured quick exchanges', () => {
  const { m, p, r } = scene();
  m.ball.owner = p.id;
  const uncertainty = (skill, pressure, age) => {
    Object.assign(p.attrs, {
      vision: skill,
      composure: skill,
      shortPassing: skill,
      longPassing: skill,
    });
    p.receivedAt = m.elapsed - age;
    m.pressure = () => pressure;
    m.noise = () => 0;
    const exact = m.options(p).find(o => o.r === r && !o.loft).score;
    m.noise = () => 1;
    return m.options(p).find(o => o.r === r && !o.loft).score - exact;
  };
  assert.ok(uncertainty(72, 0.8, 0.2) > uncertainty(95, 0.8, 0.2) * 5);
  assert.ok(uncertainty(72, 0.8, 0.2) > uncertainty(72, 0, 0.2));
  assert.ok(uncertainty(72, 0, 0.2) > uncertainty(72, 0, 1.5));
  assert.equal(m.ball.owner, p.id, 'perception never decides possession or a pass result');
});

test('nearby ratings improve passing and first touch gradually across the former elite threshold', () => {
  const { m, p, r } = scene();
  m.noise = () => 1;
  m.executionPressure = () => 0.7;
  const measure = rating => {
    r.attrs.control = rating;
    Object.assign(m.ball, { kind: 'pass', deliveryDemand: 0.45 });
    const touch = m.firstTouchChance(r, 0.35, 21, 0.7, true);
    Object.assign(p.attrs, {
      shortPassing: rating,
      longPassing: rating,
      vision: rating,
      composure: rating,
    });
    const aim = { x: r.x, y: r.y };
    m.pass(p, { r, aim, d: 15, delivery: 'pass' });
    return {
      touch,
      scatter: Math.hypot(m.ball.destination.x - aim.x, m.ball.destination.y - aim.y),
    };
  };
  for (const low of [70, 75, 78, 79, 80, 85]) {
    const a = measure(low),
      b = measure(low + 2);
    assert.ok(
      b.touch > a.touch && b.touch - a.touch < 0.015,
      'two control points give a small reception advantage',
    );
    assert.ok(
      b.scatter < a.scatter && b.scatter > a.scatter * 0.84,
      'two passing points cannot halve execution error',
    );
  }
  assert.equal(m.stats[p.team].completed, 0, 'accuracy still requires a physical reception');
});
