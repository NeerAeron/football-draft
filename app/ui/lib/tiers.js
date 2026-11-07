// Player tiers by overall rating. Thresholds mirror CONFIG.playerTiers in
// app/core/config/config.js (Superstar 85+, Star 80–84, Starter 74–79, Normal 68–73,
// Bench below). Pass `tier` explicitly (e.g. playerTier(p).name from core) when a screen
// uses tuned thresholds; tierOf() is the display default.
export const TIERS = [
  { id: 'superstar', name: 'Superstar', min: 85, label: 'Superstar' },
  { id: 'star', name: 'Star', min: 80, label: 'Star' },
  { id: 'starter', name: 'Starter', min: 74, label: 'Starter' },
  { id: 'normal', name: 'Normal', min: 68, label: 'Normal' },
  { id: 'bench', name: 'Bench', min: -Infinity, label: 'Bench' },
];

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
