// Legends and Prime versions from the past editions (FIFA 15–23, the legacy source), compiled
// through the same compiler as the current players (compilePlayer: attribute mapping,
// tendencies, badges). Every threshold is in the rating the game shows on a card (its own
// rating model, overallRating at the primary position), not EA's overall — what the player
// sees is what the rule says.
//   * Best version of a player = his highest shown rating; ties → the higher EA overall, then
//     the latest edition.
//   * Legend = a best version shown at LEGEND_MINIMUM or more, of
//       – a player who is NOT in the current catalog, or
//       – a catalog player whose current card shows less (`legendOf` = his catalog profileId;
//         however far apart the two are — if today's card is his best he is a normal pick).
//     He has today's name of his nation and the positions of that edition, and its club when
//     that club is in the catalog (same sofifa team id), so he links with club mates; otherwise
//     he has no club. A catalog player's legend carries his catalog name.
//   * Prime version of a current catalog player: stored when his best version shows at least
//     PRIME_GAP more than his current card, or PRIME_MINIMUM or more (and more than now).
//   * The year of a version is the year of its ratings snapshot (`fifa_update_date`): release
//     ratings come out the autumn before the edition's number (FIFA 19: 2018), the last
//     ratings of a cycle in the year of the number.
// Composure does not exist before FIFA 17: a FIFA 15/16 version takes the player's composure
// from his nearest later edition; a player who never got one takes his reactions (EA's closest
// mental attribute) — recorded in inference.composure. Deterministic; nothing is invented.
import { compilePlayer } from './compile-players.mjs';
import { overallRating } from '../app/core/players/ratings.js';
import { normalizeBadges } from '../app/core/players/badges.js';
import { explicitEvidence } from '../app/core/players/catalog-derived.js';

export const LEGEND_MINIMUM = 85;
export const PRIME_GAP = 2;
export const PRIME_MINIMUM = 88;
// Which versions are compiled to find the best one: the game's rating is never this far above
// EA's overall (the most among the compiled versions is +6, for low-rated players), so a
// version EA rated this far below the rating it has to beat cannot be the one. Checked, not
// assumed: the build fails if a compiled version comes within two points of the margin.
export const SHOWN_MARGIN = 10;
export const LEGACY = {
  url: 'https://huggingface.co/datasets/jsulz/FIFA23',
  author: 'jsulz',
  upstream: 'SoFIFA / EA SPORTS FIFA 15–23 (career mode)',
  license: 'MIT',
  licenseUrl: 'https://huggingface.co/datasets/jsulz/FIFA23/blob/main/README.md',
};
/** The rules in words, for the file's `selection` block. */
export const SELECTION = {
  bestVersion:
    'Highest rating as the game shows it; ties: the higher EA overall, then the latest edition',
  legends: `Best versions shown ${LEGEND_MINIMUM}+: players who are not in the catalog, and catalog players whose current card shows less; of a catalog nation; the club of that edition when it is in the catalog`,
  primes: `Catalog players whose best version shows ${PRIME_GAP}+ more than their current card, or ${PRIME_MINIMUM}+ and more than now`,
  year: 'The year of the ratings snapshot (fifa_update_date)',
  composure: 'FIFA 15/16 have no composure: taken from the nearest later edition, else reactions',
  legendMinimum: LEGEND_MINIMUM,
  primeGap: PRIME_GAP,
  primeMinimum: PRIME_MINIMUM,
};

const int = (row, key) => Number(row[key]);
const shown = p => overallRating(p, true, p.primaryPosition);

/** The year of a row's ratings snapshot; the build fails without one. */
function snapshotYear(row) {
  const m = /^(\d{4})-\d{2}-\d{2}/.exec(row.fifa_update_date || '');
  if (!m)
    throw Error(
      `${row.short_name} (FIFA ${row.fifa_version}): no snapshot date (fifa_update_date "${row.fifa_update_date}"), so the year of this version is unknown`,
    );
  return Number(m[1]);
}

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
 * @param hash SHA-256 of the legacy CSV
 * @returns {{ legends, primes, stats }} runtime players, each with `edition` and `year`; a
 *   catalog player's legend carries `legendOf`, a prime `primeOf` (the current player's
 *   profileId) and no name, club or nation (those are the current player's)
 */
export function compileLegends(legacyRows, catalog, hash = null) {
  const versions = new Map(), // player id → [{ row, index }] in source order
    composure = new Map(); // player id → [[edition, composure]] of the editions that have one
  legacyRows.forEach((row, index) => {
    const id = row.player_id;
    if (!versions.has(id)) versions.set(id, []);
    versions.get(id).push({ row, index });
    if (row.mentality_composure !== '') {
      if (!composure.has(id)) composure.set(id, []);
      composure.get(id).push([int(row, 'fifa_version'), row.mentality_composure]);
    }
  });
  const teams = new Map(catalog.teams.map(t => [String(t.id), t])),
    current = new Map(catalog.players.map(p => [String(p.sourcePlayerId), p]));
  // Nation names as today's catalog spells them (Türkiye, Czechia…): the nation most catalog
  // players of a past nationality id have today (the current source carries no ids).
  const nationVotes = new Map();
  for (const [id, list] of versions) {
    const now = current.get(id);
    if (!now) continue;
    const key = list.at(-1).row.nationality_id;
    if (!nationVotes.has(key)) nationVotes.set(key, new Map());
    const votes = nationVotes.get(key);
    votes.set(now.source.nationality, (votes.get(now.source.nationality) || 0) + 1);
  }
  const nationNames = new Map(
    [...nationVotes].map(([key, votes]) => [key, [...votes].sort((a, b) => b[1] - a[1])[0][0]]),
  );
  // A legend needs a nation of the catalog (its flag ships, its players can be his mates).
  const nations = new Set(catalog.players.map(p => p.source.nationality));
  const stats = {
    pureLegends: 0,
    currentLegends: 0,
    composureFromLaterEdition: 0,
    composureFromReactions: 0,
    versionsCompiled: 0,
    shownAboveSource: 0,
    otherNations: [],
  };
  const compile = ({ row, index }, suffix, count = false) => {
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
      if (count) stats[later ? 'composureFromLaterEdition' : 'composureFromReactions']++;
    }
    const p = compilePlayer(source, index + 1, {
      suffix,
      source: LEGACY,
      inference: note ? { composure: note } : {},
    });
    p.source.sha256 = hash;
    return p;
  };
  // The best version that shows more than `floor`: every version EA rated above
  // floor − SHOWN_MARGIN is compiled and rated as the game rates it.
  const bestVersion = (list, floor) => {
    let best = null;
    for (const entry of list) {
      const overall = int(entry.row, 'overall');
      if (overall <= floor - SHOWN_MARGIN) continue;
      const rating = shown(compile(entry, 'legend')),
        edition = int(entry.row, 'fifa_version');
      stats.versionsCompiled++;
      stats.shownAboveSource = Math.max(stats.shownAboveSource, rating - overall);
      if (
        !best ||
        rating > best.rating ||
        (rating === best.rating &&
          (overall > best.overall || (overall === best.overall && edition > best.edition)))
      )
        best = { entry, rating, overall, edition };
    }
    return best && best.rating > floor ? best : null;
  };
  const legends = [],
    primes = [];
  const legend = (best, extra, nationality) => {
    const { row } = best.entry,
      p = compile(best.entry, 'legend', true),
      team = teams.get(String(row.club_team_id));
    legends.push(
      runtimePlayer(p, {
        ...extra,
        year: snapshotYear(row),
        source: { clubId: team ? team.id : null, nationality },
      }),
    );
  };
  for (const [id, list] of versions) {
    const now = current.get(id);
    if (!now) {
      const best = bestVersion(list, LEGEND_MINIMUM - 1);
      if (!best) continue;
      const { row } = best.entry,
        nationality = nationNames.get(row.nationality_id) ?? row.nationality_name;
      if (!nations.has(nationality)) {
        stats.otherNations.push(`${row.short_name} ${best.rating} (${nationality})`);
        continue;
      }
      legend(best, {}, nationality);
      stats.pureLegends++;
      continue;
    }
    const today = shown(now),
      best = bestVersion(list, today);
    if (!best) continue;
    if (best.rating >= LEGEND_MINIMUM) {
      // His best version is a Legend-spin option: the same player, so the same name and nation.
      legend(
        best,
        { name: now.name, fullName: now.fullName, legendOf: now.profileId },
        now.source.nationality,
      );
      stats.currentLegends++;
    }
    if (best.rating >= today + PRIME_GAP || best.rating >= PRIME_MINIMUM) {
      const p = compile(best.entry, 'prime', best.rating < LEGEND_MINIMUM);
      const { name, fullName, ...prime } = runtimePlayer(p, {
        year: snapshotYear(best.entry.row),
        primeOf: now.profileId,
      });
      primes.push(prime);
    }
  }
  if (stats.shownAboveSource > SHOWN_MARGIN - 2)
    throw Error(
      `A version shows ${stats.shownAboveSource} above EA's overall: raise SHOWN_MARGIN (${SHOWN_MARGIN}) in compile-legends.mjs`,
    );
  const id = p => Number(p.profileId.split(':')[1]);
  const rated = new Map(legends.map(p => [p, shown(p)]));
  // Best first as the game shows them, then EA's overall, then the id.
  legends.sort(
    (a, b) => rated.get(b) - rated.get(a) || b.sourceOverall - a.sourceOverall || id(a) - id(b),
  );
  const order = new Map(catalog.players.map((p, i) => [p.profileId, i]));
  primes.sort((a, b) => order.get(a.primeOf) - order.get(b.primeOf));
  return { legends, primes, stats };
}
