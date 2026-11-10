// Lifetime records of finished World Cup Runs ('football-draft-records'): the trophy cabinet
// on Home, one trophy per difficulty. run-store's saveRun() records every finished run once.
// No core imports: Home loads this on the first screen (LEVELS mirrors core's DIFFICULTIES and
// DIFFICULTY_LABELS; tests/run-ui-store.test.mjs keeps them in step).
//
//   { format: 2, runs, titles, perfect,
//     levels: { pro: { runs, titles, perfect, best } },   best: furthest round, 0–7 (8 = won)
//     seen: [run ids already counted, newest last],
//     last: { id, level, news: ['title' | 'perfect' | 'best' | 'cabinet'] } }
import { readJSON, writeJSON } from './storage.js';
import { STAGES } from './saved.js';

export const RECORDS_KEY = 'football-draft-records';
// Format 2 added the Round of 32 (round 3): a format-1 `best` of 3 (Round of 16) or more moves
// up by one when read, so an old Round of 16 stays a Round of 16 and an old title a title.
export const RECORDS_FORMAT = 2;
export const LEVELS = [
  { id: 'amateur', label: 'Amateur' },
  { id: 'semipro', label: 'Semi-pro' },
  { id: 'pro', label: 'Pro' },
  { id: 'worldclass', label: 'World Class' },
  { id: 'legendary', label: 'Legendary' },
];
/** `best` of a level whose cup has been won. */
export const CHAMPION = STAGES.length;
const SEEN_LIMIT = 24;
const NEWS = ['title', 'perfect', 'best', 'cabinet'];

const count = value => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
const levelOf = raw => {
  const titles = count(raw?.titles);
  return {
    runs: Math.max(count(raw?.runs), titles),
    titles,
    perfect: Math.min(count(raw?.perfect), titles),
    best: titles ? CHAMPION : Math.min(count(raw?.best), CHAMPION - 1),
  };
};

/** The stored records, whatever is in storage (missing, older or broken data reads as empty). */
function load() {
  const raw = readJSON(RECORDS_KEY, null);
  const old = raw && typeof raw === 'object' && raw.format === 1;
  const data = raw && typeof raw === 'object' && (raw.format === RECORDS_FORMAT || old) ? raw : {};
  const levels = {};
  for (const { id } of LEVELS) {
    const level = data.levels?.[id];
    levels[id] = levelOf(old && level?.best >= 3 ? { ...level, best: level.best + 1 } : level);
  }
  const last = data.last;
  return {
    levels,
    seen: Array.isArray(data.seen) ? data.seen.filter(id => typeof id === 'string') : [],
    last:
      last && typeof last.id === 'string' && Array.isArray(last.news)
        ? {
            id: last.id,
            level: LEVELS.some(l => l.id === last.level) ? last.level : null,
            news: last.news.filter(n => NEWS.includes(n)),
          }
        : null,
  };
}

/** How far a level's best run went: 'Final', 'Semi-final', … ('' before the first run). */
export const bestLabel = level =>
  !level.runs
    ? ''
    : level.best >= CHAMPION
      ? 'Champions'
      : level.best < 3
        ? 'Group stage'
        : STAGES[level.best].label;
const bestShort = level =>
  !level.runs
    ? ''
    : level.best >= CHAMPION
      ? 'Won'
      : level.best < 3
        ? 'Group'
        : level.best === CHAMPION - 1
          ? 'Final'
          : STAGES[level.best].short;

/**
 * What Home shows: totals and one entry per difficulty, easiest first.
 * { runs, titles, perfect, won (levels with a title), levels: [{ id, label, runs, titles,
 *   perfect, best, bestLabel, bestShort }], last }
 */
export function readRecords() {
  const { levels, last } = load();
  const list = LEVELS.map(({ id, label }) => ({
    id,
    label,
    ...levels[id],
    bestLabel: bestLabel(levels[id]),
    bestShort: bestShort(levels[id]),
  }));
  const sum = key => list.reduce((total, level) => total + level[key], 0);
  return {
    runs: sum('runs'),
    titles: sum('titles'),
    perfect: sum('perfect'),
    won: list.filter(level => level.titles > 0).length,
    levels: list,
    last,
  };
}

/**
 * Count a finished run (Home's summary of it, see run-store runSummary) once. Returns what is
 * new about it — 'title' (first cup on this difficulty), 'perfect' (first eight wins out of
 * eight on it), 'best' (went further than ever on it), 'cabinet' (that was the last missing
 * cup) — or null when the run is unfinished, unknown or already counted.
 */
export function recordRun(summary, id) {
  if (!summary?.complete || typeof id !== 'string' || !id) return null;
  if (!LEVELS.some(l => l.id === summary.difficulty)) return null;
  const data = load();
  if (data.seen.includes(id)) return null;
  const level = data.levels[summary.difficulty],
    champion = summary.status === 'champion',
    perfect = champion && count(summary.record?.w) >= STAGES.length,
    reached = champion
      ? CHAMPION
      : Math.max(
          0,
          STAGES.findIndex(s => s.id === summary.stage),
        );
  const news = [];
  if (champion && !level.titles) news.push('title');
  if (perfect && !level.perfect) news.push('perfect');
  if (!champion && level.runs > 0 && reached > level.best) news.push('best');
  level.runs += 1;
  if (champion) level.titles += 1;
  if (perfect) level.perfect += 1;
  level.best = Math.max(level.best, reached);
  if (news.includes('title') && LEVELS.every(l => data.levels[l.id].titles > 0))
    news.push('cabinet');
  writeJSON(RECORDS_KEY, {
    format: RECORDS_FORMAT,
    levels: data.levels,
    seen: [...data.seen, id].slice(-SEEN_LIMIT),
    last: { id, level: summary.difficulty, news },
  });
  return news;
}

/** What was new about run `id` when it finished ([] when nothing, or it was not the last). */
export function runNews(id) {
  const { last } = load();
  return last && last.id === id
    ? { level: last.level, news: last.news }
    : { level: null, news: [] };
}
