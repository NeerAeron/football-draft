// World Cup Run / Daily Challenge glue for the RUN screens (#/run, #/daily, #/challenge):
// persistence, the Home summary, team kits, prematch sides, group stakes, share links.
// Framework-free (Node tests import it); the rules live in app/core/competition/.
// Docs: docs/ui-run.md.
//
//   const { run, meta } = createRunFromDraft(catalog, completedDraft());
//   saveRun(run, meta);                       // after every recordResult
//   const saved = loadRun(catalog);           // { run, meta, pending } | null
import { DEFAULT_CONFIG } from '../../core/config/config.js';
import {
  createCupRun,
  restoreCupRun,
  CUP_ROUNDS,
  CUP_FORMAT,
  BEST_THIRD,
  PLACE_LABELS,
} from '../../core/competition/cup.js';
import { outcomeProbabilities } from '../../core/competition/model.js';
import { encodeChallenge, decodeChallenge } from '../../core/competition/share.js';
import { dailyId, updateStreak, currentStreak, previousDay } from '../../core/competition/daily.js';
import { seedNumber, difficultyOf } from '../../core/draft/session.js';
import { readJSON, writeJSON, removeKey } from './storage.js';
import { RUN_KEY, DAILY_KEY, STAGES, PLAYOFF_STAGE, RUN_SUMMARY_FORMAT } from './saved.js';
import { recordRun } from './records.js';
import { teamCode } from './match-store.js';
import { sideColors, nationTrigram } from './kits.js';

export const RUN_STATE_KEY = 'football-draft-run-state';
export const RUN_STATE_FORMAT = 1;
export { RUN_KEY, DAILY_KEY };

// ---- draft type ↔ core mode -------------------------------------------------------------
const TYPE_TO_MODE = {
  nations: 'nations',
  leagues: 'leagues',
  clubs: 'clubs',
  'club-country': 'clubAndCountry',
  clubAndCountry: 'clubAndCountry',
};
const MODE_TO_TYPE = {
  nations: 'nations',
  leagues: 'leagues',
  clubs: 'clubs',
  clubAndCountry: 'club-country',
};
/** UI draft type ('club-country' …) or core mode → core mode. */
export const modeOf = type => TYPE_TO_MODE[type] || 'nations';
/** Core mode → UI draft type (Home, setup query). */
export const typeOf = mode => MODE_TO_TYPE[mode] || MODE_TO_TYPE[TYPE_TO_MODE[mode]] || 'nations';

// ---- stages -------------------------------------------------------------------------------
export const STAGE_IDS = STAGES.map(s => s.id); // G1 G2 G3 R32 R16 QF SF F
/**
 * Stage id ('G1'…'F', or '3P' for the third-place play-off) of the next match, or of the last
 * match once the run is over.
 */
export function stageIdOf(snapshot) {
  const played = snapshot.rounds.filter(r => r.result).length;
  const index = snapshot.complete
    ? Math.max(0, played - 1)
    : Math.min(STAGE_IDS.length - 1, played);
  return snapshot.rounds[index]?.id === 'third' ? PLAYOFF_STAGE.id : STAGE_IDS[index];
}
const SHORT = {
  group1: 'MD1',
  group2: 'MD2',
  group3: 'MD3',
  r32: 'R32',
  r16: 'R16',
  qf: 'QF',
  sf: 'SF',
  final: 'Final',
  third: '3rd',
};
// A round is a snapshot round ({ id, label }: the eighth is the final or the play-off) or its
// index (0–7; 7 reads as the final).
const roundOf = round => (typeof round === 'number' ? CUP_ROUNDS[round] : round);
export const roundLabel = round => roundOf(round)?.label ?? '';
/** Short label for the path strip: 'MD1' … 'Final' ('3rd' for the play-off). */
export const roundShort = round => SHORT[roundOf(round)?.id] ?? '';
/** "Matchday 1", "Quarter-final", "Third-place play-off": a round's name without the group. */
export const roundName = round => roundLabel(round).replace('Group · ', '');

// ---- kits -----------------------------------------------------------------------------------
// National teams have no kit colours in the catalog: lib/kits.js holds their home kits.
export { NATION_KITS, nationKit, sideColors } from './kits.js';

// ---- prematch / match sides -----------------------------------------------------------------
/**
 * A side for openPrematch / buildMatchConfig from an engine-ready side (buildSide, CupRun
 * userSide/opponentSide, buildOpponent): { name, short, colors, flagCode, kind, formation,
 * players, editable, id, code }.
 */
export function matchSideFor(side, { kind = 'ai', editable = kind !== 'ai', name } = {}) {
  const display = name || side.name;
  return {
    name: display,
    short:
      display === 'You' || display === 'Your XI'
        ? 'YOU'
        : nationTrigram(side.code) || teamCode(display),
    colors: sideColors(side),
    flagCode: side.code || null,
    code: side.code || null,
    id: side.id ?? null,
    kind,
    formation: side.formation,
    players: side.players,
    editable,
  };
}
/** Display name of the user's drafted team ('You' reads oddly on cards). */
export const userTeamName = name => (!name || name === 'You' ? 'Your XI' : name);

/** Match id of a run fixture (the match screen hands the result back under it). */
export const fixtureId = (meta, round) => `run:${meta?.id || 'run'}:${round}`;

// ---- run creation & persistence --------------------------------------------------------------
const randomId = () => {
  const buf = new Uint32Array(2);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(buf);
  else buf[0] = (Date.now() * 2654435761) >>> 0;
  return buf[0].toString(36) + buf[1].toString(36).slice(0, 3);
};

/**
 * Start a World Cup Run from a completed draft ({ session, context } from draft-store).
 * Challenge drafts (useDefaultRules) keep DEFAULT_CONFIG rules so a friend meets the same
 * opponents. Returns { run, meta }.
 */
export function createRunFromDraft(catalog, { session, context = {} }, { now = Date.now() } = {}) {
  const options = session.options || {};
  const mode = modeOf(context.type ?? session.mode);
  const difficulty = difficultyOf(context.difficulty ?? options.difficulty);
  const seed = context.seed ?? options.seed ?? 1;
  const challenge = context.meta?.challenge ?? context.challenge ?? null;
  const defaultRules = !!(options.useDefaultRules || context.useDefaultRules || challenge);
  const user = session.matchSide(0);
  const run = createCupRun(catalog, {
    mode,
    difficulty,
    seed,
    user,
    ...(defaultRules ? { rules: DEFAULT_CONFIG.draft } : {}),
  });
  const meta = {
    id: randomId(),
    kind: 'run',
    type: typeOf(mode),
    mode,
    difficulty,
    formation: user.formation,
    seed: typeof seed === 'number' || typeof seed === 'string' ? seed : seedNumber(seed),
    hideRatings: !!(context.options?.hideRatings ?? options.hideRatings),
    uniqueNations: !!(context.options?.uniqueNations ?? options.uniqueNations),
    defaultRules,
    // Budget mode (the draft's option): its trophies go into a cabinet of their own.
    budget: !!(context.options?.budget ?? context.budget ?? options.budget),
    challenge: challenge ? sanitizeChallenge(challenge) : null,
    links: user.links
      ? { score: user.links.score, maxScore: user.links.maxScore, total: user.links.total }
      : null,
    startedAt: new Date(now).toISOString(),
  };
  return { run, meta };
}
const sanitizeChallenge = c =>
  typeof c === 'object' && c
    ? { by: typeof c.by === 'string' ? c.by.slice(0, 40) : null, token: c.token ?? null }
    : { by: null, token: null };

/** Home's summary of a run ('football-draft-run'), see lib/saved.js. */
export function runSummary(snapshot, meta = {}) {
  return {
    format: RUN_SUMMARY_FORMAT,
    mode: 'run',
    type: meta.type || typeOf(snapshot.mode),
    stage: stageIdOf(snapshot),
    record: { w: snapshot.record.w, d: snapshot.record.d, l: snapshot.record.l },
    team: userTeamName(snapshot.user?.name),
    status: snapshot.status,
    complete: !!snapshot.complete,
    place: snapshot.place ?? null,
    placeLabel: snapshot.placeLabel ?? null,
    medal: snapshot.medal ?? null,
    perfect: !!snapshot.perfect,
    budget: meta.budget === true,
    stageLabel: snapshot.stageLabel,
    difficulty: snapshot.difficulty,
    rounds: snapshot.rounds.length,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Persist a run: the full state ('football-draft-run-state', ~5 KB) and Home's summary.
 * extra: { pending: { id, round, seed } | null, log: [...] } kept alongside.
 */
export function saveRun(run, meta, extra = {}) {
  const previous = readJSON(RUN_STATE_KEY, null);
  const state = {
    format: RUN_STATE_FORMAT,
    run: run.serialize(),
    meta,
    pending: extra.pending !== undefined ? extra.pending : (previous?.pending ?? null),
    log: extra.log !== undefined ? extra.log : Array.isArray(previous?.log) ? previous.log : [],
  };
  writeJSON(RUN_STATE_KEY, state);
  const summary = runSummary(run.snapshot(), meta);
  writeJSON(RUN_KEY, summary);
  // A finished run goes into the trophy cabinet (once: lib/records.js remembers run ids).
  if (summary.complete) recordRun(summary, meta?.id);
  return state;
}
/** Update only the pending fixture / log of the saved run. */
export function patchRunState(patch) {
  const state = readJSON(RUN_STATE_KEY, null);
  if (!state || typeof state !== 'object') return null;
  const next = { ...state, ...patch };
  writeJSON(RUN_STATE_KEY, next);
  return next;
}
/**
 * The raw saved state (tolerant: null for anything that does not look like ours). A run saved
 * in an older cup format (before the third-place play-off and the three difficulties, or the
 * seven-match format before that) cannot be resumed: it reads as no run (Home's summary of a
 * finished one stays, see lib/saved.js).
 */
export function readRunState() {
  const state = readJSON(RUN_STATE_KEY, null);
  if (!state || typeof state !== 'object' || state.format !== RUN_STATE_FORMAT) return null;
  if (!state.run || state.run.type !== 'cup-run' || state.run.format !== CUP_FORMAT) return null;
  return {
    run: state.run,
    meta: state.meta && typeof state.meta === 'object' ? state.meta : {},
    pending: state.pending && typeof state.pending === 'object' ? state.pending : null,
    log: Array.isArray(state.log) ? state.log : [],
  };
}
/** Restore the saved run: { run, meta, pending, log } or null (also when the catalog changed). */
export function loadRun(catalog) {
  const state = readRunState();
  if (!state) return null;
  try {
    return { ...state, run: restoreCupRun(catalog, state.run) };
  } catch {
    return null;
  }
}
export function clearRun() {
  removeKey(RUN_STATE_KEY);
  removeKey(RUN_KEY);
}

// ---- match log (scorers per round, for the hub and the end screen) ------------------------------
/** Compact per-match record kept with the run: goals (minute, name, team), motm, view. */
export function logEntry(round, result) {
  if (!result) return null;
  const goals = (result.goals || [])
    .filter(g => g && (g.team === 0 || g.team === 1))
    .map(g => ({
      team: g.team,
      name: g.player || g.name || null,
      minute: g.minute || null,
      ownGoal: !!g.ownGoal,
      penalty: !!g.penalty,
    }))
    .slice(0, 20);
  const motm = result.motm
    ? { name: result.motm.name, team: result.motm.team, rating: result.motm.rating }
    : null;
  return {
    round,
    score: Array.isArray(result.score) ? [...result.score] : null,
    shootout: result.shootout?.score ? [...result.shootout.score] : null,
    goals,
    motm,
    view: result.view || result.durationMode || 'auto',
  };
}
export function withLog(log, entry) {
  if (!entry) return log;
  return [...(log || []).filter(e => e.round !== entry.round), entry].sort(
    (a, b) => a.round - b.round,
  );
}

// ---- odds and stakes -------------------------------------------------------------------------
/** Win / draw / loss probabilities (fast model) for the next fixture card. */
export function fixtureOdds(userEffective, opponentEffective) {
  const p = outcomeProbabilities(userEffective, opponentEffective);
  const win = Math.round(p.win * 100),
    draw = Math.round(p.draw * 100);
  return { win, draw, loss: Math.max(0, 100 - win - draw) };
}

/** The best-thirds rule in words, from BEST_THIRD (hub draw banner, stakes, group table). */
export const THIRD_PLACE_RULE = `Third place goes through with ${BEST_THIRD.points} points or more.`;

const OUTCOMES = [
  ['W', [1, 0]],
  ['D', [0, 0]],
  ['L', [0, 1]],
];
/**
 * What the last group match means, by points: for each user result 'W' | 'D' | 'L' →
 * 'through' (top two, or a third place on 4+ points, whatever happens elsewhere), 'out' (below
 * the cut whatever happens), or 'depends' (on the other match or goal difference). A third
 * place goes through on BEST_THIRD (core/competition/cup.js): 4 points or more, never
 * fewer. null before matchday 3.
 * { md: 3, other: { home, away }, W, D, L, third: bool (some result hangs on third place) }.
 */
export function groupStakes(snapshot) {
  if (snapshot.complete || snapshot.round !== 2) return null;
  const { fixtures, teams } = snapshot.group;
  const name = key => teams.find(t => t.key === key)?.name ?? key;
  const points = new Map(teams.map(t => [t.key, 0]));
  for (const f of fixtures.filter(f => f.score)) {
    const [a, b] = f.score;
    points.set(f.home, points.get(f.home) + (a > b ? 3 : a === b ? 1 : 0));
    points.set(f.away, points.get(f.away) + (b > a ? 3 : a === b ? 1 : 0));
  }
  const mine = fixtures.find(f => !f.score && (f.home === 'user' || f.away === 'user'));
  const other = fixtures.find(f => !f.score && f !== mine);
  if (!mine || !other) return null;
  const rival = mine.home === 'user' ? mine.away : mine.home;
  const out = { md: 3, other: { home: name(other.home), away: name(other.away) }, third: false };
  // Whether finishing in a position on `me` points goes through: true, false or null (on GD).
  const goesThrough = (position, me) =>
    position <= 2 ? true : position >= 4 ? false : me >= BEST_THIRD.points ? true : false;
  for (const [outcome, [u, r]] of OUTCOMES) {
    const verdicts = OUTCOMES.map(([, [h, a]]) => {
      const p = new Map(points);
      p.set('user', p.get('user') + (u > r ? 3 : u === r ? 1 : 0));
      p.set(rival, p.get(rival) + (r > u ? 3 : u === r ? 1 : 0));
      p.set(other.home, p.get(other.home) + (h > a ? 3 : h === a ? 1 : 0));
      p.set(other.away, p.get(other.away) + (a > h ? 3 : h === a ? 1 : 0));
      const me = p.get('user'),
        above = [...p].filter(([k, v]) => k !== 'user' && v > me).length,
        level = [...p].filter(([k, v]) => k !== 'user' && v === me).length;
      // Level teams can finish either side of you: every position in the range counts.
      const fates = [];
      for (let pos = above + 1; pos <= above + level + 1; pos++) {
        fates.push(goesThrough(pos, me));
        if (pos === 3 && me >= BEST_THIRD.points) out.third = true;
      }
      return fates.every(f => f === true)
        ? 'through'
        : fates.every(f => f === false)
          ? 'out'
          : 'depends';
    });
    out[outcome] = verdicts.every(v => v === verdicts[0]) ? verdicts[0] : 'depends';
  }
  return out;
}

// ---- share links -------------------------------------------------------------------------------
/** The deployed page's own URL (no hash), e.g. 'https://user.github.io/football-draft/'. */
export function pageBase(loc = globalThis.location) {
  if (!loc) return 'https://football-draft.example/';
  return `${loc.origin}${loc.pathname}`;
}
// Where the friend finished, in the link: two letters per place (core cup.js PLACES). Links
// from before the places carried a letter grade there ('sp', 'b', …): those read as no place.
const PLACE_TOKENS = {
  champion: 'ch',
  final: 'ru',
  third: 'th',
  fourth: 'fo',
  qf: 'qf',
  r16: 'rs',
  r32: 'rt',
  group: 'gs',
};
const TOKEN_PLACES = Object.fromEntries(Object.entries(PLACE_TOKENS).map(([k, v]) => [v, k]));
export const placeToken = place => PLACE_TOKENS[place] ?? '';
export const placeFromToken = token => TOKEN_PLACES[String(token || '')] ?? null;

/**
 * "Challenge a friend" URL for the run/daily that was just played:
 *   <page>#/challenge?c=<token>&r=<w>-<d>-<l>.<place>
 * The token is core/competition/share.js encodeChallenge; parseChallengeUrl reads it too.
 */
export function challengeLink(challenge, { record = null, place = null, base = pageBase() } = {}) {
  const token = encodeChallenge(challenge);
  const r =
    record && Number.isInteger(record.w)
      ? `&r=${record.w}-${record.d}-${record.l}${placeToken(place) ? '.' + placeToken(place) : ''}`
      : '';
  return `${String(base).split('#')[0]}#/challenge?c=${token}${r}`;
}
/**
 * Parse the landing query: { challenge (decoded) | null, score: { w, d, l, place, placeLabel }
 * | null }. An old link's grade token is ignored (place: null).
 */
export function readChallengeQuery(query = {}) {
  const challenge = decodeChallenge(String(query.c || '').toLowerCase());
  const m = /^(\d)-(\d)-(\d)(?:\.([a-z]{1,2}))?$/.exec(String(query.r || ''));
  const place = m ? placeFromToken(m[4]) : null;
  const score = m
    ? { w: +m[1], d: +m[2], l: +m[3], place, placeLabel: place ? PLACE_LABELS[place] : null }
    : null;
  return { challenge, score };
}
/** The challenge describing a run (for its "Challenge a friend" link). */
export function runChallenge(meta, snapshot) {
  return {
    kind: 'cup',
    mode: meta.mode || snapshot.mode,
    seed: meta.seed ?? 1,
    formation: meta.formation || '433',
    difficulty: difficultyOf(meta.difficulty || snapshot.difficulty),
    hideRatings: !!meta.hideRatings,
    uniqueNations: !!meta.uniqueNations,
  };
}

// ---- daily -------------------------------------------------------------------------------------
const DAILY_RESULTS_KEPT = 40;
const DAILY_RUNS_KEPT = 7; // full run state (replays) only for the latest week
/**
 * The Daily Challenge record ('football-draft-daily'), read tolerantly:
 *   { streak, best, lastPlayed, lastResult,            // what Home reads (lib/saved.js)
 *     streakState: { current, best, last },            // core updateStreak() state
 *     results: { 'YYYY-MM-DD': entry },                // finished attempts (latest 40)
 *     current: { id, number, run, rating, perfect, startedAt } | null }  // attempt being simmed
 */
export function readDaily() {
  const d = readJSON(DAILY_KEY, null) || {};
  const results = d.results && typeof d.results === 'object' ? d.results : {};
  const lastPlayed = typeof d.lastPlayed === 'string' ? d.lastPlayed : null;
  const s = d.streakState && typeof d.streakState === 'object' ? d.streakState : null;
  const streakState = {
    current: (s?.current ?? d.streak) | 0,
    best: (s?.best ?? d.best) | 0,
    last: typeof s?.last === 'string' ? s.last : lastPlayed,
  };
  return {
    streak: d.streak | 0,
    best: d.best | 0,
    lastPlayed,
    lastResult: typeof d.lastResult === 'string' ? d.lastResult : null,
    streakState,
    results,
    current: d.current && typeof d.current === 'object' && d.current.run ? d.current : null,
  };
}
function writeDaily(state) {
  const ids = Object.keys(state.results || {}).sort();
  const kept = ids.slice(-DAILY_RESULTS_KEPT);
  const results = Object.fromEntries(
    kept.map((id, i) => {
      const entry = state.results[id];
      if (i >= kept.length - DAILY_RUNS_KEPT || !entry?.run) return [id, entry];
      const { run, ...rest } = entry;
      return [id, rest];
    }),
  );
  writeJSON(DAILY_KEY, { ...state, results });
  return { ...state, results };
}
/** Today's UTC daily id. */
export const todayDailyId = (now = new Date()) => dailyId(now);
/** Streak to show today (0 once a day was missed). */
export function displayStreak(state, today = todayDailyId()) {
  return currentStreak(state.streakState, today);
}
/**
 * Lock today's attempt once the XI is drafted (one attempt per day): sets lastPlayed and the
 * streak, stores the serialised run so a refresh resumes the auto-sim.
 */
export function beginDailyAttempt(state, { id, number, run, rating, perfect, formation }) {
  const streakState = updateStreak(state.streakState, id);
  return writeDaily({
    ...state,
    streak: streakState.current,
    best: streakState.best,
    lastPlayed: id,
    streakState,
    current: {
      id,
      number,
      run: run.serialize(),
      rating,
      perfect,
      formation,
      startedAt: new Date().toISOString(),
    },
  });
}
/** Save progress of the attempt being simulated. */
export function saveDailyProgress(state, run, log) {
  if (!state.current) return state;
  return writeDaily({ ...state, current: { ...state.current, run: run.serialize(), log } });
}
/** Finish the attempt: store the result entry for the day and clear `current`. */
export function finishDailyAttempt(state, entry) {
  return writeDaily({
    ...state,
    lastResult: `${entry.record.w}-${entry.record.d}-${entry.record.l}`,
    results: { ...state.results, [entry.id]: entry },
    current: null,
  });
}
/** Milliseconds until the next UTC midnight (the next daily). */
export function msUntilNextDaily(now = Date.now()) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - d.getTime();
}
/** 'HH:MM:SS' countdown text. */
export function countdownText(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = n => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}
/** Whether the streak is still alive but needs today's attempt (played yesterday). */
export const streakAtRisk = (state, today = todayDailyId()) =>
  state.streakState.last === previousDay(today) && state.streakState.current > 0;
