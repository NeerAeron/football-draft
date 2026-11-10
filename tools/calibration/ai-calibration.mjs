// Optional experiment: engine results of a typical drafted XI against the difficulty ladder.
// No observed rates are loaded by production code.
//
//   node tools/calibration/ai-calibration.mjs [out.json] [--mode nations] [--n 24]
//
// Per difficulty: a solo draft with the session's positional policy (suggestPick), then a
// full 3-minute engine match against pickOpponent() for that level (the user's players
// excluded), with the in-match AI coach on side 1 at the level the pre-match screen uses.
import { writeFile } from 'node:fs/promises';
import { Match } from '../../app/core/sim/engine.js';
import { coachAI } from '../../app/core/sim/coach.js';
import {
  createDraftSession,
  matchSetup,
  applyMatchSetup,
  DIFFICULTIES,
} from '../../app/core/draft/session.js';
import { pickOpponent } from '../../app/core/draft/opponents.js';
import { loadRuntimeCatalog } from '../../scripts/data/catalog-file.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const output = args[0] && !args[0].startsWith('--') ? args[0] : '/tmp/football-ai-calibration.json';
const mode = option('--mode', 'nations'),
  count = Number(option('--n', 24));
// Same mapping as app/ui/lib/prematch-store.js (COACH_LEVEL).
const COACH_LEVEL = {
  pro: 'medium',
  worldclass: 'hard',
  legendary: 'impossible',
};
const catalog = loadRuntimeCatalog();
const report = {
  method:
    'Positional solo draft (suggestPick, no re-rolls) vs the ladder opponent of each level; full 180 s engine matches, AI coach on the opponent. No target win rates.',
  mode,
  matches: [],
  summary: {},
};
for (const level of DIFFICULTIES) {
  for (let seed = 63101; seed < 63101 + count; seed++) {
    const draft = createDraftSession(catalog, { mode, seed, difficulty: level });
    while (!draft.complete) {
      draft.spin();
      const move = draft.suggestPick();
      if (!move || !draft.pick(move.profileId, move.slot).ok) throw Error('Draft stalled');
    }
    const home = draft.matchSide(0),
      away = pickOpponent(catalog, {
        mode,
        level,
        seed,
        excludePlayers: home.players.map(p => p.profileId),
      });
    const match = new Match(seed, 180);
    match.importConfig(
      applyMatchSetup(match.exportConfig(), matchSetup(home, away), {
        mode: 'ai',
        difficulty: COACH_LEVEL[level],
      }),
    );
    coachAI(match, true);
    let steps = 0;
    while (!match.finished) {
      match.step(1 / 60);
      if (++steps > 24000 || !Number.isFinite(match.ball.x)) throw Error('Invalid match');
    }
    report.matches.push({
      level,
      seed,
      rating: home.effective,
      opponent: away.name,
      opponentRating: away.effective,
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
