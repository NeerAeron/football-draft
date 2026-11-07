// Paired close-rating fixtures reuse roles, identities and hidden tendencies.
// Runtime badge minima still apply equally under both engine versions.
// CALIBRATION_ENGINE=file:///.../engine.js CALIBRATION_PART=0 CALIBRATION_PARTS=4
// node tools/calibration/quality-balance-calibration.mjs /tmp/balance.json
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { overallRating } from '../../app/core/players/ratings.js';
import { loadRuntimeCatalog } from '../../scripts/data/catalog-file.mjs';
const { Match } = await import(
  process.env.CALIBRATION_ENGINE || new URL('../../app/core/sim/engine.js', import.meta.url)
);
const original = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/quality-gap-squads.json', import.meta.url)),
);
const catalog = loadRuntimeCatalog().players;
const byId = new Map(catalog.map(p => [p.profileId, p]));
const base = original.find(f => f.pair === 1 && f.duration === 180),
  baseTeam = base.weakTeam;
const baseProfiles = base.profiles.slice(baseTeam * 11, baseTeam * 11 + 11).map(id => byId.get(id));
assert.ok(baseProfiles.every(Boolean));
let cases = [];
for (const [band, offset] of [
  ['75-v-78', -1],
  ['82-v-85', 6],
]) {
  for (const seed of [16401, 16513])
    for (const duration of [180, 300])
      for (const strongTeam of [0, 1])
        cases.push({
          id: `${band}-${seed}-${duration}-${strongTeam}`,
          group: band,
          offset,
          boost: 3,
          seed,
          duration,
          strongTeam,
        });
  for (const duration of [180, 300])
    cases.push({
      id: `equal-${band}-${duration}`,
      group: 'equal-' + band,
      offset,
      boost: 0,
      seed: 16609,
      duration,
      strongTeam: null,
    });
}
for (const index of [0, 3, 4, 7, 8, 11, 12, 15]) cases.push({ ...original[index], real: true });
if (process.env.CALIBRATION_VALIDATION === '1')
  cases = ['75-v-78', '82-v-85'].flatMap((band, b) =>
    [16673, 16741, 16811, 16903].flatMap((seed, i) =>
      [180, 300].map(duration => ({
        id: `validation-${band}-${seed}-${duration}`,
        group: band,
        offset: b ? 6 : -1,
        boost: 3,
        seed,
        duration,
        strongTeam: i % 2,
      })),
    ),
  );
const part = Number(process.env.CALIBRATION_PART || 0),
  parts = Number(process.env.CALIBRATION_PARTS || 1),
  rows = [];
for (const [index, c] of cases.entries()) {
  if (index % parts !== part || (process.env.CALIBRATION_CLOSE_ONLY === '1' && c.real)) continue;
  const m = new Match(c.seed, c.duration);
  const profiles = c.real
    ? c.profiles.map(id => byId.get(id))
    : [0, 1].flatMap(team =>
        baseProfiles.map(profile => {
          const p = structuredClone(profile),
            delta = c.offset + (team === c.strongTeam ? c.boost : 0);
          p.tags = [];
          for (const key of Object.keys(p.attrs))
            if (p.primaryPosition === 'GK' ? key === 'goalkeeping' : key !== 'goalkeeping')
              p.attrs[key] = Math.max(1, Math.min(99, p.attrs[key] + delta));
          return p;
        }),
      );
  const teams = c.real
    ? c.configTeams
    : [0, 1].map(team => ({
        ...structuredClone(base.configTeams[baseTeam]),
        name: team === c.strongTeam ? 'Small advantage' : 'Reference',
        tactics: {
          ...base.configTeams[baseTeam].tactics,
          style: 'balanced',
          tempo: 3,
          width: 3,
          press: 3,
          fluidity: 3,
        },
      }));
  m.importConfig({ teams, players: profiles });
  const lineup = m.teams.map((t, team) => ({
    name: t.name,
    meanOverall:
      m.players.filter(p => p.team === team).reduce((n, p) => n + overallRating(p, false), 0) / 11,
  }));
  let frames = 0;
  while (!m.finished && frames++ < 40000) m.step(1 / 60);
  assert.ok(m.finished, c.id);
  const possession = m.stats.reduce((n, t) => n + t.possession, 0);
  const row = {
    id: c.id,
    group: c.group,
    seed: c.seed,
    duration: c.duration,
    strongTeam: c.strongTeam,
    score: m.score,
    teams: m.stats.map((s, team) => ({
      team,
      ...lineup[team],
      goals: m.score[team],
      passes: s.passes,
      completed: s.completed,
      passAccuracy: (100 * s.completed) / s.passes,
      possessionSeconds: s.possession,
      possessionShare: (100 * s.possession) / possession,
      shots: s.shots,
      onTarget: s.onTarget,
      offTarget: s.offTarget,
      miscontrols: s.miscontrols,
      tackles: s.tackles,
      takeons: s.takeons,
      saves: s.saves,
      forwardPasses: s.forwardPasses,
      backwardPasses: s.backwardPasses,
      throughBalls: s.throughBalls,
      crosses: s.crosses,
    })),
  };
  rows.push(row);
  writeFileSync(process.argv[2], JSON.stringify(rows, null, 2) + '\n');
  console.log(JSON.stringify(row));
}
