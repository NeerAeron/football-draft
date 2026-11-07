// Optional experiment. No observed rates are loaded by production code.
import { writeFile } from 'node:fs/promises';
import { Match } from '../../app/core/sim/engine.js';
import { Draft } from '../../app/core/draft/draft.js';
import { createAIOpponent, DIFFICULTIES } from '../../app/core/draft/opponent.js';
import { coachAI } from '../../app/core/sim/coach.js';
import { overallRating } from '../../app/core/players/ratings.js';
import { loadRuntimeCatalog } from '../../scripts/data/catalog-file.mjs';
const catalog = loadRuntimeCatalog(),
  output = process.argv[2] || '/tmp/football-ai-calibration.json';
const report = {
  method:
    'Human surrogate drafts highest natural overall after production league/club draws, then uses balanced tactics3. AI uses tier-eligible club or80+ all-stars and its coach. Same execution formulas. No target win rates.',
  matches: [],
  summary: {},
};
for (const level of Object.keys(DIFFICULTIES)) {
  for (let seed = 63101; seed < 63125; seed++) {
    let state = seed;
    const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296,
      opponent = createAIOpponent(catalog, level, random),
      draft = new Draft(catalog, {
        seed,
        formations: ['433', opponent.formation],
        opponent: opponent.players,
      });
    while (!draft.complete) {
      draft.spinLeague();
      draft.spinTeam();
      const p = draft
        .available()
        .sort(
          (a, b) =>
            overallRating(b, false, b.primaryPosition) - overallRating(a, false, a.primaryPosition),
        )[0];
      if (!draft.pick(draft.bestSlot(p), p.profileId)) throw Error('Draft stalled');
    }
    const match = new Match(seed, 180),
      config = match.exportConfig();
    config.players = draft.picks.flat();
    config.competition = { mode: 'ai', difficulty: level };
    config.teams[1].tactics.formation = opponent.formation;
    match.importConfig(config);
    coachAI(match, true);
    let steps = 0;
    while (!match.finished) {
      match.step(1 / 60);
      if (++steps > 24000 || !Number.isFinite(match.ball.x)) throw Error('Invalid match');
    }
    report.matches.push({
      level,
      seed,
      opponent: opponent.name,
      tier: opponent.tier,
      score: match.score,
      result:
        match.score[0] > match.score[1] ? 'win' : match.score[0] < match.score[1] ? 'loss' : 'draw',
      stats: match.stats,
    });
  }
  const rows = report.matches.filter(m => m.level === level);
  report.summary[level] = Object.fromEntries(
    ['win', 'draw', 'loss'].map(result => [result, rows.filter(m => m.result === result).length]),
  );
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(level, report.summary[level]);
}
