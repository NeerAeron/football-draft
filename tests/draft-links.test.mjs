import test from 'node:test';
import assert from 'node:assert/strict';
import { teamLinks, chemValues, linkBoosts, LINK_KINDS } from '../app/core/draft/links.js';
import { DEFAULT_CONFIG } from '../app/core/config/config.js';

const rules = DEFAULT_CONFIG.draft.links;
let next = 0;
const player = (clubId, nationality, leagueId, extra = {}) => ({
  profileId: 'p' + next++,
  source: { clubId, nationality, leagueId },
  ...extra,
});

test('mates: nation mate +2, club mate +2, both +4 — one mate is enough, no league mates', () => {
  assert.deepEqual(rules, { nation: 2, club: 2, captain: 1 });
  assert.deepEqual(LINK_KINDS, ['nation', 'club']);
  const xi = [
    player('c1', 'France', 'L1'), // nation mate (1) and club mate (2) -> +4
    player('c9', 'France', 'L9'), // nation mate only -> +2
    player('c1', 'Spain', 'L1'), // club mate of 0 -> +2
    player('c2', 'Brazil', 'L1'), // shares only the league -> 0
    player('c3', 'Japan', 'L4'), // nobody -> 0
    null,
    ...Array.from({ length: 5 }, (_, i) => player('d' + i, 'N' + i, 'M' + i)),
  ];
  const links = teamLinks(xi, rules);
  assert.deepEqual(
    links.players.map(e => e && e.boost),
    [4, 2, 2, 0, 0, null, 0, 0, 0, 0, 0],
  );
  assert.deepEqual(
    links.players.slice(0, 5).map(e => e.kinds),
    [['nation', 'club'], ['nation'], ['club'], [], []],
  );
  assert.deepEqual(links.players[0], {
    boost: 4,
    kinds: ['nation', 'club'],
    chem: 4,
    mates: { nation: 1, club: 1 },
  });
  assert.equal(links.score, 8);
  assert.equal(links.total, 8);
  assert.equal(links.maxScore, 44);
  assert.equal(links.linked, 3);
  assert.equal(links.chem, 0.8);
  assert.deepEqual(chemValues(xi, rules).slice(0, 6), [4, 2, 2, 0, 0, 0]);
  // One line per pair of mates; a pair sharing both is a nation line.
  assert.deepEqual(links.pairs, [
    { a: 0, b: 1, kind: 'nation', kinds: ['nation'] },
    { a: 0, b: 2, kind: 'club', kinds: ['club'] },
  ]);
  const twins = teamLinks([player('c', 'X', 'l'), player('c', 'X', 'l')], rules);
  assert.deepEqual(twins.pairs, [{ a: 0, b: 1, kind: 'nation', kinds: ['nation', 'club'] }]);
  assert.deepEqual(
    twins.players.map(e => e.boost),
    [4, 4],
  );
});

test('club-less players have no club mates; empty slots are skipped', () => {
  const xi = [player(null, 'X', null), null, player(null, 'Y', null), player(null, 'X', null)];
  const links = teamLinks(xi, rules);
  assert.deepEqual(
    links.players.map(e => e?.boost ?? null),
    [2, null, 0, 2],
  );
  assert.equal(links.pairs.length, 1);
  assert.equal(teamLinks([null, null], rules).chem, 0);
});

test('real national XIs are all nation mates (+2, +4 for club mates inside), club XIs +2', () => {
  const nation = Array.from({ length: 11 }, (_, i) =>
    player(i < 2 ? 'same' : 'c' + i, 'Brazil', 'L' + (i % 4)),
  );
  const club = Array.from({ length: 11 }, (_, i) => player('real', 'Mixed' + i, 'L1'));
  const n = teamLinks(nation, rules);
  assert.deepEqual(
    n.players.map(e => e.boost),
    [4, 4, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  );
  assert.equal(n.score, 26);
  assert.ok(n.pairs.every(p => p.kind === 'nation') && n.pairs.length === 55);
  const c = teamLinks(club, rules);
  assert.equal(c.score, 22);
  assert.equal(c.chem, 2);
  assert.ok(c.pairs.every(p => p.kind === 'club'));
});

test('a Captain gives every player of his XI +1 on top; one captain counts', () => {
  const loner = (id, extra = {}) => ({
    sourceOverall: 70,
    source: { clubId: `c${id}`, nationality: `N${id}`, leagueId: `l${id}` },
    ...extra,
  });
  const plain = teamLinks([loner(1), loner(2), null], rules);
  assert.equal(plain.captain, null);
  assert.equal(plain.captainBoost, 0);
  assert.deepEqual(chemValues([loner(1), loner(2)], rules), [0, 0]);

  const xi = [
    loner(1),
    loner(2, { captain: true, sourceOverall: 80 }),
    loner(3, { captain: true }),
  ];
  const links = teamLinks(xi, rules);
  assert.equal(links.captain, 1, 'the higher-rated captain wears the armband');
  assert.equal(links.captainBoost, rules.captain);
  assert.deepEqual(chemValues(xi, rules), [1, 1, 1]);
  assert.equal(links.chem, 1, 'two captains do not stack');
  assert.equal(links.score, 0, 'the mates score does not count the Captain');
  assert.equal(links.total, 3);
  assert.equal(teamLinks(xi, { ...rules, captain: 0 }).captainBoost, 0);
  // Nation and club mates with a captain: 2 + 2 + 1 = 5, the engine's cap.
  const mates = [player('a', 'X', 'l'), player('a', 'X', 'm', { captain: true })];
  assert.deepEqual(chemValues(mates, rules), [5, 5]);
});

test('rules saved before the mates rule (thresholds per kind) read as the defaults', () => {
  const old = {
    club: { level1: 2, level2: 5, level3: 8 },
    nation: { level1: 2, level2: 5, level3: 8 },
    league: { level1: 3, level2: 5, level3: 8 },
    maxChem: 2,
    captain: 1,
  };
  assert.deepEqual(linkBoosts(old), { nation: 2, club: 2, captain: 1 });
  const xi = [player('a', 'X', 'l'), player('b', 'X', 'l')];
  assert.deepEqual(chemValues(xi, old), [2, 2]);
  // Custom numbers are honoured; a kind worth 0 makes no mates.
  const custom = teamLinks([player('a', 'X', 'l'), player('a', 'X', 'l')], {
    nation: 0,
    club: 2.5,
    captain: 0,
  });
  assert.equal(custom.players[0].boost, 2.5);
  assert.equal(custom.pairs[0].kind, 'club');
});
