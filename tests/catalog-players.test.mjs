import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Match, Player } from '../app/core/sim/engine.js';
import { BADGES, badgeEligible } from '../app/core/players/traits.js';
import {
  playerTier,
  normalizeAttributes,
  overallRating,
  positionFamiliarity,
} from '../app/core/players/ratings.js';
import { catalogIndex, bestEleven } from '../app/core/draft/pools.js';
import { clubSquads, assignClubLineup } from '../app/core/players/club-lineups.js';
import { FORMATIONS } from '../app/core/players/formations.js';
import { CONFIG } from '../app/core/config/config.js';
import { loadRuntimeCatalog } from '../scripts/data/catalog-file.mjs';
const catalog = loadRuntimeCatalog(),
  profiles = catalog.players,
  reference = JSON.parse(
    readFileSync(new URL('../data/catalog-reference.json', import.meta.url), 'utf8'),
  );

test('badge ranges and eligibility hold across the full recompiled catalog; hidden values are individual', () => {
  const counts = new Map();
  for (const p of profiles) {
    const tier = playerTier(p);
    assert.ok(!('playerType' in p));
    assert.ok(!('playerType' in p.inference));
    assert.ok(p.tags.length >= tier.minimum && p.tags.length <= tier.capacity);
    assert.equal(new Set(p.tags).size, p.tags.length);
    assert.ok(
      p.tags.every(id =>
        badgeEligible(
          p,
          BADGES.find(b => b.id === id),
        ),
      ),
    );
    // The runtime keeps only source (trait/tag) evidence; inferred badges are recomputed.
    assert.ok(p.inference.badges.every(b => p.tags.includes(b.tag) && b.confidence >= 0.8));
    assert.ok(Object.values(p.tendencies).every(v => v >= 0.05 && v <= 0.95));
    if (!counts.has(tier.name)) counts.set(tier.name, new Set());
    counts.get(tier.name).add(p.tags.length);
  }
  assert.deepEqual([...counts.get('Superstar')].sort(), [5, 6, 7]);
  assert.deepEqual([...counts.get('Star')].sort(), [3, 4, 5]);
  const cbs = profiles.filter(p => p.primaryPosition === 'CB');
  assert.ok(new Set(cbs.map(p => JSON.stringify(p.tendencies))).size > cbs.length * 0.9);
});
test('every badge boosts a consumed ability while base overall stays unchanged', () => {
  for (const badge of BADGES) {
    const role = badge.group === 'Goalkeeper' ? 'GK' : 'ST',
      p = new Player({
        role,
        attrs: normalizeAttributes(
          Object.fromEntries(Object.keys(normalizeAttributes({})).map(k => [k, 70])),
        ),
        tags: [],
        tendencies: {},
        energy: 1,
      });
    const before = overallRating(p),
      key = Object.keys(badge.boosts)[0],
      ability = p.skill(key);
    p.tags = [badge.id];
    assert.ok(p.skill(key) > ability, badge.id);
    assert.equal(overallRating(p), before);
  }
});
test('hidden tendencies and badges survive swaps, configuration and replay import', () => {
  const m = new Match(40),
    c = m.exportConfig();
  c.players[9] = profiles.find(p => p.primaryPosition === 'ST');
  m.importConfig(c);
  const expected = m.playerProfile(m.players[9]);
  assert.ok(m.swapLineup(9, 2));
  assert.deepEqual(m.players[2].tendencies, expected.tendencies);
  assert.deepEqual(m.players[2].tags, expected.tags);
  const replay = new Match(41);
  replay.importConfig(m.exportConfig());
  assert.deepEqual(replay.players[2].tendencies, expected.tendencies);
  assert.ok(!('playerType' in replay.playerProfile(replay.players[2])));
});
test('forty draft leagues with full pools; every league has a local logo', () => {
  const { leagues } = catalogIndex(catalog);
  assert.equal(leagues.length, 40);
  assert.ok(leagues.every(l => l.players.length >= CONFIG.draft.minimumLeaguePlayers));
  assert.ok(leagues.every(l => l.clubs.every(c => c.leagueId === l.id)));
  for (const l of catalog.leagues)
    assert.ok(existsSync(new URL(`../app/${l.logo}`, import.meta.url)), l.name);
});
test('squad assignment rejects incomplete clubs and chooses unique players by positional fit', () => {
  assert.equal(assignClubLineup(profiles.slice(0, 10), '433'), null);
  const club = clubSquads(catalog).find(c => c.name === 'Arsenal'),
    best = bestEleven(club.players),
    lineup = assignClubLineup(club.players, best.formation);
  assert.ok(FORMATIONS[best.formation]);
  for (const xi of [best.players, lineup]) {
    assert.equal(xi[0].primaryPosition, 'GK');
    assert.equal(new Set(xi.map(p => p.profileId)).size, 11);
    xi.forEach((p, i) =>
      assert.ok(positionFamiliarity(p, FORMATIONS[best.formation][i][2]) >= CONFIG.ai.minimumFit),
    );
  }
});

test('every club has reviewed colours; provenance stays in the compiler reference', () => {
  const colorSources = new Map(reference.colors.map(c => [String(c.id), c.sourceUrl]));
  for (const t of catalog.teams) {
    assert.match(t.primary, /^#[0-9a-f]{6}$/i);
    assert.match(t.secondary, /^#[0-9a-f]{6}$/i);
    assert.ok(colorSources.get(String(t.id)));
  }
});
