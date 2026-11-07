// PlayerView: the one plain object every player component (PlayerCard, PlayerRow,
// PitchView tokens) takes. Screens build it from catalog/draft data with playerView();
// components never read raw catalog records.
//
// {
//   id: 'ea:209331:fc26:u4',
//   name: 'M. Salah',            // short football name (cards, tokens)
//   fullName?: 'Mohamed Salah',
//   position: 'RM',              // primary position
//   positions?: ['RM', 'RW'],    // primary + secondary
//   ovr: 90,
//   tier?: 'Superstar',          // optional override; default tierOf(ovr)
//   nation?: { name: 'Egypt', code: 'eg' },
//   club?: { name: 'Liverpool', short?: 'LIV', colors: ['#C8102E', '#FFFFFF'] },
//   league?: { name: 'English Premier League', logo?: './assets/logos/…png', tier?: 'A' },
//   stats?: [{ key: 'PAC', label: 'Pace', value: 89 }, …],  // six summary stats
//   badges?: [{ id: 'finisher', label: 'Clinical Finish' }],
// }
import { RATING_GROUPS, categoryRating } from '../../core/players/ratings.js';
import { BADGES } from '../../core/players/traits.js';

const GROUP = Object.fromEntries(RATING_GROUPS.map(g => [g.id, g]));
const OUTFIELD = [
  ['PAC', 'pace'],
  ['SHO', 'shooting'],
  ['PAS', 'passing'],
  ['DRI', 'control'],
  ['DEF', 'defending'],
  ['PHY', 'physical'],
];
const KEEPER = [
  ['GK', 'goalkeeping'],
  ['PAS', 'passing'],
  ['DRI', 'control'],
  ['PAC', 'pace'],
  ['DEF', 'defending'],
  ['PHY', 'physical'],
];
const BADGE_LABEL = Object.fromEntries(BADGES.map(b => [b.id, b.label]));

/** Six FC-style summary stats from engine attributes (keepers lead with GK). */
export function summaryStats(attrs, position) {
  if (!attrs) return [];
  return (position === 'GK' ? KEEPER : OUTFIELD).map(([key, group]) => ({
    key,
    label: GROUP[group].label,
    value: categoryRating({ attrs }, GROUP[group]),
  }));
}

/**
 * Build a PlayerView from a catalog player record.
 *   context.team    catalog team { name, primary, secondary }
 *   context.league  catalog league { name, logo, tier }
 *   context.nation  { name, code } (catalog.nations entry) — falls back to source.nationality
 */
export function playerView(p, { team, league, nation } = {}) {
  const position = p.primaryPosition || p.position || p.role;
  return {
    id: p.profileId ?? p.id,
    name: p.name,
    fullName: p.fullName,
    position,
    positions: [position, ...(p.secondaryPositions || [])].filter(Boolean),
    ovr: p.overall ?? p.sourceOverall ?? p.ovr,
    nation: nation || (p.source?.nationality ? { name: p.source.nationality } : undefined),
    club: team
      ? { name: team.name, colors: [team.primary, team.secondary].filter(Boolean) }
      : p.source?.club
        ? { name: p.source.club }
        : undefined,
    league: league ? { name: league.name, logo: league.logo, tier: league.tier } : undefined,
    stats: summaryStats(p.attrs, position),
    badges: (p.tags || []).map(id => ({ id, label: BADGE_LABEL[id] || id })),
  };
}

/**
 * Catalog-bound converter: const toView = makePlayerView(await loadCatalog()); toView(p).
 * Resolves club colours, league logo/tier and the nation's flag code
 * (catalog.nations[] by p.source.nationality). Club-less players get no club/league.
 * Results are cached per player object.
 */
export function makePlayerView(catalog) {
  const nations = new Map((catalog.nations || []).map(n => [n.name, n]));
  const teams = new Map((catalog.teams || []).map(t => [t.id, t]));
  const leagues = new Map((catalog.leagues || []).map(l => [l.id, l]));
  const cache = new WeakMap();
  return p => {
    if (cache.has(p)) return cache.get(p);
    const team = p.source?.clubId != null ? teams.get(p.source.clubId) : undefined;
    const nation = nations.get(p.source?.nationality);
    const view = playerView(p, {
      team,
      league: leagues.get(p.source?.leagueId ?? team?.leagueId),
      nation: nation ? { name: nation.name, code: nation.code } : undefined,
    });
    cache.set(p, view);
    return view;
  };
}

/** Last word of the short name for tight spaces: 'M. Salah' → 'Salah', 'Vinícius Jr.' kept. */
export function surname(name = '') {
  const clean = String(name)
    .replace(/^(?:\p{L}\.\s*)+/u, '')
    .trim();
  return clean || String(name);
}
