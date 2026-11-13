// Who scored in a match nobody watched: player lines for a result that came from the fast
// rating model (competition/model.js) — the user's fast-simulated matches and every tie between
// two AI teams. The engine's results carry their own lines; these stand in where there was no
// match, so a tournament has scorers, assists, ratings and clean sheets whichever way it was
// played. Pure and deterministic for `random`.
//
// The rule (matchPerformances):
//   * Each goal goes to one of the eleven, drawn in proportion to ROLE.goal × 2^((finish − 70) /
//     18), finish = 0.5 finishing + 0.2 shot power + 0.15 long shots + 0.15 composure — eighteen
//     points of finishing double a player's share (it was twelve: over the eight matches of a
//     finalist the best finisher of a World Cup then scored 9 on average and up to 15; now 7–8
//     and at most 11), and a striker gets about fifteen times a centre-back's. OWN_GOAL (3%) of
//     the goals belong to nobody.
//   * ASSISTED (85%) of the goals have an assist, drawn among the other ten in proportion to
//     ROLE.assist × 2^((create − 70) / 18), create = 0.4 vision + 0.3 short passes + 0.3 crosses.
//   * The match rating follows the engine's performanceRating (sim/replay.js) with what a result
//     can say: a base per line, +1.1 a goal, +0.7 an assist, keepers and centre-backs +0.55 for
//     a clean sheet or −0.09 per goal conceded, a keeper +0.22 a save (2–4 saves, one more when
//     he concedes three or more), ±0.35 of form; 3–10, one decimal.
// The role weights and bases are the engine's own shares over 60 run matches (goals per player
// and match: AM 0.42, ST 0.33, CM 0.27, wingers 0.21, DM 0.17, wide midfielders 0.09; average
// rating: keepers 6.5, defenders 6.1, midfielders 6.5, forwards 6.6–6.7).

const ROLE = {
  GK: { goal: 0, assist: 0.02, base: 5.8 },
  CB: { goal: 0.06, assist: 0.08, base: 6.1 },
  LB: { goal: 0.08, assist: 0.4, base: 6.05 },
  RB: { goal: 0.08, assist: 0.4, base: 6.05 },
  DM: { goal: 0.25, assist: 0.5, base: 6.2 },
  CM: { goal: 0.5, assist: 0.8, base: 6.2 },
  LM: { goal: 0.45, assist: 0.9, base: 6.15 },
  RM: { goal: 0.45, assist: 0.9, base: 6.15 },
  AM: { goal: 0.9, assist: 1, base: 6.2 },
  LW: { goal: 0.7, assist: 1, base: 6.25 },
  RW: { goal: 0.7, assist: 1, base: 6.25 },
  ST: { goal: 1, assist: 0.5, base: 6.2 },
};
const OWN_GOAL = 0.03,
  ASSISTED = 0.85,
  FORM = 0.35;
const attr = (p, key) => Number(p.attrs?.[key]) || 60;
const lift = ability => 2 ** ((ability - 70) / 18);
const finish = p =>
  0.5 * attr(p, 'shooting') +
  0.2 * attr(p, 'power') +
  0.15 * attr(p, 'longShots') +
  0.15 * attr(p, 'composure');
const create = p =>
  0.4 * attr(p, 'vision') + 0.3 * attr(p, 'shortPassing') + 0.3 * attr(p, 'crossing');
const role = p => ROLE[p.role] ?? ROLE.CM;

function draw(weights, random, skip = -1) {
  let total = 0;
  for (let i = 0; i < weights.length; i++) if (i !== skip) total += weights[i];
  if (!(total > 0)) return -1;
  let r = random() * total;
  for (let i = 0; i < weights.length; i++) {
    if (i === skip) continue;
    if ((r -= weights[i]) < 0) return i;
  }
  return weights.findLastIndex((w, i) => i !== skip && w > 0);
}

/**
 * Player lines of one side for a modelled result.
 * @param xi the side's players in slot order: [{ profileId, role, attrs }]
 * @param result { goalsFor, goalsAgainst, random }
 * @returns [{ profileId, rating (3–10, one decimal), goals, assists }] in the same order
 */
export function matchPerformances(xi, { goalsFor, goalsAgainst, random }) {
  const goalWeights = xi.map(p => role(p).goal * lift(finish(p))),
    assistWeights = xi.map(p => role(p).assist * lift(create(p))),
    goals = xi.map(() => 0),
    assists = xi.map(() => 0);
  for (let g = 0; g < goalsFor; g++) {
    if (random() < OWN_GOAL) continue;
    const scorer = draw(goalWeights, random);
    if (scorer < 0) continue;
    goals[scorer]++;
    if (random() < ASSISTED) {
      const maker = draw(assistWeights, random, scorer);
      if (maker >= 0) assists[maker]++;
    }
  }
  return xi.map((p, i) => {
    const keeper = p.role === 'GK',
      clean = keeper || p.role === 'CB' ? (goalsAgainst === 0 ? 0.55 : -goalsAgainst * 0.09) : 0,
      saves = keeper ? 2 + Math.floor(random() * 3) + (goalsAgainst >= 3 ? 1 : 0) : 0,
      form = (random() * 2 - 1) * FORM,
      rating = role(p).base + goals[i] * 1.1 + assists[i] * 0.7 + clean + saves * 0.22 + form;
    return {
      profileId: String(p.profileId),
      rating: Math.round(Math.min(10, Math.max(3, rating)) * 10) / 10,
      goals: goals[i],
      assists: assists[i],
    };
  });
}
