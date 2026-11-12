// FIFA 98–14: the pinned file data/legacy-titles.json (tools/research/legacy-titles.py copies
// it out of the workbook, values unchanged: the squad players of each title, per nationality
// the first 36 outfielders and 4 keepers of the workbook's ranking) read into one record per
// player and title, with the name parts data/legacy-names.json has for the best known. This
// module only decodes what the titles say — names, teams, positions, feet and which skill of a
// title stands for which of today's attributes. Putting those skills on today's scale is the
// job of scripts/legends-calibration.mjs.
//
// What a title does not have is derived from its nearest skills (FIELDS below, one table for
// all titles); nothing is typed in per player.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

/** The compiler's source columns a card is built from (see `fields` in compile-players.mjs). */
export const SKILL_FIELDS = [
  'movement_sprint_speed',
  'movement_acceleration',
  'attacking_finishing',
  'power_shot_power',
  'power_long_shots',
  'mentality_penalties',
  'attacking_heading_accuracy',
  'attacking_short_passing',
  'skill_long_passing',
  'attacking_crossing',
  'mentality_vision',
  'skill_dribbling',
  'skill_ball_control',
  'mentality_composure',
  'defending_standing_tackle',
  'defending_marking_awareness',
  'movement_reactions',
  'power_stamina',
  'power_strength',
  // Tendencies only (no attribute of the card): the neutral value when a title has nothing.
  'mentality_aggression',
  'mentality_positioning',
  'skill_curve',
];
const NEUTRAL = { mentality_aggression: 60, mentality_positioning: 65 };

// Which skills of a title make each field: a name, or several (their mean). The first entry
// whose skills the title has is used, so one table serves every title; `null` = the neutral
// value. Order: the skill itself under its names over the years, then the nearest ones.
const FIELDS = {
  movement_sprint_speed: [['sprintspeed'], ['pace'], ['speed'], ['Speed']],
  movement_acceleration: [['acceleration'], ['speed'], ['Speed']],
  attacking_finishing: [['finishing'], ['shotaccuracy'], ['shot_accuracy'], ['shooting'], ['Shooting']],
  power_shot_power: [['shotpower'], ['shot_power'], ['shooting'], ['Shooting']],
  power_long_shots: [
    ['longshots'],
    ['longshotaccuracy'],
    ['shotaccuracy', 'shotpower'],
    ['shot_accuracy', 'shot_power'],
    ['shooting'],
    ['Shooting'],
  ],
  mentality_penalties: [
    ['penalties'],
    ['finishing', 'freekicks'],
    ['shotaccuracy'],
    ['shot_accuracy'],
    ['shooting'],
    ['Shooting'],
  ],
  attacking_heading_accuracy: [['headingaccuracy'], ['heading'], ['Heading']],
  attacking_short_passing: [['shortpassing'], ['passing'], ['Passing']],
  skill_long_passing: [['longpassing'], ['longballs'], ['passing'], ['Passing']],
  attacking_crossing: [['crossing'], ['passing'], ['Passing']],
  mentality_vision: [
    ['vision'],
    ['creativity'],
    ['shortpassing', 'longpassing'],
    ['passing', 'longballs'],
    ['passing', 'awareness'],
    ['passing'],
    ['Passing'],
  ],
  skill_dribbling: [['dribbling'], ['ball_control'], ['Ball_Control']],
  skill_ball_control: [['ballcontrol'], ['ball_control'], ['Ball_Control']],
  // FIFA 11–14 have no composure: compile-legends takes it from the player's nearest edition
  // that has one, and only then this (his reactions).
  mentality_composure: [
    ['playercomposure'],
    ['reactions'],
    ['anticipation'],
    ['reaction'],
    ['awareness'],
    ['ball_control'],
    ['Ball_Control'],
  ],
  defending_standing_tackle: [['standingtackle'], ['tackling'], ['Tackling']],
  defending_marking_awareness: [['marking'], ['awareness'], ['tackling'], ['Tackling']],
  movement_reactions: [
    ['reactions'],
    ['anticipation'],
    ['reaction'],
    ['awareness'],
    ['tackling'],
    ['Tackling'],
  ],
  power_stamina: [['stamina'], ['fitness'], ['Fitness']],
  power_strength: [['strength'], ['Strength'], ['heading', 'shot_power']],
  mentality_aggression: [['aggression'], null],
  mentality_positioning: [['positioning'], ['reactions'], ['anticipation'], ['reaction'], null],
  skill_curve: [['curve'], ['freekicks'], ['crossing'], ['passing'], ['Passing']],
};
// A keeper's one number: the stored overall (FIFA 09–14), before that the mean of the title's
// keeper skills — FIFA 98/99 have none, so the skills a keeper lives on stand in. A title
// rates keepers (`keeperRated`) when it has at least KEEPER_SKILLS real keeper skills.
const KEEPER = [
  ['gkdiving', 'gkhandling', 'gkreflexes', 'gkpositioning'],
  ['gkdiving', 'handling', 'reflexes', 'gkpositioning'],
  ['handling', 'reflexes', 'gkpositioning'],
  ['handling', 'reflexes'],
  ['gk_skills', 'gk_positioning'],
  ['x_gskills', 'x_gpositioning'],
  ['reaction', 'agility', 'awareness'],
];
const KEEPER_SKILLS = 3,
  KEEPER_STAND_INS = KEEPER.at(-1);
// An outfielder's goalkeeping: the title's keeper skills where they mean something for him
// (FIFA 07–14), else the low value outfielders have there.
const OUTFIELD_KEEPING = [
  ['gkdiving', 'gkhandling', 'gkkicking', 'gkpositioning', 'gkreflexes'],
  ['gkdiving', 'handling', 'reflexes', 'gkpositioning'],
];
export const OUTFIELD_KEEPING_DEFAULT = 10;

// Position labels of the titles → the game's positions. Wing midfielders and the wide
// forwards of FIFA 2004–11 are wingers (Cristiano Ronaldo and Messi are RWM / RF there); the
// left and right forwards of the earlier titles are the two strikers of a 4-4-2.
const POSITION = {
  GK: 'GK',
  SW: 'CB',
  CB: 'CB',
  RCB: 'CB',
  LCB: 'CB',
  AB: 'CB',
  RB: 'RB',
  RWB: 'RB',
  LB: 'LB',
  LWB: 'LB',
  DM: 'DM',
  CDM: 'DM',
  RDM: 'DM',
  LDM: 'DM',
  RCDM: 'DM',
  LCDM: 'DM',
  CM: 'CM',
  RCM: 'CM',
  LCM: 'CM',
  AM: 'AM',
  CAM: 'AM',
  RCAM: 'AM',
  LCAM: 'AM',
  RAM: 'RM',
  LAM: 'LM',
  RM: 'RM',
  LM: 'LM',
  RWM: 'RW',
  LWM: 'LW',
  RW: 'RW',
  LW: 'LW',
  CF: 'ST',
  ST: 'ST',
  RS: 'ST',
  LS: 'ST',
  RCF: 'ST',
  LCF: 'ST',
  RF: 'ST',
  LF: 'ST',
};
// FIFA 2004 and later tell a centre forward (CF: the second striker, the false nine — Totti,
// Raúl, Rooney, the Messi of 2011–14) from a striker (ST): he is a striker or a No. 10,
// whichever the game rates higher with his skills (`secondStriker`, decided by the caller).
const WIDE_FORWARD = { RF: ['RW', 'ST'], LF: ['LW', 'ST'], CF: ['ST', 'AM'] };
// Position codes of the secondary positions: FIFA 2002–10 and FIFA 11–14.
const CODES_2002 =
  'GK SW RWB RB RCB CB LCB LB LWB RDM RCDM CDM LCDM LDM RWM RM RCM CM LCM LM LWM RAM RCAM CAM LCAM LAM RF CF LF RS ST LS'.split(
    ' ',
  );
const CODES_2011 =
  'GK SW RWB RB RCB CB LCB LB LWB RDM CDM LDM RM RCM CM LCM LM RAM CAM LAM RF CF LF RW RS ST LS LW'.split(
    ' ',
  );
// Squads that are not a club or a national team: all-time and all-star selections, sponsor
// and developer teams, the unlicensed stand-in national team of FIFA 08/09 (invented names)
// and, in FIFA 2000, the classic teams ("Brazil 1970", "Milan 88-90").
const REPRESENTATIVE = new Set([
  'Classic XI',
  'World XI',
  'Adidas',
  'MLS All Stars',
  'Special Guests',
  'Holland-FAKE',
  'EA 1',
  'EA 2',
  'EA 3',
  'EA 4',
]);
const CLASSIC_2000 = /\s(?:1[89]\d\d|\d\d-\d\d)$/;
const NO_CLUB = new Set(['NG - FA']); // national-team players without a licensed club
export const isRepresentative = (team, edition) =>
  REPRESENTATIVE.has(team) || (edition === 0 && CLASSIC_2000.test(team));

// Invented names EA gave a player it had no licence for, under an id of their own: the rows
// are the real player's (same club, nation and birth year; the day and month swapped), and
// the invented name is never shown. "Teodor Petrovici" (FIFA 07) and "Andrei Murgu"
// (FIFA 08–13) are Adrian Mutu.
const ALIASES = new Map([
  [177848, 21195],
  [184410, 21195],
]);
// An unlicensed stand-in ("No 9", "No. 11") is not a name either.
const STAND_IN = /^no\.?\s*\d+$/i;

const TRAITS = {
  comesforcrosses: 'Comes For Crosses',
  divesintotackles: 'Dives Into Tackles (AI)',
  earlycrosser: 'Early Crosser',
  longshottaker: 'Long Shot Taker (AI)',
  playmaker: 'Playmaker (AI)',
  rushesoutofgoal: 'Rushes Out Of Goal',
  technicaldribbler: 'Technical Dribbler (AI)',
};

const mean = (row, keys) => keys.reduce((s, k) => s + row[k], 0) / keys.length;
const pick = (table, columns) => table.find(keys => keys === null || keys.every(k => columns.has(k)));

function positions(row, edition) {
  const label = row.ranking_position,
    primary = POSITION[label];
  if (!primary) throw Error(`FIFA ${edition}: unknown position ${label}`);
  const wide = edition >= 4 && edition < 90 ? WIDE_FORWARD[label] : null,
    list = wide ? [...wide] : [primary],
    codes = edition >= 11 && edition < 90 ? CODES_2011 : edition >= 2 && edition < 90 ? CODES_2002 : null;
  if (codes) {
    for (const key of ['preferredposition2', 'preferredposition3', 'preferredposition4']) {
      const other = row[key] >= 0 ? POSITION[codes[row[key]]] : null;
      if (other && !list.includes(other)) list.push(other);
    }
  }
  return list;
}

// 'left' | 'right' | null (the title does not say: FIFA 98–2002, and the "either foot" of
// FIFA 2003/04, which has Rivaldo and Raúl in it — compile-legends then takes the foot of the
// player's nearest other version).
function foot(row, edition) {
  if ('Foot' in row) return [`left`, 'right', null][row.Foot];
  if (!('preferredfoot' in row)) return null;
  if (edition >= 11) return row.preferredfoot === 2 ? 'left' : 'right';
  return [`right`, 'left', null][row.preferredfoot];
}
// 1–5 | null (FIFA 98–06 have no weak-foot rating).
function weakFoot(row) {
  if ('weakfootability' in row) return row.weakfootability + 1;
  const code = row.weakfootabilitytypecode;
  if (code == null) return null;
  return code > 5 ? Math.min(5, Math.round(code / 20)) : code;
}
// The name on a card, in the style of the current source ("Z. Zidane", "Ronaldinho"), and
// the full name. The early titles know surnames only.
// The workbook has one name column; `parts` are the name parts data/legacy-names.json has for
// the title's best known players ({ firstname, surname, pseudonym, full_name }), which tell a
// first name from a double surname and a known-as name from both.
function names(row, parts) {
  const first = parts?.firstname ?? parts?.First_Name ?? null,
    last = parts?.surname ?? parts?.Last_Name ?? null,
    common = parts?.pseudonym ?? null,
    whole = String(row.name).trim(),
    full = parts?.full_name ?? ([first, last].filter(Boolean).join(' ') || whole);
  let name = whole;
  if (common) name = common;
  else if (first && last) name = `${first[0]}. ${last}`;
  else if (last) name = last;
  else if (parts?.full_name && parts.full_name === whole && /\s/.test(name))
    name = `${name[0]}. ${name.slice(name.indexOf(' ') + 1)}`;
  return {
    name: String(name).trim(),
    fullName: String(full).trim(),
    surname: last,
    // How much of a name the title has: first and last name (or a known-as name), the whole
    // name as one string (FIFA 2001 on, without name parts), or the surname only (FIFA
    // 98–2000, mostly).
    named: parts ? 'parts' : /\s/.test(name) ? 'whole' : 'short',
  };
}
// The EA team ids of a row: FIFA 2003 on list them with the shirt numbers ("243:9 / 1370:9"),
// in the order of the team names.
function teamIdsOf(row, teams) {
  if (typeof row.jersey_numbers !== 'string' || !row.jersey_numbers) return [];
  const ids = row.jersey_numbers.split(' / ').map(pair => pair.split(':')[0]);
  return ids.length === teams.length ? ids : [];
}

/**
 * The file → { source, titles: [{ title, edition, year, ranking, scale, sourceFile, pool,
 * fields, keeper, players }] }. `fields` says which skills of the title make each compiler
 * column (`keeper`: a keeper's number). A player: { id, standIn (his name here is not his),
 * edition, year, rank, name, fullName,
 * teams[], teamIds[], clubs[] / clubIds[] (without the representative squads),
 * representativeOnly, nationName, nationCode, positions[] (the game's, primary first), label
 * (the title's), born, age, foot, weakFoot, overall (stored, FIFA 09–14, else null), native:
 * { field → value in the title's own units }, keeping (native keeper number), traits[] }.
 */
export function decodeLegacyTitles(file, nameFile = null) {
  if (file?.format !== 'football-draft-legacy-titles' || file.version !== 2)
    throw Error('Unsupported legacy titles file');
  if (nameFile && (nameFile.format !== 'football-draft-legacy-names' || nameFile.version !== 1))
    throw Error('Unsupported legacy names file');
  const nameParts = new Map(
    (nameFile?.titles ?? []).map(t => [
      t.edition,
      new Map(
        t.rows.map(values => [
          values[0],
          Object.fromEntries(t.columns.map((c, j) => [c, values[j]])),
        ]),
      ),
    ]),
  );
  const titles = file.titles.map(t => {
    const columns = new Set(t.columns),
      fields = Object.fromEntries(SKILL_FIELDS.map(f => [f, pick(FIELDS[f], columns)])),
      keeper = pick(KEEPER, columns),
      outfieldKeeping = OUTFIELD_KEEPING.find(keys => keys.every(k => columns.has(k))) ?? null,
      { edition, year } = t;
    for (const f of SKILL_FIELDS)
      if (fields[f] === undefined) throw Error(`${t.title}: nothing stands for ${f}`);
    if (!keeper) throw Error(`${t.title}: no keeper skills`);
    const players = t.rows.map((values, i) => {
      const row = Object.fromEntries(t.columns.map((c, j) => [c, values[j]])),
        teams = String(row.teams).split(' / '),
        teamIds = teamIdsOf(row, teams),
        real = teams.map((team, j) => ({ team, id: teamIds[j] ?? null })).filter(
          ({ team }) => !isRepresentative(team, edition) && !NO_CLUB.has(team),
        ),
        list = positions(row, edition),
        native = {};
      for (const f of SKILL_FIELDS)
        native[f] = fields[f] === null ? NEUTRAL[f] : mean(row, fields[f]);
      return {
        id: ALIASES.get(row.playerid) ?? row.playerid,
        standIn: ALIASES.has(row.playerid) || STAND_IN.test(String(row.name).trim()),
        title: t.title,
        edition,
        year,
        rank: i + 1,
        ...names(row, nameParts.get(edition)?.get(row.playerid)),
        teams,
        teamIds,
        clubs: real.map(r => r.team),
        clubIds: real.map(r => r.id),
        representativeOnly: teams.every(team => isRepresentative(team, edition)),
        // FIFA 2003 names the nationality by its adjective ("Brazilian"): a code like the
        // numbers of the titles before it, not a nation's name.
        nationName: edition === 3 ? null : (row.nationality_name ?? null),
        nationCode:
          row.nationality ?? row.nationality_code ?? (edition === 3 ? row.nationality_name : null),
        positions: list,
        secondStriker: edition >= 4 && edition < 90 && row.ranking_position === 'CF',
        label: row.ranking_position,
        born: row.date_of_birth ?? null,
        age: row.age ?? row.Age ?? null,
        foot: foot(row, edition),
        weakFoot: weakFoot(row),
        overall: row.overallrating ?? null,
        native,
        keeping: mean(row, keeper),
        outfieldKeeping: outfieldKeeping ? mean(row, outfieldKeeping) : OUTFIELD_KEEPING_DEFAULT,
        traits: Object.keys(TRAITS)
          .filter(k => row[k] === 1)
          .map(k => TRAITS[k]),
      };
    });
    return {
      title: t.title,
      edition,
      year,
      ranking: t.ranking,
      scale: t.scale,
      sourceFile: t.sourceFile,
      pool: t.pool,
      fields,
      keeper,
      keeperRated: keeper !== KEEPER_STAND_INS && keeper.length >= KEEPER_SKILLS,
      players,
    };
  });
  return { source: file.source, titles };
}

async function pinned(path, expected) {
  const bytes = await readFile(path),
    sha256 = createHash('sha256').update(bytes).digest('hex');
  if (expected && sha256 !== expected)
    throw Error(
      `${path} has SHA-256 ${sha256}, expected ${expected}: pin the new file in scripts/data/paths.mjs`,
    );
  return { json: JSON.parse(bytes.toString('utf8')), sha256 };
}
/**
 * Read and check the pinned files: { source, titles, sha256, names: { source, sha256 } }.
 * `names` = { path, sha256 } of data/legacy-names.json (optional).
 */
export async function loadLegacyTitles(path, expected, names = null) {
  const file = await pinned(path, expected),
    parts = names ? await pinned(names.path, names.sha256) : null;
  return {
    ...decodeLegacyTitles(file.json, parts?.json ?? null),
    sha256: file.sha256,
    names: parts ? { source: parts.json.source, sha256: parts.sha256 } : null,
  };
}
