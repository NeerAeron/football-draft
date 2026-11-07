// Match-engine calibration: a broad, deterministic batch of full matches and a
// summary against the gameplay soft targets (docs/calibration.md).
//
//   node tools/calibration/match-calibration.mjs --out /tmp/after.json
//   node tools/calibration/match-calibration.mjs --engine /tmp/before/app --out /tmp/before.json
//   node tools/calibration/match-calibration.mjs --compare /tmp/before.json /tmp/after.json
//   node tools/calibration/match-calibration.mjs --summary /tmp/after.json
//
// Options: --matches N (default 128), --workers N (default 3), --engine <app dir> (another
// checkout's app/ folder, e.g. from `git archive <commit> app | tar -x -C /tmp/before`, for
// paired before/after runs on identical specs), --tuning <json file> (patch over the tuning).
// Specs: club XIs from the runtime catalog across all tiers (close, moderate and big OVR gaps,
// low-rated pairs), an all-star XI against weak and elite clubs, and the default squads; 180 s
// and 300 s alternate; team 1 is AI-coached in most matches. Emergent statistics only.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

async function main() {
  const args = process.argv.slice(2),
    flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  if (args.includes('--compare')) {
    const [a, b] = args.slice(args.indexOf('--compare') + 1);
    return compare(load(a), load(b), a, b);
  }
  if (args.includes('--summary')) return printSummary(load(flag('--summary')));
  const count = Number(flag('--matches') || 128),
    workers = Number(flag('--workers') || 3),
    engine = flag('--engine') || ROOT + 'app',
    tuning = flag('--tuning') ? JSON.parse(readFileSync(flag('--tuning'), 'utf8')) : null;
  const specs = await buildSpecs(count);
  const started = performance.now(),
    results = [];
  await Promise.all(
    Array.from({ length: workers }, (_, w) => {
      const mine = specs.filter((_, i) => i % workers === w);
      return new Promise((resolve, reject) => {
        const worker = new Worker(fileURLToPath(import.meta.url), {
          workerData: { engine, tuning, specs: mine },
        });
        worker.on('message', r => {
          results.push(r);
          process.stderr.write(
            `\r${results.length}/${specs.length} ${((performance.now() - started) / 1000).toFixed(0)}s`,
          );
        });
        worker.on('error', reject);
        worker.on('exit', resolve);
      });
    }),
  );
  process.stderr.write('\n');
  results.sort((a, b) => a.id - b.id);
  const report = { engine, tuning, wallSeconds: (performance.now() - started) / 1000, results };
  const out = flag('--out');
  if (out) writeFileSync(out, JSON.stringify(report));
  printSummary(report);
}

function load(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

// ---------- specs ----------

function lcg(seed) {
  let s = (seed ^ 0x5bd1e995) >>> 0;
  return () => ((s = (Math.imul(1664525, s) + 1013904223) >>> 0), s / 4294967296);
}

async function buildSpecs(count) {
  const { loadRuntimeCatalog } = await import(ROOT + 'scripts/data/catalog-file.mjs');
  const { overallRating } = await import(ROOT + 'app/core/players/ratings.js');
  const { FORMATIONS } = await import(ROOT + 'app/core/players/formations.js');
  const catalog = loadRuntimeCatalog();
  const xiOvr = (players, formation) =>
    players.reduce((s, p, i) => s + overallRating(p, false, FORMATIONS[formation][i][2]), 0) / 11;
  const clubs = catalog.teams
    .filter(t => t.bestFormation && t.lineups?.[t.bestFormation]?.length === 11)
    .map(t => {
      const players = t.lineups[t.bestFormation];
      return {
        kind: 'club',
        name: t.name,
        formation: t.bestFormation,
        players,
        ovr: xiOvr(players, t.bestFormation),
      };
    })
    .sort((a, b) => a.ovr - b.ovr);
  // All-star XI: the best available player for every role of a 4-3-3.
  const used = new Set(),
    star = FORMATIONS['433'].map(([, , role]) => {
      const best = catalog.players
        .filter(p => !used.has(p.profileId))
        .map(p => ({ p, o: overallRating(p, false, role) }))
        .sort((a, b) => b.o - a.o)[0].p;
      used.add(best.profileId);
      return best;
    });
  const allStar = {
    kind: 'allstar',
    name: 'All-Stars',
    formation: '433',
    players: star,
    ovr: xiOvr(star, '433'),
  };
  const random = lcg(20261107),
    pick = list => list[Math.floor(random() * list.length)];
  const pairWithin = (lo, hi, minGap, maxGap) => {
    for (let tries = 0; tries < 500; tries++) {
      const a = pick(clubs.filter(c => c.ovr >= lo && c.ovr < hi)),
        b = pick(
          clubs.filter(c => Math.abs(c.ovr - a.ovr) >= minGap && Math.abs(c.ovr - a.ovr) < maxGap),
        );
      if (
        a &&
        b &&
        a !== b &&
        !a.players.some(p => b.players.some(q => q.profileId === p.profileId))
      )
        return random() < 0.5 ? [a, b] : [b, a];
    }
    throw Error('no pair');
  };
  const plan = [
    ['close', 0.32, () => pairWithin(66, 87, 0, 3)],
    ['moderate', 0.22, () => pairWithin(66, 87, 3, 9)],
    ['big gap', 0.14, () => pairWithin(62, 76, 10, 30)],
    ['low-rated', 0.14, () => pairWithin(60, 70, 0, 4)],
    [
      'all-star',
      0.12,
      () => {
        const club = pick(random() < 0.6 ? clubs.slice(0, 120) : clubs.slice(-20));
        return random() < 0.5 ? [allStar, club] : [club, allStar];
      },
    ],
    [
      'default',
      0.06,
      () => [
        { kind: 'default', name: 'Default' },
        { kind: 'default', name: 'Default' },
      ],
    ],
  ];
  const specs = [];
  for (const [category, share, make] of plan) {
    const n = Math.max(1, Math.round(count * share));
    for (let i = 0; i < n; i++) {
      const [home, away] = make(),
        id = specs.length,
        ai = category === 'default' ? null : ['medium', 'hard', 'hard', 'impossible'][id % 4];
      specs.push({
        id,
        category,
        seed: 7000 + id * 13,
        duration: id % 2 ? 300 : 180,
        ai,
        home: slim(home),
        away: slim(away),
      });
    }
  }
  return specs;
}
const slim = t => ({
  kind: t.kind,
  name: t.name,
  formation: t.formation,
  players: t.players,
  ovr: t.ovr,
});

// ---------- one match ----------

function merge(target, patch) {
  for (const [k, v] of Object.entries(patch))
    if (v && typeof v === 'object' && !Array.isArray(v)) merge((target[k] ??= {}), v);
    else target[k] = v;
  return target;
}

const ATTACK = new Set(['ST', 'LW', 'RW', 'AM', 'LM', 'RM', 'CF']);

function runMatch(Match, spec, tuning) {
  const m = new Match(spec.seed, spec.duration),
    config = m.exportConfig();
  if (tuning) merge(config.tuning, tuning);
  if (spec.home.kind !== 'default') {
    config.players = [...spec.home.players, ...spec.away.players].map(p => structuredClone(p));
    config.teams[0].name = spec.home.name;
    config.teams[1].name = spec.away.name;
    config.teams[0].tactics.formation = spec.home.formation;
    config.teams[1].tactics.formation = spec.away.formation;
  }
  if (spec.ai) config.competition = { mode: 'ai', difficulty: spec.ai };
  m.importConfig(config);
  const corners = [0, 0],
    halfShots = [0, 0],
    t0 = performance.now();
  let steps = 0,
    lastRestart = null;
  while (!m.finished && steps < 60 * 60 * 20) {
    m.step(1 / 60);
    steps++;
    if (m.mode === 'restart' && m.restart !== lastRestart) {
      lastRestart = m.restart;
      if (m.restart.type === 'Corner') corners[m.restart.team]++;
    }
  }
  const ms = performance.now() - t0;
  const events = [...m.events].reverse(),
    shots = events.filter(e => e.type === 'shot');
  for (const s of shots) halfShots[s.half > 1 ? 1 : 0]++;
  let drought = 0,
    prev = 0;
  for (const t of [...shots.map(s => s.elapsed), m.elapsed]) {
    drought = Math.max(drought, t - prev);
    prev = t;
  }
  // Top-3 rated attackers per side (by source overall), and their shot/goal share.
  const ovr = p => p.sourceOverall ?? 70;
  const stars = [0, 1].map(t =>
    m.players
      .filter(p => p.team === t && ATTACK.has(p.role))
      .sort((a, b) => ovr(b) - ovr(a))
      .slice(0, 3)
      .map(p => p.id),
  );
  const elite = m.players.filter(p => ATTACK.has(p.role) && ovr(p) >= 85).map(p => p.id);
  const count = type => events.filter(e => e.type === type).length;
  return {
    id: spec.id,
    category: spec.category,
    duration: spec.duration,
    ai: spec.ai,
    names: [spec.home.name, spec.away.name],
    ovr: [spec.home.ovr ?? 0, spec.away.ovr ?? 0],
    score: [...m.score],
    halftime: m.halftime?.score ?? null,
    stats: m.stats.map(s => ({ ...s })),
    corners,
    halfShots,
    halfGoals: [0, 1].map(h => m.goalHistory.filter(g => (g.half > 1 ? 1 : 0) === h).length),
    shots: shots.map(s => ({
      team: s.team,
      xg: s.xg ?? null,
      outcome: s.outcome,
      type: s.shotType,
      situation: s.situation ?? null,
      big: !!s.bigChance,
      player: s.playerId,
    })),
    goals: m.goalHistory.map(g => ({
      team: g.team,
      time: g.time,
      type: g.shotType,
      situation: g.situation ?? null,
      player: g.playerId ?? null,
      own: !!g.ownGoal,
      xg: g.xg ?? null,
    })),
    saves: events
      .filter(e => e.type === 'save')
      .map(e => ({ type: e.saveType ?? null, difficulty: e.difficulty ?? null })),
    nearMisses: count('near-miss'),
    posts: count('post'),
    yellows: count('yellow'),
    reds: count('red'),
    stars: stars.map(ids => ({
      shots: shots.filter(s => ids.includes(s.playerId)).length,
      goals: m.goalHistory.filter(g => ids.includes(g.playerId)).length,
    })),
    elite: {
      players: elite.length,
      shots: shots.filter(s => elite.includes(s.playerId)).length,
      goals: m.goalHistory.filter(g => elite.includes(g.playerId)).length,
    },
    drought,
    elapsed: m.elapsed,
    energy: [0, 1].map(
      t =>
        m.players.filter(p => p.team === t && p.role !== 'GK').reduce((s, p) => s + p.energy, 0) /
        10,
    ),
    tactics: m.teams.map(t => ({ ...t.tactics })),
    ms,
    steps,
  };
}

// ---------- summary ----------

const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const sum = (r, k) => r.stats[0][k] + r.stats[1][k];
const pct = x => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '-');
const fx = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');

export function metrics(rows) {
  const goals = rows.map(r => r.score[0] + r.score[1]),
    allShots = rows.flatMap(r => r.shots),
    allGoals = rows.flatMap(r => r.goals),
    onTarget = allShots.filter(s => s.outcome === 'goal' || s.outcome === 'saved').length;
  const saved = allShots.filter(s => s.outcome === 'saved').length;
  const sd = Math.sqrt(mean(goals.map(g => (g - mean(goals)) ** 2)));
  const strong = rows.filter(r => r.category !== 'default' && Math.abs(r.ovr[0] - r.ovr[1]) >= 10);
  const close = rows.filter(r => r.category !== 'default' && Math.abs(r.ovr[0] - r.ovr[1]) < 3);
  const strongerWins = list =>
    list.filter(r => {
      const s = r.ovr[0] >= r.ovr[1] ? 0 : 1;
      return r.score[s] > r.score[1 - s];
    }).length / list.length;
  const saveTypes = {};
  for (const s of rows.flatMap(r => r.saves)) saveTypes[s.type] = (saveTypes[s.type] || 0) + 1;
  const situations = {};
  for (const g of allGoals) situations[g.situation] = (situations[g.situation] || 0) + 1;
  const low = rows.filter(r => r.category === 'low-rated');
  return {
    matches: rows.length,
    goals: mean(goals),
    goalsSd: sd,
    shots: mean(rows.map(r => sum(r, 'shots'))),
    onTarget: onTarget / allShots.length,
    keeperSave: saved / onTarget,
    conversion: allGoals.length / allShots.length,
    xg: mean(rows.map(r => sum(r, 'xg'))),
    corners: mean(rows.map(r => r.corners[0] + r.corners[1])),
    penalties: mean(rows.map(r => sum(r, 'penalties'))),
    headers: allGoals.filter(g => g.type === 'Header').length / allGoals.length,
    nilNil: rows.filter(r => r.score[0] + r.score[1] === 0).length / rows.length,
    draws: rows.filter(r => r.score[0] === r.score[1]).length / rows.length,
    strongWin: strong.length ? strongerWins(strong) : NaN,
    strongN: strong.length,
    closeWin: close.length ? strongerWins(close) : NaN,
    closeN: close.length,
    secondHalfShots:
      mean(rows.map(r => r.halfShots[1])) / Math.max(1e-9, mean(rows.map(r => r.halfShots[0]))),
    secondHalfGoals:
      mean(rows.map(r => r.halfGoals[1])) / Math.max(1e-9, mean(rows.map(r => r.halfGoals[0]))),
    starShotShare:
      rows.reduce((s, r) => s + r.stars[0].shots + r.stars[1].shots, 0) /
      Math.max(
        1,
        rows.reduce((s, r) => s + sum(r, 'shots'), 0),
      ),
    starGoalShare:
      rows.reduce((s, r) => s + r.stars[0].goals + r.stars[1].goals, 0) /
      Math.max(1, allGoals.filter(g => !g.own).length),
    eliteShotsPer:
      rows.reduce((s, r) => s + r.elite.shots, 0) /
      Math.max(
        1,
        rows.reduce((s, r) => s + r.elite.players, 0),
      ),
    eliteGoalsPer:
      rows.reduce((s, r) => s + r.elite.goals, 0) /
      Math.max(
        1,
        rows.reduce((s, r) => s + r.elite.players, 0),
      ),
    droughtSeconds: mean(rows.map(r => r.drought)),
    droughtMinutes: mean(rows.map(r => (r.drought / r.duration) * 90)),
    droughtMaxMinutes: Math.max(...rows.map(r => (r.drought / r.duration) * 90)),
    lowGoals: low.length ? mean(low.map(r => r.score[0] + r.score[1])) : NaN,
    lowN: low.length,
    fouls: mean(rows.map(r => sum(r, 'fouls'))),
    yellows: mean(rows.map(r => r.yellows)),
    reds: mean(rows.map(r => r.reds)),
    passes: mean(rows.map(r => sum(r, 'passes'))),
    completion:
      rows.reduce((s, r) => s + sum(r, 'completed'), 0) /
      rows.reduce((s, r) => s + sum(r, 'passes'), 0),
    nearMisses: mean(rows.map(r => r.nearMisses)),
    posts: mean(rows.map(r => r.posts)),
    saveTypes,
    situations,
    msPerMatch: mean(rows.map(r => r.ms)),
    energy: mean(rows.flatMap(r => r.energy)),
  };
}

const TARGETS = [
  ['goals', 'goals / match', v => fx(v), v => v >= 2.8 && v <= 3.6, '2.8–3.6'],
  ['goalsSd', 'goals sd', v => fx(v), v => v >= 1.4, '≥ 1.4'],
  ['shots', 'shots / match', v => fx(v, 1), v => v >= 10 && v <= 15, '10–15'],
  ['onTarget', 'on target', pct, v => v >= 0.35 && v <= 0.45, '35–45%'],
  ['keeperSave', 'keeper save % (on target)', pct, v => v >= 0.55 && v <= 0.7, '55–70%'],
  ['conversion', 'goals / shot', pct, () => true, ''],
  ['xg', 'xG / match', v => fx(v), () => true, '≈ goals'],
  ['corners', 'corners / match', v => fx(v, 1), v => v >= 3 && v <= 7, '3–7'],
  ['penalties', 'penalties / match', v => fx(v), v => v >= 0.15 && v <= 0.3, '0.15–0.3'],
  ['headers', 'headed goals', pct, v => v >= 0.1, '≥ 10%'],
  ['nilNil', '0–0', pct, v => v <= 0.07, '≤ 7%'],
  ['draws', 'draws', pct, v => v >= 0.18 && v <= 0.25, '18–25%'],
  ['strongWin', 'stronger side wins (gap ≥ 10)', pct, v => v >= 0.75 && v <= 0.85, '75–85%'],
  ['closeWin', 'stronger side wins (gap < 3)', pct, v => v >= 0.3 && v <= 0.55, 'open'],
  ['secondHalfShots', '2nd / 1st half shots', v => fx(v), v => v >= 1, '≥ 1'],
  ['secondHalfGoals', '2nd / 1st half goals', v => fx(v), v => v >= 1, '≥ 1'],
  ['starShotShare', 'top-3 attackers: share of shots', pct, () => true, ''],
  ['starGoalShare', 'top-3 attackers: share of goals', pct, () => true, ''],
  ['eliteShotsPer', '85+ attacker: shots / match', v => fx(v), () => true, ''],
  ['eliteGoalsPer', '85+ attacker: goals / match', v => fx(v), () => true, ''],
  ['droughtMinutes', 'longest shot drought (mean, match min)', v => fx(v, 1), () => true, ''],
  ['droughtMaxMinutes', 'longest shot drought (worst, match min)', v => fx(v, 1), () => true, ''],
  ['lowGoals', 'low-rated matchups: goals', v => fx(v), v => v >= 2, '≥ 2'],
  ['fouls', 'fouls / match', v => fx(v, 1), () => true, ''],
  ['yellows', 'yellow cards / match', v => fx(v), () => true, ''],
  ['passes', 'passes / match', v => fx(v, 0), () => true, ''],
  ['completion', 'pass completion', pct, () => true, ''],
  ['msPerMatch', 'ms / match', v => fx(v, 0), () => true, ''],
];

function printSummary(report) {
  const rows = report.results,
    m = metrics(rows);
  console.log(
    `${rows.length} matches · engine ${report.engine} · ${fx(report.wallSeconds, 0)} s wall`,
  );
  for (const [key, label, show, ok, target] of TARGETS)
    console.log(
      `${ok(m[key]) ? ' ' : '!'} ${label.padEnd(42)} ${String(show(m[key])).padStart(8)}  ${target}`,
    );
  console.log(`  strong-gap n=${m.strongN}, close n=${m.closeN}, low-rated n=${m.lowN}`);
  console.log(`  save types ${JSON.stringify(m.saveTypes)}`);
  console.log(`  goal situations ${JSON.stringify(m.situations)}`);
  console.log(
    `  near misses ${fx(m.nearMisses)} posts ${fx(m.posts)} / match, end energy ${fx(m.energy)}`,
  );
  for (const d of [180, 300]) {
    const r = metrics(rows.filter(x => x.duration === d));
    console.log(
      `  ${d}s: goals ${fx(r.goals)} shots ${fx(r.shots, 1)} on target ${pct(r.onTarget)} saves ${pct(r.keeperSave)} corners ${fx(r.corners, 1)}`,
    );
  }
  for (const c of [...new Set(rows.map(r => r.category))]) {
    const r = metrics(rows.filter(x => x.category === c));
    console.log(
      `  ${c.padEnd(9)} n=${r.matches} goals ${fx(r.goals)} shots ${fx(r.shots, 1)} draws ${pct(r.draws)}`,
    );
  }
}

function compare(a, b, nameA, nameB) {
  const ma = metrics(a.results),
    mb = metrics(b.results);
  console.log(`paired comparison (${a.results.length} vs ${b.results.length} matches)`);
  console.log(`${'metric'.padEnd(42)} ${'before'.padStart(9)} ${'after'.padStart(9)}  target`);
  for (const [key, label, show, ok, target] of TARGETS)
    console.log(
      `${label.padEnd(42)} ${String(show(ma[key])).padStart(9)} ${String(show(mb[key])).padStart(9)}${ok(mb[key]) ? ' ' : '!'} ${target}`,
    );
  console.log(`before: ${nameA}\nafter:  ${nameB}`);
}

// Entry point last, so every helper above is initialised first.
if (!isMainThread) {
  const { engine, tuning, specs } = workerData;
  const { Match } = await import(engine + '/core/sim/engine.js');
  for (const spec of specs) parentPort.postMessage(runMatch(Match, spec, tuning));
  parentPort.close();
} else await main();
