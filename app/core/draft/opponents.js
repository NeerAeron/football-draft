// Opponents and the difficulty ladder. A level is a target *effective* rating (team OVR + mean
// link chem) relative to the typical XI the player drafts in that mode (MODE_BASELINES,
// measured by tools/calibration/draft-baselines.mjs). Real club and national XIs are fully
// linked (+1 chem or more), so they are matched on effective rating, not raw OVR.
// Candidates: national best XIs (Nations), club XIs (Leagues, Clubs), both (Club & Country),
// plus two bosses: the World XI (best XI in the catalog) and the All-Stars (the best XI
// without the World XI players). Deterministic for a seed.
import { CONFIG } from '../config/config.js';
import { lcg } from '../util/rng.js';
import {
  catalogIndex,
  bestEleven,
  lineupRating,
  refreshRatings,
  naturalRating,
  isKeeper,
  catalogIndexSteps,
} from './pools.js';
import { clubSquads, clubLineupStamp } from '../players/club-lineups.js';
import { teamLinks } from './links.js';
import { buildSide, seedValue, DIFFICULTIES, DIFFICULTY_LABELS } from './session.js';

/**
 * Typical drafted XI per mode: solo, positional policy (best slot rating), smart re-roll below
 * 78, formations 4-3-3/4-2-3-1/4-4-2/3-5-2/3-4-3, 300 drafts per cell (240 for Club & Country),
 * v3 catalog (15,378 players). `effective[r]` = OVR + chem (the mates boosts) with r
 * re-rolls (0, 1, 2).
 */
export const MODE_BASELINES = {
  nations: { ovr: 83.72, sd: 1.16, chem: 0.88, effective: [84.07, 84.6, 84.95] },
  leagues: { ovr: 82.33, sd: 1.93, chem: 1.45, effective: [82.97, 83.78, 84.44] },
  clubs: { ovr: 78.49, sd: 1.93, chem: 0.7, effective: [78.64, 79.18, 79.59] },
  clubAndCountry: { ovr: 82.3, sd: 1.46, chem: 0.41, effective: [82.17, 82.71, 83.24] },
};
export const LEVELS = DIFFICULTIES.map(id => ({ id, label: DIFFICULTY_LABELS[id] }));
const KINDS_BY_MODE = {
  nations: ['nation', 'boss'],
  leagues: ['club', 'boss'],
  clubs: ['club', 'boss'],
  clubAndCountry: ['nation', 'club', 'boss'],
};
export const BOSSES = {
  'world-xi': { name: 'World XI', color: '#d2ae53', secondary: '#0b1426' },
  'all-stars': { name: 'All-Stars', color: '#f4f1e9', secondary: '#d2ae53' },
};
const BOSS_FIT = 0.99;
const round2 = x => Math.round(x * 100) / 100;

/** Effective target rating for a mode, level and round offset (rules: a session's rules). */
export function ladderTarget(mode, level, { offset = 0, rules = CONFIG.draft, rerolls } = {}) {
  const base = MODE_BASELINES[mode];
  if (!base) throw Error('Unknown draft mode: ' + mode);
  if (!(level in rules.ladder)) throw Error('Unknown difficulty: ' + level);
  const r = Math.max(0, Math.min(2, rerolls ?? rules.rerolls[level]));
  return round2(base.effective[r] + rules.ladder[level] + offset);
}

// ---- candidates ---------------------------------------------------------------------------
const candidateCache = new WeakMap();
function bossPools(index) {
  // The world's best 120 outfield players and 12 keepers by natural rating cover every slot.
  const sorted = [...index.players].sort((a, b) => naturalRating(b) - naturalRating(a));
  return [
    ...sorted.filter(p => !isKeeper(p)).slice(0, 120),
    ...sorted.filter(isKeeper).slice(0, 12),
  ];
}
function bossXI(index, id, exclude = new Set()) {
  const pool = bossPools(index).filter(p => !exclude.has(p.profileId));
  const world = bestEleven(pool, { minimumFit: BOSS_FIT });
  if (id === 'world-xi' || !world) return world;
  const taken = new Set(world.players.map(p => p.profileId));
  return bestEleven(
    pool.filter(p => !taken.has(p.profileId)),
    { minimumFit: BOSS_FIT },
  );
}
function groupPlayers(index, kind, id) {
  if (kind === 'nation') return index.nations.get(id)?.players || [];
  if (kind === 'club') return index.clubs.get(id)?.players || [];
  return [];
}
function xiFor(index, kind, id, exclude) {
  if (kind === 'boss') return bossXI(index, id, exclude);
  const players = groupPlayers(index, kind, id).filter(p => !exclude.has(p.profileId));
  return players.length >= 11 && players.some(isKeeper) ? bestEleven(players) : null;
}
/**
 * Every opponent with a complete XI, with its nominal (unweakened) rating:
 * [{ key, kind, id, name, code, color, secondary, formation, rating, chem, effective }].
 * Cached per catalog, ratings and link rules.
 */
export function opponentCandidates(catalog, options) {
  const steps = opponentCandidatesSteps(catalog, options);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}
/**
 * The same list, built in steps (a few teams per step) so a UI can spread the work over
 * frames: call next() until done. The finished list is what opponentCandidates() returns.
 */
export function* opponentCandidatesSteps(catalog, { rules = CONFIG.draft } = {}) {
  const stamp = refreshRatings() + JSON.stringify([rules.links, CONFIG.ai.minimumFit]);
  const cached = candidateCache.get(catalog);
  if (cached?.stamp === stamp) return cached.list;
  const index = yield* catalogIndexSteps(catalog),
    list = [];
  const add = (kind, id, meta, xi) => {
    if (!xi) return;
    const chem = teamLinks(xi.players, rules.links).chem;
    list.push({
      key: `${kind}:${id}`,
      kind,
      id,
      ...meta,
      formation: xi.formation,
      rating: round2(xi.rating),
      chem: round2(chem),
      effective: round2(xi.rating + chem),
    });
  };
  const none = new Set();
  // Every playable nation (an XI with a real keeper and nobody out of position).
  for (const n of index.playable) {
    add(
      'nation',
      n.id,
      { name: n.name, code: n.code, flag: n.flag, color: null, secondary: null },
      xiFor(index, 'nation', n.id, none),
    );
    yield;
  }
  // Club XIs: the catalog's precomputed best lineups when they match the live configuration
  // (same assignment and tie-break as bestEleven), otherwise computed here (~0.3 s).
  const squads =
    catalog.precomputed?.lineups === clubLineupStamp()
      ? new Map(clubSquads(catalog).map(s => [String(s.id), s]))
      : null;
  let clubs = 0;
  for (const c of index.clubs.values()) {
    const pre = squads?.get(c.id);
    if (pre?.bestFormation) {
      const players = pre.lineups[pre.bestFormation];
      add(
        'club',
        c.id,
        {
          name: c.name,
          code: null,
          flag: null,
          color: c.primary,
          secondary: c.secondary,
          leagueId: c.leagueId,
        },
        { formation: pre.bestFormation, players, rating: lineupRating(players, pre.bestFormation) },
      );
    } else if (c.players.length >= 11 && c.goalkeepers >= 1)
      add(
        'club',
        c.id,
        {
          name: c.name,
          code: null,
          flag: null,
          color: c.primary,
          secondary: c.secondary,
          leagueId: c.leagueId,
        },
        xiFor(index, 'club', c.id, none),
      );
    if (++clubs % 12 === 0) yield;
  }
  for (const [id, b] of Object.entries(BOSSES))
    add(
      'boss',
      id,
      { name: b.name, code: null, flag: null, color: b.color, secondary: b.secondary },
      bossXI(index, id),
    );
  list.sort((a, b) => b.effective - a.effective || (a.key < b.key ? -1 : 1));
  // Someone needed it synchronously meanwhile: keep theirs, so there is one list.
  const raced = candidateCache.get(catalog);
  if (raced?.stamp === stamp) return raced.list;
  candidateCache.set(catalog, { stamp, list });
  return list;
}

/**
 * Candidates for a draft mode (nations / clubs / both, plus the bosses unless `bosses` is
 * false: the World Cup Run and the Daily meet real teams only).
 */
export function modeCandidates(catalog, mode, { bosses = true, ...options } = {}) {
  const kinds = KINDS_BY_MODE[mode];
  if (!kinds) throw Error('Unknown draft mode: ' + mode);
  return opponentCandidates(catalog, options).filter(
    c => kinds.includes(c.kind) && (bosses || c.kind !== 'boss'),
  );
}

/**
 * The candidates nearest a target: all within ±1.5 effective, widened in 0.5 steps until at
 * least `minimum` qualify. Sorted nearest first.
 */
export function candidatesNear(candidates, target, { minimum = 3, avoid = [] } = {}) {
  const skip = new Set(avoid),
    pool = candidates
      .filter(c => !skip.has(c.key))
      .map(c => ({ c, d: Math.abs(c.effective - target) }))
      .sort((a, b) => a.d - b.d || (a.c.key < b.c.key ? -1 : 1));
  if (!pool.length) return [];
  let band = 1.5;
  while (pool.filter(x => x.d <= band).length < Math.min(minimum, pool.length)) band += 0.5;
  return pool.filter(x => x.d <= band).map(x => x.c);
}

/**
 * Choose an opponent (reference, no XI yet): uniform among candidatesNear(target).
 * @param options { mode, level, seed, offset?, avoid?: keys, rules?, rerolls?, random?,
 *   bosses? (false: real teams only) }
 */
export function chooseOpponent(
  catalog,
  {
    mode,
    level,
    seed,
    offset = 0,
    avoid = [],
    rules = CONFIG.draft,
    rerolls,
    random,
    bosses = true,
  } = {},
) {
  const target = ladderTarget(mode, level, { offset, rules, rerolls }),
    near = candidatesNear(modeCandidates(catalog, mode, { rules, bosses }), target, { avoid });
  if (!near.length) throw Error('No opponent is available');
  const draw = random ?? lcg(seedValue(seed ?? 0));
  return { ...near[Math.floor(draw() * near.length)], target };
}

/**
 * Build an opponent's match side: its best XI without `excludePlayers` (e.g. the players the
 * user drafted, so nobody plays for both teams). Returns an engine-ready side (buildSide)
 * with { kind, id, key, name, code, flag, color, secondary, formation, players (11), rating,
 * effective, nominal } or null if the club can no longer field an XI.
 */
export function buildOpponent(catalog, ref, { excludePlayers = [], rules = CONFIG.draft } = {}) {
  const index = catalogIndex(catalog),
    exclude = new Set([...excludePlayers].map(String)),
    xi = xiFor(index, ref.kind, ref.id, exclude);
  if (!xi) return null;
  const side = buildSide({
    name: ref.name,
    color: ref.color,
    secondary: ref.secondary,
    formation: xi.formation,
    players: xi.players,
    links: rules.links,
    kind: ref.kind,
    id: ref.id,
    code: ref.code ?? null,
  });
  return {
    ...side,
    key: ref.key,
    flag: ref.flag ?? null,
    nominal: ref.effective,
    weakened: exclude.size ? xi.players.length === 11 && round2(ref.effective - side.effective) : 0,
  };
}

/** chooseOpponent + buildOpponent; tries the next nearest if a club cannot field an XI. */
export function pickOpponent(catalog, options = {}) {
  const avoid = [...(options.avoid || [])];
  for (let attempt = 0; attempt < 8; attempt++) {
    const ref = chooseOpponent(catalog, { ...options, avoid }),
      side = buildOpponent(catalog, ref, options);
    if (side) return { ...side, target: ref.target };
    avoid.push(ref.key);
  }
  throw Error('No opponent can field an XI');
}

/** Ladder preview per level for a mode: target and the nearest candidates (for the UI). */
export function ladderPreview(catalog, mode, { rules = CONFIG.draft, count = 5 } = {}) {
  const candidates = modeCandidates(catalog, mode, { rules });
  return LEVELS.map(({ id, label }) => {
    const target = ladderTarget(mode, id, { rules });
    return {
      id,
      label,
      target,
      examples: candidatesNear(candidates, target)
        .slice(0, count)
        .map(c => ({
          key: c.key,
          name: c.name,
          kind: c.kind,
          rating: c.rating,
          effective: c.effective,
        })),
    };
  });
}
