import { BADGES, badgeEligible } from './traits.js';
import { playerTier } from './ratings.js';
import { CONFIG } from './config.js';
const weights = {
  slalom: { dribbling: 0.45, acceleration: 0.35, control: 0.2 },
  pressescape: { control: 0.5, composure: 0.35, strength: 0.15 },
  givego: { shortPassing: 0.45, control: 0.3, vision: 0.25 },
  latearrival: { shooting: 0.45, composure: 0.35, vision: 0.2 },
  overlap: { crossing: 0.45, stamina: 0.3, pace: 0.25 },
  anchor: { awareness: 0.55, defending: 0.35, strength: 0.1 },
  speedster: { pace: 0.45, acceleration: 0.55 },
  dribbler: { dribbling: 0.8, control: 0.2 },
  control: { control: 0.8, composure: 0.2 },
  vision: { vision: 0.8, shortPassing: 0.2 },
  through: { vision: 0.5, shortPassing: 0.25, longPassing: 0.25 },
  crosser: { crossing: 1 },
  cutback: { crossing: 0.5, shortPassing: 0.35, vision: 0.15 },
  finisher: { shooting: 0.7, composure: 0.3 },
  longshot: { longShots: 1 },
  power: { power: 0.8, longShots: 0.2 },
  curve: { shooting: 0.5, longShots: 0.5 },
  knuckle: { power: 0.55, longShots: 0.45 },
  onetouch: { shortPassing: 0.6, control: 0.4 },
  heading: { heading: 0.8, strength: 0.2 },
  shield: { strength: 0.7, control: 0.3 },
  penalty: { penalties: 0.85, composure: 0.15 },
  volley: { shooting: 0.6, heading: 0.4 },
  longball: { longPassing: 0.85, vision: 0.15 },
  ballwinner: { defending: 0.8, strength: 0.2 },
  interceptor: { awareness: 0.8, defending: 0.2 },
  marker: { awareness: 0.5, defending: 0.5 },
  recovery: { acceleration: 0.4, pace: 0.25, awareness: 0.35 },
  engine: { stamina: 1 },
  safehands: { goalkeeping: 0.9, control: 0.1 },
  reflexes: { goalkeeping: 0.9, acceleration: 0.1 },
  distributor: { longPassing: 0.6, shortPassing: 0.4 },
  gkreach: { goalkeeping: 1 },
  gkoneonone: { goalkeeping: 0.8, composure: 0.2 },
  gkcommand: { goalkeeping: 0.7, awareness: 0.3 },
  gkfeet: { control: 0.5, shortPassing: 0.5 },
};
const identityKeys = {
  slalom: 'carry',
  pressescape: 'carry',
  givego: 'timing',
  latearrival: 'timing',
  overlap: 'overlap',
  anchor: 'hold',
};
export function rankBadges(p, evidence = []) {
  const source = new Map(evidence.map(e => [e.tag, e]));
  return BADGES.filter(b => badgeEligible(p, b))
    .map(b => {
      const ability = Object.entries(weights[b.id]).reduce(
          (n, [k, w]) => n + (p.attrs[k] || 0) * w,
          0,
        ),
        explicit = source.get(b.id);
      const identity = identityKeys[b.id],
        fit = identity ? ((p.tendencies?.[identity] ?? 0.5) - 0.5) * 0.05 : 0;
      return explicit
        ? { ...explicit, ability }
        : {
            tag: b.id,
            confidence: 0.45 + ability / 500 + fit,
            ability,
            evidence:
              'Inferred from ' +
              Object.keys(weights[b.id]).join(', ') +
              (identity ? ' and ' + identity + ' tendency' : ''),
          };
    })
    .sort(
      (a, b) => b.confidence - a.confidence || b.ability - a.ability || a.tag.localeCompare(b.tag),
    );
}
export function compileBadges(p, evidence = []) {
  const tier = playerTier(p),
    floor = tier.floor,
    richness = evidence.filter(e => e.confidence >= 0.8).length >= 6 ? 1 : 0;
  const ceiling = Math.min(
    100,
    ...Object.values(p.tuning?.playerTiers || CONFIG.playerTiers)
      .map(t => t.minimum)
      .filter(n => n > floor),
  );
  const step = Math.min(3, (ceiling - floor) / (tier.capacity - tier.minimum + 1));
  const count = Math.min(
    tier.capacity,
    tier.minimum + Math.max(0, Math.floor((tier.overall - floor) / step)) + richness,
  );
  return rankBadges(p, evidence).slice(0, count);
}
export function normalizeBadges(p, ids = []) {
  const tier = playerTier(p),
    eligible = new Set(BADGES.filter(b => badgeEligible(p, b)).map(b => b.id));
  const result = [...new Set(ids)].filter(id => eligible.has(id)).slice(0, tier.capacity);
  for (const b of rankBadges(p, p.inference?.badges || [])) {
    if (result.length >= tier.minimum) break;
    if (!result.includes(b.tag)) result.push(b.tag);
  }
  return result;
}
