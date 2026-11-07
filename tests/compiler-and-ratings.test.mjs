import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCSV, compileRows, compilePlayer } from '../scripts/compile-players.mjs';
import { Match } from '../app/core/sim/engine.js';
import {
  ATTRS,
  OVERALL_WEIGHTS,
  overallRating,
  calibratedRoleAbility,
  positionFamiliarity,
  passingAbility,
  normalizeAttributes,
  playerTier,
} from '../app/core/players/ratings.js';
import { simulateComplete } from '../app/core/sim/replay.js';
import { loadRuntimeCatalog } from '../scripts/data/catalog-file.mjs';
const fixture = parseCSV(
  readFileSync(new URL('./fixtures/fc26-sample.csv', import.meta.url), 'utf8'),
);
const catalog = loadRuntimeCatalog();
const setup = (seed = 77) => {
  const m = new Match(seed, 300);
  m.mode = 'play';
  for (const p of m.players) {
    p.x = 5;
    p.y = 5;
    p.vx = p.vy = 0;
    p.cooldown = 0;
  }
  return m;
};

test('CSV parsing preserves quotes, commas, unicode and embedded newlines', () => {
  assert.deepEqual(parseCSV('\uFEFFid,name,note\r\n1,"René, Jr.","a ""quote""\nand a line"\r\n'), [
    { id: '1', name: 'René, Jr.', note: 'a "quote"\nand a line' },
  ]);
  assert.throws(() => parseCSV('a,b\n"unclosed,1'), /Unclosed/);
  assert.throws(() => parseCSV('a,b\n1,2,3'), /expected 2/);
});
test('compiler is deterministic and uses detailed fields even when keeper summaries are blank', () => {
  const a = compileRows(fixture, { first: 2, goalkeepers: 2, sourceHash: 'fixture' }),
    b = compileRows(fixture, { first: 2, goalkeepers: 2, sourceHash: 'fixture' });
  assert.deepEqual(a, b);
  assert.equal(a.players.length, 4);
  const p = a.players[0],
    r = fixture[0];
  assert.equal(p.attrs.pace, Number(r.movement_sprint_speed));
  assert.equal(p.attrs.acceleration, Number(r.movement_acceleration));
  assert.equal(p.attrs.shortPassing, Number(r.attacking_short_passing));
  assert.equal(p.attrs.shooting, Number(r.attacking_finishing));
  assert.equal(
    p.attrs.awareness,
    Math.round(Number(r.defending_marking_awareness) * 0.7 + Number(r.movement_reactions) * 0.3),
  );
  for (const g of a.players.filter(p => p.primaryPosition === 'GK')) {
    assert.equal(g.attrs.goalkeeping, g.sourceOverall);
    assert.equal(g.overall, g.sourceOverall);
    assert.ok(g.attrs.pace > 0);
  }
  for (const p of a.players) {
    assert.equal(p.source.sha256, 'fixture');
    assert.ok(p.source.compilerVersion);
    assert.ok(p.tags.length <= playerTier(p).capacity);
    assert.equal(new Set(p.tags).size, p.tags.length);
    for (const key of Object.keys(ATTRS))
      assert.ok(Number.isFinite(p.attrs[key]) && p.attrs[key] >= 1 && p.attrs[key] <= 99, key);
  }
});
test('compiler rejects missing abilities, invalid stars and duplicated player IDs', () => {
  assert.throws(() => compilePlayer({ ...fixture[0], skill_dribbling: '' }, 1), /invalid/);
  assert.throws(() => compilePlayer({ ...fixture[0], weak_foot: '3.5' }, 1), /invalid/);
  assert.throws(() => compileRows([fixture[0], fixture[0]]), /Duplicate/);
});
test('league catalog contains verified real players with reproducible provenance', () => {
  assert.equal(catalog.players.length, 7733);
  assert.equal(new Set(catalog.players.map(p => p.profileId)).size, 7733);
  assert.equal(catalog.players.filter(p => p.primaryPosition === 'GK').length, 765);
  assert.deepEqual(catalog.selection.expansion, { outfield: 1000, goalkeepers: 100 });
  assert.equal(catalog.leagues.length, 50);
  assert.equal(catalog.leagues.filter(l => l.playerCount >= 5).length, 40);
  for (const l of catalog.leagues) {
    const ps = catalog.players.filter(p => p.source.leagueId === l.id);
    assert.equal(ps.length, l.playerCount);
    if (l.tier === 'A') assert.equal(ps.length, l.sourcePlayers);
  }
  assert.ok(!catalog.players.some(p => p.source.leagueId === '7'));
  assert.equal(
    catalog.source.sha256,
    '4399cb2bcc2a14a2872e76a118f8f4bf64d7954503949c75751a14f33863e3b2',
  );
  for (const p of catalog.players) {
    assert.match(p.profileId, /^ea:\d+:fc26:u4$/);
    assert.ok(p.source.clubId);
    assert.ok(!('playerType' in p));
  }
});
test('position familiarity distinguishes main, secondary, adjacent and unrelated roles', () => {
  const p = {
    role: 'ST',
    primaryPosition: 'ST',
    secondaryPositions: [],
    attrs: normalizeAttributes(Object.fromEntries(Object.keys(ATTRS).map(k => [k, 80]))),
  };
  assert.equal(positionFamiliarity(p), 1);
  assert.equal(overallRating(p), 81);
  assert.ok(overallRating(p, false, 'CB') < 65);
  p.primaryPosition = 'RB';
  p.secondaryPositions = ['CB'];
  assert.ok(calibratedRoleAbility(p, 'CB') - overallRating(p, false, 'CB') < 1.2);
  p.primaryPosition = 'RW';
  p.secondaryPositions = [];
  assert.ok(calibratedRoleAbility(p, 'RM') - overallRating(p, false, 'RM') < 1.2);
  const before = overallRating(p, false, 'RM');
  p.x = 95;
  p.y = 34;
  assert.equal(overallRating(p, false, 'RM'), before, 'roaming does not change familiarity');
});
test('unfamiliar positions noticeably weaken tackling and decisions while preserving physical speed', () => {
  const results = [];
  for (const primaryPosition of ['CB', 'ST']) {
    const m = setup(),
      p = m.players[2],
      a = m.players[20];
    p.primaryPosition = primaryPosition;
    p.x = 50;
    p.y = 34;
    a.x = 49.2;
    a.y = 34;
    a.facing = 0;
    p.attrs.defending = 85;
    p.attrs.awareness = 85;
    p.attrs.vision = 80;
    const win = m.challengeModel(a, p).win,
      speed = p.topSpeed();
    m.own(p);
    m.rng = 99;
    m.decide(p);
    results.push({ win, speed, think: p.think, reading: p.awareness() });
  }
  assert.equal(results[0].speed, results[1].speed);
  assert.ok(results[1].win < results[0].win - 0.1);
  assert.ok(results[1].think > results[0].think * 1.5);
  assert.ok(results[1].reading < results[0].reading * 0.75);
});
test('every outfield detail contributes to every outfield role overall; GK overall stays one rating', () => {
  for (const [role, weights] of Object.entries(OVERALL_WEIGHTS)) {
    assert.ok(Math.abs(Object.values(weights).reduce((s, v) => s + v, 0) - 100) < 1e-9);
    if (role === 'GK') {
      assert.deepEqual(weights, { goalkeeping: 100 });
      continue;
    }
    for (const k of Object.keys(ATTRS).filter(k => k !== 'goalkeeping'))
      assert.ok(weights[k] > 0, `${role}: ${k}`);
  }
});
test('FC alignment improves across the catalog with 50–75 Superstars and no source-overall shortcut', () => {
  const ps = catalog.players,
    superstars = ps.filter(p => playerTier(p).name === 'Superstar');
  assert.ok(superstars.length >= 50 && superstars.length <= 75);
  const mae =
    ps.reduce(
      (n, p) => n + Math.abs(overallRating(p, true, p.primaryPosition) - p.sourceOverall),
      0,
    ) / ps.length;
  assert.ok(mae < 0.6);
  const yamal = ps.find(p => p.name === 'Lamine Yamal'),
    olmo = ps.find(p => p.name === 'Dani Olmo'),
    garcia = ps.find(p => p.name === 'Joan García');
  assert.ok(Math.abs(overallRating(yamal, true, 'RM') - yamal.sourceOverall) <= 1);
  assert.ok(overallRating(yamal, true, 'RM') > overallRating(olmo, true, 'AM'));
  assert.ok(overallRating(yamal, true, 'RM') > overallRating(garcia, true, 'GK'));
  const changed = structuredClone(yamal);
  changed.sourceOverall = 1;
  assert.equal(overallRating(changed, true, 'RM'), overallRating(yamal, true, 'RM'));
  const striker = structuredClone(ps.find(p => p.primaryPosition === 'ST'));
  striker.attrs.heading = 60;
  const before = overallRating(striker, false, 'ST');
  striker.attrs.heading += 10;
  assert.ok(Math.abs(overallRating(striker, false, 'ST') - before - 1.4) < 1e-8);
});
test('acceleration changes early movement and arrival estimates without changing top speed', () => {
  const results = [];
  for (const acceleration of [25, 95]) {
    const m = setup(),
      p = m.players[9];
    p.x = 30;
    p.y = 34;
    p.attrs.pace = 80;
    p.attrs.acceleration = acceleration;
    const arrival = p.arrival({ x: 40, y: 34 }),
      top = p.topSpeed();
    p.aim(90, 34, 'run', 'Running');
    for (let n = 0; n < 45; n++) m.move(p, 1 / 60);
    results.push({ distance: p.x - 30, arrival, top });
  }
  assert.equal(results[0].top, results[1].top);
  assert.ok(results[1].distance > results[0].distance * 1.5);
  assert.ok(results[1].arrival < results[0].arrival);
});
for (const [key, d, delivery] of [
  ['shortPassing', 10, 'pass'],
  ['longPassing', 42, 'through'],
  ['crossing', 24, 'cross'],
])
  test(`${key} improves its actual delivery while other abilities stay fixed`, () => {
    const errors = [];
    for (const value of [25, 95]) {
      const m = setup(),
        p = m.players[6],
        r = m.players[8];
      p.x = 35;
      p.y = 34;
      p.attrs[key] = value;
      let error = 0;
      for (let n = 0; n < 300; n++) {
        m.pass(p, { r, aim: { x: 35 + d, y: 34 }, d, delivery });
        error += Math.abs(m.ball.destination.y - 34);
      }
      errors.push(error);
    }
    assert.ok(errors[1] < errors[0] * 0.6, JSON.stringify(errors));
  });
test('delivery skill blends smoothly with distance; crossing and cutbacks use their own skills', () => {
  const m = setup(),
    p = m.players[6];
  p.tags = [];
  p.attrs.shortPassing = 90;
  p.attrs.longPassing = 30;
  p.attrs.crossing = 10;
  assert.equal(passingAbility(p, 10), p.skill('shortPassing'));
  assert.equal(passingAbility(p, 40), p.skill('longPassing'));
  assert.ok(passingAbility(p, 26) < 90 && passingAbility(p, 26) > 30);
  assert.ok(passingAbility(p, 26, 'cross') < passingAbility(p, 26, 'cutback'));
});
for (const [key, x, context] of [
  ['longShots', 74, {}],
  ['penalties', 94, { penalty: true }],
  ['heading', 94, { aerialHeight: 2 }],
])
  test(`${key} changes on-target outcomes for its shot type`, () => {
    const outcomes = [];
    for (const value of [25, 95]) {
      const m = setup(),
        p = m.players[9];
      p.x = x;
      p.y = 34;
      p.attrs[key] = value;
      let on = 0;
      for (let n = 0; n < 700; n++) {
        m.shoot(p, context);
        if (m.projectedOnTarget()) on++;
      }
      outcomes.push(on);
    }
    assert.ok(outcomes[1] > outcomes[0] + 100, JSON.stringify(outcomes));
  });
test('defensive awareness improves anticipation independently of tackling', () => {
  const m = setup(),
    d = m.players[13],
    a = m.players[9];
  d.x = 78;
  d.y = 40;
  a.x = 70;
  a.y = 30;
  a.vx = 6;
  a.vy = 1;
  d.attrs.awareness = 25;
  const low = m.markingPoint(1, a, d);
  d.attrs.awareness = 95;
  const high = m.markingPoint(1, a, d);
  assert.ok(high.x > low.x + 0.5);
  assert.equal(d.attrs.defending, m.players[2].attrs.defending);
});
test('structured fluidity allows clear runs but pulls ordinary support toward shape', () => {
  const m = setup(),
    p = m.players[6],
    anchor = { x: 60, y: 22 },
    target = { x: 80, y: 40 };
  m.setTactic(0, 'fluidity', 1);
  const rigid = m.supportTarget(p, target, anchor),
    run = m.supportTarget(p, target, anchor, true);
  m.setTactic(0, 'fluidity', 5);
  const free = m.supportTarget(p, target, anchor);
  const deviation = q => Math.hypot(q.x - anchor.x, q.y - anchor.y);
  assert.ok(deviation(rigid) < deviation(free) * 0.65);
  assert.ok(deviation(run) > deviation(free) * 0.85);
  assert.ok(Number.isFinite(free.x));
});
test('fluidity does not reward distant marks, and lowest fluidity keeps ordinary support onside', () => {
  const m = setup(),
    d = m.players[2],
    a = m.players[20];
  d.x = 40;
  d.y = 26;
  a.x = 48;
  a.y = 65;
  m.ball.x = 70;
  m.ball.y = 34;
  m.setTactic(0, 'fluidity', 3);
  const normal = m.assignmentCost(d, a);
  m.setTactic(0, 'fluidity', 5);
  assert.equal(m.assignmentCost(d, a), normal);
  m.setTactic(0, 'fluidity', 1);
  const carrier = m.players[6];
  carrier.x = 63;
  carrier.y = 34;
  for (const q of m.players.filter(q => q.team === 1)) {
    q.x = q.role === 'GK' ? 99 : 73;
    q.y = 3 + q.slot * 5;
  }
  m.own(carrier);
  m.elapsed = 0;
  m.plan();
  for (const p of m.players.filter(
    p => p.team === 0 && ['LW', 'RW', 'ST'].includes(p.role) && p.intent !== 'run',
  ))
    assert.ok(p.tx <= 73, 'support stays onside');
});
test('compiled identity, detailed attributes and positions survive swaps, reset, export and instant', async () => {
  const m = new Match(9, 300),
    profile = catalog.players[0];
  assert.equal(m.setPlayerProfile(6, profile), true);
  assert.equal(m.setPlayerProfile(7, profile), false);
  assert.equal(m.swapLineup(6, 9), true);
  const before = m.playerProfile(m.players[9]),
    config = m.exportConfig();
  m.reset();
  assert.deepEqual(m.playerProfile(m.players[9]), before);
  assert.equal(m.players[9].id, 9);
  assert.equal(m.players[9].role, 'ST');
  assert.equal(m.players[9].primaryPosition, profile.primaryPosition);
  const result = await simulateComplete(config, 9, false);
  assert.deepEqual(result.result.playerProfile(result.result.players[9]), before);
  assert.equal(result.result.teams[0].tactics.fluidity, 3);
  assert.equal(result.result.setPlayerProfile(6, profile), false);
});
