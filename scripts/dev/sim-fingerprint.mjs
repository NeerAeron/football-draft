// Deterministic simulation fingerprint.
//
// Simulates a fixed set of matches and prints a JSON summary (score, team stats,
// a hash of the complete event log and final player state) plus timings.
// Use it to prove that a refactor or optimisation is behaviour-neutral:
//
//   node scripts/dev/sim-fingerprint.mjs > /tmp/before.json
//   ...edit...
//   node scripts/dev/sim-fingerprint.mjs --compare /tmp/before.json
//
// Options: --quick (fewer matches), --compare <file>, --json (print JSON only).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Match } from '../../app/engine.js';
import { randomLineups } from '../../app/lineups.js';

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const compareIndex = args.indexOf('--compare');
const compareFile = compareIndex >= 0 ? args[compareIndex + 1] : null;
const jsonOnly = args.includes('--json') || (!compareFile && !process.stdout.isTTY);

const catalog = JSON.parse(
  readFileSync(new URL('../../app/data/players-runtime.json', import.meta.url), 'utf8'),
);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

const cases = [];
for (const duration of quick ? [180] : [180, 300])
  for (const seed of quick ? [1, 2] : [1, 2, 3]) cases.push({ kind: 'default', seed, duration });
for (const duration of quick ? [300] : [180, 300])
  for (const seed of quick ? [11] : [11, 12, 13]) cases.push({ kind: 'catalog', seed, duration });

const results = [];
let totalMs = 0;
for (const c of cases) {
  const m = new Match(c.seed, c.duration);
  if (c.kind === 'catalog') {
    const config = m.exportConfig();
    config.players = randomLineups(m.players, catalog.players, c.seed);
    m.importConfig(config);
  }
  const start = performance.now();
  let steps = 0;
  while (!m.finished && steps < 60 * 60 * 30) {
    m.step(1 / 60);
    if (m.mode === 'halftime') m.resumeHalf?.();
    steps++;
  }
  const ms = performance.now() - start;
  totalMs += ms;
  results.push({
    ...c,
    steps,
    ms: Math.round(ms),
    score: [...m.score],
    goals: m.goalHistory?.length ?? null,
    stats: hash(m.stats),
    events: hash(m.events.map(e => [e.elapsed, e.type, e.text])),
    players: hash(m.players.map(p => [p.x, p.y, p.vx, p.vy, p.energy, p.stats])),
  });
}

const summary = { totalMs: Math.round(totalMs), results };
if (compareFile) {
  const before = JSON.parse(readFileSync(compareFile, 'utf8'));
  let same = true;
  for (const [i, r] of results.entries()) {
    const b = before.results[i];
    const keys = ['score', 'stats', 'events', 'players', 'steps'];
    const diff = !b ? keys : keys.filter(k => JSON.stringify(b[k]) !== JSON.stringify(r[k]));
    if (diff.length) same = false;
    console.log(
      `${diff.length ? 'DIFF' : 'same'}  ${r.kind} seed ${r.seed} ${r.duration}s  ` +
        `${b ? b.ms : '?'}ms -> ${r.ms}ms  score ${r.score.join('-')}` +
        (diff.length ? `  changed: ${diff.join(', ')}` : ''),
    );
  }
  console.log(
    `total ${before.totalMs}ms -> ${summary.totalMs}ms (${(before.totalMs / summary.totalMs).toFixed(2)}x)  ` +
      (same ? 'IDENTICAL behaviour' : 'BEHAVIOUR CHANGED'),
  );
  process.exitCode = same ? 0 : 1;
} else if (jsonOnly) console.log(JSON.stringify(summary, null, 2));
else {
  for (const r of results)
    console.log(`${r.kind} seed ${r.seed} ${r.duration}s  ${r.ms}ms  score ${r.score.join('-')}`);
  console.log(`total ${summary.totalMs}ms`);
}
