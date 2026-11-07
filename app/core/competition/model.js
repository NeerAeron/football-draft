// Fast seeded result model for matches that are not simulated by the engine (AI vs AI in a
// cup group, projections, optional quick-sims). Independent Poisson goals:
//   lambda_A = goals * exp(+slope * (rA - rB)),  lambda_B = goals * exp(-slope * (rA - rB))
// with ratings on the effective scale (team OVR + mean link chem). goals 1.3 and slope 0.09
// per rating point roughly follow pre-overhaul engine results by rating gap (review match-gap
// sample, 50 matches: gap > +4 won 10/12; gap < -4 won 4/19, lost 12/19). Model: gap +8 →
// 80% W / 13% D; gap 0 → 37 / 26 / 37; gap -7 → 9% W / 76% L. Provisional: re-fit once the
// engine overhaul lands. Shootouts: 5 kicks each then sudden death, each kick scored with
// probability 0.75 ± 0.01 per rating point.

export const MATCH_MODEL = { goals: 1.3, slope: 0.09, maxGoals: 9, kick: 0.75, kickSlope: 0.01 };

/** Expected goals [a, b] for two effective ratings. */
export function expectedGoals(ratingA, ratingB, model = MATCH_MODEL) {
  const d = ratingA - ratingB;
  return [model.goals * Math.exp(model.slope * d), model.goals * Math.exp(-model.slope * d)];
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
export function outcomeProbabilities(ratingA, ratingB, model = MATCH_MODEL) {
  const [a, b] = expectedGoals(ratingA, ratingB, model),
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
 * One result: { goals: [a, b], shootout: null | { winner, score } }. A knockout draw is
 * settled by a shootout.
 */
export function simulateResult(
  ratingA,
  ratingB,
  random,
  { knockout = false, model = MATCH_MODEL } = {},
) {
  const [a, b] = expectedGoals(ratingA, ratingB, model),
    goals = [poisson(a, random, model.maxGoals), poisson(b, random, model.maxGoals)];
  return {
    goals,
    shootout:
      knockout && goals[0] === goals[1] ? simulateShootout(ratingA, ratingB, random, model) : null,
  };
}
