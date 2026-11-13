// Reel weights of a World Cup draft: how likely an era, and a nation inside it, comes up.
// "The rule of fun": world-class players are a thrill when they are not routine, and a nation
// nobody knows a player of is no fun — so famous, deep squads come up more often than a
// one-star or no-star squad, without ever shutting a nation out (every weight is positive; only
// the session's guards set one to 0). Never shown in the UI. Pure and deterministic: a weight
// depends only on the pool as the data has it, not on what was drafted, so the Daily's schedule
// and a session draw with the same odds. Numbers: CONFIG.draft.reels; measured by
// tools/calibration/reel-odds.mjs.
import { CONFIG } from '../config/config.js';
import { eraList, eraPool } from '../players/eras.js';
import { naturalRating, refreshRatings } from './pools.js';

const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const round3 = x => Math.round(x * 1000) / 1000;

/**
 * A nation's weight on its era's reel, from its pool (best first by shown rating):
 *   quality q(r) = (r − floor) / span, 0…1 (72 → 0, 92 and more → 1 by default);
 *   score = second·q(2nd best) + third·q(3rd) + fourth·q(4th) + depth·q(mean of 5th–8th)
 *         + best·q(best) + size·(players / 26);
 *   weight = 1 + lift · (score / the highest possible score) ^ curve · rarity,
 *   rarity = `rare` for a squad with an all-timer (best shown `rareFrom`+), else 1.
 * Recognisable depth counts most (the 2nd to 4th best), the squad's size next, the single best
 * player least: one star does not make a nation a favourite of the reel.
 */
export function nationWeight(ratings, rules = CONFIG.draft.reels) {
  const n = rules.nation,
    q = r => clamp01((r - n.floor) / n.span),
    at = i => (i < ratings.length ? ratings[i] : 0);
  let depth = 0;
  for (let i = 4; i < 8; i++) depth += at(i) / 4;
  const score =
      n.second * q(at(1)) +
      n.third * q(at(2)) +
      n.fourth * q(at(3)) +
      n.depth * q(depth) +
      n.best * q(at(0)) +
      n.size * Math.min(1, ratings.length / 26),
    top = n.second + n.third + n.fourth + n.depth + n.best + n.size;
  // Rarity: a squad with an all-timer (shown `rareFrom` or more) keeps only the share `rare`
  // of what its depth lifts it by — never less than a squad nobody knows.
  const rare = at(0) >= n.rareFrom ? n.rare : 1;
  return round3(1 + n.lift * Math.pow(top > 0 ? score / top : 0, n.curve) * rare);
}

/**
 * An era's weight: a slight bump for the number of nations it has and another for the median
 * of its nations' best players: 1 + nations·(count / 70) + top·q(median best).
 */
export function eraWeight(count, medianBest, rules = CONFIG.draft.reels) {
  const e = rules.era,
    n = rules.nation;
  return round3(
    1 + e.nations * Math.min(1, count / 70) + e.top * clamp01((medianBest - n.floor) / n.span),
  );
}

const cache = new WeakMap();
/**
 * The weights of a catalog's era reels (cached per era data, rules and ratings):
 * Map era id → { weight, nations: Map name → weight }.
 */
export function reelWeights(catalog, rules = CONFIG.draft.reels) {
  const data = catalog?.eras;
  if (!data) return new Map();
  const stamp = refreshRatings() + JSON.stringify(rules);
  const hit = cache.get(data);
  if (hit?.stamp === stamp) return hit.weights;
  const weights = new Map();
  for (const era of eraList(catalog)) {
    const nations = new Map(),
      bests = [];
    for (const nation of era.nations) {
      const ratings = eraPool(catalog, era.id, nation.name)
        .map(p => Math.round(naturalRating(p)))
        .sort((a, b) => b - a);
      nations.set(nation.name, nationWeight(ratings, rules));
      bests.push(ratings[0] ?? 0);
    }
    bests.sort((a, b) => a - b);
    const median = bests.length ? bests[Math.floor(bests.length / 2)] : 0;
    weights.set(era.id, { weight: eraWeight(era.nations.length, median, rules), nations });
  }
  cache.set(data, { stamp, weights });
  return weights;
}
