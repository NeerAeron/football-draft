import { Match, DURATION_PROFILES } from '../app/engine.js';
const count = Number(process.argv[2] || 48),
  firstSeed = Number(process.argv[3] || 1001);
const median = a => {
  const s = [...a].sort((x, y) => x - y);
  return (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2;
};
const mean = a => a.reduce((s, v) => s + v, 0) / a.length,
  results = [];
for (const duration of process.argv[4] ? [Number(process.argv[4])] : [300, 180]) {
  const samples = [];
  for (let seed = firstSeed; seed < firstSeed + count; seed++) {
    const m = new Match(seed, duration);
    while (!m.finished) m.step(1 / 60);
    samples.push({
      seed,
      score: m.score,
      total: m.score[0] + m.score[1],
      stats: m.stats,
      goals: m.goalHistory.map(e => ({
        box: e.box,
        assist: e.assistId != null,
        type: e.shotType,
        zone: e.zone,
        origin: e.origin,
      })),
      energy: m.players.map(p => p.energy),
      duels: m.duelHistory.length,
      boxDuels: m.duelHistory.filter(d => d.box).length,
      shotTypes: m.events.filter(e => e.type === 'shot').map(e => e.shotType),
    });
  }
  const sum = k => samples.reduce((v, s) => v + s.stats.reduce((n, t) => n + t[k], 0), 0),
    goals = samples.reduce((n, s) => n + s.total, 0);
  const summary = {
    duration,
    count,
    physicsStep: 1 / 60,
    medianHome: median(samples.map(s => s.score[0])),
    medianAway: median(samples.map(s => s.score[1])),
    medianTotal: median(samples.map(s => s.total)),
    meanGoals: mean(samples.map(s => s.total)),
    meanShots: sum('shots') / count,
    onTarget: sum('onTarget') / sum('shots'),
    boxGoalShare: sum('boxGoals') / goals,
    centralGoalShare: sum('centralGoals') / goals,
    zoneGoals: samples
      .flatMap(s => s.goals)
      .reduce((counts, g) => {
        counts[g.zone] = (counts[g.zone] || 0) + 1;
        return counts;
      }, {}),
    assistedGoalShare: sum('assistedGoals') / goals,
    passAccuracy: sum('completed') / sum('passes'),
    keeperReleases: sum('keeperDistributions'),
    keeperLosses: sum('keeperLosses'),
    meanFouls: sum('fouls') / count,
    meanOffsides: sum('offsides') / count,
    meanPenalties: sum('penalties') / count,
    penaltyGoals: sum('penaltyGoals'),
    penalties: sum('penalties'),
    forwardPassShare: sum('forwardPasses') / sum('passes'),
    meanStamina: mean(samples.flatMap(s => s.energy)),
    outfieldStamina: mean(samples.flatMap(s => s.energy.filter((v, i) => i % 11 !== 0))),
    keeperStamina: mean(samples.flatMap(s => s.energy.filter((v, i) => i % 11 === 0))),
    staminaBelow10Share:
      samples.flatMap(s => s.energy).filter(v => v < 0.1).length / (samples.length * 22),
    headerShare:
      samples.flatMap(s => s.shotTypes).filter(t => t === 'Header').length / sum('shots'),
  };
  results.push({ summary, profile: DURATION_PROFILES[duration], samples });
  console.error(JSON.stringify(summary));
}
console.log(
  JSON.stringify(
    {
      description:
        'Contextual fouls and geometric offsides; outcomes never forced. Paired squads, Balanced style, all four team tactics at level3. Canonical 300s simulation also powers highlights and instant; no score correction.',
      results,
    },
    null,
    2,
  ),
);
