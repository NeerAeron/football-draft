// Read-only views of saved progress that the Home screen shows. The RUN/DAILY screens own
// the writing side (lib/run-store.js). Readers are tolerant: anything missing, broken or saved
// in an older format reads as nothing saved — one cut-off, no conversion, never a throw.
//
//   'football-draft-run'    World Cup Run summary (written after every match):
//      { format: 3, mode: 'run', type: 'nations', stage: 'QF', record: { w, d, l },
//        team?: 'name', status?: 'playing' | 'champion' | 'eliminated', complete?: bool,
//        place?: 'third', placeLabel?: 'Third place', medal?: 'bronze', perfect?, budget?,
//        stageLabel?, difficulty?, rounds: 8, updatedAt: ISO string }
//      stage: the next match ('3P' = the third-place play-off, in the final's slot).
//      format: the cup format the run was saved in; a summary without format: 3 reads as no
//      run.
//   'football-draft-daily'  Daily Challenge record:
//      { streak: 3, best: 7, lastPlayed: 'YYYY-MM-DD' (UTC day), lastResult?: '5-1-1',
//        streakState?: { current, best, last }, results?: { [day]: entry }, current?: {…},
//        draft?: { id, context, session, savedAt } (the day's draft, from its first pick) }
//   'football-draft-draft'  the draft in progress (lib/draft-store.js writes it):
//      { format: 2, context: { kind, type, difficulty, … }, session: { type: 'draft-session',
//        state: { picks: [[…11 ids or null], …] } }, savedAt }
//   The full run state lives in 'football-draft-run-state' (lib/run-store.js).
//   Lifetime records of finished runs live in 'football-draft-records' (lib/records.js).
import { readJSON } from './storage.js';

export const RUN_KEY = 'football-draft-run';
export const DAILY_KEY = 'football-draft-daily';
export const DRAFT_KEY = 'football-draft-draft';
// Format 2: sessions of core SESSION_FORMAT 2 (the rules of this version).
export const DRAFT_FORMAT = 2;
/** The draft modes (core DRAFT_MODES; kept here so Home loads no core code — a test compares). */
export const DRAFT_TYPES = ['nations', 'leagues', 'clubs'];

export const STAGES = [
  { id: 'G1', short: '1', label: 'Group match 1' },
  { id: 'G2', short: '2', label: 'Group match 2' },
  { id: 'G3', short: '3', label: 'Group match 3' },
  { id: 'R32', short: 'R32', label: 'Round of 32' },
  { id: 'R16', short: 'R16', label: 'Round of 16' },
  { id: 'QF', short: 'QF', label: 'Quarter-final' },
  { id: 'SF', short: 'SF', label: 'Semi-final' },
  { id: 'F', short: 'F', label: 'Final' },
];

/** The summary format of a resumable run (core cup.js CUP_FORMAT). */
export const RUN_SUMMARY_FORMAT = 3;
/** The semi-final loser's eighth match: it takes the final's place on the path. */
export const PLAYOFF_STAGE = { id: '3P', short: '3rd', label: 'Third-place play-off' };
const MEDALS = ['gold', 'silver', 'bronze'];

export function readSavedRun() {
  const run = readJSON(RUN_KEY, null);
  if (!run || typeof run !== 'object') return null;
  const record = run.record || {};
  const status = ['playing', 'champion', 'eliminated'].includes(run.status)
    ? run.status
    : 'playing';
  if (run.format !== RUN_SUMMARY_FORMAT) return null;
  const playoff = run.stage === PLAYOFF_STAGE.id;
  const placeLabel = typeof run.placeLabel === 'string' ? run.placeLabel : null;
  return {
    mode: run.mode || 'run',
    type: run.type || 'nations',
    // The path position (the play-off sits in the final's slot) and what the match is called.
    stage: playoff ? 'F' : STAGES.some(s => s.id === run.stage) ? run.stage : 'G1',
    stageLabel: playoff
      ? PLAYOFF_STAGE.label
      : (STAGES.find(s => s.id === run.stage)?.label ?? STAGES[0].label),
    record: { w: record.w | 0, d: record.d | 0, l: record.l | 0 },
    team: typeof run.team === 'string' ? run.team : null,
    status,
    complete: status !== 'playing',
    placeLabel,
    medal: MEDALS.includes(run.medal) ? run.medal : null,
    perfect: run.perfect === true,
    budget: run.budget === true,
    updatedAt: run.updatedAt || null,
  };
}

const DAY = 86400000;
const ID = /^\d{4}-\d{2}-\d{2}$/;
/** UTC day id 'YYYY-MM-DD' — the Daily Challenge's day (same as core dailyId). */
export const dailyKey = (date = new Date()) => date.toISOString().slice(0, 10);
const previousDayKey = id =>
  new Date(Date.parse(id + 'T00:00:00Z') - DAY).toISOString().slice(0, 10);

export function readDailyStatus(now = new Date()) {
  const daily = readJSON(DAILY_KEY, null) || {};
  const lastPlayed =
    typeof daily.lastPlayed === 'string' && ID.test(daily.lastPlayed) ? daily.lastPlayed : null;
  const today = dailyKey(now);
  // A streak is alive while the last attempt was today or yesterday.
  const alive = lastPlayed && (lastPlayed === today || lastPlayed === previousDayKey(today));
  const entry = daily.results && typeof daily.results === 'object' ? daily.results[today] : null;
  const started = daily.draft?.id === today || daily.current?.id === today;
  return {
    streak: alive ? daily.streak | 0 : 0,
    best: daily.best | 0,
    lastPlayed,
    playedToday: lastPlayed === today,
    // Today's attempt is under way (drafting from the first pick on, or being simulated): it
    // can only be resumed.
    inProgress: !!started && !entry,
    lastResult: typeof daily.lastResult === 'string' ? daily.lastResult : null,
    // Today's finished attempt (points, where it finished) when there is one.
    todayResult:
      entry && typeof entry === 'object' && Number.isFinite(entry.points)
        ? {
            points: entry.points,
            placeLabel: typeof entry.placeLabel === 'string' ? entry.placeLabel : null,
          }
        : null,
  };
}

/**
 * Sync summary of the draft in progress (no catalog needed — Home and setup show it):
 * { context, picks, total, complete, savedAt } | null.
 */
export function readSavedDraft(now = new Date()) {
  const saved = readJSON(DRAFT_KEY, null);
  if (!saved || saved.format !== DRAFT_FORMAT || saved.session?.type !== 'draft-session')
    return null;
  // A draft of a mode the game no longer has cannot be resumed.
  if (!DRAFT_TYPES.includes(saved.session.options?.mode)) return null;
  const raw = saved.session.state?.picks,
    picks = Array.isArray(raw) ? raw.flat() : [];
  // One XI or two (Versus): anything else is not a draft that could be resumed.
  if (picks.length !== 11 && picks.length !== 22) return null;
  // A Daily draft of another day is over: nothing to resume.
  const day = saved.context?.kind === 'daily' ? saved.context.daily : null;
  if (typeof day === 'string' && day !== dailyKey(now)) return null;
  return {
    context: saved.context && typeof saved.context === 'object' ? saved.context : {},
    picks: picks.filter(Boolean).length,
    total: picks.length,
    complete: picks.length > 0 && picks.every(Boolean),
    savedAt: saved.savedAt || null,
  };
}
