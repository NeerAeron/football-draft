import { CONFIG } from '../config/config.js';
import { clubRating } from './team-ratings.js';
import { FORMATIONS } from './formations.js';
import { overallRating, positionFamiliarity } from './ratings.js';
import { stamp } from './catalog-codec.js';

// Squad arrays returned by clubSquads → their lineups, so a default-options call for one of
// them (e.g. assignClubLineup(club.players, formation)) reuses the precomputed XI.
const known = new WeakMap();

// Rectangular assignment: every slot gets a different, compatible player.
// Hungarian matching is O(11² × squad size), including squads larger than an XI.
export function assignClubLineup(players, formation, { minimumFit = CONFIG.ai.minimumFit } = {}) {
  const cached = known.get(players);
  if (cached && minimumFit === CONFIG.ai.minimumFit && cached.key === clubLineupStamp())
    return cached.lineups[formation] ? [...cached.lineups[formation]] : null;
  const rows = FORMATIONS[formation],
    n = rows.length,
    m = players.length;
  if (m < n) return null;
  const costs = rows.map(([, , role]) =>
    players.map(p =>
      (role === 'GK') !== (p.primaryPosition === 'GK') || positionFamiliarity(p, role) < minimumFit
        ? 1e6
        : -overallRating(p, false, role),
    ),
  );
  const u = Array(n + 1).fill(0),
    v = Array(m + 1).fill(0),
    p = Array(m + 1).fill(0),
    way = Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const min = Array(m + 1).fill(Infinity),
      used = Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity,
        j1 = 0;
      for (let j = 1; j <= m; j++)
        if (!used[j]) {
          const cur = costs[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < min[j]) {
            min[j] = cur;
            way[j] = j0;
          }
          if (min[j] < delta) {
            delta = min[j];
            j1 = j;
          }
        }
      for (let j = 0; j <= m; j++)
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else min[j] -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const lineup = Array(n);
  for (let j = 1; j <= m; j++)
    if (p[j]) {
      if (costs[p[j] - 1][j - 1] >= 1e5) return null;
      lineup[p[j] - 1] = players[j - 1];
    }
  return lineup;
}
// Stamps of the configuration that club ratings and club lineups depend on. The catalog file
// stores the stamps its precomputed values were made with; a mismatch (a tool's tuning or a
// change to FORMATIONS) falls back to computing them here.
export const clubRatingStamp = (config = CONFIG) => stamp([config.teamTiers, config.ratings]);
export const clubLineupStamp = (config = CONFIG) =>
  stamp([config.teamTiers, config.ratings, config.ai.minimumFit, FORMATIONS]);

// Every compatible XI of a club (formation → players in slot order) and its best formation:
// the highest summed rating at the slot roles, earlier formations winning ties.
export function bestClubLineups(players) {
  const lineups = {};
  let bestFormation = null,
    bestValue = -Infinity;
  if (
    players.some(p => p.primaryPosition === 'GK') &&
    players.filter(p => p.primaryPosition !== 'GK').length >= 10
  )
    for (const [formation, rows] of Object.entries(FORMATIONS)) {
      const lineup = assignClubLineup(players, formation);
      if (!lineup) continue;
      lineups[formation] = lineup;
      const value = lineup.reduce((n, p, i) => n + overallRating(p, false, rows[i][2]), 0);
      if (value > bestValue) {
        bestValue = value;
        bestFormation = formation;
      }
    }
  return { lineups, bestFormation };
}

const cache = new WeakMap();
// Club squads with ratings, compatible formations, lineups and best formation. Uses the
// catalog's precomputed values when their stamps match the live configuration.
export function clubSquads(catalog) {
  const key = clubLineupStamp();
  if (cache.get(catalog)?.stamp === key) return cache.get(catalog).result;
  const rated = catalog.precomputed?.clubRatings === clubRatingStamp(),
    lined = catalog.precomputed?.lineups === key;
  const leagueTiers = new Map((catalog.leagues || []).map(l => [String(l.id), l.tier]));
  const groups = new Map(
    (catalog.teams || []).map(t => [
      String(t.id),
      { ...t, leagueTier: leagueTiers.get(String(t.leagueId)), players: [], formations: [] },
    ]),
  );
  for (const p of catalog.players) {
    const club = groups.get(String(p.source.clubId));
    if (club) club.players.push(p);
  }
  for (const club of groups.values()) {
    if (!rated) Object.assign(club, clubRating(club.players));
    if (!lined || !club.lineups) Object.assign(club, bestClubLineups(club.players));
    club.formations = Object.keys(FORMATIONS).filter(f => club.lineups[f]);
    known.set(club.players, { key, lineups: club.lineups });
  }
  const result = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  cache.set(catalog, { stamp: key, result });
  return result;
}
