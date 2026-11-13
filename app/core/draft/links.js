// Mates (team chemistry), one rule a new player can read off the pitch:
//   a player with a nation team-mate in the XI gets +1.5, with a club mate +1, and the two
//   stack: both a nation mate and a club mate = +2.5 (CONFIG.draft.links). One mate is enough.
//   Captain: an XI with a Captain (catalog `captain`: a reviewed list of real national-team
//   captains, data/captains.json) gives every player `links.captain` (+1) on top — one captain
//   counts, two do not stack.
//   GOAT: a card flagged `goat` (the few greatest of all time, each in his year) gives every
//   player `links.goat` (+1.5) — more than a Captain; a second GOAT adds half of that, a third
//   a quarter. A Captain and a GOAT in one XI both count (a card is never both).
// The sum, at most 5, is the engine boost `chem` (attribute points, added to every skill in Player.skill).
// Real national XIs are all nation mates (+1.5 each, +2.5 for club mates inside them), real
// club XIs club mates (+1, +2.5 for compatriots).
import { CONFIG } from '../config/config.js';

/** Link kinds, in the order they are listed and drawn (nation first). */
export const LINK_KINDS = ['nation', 'club'];
const keyOf = {
  club: p => (p?.source?.clubId == null ? null : String(p.source.clubId)),
  nation: p => p?.source?.nationality || null,
};
const rating = p => p.sourceOverall ?? p.overall ?? 0;
/** The boosts of a rules object (CONFIG.draft.links or a snapshot): { nation, club, captain }. */
export function linkBoosts(rules = CONFIG.draft.links) {
  return { nation: rules.nation, club: rules.club, captain: rules.captain, goat: rules.goat ?? 0 };
}
/** The engine's cap on a player's boost (sim/player.js normalizeChem). */
export const CHEM_CAP = 5;
/** What `count` GOATs give every player: the first `value`, each further one half as much. */
export const goatBoost = (count, value) => (count > 0 ? value * 2 * (1 - 0.5 ** count) : 0);
/** The slots of an XI's GOATs (players in slot order, null = open). */
export function goatSlots(players) {
  const slots = [];
  players.forEach((p, i) => {
    if (p?.goat) slots.push(i);
  });
  return slots;
}
/** Are these the mates rules of this version: three numbers? (What a saved run must carry.) */
export const validLinks = rules =>
  !!rules && ['nation', 'club', 'captain'].every(kind => Number.isFinite(rules[kind]));
/**
 * The slot of an XI's captain (players in slot order, null = open): of the Captain-tagged
 * players the highest source rating, the first slot on a tie; null when there is none.
 */
export function captainSlot(players) {
  let captain = null;
  players.forEach((p, i) => {
    if (p?.captain && (captain === null || rating(p) > rating(players[captain]))) captain = i;
  });
  return captain;
}

/**
 * Mates of an XI (or a partial one: null entries are empty slots).
 * @param {Array<object|null>} players catalog players in slot order
 * @param {object} rules CONFIG.draft.links (or a session's snapshot)
 * @returns {{
 *   players: Array<{boost, kinds, chem, mates: {nation, club}}|null>,
 *   pairs: Array<{a, b, kind, kinds}>,
 *   score: number, maxScore: number, total: number, chem: number, linked: number,
 *   captain: number | null (input index of the captain), captainBoost: number,
 *   goats: number[] (input indexes of the GOATs), goatBoost: number (what they give everyone)
 * }} per-player entries aligned with the input: `boost` is the mates boost (0, 1, 1.5 or
 * 2.5), `kinds` the kinds that give it (['nation'], ['club'], both or none), `chem` = boost +
 * the Captain's and the GOATs' boosts, at most 5 (what the engine adds), `mates` the number of XI mates per kind. `pairs`
 * index into the input: every pair of nation mates or club mates (one line per pair; `kind` =
 * 'nation' when they share the nation, `kinds` = all they share). `score` = sum of the mates
 * boosts (max `maxScore` = 27.5), `total` = sum of chem (Captain included: the UI's
 * "Boosts"), `chem` = mean chem.
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
  const captain = captainSlot(players),
    captainBoost = captain === null ? 0 : value.captain || 0,
    goats = goatSlots(players),
    goatsBoost = goatBoost(goats.length, value.goat || 0),
    team = captainBoost + goatsBoost;
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
    return { boost, kinds, chem: Math.min(CHEM_CAP, boost + team), mates };
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
    score: filled.reduce((sum, e) => sum + e.boost, 0),
    maxScore: players.length * (value.nation + value.club),
    total,
    chem: filled.length ? total / filled.length : 0,
    linked: filled.filter(e => e.boost > 0).length,
    captain,
    captainBoost,
    goats,
    goatBoost: goatsBoost,
  };
}

/** Per-player engine `chem` values (0–3.5) aligned with the input. */
export function chemValues(players, rules = CONFIG.draft.links) {
  return teamLinks(players, rules).players.map(e => (e ? e.chem : 0));
}
