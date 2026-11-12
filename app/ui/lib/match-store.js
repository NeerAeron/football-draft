// Match hand-off contract between the screens that set up a match (draft, run, daily,
// exhibition) and the match screen (#/match). Framework-free, so Node tests import it.
// Full documentation: docs/ui-match.md.
//
//   import { buildMatchConfig, requestMatch, readMatchResult, clearMatch } from '../../lib/match-store.js';
//
//   const config = buildMatchConfig({ sides: [home, away], competition: { mode: 'ai', knockout } });
//   requestMatch({ id: 'run:qf', seed, view: 'key', config,
//                  meta: { context: 'run', title: 'Quarter-final', returnTo: '#/run', userSides: [0],
//                          sides: [{ name, short, kind: 'user', flagCode, colors }, …] } });
//   // … the match screen plays it and stores the result; its Continue goes to meta.returnTo …
//   const result = readMatchResult('run:qf');   // null until the match is over
//   run.recordResult(runResultFor(result, 0));  // { goalsFor, goalsAgainst, shootout, players }
//   clearMatch('run:qf');                       // once applied, so a refresh cannot apply it twice
import { CONFIG } from '../../core/config/config.js';
import { Match, MATCH_SECONDS } from '../../core/sim/engine.js';
import { FORMATIONS } from '../../core/players/formations.js';
import { matchSetup, applyMatchSetup } from '../../core/draft/session.js';
import { nationKit, nationTrigram, teamCode } from './kits.js';

export { teamCode };
import { readJSON, writeJSON, removeKey } from './storage.js';
import { createStore } from './create-store.js';
import { randomSeed } from './random.js';

export const MATCH_KEY = 'football-draft-match';
export const MATCH_ROUTE = '#/match';
export const MATCH_VIEWS = ['key', 'full', 'instant'];
export const MATCH_CONTEXTS = ['run', 'quick', 'versus', 'exhibition', 'daily', 'demo'];
/** Real seconds of every match (90 minutes compressed): Full, Key Moments and Instant alike. */
export const FULL_DURATION = MATCH_SECONDS;
const FORMAT = 1;

const DEFAULT_KITS = [
  ['#d9f580', '#16213a'],
  ['#baaff0', '#16213a'],
];
const TACTIC_KEYS = ['style', 'tempo', 'width', 'press', 'fluidity', 'mentality'];

function load() {
  const saved = readJSON(MATCH_KEY, null);
  if (!saved || saved.format !== FORMAT || !validRequest(saved.request)) return null;
  return {
    format: FORMAT,
    request: saved.request,
    status: saved.result ? 'done' : saved.status === 'live' ? 'live' : 'ready',
    result: saved.result || null,
  };
}

/**
 * The current match hand-off: `null` or `{ request, status: 'ready' | 'live' | 'done', result }`.
 * Persisted under `football-draft-match`; `useStore(matchStore)` works with it.
 */
export const matchStore = createStore(load(), { merge: false });
matchStore.subscribe(state => {
  if (state) writeJSON(MATCH_KEY, state);
  else removeKey(MATCH_KEY);
});

// ---------- Config ----------

const initials = teamCode;

function normalizeSide(side, i) {
  if (!side || typeof side !== 'object') throw new TypeError(`Side ${i + 1} is missing`);
  if (!FORMATIONS[side.formation]) throw new RangeError(`Unknown formation "${side.formation}"`);
  if (!Array.isArray(side.players) || side.players.length !== 11 || side.players.some(p => !p))
    throw new RangeError(`Side ${i + 1} needs eleven players in formation slot order`);
  const [color, secondary] = side.colors ?? [side.color, side.secondary];
  // National sides have no catalog colours: their home kit comes from lib/kits.js.
  const kit = (!color && nationKit(side.code ?? side.flagCode)) || DEFAULT_KITS[i];
  return {
    name: side.name || `Team ${i + 1}`,
    short: side.short || nationTrigram(side.code ?? side.flagCode) || initials(side.name),
    color: color || kit[0],
    secondary: secondary || (color ? DEFAULT_KITS[i][1] : kit[1]),
    formation: side.formation,
    kind: side.kind ?? null,
    id: side.id ?? null,
    code: side.code ?? side.flagCode ?? null,
    players: side.players,
    tactics: side.tactics || {},
  };
}

/**
 * Two sides → a Match config (`{ tuning, competition, teams, players }`) that
 * `Match.importConfig` takes as-is.
 *   sides        [{ name, short?, colors: [primary, secondary] (or color/secondary), formation,
 *                   tactics?: { style, tempo, width, press, fluidity, mentality },
 *                   players: 11 profiles in formation slot order (catalog players or
 *                   draft.matchSide(i).players — `chem` is kept), kind?, id?, code? }]
 *   competition  { mode: 'ai' | 'pvp' | 'sandbox', difficulty, knockout, extraTime }
 *                (default { mode: 'ai', difficulty: 'medium' }: the AI coach runs side 1)
 *   tuning       config snapshot (default: the live CONFIG)
 * Kit clash: the away side wears its secondary colour (draft matchSetup rules). The result is
 * round-tripped through a Match (importConfig → exportConfig), so it is exactly what the engine
 * expects and stays valid JSON.
 */
export function buildMatchConfig({ sides, competition = {}, tuning } = {}) {
  if (!Array.isArray(sides) || sides.length !== 2)
    throw new TypeError('buildMatchConfig needs two sides');
  const [home, away] = sides.map(normalizeSide);
  const match = new Match(1, FULL_DURATION);
  if (tuning) match.tuning = structuredClone(tuning);
  const config = applyMatchSetup(match.exportConfig(), matchSetup(home, away), {
    mode: 'ai',
    difficulty: 'medium',
    ...competition,
  });
  config.tuning = structuredClone(tuning || CONFIG);
  config.teams = config.teams.map((team, i) => {
    // A side that did not choose a mentality plays the game state ('auto': push when
    // behind late, hold a late lead) — in instant sims and highlights too.
    const wanted = [home, away][i].tactics,
      tactics = { ...team.tactics, mentality: 'auto' };
    for (const key of TACTIC_KEYS) if (wanted[key] != null) tactics[key] = wanted[key];
    return { ...team, tactics };
  });
  match.importConfig(config);
  // Formation through setTactic so an invalid tactic value is normalised/rejected like live.
  for (const t of [0, 1])
    for (const key of TACTIC_KEYS) match.setTactic(t, key, config.teams[t].tactics[key]);
  return match.exportConfig();
}

// ---------- Requests ----------

function validRequest(r) {
  return (
    !!r &&
    typeof r === 'object' &&
    MATCH_VIEWS.includes(r.view) &&
    Number.isFinite(r.seed) &&
    Array.isArray(r.config?.teams) &&
    r.config.teams.length === 2 &&
    Array.isArray(r.config?.players) &&
    r.config.players.length === 22
  );
}

/**
 * Fill defaults and validate a request (throws on a malformed config):
 *   { id, seed, view, duration, config, meta: { context, title, sides, userSides, returnTo } }
 */
export function createMatchRequest({ id, seed, view = 'key', config, meta = {} } = {}) {
  const s = Number.isFinite(seed) ? seed >>> 0 : randomSeed();
  const request = {
    id: String(id ?? `match-${s.toString(36)}`),
    seed: s,
    view: MATCH_VIEWS.includes(view) ? view : 'key',
    duration: FULL_DURATION,
    config,
    meta: normalizeMeta(meta, config),
  };
  if (!validRequest(request))
    throw new TypeError('A match request needs a config with 2 teams and 22 players');
  return request;
}

function normalizeMeta(meta, config) {
  const teams = config?.teams || [];
  const sides = [0, 1].map(i => {
    const given = meta.sides?.[i] || {},
      team = teams[i] || {};
    return {
      name: given.name || team.name || `Team ${i + 1}`,
      short: given.short || team.short || initials(given.name || team.name),
      kind: ['user', 'ai', 'p2'].includes(given.kind)
        ? given.kind
        : i === 0
          ? 'user'
          : config?.competition?.mode === 'pvp'
            ? 'p2'
            : 'ai',
      flagCode: given.flagCode ?? team.code ?? null,
      colors: given.colors || [team.color, team.secondary].filter(Boolean),
    };
  });
  const userSides = Array.isArray(meta.userSides)
    ? meta.userSides.filter(t => t === 0 || t === 1)
    : sides.map((s, i) => (s.kind === 'ai' ? null : i)).filter(i => i !== null);
  return {
    ...meta,
    context: MATCH_CONTEXTS.includes(meta.context) ? meta.context : 'quick',
    title: meta.title || '',
    sides,
    userSides,
    returnTo: meta.returnTo || '#/',
  };
}

/**
 * Hand a match to the match screen and (by default) navigate to #/match. Replaces any previous
 * request/result. Returns the normalised request.
 */
export function requestMatch(input, { go = true } = {}) {
  const request = createMatchRequest(input);
  matchStore.set({ format: FORMAT, request, status: 'ready', result: null });
  if (go && globalThis.location && globalThis.location.hash !== MATCH_ROUTE)
    globalThis.location.hash = MATCH_ROUTE;
  return request;
}

/** The current request (or null). */
export const currentRequest = () => matchStore.get()?.request ?? null;

/** Match screen: mark the request as kicked off (a refresh then restarts it from kickoff). */
export function markMatchLive() {
  const state = matchStore.get();
  if (state && state.status === 'ready') matchStore.set({ ...state, status: 'live' });
}

/** Match screen: store the finished match's result (see docs/ui-match.md for the shape). */
export function saveMatchResult(result) {
  const state = matchStore.get();
  if (!state || state.request.id !== result.id) return false;
  matchStore.set({ ...state, status: 'done', result });
  return true;
}

/** Same request with a new seed (Rematch). */
export function rematch({ go = false } = {}) {
  const state = matchStore.get();
  if (!state) return null;
  let seed = randomSeed();
  if (seed === state.request.seed) seed = (seed + 1) >>> 0;
  return requestMatch({ ...state.request, seed }, { go });
}

/** The stored result of match `id` (any match when omitted), or null while it is unfinished. */
export function readMatchResult(id) {
  const state = matchStore.get() ?? load();
  if (!state?.result) return null;
  return id == null || state.result.id === String(id) ? state.result : null;
}

/** Forget the request/result (only if it is match `id`, when given). */
export function clearMatch(id) {
  const state = matchStore.get();
  if (!state) return;
  if (id != null && state.request.id !== String(id)) return;
  matchStore.set(null);
}

/**
 * A result from one side's point of view, in the shape CupRun.recordResult takes:
 *   { goalsFor, goalsAgainst, outcome: 'W'|'D'|'L' (90/120-minute score),
 *     shootout: null | { winner: 'user' | 'opponent', score: [for, against] | null (a level
 *               match with a winner and no shootout: abandoned) },
 *     players: [{ profileId, rating, goals, assists }] }   // that side's XI
 */
export function runResultFor(result, side = 0) {
  if (!result) return null;
  const o = 1 - side,
    goalsFor = result.score[side],
    goalsAgainst = result.score[o];
  // A level match decided otherwise (abandoned: a side fell below seven) has a winner but no
  // shootout: the winner is carried, so a knockout can still be recorded.
  const decided =
    goalsFor === goalsAgainst && !result.shootout && (result.winner === 0 || result.winner === 1);
  return {
    goalsFor,
    goalsAgainst,
    outcome: goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D',
    shootout: result.shootout
      ? {
          winner: result.shootout.winner === side ? 'user' : 'opponent',
          score: [result.shootout.score[side], result.shootout.score[o]],
        }
      : decided
        ? { winner: result.winner === side ? 'user' : 'opponent', score: null }
        : null,
    players: result.players
      .filter(p => p.team === side)
      .map(p => ({
        profileId: p.profileId,
        rating: p.rating,
        goals: p.goals,
        assists: p.assists,
      })),
  };
}
