// Share text (emoji row per match) and challenge links (mode + seed + options, URL-safe) so
// a friend can replay the same spins. Pure string helpers; the UI owns clipboard/navigation.
import { FORMATIONS } from '../players/formations.js';
import { DRAFT_MODES, DIFFICULTIES, DIFFICULTY_LABELS, seedNumber } from '../draft/session.js';

export const RESULT_EMOJI = { W: '🟩', D: '🟨', L: '🟥' };
const TROPHY = '🏆';

/** "🟩🟩🟨 🟩🟥": group results, a space, knockout results; 🏆 for champions. */
export function resultEmoji(snapshot) {
  const row = snapshot.results.map(r => RESULT_EMOJI[r]);
  const text = row.slice(0, 3).join('') + (row.length > 3 ? ' ' + row.slice(3).join('') : '');
  return snapshot.status === 'champion' ? text + ' ' + TROPHY : text;
}
const flagsLine = ({ mode, difficulty, hideRatings, uniqueNations }) =>
  [
    DRAFT_MODES[mode]?.label,
    DIFFICULTY_LABELS[difficulty],
    hideRatings && '🙈 Ratings hidden',
    uniqueNations && '🧩 One per nation',
  ]
    .filter(Boolean)
    .join(' · ');
const thousands = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
// The stage reached, unless the verdict already names it ("C Quarter-finalists" says it all;
// "A Heartbreak on Penalties" still needs "Final").
const stem = label => label.toLowerCase().replace(/s$/, '');
const stageUnlessNamed = (stageLabel, grade) =>
  grade?.verdict && stageLabel && grade.verdict.toLowerCase().includes(stem(stageLabel))
    ? null
    : stageLabel;

/**
 * Share text for a finished (or in-progress) run. `snapshot` is CupRun.snapshot().
 * extras: { title, daily: { number, id }, rating (team OVR), perfectPct, points, hideRatings,
 *           uniqueNations, url }
 *
 *   ⚽ Football Draft · Daily #7
 *   🟩🟩🟨 🟩🟩🟥
 *   5-1-1 · B+ Semi-final Heartbreak          (the stage only when the verdict does not name it)
 *   XI 82.9 · 98.6% of perfect · 1,104 pts
 *   Nations · Pro · 🙈 Ratings hidden
 *   https://example.com/#c=…
 */
export function shareText(snapshot, extras = {}) {
  const {
    title = 'Football Draft',
    daily = null,
    rating = null,
    perfectPct = null,
    points = null,
    url = null,
  } = extras;
  const r = snapshot.record,
    grade = snapshot.grade;
  const head = '⚽ ' + title + (daily ? ` · Daily #${daily.number}` : ' · World Cup Run');
  const summary = [
    `${r.w}-${r.d}-${r.l}`,
    stageUnlessNamed(snapshot.stageLabel, grade),
    grade && `${grade.grade} ${grade.verdict}`,
  ]
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
    numbers,
    flagsLine({ mode: snapshot.mode, difficulty: snapshot.difficulty, ...extras }),
    url,
  ]
    .filter(Boolean)
    .join('\n');
}

// ---- challenge links ----------------------------------------------------------------------
// Token: c1.<kind>.<mode>.<formation>.<difficulty>.<flags>.<seed base36>[.<catalog stamp>]
//   kind q quick match · c cup run · v versus · d daily; mode n/l/c/x; difficulty a/s/p/w/l;
//   flags any of h (hide ratings), u (one per nation), 2 (two sides), or 0.
//   For a daily the seed field is the challenge number (dailyIdFromNumber gives the day).
// Only [a-z0-9.-]: safe in a URL hash or query without escaping.
export const CHALLENGE_VERSION = 'c1';
const KINDS = { q: 'quick', c: 'cup', v: 'versus', d: 'daily' };
const MODES = { n: 'nations', l: 'leagues', c: 'clubs', x: 'clubAndCountry' };
const LEVEL_CODES = { a: 'amateur', s: 'semipro', p: 'pro', w: 'worldclass', l: 'legendary' };
const invert = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));

/**
 * Encode a challenge: { kind = 'cup', mode, seed (number or string), formation, difficulty,
 * hideRatings, uniqueNations, sides, catalog (catalogStamp, optional) }; a daily passes
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
  sides = 1,
  catalog = null,
}) {
  const k = invert(KINDS)[kind],
    m = invert(MODES)[mode],
    d = invert(LEVEL_CODES)[difficulty];
  if (!k || !m || !d || !FORMATIONS[formation]) throw Error('Invalid challenge');
  const flags =
    (hideRatings ? 'h' : '') + (uniqueNations ? 'u' : '') + (sides === 2 ? '2' : '') || '0';
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
  if (!KINDS[k] || !MODES[m] || !LEVEL_CODES[d] || !FORMATIONS[formation]) return null;
  if (!/^(0|[hu2]{1,3})$/.test(flags) || !/^[0-9a-z]{1,7}$/.test(seed36)) return null;
  const seed = parseInt(seed36, 36);
  if (!Number.isSafeInteger(seed) || seed > 0xffffffff) return null;
  if (catalog !== null && !/^[0-9a-z]{1,24}$/.test(catalog)) return null;
  const kind = KINDS[k];
  if (kind === 'daily' && !seed) return null;
  return {
    kind,
    mode: MODES[m],
    formation,
    difficulty: LEVEL_CODES[d],
    hideRatings: flags.includes('h'),
    uniqueNations: flags.includes('u'),
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
