// World Cup Run calibration: (1) engine results by rating gap, to fit the fast rating model
// (competition/model.js); (2) World Cup Runs per difficulty with a typical drafted XI, to set
// CUP_TUNING (competition/cup.js). Deterministic for the given seeds.
//
//   node tools/calibration/cup-calibration.mjs gaps --matches 600 --workers 2 --out /tmp/gaps.json
//   node tools/calibration/cup-calibration.mjs gaps --matches 192 --min 8 --max 20 --from 1000 --out /tmp/big.json
//   node tools/calibration/cup-calibration.mjs fit /tmp/gaps.json /tmp/big.json
//   node tools/calibration/cup-calibration.mjs runs --runs 2000            # fast model only
//   node tools/calibration/cup-calibration.mjs runs --runs 2000 --engine 24 --workers 2
//   node tools/calibration/cup-calibration.mjs runs --runs 1000 --only pro --tuning '[-12.5, …]'
//     (--tuning: try other CUP_TUNING offsets (nine: group ×3, R32, R16, QF, SF, final, play-off),
//     a JSON array for --only's difficulty or a JSON object by difficulty; fast-model runs only.
//     Legendary plays the real 48-nation field in a Nations draft (cup.js worldCupDraw), so
//     offsets do not move it: `--only legendary` measures the field as it is and prints the
//     ratings met per round, the numbers behind FIELD_TYPICAL.)
//
// gaps: team 0 is a typically drafted XI (nations mode, positional picks, the run's re-rolls),
// team 1 a ladder opponent at a uniform gap of −12…+12 effective points, coached by the AI at
// the level a difficulty uses (prematch-store COACH_LEVEL), in the game's 180 s match. The user
// side keeps default tactics (as an auto-simmed run does: mentality 'auto').
// runs: every difficulty; the user's matches use the fitted model, and with --engine N also
// N runs per difficulty played by the real engine. Reports the title rate, the share of every
// finishing place (group … fourth, third, runners-up, champions), the final opponents, the mean
// rating met per round and what projectRun says for the same XI.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const imp = path => import(ROOT + path);
const DIFFS = ['pro', 'worldclass', 'legendary'];
const MATCH_SECONDS = 180; // the game's one match length (core/sim/constants.js)
const FORMATION_CYCLE = ['433', '4231', '442', '352', '343'];

async function setup() {
  const { loadRuntimeCatalog } = await imp('scripts/data/catalog-file.mjs');
  const session = await imp('app/core/draft/session.js');
  const opponents = await imp('app/core/draft/opponents.js');
  const cup = await imp('app/core/competition/cup.js');
  const model = await imp('app/core/competition/model.js');
  const runStore = await imp('app/ui/lib/run-store.js');
  const prematch = await imp('app/ui/lib/prematch-store.js');
  const matchStore = await imp('app/ui/lib/match-store.js');
  // Same as screens/run/run.js fixtureConfig: the user's side, the opponent coached by the AI
  // at the difficulty's level, knockout draws to penalties.
  const fixtureConfig = (m, difficulty) =>
    matchStore.buildMatchConfig({
      sides: [runStore.matchSideFor(m.home, { kind: 'user' }), runStore.matchSideFor(m.away)],
      competition: prematch.engineCompetition({
        sides: [{ kind: 'user' }, { kind: 'ai' }],
        competition: { mode: 'ai', difficulty, knockout: m.knockout },
      }),
    });
  const { CONFIG } = await imp('app/core/config/config.js');
  const { lcg } = await imp('app/core/util/rng.js');
  return {
    catalog: loadRuntimeCatalog(),
    ...session,
    ...opponents,
    ...cup,
    ...model,
    fixtureConfig,
    COACH_LEVEL: prematch.COACH_LEVEL,
    CONFIG,
    lcg,
  };
}

// A typical draft: the session's suggested (positional) pick, a smart re-roll below 78.
function draftXI(env, seed, difficulty) {
  const s = env.createDraftSession(env.catalog, {
    mode: 'nations',
    seed,
    rerolls: env.CONFIG.draft.rerolls[difficulty],
    formation: FORMATION_CYCLE[seed % FORMATION_CYCLE.length],
  });
  while (!s.complete) {
    s.spin();
    if (s.rerollsLeft[0] > 0 && s.suggestPick().rating < 78) s.reroll();
    const move = s.suggestPick(),
      r = s.pick(move.profileId, move.slot);
    if (!r.ok) throw Error(r.reason);
  }
  return s.matchSide(0);
}

function playEngine(env, Match, config, seed, duration) {
  const m = new Match(seed >>> 0, duration);
  m.importConfig(config);
  while (!m.finished) m.step(1 / 60);
  return { score: [...m.score], winner: m.winner() };
}

// ---------- gaps ----------
function gapSpecs(count, { min = -12, max = 12, from = 0 } = {}) {
  const specs = [];
  for (let k = 0; k < count; k++) {
    const i = from + k;
    specs.push({
      id: i,
      seed: 41000 + i * 7,
      difficulty: DIFFS[i % DIFFS.length],
      gap: min + ((i * 7919) % 97) * ((max - min) / 96),
      duration: MATCH_SECONDS,
    });
  }
  return specs;
}
function runGap(env, Match, spec) {
  const user = draftXI(env, spec.seed, spec.difficulty),
    base = env.ladderTarget('nations', spec.difficulty);
  const random = env.lcg(spec.seed ^ 0x51ed),
    opponent = env.pickOpponent(env.catalog, {
      mode: 'nations',
      level: spec.difficulty,
      offset: user.effective - spec.gap - base,
      excludePlayers: user.players.map(p => p.profileId),
      random,
    });
  const config = env.fixtureConfig(
    { home: user, away: opponent, knockout: false },
    spec.difficulty,
  );
  const r = playEngine(env, Match, config, spec.seed, spec.duration);
  return {
    ...spec,
    ratings: [user.effective, opponent.effective],
    names: [user.name, opponent.name],
    score: r.score,
  };
}

// Poisson MLE for lambda0 = g·e^{s·d + h}, lambda1 = g·e^{−s·d − h} (d = r0 − r1).
function fitModel(rows, { home = true } = {}) {
  const data = rows.map(r => ({ d: r.ratings[0] - r.ratings[1], a: r.score[0], b: r.score[1] }));
  let best = null;
  for (let g = 0.8; g <= 2.4; g += 0.02)
    for (let s = 0.02; s <= 0.2; s += 0.0025)
      for (let h = home ? -0.4 : 0; h <= (home ? 0.4 : 0) + 1e-9; h += 0.02) {
        let ll = 0;
        for (const { d, a, b } of data) {
          const la = g * Math.exp(s * d + h),
            lb = g * Math.exp(-s * d - h);
          ll += a * Math.log(la) - la + b * Math.log(lb) - lb;
        }
        if (!best || ll > best.ll) best = { goals: g, slope: s, home: h, ll };
      }
  return best;
}
function fitReport(env, rows) {
  const fit = fitModel(rows),
    flat = fitModel(rows, { home: false });
  console.log(`${rows.length} engine matches`);
  console.log(
    `fit: goals ${flat.goals.toFixed(2)} slope ${flat.slope.toFixed(4)} (with home constant: goals ${fit.goals.toFixed(2)} slope ${fit.slope.toFixed(4)} home ${fit.home.toFixed(2)})`,
  );
  const model = { ...env.MATCH_MODEL, goals: flat.goals, slope: flat.slope };
  const bins = [-13, -8, -4, -1.5, 1.5, 4, 8, 13, 17, 25];
  console.log('gap bin        n   engine W/D/L        model W/D/L (current)   model W/D/L (fit)');
  for (let i = 0; i < bins.length - 1; i++) {
    const rs = rows.filter(r => {
      const d = r.ratings[0] - r.ratings[1];
      return d >= bins[i] && d < bins[i + 1];
    });
    if (!rs.length) continue;
    const w = rs.filter(r => r.score[0] > r.score[1]).length / rs.length,
      dr = rs.filter(r => r.score[0] === r.score[1]).length / rs.length;
    const avg = (f, m) => {
      const ps = rs.map(r => env.outcomeProbabilities(r.ratings[0], r.ratings[1], m));
      return ['win', 'draw', 'loss'].map(k => ps.reduce((t, p) => t + p[k], 0) / ps.length);
    };
    const pct = x => (x * 100).toFixed(0).padStart(3);
    const cur = avg(null, env.MATCH_MODEL),
      fitted = avg(null, model);
    console.log(
      `[${bins[i]}, ${bins[i + 1]})`.padEnd(12),
      String(rs.length).padStart(4),
      `  ${pct(w)} ${pct(dr)} ${pct(1 - w - dr)}`,
      `          ${cur.map(pct).join(' ')}`,
      `            ${fitted.map(pct).join(' ')}`,
    );
  }
  const goals = rows.reduce((t, r) => t + r.score[0] + r.score[1], 0) / rows.length;
  const draws = rows.filter(r => r.score[0] === r.score[1]).length / rows.length;
  const modelDraws =
    rows.reduce((t, r) => t + env.outcomeProbabilities(r.ratings[0], r.ratings[1], model).draw, 0) /
    rows.length;
  console.log(
    `goals ${goals.toFixed(2)} · draws engine ${(draws * 100).toFixed(1)}% vs fitted Poisson ${(modelDraws * 100).toFixed(1)}%`,
  );
  // The AI coach's level per difficulty: the user's edge with the global goals and slope.
  for (const d of DIFFS) {
    const rs = rows.filter(r => r.difficulty === d);
    let best = null;
    for (let h = -0.5; h <= 0.5 + 1e-9; h += 0.01) {
      let ll = 0;
      for (const r of rs) {
        const x = flat.slope * (r.ratings[0] - r.ratings[1]) + h,
          la = flat.goals * Math.exp(x),
          lb = flat.goals * Math.exp(-x);
        ll += r.score[0] * Math.log(la) - la + r.score[1] * Math.log(lb) - lb;
      }
      if (!best || ll > best.ll) best = { h, ll };
    }
    const w = rs.filter(r => r.score[0] > r.score[1]).length / rs.length;
    console.log(
      `  coach ${env.COACH_LEVEL[d].padEnd(10)} n=${rs.length} user wins ${(w * 100).toFixed(0)}% · edge to the user ${best.h.toFixed(2)} (≈ ${(best.h / flat.slope).toFixed(1)} rating pts)`,
    );
  }
  return { fit, flat };
}

// ---------- runs ----------
function runCup(env, Match, { seed, difficulty, engine, model }) {
  const user = draftXI(env, seed, difficulty);
  const run = env.createCupRun(env.catalog, { mode: 'nations', difficulty, seed, user });
  let matches = 0;
  const games = [];
  while (!run.complete) {
    const m = run.nextMatch();
    if (engine) {
      const config = env.fixtureConfig(m, difficulty);
      const r = playEngine(env, Match, config, m.seed, MATCH_SECONDS);
      const draw = r.score[0] === r.score[1];
      games.push({
        knockout: m.knockout,
        ratings: [m.home.effective, m.away.effective],
        score: r.score,
        won: r.score[0] > r.score[1] || (m.knockout && draw && r.winner === 0),
      });
      run.recordResult({
        goalsFor: r.score[0],
        goalsAgainst: r.score[1],
        shootout: m.knockout && draw ? { winner: r.winner === 0 ? 'user' : 'opponent' } : null,
      });
    } else {
      // As CupRun.simulateNext: the user's knockout ties carry KNOCKOUT_EDGE.
      const random = env.lcg(m.seed),
        edge = m.knockout ? env.KNOCKOUT_EDGE : 0,
        res = env.simulateResult(m.home.effective + edge, m.away.effective, random, {
          knockout: m.knockout,
          model,
        });
      run.recordResult({
        goalsFor: res.goals[0],
        goalsAgainst: res.goals[1],
        shootout: res.shootout && { winner: res.shootout.winner ? 'opponent' : 'user' },
      });
    }
    matches++;
  }
  const snap = run.snapshot(),
    finalist = run.opponents[7];
  return {
    seed,
    difficulty,
    engine: !!engine,
    rating: user.effective,
    stage: snap.place,
    final: finalist.name,
    finalRating: finalist.effective,
    // Effective rating of the opponent of every round (group ×3 … final, play-off).
    met: run.opponents.map(o => o.effective),
    matches,
    games,
  };
}
// Engine user matches against the fitted model's prediction for the same ratings.
function gamesReport(env, rows) {
  const games = rows.filter(r => r.engine).flatMap(r => r.games || []);
  if (!games.length) return;
  console.log('\nengine user matches vs the fitted model (same ratings)');
  for (const knockout of [false, true]) {
    const g = games.filter(x => x.knockout === knockout);
    if (!g.length) continue;
    let w = 0,
      d = 0,
      ew = 0,
      ed = 0,
      adv = 0,
      eadv = 0;
    for (const x of g) {
      const p = env.outcomeProbabilities(x.ratings[0], x.ratings[1]);
      if (x.score[0] > x.score[1]) w++;
      // (model columns: no knockout edge — the comparison that sets KNOCKOUT_EDGE)
      else if (x.score[0] === x.score[1]) d++;
      ew += p.win;
      ed += p.draw;
      if (x.won) adv++;
      const k = Math.max(-10, Math.min(10, x.ratings[0] - x.ratings[1])) * 0.004;
      eadv += p.win + p.draw * (0.5 + k);
    }
    const pct = x => ((x / g.length) * 100).toFixed(1) + '%';
    console.log(
      `  ${knockout ? 'knockout' : 'group   '} n=${g.length}: wins ${pct(w)} (model ${pct(ew)}), draws ${pct(d)} (model ${pct(ed)})` +
        (knockout ? `, through ${pct(adv)} (model ${pct(eadv)})` : ''),
    );
  }
}
function runsReport(env, rows) {
  gamesReport(env, rows);
  const stages = env.PLACES;
  for (const engine of [false, true]) {
    const rs = rows.filter(r => r.engine === engine);
    if (!rs.length) continue;
    console.log(engine ? '\nreal engine (user matches)' : '\nfitted model (user matches)');
    console.log('difficulty     n   XI    champion  group out  ' + stages.join(' / '));
    for (const d of DIFFS) {
      const x = rs.filter(r => r.difficulty === d);
      if (!x.length) continue;
      const share = s => x.filter(r => r.stage === s).length / x.length;
      const proj = env.projectRun({
        rating: x.reduce((t, r) => t + r.rating, 0) / x.length,
        mode: 'nations',
        difficulty: d,
      });
      console.log(
        d.padEnd(12),
        String(x.length).padStart(5),
        (x.reduce((t, r) => t + r.rating, 0) / x.length).toFixed(1).padStart(5),
        `${(share('champion') * 100).toFixed(1).padStart(8)}%`,
        `${(share('group') * 100).toFixed(1).padStart(8)}%  `,
        stages.map(s => (share(s) * 100).toFixed(0)).join(' / '),
        engine
          ? ''
          : `   projectRun: champion ${(proj.probabilities.champion * 100).toFixed(0)}% group ${(proj.probabilities.group * 100).toFixed(0)}% → ${proj.label}`,
      );
      if (!engine) {
        const finals = {};
        for (const r of x) finals[r.final] = (finals[r.final] || 0) + 1;
        console.log(
          '    finals:',
          Object.entries(finals)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([n, c]) => `${n} ${((c / x.length) * 100).toFixed(0)}%`)
            .join(', '),
          `(mean rating ${(x.reduce((t, r) => t + r.finalRating, 0) / x.length).toFixed(1)})`,
        );
        if (x[0].met)
          console.log(
            '    met (MD1 MD2 MD3 R32 R16 QF SF F 3rd):',
            x[0].met
              .map((_, i) => (x.reduce((t, r) => t + r.met[i], 0) / x.length).toFixed(1))
              .join(' '),
          );
      }
    }
  }
}

// ---------- driver ----------
async function parallel(kind, specs, workers, extra = {}) {
  const results = [];
  await Promise.all(
    Array.from({ length: workers }, (_, w) => {
      // Interleave in pairs so every worker gets both match lengths.
      const mine = specs.filter((_, i) => Math.floor(i / 2) % workers === w);
      return new Promise((resolve, reject) => {
        const worker = new Worker(fileURLToPath(import.meta.url), {
          workerData: { kind, specs: mine, extra },
        });
        worker.on('message', r => {
          results.push(r);
          process.stderr.write(`\r${results.length}/${specs.length}`);
        });
        worker.on('error', reject);
        worker.on('exit', resolve);
      });
    }),
  );
  process.stderr.write('\n');
  return results.sort((a, b) => (a.id ?? a.seed) - (b.id ?? b.seed));
}

async function main() {
  const args = process.argv.slice(2),
    flag = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
  const env = await setup(),
    workers = Number(flag('--workers', 2)),
    out = flag('--out', null);
  if (args[0] === 'gaps') {
    const specs = gapSpecs(Number(flag('--matches', 600)), {
        min: Number(flag('--min', -12)),
        max: Number(flag('--max', 12)),
        from: Number(flag('--from', 0)),
      }),
      rows = await parallel('gap', specs, workers);
    if (out) writeFileSync(out, JSON.stringify(rows));
    fitReport(env, rows);
  } else if (args[0] === 'fit') {
    const files = args.slice(1).filter(a => !a.startsWith('--'));
    fitReport(
      env,
      files.flatMap(f => JSON.parse(readFileSync(f, 'utf8'))),
    );
  } else if (args[0] === 'runs') {
    const n = Number(flag('--runs', 2000)),
      engine = Number(flag('--engine', 0)),
      rows = [];
    const { Match } = await imp('app/core/sim/engine.js');
    const only = flag('--only', null),
      tuning = flag('--tuning', null);
    if (tuning) {
      const parsed = JSON.parse(tuning);
      // Mutate in place: createCupRun and projectRun read the module's CUP_TUNING.
      for (const [d, offsets] of Object.entries(
        Array.isArray(parsed) ? { [only]: parsed } : parsed,
      ))
        env.CUP_TUNING[d].splice(0, Infinity, ...offsets);
    }
    for (const difficulty of only ? [only] : DIFFS)
      for (let i = 0; i < n; i++)
        rows.push(runCup(env, Match, { seed: 90000 + i * 31, difficulty, engine: false }));
    if (engine) {
      const specs = (only ? [only] : DIFFS).flatMap(difficulty =>
        Array.from({ length: engine }, (_, i) => ({
          seed: 70000 + (Number(flag('--from', 0)) + i) * 37,
          difficulty,
        })),
      );
      rows.push(...(await parallel('cup', specs, workers)));
    }
    if (out) writeFileSync(out, JSON.stringify(rows));
    runsReport(env, rows);
  } else if (args[0] === 'report') runsReport(env, JSON.parse(readFileSync(args[1], 'utf8')));
  else console.log('usage: cup-calibration.mjs gaps | fit <file> | runs | report <file>');
}

if (!isMainThread) {
  const env = await setup(),
    { Match } = await imp('app/core/sim/engine.js'),
    { kind, specs } = workerData;
  for (const spec of specs)
    parentPort.postMessage(
      kind === 'gap' ? runGap(env, Match, spec) : runCup(env, Match, { ...spec, engine: true }),
    );
  parentPort.close();
} else await main();
