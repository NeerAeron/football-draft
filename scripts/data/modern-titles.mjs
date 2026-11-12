// FC 24, FC 25 and FC 26: the three titles between the legacy file (FIFA 15–23) and today's
// catalog (FC 27), each from its own pinned public file (scripts/data/paths.mjs), as rows in
// the column names of the legacy file — what scripts/compile-legends.mjs reads.
//   FC 24  sofifa-style career-mode file (FIFA 15 … FC 24, launch ratings): the FC 24 rows.
//   FC 25  EA's ratings feed at launch (the same feed as the FC 27 source, older column
//          names): no ids for clubs, leagues or nations and no date. The player id is the last
//          part of the ratings page address; a club is the one data/source-map.json knows by
//          that league and name (else by its name alone, when only one club has it); an
//          outfielder's goalkeeping columns are empty in the feed and get the low value
//          outfielders have (OUTFIELD_KEEPING_DEFAULT) — a keeper's are EA's.
//   FC 26  sofifa-style file of 21 September 2025: as it is.
// Nothing is rated here: values are the files'.
import { scanCSV } from '../compile-players.mjs';
import { clubKey } from './ea-source.mjs';
import { OUTFIELD_KEEPING_DEFAULT, SKILL_FIELDS } from './legacy-titles.mjs';

// The columns of a sofifa-style file the compiler reads (a row of all 110 is five times the
// memory, and the build holds four titles of them).
const COLUMNS = [
  'player_id',
  'fifa_version',
  'fifa_update',
  'short_name',
  'long_name',
  'player_positions',
  'overall',
  'dob',
  'club_team_id',
  'club_name',
  'league_id',
  'league_name',
  'league_level',
  'club_jersey_number',
  'nationality_id',
  'nationality_name',
  'preferred_foot',
  'weak_foot',
  'player_tags',
  'player_traits',
  ...SKILL_FIELDS,
  'goalkeeping_diving',
  'goalkeeping_handling',
  'goalkeeping_kicking',
  'goalkeeping_positioning',
  'goalkeeping_reflexes',
];
/**
 * The rows of a sofifa-style file with the columns the compiler reads (`edition`: only that
 * title's rows; null: all). Also reads the legacy file (FIFA 15–23).
 */
export function sofifaRows(text, edition = null, dateColumn = 'fifa_update_date') {
  const rows = [];
  let at = null;
  scanCSV(text, (values, header) => {
    at ??= [...COLUMNS, dateColumn].map(name => {
      const i = header.indexOf(name);
      if (i < 0) throw Error(`sofifa-style file: no column ${name}`);
      return i;
    });
    if (edition != null && Number(values[at[1]]) !== edition) return;
    const row = {};
    for (let i = 0; i < COLUMNS.length; i++) row[COLUMNS[i]] = values[at[i]];
    row.fifa_version = String(Number(row.fifa_version));
    row.fifa_update = String(Number(row.fifa_update));
    row.fifa_update_date = values[at[COLUMNS.length]];
    rows.push(row);
  });
  return rows;
}
/** The FC 24 rows of the career-mode file (its other titles are the legacy file's). */
export const fc24Rows = text => sofifaRows(text, 24, 'update_as_of');

const FC25_SKILLS = {
  movement_sprint_speed: 'Sprint Speed',
  movement_acceleration: 'Acceleration',
  attacking_finishing: 'Finishing',
  power_shot_power: 'Shot Power',
  power_long_shots: 'Long Shots',
  mentality_penalties: 'Penalties',
  attacking_heading_accuracy: 'Heading Accuracy',
  attacking_short_passing: 'Short Passing',
  skill_long_passing: 'Long Passing',
  attacking_crossing: 'Crossing',
  mentality_vision: 'Vision',
  skill_dribbling: 'Dribbling',
  skill_ball_control: 'Ball Control',
  mentality_composure: 'Composure',
  defending_standing_tackle: 'Standing Tackle',
  defending_marking_awareness: 'Def Awareness',
  movement_reactions: 'Reactions',
  power_stamina: 'Stamina',
  power_strength: 'Strength',
  mentality_aggression: 'Aggression',
  mentality_positioning: 'Positioning',
  skill_curve: 'Curve',
};
const FC25_KEEPING = {
  goalkeeping_diving: 'GK Diving',
  goalkeeping_handling: 'GK Handling',
  goalkeeping_kicking: 'GK Kicking',
  goalkeeping_positioning: 'GK Positioning',
  goalkeeping_reflexes: 'GK Reflexes',
};

/**
 * The FC 25 feed's rows as compiler rows.
 * @param rows parsed rows of the feed
 * @param map data/source-map.json (the feed's club and nation names → the reference)
 */
export function fc25Rows(rows, map) {
  // A club by its name alone: only when every league that has the name means the same club.
  const byName = new Map();
  for (const [key, id] of Object.entries(map.clubs)) {
    const name = key.slice(key.indexOf(' | ') + 3);
    byName.set(name, byName.has(name) && byName.get(name) !== id ? null : id);
  }
  return rows.map(r => {
    const id = /\/(\d+)\/?$/.exec(r.url)?.[1];
    if (!id) throw Error(`FC 25: no player id in "${r.url}" (${r.Name})`);
    const club = map.clubs[clubKey(r.League, r.Team)] ?? byName.get(r.Team) ?? null,
      row = {
        player_id: id,
        fifa_version: '25',
        fifa_update: '1',
        fifa_update_date: '', // the feed has no date: launch ratings (see compile-legends)
        short_name: r.Name.trim(),
        long_name: r.Name.trim(),
        player_positions: [r.Position, ...r['Alternative positions'].split(',')]
          .map(s => s.trim())
          .filter(Boolean)
          .join(', '),
        overall: r.OVR,
        dob: '',
        nationality_id: '',
        nationality_name: map.nations[r.Nation] ?? r.Nation,
        club_name: club ? r.Team : '',
        club_team_id: club ? String(club) : '',
        preferred_foot: r['Preferred foot'],
        weak_foot: r['Weak foot'],
        player_traits: r['play style'],
        player_tags: '',
      };
    for (const [field, column] of Object.entries(FC25_SKILLS)) row[field] = r[column];
    for (const [field, column] of Object.entries(FC25_KEEPING))
      row[field] =
        r[column] === '' ? String(OUTFIELD_KEEPING_DEFAULT) : String(Math.round(Number(r[column])));
    return row;
  });
}

/** FC 26: sofifa-style, one row per player. */
export function fc26Rows(text) {
  const rows = sofifaRows(text, 26, 'fifa_update_date');
  if (!rows.length) throw Error('FC 26 file: no rows of version 26');
  return rows;
}
