// Read-only views of saved progress that the Home screen shows. The RUN/DAILY screens own
// the writing side and may change the shape — keep these readers tolerant.
//
//   'football-draft-run'    in-progress World Cup Run (or other run) summary:
//      { mode: 'run', type: 'nations', stage: 'QF', record: { w, d, l }, team?: 'name',
//        updatedAt: ISO string }
//   'football-draft-daily'  daily challenge status:
//      { streak: 3, best: 7, lastPlayed: 'YYYY-MM-DD', lastResult?: '5-1-1' }
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
  return {
    mode: run.mode || 'run',
    type: run.type || 'nations',
    stage: STAGES.some(s => s.id === run.stage) ? run.stage : 'G1',
    record: { w: record.w | 0, d: record.d | 0, l: record.l | 0 },
    team: typeof run.team === 'string' ? run.team : null,
    updatedAt: run.updatedAt || null,
  };
}

export function readDailyStatus() {
  const daily = readJSON(DAILY_KEY, null) || {};
  return {
    streak: daily.streak | 0,
    best: daily.best | 0,
    lastPlayed: typeof daily.lastPlayed === 'string' ? daily.lastPlayed : null,
    lastResult: typeof daily.lastResult === 'string' ? daily.lastResult : null,
  };
}

/** Local calendar date as YYYY-MM-DD (the daily seed's date). */
export function todayKey(date = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
