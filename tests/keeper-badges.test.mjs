import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeCatalog } from '../scripts/data/catalog-file.mjs';
import { badgeBoost, GOALKEEPING_BADGE_CAP } from '../app/core/players/traits.js';
import { normalizeBadges } from '../app/core/players/badges.js';
import { overallRating, playerTier } from '../app/core/players/ratings.js';

const catalog = loadRuntimeCatalog();

test('goalkeeping badges no longer stack onto a keeper’s single rating', () => {
  const keeper = catalog.players.find(p => p.primaryPosition === 'GK');
  const p = { ...keeper, tags: ['safehands', 'reflexes', 'gkreach', 'distributor'] };
  assert.equal(GOALKEEPING_BADGE_CAP, 2);
  assert.equal(badgeBoost(p, 'goalkeeping'), 2); // 1 + 1 + 2 before the fix: +4
  assert.equal(badgeBoost(p, 'longPassing'), 3);
  assert.equal(badgeBoost(p, 'shortPassing'), 2);
  assert.equal(badgeBoost({ ...keeper, tags: ['safehands'] }, 'goalkeeping'), 1);
  // Outfield stacking keeps the shared attribute cap.
  const striker = {
    ...catalog.players.find(p => p.primaryPosition === 'ST'),
    tags: ['finisher', 'curve', 'volley', 'latearrival'],
  };
  assert.equal(badgeBoost(striker, 'shooting'), 5);
});

test('keepers’ hidden badge gain is at most +2 OVR, in line with outfield Superstars', () => {
  const superstars = [];
  let keeperMax = 0;
  for (const source of catalog.players) {
    const p = { ...source, tags: normalizeBadges(source, source.tags) },
      boosted = {
        ...p,
        attrs: Object.fromEntries(
          Object.entries(p.attrs).map(([k, v]) => [k, Math.min(99, v + badgeBoost(p, k))]),
        ),
      },
      gain =
        overallRating(boosted, false, p.primaryPosition) -
        overallRating(p, false, p.primaryPosition);
    if (p.primaryPosition === 'GK') keeperMax = Math.max(keeperMax, gain);
    else if (playerTier(p).name === 'Superstar') superstars.push(gain);
  }
  const superstarMean = superstars.reduce((a, b) => a + b, 0) / superstars.length;
  assert.ok(keeperMax <= 2 + 1e-9, 'keeper gain ' + keeperMax);
  assert.ok(superstarMean > 1.8, 'outfield superstar gain ' + superstarMean);
});
