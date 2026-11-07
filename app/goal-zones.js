// Derived from StatsBomb Open Data: all115 matches of WorldCup2022 + Euro2024.
// Snapshot4b73468fc5b0f1950f9f66fada70ad3a4f9327cb;2,734 non-penalty shots.
// Excludes shootouts, penalty kicks and own-goal events. See data/goal-location-reference.json.
// Match landmarks, rather than globally scaling StatsBomb's120×80 coordinates.
export const GOAL_ZONES = {
  six_central: { label: 'Central six-yard area', shots: 208, goals: 54 },
  near_central: { label: 'Central box · 5.5–11 m', shots: 561, goals: 84 },
  deep_central: { label: 'Central box · 11–16.5 m', shots: 373, goals: 48 },
  wide_box: { label: 'Side of the box', shots: 524, goals: 34 },
  outside_central: { label: 'Central · outside the box', shots: 639, goals: 22 },
  outside_wide: { label: 'Wide · outside the box', shots: 429, goals: 8 },
};
export const GOAL_REFERENCE = {
  matches: 115,
  shots: 2734,
  goals: 250,
  inside: 220,
  outside: 30,
  central: 208,
  designInside: 0.85,
  designOutside: 0.15,
};
const limit = (v, a, b) => Math.max(a, Math.min(b, v));
export function goalZone(attackX, y) {
  const depth = 105 - attackX,
    central = Math.abs(y - 34) <= 9.16,
    inside = depth <= 16.5 && Math.abs(y - 34) <= 20.16;
  if (!inside) return central ? 'outside_central' : 'outside_wide';
  if (!central) return 'wide_box';
  return depth <= 5.5 ? 'six_central' : depth <= 11 ? 'near_central' : 'deep_central';
}
export function goalGeometry(attackX, y) {
  const depth = Math.max(0.1, 105 - attackX),
    lateral = y - 34,
    distance = Math.hypot(depth, lateral),
    zone = goalZone(attackX, y),
    tile = GOAL_ZONES[zone];
  const angle = Math.atan2(7.32 * depth, depth * depth + lateral * lateral - 3.66 * 3.66),
    frontAngle = 2 * Math.atan2(3.66, depth);
  // Small sample smoothing; this is a spatial prior, not a score allocation.
  const rate = (tile.goals + 1) / (tile.shots + 12),
    quality = limit(Math.sqrt(rate / (85 / 573)), 0.28, 1.4);
  return {
    zone,
    depth,
    distance,
    angle,
    openness: limit(angle / frontAngle, 0.025, 1),
    rate,
    quality,
    inside: !zone.startsWith('outside'),
    central: Math.abs(lateral) <= 9.16,
  };
}
