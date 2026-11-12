// Player tiers by the rating shown on a player — the draft's tiers (core/draft/budget.js,
// CONFIG.draft.budget): Superstar 88+, Star 84–87, Starter 80–83, Normal 74–79, Bench below.
// The same names Budget mode counts ("2 Superstars, 2 Stars, 3 Starters"), so a player's frame
// and his Budget tier always agree. tierOf() is the display default; pass `tier` explicitly
// (a draft pool entry's `tier`) when a session plays with other thresholds.
import { DEFAULT_CONFIG } from '../../core/config/config.js';
import { draftTiers } from '../../core/draft/budget.js';

export const TIERS = draftTiers(DEFAULT_CONFIG.draft.budget).map((t, i, all) => ({
  id: t.id,
  name: t.name,
  min: i === all.length - 1 ? -Infinity : t.minimum,
  label: t.name,
}));
/** The tiers that get an outline wherever players are shown: the top two. */
export const isTopTier = tier => tier?.id === 'superstar' || tier?.id === 'star';

const BY_NAME = Object.fromEntries(TIERS.map(t => [t.name.toLowerCase(), t]));

/** Tier record for an OVR (number) — { id, name, min, label }. */
export function tierOf(ovr) {
  const value = Number(ovr);
  return TIERS.find(t => value >= t.min) || TIERS[TIERS.length - 1];
}

/** Normalise a tier given as 'Star' | 'star' | tier object, or derive it from ovr. */
export function resolveTier(tier, ovr) {
  if (tier && typeof tier === 'object' && tier.id) return tier;
  if (typeof tier === 'string' && BY_NAME[tier.toLowerCase()]) return BY_NAME[tier.toLowerCase()];
  return tierOf(ovr);
}

/** CSS class for tier-coloured text: 'tier-text-star' etc. (defined in base.css). */
export const tierTextClass = (tier, ovr) => `tier-text-${resolveTier(tier, ovr).id}`;
