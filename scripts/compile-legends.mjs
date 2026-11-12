// Legends and Prime versions from the past editions (FIFA 15–23, the legacy source), compiled
// through the same compiler as the current players (compilePlayer: attribute mapping,
// tendencies, badges).
//   * Best version of a player = his highest overall; ties → the latest edition.
//   * Legend = a player who is NOT in the current catalog, best overall >= LEGEND_MINIMUM. He
//     keeps the nationality and positions of that edition, and its club when that club is in the
//     catalog (same sofifa team id), so he links with club mates; otherwise he has no club.
//   * Prime version of a current catalog player: stored when his best past overall is at least
//     PRIME_GAP above his current one, or is PRIME_MINIMUM or more (and higher than now).
// Composure does not exist before FIFA 17: a FIFA 15/16 version takes the player's composure
// from his nearest later edition; a player who never got one takes his reactions (EA's closest
// mental attribute) — recorded in inference.composure. Deterministic; nothing is invented.
import { compilePlayer } from './compile-players.mjs';
import { overallRating } from '../app/core/players/ratings.js';
import { normalizeBadges } from '../app/core/players/badges.js';
import { explicitEvidence } from '../app/core/players/catalog-derived.js';

export const LEGEND_MINIMUM = 83;
export const PRIME_GAP = 3;
export const PRIME_MINIMUM = 88;
export const LEGACY = {
  url: 'https://huggingface.co/datasets/jsulz/FIFA23',
  author: 'jsulz',
  upstream: 'SoFIFA / EA SPORTS FIFA 15–23 (career mode)',
  license: 'MIT',
  licenseUrl: 'https://huggingface.co/datasets/jsulz/FIFA23/blob/main/README.md',
};

const int = (row, key) => Number(row[key]);
const better = (a, b) =>
  int(a, 'overall') > int(b, 'overall') ||
  (int(a, 'overall') === int(b, 'overall') && int(a, 'fifa_version') > int(b, 'fifa_version'));
const shown = p => overallRating(p, true, p.primaryPosition);

/** The fields the game uses of a compiled profile (as toRuntimeCatalog keeps them). */
function runtimePlayer(p, extra) {
  const player = {
    profileId: p.profileId,
    name: p.name,
    fullName: p.fullName,
    primaryPosition: p.primaryPosition,
    secondaryPositions: [...p.secondaryPositions],
    attrs: { ...p.attrs },
    foot: p.foot,
    weakFoot: p.weakFoot,
    tendencies: { ...p.tendencies },
    tags: [...p.tags],
    sourceOverall: p.sourceOverall,
    edition: Number(p.profileId.split(':')[2].slice(2)),
    ...extra,
    inference: { badges: explicitEvidence(p) },
  };
  player.tags = normalizeBadges(player, player.tags);
  return player;
}

/**
 * @param legacyRows parsed rows of the legacy CSV (every edition of every player)
 * @param catalog the compiled current catalog (compileLeagueCatalog output)
 * @param currentRows parsed rows of the current CSV (nationality ids → today's nation names)
 * @param hash SHA-256 of the legacy CSV
 * @returns {{ legends, primes, stats }} runtime players; a prime carries `primeOf` (the current
 *   player's profileId) and no name, club or nation (those are the current player's)
 */
export function compileLegends(legacyRows, catalog, currentRows, hash = null) {
  const best = new Map(),
    composure = new Map(); // player id → [[edition, composure]] of the editions that have one
  legacyRows.forEach((row, index) => {
    const id = row.player_id,
      held = best.get(id);
    if (!held || better(row, held.row)) best.set(id, { row, index });
    if (row.mentality_composure !== '') {
      if (!composure.has(id)) composure.set(id, []);
      composure.get(id).push([int(row, 'fifa_version'), row.mentality_composure]);
    }
  });
  // Nation names as today's catalog spells them (Türkiye, Czechia…), by sofifa nationality id.
  const nationNames = new Map(currentRows.map(r => [r.nationality_id, r.nationality_name]));
  const teams = new Map(catalog.teams.map(t => [String(t.id), t])),
    current = new Map(catalog.players.map(p => [String(p.sourcePlayerId), p]));
  // A legend needs a nation of the catalog (its flag ships, its players can be his mates).
  const nations = new Set(catalog.players.map(p => p.source.nationality));
  const stats = { composureFromLaterEdition: 0, composureFromReactions: 0, otherNations: [] };
  const compile = ({ row, index }, suffix) => {
    let source = row,
      note = null;
    if (row.mentality_composure === '') {
      const version = int(row, 'fifa_version'),
        later = (composure.get(row.player_id) || [])
          .filter(([v]) => v > version)
          .sort((a, b) => a[0] - b[0])[0];
      source = { ...row, mentality_composure: later ? later[1] : row.movement_reactions };
      note = later
        ? `FIFA ${later[0]} (no composure before FIFA 17)`
        : 'reactions (no composure before FIFA 17)';
      stats[later ? 'composureFromLaterEdition' : 'composureFromReactions']++;
    }
    const p = compilePlayer(source, index + 1, {
      suffix,
      source: LEGACY,
      inference: note ? { composure: note } : {},
    });
    p.source.sha256 = hash;
    return p;
  };
  const legends = [],
    primes = [];
  for (const [id, entry] of best) {
    const overall = int(entry.row, 'overall'),
      now = current.get(id);
    if (!now) {
      if (overall < LEGEND_MINIMUM) continue;
      const nationality = nationNames.get(entry.row.nationality_id) ?? entry.row.nationality_name;
      if (!nations.has(nationality)) {
        stats.otherNations.push(`${entry.row.short_name} ${overall} (${nationality})`);
        continue;
      }
      const p = compile(entry, 'legend'),
        team = teams.get(String(entry.row.club_team_id));
      legends.push(
        runtimePlayer(p, {
          source: { clubId: team ? team.id : null, nationality },
        }),
      );
    } else if (
      overall >= now.sourceOverall + PRIME_GAP ||
      (overall >= PRIME_MINIMUM && overall > now.sourceOverall)
    ) {
      const p = compile(entry, 'prime');
      // The rating the game shows must go up too (it weighs the attributes itself).
      if (shown(p) <= shown(now)) continue;
      const { name, fullName, ...prime } = runtimePlayer(p, { primeOf: now.profileId });
      primes.push(prime);
    }
  }
  const id = p => Number(p.profileId.split(':')[1]);
  legends.sort((a, b) => b.sourceOverall - a.sourceOverall || id(a) - id(b));
  const order = new Map(catalog.players.map((p, i) => [p.profileId, i]));
  primes.sort((a, b) => order.get(a.primeOf) - order.get(b.primeOf));
  return { legends, primes, stats };
}
