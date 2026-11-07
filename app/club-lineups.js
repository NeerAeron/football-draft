import { CONFIG } from './config.js';
import { clubRating } from './team-ratings.js';
import { FORMATIONS } from './formations.js';
import { overallRating, positionFamiliarity } from './ratings.js';

// Rectangular assignment: every slot gets a different, compatible player.
// Hungarian matching is O(11² × squad size), including squads larger than an XI.
export function assignClubLineup(
  players,
  formation,
  { minimumFit = CONFIG.ai.minimumFit, minimumOverall = 0, random = null, variation = 0 } = {},
) {
  const rows = FORMATIONS[formation],
    n = rows.length,
    m = players.length;
  if (m < n) return null;
  const costs = rows.map(([, , role]) =>
    players.map(p =>
      (role === 'GK') !== (p.primaryPosition === 'GK') ||
      positionFamiliarity(p, role) < minimumFit ||
      overallRating(p, true, role) < minimumOverall
        ? 1e6
        : -overallRating(p, false, role) - (random ? random() * variation : 0),
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
export function partialClubLineup(players, formation) {
  const attrs = Object.fromEntries(Object.keys(players[0]?.attrs || {}).map(k => [k, 1]));
  const vacant = FORMATIONS[formation].map(([, , role], i) => ({
    profileId: `vacant:${i}`,
    vacant: true,
    attrs,
    primaryPosition: role,
    secondaryPositions: [],
  }));
  return assignClubLineup([...players, ...vacant], formation).map(p => (p.vacant ? null : p));
}
const cache = new WeakMap();
export function clubSquads(catalog) {
  const stamp = JSON.stringify([CONFIG.teamTiers, CONFIG.ratings, CONFIG.ai.minimumFit]);
  if (cache.get(catalog)?.stamp === stamp) return cache.get(catalog).result;
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
  for (const club of groups.values()) Object.assign(club, clubRating(club.players));
  for (const club of groups.values())
    if (
      club.players.filter(p => p.primaryPosition === 'GK').length &&
      club.players.filter(p => p.primaryPosition !== 'GK').length >= 10
    )
      for (const formation of Object.keys(FORMATIONS)) {
        const lineup = assignClubLineup(club.players, formation);
        if (lineup) club.formations.push(formation);
      }
  const result = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  cache.set(catalog, { stamp, result });
  return result;
}
