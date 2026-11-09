import { CONFIG } from '../config/config.js';
// Stable preferences describe what a player tries; abilities describe execution.
import { normalizeAttributes } from '../players/ratings.js';
const bound = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export { OVERALL_WEIGHTS, overallRating } from '../players/ratings.js';
export function makeIdentity(role, slot, random, attrs) {
  attrs = normalizeAttributes(attrs);
  const back = ['LB', 'RB'].includes(role),
    forward = ['LW', 'RW', 'ST'].includes(role);
  const jitter = base => bound(base + (random() - 0.5) * 0.24, 0.12, 0.88);
  return {
    foot: slot === 1 || slot === 8 ? 'left' : 'right',
    weakFoot: Math.round(42 + random() * 36),
    tendencies: {
      advance: jitter(forward ? 0.7 : role === 'CB' ? 0.42 : 0.57),
      risk: jitter(forward ? 0.57 : 0.43),
      carry: jitter(['LW', 'RW'].includes(role) ? 0.69 : role === 'CB' ? 0.28 : 0.45),
      roam: jitter(role === 'CB' ? 0.24 : forward ? 0.64 : 0.49),
      overlap: jitter(back ? 0.51 : 0.3),
      aggression: jitter(role === 'CB' || role === 'DM' ? 0.62 : 0.43),
      discipline: jitter(0.7),
      timing: jitter(0.45 + attrs.vision * 0.003),
      shoot: jitter(forward ? 0.66 : 0.4),
      hold: jitter(role === 'DM' ? 0.65 : role === 'CB' ? 0.78 : 0.25),
      inside: jitter(0.45 + (attrs.shooting - attrs.crossing) * 0.005),
      aerial: jitter(0.4 + (attrs.heading + attrs.strength - 140) * 0.006),
      sweep: jitter(0.4 + (attrs.acceleration + attrs.vision - 120) * 0.004),
    },
  };
}
// The attribute-driven part of a tendency. It depends only on p.attrs and on
// whether the player is a centre-back (Player memoises it on exactly those).
export function tendencyAbility(p, key) {
  const a = p.attrs,
    recovery = 0.55 * a.pace + 0.45 * a.acceleration,
    back = p.role === 'CB';
  const ability = {
    advance: 0.55 + (recovery - 70) * 0.004 + (a.control - 70) * 0.002 - (back ? 0.15 : 0),
    carry:
      0.45 +
      (a.dribbling - a.shortPassing) * 0.006 +
      (a.control - 70) * 0.002 +
      (a.acceleration - 70) * 0.0015,
    risk: 0.43 + (a.vision - 70) * 0.003 + (a.composure - 70) * 0.002,
    shoot:
      0.4 +
      (Math.max(a.shooting, a.longShots) - a.shortPassing) * 0.004 +
      (a.composure - 70) * 0.001,
    overlap:
      0.45 +
      (a.crossing - a.defending) * 0.005 +
      (a.stamina - 70) * 0.002 +
      (recovery - 70) * 0.003,
    timing: 0.45 + a.vision * 0.002 + a.awareness * 0.001,
    roam: 0.5 + (recovery - 70) * 0.003 + (a.stamina - 70) * 0.002 - (back ? 0.18 : 0),
    aggression: 0.5 + (a.defending - 70) * 0.002 + (a.strength - 70) * 0.002,
    discipline: 0.65 + (a.awareness - 70) * 0.002 + (a.composure - 70) * 0.002,
    hold: 0.45 + (a.awareness - a.shooting) * 0.004 - (recovery - 70) * 0.003,
    inside: 0.45 + (a.shooting - a.crossing) * 0.005 + (a.control - 70) * 0.002,
    aerial: 0.4 + (a.heading + a.strength - 140) * 0.006,
    sweep: 0.4 + (a.acceleration + a.vision - 120) * 0.004,
  };
  return bound(ability[key] ?? 0.5, 0.05, 0.95);
}
// Blend the stored tendency with the ability-driven one and add badge nudges.
export function blendPreference(p, key, ability) {
  const sourceWeight = (p.tuning?.ratings || CONFIG.ratings).storedTendencyWeight;
  let value = sourceWeight * (p.tendencies?.[key] ?? 0.5) + (1 - sourceWeight) * ability;
  const changes = (p.tuning?.badges || CONFIG.badges).tendencies[key],
    tags = p.tags;
  if (changes && tags) for (const tag in changes) if (tags.includes(tag)) value += changes[tag];
  return bound(value, 0.05, 0.95);
}
export function preference(p, key) {
  return blendPreference(p, key, tendencyAbility(p, key));
}
export function footExecution(p, angle) {
  const turn = Math.atan2(Math.sin(angle - p.facing), Math.cos(angle - p.facing));
  // Facing a ball to one's non-dominant side makes an awkward release more likely.
  const side = p.foot === 'left' ? -1 : 1,
    weak = turn * side < -0.35;
  return {
    foot: weak ? (p.foot === 'left' ? 'right' : 'left') : p.foot,
    weak,
    quality: weak ? 0.66 + (p.weakFoot ?? 60) * 0.0034 : 1,
  };
}
