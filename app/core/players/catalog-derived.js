// Values derived from catalog players that depend on the configuration: normalised badges,
// club ratings and club lineups. The compiler stores them in the catalog file together with
// stamps of the configuration used (`catalog.precomputed`); at load, `reconcileCatalog`
// recomputes whatever the live configuration invalidates (club lineups are checked lazily by
// clubSquads). Pure: no DOM, Node-testable.
import { CONFIG } from '../config/config.js';
import { BADGES } from './traits.js';
import { POSITIONS } from './ratings.js';
import { FORMATIONS } from './formations.js';
import { normalizeBadges, rankBadges } from './badges.js';
import { rateClubCatalog } from './team-ratings.js';
import { bestClubLineups, clubLineupStamp, clubRatingStamp } from './club-lineups.js';
import { stamp } from './catalog-codec.js';

export const badgeStamp = (config = CONFIG) => stamp([config.playerTiers, config.ratings]);

// Badge evidence that differs from what rankBadges would infer from the ratings alone (trait
// and tag evidence from the source). Inferred entries are dropped: rankBadges recomputes them
// identically, so compileBadges/normalizeBadges give the same result either way.
export function explicitEvidence(p, evidence = p.inference?.badges || []) {
  const inferred = new Map(rankBadges(p).map(b => [b.tag, b]));
  return evidence
    .filter(e => inferred.get(e.tag)?.confidence !== e.confidence)
    .map(e => ({ tag: e.tag, confidence: e.confidence }));
}

// Build time: fill every precomputed value with the current configuration. Mutates players'
// tags and replaces teams; returns the catalog.
export function deriveCatalog(catalog) {
  for (const p of catalog.players) p.tags = normalizeBadges(p, p.tags);
  catalog.teams = rateClubCatalog(catalog);
  const members = new Map(catalog.teams.map(t => [String(t.id), []]));
  for (const p of catalog.players) members.get(String(p.source.clubId))?.push(p);
  catalog.teams = catalog.teams.map(t => ({ ...t, ...bestClubLineups(members.get(String(t.id))) }));
  catalog.dictionaries = { positions: [...POSITIONS], badges: BADGES.map(b => b.id) };
  catalog.formations = Object.keys(FORMATIONS);
  catalog.precomputed = {
    badges: badgeStamp(),
    clubRatings: clubRatingStamp(),
    lineups: clubLineupStamp(),
  };
  return catalog;
}

// Load time: recompute badges and club ratings when the live configuration differs from the
// one the file was built with (user overrides). Club lineups are handled by clubSquads.
export function reconcileCatalog(catalog) {
  const precomputed = (catalog.precomputed ||= {});
  if (precomputed.badges !== badgeStamp()) {
    for (const p of catalog.players) p.tags = normalizeBadges(p, p.tags);
    precomputed.badges = badgeStamp();
  }
  if (precomputed.clubRatings !== clubRatingStamp()) {
    catalog.teams = rateClubCatalog(catalog);
    precomputed.clubRatings = clubRatingStamp();
  }
  return catalog;
}
