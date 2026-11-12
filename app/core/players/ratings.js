import { CONFIG } from '../config/config.js';
import { clamp } from '../util/math.js';
// Numeric abilities are the simulation inputs; categories are display summaries.
export const ATTRS = {
  pace: 'Sprint speed',
  acceleration: 'Acceleration',
  shooting: 'Finishing',
  power: 'Shot power',
  longShots: 'Long shots',
  penalties: 'Penalties',
  heading: 'Heading',
  shortPassing: 'Short passes',
  longPassing: 'Long passes',
  crossing: 'Crosses',
  vision: 'Vision',
  dribbling: 'Dribbling',
  control: 'First touch',
  composure: 'Composure',
  defending: 'Tackling',
  awareness: 'Def. awareness',
  stamina: 'Stamina',
  strength: 'Strength',
  goalkeeping: 'Goalkeeping',
};
export const RATING_GROUPS = [
  { id: 'pace', label: 'Pace', weights: { pace: 0.6, acceleration: 0.4 } },
  {
    id: 'shooting',
    label: 'Shooting',
    weights: { shooting: 0.4, power: 0.2, longShots: 0.2, penalties: 0.1, heading: 0.1 },
  },
  {
    id: 'passing',
    label: 'Passing',
    weights: { shortPassing: 0.35, longPassing: 0.25, crossing: 0.2, vision: 0.2 },
  },
  {
    id: 'control',
    label: 'Ball control',
    weights: { dribbling: 0.45, control: 0.35, composure: 0.2 },
  },
  { id: 'defending', label: 'Defending', weights: { defending: 0.5, awareness: 0.5 } },
  { id: 'physical', label: 'Physical', weights: { stamina: 0.6, strength: 0.4 } },
  { id: 'goalkeeping', label: 'Goalkeeping', weights: { goalkeeping: 1 } },
];
const attribute = (value, fallback) =>
  Math.round(
    clamp(
      Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : fallback,
      1,
      99,
    ),
  );
// Old saved configurations and tests can still set passing; new exports use
// the three detailed abilities. The alias is never a second runtime rating.
const PASSING_ALIAS = {
  enumerable: false,
  get() {
    return this.shortPassing;
  },
  set(v) {
    this.shortPassing = this.longPassing = this.crossing = clamp(Number(v), 1, 99);
  },
};
// Returns every ATTRS key, in ATTRS order. The object is built from one literal
// with one shared accessor so that all attribute objects have the same fast
// hidden class: the simulation reads them in its hottest paths, and
// Object.fromEntries plus a per-object accessor left them in dictionary mode.
export function normalizeAttributes(input = {}) {
  const legacy = input.passing ?? input.shortPassing ?? 65;
  const attrs = {
    pace: attribute(input.pace, 70),
    acceleration: attribute(input.acceleration, input.pace ?? 70),
    shooting: attribute(input.shooting, 60),
    power: attribute(input.power, 60),
    longShots: attribute(input.longShots, input.shooting ?? 60),
    penalties: attribute(input.penalties, input.shooting ?? 60),
    heading: attribute(input.heading, 50),
    shortPassing: attribute(input.shortPassing, legacy),
    longPassing: attribute(input.longPassing, legacy),
    crossing: attribute(input.crossing, legacy),
    vision: attribute(input.vision, 65),
    dribbling: attribute(input.dribbling, 65),
    control: attribute(input.control, 65),
    composure: attribute(input.composure, 65),
    defending: attribute(input.defending, 55),
    awareness: attribute(input.awareness, ((input.vision ?? 65) + (input.defending ?? 55)) / 2),
    stamina: attribute(input.stamina, 75),
    strength: attribute(input.strength, 65),
    goalkeeping: attribute(input.goalkeeping, 8),
  };
  Object.defineProperty(attrs, 'passing', PASSING_ALIAS);
  return attrs;
}
export const OVERALL_WEIGHTS = CONFIG.ratings.roleWeights;
export const POSITIONS = Object.keys(OVERALL_WEIGHTS);
const distances = Object.fromEntries(
  POSITIONS.map(a => [a, Object.fromEntries(POSITIONS.map(b => [b, a === b ? 0 : Infinity]))]),
);
// Position distances in steps: 1 = a neighbouring role (costs about a rating point on top of
// what the role's own attribute weights say), twin wide roles a quarter step, a striker
// dropping to No. 10 three quarters. Familiarity falls
// off slowly at first and faster for far moves (see positionFamiliarity); the steps were set
// against EA's own per-position ratings (docs/calibration.md, "Out of position").
for (const [a, b, d] of [
  ['RW', 'RM', 0.25],
  ['LW', 'LM', 0.25],
  ['LW', 'RW', 1],
  ['LM', 'RM', 1],
  ['LB', 'RB', 1],
  ['DM', 'CM', 1],
  ['CM', 'AM', 1],
  ['AM', 'ST', 0.75],
  ['AM', 'LW', 1],
  ['AM', 'RW', 1],
  ['CM', 'LM', 1],
  ['CM', 'RM', 1],
  ['CB', 'DM', 1],
  ['CB', 'LB', 1],
  ['CB', 'RB', 1],
  ['LB', 'LM', 1],
  ['RB', 'RM', 1],
  ['ST', 'LW', 1],
  ['ST', 'RW', 1],
])
  distances[a][b] = distances[b][a] = d;
for (const k of POSITIONS)
  for (const a of POSITIONS)
    for (const b of POSITIONS)
      distances[a][b] = Math.min(distances[a][b], distances[a][k] + distances[k][b]);
const familiarityCache = new WeakMap();
const NO_POSITIONS = Object.freeze([]);
// Familiarity multiplies the role rating: base + bonus * exp(-(decay * steps)^2), i.e. about
// 0.985 one step away, 0.945 at two, 0.89 at three, 0.84 at four; no path (an outfielder in
// goal, a keeper outfield) gives unfamiliarFit.
// Hot path: called many times per simulation step. The cache compares the
// tuning values directly (they can be edited in place) without allocating.
export function positionFamiliarity(p, role = p.role) {
  const primary = p.primaryPosition || p.role,
    secondary = p.secondaryPositions || NO_POSITIONS,
    tuning = p.tuning?.ratings || CONFIG.ratings;
  const cached = familiarityCache.get(p);
  if (
    cached !== undefined &&
    cached.role === role &&
    cached.primary === primary &&
    cached.secondary === secondary &&
    cached.base === tuning.familiarityBase &&
    cached.bonus === tuning.familiarityBonus &&
    cached.decay === tuning.familiarityDecay &&
    cached.secondaryDistance === tuning.secondaryDistance &&
    cached.unfamiliarFit === tuning.unfamiliarFit
  )
    return cached.value;
  let d = distances[primary]?.[role] ?? Infinity;
  for (const secondaryRole of secondary)
    d = Math.min(d, tuning.secondaryDistance + (distances[secondaryRole]?.[role] ?? Infinity));
  const value = Number.isFinite(d)
    ? tuning.familiarityBase +
      tuning.familiarityBonus * Math.exp(-((tuning.familiarityDecay * d) ** 2))
    : tuning.unfamiliarFit;
  familiarityCache.set(p, {
    role,
    primary,
    secondary,
    value,
    base: tuning.familiarityBase,
    bonus: tuning.familiarityBonus,
    decay: tuning.familiarityDecay,
    secondaryDistance: tuning.secondaryDistance,
    unfamiliarFit: tuning.unfamiliarFit,
  });
  return value;
}
export function roleAbility(p, role = p.role) {
  const source = p.tuning?.ratings.roleWeights || OVERALL_WEIGHTS,
    weights = source[role] || source.CM;
  return (
    Object.entries(weights).reduce((sum, [key, weight]) => sum + (p.attrs[key] ?? 0) * weight, 0) /
    Object.values(weights).reduce((sum, w) => sum + w, 0)
  );
}
// FC26-calibrated role weights retain every detailed ability. Nearby wide roles
// share the same ability model; familiarity handles the small position penalty.
// No per-player source overall or hidden correction is used at runtime.
export const OVERALL_OFFSETS = CONFIG.ratings.roleOffsets;
export function calibratedRoleAbility(p, role = p.role) {
  const ratings = p.tuning?.ratings || CONFIG.ratings,
    ability = roleAbility(p, role) + (ratings.roleOffsets[role] || 0);
  // The weighted attributes compress the very top (a player EA rates 89 came out at 87):
  // every point above `topFrom` is stretched by `topLift`, which puts the best players back
  // near EA's overall without moving the rest. Not for keepers: their overall is their one
  // goalkeeping attribute, which already is EA's overall.
  if (role === 'GK') return clamp(ability, 1, 99);
  return clamp(ability + Math.max(0, ability - ratings.topFrom) * ratings.topLift, 1, 99);
}
export function overallRating(p, rounded = true, role = p.role) {
  const value = calibratedRoleAbility(p, role) * positionFamiliarity(p, role);
  return rounded ? Math.round(value) : value;
}
export function playerTier(p) {
  const overall = overallRating(p, true, p.primaryPosition || p.role);
  const [name, tier] = Object.entries(p.tuning?.playerTiers || CONFIG.playerTiers).find(
    ([, t]) => overall >= t.minimum,
  ) || ['Bench', CONFIG.playerTiers.Bench];
  return {
    name,
    minimum: tier.badgeMinimum,
    capacity: tier.badgeMaximum,
    floor: tier.minimum,
    overall,
  };
}
const TEAM_LINES = {
  def: ['GK', 'CB', 'LB', 'RB'],
  mid: ['DM', 'CM', 'AM', 'LM', 'RM'],
  att: ['ST', 'LW', 'RW'],
};
export function teamRatings(players, team) {
  return Object.fromEntries(
    Object.entries(TEAM_LINES).map(([line, roles]) => {
      const group = players.filter(p => p.team === team && roles.includes(p.role));
      return [
        line,
        group.length
          ? Math.round(group.reduce((sum, p) => sum + overallRating(p, false), 0) / group.length)
          : null,
      ];
    }),
  );
}
export function categoryRating(p, group) {
  return Math.round(Object.entries(group.weights).reduce((s, [k, w]) => s + p.attrs[k] * w, 0));
}
export function passingAbility(p, distance, delivery = 'pass') {
  const a = p.skill
    ? Object.fromEntries(['crossing', 'longPassing', 'shortPassing'].map(k => [k, p.skill(k)]))
    : p.attrs;
  if (delivery === 'cross') return a.crossing * 0.8 + a.longPassing * 0.2;
  if (delivery === 'cutback') return a.shortPassing * 0.7 + a.crossing * 0.3;
  const long = clamp((distance - 16) / 20, 0, 1);
  return a.shortPassing * (1 - long) + a.longPassing * long;
}
export function shootingAbility(p, distance, context = {}) {
  const skill = k => (p.skill ? p.skill(k) : p.attrs[k]);
  if (context.penalty) return skill('penalties');
  if (context.header) return skill('heading');
  const long = clamp((distance - 16) / 12, 0, 1);
  return skill('shooting') * (1 - long) + skill('longShots') * long;
}
