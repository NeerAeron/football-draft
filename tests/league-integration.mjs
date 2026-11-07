import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Match } from '../app/engine.js';
import { Draft } from '../app/draft.js';
import { createAIOpponent, coachAI } from '../app/ai.js';
import { overallRating } from '../app/ratings.js';
const bytes = await readFile(new URL('../app/data/players-fc26.json', import.meta.url)),
  catalog = JSON.parse(bytes);
const report = {
  purpose: 'Bounded integration checks, not score or win-rate calibration',
  catalogSha256: createHash('sha256').update(bytes).digest('hex'),
  players: catalog.players.length,
  policy:
    'Human drafts highest natural overall from locked league and club draws; AI selects a tier-eligible complete club or 84+ all-stars. Identical execution formulas. Human edits tactics at half-time.',
  matches: [],
};
for (const [index, level] of ['easy', 'medium', 'hard', 'impossible'].entries())
  for (const duration of [180, 300]) {
    const seed = 12648517 + index * 977 + duration;
    let state = seed;
    const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
    const ai = createAIOpponent(catalog, level, random),
      draft = new Draft(catalog, { seed, formations: ['433', ai.formation], opponent: ai.players });
    while (!draft.complete) {
      draft.spinLeague();
      draft.spinTeam();
      const p = draft
        .available()
        .sort(
          (a, b) =>
            overallRating(b, false, b.primaryPosition) - overallRating(a, false, a.primaryPosition),
        )[0];
      assert.ok(draft.pick(draft.bestSlot(p), p.profileId));
    }
    const match = new Match(seed, duration),
      config = match.exportConfig();
    config.competition = { mode: 'ai', difficulty: level };
    config.players = draft.picks.flat();
    config.teams[1].tactics.formation = ai.formation;
    match.importConfig(config);
    match.pauseAtHalf = true;
    coachAI(match, true);
    const identity = match.players.map(p => match.playerProfile(p));
    let steps = 0,
      halves = 0;
    while (!match.finished && steps++ < 30000) {
      if (match.mode === 'halftime') {
        halves++;
        match.setTactic(0, 'tempo', 4);
        match.resumeHalf();
      }
      match.step(1 / 60);
      assert.ok(
        Number.isFinite(match.ball.x) &&
          Number.isFinite(match.ball.y) &&
          Number.isFinite(match.ball.z),
      );
      for (const p of match.players)
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && p.energy >= 0 && p.energy <= 1);
    }
    assert.ok(match.finished);
    assert.equal(halves, 1);
    assert.deepEqual(
      match.players.map(p => match.playerProfile(p)),
      identity,
    );
    for (const stats of match.stats) {
      assert.ok(stats.onTarget <= stats.shots);
      assert.ok(stats.completed <= stats.passes);
    }
    report.matches.push({
      level,
      duration,
      seed,
      opponent: ai.name,
      tier: ai.tier,
      formation: ai.formation,
      score: match.score,
      shots: match.stats.map(s => s.shots),
      onTarget: match.stats.map(s => s.onTarget),
      passes: match.stats.map(s => [s.completed, s.passes]),
      finished: match.finished,
    });
    console.log(level, duration, ai.name, match.score.join('–'), 'passed');
  }
await writeFile(
  process.argv[2] || new URL('./league-integration-results.json', import.meta.url),
  JSON.stringify(report, null, 2) + '\n',
);
