// The draft's player tiers and Budget mode. One vocabulary: a player is a Superstar, a Star, a
// Starter, a Normal or a Bench player by the rating shown on him (his rounded natural OVR) —
// the top three start at CONFIG.draft.budget[tier].minimum (88 / 84 / 80). Budget mode (session
// option `budget`) lets an XI hold only `slots` players of each of those three tiers (1 / 2 /
// 3); Normal and Bench players are free. Pure helpers; the draft session enforces the caps.
import { CONFIG, DEFAULT_CONFIG } from '../config/config.js';

/** The capped tiers, highest first (keys of CONFIG.draft.budget). */
export const BUDGET_TIERS = ['Superstar', 'Star', 'Starter'];
/** The free tiers under them: [name, minimum rating]. */
export const FREE_TIERS = [
  ['Normal', 74],
  ['Bench', 0],
];
// Rules saved before the tiers had names held band1–band3 (same order).
const OLD_KEYS = ['band1', 'band2', 'band3'];

/**
 * The capped tiers of a rules object, highest first:
 * [{ id: 'superstar', name: 'Superstar', label: 'Superstar', range: '88+', minimum,
 *    below (next tier's minimum or null), slots }].
 * Rules saved before Budget mode existed read as the defaults; rules saved with numbered bands
 * keep their numbers under the tier names.
 */
export function budgetBands(budget = CONFIG.draft.budget) {
  const rows = budget?.Superstar
    ? BUDGET_TIERS.map(name => budget[name])
    : budget?.band1
      ? OLD_KEYS.map(key => budget[key])
      : BUDGET_TIERS.map(name => DEFAULT_CONFIG.draft.budget[name]);
  return BUDGET_TIERS.map((name, i) => {
    const { minimum, slots } = rows[i],
      below = i ? rows[i - 1].minimum : null;
    return {
      id: name.toLowerCase(),
      name,
      label: name,
      range: below === null ? `${minimum}+` : `${minimum}–${below - 1}`,
      minimum,
      below,
      slots,
    };
  });
}
/** What the free players are called next to the capped tiers ('Under 80'). */
export const freeLabel = bands => `Under ${bands[bands.length - 1].minimum}`;
/** Index of the capped tier a rating costs, or -1 when the player is free. */
export function bandIndex(bands, rating) {
  for (let i = 0; i < bands.length; i++) if (rating >= bands[i].minimum) return i;
  return -1;
}
/** Players per capped tier among `ratings` (free players are not counted). */
export function bandUse(bands, ratings) {
  const used = bands.map(() => 0);
  for (const r of ratings) {
    const i = bandIndex(bands, r);
    if (i >= 0) used[i]++;
  }
  return used;
}
/** Every tier of a rules object, highest first: [{ id, name, minimum }] (five rows). */
export function draftTiers(budget = CONFIG.draft.budget) {
  return [
    ...budgetBands(budget).map(({ id, name, minimum }) => ({ id, name, minimum })),
    ...FREE_TIERS.map(([name, minimum]) => ({ id: name.toLowerCase(), name, minimum })),
  ];
}
/** Tier name ('Superstar' … 'Bench') of a shown rating. */
export function tierOfRating(rating, bands = budgetBands()) {
  const i = bandIndex(bands, rating);
  if (i >= 0) return bands[i].name;
  return rating >= FREE_TIERS[0][1] ? FREE_TIERS[0][0] : FREE_TIERS[1][0];
}
