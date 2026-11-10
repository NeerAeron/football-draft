// Mates (team chemistry), one rule a new player can read off the pitch:
//   * a player with a nation team-mate in the XI gets +2, with a club mate +2, and the two
//     stack: both a nation mate and a club mate = +4 (CONFIG.draft.links). One mate is enough;
//   * Captain: an XI with a Captain-tagged player (catalog `captain`) adds `rules.captain`
//     (+1) to every player on top (one captain counts; two do not stack).
// The sum is the engine boost `chem` (0–5 attribute points, added to every skill in
// Player.skill). Real national XIs are all nation mates (+2 each, +4 for club mates inside
// them), real club XIs club mates (+2, +4 for compatriots).
import { CONFIG, DEFAULT_CONFIG } from '../config/config.js';

/** Link kinds, in the order they are listed and drawn (nation first). */
export const LINK_KINDS = ['nation', 'club'];
const keyOf = {
  club: p => (p?.source?.clubId == null ? null : String(p.source.clubId)),
  nation: p => p?.source?.nationality || null,
};
const rating = p => p.sourceOverall ?? p.overall ?? 0;
// Rules saved before the mates rule held thresholds per kind ({ level1, … }): those read as
// the current defaults, so an old draft or run keeps working.
const boostOf = (rules, kind) =>
  typeof rules?.[kind] === 'number' ? rules[kind] : DEFAULT_CONFIG.draft.links[kind];
/** The boosts of a rules object: { nation, club, captain } (numbers). */
export function linkBoosts(rules = CONFIG.draft.links) {
  return {
    nation: boostOf(rules, 'nation'),
    club: boostOf(rules, 'club'),
    captain: boostOf(rules, 'captain'),
  };
}

/**
 * Mates of an XI (or a partial one: null entries are empty slots).
 * @param {Array<object|null>} players catalog players in slot order
 * @param {object} rules CONFIG.draft.links (or a session's snapshot)
 * @returns {{
 *   players: Array<{boost, kinds, chem, mates: {nation, club}}|null>,
 *   pairs: Array<{a, b, kind, kinds}>,
 *   score: number, maxScore: number, total: number, chem: number, linked: number,
 *   captain: number | null (input index of the captain), captainBoost: number
 * }} per-player entries aligned with the input: `boost` is the mates boost (0, 2 or 4),
 * `kinds` the kinds that give it (['nation'], ['club'], both or none), `chem` = boost + the
 * Captain's boost, `mates` the number of XI mates per kind. `pairs` index into the input:
 * every pair of nation mates or club mates (one line per pair; `kind` = 'nation' when they
 * share the nation, `kinds` = all they share). `score` = sum of the mates boosts (max 44),
 * `total` = sum of chem (Captain included, max 55), `chem` = mean chem.
 */
export function teamLinks(players, rules = CONFIG.draft.links) {
  const value = linkBoosts(rules);
  const counts = { nation: new Map(), club: new Map() };
  for (const p of players)
    if (p)
      for (const k of LINK_KINDS) {
        const key = keyOf[k](p);
        if (key !== null) counts[k].set(key, (counts[k].get(key) || 0) + 1);
      }
  // The captain: the first Captain-tagged player, by source rating (ties: slot order).
  let captain = null;
  players.forEach((p, i) => {
    if (p?.captain && (captain === null || rating(p) > rating(players[captain]))) captain = i;
  });
  const captainBoost = captain === null ? 0 : value.captain || 0;
  const entries = players.map(p => {
    if (!p) return null;
    const mates = {},
      kinds = [];
    let boost = 0;
    for (const k of LINK_KINDS) {
      const key = keyOf[k](p);
      mates[k] = key === null ? 0 : counts[k].get(key) - 1;
      if (mates[k] > 0 && value[k] > 0) {
        kinds.push(k);
        boost += value[k];
      }
    }
    return { boost, kinds, chem: boost + captainBoost, mates };
  });
  const pairs = [];
  for (let a = 0; a < players.length; a++)
    for (let b = a + 1; b < players.length; b++) {
      if (!players[a] || !players[b]) continue;
      const shared = LINK_KINDS.filter(k => {
        const key = keyOf[k](players[a]);
        return key !== null && key === keyOf[k](players[b]) && value[k] > 0;
      });
      if (shared.length) pairs.push({ a, b, kind: shared[0], kinds: shared });
    }
  const filled = entries.filter(Boolean);
  const total = filled.reduce((s, e) => s + e.chem, 0);
  return {
    players: entries,
    pairs,
    score: filled.reduce((s, e) => s + e.boost, 0),
    maxScore: players.length * (value.nation + value.club),
    total,
    chem: filled.length ? total / filled.length : 0,
    linked: filled.filter(e => e.boost > 0).length,
    captain,
    captainBoost,
  };
}

/** Per-player engine `chem` values (0–5) aligned with the input. */
export function chemValues(players, rules = CONFIG.draft.links) {
  return teamLinks(players, rules).players.map(e => (e ? e.chem : 0));
}
