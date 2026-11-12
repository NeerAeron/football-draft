import test from 'node:test';
import assert from 'node:assert/strict';
import {
  teamLinks,
  chemValues,
  linkBoosts,
  captainSlot,
  validLinks,
  LINK_KINDS,
} from '../app/core/draft/links.js';
import { DEFAULT_CONFIG } from '../app/core/config/config.js';

const rules = DEFAULT_CONFIG.draft.links;
let next = 0;
const player = (clubId, nationality, leagueId, extra = {}) => ({
  profileId: 'p' + next++,
  source: { clubId, nationality, leagueId },
  ...extra,
});

test('mates: nation mate +1.5, club mate +1, both +2.5 — one mate is enough, no league mates', () => {
  assert.deepEqual(rules, { nation: 1.5, club: 1, captain: 1 });
  assert.deepEqual(LINK_KINDS, ['nation', 'club']);
  const xi = [
    player('c1', 'France', 'L1'), // nation mate (1) and club mate (2) -> +2.5
    player('c9', 'France', 'L9'), // nation mate only -> +1.5
    player('c1', 'Spain', 'L1'), // club mate of 0 -> +1
    player('c2', 'Brazil', 'L1'), // shares only the league -> 0
    player('c3', 'Japan', 'L4'), // nobody -> 0
    null,
    ...Array.from({ length: 5 }, (_, i) => player('d' + i, 'N' + i, 'M' + i)),
  ];
  const links = teamLinks(xi, rules);
  assert.deepEqual(
    links.players.map(e => e && e.boost),
    [2.5, 1.5, 1, 0, 0, null, 0, 0, 0, 0, 0],
  );
  assert.deepEqual(
    links.players.slice(0, 5).map(e => e.kinds),
    [['nation', 'club'], ['nation'], ['club'], [], []],
  );
  assert.deepEqual(links.players[0], {
    boost: 2.5,
    kinds: ['nation', 'club'],
    chem: 2.5,
    mates: { nation: 1, club: 1 },
  });
  assert.equal(links.score, 5);
  assert.equal(links.total, 5);
  assert.equal(links.maxScore, 27.5);
  assert.equal(links.linked, 3);
  assert.equal(links.chem, 0.5);
  assert.deepEqual(chemValues(xi, rules).slice(0, 6), [2.5, 1.5, 1, 0, 0, 0]);
  // One line per pair of mates; a pair sharing both is a nation line.
  assert.deepEqual(links.pairs, [
    { a: 0, b: 1, kind: 'nation', kinds: ['nation'] },
    { a: 0, b: 2, kind: 'club', kinds: ['club'] },
  ]);
  const twins = teamLinks([player('c', 'X', 'l'), player('c', 'X', 'l')], rules);
  assert.deepEqual(twins.pairs, [{ a: 0, b: 1, kind: 'nation', kinds: ['nation', 'club'] }]);
  assert.deepEqual(
    twins.players.map(e => e.boost),
    [2.5, 2.5],
  );
});

test('club-less players have no club mates; empty slots are skipped', () => {
  const xi = [player(null, 'X', null), null, player(null, 'Y', null), player(null, 'X', null)];
  const links = teamLinks(xi, rules);
  assert.deepEqual(
    links.players.map(e => e?.boost ?? null),
    [1.5, null, 0, 1.5],
  );
  assert.equal(links.pairs.length, 1);
  assert.equal(teamLinks([null, null], rules).chem, 0);
});

test('real national XIs are all nation mates (+1.5, +2.5 for club mates inside), club XIs +1', () => {
  const nation = Array.from({ length: 11 }, (_, i) =>
    player(i < 2 ? 'same' : 'c' + i, 'Brazil', 'L' + (i % 4)),
  );
  const club = Array.from({ length: 11 }, (_, i) => player('real', 'Mixed' + i, 'L1'));
  const n = teamLinks(nation, rules);
  assert.deepEqual(
    n.players.map(e => e.boost),
    [2.5, 2.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5],
  );
  assert.equal(n.score, 18.5);
  assert.ok(n.pairs.every(p => p.kind === 'nation') && n.pairs.length === 55);
  const c = teamLinks(club, rules);
  assert.equal(c.score, 11);
  assert.equal(c.chem, 1);
  assert.ok(c.pairs.every(p => p.kind === 'club'));
});

test('a Captain gives every player +1 on top of the mates boosts; two do not stack', () => {
  const loner = (id, extra = {}) => ({
    sourceOverall: 70,
    source: { clubId: `c${id}`, nationality: `N${id}`, leagueId: `l${id}` },
    ...extra,
  });
  const mate = (id, extra = {}) => ({
    sourceOverall: 70,
    source: { clubId: 'c', nationality: 'N', leagueId: 'l' },
    profileId: 'm' + id,
    ...extra,
  });
  const xi = [loner(1), loner(2, { captain: true, sourceOverall: 80 }), null, mate(1), mate(2)];
  const links = teamLinks(xi, rules);
  assert.deepEqual(chemValues(xi, rules), [1, 1, 0, 3.5, 3.5]);
  assert.deepEqual(
    links.players.map(e => e && e.boost),
    [0, 0, null, 2.5, 2.5],
  );
  assert.equal(links.captain, 1);
  assert.equal(links.captainBoost, 1);
  assert.equal(links.score, 5); // the mates boosts
  assert.equal(links.total, 9); // + the Captain's +1 for four players
  assert.equal(links.chem, 9 / 4);
  // Two captains: one boost; the higher source rating wears the armband (first slot on a tie).
  const two = [loner(1, { captain: true, sourceOverall: 80 }), loner(2, { captain: true })];
  assert.deepEqual(chemValues(two, rules), [1, 1]);
  assert.equal(captainSlot(two), 0);
  assert.equal(captainSlot([loner(1, { captain: true }), loner(2, { captain: true })]), 0);
  assert.equal(captainSlot([loner(1), null]), null);
  // No captain, no boost; a Captain worth 0 gives none.
  assert.equal(teamLinks([loner(1), loner(2)], rules).captainBoost, 0);
  assert.deepEqual(chemValues(xi, { nation: 1.5, club: 1, captain: 0 }), [0, 0, 0, 2.5, 2.5]);
  assert.deepEqual(Object.keys(linkBoosts(rules)), ['nation', 'club', 'captain']);
});

test('the mates rules are three numbers: older shapes are not rules', () => {
  assert.deepEqual(linkBoosts(), DEFAULT_CONFIG.draft.links);
  assert.deepEqual(linkBoosts({ nation: 2, club: 0.5, captain: 0 }), {
    nation: 2,
    club: 0.5,
    captain: 0,
  });
  assert.equal(validLinks(DEFAULT_CONFIG.draft.links), true);
  assert.equal(validLinks({ nation: 0, club: 2.5, captain: 0 }), true);
  // Thresholds per kind (before the mates rule), no Captain (before him), junk: one cut-off —
  // a saved run with such rules is not a saved run (competition/cup.js restoreCupRun).
  for (const old of [
    { club: { level1: 2, level2: 5, level3: 8 }, nation: { level1: 2 }, captain: 1 },
    { nation: 1.5, club: 1 },
    { nation: '1.5', club: 1, captain: 1 },
    { nation: NaN, club: 1, captain: 1 },
    {},
    null,
    undefined,
    7,
  ])
    assert.equal(validLinks(old), false, JSON.stringify(old));
  // Custom numbers are honoured; a kind worth 0 makes no mates.
  const custom = teamLinks([player('a', 'X', 'l'), player('a', 'X', 'l')], {
    nation: 0,
    club: 2.5,
    captain: 0,
  });
  assert.equal(custom.players[0].boost, 2.5);
  assert.equal(custom.pairs[0].kind, 'club');
});
