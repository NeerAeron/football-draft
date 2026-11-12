// Legends and Prime versions at run time: decoded from app/data/legends.v1.json
// (legends-codec.js) and attached to a decoded catalog as `catalog.legends`. They are NOT part
// of catalog.players: nation, league and club pools, opponents and the bosses never see them.
// Only a draft's Legend spin offers a legend, and a Prime boost swaps a drafted player for his
// prime version. Pure: no DOM, no fetch.
//
//   catalog.legends = {
//     players: [legend],                 // best first (source overall), then id
//     primes: Map(profileId of the catalog player → his prime version),
//     byId: Map(profileId → legend | prime version),
//   }
// A legend is shaped like a catalog player plus `legend: true` and `edition` (15–23); his
// `source` has today's nation name and, when his club of that edition is in the catalog, that
// club (so he is a club mate). A prime version is the catalog player with the attributes,
// positions, badges and rating of that edition: `prime: true`, `edition`, `primeOf` (the
// catalog player's profileId). He keeps the name, nation, club and the Captain tag.
import { normalizeBadges } from './badges.js';
import { badgeStamp } from './catalog-derived.js';

/** Attach decoded legends data to a catalog (idempotent). Returns the catalog. */
export function attachLegends(catalog, data) {
  if (catalog.legends) return catalog;
  const teams = new Map((catalog.teams || []).map(t => [String(t.id), t])),
    current = catalog.byId ?? new Map(catalog.players.map(p => [p.profileId, p])),
    stale = data.precomputed?.badges !== badgeStamp();
  const players = data.legends.map(p => {
    const team = p.source.clubId == null ? null : teams.get(String(p.source.clubId));
    const legend = {
      ...p,
      captain: false,
      legend: true,
      source: {
        club: team ? team.name : null,
        clubId: team ? team.id : null,
        leagueId: team ? team.leagueId : null,
        nationality: p.source.nationality,
      },
    };
    if (stale) legend.tags = normalizeBadges(legend, legend.tags);
    return legend;
  });
  const primes = new Map();
  for (const p of data.primes) {
    const base = current.get(p.primeOf);
    if (!base) continue; // built against another catalog: no prime for this player
    const prime = {
      ...p,
      name: base.name,
      fullName: base.fullName,
      captain: !!base.captain,
      prime: true,
      source: { ...base.source },
    };
    if (stale) prime.tags = normalizeBadges(prime, prime.tags);
    primes.set(base.profileId, prime);
  }
  const byId = new Map(players.map(p => [p.profileId, p]));
  for (const p of primes.values()) byId.set(p.profileId, p);
  catalog.legends = { players, primes, byId };
  return catalog;
}

/** A legend or prime version by profileId (null when unknown or no legends are attached). */
export const legendPlayer = (catalog, id) => catalog?.legends?.byId.get(String(id)) ?? null;
/** The prime version stored for a catalog player, or null. */
export const primeVersion = (catalog, p) =>
  (p && !p.prime && !p.legend && catalog?.legends?.primes.get(p.profileId)) || null;
/** The id a player is known by in the catalog: a prime version counts as the current player. */
export const baseProfileId = p => p.primeOf ?? p.profileId;
/**
 * The year of a legend or prime version: the year of the ratings snapshot it was compiled from
 * (`year`, stored by the compiler from the source row's date). Takes a player, a version
 * summary ({ year, edition }) or a bare edition number. Without a stored year the release
 * snapshot is assumed: a FIFA edition comes out in the autumn before its number (FIFA 19 in
 * September 2018).
 */
export function editionYear(version) {
  if (version == null) return null;
  if (typeof version === 'object')
    return version.year ?? (version.edition ? 1999 + version.edition : null);
  return version ? 1999 + version : null;
}
/** "’18" for a version of 2018 (FIFA 19): what the game shows, never the edition. */
export function editionLabel(version) {
  const year = editionYear(version);
  return year ? `’${String(year % 100).padStart(2, '0')}` : '';
}
