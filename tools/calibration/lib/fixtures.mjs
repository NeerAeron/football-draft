// Deterministic club fixtures for the calibration tools (blunders.mjs, watch.mjs).
//
//   const { fixtures, buildMatch } = await loadFixtures(engineDir?);
//   const spec = fixtures(24)[3];           // { id, seed, duration, home, away, ai }
//   const m = buildMatch(spec);             // a Match ready to step
//
// Real club XIs from the runtime catalog (their best formation), paired within a few rating
// points so both sides get to play, in the game's 180 s match; team 1 is AI-coached. The same id always gives the same
// match, on any engine checkout (`engineDir` = another checkout's app/ folder).
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function merge(target, patch) {
  for (const [k, v] of Object.entries(patch))
    if (v && typeof v === 'object' && !Array.isArray(v)) merge((target[k] ??= {}), v);
    else target[k] = v;
  return target;
}
function lcg(seed) {
  let s = (seed ^ 0x5bd1e995) >>> 0;
  return () => ((s = (Math.imul(1664525, s) + 1013904223) >>> 0), s / 4294967296);
}

export async function loadFixtures(engineDir = ROOT + 'app') {
  const { loadRuntimeCatalog } = await import(ROOT + 'scripts/data/catalog-file.mjs');
  const { overallRating } = await import(ROOT + 'app/core/players/ratings.js');
  const { FORMATIONS } = await import(ROOT + 'app/core/players/formations.js');
  const { Match } = await import(engineDir.replace(/\/$/, '') + '/core/sim/engine.js');
  const catalog = loadRuntimeCatalog();
  const clubs = catalog.teams
    .filter(t => t.bestFormation && t.lineups?.[t.bestFormation]?.length === 11)
    .map(t => {
      const players = t.lineups[t.bestFormation];
      const ovr =
        players.reduce(
          (s, p, i) => s + overallRating(p, false, FORMATIONS[t.bestFormation][i][2]),
          0,
        ) / 11;
      return { name: t.name, formation: t.bestFormation, players, ovr };
    })
    .sort((a, b) => a.ovr - b.ovr);

  /** `count` fixtures; ids are stable (fixture 7 is the same match whatever the count). */
  const fixtures = count =>
    Array.from({ length: count }, (_, id) => {
      const random = lcg(977 + id * 7919),
        home = clubs[Math.floor(random() * clubs.length)],
        near = clubs.filter(
          c =>
            c !== home &&
            Math.abs(c.ovr - home.ovr) < 6 &&
            !c.players.some(p => home.players.some(q => q.profileId === p.profileId)),
        ),
        away = near[Math.floor(random() * near.length)];
      return {
        id,
        seed: 4200 + id * 17,
        duration: 180,
        ai: ['medium', 'hard', 'hard', 'impossible'][id % 4],
        home,
        away,
      };
    });

  /** `tuning`: optional patch merged over the engine's tuning (e.g. { gameplay: { … } }). */
  const buildMatch = (spec, tuning = null) => {
    const m = new Match(spec.seed, spec.duration),
      config = m.exportConfig();
    if (tuning) merge(config.tuning, tuning);
    config.players = [...spec.home.players, ...spec.away.players].map(p => structuredClone(p));
    config.teams[0].name = spec.home.name;
    config.teams[1].name = spec.away.name;
    config.teams[0].tactics.formation = spec.home.formation;
    config.teams[1].tactics.formation = spec.away.formation;
    config.competition = { mode: 'ai', difficulty: spec.ai };
    m.importConfig(config);
    return m;
  };
  return { fixtures, buildMatch, Match };
}
