// Fast seeded result model for matches that are not simulated by the engine (AI vs AI in a
// cup group, projections, optional quick-sims). Independent Poisson goals:
//   lambda_A = goals * exp(+slope * (rA - rB)),  lambda_B = goals * exp(-slope * (rA - rB))
// `goals` 1.46: set again after the kick-off level got its unit terms and the era data moved
// the drafted XIs (480 matches of `gaps`: 1.50 a side, slope 0.0525, the user's constant down
// to 0.04; the 980 run matches of the mode table: 1.44) — the paragraph below is the fit before.
// with ratings on the effective scale (team OVR + mean link chem). Fitted to 624 matches of the
// engine in the game's 180 s match (tools/calibration/cup-calibration.mjs gaps, then fit): a
// typically drafted XI against ladder opponents at gaps of −12…+20, the AI coach at each
// difficulty's level, both sides on the game-state mentality. goals 1.33 per side at gap 0 and
// slope 0.0525 per rating point reproduce the scoring level (2.9 goals a match on those gaps;
// about 3 in every mode since the engine plays to the level of the match, docs/calibration.md
// Phase 9 — it was 1.71 a side, 3.6–3.9 a match) and win/draw/loss by gap: gap 0 → 37% W /
// 26% D / 37% L, gap 6 → 61 / 22 / 17; engine vs model −8…−4 30/28/43 vs 19/22/59, −4…−1.5
// 24/28/48 vs 27/25/48, −1.5…+1.5 47/32/21 vs 37/26/37, +1.5…+4 57/28/15 vs 47/25/28, +4…+8
// 67/22/11 vs 61/21/18, +8…+13 83/11/6 vs 75/15/10. The user's drafted XI does better than its
// rating says: a constant of 0.14 in the exponent, about 2.5 rating points (the fit with that
// constant gives goals 1.32, slope 0.0550; the slope is kept at 0.0525, within the fit's
// step). It holds the engine's edge for the player's side as favourite (tuning.userEdge) and
// the Legend and Prime versions a World Cup draft adds; the model stays symmetric and the
// cup's own edges (cup.js) are measured on top of it. The AI coach's level moves the user's
// edge by less than one rating point, with no trend.
// Extra time (a level knockout match, before penalties): the same two Poisson rates over a third
// of the match at EXTRA_RATE of its scoring rate — tired legs. Engine, 480 club fixtures level
// at 90 minutes: 0.61 goals in extra time against 0.69 for 30 ordinary minutes (2.07 a match),
// 45% of the ties decided there and 55% on penalties (docs/competition-api.md).
// Shootouts: 5 kicks each then sudden death, each kick scored with probability 0.75 ± 0.005 per
// rating point (340 engine shootouts: the stronger side by 6 wins 62%, the weaker 41%).

// Units (optional): a side's rate also follows its attack against the defence it faces.
// `units = [a, b]`, each { overall, attack, defence } (players/unit-levels.js unitLevels):
// per point of unitLean — the opponent's defence above the opponent's overall, less its own
// attack above its own — a side scores `units` (3.6%) less. Engine, a grid of 960 matches
// between club XIs with their lines swapped (docs/calibration.md, Phase 10): 2.45% a point from
// what better defenders and keepers do in play, 3.6% with the kick-off level's unit term.
// Without `units` nothing changes. The sides of a run carry them (buildSide, opponentCandidates:
// `side.units`), and every result of the fast model between two such sides takes them
// (`unitsOf(a, b)`): the user's simmed matches, the other matches of his group, Legendary's
// World Cup around him and the ties that complete a tournament for its awards. projectRun and
// the odds bars work on ratings alone.
import { unitLean } from '../players/unit-levels.js';

const EXTRA_RATE = 0.88;
const EXTRA_TIME_SHARE = Math.round((EXTRA_RATE / 3) * 1000) / 1000;

export const MATCH_MODEL = {
  goals: 1.46,
  slope: 0.0525,
  units: 0.036,
  maxGoals: 9,
  kick: 0.75,
  kickSlope: 0.005,
  // Goals in extra time as a share of the ninety minutes' (30 of 90 minutes × EXTRA_RATE).
  extraTime: EXTRA_TIME_SHARE,
};

/**
 * The two sides' units for the fast model ([a.units, b.units]) — null unless both have them (a
 * run saved before sides carried units plays on by its ratings alone).
 */
const complete = u =>
  !!u && [u.overall, u.attack, u.defence].every(x => Number.isFinite(x) && x > 0);
export const unitsOf = (a, b) =>
  complete(a?.units) && complete(b?.units) ? [a.units, b.units] : null;
/** Expected goals [a, b] for two effective ratings. */
export function expectedGoals(ratingA, ratingB, model = MATCH_MODEL, units = null) {
  const d = ratingA - ratingB,
    leanA = units ? unitLean(units[0], units[1]) : 0,
    leanB = units ? unitLean(units[1], units[0]) : 0;
  return [
    model.goals * Math.exp(model.slope * d - model.units * leanA),
    model.goals * Math.exp(-model.slope * d - model.units * leanB),
  ];
}
function poisson(lambda, random, max) {
  // Knuth's method; one draw per goal + 1. Deterministic for a seeded random().
  const limit = Math.exp(-lambda);
  let k = 0,
    p = random();
  while (p > limit && k < max) {
    k++;
    p *= random();
  }
  return k;
}
const pmf = (lambda, max) => {
  const out = [];
  let p = Math.exp(-lambda);
  for (let k = 0; k <= max; k++) {
    out.push(p);
    p *= lambda / (k + 1);
  }
  return out;
};
/** Win / draw / loss probabilities of side A (exact for the model). */
export function outcomeProbabilities(ratingA, ratingB, model = MATCH_MODEL, units = null) {
  const [a, b] = expectedGoals(ratingA, ratingB, model, units),
    pa = pmf(a, 15),
    pb = pmf(b, 15);
  let win = 0,
    draw = 0;
  for (let i = 0; i <= 15; i++)
    for (let j = 0; j <= 15; j++) {
      if (i > j) win += pa[i] * pb[j];
      else if (i === j) draw += pa[i] * pb[j];
    }
  return { win, draw, loss: Math.max(0, 1 - win - draw) };
}
/** Penalty shootout: { winner: 0 | 1, score: [a, b] }. */
export function simulateShootout(ratingA, ratingB, random, model = MATCH_MODEL) {
  const d = Math.max(-10, Math.min(10, ratingA - ratingB)),
    p = [model.kick + model.kickSlope * d, model.kick - model.kickSlope * d],
    score = [0, 0];
  for (let k = 0; k < 5; k++) {
    for (let t = 0; t < 2; t++) if (random() < p[t]) score[t]++;
    // Decided early: the trailing side cannot catch up with its remaining kicks.
    if (Math.abs(score[0] - score[1]) > 4 - k) break;
  }
  for (let round = 0; score[0] === score[1] && round < 30; round++) {
    const a = random() < p[0],
      b = random() < p[1];
    score[0] += a;
    score[1] += b;
  }
  if (score[0] === score[1]) score[random() < 0.5 ? 0 : 1]++;
  return { winner: score[0] > score[1] ? 0 : 1, score };
}
/**
 * One result: { goals: [a, b], extraTime: boolean, shootout: null | { winner, score } }.
 * A knockout draw goes to extra time (`extraTime: false` skips it) — `goals` then include its
 * goals — and, still level, to a shootout.
 */
export function simulateResult(
  ratingA,
  ratingB,
  random,
  { knockout = false, extraTime = knockout, model = MATCH_MODEL, units = null } = {},
) {
  const [a, b] = expectedGoals(ratingA, ratingB, model, units),
    goals = [poisson(a, random, model.maxGoals), poisson(b, random, model.maxGoals)];
  let extra = false,
    shootout = null;
  if (knockout && goals[0] === goals[1]) {
    if (extraTime && model.extraTime > 0) {
      extra = true;
      goals[0] += poisson(a * model.extraTime, random, model.maxGoals);
      goals[1] += poisson(b * model.extraTime, random, model.maxGoals);
    }
    if (goals[0] === goals[1]) shootout = simulateShootout(ratingA, ratingB, random, model);
  }
  return { goals, extraTime: extra, shootout };
}
