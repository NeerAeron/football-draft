// Share text (emoji row per match) and challenge links (mode + seed + options, URL-safe) so
// a friend can replay the same spins. Pure string helpers; the UI owns clipboard/navigation.
import { FORMATIONS } from '../players/formations.js';
import { DRAFT_MODES, DIFFICULTIES, DIFFICULTY_LABELS, seedNumber } from '../draft/session.js';

export const RESULT_EMOJI = { W: '🟩', D: '🟨', L: '🟥' };
const MEDAL_EMOJI = { gold: '🏆', silver: '🥈', bronze: '🥉' };
/**
 * The ultimate achievement: a perfect World Cup (eight wins out of eight) on Legendary in
 * Budget mode. The trophy cabinet, the run-end toast and the share text use this name.
 */
export const ULTIMATE = { name: 'Immortals', emoji: '👑', difficulty: 'legendary' };
/** Is a finished run (CupRun.snapshot()) the ultimate achievement? `budget`: its Budget mode. */
export const isUltimate = (snapshot, budget) =>
  !!budget && !!snapshot?.perfect && snapshot.difficulty === ULTIMATE.difficulty;

/** "🟩🟩🟨 🟩🟥": group results, a space, knockout results; 🏆 🥈 🥉 for the top three. */
export function resultEmoji(snapshot) {
  const row = snapshot.results.map(r => RESULT_EMOJI[r]);
  const text = row.slice(0, 3).join('') + (row.length > 3 ? ' ' + row.slice(3).join('') : '');
  const medal =
    MEDAL_EMOJI[snapshot.medal] ?? (snapshot.status === 'champion' ? MEDAL_EMOJI.gold : null);
  return medal ? text + ' ' + medal : text;
}
const flagsLine = ({ mode, difficulty, hideRatings, uniqueNations, budget }) =>
  [
    DRAFT_MODES[mode]?.label,
    DIFFICULTY_LABELS[difficulty],
    budget && '💰 Budget',
    hideRatings && '🙈 Ratings hidden',
    uniqueNations && '🧩 One per nation',
  ]
    .filter(Boolean)
    .join(' · ');
const thousands = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Share text for a finished (or in-progress) run. `snapshot` is CupRun.snapshot().
 * extras: { title, daily: { number, id }, rating (team OVR), perfectPct, points, hideRatings,
 *           uniqueNations, budget, url }
 *
 *   ⚽ World Cup Draft · Daily #7
 *   🟩🟩🟨 🟩🟩🟩🟥🟩 🥉
 *   6-1-1 · Third place                       (where the run finished, or the stage it is in)
 *   XI 82.9 · 98.6% of perfect · 1,104 pts
 *   Nations · Pro · 🙈 Ratings hidden
 *   https://example.com/#c=…
 *
 * A perfect Legendary run in Budget mode adds "👑 Immortals: Legendary · Budget · 8-0".
 */
export function shareText(snapshot, extras = {}) {
  const {
    title = 'World Cup Draft',
    daily = null,
    rating = null,
    perfectPct = null,
    points = null,
    url = null,
  } = extras;
  const r = snapshot.record;
  const head = '⚽ ' + title + (daily ? ` · Daily #${daily.number}` : ' · World Cup Run');
  const summary = [`${r.w}-${r.d}-${r.l}`, snapshot.placeLabel ?? snapshot.stageLabel]
    .filter(Boolean)
    .join(' · ');
  const numbers = [
    rating !== null && `XI ${rating.toFixed(1)}`,
    perfectPct !== null && `${perfectPct.toFixed(1)}% of perfect`,
    points !== null && `${thousands(points)} pts`,
  ]
    .filter(Boolean)
    .join(' · ');
  return [
    head,
    resultEmoji(snapshot),
    summary,
    isUltimate(snapshot, extras.budget) &&
      `${ULTIMATE.emoji} ${ULTIMATE.name}: Legendary · Budget · ${r.w}-${r.d}-${r.l}`,
    numbers,
    flagsLine({ mode: snapshot.mode, difficulty: snapshot.difficulty, ...extras }),
    url,
  ]
    .filter(Boolean)
    .join('\n');
}

// ---- challenge links ----------------------------------------------------------------------
// Token: c1.<kind>.<mode>.<formation>.<difficulty>.<flags>.<seed base36>[.<catalog stamp>]
//   kind q quick match · c cup run · v versus · d daily; mode n/l/c/x; difficulty p/w/l (old
//   links may carry a or s, the removed Amateur and Semi-pro: they decode as Pro);
//   flags any of h (hide ratings), u (one per nation), b (Budget mode: World Cup runs only),
//   2 (two sides), or 0.
//   For a daily the seed field is the challenge number (dailyIdFromNumber gives the day).
// Only [a-z0-9.-]: safe in a URL hash or query without escaping.
export const CHALLENGE_VERSION = 'c1';
const KINDS = { q: 'quick', c: 'cup', v: 'versus', d: 'daily' };
const MODES = { n: 'nations', l: 'leagues', c: 'clubs', x: 'clubAndCountry' };
const LEVEL_CODES = { p: 'pro', w: 'worldclass', l: 'legendary' };
const OLD_LEVEL_CODES = { a: 'pro', s: 'pro' };
const invert = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));

/**
 * Encode a challenge: { kind = 'cup', mode, seed (number or string), formation, difficulty,
 * hideRatings, uniqueNations, budget (a cup run in Budget mode), sides, catalog (catalogStamp,
 * optional) }; a daily passes
 * { kind: 'daily', daily: challenge number } instead of a seed.
 */
export function encodeChallenge({
  kind = 'cup',
  mode = 'nations',
  seed,
  daily = null,
  formation = '433',
  difficulty = 'pro',
  hideRatings = false,
  uniqueNations = false,
  budget = false,
  sides = 1,
  catalog = null,
}) {
  const k = invert(KINDS)[kind],
    m = invert(MODES)[mode],
    d = invert(LEVEL_CODES)[difficulty];
  if (!k || !m || !d || !FORMATIONS[formation]) throw Error('Invalid challenge');
  if (budget && kind !== 'cup') throw Error('Only a World Cup run has a Budget mode');
  const flags =
    (hideRatings ? 'h' : '') +
      (uniqueNations ? 'u' : '') +
      (budget ? 'b' : '') +
      (sides === 2 ? '2' : '') || '0';
  if (kind === 'daily' && !(Number.isInteger(daily) && daily > 0))
    throw Error('A daily link needs its challenge number');
  const value = kind === 'daily' ? daily : seedNumber(seed),
    parts = [CHALLENGE_VERSION, k, m, formation, d, flags, value.toString(36)];
  if (catalog)
    parts.push(
      String(catalog)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ''),
    );
  return parts.join('.');
}
/** Decode a token; null for anything malformed (never throws). */
export function decodeChallenge(token) {
  if (typeof token !== 'string' || token.length > 120) return null;
  const parts = token.trim().split('.');
  if (parts.length < 7 || parts.length > 8 || parts[0] !== CHALLENGE_VERSION) return null;
  const [, k, m, formation, d, flags, seed36, catalog = null] = parts;
  const difficulty = LEVEL_CODES[d] ?? OLD_LEVEL_CODES[d];
  if (!KINDS[k] || !MODES[m] || !difficulty || !FORMATIONS[formation]) return null;
  if (!/^(0|[hub2]{1,4})$/.test(flags) || !/^[0-9a-z]{1,7}$/.test(seed36)) return null;
  const seed = parseInt(seed36, 36);
  if (!Number.isSafeInteger(seed) || seed > 0xffffffff) return null;
  if (catalog !== null && !/^[0-9a-z]{1,24}$/.test(catalog)) return null;
  const kind = KINDS[k];
  if (kind === 'daily' && !seed) return null;
  // Budget mode exists in a World Cup run only.
  if (flags.includes('b') && kind !== 'cup') return null;
  return {
    kind,
    mode: MODES[m],
    formation,
    difficulty,
    hideRatings: flags.includes('h'),
    uniqueNations: flags.includes('u'),
    budget: flags.includes('b'),
    sides: flags.includes('2') ? 2 : 1,
    ...(kind === 'daily' ? { daily: seed, seed: null } : { seed }),
    catalog,
  };
}
/** `${base}#c=<token>` */
export function challengeUrl(base, challenge) {
  return `${String(base).split('#')[0]}#c=${encodeChallenge(challenge)}`;
}
/** Read a challenge from a URL, hash or query string (#c=… or ?c=…); null if none/invalid. */
export function parseChallengeUrl(url) {
  const match = /[#?&]c=([0-9a-z.-]+)/i.exec(String(url || ''));
  return match ? decodeChallenge(match[1].toLowerCase()) : null;
}
/** Draft session options for a decoded challenge (spread into createDraftSession). */
export function challengeDraftOptions(challenge) {
  if (!DIFFICULTIES.includes(challenge.difficulty)) throw Error('Invalid challenge');
  return {
    mode: challenge.mode,
    seed: challenge.seed,
    sides: challenge.sides,
    formation: challenge.formation,
    difficulty: challenge.difficulty,
    hideRatings: challenge.hideRatings,
    uniqueNations: challenge.uniqueNations,
    useDefaultRules: true,
  };
}
