import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCSV, compileRows, compilePlayer } from '../scripts/compile-players.mjs';
import { compileLeagueCatalog } from '../scripts/compile-league-catalog.mjs';
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
test('league selection takes whole available leagues, and club-less players from a set overall', () => {
  const clubless = (row, id, overall) => ({
    ...row,
    player_id: id,
    club_team_id: '',
    club_name: '',
    league_id: '',
    league_name: '',
    overall: String(overall),
  });
  const rows = [...fixture, clubless(fixture[0], '900001', 66), clubless(fixture[1], '900002', 64)];
  const reference = {
    selection: { clublessMinimumOverall: 65 },
    leagues: [
      { id: '53', name: 'La Liga', tier: 'A', sourceLeagueId: '53', available: true },
      { id: '13', name: 'Premier League', tier: 'A', sourceLeagueId: '13', available: false },
    ],
    clubs: [{ sourceTeamId: '243', score: 99, rank: 1, tier: 'S', optaClubId: 'x' }],
    colors: [],
  };
  const catalog = compileLeagueCatalog(rows, reference, 'fixture');
  assert.deepEqual(
    catalog.players.map(p => p.profileId.split(':')[1]),
    ['252371', '239053', '192119', '900001'],
  );
  assert.deepEqual(catalog.players[3].source.club, null);
  assert.equal(catalog.players[3].source.leagueId, null);
  assert.equal(catalog.selection.clublessPlayers, 1);
  assert.deepEqual(
    catalog.leagues.map(l => l.playerCount),
    [3, 0],
  );
  assert.deepEqual(
    catalog.teams.map(t => [t.name, t.playerCount]),
    [['Real Madrid', 3]],
  );
  const off = compileLeagueCatalog(rows, { ...reference, selection: {} }, 'fixture');
  assert.equal(off.players.length, 3);
  reference.leagues[0].cap = 2;
  assert.throws(() => compileLeagueCatalog(rows, reference), /caps/);
});
test('compiler rejects missing abilities, invalid stars and duplicated player IDs', () => {
  assert.throws(() => compilePlayer({ ...fixture[0], skill_dribbling: '' }, 1), /invalid/);
  assert.throws(() => compilePlayer({ ...fixture[0], weak_foot: '3.5' }, 1), /invalid/);
  assert.throws(() => compileRows([fixture[0], fixture[0]]), /Duplicate/);
});
test('league catalog contains every player of every reviewed club plus the best club-less players', () => {
  assert.equal(catalog.players.length, 15788);
  assert.equal(new Set(catalog.players.map(p => p.profileId)).size, 15788);
  assert.equal(catalog.players.filter(p => p.primaryPosition === 'GK').length, 1719);
  assert.equal(catalog.selection.leaguePlayers, 14957);
  assert.equal(catalog.selection.clublessPlayers, 831);
  assert.equal(catalog.leagues.length, 50);
  assert.equal(catalog.leagues.filter(l => l.playerCount >= 5).length, 41);
  for (const l of catalog.leagues) {
    const ps = catalog.players.filter(p => p.source.leagueId === l.id);
    assert.equal(ps.length, l.playerCount);
    if (!l.available) assert.equal(ps.length, 0, l.name);
  }
  assert.ok(!catalog.players.some(p => p.source.leagueId === '7'));
  assert.equal(
    catalog.source.sha256,
    '18ed434e5bb90f9afa72363d14438005c785eb4b8872a64c89c75bb38e14e911',
  );
  const clubless = catalog.players.filter(p => !p.source.clubId);
  assert.equal(clubless.length, 831);
  assert.ok(clubless.every(p => p.sourceOverall >= 65));
  assert.ok(clubless.every(p => p.source.leagueId === null && p.source.club === null));
  for (const p of catalog.players) {
    assert.match(p.profileId, /^ea:\d+:fc27:u20260912$/);
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
  // A far move stays costly; a neighbouring role costs about a point on top of what the
  // role's own attribute weights say (EA's per-position ratings, docs/calibration.md).
  assert.ok(overallRating(p, false, 'CB') < 72);
  assert.ok(positionFamiliarity(p, 'CB') < 0.9);
  assert.ok(positionFamiliarity(p, 'GK') <= 0.6);
  for (const near of ['AM', 'LW', 'RW']) {
    const cost = calibratedRoleAbility(p, near) - overallRating(p, false, near);
    assert.ok(cost > 0 && cost < 2, near + ' ' + cost);
  }
  assert.ok(positionFamiliarity(p, 'AM') > positionFamiliarity(p, 'CM'));
  assert.ok(positionFamiliarity(p, 'CM') > positionFamiliarity(p, 'DM'));
  assert.ok(positionFamiliarity(p, 'DM') > positionFamiliarity(p, 'CB'));
  for (const [primary, role] of [
    ['CM', 'DM'],
    ['LW', 'LM'],
    ['DM', 'CB'],
    ['LB', 'RB'],
  ]) {
    const q = { ...p, primaryPosition: primary, role };
    assert.ok(positionFamiliarity(q, role) >= 0.975, primary + '>' + role);
  }
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
  assert.ok(results[1].win < results[0].win - 0.07);
  assert.ok(results[1].think > results[0].think * 1.25);
  assert.ok(results[1].reading < results[0].reading * 0.85);
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
test('FC alignment improves across the catalog with about as many Superstars as EA and no source-overall shortcut', () => {
  const ps = catalog.players,
    superstars = ps.filter(p => playerTier(p).name === 'Superstar');
  // 107 against the 96 players EA rates 85+; the top is level with EA, not under it.
  const ea = ps.filter(p => p.sourceOverall >= 85);
  assert.ok(Math.abs(superstars.length - ea.length) <= 12, 'Superstars: ' + superstars.length);
  const bias =
    ea.reduce((n, p) => n + overallRating(p, true, p.primaryPosition) - p.sourceOverall, 0) /
    ea.length;
  assert.ok(Math.abs(bias) < 0.25, 'EA 85+: ours − EA = ' + bias.toFixed(2));
  // A keeper's overall is his goalkeeping attribute, which is EA's overall: never stretched.
  for (const p of ps.filter(p => p.primaryPosition === 'GK'))
    assert.equal(overallRating(p, true, 'GK'), p.sourceOverall, p.name);
  const mae =
    ps.reduce(
      (n, p) => n + Math.abs(overallRating(p, true, p.primaryPosition) - p.sourceOverall),
      0,
    ) / ps.length;
  assert.ok(mae < 0.6);
  const yamal = ps.find(p => p.name === 'Lamine Yamal'),
    olmo = ps.find(p => p.name === 'Dani Olmo'),
    garcia = ps.find(p => p.name === 'Joan García');
  const wing = yamal.primaryPosition;
  assert.ok(Math.abs(overallRating(yamal, true, wing) - yamal.sourceOverall) <= 1);
  assert.ok(overallRating(yamal, true, wing) > overallRating(olmo, true, 'AM'));
  assert.ok(overallRating(yamal, true, wing) > overallRating(garcia, true, 'GK'));
  const changed = structuredClone(yamal);
  changed.sourceOverall = 1;
  assert.equal(overallRating(changed, true, wing), overallRating(yamal, true, wing));
  // Heading's weight for a striker, read below the stretch of the top ratings.
  const striker = structuredClone(ps.find(p => p.primaryPosition === 'ST' && p.sourceOverall < 70));
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
