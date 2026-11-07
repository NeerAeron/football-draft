// Read-only views of saved progress that the Home screen shows. The RUN/DAILY screens own
// the writing side (lib/run-store.js) — keep these readers tolerant of older/partial shapes.
//
//   'football-draft-run'    World Cup Run summary (written after every match):
//      { mode: 'run', type: 'nations', stage: 'QF', record: { w, d, l }, team?: 'name',
//        status?: 'playing' | 'champion' | 'eliminated', complete?: bool, grade?: 'B+',
//        verdict?: 'Semi-final Heartbreak', stageLabel?, difficulty?, updatedAt: ISO string }
//   'football-draft-daily'  Daily Challenge record:
//      { streak: 3, best: 7, lastPlayed: 'YYYY-MM-DD' (UTC day), lastResult?: '5-1-1',
//        streakState?: { current, best, last }, results?: { [day]: entry }, current?: {…} }
//   The full run state lives in 'football-draft-run-state' (lib/run-store.js).
import { readJSON } from './storage.js';

export const RUN_KEY = 'football-draft-run';
export const DAILY_KEY = 'football-draft-daily';

export const STAGES = [
  { id: 'G1', short: '1', label: 'Group match 1' },
  { id: 'G2', short: '2', label: 'Group match 2' },
  { id: 'G3', short: '3', label: 'Group match 3' },
  { id: 'R16', short: 'R16', label: 'Round of 16' },
  { id: 'QF', short: 'QF', label: 'Quarter-final' },
  { id: 'SF', short: 'SF', label: 'Semi-final' },
  { id: 'F', short: 'F', label: 'Final' },
];

export function readSavedRun() {
  const run = readJSON(RUN_KEY, null);
  if (!run || typeof run !== 'object') return null;
  const record = run.record || {};
  const status = ['playing', 'champion', 'eliminated'].includes(run.status)
    ? run.status
    : 'playing';
  return {
    mode: run.mode || 'run',
    type: run.type || 'nations',
    stage: STAGES.some(s => s.id === run.stage) ? run.stage : 'G1',
    record: { w: record.w | 0, d: record.d | 0, l: record.l | 0 },
    team: typeof run.team === 'string' ? run.team : null,
    status,
    complete: status !== 'playing',
    grade: typeof run.grade === 'string' ? run.grade : null,
    verdict: typeof run.verdict === 'string' ? run.verdict : null,
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
  return {
    streak: alive ? daily.streak | 0 : 0,
    best: daily.best | 0,
    lastPlayed,
    playedToday: lastPlayed === today,
    lastResult: typeof daily.lastResult === 'string' ? daily.lastResult : null,
  };
}

/** Local calendar date as YYYY-MM-DD. (The daily uses UTC days: dailyKey().) */
export function todayKey(date = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
