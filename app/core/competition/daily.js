// Daily Challenge: one seeded World Cup Run per UTC date, the same for everyone — a fixed era
// and nation per round, with what a nation respin and an era respin land on fixed too, fixed
// opponents, default rules. Scoring, the hindsight "perfect XI", and streak helpers. Pure: the UI passes the
// date and stores attempts/streaks itself. API guide: docs/competition-api.md.
import { DEFAULT_CONFIG } from '../config/config.js';
import { lcg } from '../util/rng.js';
import { FORMATIONS } from '../players/formations.js';
import { roleRating, isKeeper } from '../draft/pools.js';
import { eraList, eraPool, bestVersion } from '../players/eras.js';
import { seedValue } from '../draft/session.js';
import { chooseOpponent } from '../draft/opponents.js';
import { cupOffsets } from './cup.js';

/** Daily #1. */
export const DAILY_EPOCH = '2026-11-01';
export const DAILY_RULES = {
  mode: 'nations',
  difficulty: 'pro',
  // The column of the ladder's baselines the day's opponents are drawn against (opponents.js).
  ladderRerolls: 2,
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
 *   id, number, seed, mode, difficulty, tokens: { nation, era, prime }, formation,
 *   schedule: { rounds: [{ era, spin, alternate, eraAlternate: { era, nation } }] × 11 }
 *     (era ids and nation names: the round's spin, the nation a nation respin lands on, and
 *     where an era respin lands — its nation only when the round's nation is not in that era),
 *   opponents: 9 opponent keys (3 group, then R32, R16, QF, SF, final, third-place play-off),
 *   draft: options for createDraftSession, cup: options for createCupRun (add `user`) }
 * Deterministic for the date and catalog (which needs its era pools: catalog.eras); uses
 * DEFAULT_CONFIG draft rules, not the device's.
 */
export function dailyChallenge(catalog, date) {
  const id = dailyId(date);
  let byDay = challenges.get(catalog);
  if (!byDay) challenges.set(catalog, (byDay = new Map()));
  if (byDay.has(id)) return structuredClone(byDay.get(id));
  const rules = DEFAULT_CONFIG.draft,
    eras = eraList(catalog),
    seed = 'daily:' + id,
    random = lcg(seedValue(seed));
  if (!eras.length) throw Error('The Daily needs the era data (catalog.eras)');
  const formation = DAILY_RULES.formations[Math.floor(random() * DAILY_RULES.formations.length)];
  // One of `n` at random, and another one that is not `a`.
  const one = n => Math.floor(random() * n),
    other = (n, a) => {
      const b = Math.floor(random() * (n - 1));
      return b >= a ? b + 1 : b;
    };
  const rounds = Array.from({ length: 11 }, () => {
    const e = one(eras.length),
      era = eras[e],
      n = one(era.nations.length),
      nation = era.nations[n].name,
      next = eras[other(eras.length, e)],
      // Drawn every time, so a round always takes the same number of draws.
      drawn = next.nations[one(next.nations.length)].name;
    return {
      era: era.id,
      spin: nation,
      alternate: era.nations[other(era.nations.length, n)].name,
      eraAlternate: {
        era: next.id,
        nation: next.nations.some(x => x.name === nation) ? nation : drawn,
      },
    };
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
        rerolls: DAILY_RULES.ladderRerolls,
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
    tokens: { ...rules.tokens },
    formation,
    schedule: { rounds },
    opponents,
  };
  challenge.draft = {
    mode: challenge.mode,
    seed,
    formation,
    difficulty: challenge.difficulty,
    eras: true,
    primes: true,
    schedule: challenge.schedule,
    useDefaultRules: true,
  };
  challenge.cup = {
    mode: challenge.mode,
    difficulty: challenge.difficulty,
    seed,
    rerolls: DAILY_RULES.ladderRerolls,
    opponents,
    daily: id,
    rules: DEFAULT_CONFIG.draft,
  };
  byDay.set(id, challenge);
  return structuredClone(challenge);
}

// ---- hindsight optimum ------------------------------------------------------------------
// What a round's pool can give each slot: `base[i]` the best rating of one of its players in
// role i, `prime[i]` the same when the Prime is spent on him (his best version, when that is
// better there). Cached per pool and formation roles.
const values = new WeakMap();
function poolValues(catalog, pool, roles) {
  let byRoles = values.get(pool);
  if (!byRoles) values.set(pool, (byRoles = new Map()));
  const key = roles.join(',');
  let v = byRoles.get(key);
  if (v) return v;
  const base = new Float64Array(roles.length).fill(-Infinity),
    prime = new Float64Array(roles.length).fill(-Infinity),
    best = pool.map(p => bestVersion(catalog, p));
  roles.forEach((role, i) => {
    pool.forEach((p, j) => {
      if ((role === 'GK') !== isKeeper(p)) return;
      const r = roleRating(p, role),
        q = best[j] ? Math.max(r, roleRating(best[j], role)) : r;
      if (r > base[i]) base[i] = r;
      if (q > prime[i]) prime[i] = q;
    });
  });
  byRoles.set(key, (v = { base, prime }));
  return v;
}
// Best summed slot rating of one player per pool in different slots, with at most `primes`
// (0 or 1) Prime spent: a DP over slot masks, pool by pool. Pools of one nation in two eras
// can hold the same man; the optimum may count him twice (an upper bound, rarely reached).
function bestFromPools(catalog, pools, roles, primes) {
  const n = roles.length,
    full = 1 << n,
    flags = primes > 0 ? 2 : 1;
  let states = new Float64Array(full * flags).fill(-Infinity);
  states[0] = 0;
  for (const pool of pools) {
    const { base, prime } = poolValues(catalog, pool, roles),
      next = new Float64Array(full * flags).fill(-Infinity);
    for (let mask = 0; mask < full; mask++)
      for (let f = 0; f < flags; f++) {
        const total = states[mask * flags + f];
        if (total === -Infinity) continue;
        for (let i = 0; i < n; i++) {
          if (mask & (1 << i)) continue;
          const to = (mask | (1 << i)) * flags;
          if (total + base[i] > next[to + f]) next[to + f] = total + base[i];
          if (f === 0 && flags === 2 && total + prime[i] > next[to + 1])
            next[to + 1] = total + prime[i];
        }
      }
    states = next;
  }
  let best = -Infinity;
  for (let f = 0; f < flags; f++) best = Math.max(best, states[(full - 1) * flags + f]);
  return best;
}
/**
 * The hindsight optimum ("perfect XI") of a day's spins: the best team rating one player per
 * round could reach, with the day's tokens — the nation respin in at most one round, the era
 * respin in at most one other round, the Prime on one player — from the era pools those spins
 * land on. { rating, alternates: rounds that used the nation respin, eras: rounds that used
 * the era respin, formation }.
 */
export function perfectXI(catalog, challenge, { formation = challenge.formation } = {}) {
  const roles = FORMATIONS[formation].map(r => r[2]),
    rounds = challenge.schedule.rounds,
    tokens = challenge.tokens ?? {},
    pool = (era, nation) => eraPool(catalog, era, nation),
    main = rounds.map(r => pool(r.era, r.spin)),
    nationAlt = rounds.map(r => pool(r.era, r.alternate)),
    eraAlt = rounds.map(r => pool(r.eraAlternate.era, r.eraAlternate.nation));
  let best = { total: -Infinity, alternates: [], eras: [] };
  const consider = (alternates, eras) => {
    const pools = main.map((p, i) =>
        alternates.includes(i) ? nationAlt[i] : eras.includes(i) ? eraAlt[i] : p,
      ),
      total = bestFromPools(catalog, pools, roles, tokens.prime ?? 0);
    if (total > best.total + 1e-9) best = { total, alternates, eras };
  };
  const nations = tokens.nation >= 1 ? rounds.map((_, i) => [i]) : [],
    erasUsed = tokens.era >= 1 ? rounds.map((_, i) => [i]) : [];
  for (const a of [[], ...nations])
    for (const e of [[], ...erasUsed]) if (!a.length || a[0] !== e[0]) consider(a, e);
  return {
    rating: Math.round((best.total / 11) * 100) / 100,
    alternates: best.alternates,
    eras: best.eras,
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
