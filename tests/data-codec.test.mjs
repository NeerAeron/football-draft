import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CODE_ALPHABET,
  decodeCatalog,
  encodeCatalog,
  indexCatalog,
  stamp,
} from '../app/core/players/catalog-codec.js';
import { badgeStamp, reconcileCatalog } from '../app/core/players/catalog-derived.js';
import { clubSquads } from '../app/core/players/club-lineups.js';
import { normalizeBadges } from '../app/core/players/badges.js';
import { readCatalogFile, loadRuntimeCatalog } from '../scripts/data/catalog-file.mjs';

const file = readCatalogFile();

function sample() {
  const attrs = (base, gk = 20) => ({
    pace: base,
    acceleration: base + 1,
    shooting: base - 2,
    goalkeeping: gk,
  });
  const tendencies = v => ({ advance: v, risk: 0.333, carry: 0.05 });
  const player = (id, name, position, club, extra = {}) => ({
    profileId: `ea:${id}:fc26:u4`,
    name,
    fullName: `${name} Full`,
    primaryPosition: position,
    secondaryPositions: position === 'ST' ? ['LW', 'AM'] : [],
    attrs: attrs(60 + id, position === 'GK' ? 80 : 20),
    foot: id % 2 ? 'left' : 'right',
    weakFoot: 60,
    tendencies: tendencies(0.5 + id / 1000),
    tags: position === 'GK' ? ['reflexes'] : ['finisher', 'speedster'],
    captain: id === 2,
    sourceOverall: 70 + id,
    source: club
      ? { club: club.name, clubId: club.id, leagueId: club.leagueId, nationality: 'Wales' }
      : { club: null, clubId: null, leagueId: null, nationality: "Côte d'Ivoire" },
    inference: { badges: position === 'GK' ? [] : [{ tag: 'finisher', confidence: 0.98 }] },
    ...extra,
  });
  const club = { id: '7', name: 'Real "Quotes" FC', leagueId: '13', playerCount: 2 };
  const players = [
    player(1, 'Keeper', 'GK', club),
    player(2, 'Striker', 'ST', club),
    player(3, 'Free Agent', 'CM', null),
  ];
  return {
    compilerVersion: 'test',
    source: { sha256: 'x' },
    selection: { policy: 'test' },
    attributeKeys: ['pace', 'acceleration', 'shooting', 'goalkeeping'],
    dictionaries: {
      positions: ['GK', 'CM', 'ST', 'LW', 'AM'],
      badges: ['finisher', 'reflexes', 'speedster'],
    },
    formations: ['a', 'b'],
    precomputed: { badges: 'x', clubRatings: 'y', lineups: 'z' },
    leagues: [{ id: '13', name: 'League', tier: 'A' }],
    teams: [
      {
        ...club,
        overall: 71.5,
        tier: 'C',
        lineups: { b: [players[1], players[0]] },
        bestFormation: 'b',
      },
      { id: '9', name: 'Empty', leagueId: '13', playerCount: 0 },
    ],
    nations: [
      {
        name: "Côte d'Ivoire",
        code: 'ci',
        flag: './assets/flags/ci.svg',
        players: 1,
        goalkeepers: 0,
      },
      {
        name: 'Wales',
        code: 'gb-wls',
        flag: './assets/flags/gb-wls.svg',
        players: 2,
        goalkeepers: 1,
      },
    ],
    players,
  };
}

test('codec round-trips a catalog exactly, including club-less players, evidence and lineups', () => {
  const catalog = sample(),
    encoded = encodeCatalog(catalog),
    decoded = decodeCatalog(JSON.parse(JSON.stringify(encoded)));
  assert.equal(decoded.schemaVersion, 3);
  const { schemaVersion, ...rest } = decoded;
  assert.equal(schemaVersion, 3);
  assert.deepEqual(rest, catalog);
  assert.equal(decoded.teams[0].lineups.b[0], decoded.players[1], 'lineups reference players');
  assert.deepEqual(decoded.players[2].source, {
    club: null,
    clubId: null,
    leagueId: null,
    nationality: "Côte d'Ivoire",
  });
  assert.equal(encoded.players.position, '021');
  assert.deepEqual(encoded.players.attrs.slice(0, 3), [61, 62, 63], 'attribute-major columns');
  assert.equal(encoded.players.tendencies[2], 503);
  assert.deepEqual(encodeCatalog(decoded), encoded);
});

test('the committed catalog file re-encodes byte for byte', () => {
  assert.equal(JSON.stringify(encodeCatalog(decodeCatalog(file))), JSON.stringify(file));
  assert.equal(file.format, 'football-draft-catalog');
  assert.equal(file.version, 3);
  for (const key of ['attrs', 'tendencies', 'evidenceConfidence', 'weakFoot', 'sourceId'])
    assert.ok(file.players[key].every(Number.isInteger), key);
  assert.equal(file.players.attrs.length, file.players.count * file.attributeKeys.length);
  assert.equal(file.players.tendencies.length, file.players.count * file.tendencyKeys.length);
  assert.ok(file.dictionaries.badges.length <= CODE_ALPHABET.length);
});

test('the encoder rejects values it cannot store exactly', () => {
  const broken = mutate => {
    const c = sample();
    mutate(c);
    return () => encodeCatalog(c);
  };
  assert.throws(
    broken(c => (c.players[0].attrs.pace = 60.5)),
    /not an integer/,
  );
  assert.throws(
    broken(c => (c.players[0].tendencies.risk = 0.3333)),
    /round-trip/,
  );
  assert.throws(
    broken(c => (c.players[0].source.nationality = 'Atlantis')),
    /Unknown nationality/,
  );
  assert.throws(
    broken(c => (c.players[0].source.club = 'Renamed')),
    /club fields differ/,
  );
  assert.throws(
    broken(c => (c.players[1].profileId = 'sofifa:2')),
    /profile id/i,
  );
  assert.throws(
    broken(c => (c.players[1].primaryPosition = 'CB')),
    /Unknown position/,
  );
  assert.throws(
    broken(c => (c.players[0].attrs = { acceleration: 1, pace: 1, shooting: 1, goalkeeping: 1 })),
    /key order/,
  );
});

test('indexes group players by id, nation, league and club in catalog order', () => {
  const c = indexCatalog(decodeCatalog(encodeCatalog(sample())));
  assert.equal(c.byId.get('ea:2:fc26:u4').name, 'Striker');
  assert.deepEqual(
    c.byNation.get('Wales').map(p => p.name),
    ['Keeper', 'Striker'],
  );
  assert.equal(c.byLeague.get('13').length, 2);
  assert.equal(c.byClub.get('7').length, 2);
  assert.ok(![...c.byClub.keys()].includes('null'));
});

test('stale configuration stamps recompute badges, club ratings and lineups identically', () => {
  const fresh = loadRuntimeCatalog(),
    stale = decodeCatalog(file);
  stale.precomputed.badges = 'stale';
  stale.precomputed.clubRatings = 'stale';
  for (const p of stale.players) p.tags = [...p.tags].reverse();
  reconcileCatalog(stale);
  assert.equal(stale.precomputed.badges, badgeStamp());
  assert.deepEqual(
    stale.players.map(p => [...p.tags].sort()),
    fresh.players.map(p => [...p.tags].sort()),
  );
  assert.deepEqual(
    stale.teams.map(t => [t.id, t.overall, t.sampleSize, t.tier]),
    fresh.teams.map(t => [t.id, t.overall, t.sampleSize, t.tier]),
  );
  // Lineups: one league, so the recomputation stays quick.
  const league = fresh.leagues.find(l => l.tier === 'A').id,
    small = c => ({
      ...c,
      teams: c.teams.filter(t => t.leagueId === league),
      players: c.players.filter(p => p.source.leagueId === league),
    });
  const computed = small(decodeCatalog(file));
  computed.precomputed = { ...computed.precomputed, lineups: 'stale' };
  const a = clubSquads(small(fresh)),
    b = clubSquads(computed);
  assert.ok(a.length > 5);
  assert.deepEqual(
    b.map(c => [c.id, c.formations, c.bestFormation]),
    a.map(c => [c.id, c.formations, c.bestFormation]),
  );
  for (const [i, club] of a.entries())
    for (const f of club.formations)
      assert.deepEqual(
        b[i].lineups[f].map(p => p.profileId),
        club.lineups[f].map(p => p.profileId),
      );
  assert.equal(stamp({ a: 1 }), stamp({ a: 1 }));
  assert.notEqual(stamp({ a: 1 }), stamp({ a: 2 }));
  assert.deepEqual(normalizeBadges(fresh.players[0], fresh.players[0].tags), fresh.players[0].tags);
});

test('the browser loader fetches once, decodes and indexes the same catalog', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    assert.equal(url, './data/catalog.v3.json');
    return { ok: true, json: async () => structuredClone(file) };
  };
  try {
    const { loadCatalog } = await import('../app/services/catalog.js');
    const [a, b] = await Promise.all([loadCatalog(), loadCatalog()]);
    assert.equal(a, b);
    assert.equal(calls, 1);
    const expected = loadRuntimeCatalog();
    assert.deepEqual(a.players, expected.players);
    assert.deepEqual(a.teams, expected.teams);
    assert.deepEqual(a.nations, expected.nations);
    assert.equal(a.byId.size, a.players.length);
  } finally {
    globalThis.fetch = original;
  }
});
