// Daily Challenge: one seeded World Cup Run per UTC date, the same for everyone — fixed
// nation spins with one fixed alternate per round (the re-roll), fixed opponents, default
// rules. Scoring, the hindsight "perfect XI", and streak helpers. Pure: the UI passes the
// date and stores attempts/streaks itself. API guide: docs/competition-api.md.
import { DEFAULT_CONFIG } from '../config/config.js';
import { lcg } from '../util/rng.js';
import { FORMATIONS } from '../players/formations.js';
import { catalogIndex, draftRules, roleRating, isKeeper } from '../draft/pools.js';
import { seedValue } from '../draft/session.js';
import { chooseOpponent } from '../draft/opponents.js';
import { cupOffsets } from './cup.js';
import { assignRows, costMatrix } from '../util/assignment.js';

/** Daily #1. */
export const DAILY_EPOCH = '2026-11-01';
export const DAILY_RULES = {
  mode: 'nations',
  difficulty: 'pro',
  rerolls: 2,
  formations: ['433', '4231', '442', '352', '343', '4141', '41212'],
};
const DAY = 86400000;
const ID = /^(\d{4})-(\d{2})-(\d{2})$/;

/** UTC day id 'YYYY-MM-DD' of a Date, a timestamp (ms) or an id string. */
export function dailyId(date) {
  if (typeof date === 'string') {
    const m = ID.exec(date);
    const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (!d || d.toISOString().slice(0, 10) !== date) throw Error('Invalid day: ' + date);
    return date;
  }
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw Error('Invalid date');
  return d.toISOString().slice(0, 10);
}
const dayIndex = id => Date.parse(dailyId(id) + 'T00:00:00Z') / DAY;
/** Challenge number: days since DAILY_EPOCH + 1 (Daily #1 on the epoch). */
export const dailyNumber = id => dayIndex(id) - dayIndex(DAILY_EPOCH) + 1;
export const previousDay = id => new Date((dayIndex(id) - 1) * DAY).toISOString().slice(0, 10);
export const nextDay = id => new Date((dayIndex(id) + 1) * DAY).toISOString().slice(0, 10);
/** Day id of a challenge number (inverse of dailyNumber). */
export const dailyIdFromNumber = n =>
  new Date((dayIndex(DAILY_EPOCH) + n - 1) * DAY).toISOString().slice(0, 10);

const challenges = new WeakMap();
/**
 * The challenge of a day: {
 *   id, number, seed, mode, difficulty, rerolls, formation,
 *   schedule: { rounds: [{ spin, alternate }] × 11 }  (nation ids),
 *   opponents: 9 opponent keys (3 group, then R32, R16, QF, SF, final, third-place play-off),
 *   draft: options for createDraftSession, cup: options for createCupRun (add `user`) }
 * Deterministic for the date and catalog; uses DEFAULT_CONFIG draft rules, not the device's.
 */
export function dailyChallenge(catalog, date) {
  const id = dailyId(date);
  let byDay = challenges.get(catalog);
  if (!byDay) challenges.set(catalog, (byDay = new Map()));
  if (byDay.has(id)) return structuredClone(byDay.get(id));
  const rules = DEFAULT_CONFIG.draft,
    field = catalogIndex(catalog, draftRules(rules)).field,
    seed = 'daily:' + id,
    random = lcg(seedValue(seed));
  const formation = DAILY_RULES.formations[Math.floor(random() * DAILY_RULES.formations.length)];
  const rounds = Array.from({ length: 11 }, () => {
    const a = Math.floor(random() * field.length);
    let b = Math.floor(random() * (field.length - 1));
    if (b >= a) b++;
    return { spin: field[a].id, alternate: field[b].id };
  });
  const offsets = cupOffsets(DAILY_RULES.difficulty),
    opponents = [];
  for (const offset of offsets)
    opponents.push(
      chooseOpponent(catalog, {
        mode: DAILY_RULES.mode,
        level: DAILY_RULES.difficulty,
        offset,
        avoid: opponents,
        rules,
        rerolls: DAILY_RULES.rerolls,
        random,
        bosses: false,
      }).key,
    );
  const challenge = {
    id,
    number: dailyNumber(id),
    seed,
    mode: DAILY_RULES.mode,
    difficulty: DAILY_RULES.difficulty,
    rerolls: DAILY_RULES.rerolls,
    formation,
    schedule: { rounds },
    opponents,
  };
  challenge.draft = {
    mode: challenge.mode,
    seed,
    formation,
    difficulty: challenge.difficulty,
    rerolls: challenge.rerolls,
    schedule: challenge.schedule,
    useDefaultRules: true,
  };
  challenge.cup = {
    mode: challenge.mode,
    difficulty: challenge.difficulty,
    seed,
    rerolls: challenge.rerolls,
    opponents,
    daily: id,
    rules: DEFAULT_CONFIG.draft,
  };
  byDay.set(id, challenge);
  return structuredClone(challenge);
}

// ---- hindsight optimum ------------------------------------------------------------------
// The best summed rating of `roles` filled by different players of `players` (the GK role by
// keepers only), or -Infinity when they cannot all be filled (util/assignment.js).
function bestTotal(roles, players) {
  const n = roles.length,
    m = players.length;
  if (!n) return 0;
  if (m < n) return -Infinity;
  const BIG = 1e6,
    cost = costMatrix(n * m);
  for (let i = 0; i < n; i++) {
    const role = roles[i];
    for (let j = 0; j < m; j++) {
      const p = players[j];
      cost[i * m + j] = (role === 'GK') === isKeeper(p) ? -roleRating(p, role) : BIG;
    }
  }
  const owner = assignRows(cost, n, m);
  let total = 0;
  for (let j = 1; j <= m; j++)
    if (owner[j]) {
      const c = cost[(owner[j] - 1) * m + j - 1];
      if (c >= BIG / 2) return -Infinity;
      total -= c;
    }
  return total;
}
function combinations(slots, size) {
  const out = [];
  const walk = (start, mask, left) => {
    if (!left) return out.push(mask);
    for (let i = start; i < slots; i++) walk(i + 1, mask | (1 << i), left - 1);
  };
  walk(0, 0, size);
  return out;
}
// Best XI from a multiset of nations (one player per occurrence, distinct players and slots):
// exact DP over slot masks, nation by nation; within a nation an assignment per slot subset.
function bestFromNations(index, nations, roles) {
  const counts = new Map();
  for (const n of nations) counts.set(n, (counts.get(n) || 0) + 1);
  let states = new Map([[0, 0]]);
  for (const [name, c] of counts) {
    // What the draft offered: the nation's draft squad (a repeated nation offers the same
    // players again, less the ones taken).
    const squad = index.nations.get(name).squad;
    // Only the best c per role can be needed (exchange argument).
    const keep = new Set();
    for (const role of new Set(roles))
      squad
        .filter(p => (role === 'GK') === isKeeper(p))
        .sort((a, b) => roleRating(b, role) - roleRating(a, role))
        .slice(0, c)
        .forEach(p => keep.add(p));
    const candidates = [...keep],
      value = new Map();
    for (const mask of combinations(roles.length, c)) {
      const slots = roles.flatMap((r, i) => (mask & (1 << i) ? [r] : []));
      value.set(mask, bestTotal(slots, candidates));
    }
    const next = new Map();
    for (const [mask, total] of states)
      for (const [subset, v] of value) {
        if (mask & subset || v === -Infinity) continue;
        const key = mask | subset,
          sum = total + v;
        if (!(next.get(key) >= sum)) next.set(key, sum);
      }
    states = next;
  }
  return states.get((1 << roles.length) - 1) ?? -Infinity;
}
/**
 * The hindsight optimum ("perfect XI") of a day's spins: the best team rating one player per
 * round could reach, using a round's alternate in at most `rerolls` rounds, from the draft
 * squads of those nations. { rating, alternates: rounds that used theirs }.
 */
export function perfectXI(catalog, challenge, { formation = challenge.formation } = {}) {
  const rules = DEFAULT_CONFIG.draft,
    index = catalogIndex(catalog, draftRules(rules)),
    roles = FORMATIONS[formation].map(r => r[2]),
    rounds = challenge.schedule.rounds;
  let best = { total: -Infinity, alternates: [] };
  const consider = alternates => {
    const nations = rounds.map((r, i) => (alternates.includes(i) ? r.alternate : r.spin)),
      total = bestFromNations(index, nations, roles);
    if (total > best.total + 1e-9) best = { total, alternates };
  };
  consider([]);
  for (let i = 0; i < rounds.length && challenge.rerolls >= 1; i++) {
    consider([i]);
    if (challenge.rerolls >= 2) for (let j = i + 1; j < rounds.length; j++) consider([i, j]);
  }
  return {
    rating: Math.round((best.total / 11) * 100) / 100,
    alternates: best.alternates,
    formation,
  };
}
/** % of the perfect XI: your team rating / the optimum, capped at 100. */
export function perfectPercent(rating, optimum) {
  return Math.min(
    100,
    Math.round((rating / Math.max(rating, optimum.rating ?? optimum)) * 1000) / 10,
  );
}

// ---- scoring ----------------------------------------------------------------------------
export const DAILY_POINTS = {
  win: 100,
  draw: 40,
  shootoutWin: 20,
  // By place: out in a round, fourth / third (the play-off), runners-up, champions.
  stage: { group: 0, r32: 10, r16: 20, qf: 40, fourth: 80, third: 100, final: 120, champion: 200 },
  ovrFrom: 70,
  perOvrPoint: 10,
  perfectFrom: 80,
  perPerfectPoint: 10,
};
/**
 * Points for a finished daily run: matches (W 100, D 40, +20 per shootout won), stage bonus
 * (the place: R32 10, R16 20, QF 40, fourth 80, third 100, runners-up 120, champions 200), team OVR (10 per point above 70) and perfection (10 per % above 80).
 * `snapshot` = CupRun.snapshot(); rating = team OVR; perfect = perfectPercent().
 */
export function dailyScore(snapshot, { rating, perfect }) {
  const P = DAILY_POINTS;
  const matches = snapshot.rounds
    .filter(r => r.result)
    .reduce(
      (s, r) =>
        s +
        (r.result.outcome === 'W' ? P.win : r.result.outcome === 'D' ? P.draw : 0) +
        (r.result.shootout?.winner === 'user' ? P.shootoutWin : 0),
      0,
    );
  const parts = {
    matches,
    stage: P.stage[snapshot.place ?? snapshot.stage] ?? 0,
    ovr: Math.round(Math.max(0, rating - P.ovrFrom) * P.perOvrPoint),
    perfection: Math.round(Math.max(0, perfect - P.perfectFrom) * P.perPerfectPoint),
  };
  return { total: parts.matches + parts.stage + parts.ovr + parts.perfection, ...parts };
}

// ---- attempts and streaks (pure; the UI stores the objects) -----------------------------
/** One attempt per day: true unless the last played day is today. */
export const canPlayDaily = (lastPlayedId, todayId) => lastPlayedId !== dailyId(todayId);
/** Record a played day: { current, best, last } (consecutive days extend the streak). */
export function updateStreak(streak, dayId) {
  const s = { current: 0, best: 0, last: null, ...streak },
    today = dailyId(dayId);
  if (s.last === today) return s;
  const current = s.last === previousDay(today) ? s.current + 1 : 1;
  return { current, best: Math.max(s.best, current), last: today };
}
/** The streak to show today: alive if the last played day is today or yesterday, else 0. */
export function currentStreak(streak, todayId) {
  const today = dailyId(todayId);
  return streak?.last === today || streak?.last === previousDay(today) ? streak.current : 0;
}
