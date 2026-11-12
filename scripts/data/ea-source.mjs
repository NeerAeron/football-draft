// The current-player source (EA's ratings feed: one row per player, 60 columns, club and
// league by name only) → the rows the compiler reads (the column names of the sofifa-style
// sources the past editions still use). Clubs, leagues and nations are tied to the game's
// reviewed reference through data/source-map.json, which `npm run data:reconcile` maintains.
export const MEN = "Men's Football";
export const clubKey = (league, club) => `${league} | ${club}`;

/** '12-09-2026' → '2026-09-12'. */
export const isoDate = date => date.split('-').reverse().join('-');

/** sofifa-style short name: EA's common name, else initial + surname ("K. Mbappé"). */
export const shortName = row =>
  row.common_name.trim() || `${row.first_name.trim()[0]}. ${row.last_name.trim()}`;

/** Men's rows of the feed (the game has no women's catalog). */
export const menOf = rows => rows.filter(r => r.gender === MEN);

/**
 * @param rows parsed rows of the feed
 * @param map data/source-map.json: { leagues: { name → reference league id | null },
 *   clubs: { "league | club" → reference team id }, nations: { name → catalog nation name } }
 * @param reference data/catalog-reference.json
 * @returns compiler rows. A player whose club has no reviewed entry gets no club and no league
 *   (he can join nation pools only).
 */
export function adaptSource(rows, map, reference) {
  const clubs = new Map(reference.clubs.map(c => [String(c.sourceTeamId), c])),
    leagues = new Map(
      reference.leagues.filter(l => l.sourceLeagueId != null).map(l => [l.sourceLeagueId, l]),
    );
  return menOf(rows).map(r => {
    const club = clubs.get(String(map.clubs[clubKey(r.league, r.club)])),
      // The league the feed names; competitions that are not leagues (continental cups) leave
      // the club in the league the reference has it in.
      league = club ? leagues.get(map.leagues[r.league] ?? club.sourceLeagueId) : null,
      known = club && league?.available ? club : null;
    return {
      ...r,
      short_name: shortName(r),
      long_name: `${r.first_name.trim()} ${r.last_name.trim()}`.trim(),
      overall: r.overall_rating,
      player_positions: [r.position, ...r.alternate_positions.split(' ')]
        .filter(Boolean)
        .join(', '),
      nationality_name: map.nations[r.nationality] ?? r.nationality,
      club_name: known ? known.name : '',
      club_team_id: known ? String(known.sourceTeamId) : '',
      league_id: known ? league.sourceLeagueId : '',
      league_name: known ? league.name : '',
      league_level: '',
      club_jersey_number: '',
      defending_marking_awareness: r.defending_awareness,
      player_traits: r.playstyles,
      player_tags: '',
      fifa_version: r.edition.replace(/^fc/i, ''),
      fifa_update: isoDate(r.snapshot_date).replaceAll('-', ''),
      fifa_update_date: isoDate(r.snapshot_date),
    };
  });
}
