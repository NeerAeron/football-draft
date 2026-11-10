import test from 'node:test';
import assert from 'node:assert/strict';
import { teamLinks, chemValues } from '../app/core/draft/links.js';
import { DEFAULT_CONFIG } from '../app/core/config/config.js';

const rules = DEFAULT_CONFIG.draft.links;
let next = 0;
const player = (clubId, nationality, leagueId) => ({
  profileId: 'p' + next++,
  source: { clubId, nationality, leagueId },
});

test('levels sum club / nation / league thresholds, capped at 3, chem scales to 2', () => {
  const xi = [
    player('c1', 'France', 'L1'),
    player('c1', 'France', 'L1'), // club pair + nation pair -> 2
    player('c2', 'Spain', 'L1'), // league trio only -> 1
    player('c3', 'Brazil', 'L2'),
    player('c4', 'Brazil', 'L3'), // nation pair -> 1
    player('c5', 'Japan', 'L4'), // nothing -> 0
    ...Array.from({ length: 5 }, (_, i) => player('d' + i, 'N' + i, 'M' + i)),
  ];
  const links = teamLinks(xi, rules);
  const levels = links.players.map(e => e.level);
  // Players 0 and 1: club 2 (+1), nation 2 (+1), league 3 (+1) -> 3 (capped).
  assert.deepEqual(levels.slice(0, 6), [3, 3, 1, 1, 1, 0]);
  assert.equal(links.score, 9);
  assert.equal(links.maxScore, 33);
  assert.equal(links.linked, 5);
  assert.deepEqual(links.players[2], {
    level: 1,
    chem: 2 / 3,
    club: 0,
    nation: 0,
    league: 1,
    counts: { club: 1, nation: 1, league: 3 },
  });
  assert.deepEqual(chemValues(xi, rules).slice(0, 6), [2, 2, 2 / 3, 2 / 3, 2 / 3, 0]);
  // One pair entry per linked pair, strongest kind first.
  const pair = links.pairs.find(p => p.a === 0 && p.b === 1);
  assert.deepEqual(pair, { a: 0, b: 1, kind: 'club', kinds: ['club', 'nation', 'league'] });
  assert.equal(links.pairs.find(p => p.a === 0 && p.b === 2).kind, 'league');
  assert.equal(links.pairs.find(p => p.a === 3 && p.b === 4).kind, 'nation');
  assert.ok(!links.pairs.some(p => p.a === 5 || p.b === 5));
});

test('a league pair below the league threshold draws no line; empty slots are skipped', () => {
  const xi = [player('a', 'X', 'L'), null, player('b', 'Y', 'L'), null];
  const links = teamLinks(xi, rules);
  assert.equal(links.pairs.length, 0);
  assert.deepEqual(
    links.players.map(e => e?.level ?? null),
    [0, null, 0, null],
  );
  assert.equal(links.chem, 0);
});

test('real club and national XIs are fully linked', () => {
  const club = Array.from({ length: 11 }, () => player('real', 'Mixed' + next, 'L1'));
  const nation = Array.from({ length: 11 }, (_, i) => player('c' + i, 'Brazil', 'L' + (i % 4)));
  for (const xi of [club, nation]) {
    const links = teamLinks(xi, rules);
    assert.equal(links.score, 33);
    assert.equal(links.chem, rules.maxChem);
  }
});

test('a Captain gives every player of his XI a boost; one captain counts', () => {
  const rules = DEFAULT_CONFIG.draft.links;
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
  assert.deepEqual(chemValues(xi, rules), [rules.captain, rules.captain, rules.captain]);
  assert.equal(links.chem, rules.captain, 'two captains do not stack');
  assert.equal(links.score, 0, 'Links score is unchanged');
  assert.equal(teamLinks(xi, { ...rules, captain: 0 }).captainBoost, 0);
});
