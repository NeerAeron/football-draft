import test from 'node:test';
import assert from 'node:assert/strict';
import { teamLinks, chemValues, linkBoosts } from '../app/core/draft/links.js';
import { DEFAULT_CONFIG } from '../app/core/config/config.js';

const rules = DEFAULT_CONFIG.draft.links;
let next = 0;
const player = (clubId, nationality, leagueId, extra = {}) => ({
  profileId: 'p' + next++,
  source: { clubId, nationality, leagueId },
  ...extra,
});

test('mates: nation +3, club +2, league +1 — one mate is enough, the highest applies', () => {
  assert.deepEqual(rules, { nation: 3, club: 2, league: 1, captain: 1 });
  const xi = [
    player('c1', 'France', 'L1'), // nation mate (1), club mate (2), league mate (2, 3) -> +3
    player('c9', 'France', 'L9'), // nation mate only -> +3
    player('c1', 'Spain', 'L1'), // club mate of 0 (and league) -> +2
    player('c2', 'Brazil', 'L1'), // league mates -> +1
    player('c3', 'Japan', 'L4'), // nobody -> 0
    null,
    ...Array.from({ length: 5 }, (_, i) => player('d' + i, 'N' + i, 'M' + i)),
  ];
  const links = teamLinks(xi, rules);
  assert.deepEqual(
    links.players.map(e => e && e.boost),
    [3, 3, 2, 1, 0, null, 0, 0, 0, 0, 0],
  );
  assert.deepEqual(
    links.players.slice(0, 5).map(e => e.kind),
    ['nation', 'nation', 'club', 'league', null],
  );
  assert.deepEqual(links.players[0], {
    boost: 3,
    kind: 'nation',
    chem: 3,
    mates: { nation: 1, club: 1, league: 2 },
  });
  assert.equal(links.score, 9);
  assert.equal(links.total, 9);
  assert.equal(links.maxScore, 33);
  assert.equal(links.linked, 4);
  assert.equal(links.chem, 0.9);
  assert.deepEqual(chemValues(xi, rules).slice(0, 6), [3, 3, 2, 1, 0, 0]);
  // One line per pair, by its strongest shared kind — only pairs that boost one of the two.
  assert.deepEqual(links.pairs, [
    { a: 0, b: 1, kind: 'nation', kinds: ['nation'] },
    { a: 0, b: 2, kind: 'club', kinds: ['club', 'league'] },
    { a: 0, b: 3, kind: 'league', kinds: ['league'] },
    { a: 2, b: 3, kind: 'league', kinds: ['league'] },
  ]);
});

test('club-less players have no club or league mates; empty slots are skipped', () => {
  const xi = [player(null, 'X', null), null, player(null, 'Y', null), player(null, 'X', null)];
  const links = teamLinks(xi, rules);
  assert.deepEqual(
    links.players.map(e => e?.boost ?? null),
    [3, null, 0, 3],
  );
  assert.equal(links.pairs.length, 1);
  assert.equal(teamLinks([null, null], rules).chem, 0);
});

test('real national XIs are all nation mates (+3), real club XIs club mates (+2)', () => {
  const nation = Array.from({ length: 11 }, (_, i) => player('c' + i, 'Brazil', 'L' + (i % 4)));
  const club = Array.from({ length: 11 }, (_, i) => player('real', 'Mixed' + i, 'L1'));
  const n = teamLinks(nation, rules);
  assert.equal(n.score, 33);
  assert.equal(n.chem, 3);
  assert.ok(n.pairs.every(p => p.kind === 'nation'));
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
  // Nation mates with a captain: 3 + 1 = 4, the engine's cap.
  const mates = [player('a', 'X', 'l'), player('b', 'X', 'm', { captain: true })];
  assert.deepEqual(chemValues(mates, rules), [4, 4]);
});

test('rules saved before the mates rule (thresholds per kind) read as the defaults', () => {
  const old = {
    club: { level1: 2, level2: 5, level3: 8 },
    nation: { level1: 2, level2: 5, level3: 8 },
    league: { level1: 3, level2: 5, level3: 8 },
    maxChem: 2,
    captain: 1,
  };
  assert.deepEqual(linkBoosts(old), { nation: 3, club: 2, league: 1, captain: 1 });
  const xi = [player('a', 'X', 'l'), player('b', 'X', 'm')];
  assert.deepEqual(chemValues(xi, old), [3, 3]);
  // Custom numbers are honoured, and the strongest kind follows them.
  const custom = teamLinks([player('a', 'X', 'l'), player('a', 'X', 'l')], {
    nation: 1,
    club: 2.5,
    league: 0,
    captain: 0,
  });
  assert.equal(custom.players[0].boost, 2.5);
  assert.equal(custom.pairs[0].kind, 'club');
});
