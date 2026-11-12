// Auto-simulation for "Simulate this match", "Simulate the whole cup" and the Daily Challenge: plays a match config with the
// real engine (same seed + config ⇒ the same result as the match screen's Instant view) and
// summarises it in the match screen's result shape (docs/ui-match.md, the fields the RUN
// screens use). Framework-free.
//
// In the browser, autoSimulate() runs the engine in a module Worker (auto-sim-worker.js) so
// long sims never jank the page; the worker runs simulateHere() — the same deterministic loop —
// and forwards its live ticker updates. Without Worker support (Node tests, old browsers) or if
// the worker fails, simulateHere() runs on the main thread in short slices.
import { Match, MATCH_SECONDS } from '../../../core/sim/engine.js';
import { performanceRating } from '../../../core/sim/replay.js';
import { PERIOD_END } from '../../../core/sim/periods.js';
import { readJSON } from '../../lib/storage.js';
import { runResultFor } from '../../lib/match-store.js';

/** Real seconds of an auto-simmed match: the game's one match length. */
export const AUTO_DURATION = MATCH_SECONDS;
const SLICE_MS = 14;

/**
 * Dev/test switch: localStorage 'football-draft-dev' = { fastSim: true } makes auto-sims use
 * the core's fast rating model instead of the engine (browser flows; never on by default).
 */
export const fastSimEnabled = () => !!readJSON('football-draft-dev', null)?.fastSim;

/** "67'" / "45+2'" for an event's clock. */
export function minuteLabel(time, half) {
  const end = PERIOD_END[(half || 1) - 1] ?? 5400;
  return time >= end
    ? `${end / 60}+${Math.floor((time - end) / 60) + 1}'`
    : `${Math.min(end / 60, Math.floor(time / 60) + 1)}'`;
}

// A MessageChannel task, not services/catalog.js nextTask: where scheduler.yield() is missing
// that one falls back to setTimeout, whose 4 ms clamp between slices would slow every sim, and
// importing it would pull the catalog loader into the auto-sim worker.
const yieldToUi = () =>
  new Promise(resolve => {
    if (typeof MessageChannel === 'function') {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(0);
    } else setTimeout(resolve, 0);
  });

/** Goal events of a (running or finished) match, oldest first. */
export function goalList(m) {
  return m.events
    .filter(e => e.type === 'goal')
    .reverse()
    .map(e => ({
      team: e.team,
      playerId: e.playerId,
      player: e.playerId != null ? (m.players[e.playerId]?.name ?? null) : null,
      minute: minuteLabel(e.time, e.half),
      ownGoal: !!e.ownGoal,
      penalty: !!e.penalty,
      scoreAfter: e.scoreAfter ? [...e.scoreAfter] : null,
    }));
}

/** A finished engine Match → result (subset of docs/ui-match.md's shape). */
export function summarizeMatch(m, { id = null, seed = null } = {}) {
  const players = m.players.map(p => ({
    id: p.id,
    profileId: p.profileId ?? null,
    team: p.team,
    slot: p.slot,
    name: p.name,
    role: p.role,
    rating: Math.round(performanceRating(p, m) * 10) / 10,
    goals: p.stats?.goals | 0,
    assists: p.stats?.assists | 0,
  }));
  const shootout =
    m.shootout?.winner != null ? { score: [...m.shootout.score], winner: m.shootout.winner } : null;
  const winner = m.winner();
  const [h, a] = m.score;
  const motm = [...players].sort(
    (x, y) => y.rating - x.rating || y.goals - x.goals || y.assists - x.assists,
  )[0];
  return {
    id,
    seed,
    view: 'auto',
    teams: m.teams.map(t => ({ name: t.name, short: t.short, color: t.color })),
    score: [h, a],
    shootout,
    winner: winner ?? null,
    outcomes: [h > a ? 'W' : h < a ? 'L' : 'D', a > h ? 'W' : a < h ? 'L' : 'D'],
    xg: (m.stats || []).map(s => Math.round((s?.xg || 0) * 100) / 100),
    goals: goalList(m),
    players,
    motm: motm ? { ...motm } : null,
  };
}

/**
 * Simulate a config with the engine. onProgress(fraction 0–1, live) is called between slices
 * with live = { minute, score: [h, a], goals } for a ticker; cancelled() → resolves null.
 */
export async function simulateHere(
  config,
  seed,
  { id = null, onProgress = () => {}, cancelled = () => false } = {},
) {
  const m = new Match(seed >>> 0, AUTO_DURATION);
  m.importConfig(config);
  let goalsSeen = -1,
    live = null;
  while (!m.finished) {
    const until = performance.now() + SLICE_MS;
    do m.step(1 / 60);
    while (!m.finished && performance.now() < until);
    if (cancelled()) return null;
    const goals = m.goalHistory?.length ?? 0;
    if (goals !== goalsSeen || !live) {
      goalsSeen = goals;
      live = { goals: goalList(m) };
    }
    live = {
      ...live,
      minute: m.mode === 'shootout' ? 'Pens' : minuteLabel(m.time, m.half),
      score: [...m.score],
      shootout: m.shootout ? [...m.shootout.score] : null,
    };
    onProgress(Math.min(1, m.elapsed / m.expectedDuration()), live);
    await yieldToUi();
  }
  return summarizeMatch(m, { id, seed });
}

// One lazily created worker for the page; jobs run one at a time inside it.
let worker = null,
  workerBroken = typeof Worker !== 'function' || typeof window === 'undefined',
  nextJob = 1;
const jobs = new Map(); // id → { resolve, reject, onProgress, cancelled, timer }

function failWorker(reason) {
  workerBroken = true;
  worker?.terminate();
  worker = null;
  for (const job of jobs.values()) {
    clearInterval(job.timer);
    job.reject(new Error(reason));
  }
  jobs.clear();
}

function ensureWorker() {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./auto-sim-worker.js', import.meta.url), { type: 'module' });
  } catch {
    workerBroken = true;
    return null;
  }
  worker.onmessage = ({ data }) => {
    const job = jobs.get(data.id);
    if (!job) return;
    if ('progress' in data) return job.onProgress(data.progress, data.live);
    clearInterval(job.timer);
    jobs.delete(data.id);
    if (data.error) job.reject(new Error(data.error));
    else job.resolve(data.result ?? null);
  };
  worker.onerror = event => {
    event.preventDefault?.();
    failWorker(event.message || 'auto-sim worker failed');
  };
  return worker;
}

/**
 * Simulate a config with the engine, off the main thread when possible. Same contract and the
 * same deterministic result as simulateHere(); cancelled() → resolves null.
 */
export async function autoSimulate(config, seed, options = {}) {
  const { onProgress = () => {}, cancelled = () => false } = options;
  const w = ensureWorker();
  if (!w) return simulateHere(config, seed, options);
  const id = nextJob++;
  try {
    return await new Promise((resolve, reject) => {
      const job = { resolve, reject, onProgress, timer: null };
      job.timer = setInterval(() => {
        if (!cancelled()) return;
        clearInterval(job.timer);
        jobs.delete(id);
        w.postMessage({ cancel: id });
        resolve(null);
      }, 50);
      jobs.set(id, job);
      w.postMessage({ id, config, seed, matchId: options.id ?? null });
    });
  } catch {
    // The worker could not run the job (e.g. it failed to load): fall back to this thread.
    return simulateHere(config, seed, options);
  }
}

/** Simulate a stored match request (#/match hand-off) — used by tests and the fallback flow. */
export function simulateRequest(request, options) {
  return autoSimulate(request.config, request.seed, { ...options, id: request.id });
}

/** CupRun.recordResult input from a result (user = side 0): match-store's runResultFor. */
export const runSide = result => runResultFor(result, 0);

/**
 * Play every remaining match of a CupRun in order until the run is over (or flags.stop):
 * engine results are recorded with recordResult (the fast model's simulateNext when the
 * fastSim dev switch is on).
 *   configFor(m)              engine config for run.nextMatch() m;  idFor(m) result id
 *   onStart(m)                before a match;  onLive(m, fraction, live)  while it runs
 *   onDone(m, result | null)  after it is recorded (persist here; may be async)
 *   flags                     { stop, abort } read between matches / engine slices
 *   limit                     play at most this many matches ("Simulate this match": 1)
 * Resolves to the number of matches played.
 */
export async function simulateRemaining(
  run,
  {
    configFor,
    idFor = () => null,
    onStart = () => {},
    onLive = () => {},
    onDone = () => {},
    flags = {},
    limit = Infinity,
  },
) {
  const fast = fastSimEnabled();
  let played = 0;
  while (!run.complete && !flags.stop && played < limit) {
    const m = run.nextMatch();
    if (!m) break;
    await onStart(m);
    let result = null;
    if (fast) run.simulateNext();
    else {
      result = await autoSimulate(configFor(m), m.seed, {
        id: idFor(m),
        onProgress: (f, live) => onLive(m, f, live),
        cancelled: () => !!flags.abort,
      });
      if (!result) break;
      run.recordResult(runSide(result));
    }
    played++;
    await onDone(m, result);
  }
  return played;
}
