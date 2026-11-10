// Links (team chemistry), small and legible:
//   * three link kinds — club teammates, same nation, same league (from player.source);
//   * per kind, a player's level counts the XI players sharing it (the player included):
//     club 2/5/8, nation 2/5/8, league 3/5/8 players => +1/+2/+3 (CONFIG.draft.links);
//   * a player's link level = sum of the three, capped at 3; team Links = sum (0–33);
//   * engine boost `chem` = level / 3 × maxChem (0–2 attribute points, added in Player.skill).
// Real club XIs and national XIs are fully linked (level 3, chem 2 for everyone).
//   * Captain: an XI with a Captain-tagged player (catalog `captain`) adds `rules.captain`
//     attribute points to every player's chem (one captain counts; it does not stack).
import { CONFIG } from '../config/config.js';

export const LINK_KINDS = ['club', 'nation', 'league'];
export const MAX_LINK_LEVEL = 3;
const keyOf = {
  club: p => (p?.source?.clubId == null ? null : String(p.source.clubId)),
  nation: p => p?.source?.nationality || null,
  league: p => (p?.source?.leagueId == null ? null : String(p.source.leagueId)),
};
const rating = p => p.sourceOverall ?? p.overall ?? 0;
const kindLevel = (count, t) =>
  count >= t.level3 ? 3 : count >= t.level2 ? 2 : count >= t.level1 ? 1 : 0;

/**
 * Links of an XI (or a partial one: null entries are empty slots).
 * @param {Array<object|null>} players catalog players in slot order
 * @param {object} rules CONFIG.draft.links (or a session's snapshot)
 * @returns {{
 *   players: Array<{level, chem, club, nation, league, counts}|null>,
 *   pairs: Array<{a, b, kind, kinds}>,
 *   score: number, maxScore: number, chem: number, linked: number,
 *   captain: number | null (input index of the captain), captainBoost: number
 * }} per-player entries aligned with the input; pairs index into it. A pair is listed for
 * every active shared kind (its group reached level 1); `kind` is the strongest one
 * (club > nation > league), for drawing one line per pair.
 */
export function teamLinks(players, rules = CONFIG.draft.links) {
  const counts = Object.fromEntries(LINK_KINDS.map(k => [k, new Map()]));
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
  const captainBoost = captain === null ? 0 : rules.captain || 0;
  const entries = players.map(p => {
    if (!p) return null;
    const c = {},
      levels = {};
    for (const k of LINK_KINDS) {
      const key = keyOf[k](p);
      c[k] = key === null ? 0 : counts[k].get(key);
      levels[k] = kindLevel(c[k], rules[k]);
    }
    const level = Math.min(MAX_LINK_LEVEL, levels.club + levels.nation + levels.league);
    return {
      level,
      chem: (level / MAX_LINK_LEVEL) * rules.maxChem + captainBoost,
      ...levels,
      counts: c,
    };
  });
  const pairs = [];
  for (let a = 0; a < players.length; a++)
    for (let b = a + 1; b < players.length; b++) {
      if (!players[a] || !players[b]) continue;
      const kinds = LINK_KINDS.filter(k => {
        const key = keyOf[k](players[a]);
        return key !== null && key === keyOf[k](players[b]) && entries[a][k] > 0;
      });
      if (kinds.length) pairs.push({ a, b, kind: kinds[0], kinds });
    }
  const filled = entries.filter(Boolean);
  return {
    players: entries,
    pairs,
    score: filled.reduce((s, e) => s + e.level, 0),
    maxScore: players.length * MAX_LINK_LEVEL,
    chem: filled.length ? filled.reduce((s, e) => s + e.chem, 0) / filled.length : 0,
    linked: filled.filter(e => e.level > 0).length,
    captain,
    captainBoost,
  };
}

/** Per-player engine `chem` values (0–maxChem) aligned with the input. */
export function chemValues(players, rules = CONFIG.draft.links) {
  return teamLinks(players, rules).players.map(e => (e ? e.chem : 0));
}
