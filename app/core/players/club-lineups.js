import { CONFIG } from '../config/config.js';
import { clubRating } from './team-ratings.js';
import { FORMATIONS } from './formations.js';
import { overallRating, positionFamiliarity } from './ratings.js';
import { stamp } from './catalog-codec.js';
import { assignRows, costMatrix } from '../util/assignment.js';

// Squad arrays returned by clubSquads → their lineups, so a default-options call for one of
// them (e.g. assignClubLineup(club.players, formation)) reuses the precomputed XI.
const known = new WeakMap();

// Rectangular assignment: every slot gets a different, compatible player (util/assignment.js:
// O(11² × squad size), including squads larger than an XI).
export function assignClubLineup(players, formation, { minimumFit = CONFIG.ai.minimumFit } = {}) {
  const cached = known.get(players);
  if (cached && minimumFit === CONFIG.ai.minimumFit && cached.key === clubLineupStamp())
    return cached.lineups[formation] ? [...cached.lineups[formation]] : null;
  const rows = FORMATIONS[formation],
    n = rows.length,
    m = players.length;
  if (m < n) return null;
  const costs = costMatrix(n * m);
  for (let i = 0; i < n; i++) {
    const role = rows[i][2];
    for (let j = 0; j < m; j++) {
      const p = players[j];
      costs[i * m + j] =
        (role === 'GK') !== (p.primaryPosition === 'GK') ||
        positionFamiliarity(p, role) < minimumFit
          ? 1e6
          : -overallRating(p, false, role);
    }
  }
  const owner = assignRows(costs, n, m);
  const lineup = Array(n);
  for (let j = 1; j <= m; j++)
    if (owner[j]) {
      if (costs[(owner[j] - 1) * m + j - 1] >= 1e5) return null;
      lineup[owner[j] - 1] = players[j - 1];
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
