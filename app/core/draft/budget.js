// Budget mode: an XI may hold only so many players per rating band (CONFIG.draft.budget:
// band1–band3, each { minimum, slots }, highest first). The rating is the one shown on the
// player (his rounded natural OVR), so what a row shows is what it costs. Players under the
// last band are free. Pure helpers; the draft session enforces them (session option `budget`).
import { CONFIG, DEFAULT_CONFIG } from '../config/config.js';

const KEYS = ['band1', 'band2', 'band3'];

/**
 * The bands of a rules object, highest first:
 * [{ id: 'band1', label: '88+', minimum, below (next band's minimum or null), slots }].
 * Rules saved before Budget mode existed read as the defaults.
 */
export function budgetBands(budget = CONFIG.draft.budget) {
  const source = budget?.band1 ? budget : DEFAULT_CONFIG.draft.budget;
  return KEYS.map((id, i) => {
    const { minimum, slots } = source[id],
      below = i ? source[KEYS[i - 1]].minimum : null;
    return {
      id,
      label: below === null ? `${minimum}+` : `${minimum}–${below - 1}`,
      minimum,
      below,
      slots,
    };
  });
}
/** Label of the free band under the last one ('Under 80'). */
export const freeLabel = bands => `Under ${bands[bands.length - 1].minimum}`;
/** Index of the band a rating costs, or -1 when the player is free. */
export function bandIndex(bands, rating) {
  for (let i = 0; i < bands.length; i++) if (rating >= bands[i].minimum) return i;
  return -1;
}
/** Players per band among `ratings` (free players are not counted). */
export function bandUse(bands, ratings) {
  const used = bands.map(() => 0);
  for (const r of ratings) {
    const i = bandIndex(bands, r);
    if (i >= 0) used[i]++;
  }
  return used;
}
