import { CONFIG } from './config.js';
// Numeric abilities are the simulation inputs; categories are display summaries.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
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
export function normalizeAttributes(input = {}) {
  const legacy = input.passing ?? input.shortPassing ?? 65;
  const defaults = {
    pace: 70,
    acceleration: input.pace ?? 70,
    shooting: 60,
    power: 60,
    longShots: input.shooting ?? 60,
    penalties: input.shooting ?? 60,
    heading: 50,
    shortPassing: legacy,
    longPassing: legacy,
    crossing: legacy,
    vision: 65,
    dribbling: 65,
    control: 65,
    composure: 65,
    defending: 55,
    awareness: ((input.vision ?? 65) + (input.defending ?? 55)) / 2,
    stamina: 75,
    strength: 65,
    goalkeeping: 8,
  };
  const attrs = Object.fromEntries(
    Object.keys(ATTRS).map(k => [
      k,
      Math.round(
        clamp(
          Number.isFinite(Number(input[k])) && input[k] !== null && input[k] !== ''
            ? Number(input[k])
            : defaults[k],
          1,
          99,
        ),
      ),
    ]),
  );
  // Old saved configurations and tests can still set passing; new exports use
  // the three detailed abilities. The alias is never a second runtime rating.
  Object.defineProperty(attrs, 'passing', {
    enumerable: false,
    get() {
      return this.shortPassing;
    },
    set(v) {
      this.shortPassing = this.longPassing = this.crossing = clamp(Number(v), 1, 99);
    },
  });
  return attrs;
}
export const OVERALL_WEIGHTS = CONFIG.ratings.roleWeights;
export const POSITIONS = Object.keys(OVERALL_WEIGHTS);
const distances = Object.fromEntries(
  POSITIONS.map(a => [a, Object.fromEntries(POSITIONS.map(b => [b, a === b ? 0 : Infinity]))]),
);
for (const [a, b, d] of [
  ['RW', 'RM', 0.035],
  ['LW', 'LM', 0.035],
  ['CB', 'DM', 0.6],
  ['CB', 'LB', 0.65],
  ['CB', 'RB', 0.65],
  ['LB', 'RB', 0.35],
  ['DM', 'CM', 0.45],
  ['CM', 'AM', 0.45],
  ['AM', 'ST', 0.65],
  ['AM', 'LW', 0.45],
  ['AM', 'RW', 0.45],
  ['CM', 'LM', 0.5],
  ['CM', 'RM', 0.5],
  ['LB', 'LM', 0.75],
  ['RB', 'RM', 0.75],
  ['LW', 'RW', 0.3],
  ['LM', 'RM', 0.3],
])
  distances[a][b] = distances[b][a] = d;
for (const k of POSITIONS)
  for (const a of POSITIONS)
    for (const b of POSITIONS)
      distances[a][b] = Math.min(distances[a][b], distances[a][k] + distances[k][b]);
const familiarityCache = new WeakMap();
const NO_POSITIONS = Object.freeze([]);
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
    ? tuning.familiarityBase + tuning.familiarityBonus * Math.exp(-tuning.familiarityDecay * d)
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
  return clamp(
    roleAbility(p, role) + ((p.tuning?.ratings.roleOffsets || OVERALL_OFFSETS)[role] || 0),
    1,
    99,
  );
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
