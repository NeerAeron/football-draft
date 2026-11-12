// Fast seeded result model for matches that are not simulated by the engine (AI vs AI in a
// cup group, projections, optional quick-sims). Independent Poisson goals:
//   lambda_A = goals * exp(+slope * (rA - rB)),  lambda_B = goals * exp(-slope * (rA - rB))
// with ratings on the effective scale (team OVR + mean link chem). Fitted to 2,592 matches of the
// engine in the game's 180 s match (tools/calibration/cup-calibration.mjs gaps): a typically
// drafted XI against ladder opponents at gaps of −12…+20, the AI coach at each difficulty's
// level, both sides on the game-state mentality. goals 1.84 per side at gap 0 and slope 0.0525
// per rating point reproduce the scoring level (3.9 goals a match on those gaps) and
// win/draw/loss by gap: gap 0 → 39% W / 22% D / 39% L, gap 6 → 63 / 18 / 19; engine vs model
// −8…−4 19/20/61 vs 21/19/61, −4…−1.5 25/23/51 vs 28/21/51, +1.5…+4 60/18/22 vs 51/21/28,
// +4…+8 69/19/12 vs 63/18/19, +8…+13 83/11/5 vs 77/13/10, +13…+17 91/5/4 vs 90/7/4. The user's
// drafted XI does a little better than its rating says (a constant worth about 0.8 rating
// points; it was 0.4 before `gameplay.qualityImpact` 1.25 made rating gaps count more); the
// model stays symmetric and the cup's own edges (cup.js) are measured on top of it. The AI
// coach's level moves the user's edge by at most ±1 rating point, with no trend.
// `goals` was 1.84 in that fit; it is scaled by the 7% the engine's scoring came down with the
// tight-angle fix and `saveAbility` 1.02 (288 club fixtures: 2.42 → 2.25 goals a match) — not
// refitted, and the win/draw/loss table above is the old fit's. The engine's small edge for
// the player's side as favourite (tuning.userEdge) is not in this model.
// Extra time (a level knockout match, before penalties): the same two Poisson rates over a third
// of the match at EXTRA_RATE of its scoring rate — tired legs. Engine, 480 club fixtures level
// at 90 minutes: 0.61 goals in extra time against 0.69 for 30 ordinary minutes (2.07 a match),
// 45% of the ties decided there and 55% on penalties (docs/competition-api.md).
// Shootouts: 5 kicks each then sudden death, each kick scored with probability 0.75 ± 0.005 per
// rating point (340 engine shootouts: the stronger side by 6 wins 62%, the weaker 41%).

const EXTRA_RATE = 0.88;
const EXTRA_TIME_SHARE = Math.round((EXTRA_RATE / 3) * 1000) / 1000;

export const MATCH_MODEL = {
  goals: 1.71,
  slope: 0.0525,
  maxGoals: 9,
  kick: 0.75,
  kickSlope: 0.005,
  // Goals in extra time as a share of the ninety minutes' (30 of 90 minutes × EXTRA_RATE).
  extraTime: EXTRA_TIME_SHARE,
};

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
 * One result: { goals: [a, b], extraTime: boolean, shootout: null | { winner, score } }.
 * A knockout draw goes to extra time (`extraTime: false` skips it) — `goals` then include its
 * goals — and, still level, to a shootout.
 */
export function simulateResult(
  ratingA,
  ratingB,
  random,
  { knockout = false, extraTime = knockout, model = MATCH_MODEL } = {},
) {
  const [a, b] = expectedGoals(ratingA, ratingB, model),
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
