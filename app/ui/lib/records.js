// Lifetime records of finished World Cup Runs ('football-draft-records'): the trophy cabinet
// on Home. Per difficulty the medals (gold, silver, bronze), perfect runs and the best finish;
// Budget-mode runs are kept in a cabinet of their own; and the ultimate achievement — a perfect
// Legendary run in Budget mode — has its own slot. run-store's saveRun() records every finished
// run once.
// No core imports: Home loads this on the first screen (LEVELS and PLACES mirror core's
// DIFFICULTIES / DIFFICULTY_LABELS and cup.js PLACES / PLACE_LABELS, ULTIMATE mirrors share.js;
// tests/run-ui-store.test.mjs keeps them in step).
//
//   { format: 3,
//     levels: { pro: { runs, gold, silver, bronze, perfect, best }, worldclass, legendary },
//     budget: { pro: { … }, … },             the same tallies for runs played in Budget mode
//     ultimate: { count, first: ISO date },  perfect Legendary runs in Budget mode
//     seen: [run ids already counted, newest last],
//     last: { id, level, budget, news: ['title' | 'perfect' | 'best' | 'cabinet' | 'ultimate'] } }
//   best: index into PLACES of the best finish (0 group stage … 7 champions); 0 before a run.
import { readJSON, writeJSON } from './storage.js';

export const RECORDS_KEY = 'football-draft-records';
// Format 3: places and medals instead of the furthest round, three difficulties, the Budget
// cabinet and the ultimate achievement. Formats 1 and 2 migrate when read (see migrate()).
export const RECORDS_FORMAT = 3;
/** Easiest first. Legendary is the main challenge: the cabinet's centrepiece. */
export const LEVELS = [
  { id: 'pro', label: 'Pro' },
  { id: 'worldclass', label: 'World Class' },
  { id: 'legendary', label: 'Legendary' },
];
/** Where a run can finish, worst to best (core cup.js PLACES). */
export const PLACES = [
  { id: 'group', label: 'Group stage', short: 'Group' },
  { id: 'r32', label: 'Round of 32', short: 'R32' },
  { id: 'r16', label: 'Round of 16', short: 'R16' },
  { id: 'qf', label: 'Quarter-finals', short: 'QF' },
  { id: 'fourth', label: 'Fourth place', short: '4th' },
  { id: 'third', label: 'Third place', short: '3rd', medal: 'bronze' },
  { id: 'final', label: 'Runners-up', short: '2nd', medal: 'silver' },
  { id: 'champion', label: 'Champions', short: 'Won', medal: 'gold' },
];
const placeIndex = id => PLACES.findIndex(p => p.id === id);
/** `best` of a level whose cup has been won. */
export const CHAMPION = PLACES.length - 1;
/** Wins of a perfect run. */
export const PERFECT_WINS = 8;
/** The ultimate achievement (core share.js ULTIMATE): Legendary + Budget mode + 8–0. */
export const ULTIMATE = {
  name: 'Immortals',
  level: 'legendary',
  requirement: 'Win the World Cup on Legendary in Budget mode with eight wins out of eight.',
};
const SEEN_LIMIT = 24;
const NEWS = ['title', 'perfect', 'best', 'cabinet', 'ultimate'];

const count = value => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
const tallyOf = raw => {
  const gold = count(raw?.gold),
    silver = count(raw?.silver),
    bronze = count(raw?.bronze);
  // The medals imply a best finish, whatever `best` says.
  const floor = gold ? CHAMPION : silver ? CHAMPION - 1 : bronze ? CHAMPION - 2 : 0;
  return {
    runs: Math.max(count(raw?.runs), gold + silver + bronze),
    gold,
    silver,
    bronze,
    perfect: Math.min(count(raw?.perfect), gold),
    best: Math.max(floor, Math.min(count(raw?.best), gold ? CHAMPION : CHAMPION - 1)),
  };
};
// A level of format 1 or 2 → format 3. Their `best` was the furthest round: 0–2 group, then
// (format 2) 3 R32, 4 R16, 5 QF, 6 SF, 7 final, 8 = won; format 1 had no Round of 32, so its
// knockout rounds sit one lower. Titles become golds and perfect runs carry over; a lost final
// is a silver; there was no play-off, so a lost semi-final reads as fourth place.
function migrateLevel(raw, format) {
  const titles = count(raw?.titles);
  let round = count(raw?.best);
  if (format === 1 && round >= 3) round += 1;
  const best = titles
    ? CHAMPION
    : round >= 7
      ? placeIndex('final')
      : round === 6
        ? placeIndex('fourth')
        : Math.max(0, round - 2);
  return {
    runs: raw?.runs,
    gold: titles,
    silver: !titles && best === placeIndex('final') ? 1 : 0,
    bronze: 0,
    perfect: raw?.perfect,
    best,
  };
}

/** The stored records, whatever is in storage (missing, older or broken data reads as empty). */
function load() {
  const raw = readJSON(RECORDS_KEY, null),
    data = raw && typeof raw === 'object' ? raw : {},
    old = data.format === 1 || data.format === 2,
    known = old || data.format === RECORDS_FORMAT;
  const levels = {},
    budget = {};
  // Only today's difficulties are read: entries of the removed ones (Amateur, Semi-pro) go.
  for (const { id } of LEVELS) {
    const level = known ? data.levels?.[id] : null;
    levels[id] = tallyOf(old ? migrateLevel(level, data.format) : level);
    budget[id] = tallyOf(known && !old ? data.budget?.[id] : null);
  }
  const last = known ? data.last : null,
    ultimate = known && !old ? data.ultimate : null;
  return {
    levels,
    budget,
    ultimate: {
      count: Math.min(count(ultimate?.count), budget[ULTIMATE.level].perfect),
      first: typeof ultimate?.first === 'string' ? ultimate.first : null,
    },
    seen: known && Array.isArray(data.seen) ? data.seen.filter(id => typeof id === 'string') : [],
    last:
      last && typeof last.id === 'string' && Array.isArray(last.news)
        ? {
            id: last.id,
            level: LEVELS.some(l => l.id === last.level) ? last.level : null,
            budget: !!last.budget,
            news: last.news.filter(n => NEWS.includes(n)),
          }
        : null,
  };
}

/** A tally's best finish: 'Champions', 'Runners-up', 'Third place', … ('' before a run). */
export const bestLabel = tally => (tally.runs ? PLACES[tally.best].label : '');
const view = tally => ({
  ...tally,
  /** Golds: the titles on this level. */
  titles: tally.gold,
  bestLabel: bestLabel(tally),
  bestShort: tally.runs ? PLACES[tally.best].short : '',
  // The best medal won: 'gold' | 'silver' | 'bronze' | null.
  medal: tally.runs ? (PLACES[tally.best].medal ?? null) : null,
});

/**
 * What Home shows: totals and one entry per difficulty, easiest first.
 * { runs, titles, perfect, won (levels with a title), medals: { gold, silver, bronze },
 *   levels: [{ id, label, runs, gold, silver, bronze, titles, perfect, best, bestLabel,
 *              bestShort, medal, budget: { the same for Budget-mode runs } }],
 *   ultimate: { name, requirement, done, count, first }, last }
 * Totals count both cabinets; `won` counts standard titles (the cabinet's "n / 3").
 */
export function readRecords() {
  const { levels, budget, ultimate, last } = load();
  const list = LEVELS.map(({ id, label }) => ({
    id,
    label,
    ...view(levels[id]),
    budget: view(budget[id]),
  }));
  const sum = key => list.reduce((total, level) => total + level[key] + level.budget[key], 0);
  return {
    runs: sum('runs'),
    titles: sum('gold'),
    perfect: sum('perfect'),
    medals: { gold: sum('gold'), silver: sum('silver'), bronze: sum('bronze') },
    won: list.filter(level => level.gold > 0).length,
    budgetRuns: list.reduce((total, level) => total + level.budget.runs, 0),
    levels: list,
    ultimate: {
      name: ULTIMATE.name,
      requirement: ULTIMATE.requirement,
      done: ultimate.count > 0,
      count: ultimate.count,
      first: ultimate.first,
    },
    last,
  };
}

/**
 * Count a finished run (Home's summary of it, see run-store runSummary) once; a run with
 * `budget: true` goes into the Budget cabinet. Returns what is new about it — 'title' (first
 * cup on this difficulty in its cabinet), 'perfect' (first eight wins out of eight on it),
 * 'best' (a better finish than ever on it), 'cabinet' (that was the last missing cup of the
 * standard cabinet), 'ultimate' (the first perfect Legendary run in Budget mode) — or null when
 * the run is unfinished, unknown or already counted.
 */
export function recordRun(summary, id, { now = Date.now() } = {}) {
  if (!summary?.complete || typeof id !== 'string' || !id) return null;
  if (!LEVELS.some(l => l.id === summary.difficulty)) return null;
  const data = load();
  if (data.seen.includes(id)) return null;
  const isBudget = summary.budget === true,
    level = (isBudget ? data.budget : data.levels)[summary.difficulty],
    champion = summary.status === 'champion',
    perfect = champion && count(summary.record?.w) >= PERFECT_WINS,
    reached = champion ? CHAMPION : Math.max(0, Math.min(CHAMPION - 1, placeIndex(summary.place))),
    medal = PLACES[reached].medal;
  const news = [];
  if (champion && !level.gold) news.push('title');
  if (perfect && !level.perfect) news.push('perfect');
  if (!champion && level.runs > 0 && reached > level.best) news.push('best');
  level.runs += 1;
  if (medal) level[medal] += 1;
  if (perfect) level.perfect += 1;
  level.best = Math.max(level.best, reached);
  if (!isBudget && news.includes('title') && LEVELS.every(l => data.levels[l.id].gold > 0))
    news.push('cabinet');
  if (isBudget && perfect && summary.difficulty === ULTIMATE.level) {
    if (!data.ultimate.count) {
      news.push('ultimate');
      data.ultimate.first = new Date(now).toISOString();
    }
    data.ultimate.count += 1;
  }
  writeJSON(RECORDS_KEY, {
    format: RECORDS_FORMAT,
    levels: data.levels,
    budget: data.budget,
    ultimate: data.ultimate,
    seen: [...data.seen, id].slice(-SEEN_LIMIT),
    last: { id, level: summary.difficulty, budget: isBudget, news },
  });
  return news;
}

/** What was new about run `id` when it finished ([] when nothing, or it was not the last). */
export function runNews(id) {
  const { last } = load();
  return last && last.id === id
    ? { level: last.level, budget: last.budget, news: last.news }
    : { level: null, budget: false, news: [] };
}
