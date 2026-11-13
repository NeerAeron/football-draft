// Legends, Prime versions and era pools from 29 past titles: FIFA 15–23 (the legacy CSV),
// FIFA 98–14 (data/legacy-titles.json) and FC 24–26 (scripts/data/modern-titles.mjs), compiled
// through the same compiler as the current players (compilePlayer: attribute mapping,
// tendencies, badges). Era pools ("nation X in era Y", app/data/eras.v1.json): see the `eras`
// section of compileLegends and the ERA_* rules.
//   * A past version has an overall on EA's modern scale: the one EA printed (FIFA 09–23), or
//     for the titles that printed none (FIFA 98–08) the one the chain of shared players gives
//     it (scripts/legends-calibration.mjs). Its card has the skills of that year, moved
//     together by the few points that make the game's own rating model show that overall —
//     so every threshold below is in the rating a card shows.
//   * FC 27 is the baseline of the scale: a title whose best players EA rated lower than it
//     rates today's (FIFA 09–16, and FIFA 98–08 through the chain) is lifted at the top by
//     that difference; no title is lowered.
//   * One person, all his versions: EA's player id ties FIFA 2000–23 and the catalog together;
//     FIFA 98/99 rows join by name and team. Best version = the highest overall; ties → the
//     latest title (the richer data).
//   * Legend = a best version shown at LEGEND_MINIMUM or more, of
//       – a player who is NOT in the current catalog, or
//       – a catalog player whose card today shows at least LEGEND_GAIN (2) less and whom EA
//         rates lower today (`legendOf` = his catalog profileId).
//     FC 24–26 are today's scale: as printed, never lifted.
//     He has today's name of his nation and the positions of that title, and its club when
//     that club is in the catalog (EA's team id), so he links with club mates; otherwise he
//     has no club. A catalog player's legend carries his catalog name.
//   * Prime version of a current catalog player: his best version, whenever EA's overall of
//     it is above today's and its card shows more than today's card — any gain.
//   * The year of a version is the year of its ratings: `fifa_update_date` (FIFA 15–23), the
//     year before the title's number for the launch databases (FIFA 98 → 1997 … 14 → 2013).
//   * What a title lacks comes from the player's nearest version that has it — composure
//     (FIFA 11–16; else his reactions), the preferred foot and the weak foot (the early
//     titles; else right and 3) — and is recorded in the provenance. Nothing is invented.
// Deterministic.
import { compilePlayer, positions as rowPositions } from './compile-players.mjs';
import { overallRating } from '../app/core/players/ratings.js';
import { normalizeBadges } from '../app/core/players/badges.js';
import { explicitEvidence } from '../app/core/players/catalog-derived.js';
import { foldDiacritics } from '../app/core/util/text.js';
import { ERAS, ERA_SQUAD } from '../app/core/players/eras.js';
import { SKILL_FIELDS } from './data/legacy-titles.mjs';
import {
  calibrateTitles,
  cardFields,
  secondStrikerRoles,
  teamWords,
  POOL_YEARS,
} from './legends-calibration.mjs';

export const LEGEND_MINIMUM = 85;
// A catalog player's past version is a legend version only when it shows at least this much
// more than his card today (a prime version: any gain).
export const LEGEND_GAIN = 2;
// The lift of a stingy title (see `lifts` below): measured on the title's LIFT_TOP best,
// nothing under LIFT_FROM, in full from the level of those best.
export const LIFT_TOP = 30;
export const LIFT_FROM = 84;
export const LEGACY = {
  url: 'https://huggingface.co/datasets/jsulz/FIFA23',
  author: 'jsulz',
  upstream: 'SoFIFA / EA SPORTS FIFA 15–23 (career mode)',
  license: 'MIT',
  licenseUrl: 'https://huggingface.co/datasets/jsulz/FIFA23/blob/main/README.md',
};
export const TITLES = {
  upstream: "EA SPORTS FIFA 98–14, the games' own PC databases",
  license: 'No licence stated (community archive; player data © Electronic Arts)',
};
// Era pools (app/data/eras.v1.json): a World Cup squad per nation and cycle.
export const ERA_KEEPERS = 3;
export const ERA_LINES = { DEF: 7, MID: 7, ATT: 4 }; // at least, where the nation has them
// A nation can be spun in an era when its pool can field a team with a bench and a keeper.
// (No goalkeeper needed: `keepers` tells the draft which pools have one.)
export const ERA_SPIN = { players: 18, DEF: 5, MID: 5, ATT: 2 };
export const ERA_NATIONS = 70; // at most, the strongest (best XI of the pool)
export const ERA_MINIMUM = 20; // an era with fewer nations is not an era: the build fails
const ERA_LINE = {
  CB: 'DEF',
  LB: 'DEF',
  RB: 'DEF',
  DM: 'MID',
  CM: 'MID',
  AM: 'MID',
  LM: 'MID',
  RM: 'MID',
  LW: 'ATT',
  RW: 'ATT',
  ST: 'ATT',
};
/** The era rules in words, for the eras file's `selection` block. */
export const ERA_SELECTION = {
  pool: `A nation's best ${ERA_SQUAD} players of the era, each at his best version inside its years (highest overall; ties: the later year); ${ERA_KEEPERS} goalkeepers and at least ${ERA_LINES.DEF} defenders, ${ERA_LINES.MID} midfielders and ${ERA_LINES.ATT} forwards where the nation has them; no minimum rating`,
  today: `The ${ERAS.at(-1).label} era: FC 24, FC 25, FC 26 and today's catalog — a catalog player is in it as he is unless one of those versions shows more`,
  spinnable: `A nation whose pool has at least ${ERA_SPIN.players} players, ${ERA_SPIN.DEF} defenders, ${ERA_SPIN.MID} midfielders and ${ERA_SPIN.ATT} forwards, with or without a goalkeeper; the ${ERA_NATIONS} strongest (mean overall of the pool's best XI; without a keeper, the era's weakest first-choice keeper stands in) when more qualify`,
  best: 'Everyone in a pool also has his best version of all titles in the file (the Prime), in a pool or not',
  squad: ERA_SQUAD,
  spin: ERA_SPIN,
  maximumNations: ERA_NATIONS,
};
/** The rules in words, for the file's `selection` block. */
export const SELECTION = {
  overall:
    'EA’s printed overall (FIFA 09–23); FIFA 98–08 print none and are chain-linked to the next title through the players both have',
  lift: `A title whose ${LIFT_TOP} best are rated lower on average than FC 27's is lifted by the difference (never lowered): in full from the level of those best, fading to nothing at ${LIFT_FROM}; FIFA 98–08 carry the lift of FIFA 09, whose scale they are linked to`,
  card: 'The skills of that year, moved together until the game shows that overall',
  bestVersion: 'Highest overall; ties: the latest title',
  legends: `Best versions shown ${LEGEND_MINIMUM}+: players who are not in the catalog, and catalog players whose card today shows at least ${LEGEND_GAIN} less; of a catalog nation; the club of that title when it is in the catalog`,
  primes: 'Catalog players whose best version shows more than their card today: any gain',
  year: 'The year of the ratings: the snapshot date (FIFA 15–23), the year before the title’s number (FIFA 98–14)',
  borrowed:
    'Composure (FIFA 11–16), foot and weak foot (early titles): the player’s nearest version that has one',
  legendMinimum: LEGEND_MINIMUM,
  legendGain: LEGEND_GAIN,
};

const shown = p => overallRating(p, true, p.primaryPosition);
const KEEPING = ['diving', 'handling', 'kicking', 'positioning', 'reflexes'].map(
  k => `goalkeeping_${k}`,
);
const words = text =>
  foldDiacritics(String(text ?? ''))
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();
// An unlicensed stand-in ("No 9", "No. 11") is not a name.
const PLACEHOLDER = /^no\.?\s*\d+$/i;

// The first title of the FC series: its files and the later ones are the "modern" sources.
const FIRST_FC = 24;
const titleName = edition => `${Number(edition) >= FIRST_FC ? 'FC' : 'FIFA'} ${edition}`;
/**
 * The year of a row's ratings snapshot; the build fails without one. EA's launch feed (FC 25)
 * has no date: like every launch database, its ratings are those of the year before the
 * title's number.
 */
function snapshotYear(row) {
  const m = /^(\d{4})-\d{2}-\d{2}/.exec(row.fifa_update_date || '');
  if (!m && row.fifa_update_date === '' && Number(row.fifa_version) >= FIRST_FC)
    return 1999 + Number(row.fifa_version);
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
 * @param older the decoded FIFA 98–14 titles ({ titles, sha256 }, scripts/data/legacy-titles.mjs)
 * @param modern FC 24–26: [{ edition, rows (scripts/data/modern-titles.mjs), source: { url,
 *   license, sha256 } }], oldest first
 * @returns {{ legends, primes, eras, stats, calibration, notes }} runtime players, each with
 *   `edition` and `year`; a catalog player's legend carries `legendOf`, a prime `primeOf` (the
 *   current player's profileId) and no name, club or nation (those are the current player's).
 *   `calibration` and `notes` (per card: where its numbers come from) are the provenance.
 */
export function compileLegends(
  legacyRows,
  catalog,
  hash = null,
  older = { titles: [] },
  modern = [],
) {
  const calibration = calibrateTitles(older.titles),
    teams = new Map(catalog.teams.map(t => [String(t.id), t])),
    current = new Map(catalog.players.map(p => [String(p.sourcePlayerId), p])),
    nations = new Set(catalog.players.map(p => p.source.nationality));
  // ---- persons: every version of everyone ------------------------------------------------
  const persons = new Map(); // key → { key, legacy: [{ row, index }], old: [rows] }
  const person = key => {
    if (!persons.has(key)) persons.set(key, { key, legacy: [], old: [] });
    return persons.get(key);
  };
  legacyRows.forEach((row, index) => person(row.player_id).legacy.push({ row, index }));
  // FC 24–26 follow the legacy file: a person's `legacy` rows stay oldest first.
  const sourceOf = new Map(); // row → { url, license, sha256 } of a modern file
  for (const title of modern)
    title.rows.forEach((row, index) => {
      sourceOf.set(row, title.source);
      person(row.player_id).legacy.push({ row, index });
    });
  const allRows = [...legacyRows, ...modern.flatMap(title => title.rows)];
  const stats = {
    pureLegends: 0,
    currentLegends: 0,
    composureBorrowed: 0,
    composureFromReactions: 0,
    footBorrowed: 0,
    footUnknown: 0,
    shownOffOverall: 0,
    otherNations: [],
    dropped: [...calibration.dropped],
    merged: calibration.merged,
  };
  for (const one of calibration.persons.values()) {
    const key = String(one.id),
      known = persons.get(key);
    if (known?.legacy.length) {
      // The same EA id in FIFA 15–23: the same man when a name word or the birthday agrees.
      const names = new Set(
          known.legacy.flatMap(({ row }) =>
            `${words(row.short_name)} ${words(row.long_name)}`.split(' ').filter(w => w.length > 1),
          ),
        ),
        same = one.rows.some(
          p =>
            (p.born && known.legacy.some(({ row }) => row.dob === p.born)) ||
            `${words(p.name)} ${words(p.fullName)}`.split(' ').some(w => names.has(w)),
        );
      if (!same) {
        stats.dropped.push(
          `${one.rows.at(-1).name} (FIFA 98–14, id ${key}): not the ${known.legacy.at(-1).row.short_name} of FIFA 15–23`,
        );
        continue;
      }
    }
    person(key).old.push(...one.rows);
  }
  // ---- nations --------------------------------------------------------------------------
  // Today's catalog name of a past nationality id (Türkiye, Czechia…): the nation most
  // catalog players of that id have today (the current source carries no ids).
  const nationVotes = new Map();
  for (const one of persons.values()) {
    const now = current.get(one.key);
    if (!now || !one.legacy.length) continue;
    const id = one.legacy.findLast(({ row }) => row.nationality_id)?.row.nationality_id;
    if (!id) continue;
    if (!nationVotes.has(id)) nationVotes.set(id, new Map());
    const votes = nationVotes.get(id);
    votes.set(now.source.nationality, (votes.get(now.source.nationality) || 0) + 1);
  }
  const winner = votes => [...votes].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  const nationNames = new Map([...nationVotes].map(([id, votes]) => [id, winner(votes)[0]]));
  // Nation names as the old titles spell them: the catalog's own, EA's of FIFA 06–23 (through
  // the nationality id), and the national teams of the early titles, which are named after
  // their nation ("Holland", "Czech Rep") — a team counts as one when its name is a nation's.
  const nationByName = new Map();
  for (const name of nations) nationByName.set(teamWords(name).join(' '), name);
  const spell = (name, id) => {
    const nation = nationNames.get(String(id)),
      key = teamWords(name).join(' ');
    if (nation && key && !nationByName.has(key)) nationByName.set(key, nation);
  };
  for (const row of allRows)
    if (row.nationality_id) spell(row.nationality_name, row.nationality_id);
  const teamNation = name => nationByName.get(teamWords(name).join(' ')) ?? null;
  // A person's nation from his own rows: FIFA 15–23, else EA's nationality id (FIFA 2005) or
  // the nation's name (FIFA 06–14) where the catalog or FIFA 15–23 spell it that way, else
  // the national team he is in.
  const ownNation = one => {
    if (one.legacy.length) {
      const row = one.legacy.at(-1).row;
      return (
        nationNames.get(row.nationality_id) ??
        teamNation(row.nationality_name) ??
        row.nationality_name
      );
    }
    for (const p of [...one.old].reverse()) {
      const nation =
        (p.edition === 5 ? nationNames.get(String(p.nationCode)) : null) ??
        teamNation(p.nationName ?? '');
      if (nation) return nation;
    }
    for (const p of [...one.old].reverse())
      for (const team of p.clubs) if (teamNation(team)) return teamNation(team);
    return null;
  };
  // What a title calls a nationality — a code of its own (FIFA 98–2002), an adjective (FIFA
  // 2003), a name spelled another way (FIFA 06–14: "Holland", "Korea Republic") — is the
  // nation most of its players with a known nation have (at least three, four in five
  // agreeing).
  const byOldRow = new Map();
  for (const one of persons.values()) for (const p of one.old) byOldRow.set(p, one);
  const nationKey = p => p.nationCode ?? p.nationName;
  const codeNation = new Map(); // title → Map(code → nation)
  for (const t of older.titles) {
    const votes = new Map();
    for (const p of t.players) {
      const one = byOldRow.get(p),
        nation = one && ownNation(one),
        key = nationKey(p);
      if (!nation || key == null) continue;
      if (!votes.has(key)) votes.set(key, new Map());
      votes.get(key).set(nation, (votes.get(key).get(nation) || 0) + 1);
    }
    const codes = new Map();
    for (const [code, list] of votes) {
      const [nation, count] = winner(list),
        total = [...list.values()].reduce((s, v) => s + v, 0);
      if (count >= 3 && count >= 0.8 * total) codes.set(code, nation);
    }
    codeNation.set(t.edition, codes);
  }
  const nationCache = new Map();
  const nationOf = one => {
    if (nationCache.has(one)) return nationCache.get(one);
    let found = ownNation(one);
    if (!found)
      for (const p of [...one.old].reverse()) {
        found = codeNation.get(p.edition)?.get(nationKey(p)) ?? null;
        if (found) break;
      }
    nationCache.set(one, found);
    return found;
  };
  // ---- clubs of the early titles (names only): the EA team id a later title gives that name
  const teamIds = new Map();
  for (const t of older.titles)
    for (const p of t.players)
      p.clubs.forEach((name, i) => {
        const key = teamWords(name).join(' ');
        if (p.clubIds[i] != null && key && !/^team \d+$/i.test(name) && !teamIds.has(key))
          teamIds.set(key, String(p.clubIds[i]));
      });
  for (const t of catalog.teams) {
    const key = teamWords(t.name).join(' ');
    if (key && !teamIds.has(key)) teamIds.set(key, String(t.id));
  }
  const clubOf = p => {
    for (let i = 0; i < p.clubs.length; i++) {
      const id = p.clubIds[i] ?? teamIds.get(teamWords(p.clubs[i]).join(' '));
      if (id != null && teams.has(String(id))) return teams.get(String(id));
    }
    return null;
  };
  // ---- the lift ---------------------------------------------------------------------------
  // EA printed lower numbers for its best players in some years than it does today (FIFA
  // 09–16: one to two points at the top), and the chain hands FIFA 09's scale down to FIFA
  // 98–08. FC 27 is the baseline: a title whose LIFT_TOP best average less than FC 27's is
  // lifted by the difference — one constant per title, never a lowering (FIFA 17–23 stay as
  // printed). The lift is for the top: in full from the level of the title's best, fading to
  // nothing at LIFT_FROM, so the ordinary players of a lifted year do not become legends.
  const topMean = list => {
    const best = [...list].sort((a, b) => b - a).slice(0, LIFT_TOP);
    return best.reduce((sum, v) => sum + v, 0) / best.length;
  };
  const baseline = topMean(catalog.players.map(p => p.sourceOverall)),
    printed = new Map(); // edition → the printed overalls of the title
  for (const row of allRows) {
    const edition = Number(row.fifa_version);
    if (!printed.has(edition)) printed.set(edition, []);
    printed.get(edition).push(Number(row.overall));
  }
  const official = older.titles.filter(t => t.players[0].overall != null);
  for (const t of official)
    printed.set(
      t.edition,
      t.players.filter(p => p.given != null).map(p => p.overall),
    );
  const lifts = new Map();
  for (const [edition, list] of printed) {
    const top = topMean(list);
    // FC 24–26 are today's scale: as printed.
    const lift = edition >= FIRST_FC && edition < 90 ? 0 : Math.max(0, baseline - top);
    lifts.set(edition, { lift: Math.round(lift * 100) / 100, full: top });
  }
  // The chain titles are on the scale of the first official title: its lift, not a second one.
  for (const t of older.titles)
    if (!lifts.has(t.edition) && official.length)
      lifts.set(t.edition, lifts.get(official[0].edition));
  const lifted = (edition, overall) => {
    const { lift, full } = lifts.get(edition) ?? { lift: 0 };
    if (!lift) return overall;
    const share = Math.max(0, Math.min(1, (overall - LIFT_FROM) / (full - LIFT_FROM)));
    return overall + lift * share;
  };
  // ---- versions --------------------------------------------------------------------------
  const versions = one => [
    ...one.old
      .filter(p => p.given != null)
      .map(p => ({
        old: p,
        year: p.year,
        edition: p.edition,
        printed: Math.round(p.given),
        overall: Math.round(lifted(p.edition, p.given)),
      })),
    ...one.legacy.map(entry => ({
      entry,
      year: snapshotYear(entry.row),
      edition: Number(entry.row.fifa_version),
      printed: Number(entry.row.overall),
      overall: Math.round(lifted(Number(entry.row.fifa_version), Number(entry.row.overall))),
    })),
  ];
  const bestVersion = one => {
    let best = null;
    for (const v of versions(one))
      if (!best || v.overall > best.overall || (v.overall === best.overall && v.year > best.year))
        best = v;
    return best;
  };
  // What a version lacks, from the nearest version of the same person that has it (a tie in
  // years → the later one).
  const nearest = (one, year, value) => {
    let best = null;
    for (const v of versions(one).concat(
      one.old.filter(p => p.given == null).map(p => ({ old: p, year: p.year })),
    )) {
      const found = value(v),
        gap = Math.abs(v.year - year);
      if (found == null) continue;
      if (!best || gap < best.gap || (gap === best.gap && v.year > best.year))
        best = { found, gap, year: v.year };
    }
    return best;
  };
  const nativeComposure = new Set(
    older.titles
      .filter(t => t.fields.mentality_composure[0] === 'playercomposure')
      .map(t => t.edition),
  );
  const composureOf = v =>
    v.entry
      ? v.entry.row.mentality_composure === ''
        ? null
        : Number(v.entry.row.mentality_composure)
      : nativeComposure.has(v.old.edition)
        ? v.old.native.mentality_composure
        : null;
  const footOf = v => (v.entry ? v.entry.row.preferred_foot.toLowerCase() : v.old.foot);
  const weakFootOf = v => (v.entry ? Number(v.entry.row.weak_foot) : v.old.weakFoot);
  // The name of a player the older titles alone know, in the style of today's cards
  // ("Z. Boban", "Hagi"): from his latest title that has the parts of a name, else the latest
  // with the surname alone, else a whole name as one string; never a stand-in ("No 9").
  // His real name is the one most of his rows agree on (a word in common): an invented name
  // under his own id for a year or two ("Petrovici Teodor" for Mutu) is outvoted.
  const real = one => {
    const groups = [];
    for (const q of one.old) {
      if (q.standIn) continue;
      const own = words(`${q.name} ${q.fullName}`)
          .split(' ')
          .filter(w => w.length > 1),
        group = groups.find(g => own.some(w => g.words.has(w)));
      if (!group) groups.push({ words: new Set(own), rows: [q] });
      else {
        group.rows.push(q);
        for (const w of own) group.words.add(w);
      }
    }
    groups.sort((a, b) => b.rows.length - a.rows.length); // a tie: the earlier name
    return [...(groups[0]?.rows ?? [])].reverse();
  };
  // A whole name in one string ("David Seaman") is shown as today's cards show one: "D. Seaman".
  const abbreviated = q =>
    q.named === 'whole' ? `${q.name[0]}. ${q.name.slice(q.name.indexOf(' ') + 1)}` : q.name;
  const nameSource = one =>
    ['parts', 'whole', 'short'].map(kind => real(one).find(q => q.named === kind)).find(Boolean);
  const fullNameSource = one => real(one).find(q => /\s/.test(q.fullName));
  const notes = {};
  // The compiled card of a version: its skills moved to show its overall.
  const card = (one, v, suffix, count) => {
    const inference = {},
      note = { overall: v.overall };
    if (v.overall !== v.printed) note.lifted = v.overall - v.printed;
    let row, position, skills, index;
    if (v.entry) {
      row = { ...v.entry.row };
      index = v.entry.index + 1;
      skills = {};
      for (const f of SKILL_FIELDS) skills[f] = row[f] === '' ? null : Number(row[f]);
      const list = row.player_positions.split(',').map(s => s.trim());
      if (list[0] === 'CF') {
        const roles = secondStrikerRoles({
          ...skills,
          mentality_composure: skills.mentality_composure ?? skills.movement_reactions,
        });
        row.player_positions = [...roles, ...list.slice(1)].join(', ');
        note.position = `CF → ${roles[0]}`;
      }
      // EA's feed (FC 25) has the full name only: the name of his nearest sofifa-style row.
      if (row.fifa_version === '25') {
        const styled = one.legacy.findLast(e => e.row.fifa_version !== '25')?.row;
        if (styled)
          Object.assign(row, { short_name: styled.short_name, long_name: styled.long_name });
      }
      position = rowPositions(row)[0];
      note.title = titleName(row.fifa_version);
    } else {
      const p = v.old,
        legacy = (one.legacy.findLast(e => e.row.fifa_version !== '25') ?? one.legacy.at(-1))?.row,
        named = nameSource(one) ?? p,
        club = clubOf(p),
        foot = p.foot ? null : nearest(one, v.year, footOf),
        weak = p.weakFoot ? null : nearest(one, v.year, weakFootOf);
      if (!p.foot) {
        inference.foot = foot ? `from his ${foot.year} version` : 'unknown: right';
        if (count) stats[foot ? 'footBorrowed' : 'footUnknown']++;
      }
      if (!p.weakFoot) inference.weakFoot = weak ? `from his ${weak.year} version` : 'unknown: 3';
      skills = { ...p.skills };
      position = p.positions[0];
      index = p.rank;
      row = {
        player_id: one.key,
        fifa_version: String(p.edition),
        fifa_update: '1',
        fifa_update_date: '',
        short_name: legacy?.short_name ?? abbreviated(named),
        long_name: legacy?.long_name ?? fullNameSource(one)?.fullName ?? named.fullName,
        player_positions: p.positions.join(', '),
        preferred_foot: p.foot ?? foot?.found ?? 'right',
        weak_foot: p.weakFoot ?? weak?.found ?? 3,
        player_traits: p.traits.join(', '),
        player_tags: '',
        club_name: club?.name ?? p.clubs[0] ?? '',
        club_team_id: club ? String(club.id) : '',
        nationality_name: p.nationName ?? '',
      };
      const keeping = position === 'GK' ? v.overall : Math.max(1, Math.round(p.outfieldKeeping));
      for (const k of KEEPING) row[k] = keeping;
      note.title = older.titles.find(t => t.edition === p.edition).title;
      if (p.overall == null)
        note.overallFrom = p.backing ? `chain, pooled with ${p.backing.join(', ')}` : 'chain';
    }
    if (
      skills.mentality_composure == null ||
      (v.old && !nativeComposure.has(v.old.edition) && v.old.edition >= 11 && v.old.edition < 90)
    ) {
      const donor = nearest(one, v.year, composureOf);
      skills.mentality_composure = donor ? donor.found : skills.movement_reactions;
      inference.composure = donor ? `from his ${donor.year} version` : 'his reactions';
      if (count) stats[donor ? 'composureBorrowed' : 'composureFromReactions']++;
    }
    const moved = cardFields(skills, position, v.overall);
    Object.assign(row, moved.fields, { overall: v.overall });
    note.shift = moved.shift;
    const p = compilePlayer(row, index, {
      suffix,
      source: v.entry
        ? (sourceOf.get(v.entry.row) ?? LEGACY)
        : { url: older.source?.archive, license: TITLES.license },
      inference,
    });
    p.source.sha256 = v.entry ? (sourceOf.get(v.entry.row)?.sha256 ?? hash) : older.sha256;
    if (v.old) p.source.edition = note.title;
    if (Object.keys(inference).length) note.borrowed = inference;
    notes[p.profileId] = note;
    if (count && shown(p) !== v.overall) stats.shownOffOverall++;
    return p;
  };
  // ---- selection -------------------------------------------------------------------------
  const legends = [],
    primes = [];
  const legend = (one, v, p, extra, nationality) => {
    const team = v.entry ? teams.get(String(v.entry.row.club_team_id)) : clubOf(v.old);
    legends.push(
      runtimePlayer(p, {
        ...extra,
        year: v.year,
        source: { clubId: team ? team.id : null, nationality },
      }),
    );
  };
  for (const one of persons.values()) {
    const now = current.get(one.key),
      best = bestVersion(one);
    if (!best) continue;
    if (!now) {
      if (best.overall < LEGEND_MINIMUM) continue;
      const nationality = nationOf(one),
        p = card(one, best, 'legend', true);
      if (shown(p) < LEGEND_MINIMUM) continue;
      if (PLACEHOLDER.test(p.name)) {
        stats.dropped.push(`${p.name} ${shown(p)} (${p.source.edition}, id ${one.key}): no name`);
        continue;
      }
      if (!nations.has(nationality)) {
        stats.otherNations.push(`${p.name} ${shown(p)} (${nationality ?? 'nation unknown'})`);
        continue;
      }
      legend(one, best, p, {}, nationality);
      stats.pureLegends++;
      continue;
    }
    // A current player: only a version EA itself rated above today's, shown above today's card.
    const today = shown(now);
    if (best.overall <= now.sourceOverall || best.overall <= today) continue;
    const prime = card(one, best, 'prime', true);
    if (shown(prime) <= today) continue;
    const { name, fullName, ...rest } = runtimePlayer(prime, {
      year: best.year,
      primeOf: now.profileId,
    });
    primes.push(rest);
    if (shown(prime) >= LEGEND_MINIMUM && shown(prime) >= today + LEGEND_GAIN) {
      // His best version is a Legend-spin option: the same player, so the same name and nation.
      legend(
        one,
        best,
        card(one, best, 'legend', false),
        { name: now.name, fullName: now.fullName, legendOf: now.profileId },
        now.source.nationality,
      );
      stats.currentLegends++;
    }
  }
  const id = p => Number(p.profileId.split(':')[1]);
  const rated = new Map(legends.map(p => [p, shown(p)]));
  // Best first as the game shows them, then the latest version, then the id.
  legends.sort((a, b) => rated.get(b) - rated.get(a) || b.year - a.year || id(a) - id(b));
  // One person once, whatever the ids say: of two legends of one nation with the same name
  // the lower-rated (else the older) goes, and is listed.
  const seen = new Map();
  for (const p of [...legends]) {
    const key = `${p.source.nationality}|${words(p.fullName)}`,
      first = seen.get(key);
    if (!first) seen.set(key, p);
    else {
      legends.splice(legends.indexOf(p), 1);
      stats.dropped.push(
        `${p.name} ${rated.get(p)} (’${String(p.year % 100).padStart(2, '0')}, id ${id(p)}): same name and nation as ${first.name} ${rated.get(first)} (id ${id(first)})`,
      );
      stats[p.legendOf ? 'currentLegends' : 'pureLegends']--;
    }
  }
  const order = new Map(catalog.players.map((p, i) => [p.profileId, i]));
  primes.sort((a, b) => order.get(a.primeOf) - order.get(b.primeOf));
  // ---- eras ------------------------------------------------------------------------------
  // "Nation X in era Y": the nation's best ERA_SQUAD players of a World Cup cycle, each at his
  // best version inside the era's years (the overall decides; ties: the later year). The 2026
  // era also has today's card of everyone in the catalog: a catalog player is in it as he is
  // unless one of his FC 24–26 versions shows more. Three keepers and ERA_LINES of each line
  // where the nation has them, the rest by rating; no minimum rating. A nation can be spun in
  // an era when its pool can field a team (ERA_SPIN), at most ERA_NATIONS per era.
  const eraOfYear = year => ERAS.find(e => year >= e.from && year <= e.to) ?? null,
    lineOf = position => (position === 'GK' ? 'GK' : ERA_LINE[position]),
    positionOf = v =>
      v.now ? v.now.primaryPosition : v.entry ? rowPositions(v.entry.row)[0] : v.old.positions[0],
    better = (a, b) => !b || a.overall > b.overall || (a.overall === b.overall && a.year > b.year);
  // The name a person's cards carry (as `card` gives it), to tell two ids of one man.
  const fullNameOf = (one, now) =>
    now?.fullName ??
    one.legacy.at(-1)?.row.long_name ??
    fullNameSource(one)?.fullName ??
    nameSource(one)?.fullName ??
    null;
  const candidates = new Map(), // `${era}|${nation}` → [{ one, now, v, rating, line }]
    eraStats = { noNation: 0, noName: 0, otherNations: new Map(), sameName: [] };
  const candidate = (era, nationality, entry) => {
    const key = `${era}|${nationality}`;
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push(entry);
  };
  const versionsOf = new Map(); // person → Map(era id → best version in it)
  for (const one of persons.values()) {
    const now = current.get(one.key) ?? null,
      nationality = now ? now.source.nationality : nationOf(one);
    const inEra = new Map();
    for (const v of versions(one)) {
      const era = eraOfYear(v.year);
      if (era && better(v, inEra.get(era.id))) inEra.set(era.id, v);
    }
    if (now) {
      const today = { now, overall: shown(now), year: ERAS.at(-1).to },
        past = inEra.get(ERAS.at(-1).id);
      if (!past || past.overall <= today.overall) inEra.set(ERAS.at(-1).id, today);
    }
    if (!inEra.size) continue;
    if (!nationality) {
      eraStats.noNation++;
      continue;
    }
    if (!nations.has(nationality)) {
      eraStats.otherNations.set(nationality, (eraStats.otherNations.get(nationality) || 0) + 1);
      continue;
    }
    const fullName = fullNameOf(one, now);
    if (!fullName || PLACEHOLDER.test(fullName)) {
      eraStats.noName++;
      continue;
    }
    versionsOf.set(one, inEra);
    for (const [era, v] of inEra)
      candidate(era, nationality, {
        one,
        now,
        v,
        rating: v.overall,
        line: lineOf(positionOf(v)),
        name: words(fullName),
      });
  }
  // Catalog players the past sources do not know (new in FC 27): today's card only.
  for (const now of catalog.players)
    if (!persons.has(String(now.sourcePlayerId)))
      candidate(ERAS.at(-1).id, now.source.nationality, {
        one: null,
        now,
        v: { now, overall: shown(now), year: ERAS.at(-1).to },
        rating: shown(now),
        line: lineOf(now.primaryPosition),
        name: words(now.fullName),
      });
  const idOf = c => Number(c.now ? c.now.sourcePlayerId : c.one.key),
    byRating = (a, b) => b.rating - a.rating || b.v.year - a.v.year || idOf(a) - idOf(b);
  const squads = []; // { era, nation, members, strength }
  for (const [key, list] of candidates) {
    const [era, nation] = [Number(key.slice(0, 4)), key.slice(5)];
    list.sort(byRating);
    // One man once: of two candidates of one name the lower-rated goes (two EA ids of a man).
    const names = new Map(),
      unique = [];
    for (const c of list) {
      // (A surname alone, as the early titles have it, is not one man's name.)
      const first = c.name.includes(' ') ? names.get(c.name) : null;
      if (first)
        eraStats.sameName.push(`${era} ${nation}: ${c.name} (ids ${idOf(first)}, ${idOf(c)})`);
      else {
        names.set(c.name, c);
        unique.push(c);
      }
    }
    const chosen = new Set(),
      take = (line, count) => {
        for (const c of unique) {
          if (count <= 0) break;
          if (c.line === line && !chosen.has(c)) {
            chosen.add(c);
            count--;
          }
        }
      };
    take('GK', ERA_KEEPERS);
    for (const [line, count] of Object.entries(ERA_LINES)) take(line, count);
    for (const c of unique) {
      if (chosen.size >= ERA_SQUAD) break;
      if (c.line !== 'GK') chosen.add(c);
    }
    const members = [...chosen].sort(byRating),
      count = line => members.filter(c => c.line === line).length,
      keeper = members.find(c => c.line === 'GK'),
      outfield = members.filter(c => c.line !== 'GK').slice(0, 10);
    // A goalkeeper is not required: the draft's own guards see to it that one can be drafted.
    if (
      members.length < ERA_SPIN.players ||
      count('DEF') < ERA_SPIN.DEF ||
      count('MID') < ERA_SPIN.MID ||
      count('ATT') < ERA_SPIN.ATT
    )
      continue;
    squads.push({ era, nation, members, keeper, outfield });
  }
  // Strength = the mean overall of the pool's best XI: its best keeper and ten best
  // outfielders. A pool without a keeper is rated with the weakest first-choice keeper any
  // qualifying nation of that era has (`keeperLevel`): the least a drafted keeper would be.
  const keeperLevels = new Map();
  for (const era of ERAS) {
    const firsts = squads.filter(sq => sq.era === era.id && sq.keeper).map(sq => sq.keeper.rating);
    if (!firsts.length) throw Error(`${era.label}: no pool has a goalkeeper`);
    keeperLevels.set(era.id, Math.min(...firsts));
  }
  for (const sq of squads) {
    const sum =
      (sq.keeper ? sq.keeper.rating : keeperLevels.get(sq.era)) +
      sq.outfield.reduce((total, c) => total + c.rating, 0);
    sq.strength = Math.round((sum / (sq.outfield.length + 1)) * 10) / 10;
  }
  const eraCards = new Map(), // profileId → runtime card
    cardOf = new Map(); // candidate version → profileId (a card's, or the catalog player's)
  const eraCard = (one, v, now, nationality) => {
    if (v.now) return v.now.profileId;
    if (cardOf.has(v)) return cardOf.get(v);
    const p = card(one, v, 'era', false),
      team = v.entry ? teams.get(String(v.entry.row.club_team_id)) : clubOf(v.old),
      player = runtimePlayer(p, {
        ...(now ? { name: now.name, fullName: now.fullName, eraOf: now.profileId } : {}),
        year: v.year,
        source: { clubId: team ? team.id : null, nationality },
      });
    eraCards.set(player.profileId, player);
    cardOf.set(v, player.profileId);
    return player.profileId;
  };
  const eraPools = [],
    eraSummary = [];
  for (const era of ERAS) {
    const all = squads
        .filter(sq => sq.era === era.id)
        .sort((a, b) => b.strength - a.strength || (a.nation < b.nation ? -1 : 1)),
      spun = all.slice(0, ERA_NATIONS);
    if (spun.length < ERA_MINIMUM)
      throw Error(
        `${era.label}: only ${spun.length} nations can field a pool (${ERA_MINIMUM} needed)`,
      );
    for (const sq of spun)
      eraPools.push({
        era: era.id,
        nation: sq.nation,
        strength: sq.strength,
        members: sq.members.map(c => eraCard(c.one, c.v, c.now, sq.nation)),
        people: sq.members,
      });
    eraSummary.push({
      era: era.id,
      label: era.label,
      nations: spun.length,
      withoutKeeper: spun.filter(sq => !sq.keeper).map(sq => sq.nation),
      keeperLevel: keeperLevels.get(era.id),
      qualified: all.length,
      left: all.slice(ERA_NATIONS).map(sq => sq.nation),
    });
  }
  // The Prime: everyone in a pool has his best version of all titles in the file, also when
  // it is in no pool (his nation cannot be spun in that era, or he is not among its 26 then).
  let bestOnly = 0;
  for (const pool of eraPools)
    for (const c of pool.people) {
      if (!c.one) continue;
      let best = null;
      for (const v of versionsOf.get(c.one).values()) if (better(v, best)) best = v;
      if (best.now || cardOf.has(best) || best.overall <= c.rating) continue;
      eraCard(c.one, best, c.now, pool.nation);
      bestOnly++;
    }
  const sourceId = p => Number(p.profileId.split(':')[1]),
    eraOrder = new Map(ERAS.map((e, i) => [e.id, i])),
    cardList = [...eraCards.values()].sort(
      (a, b) =>
        eraOrder.get(eraOfYear(a.year).id) - eraOrder.get(eraOfYear(b.year).id) ||
        (a.source.nationality < b.source.nationality
          ? -1
          : a.source.nationality > b.source.nationality
            ? 1
            : 0) ||
        shown(b) - shown(a) ||
        sourceId(a) - sourceId(b) ||
        a.edition - b.edition,
    );
  const eras = {
    eras: ERAS.map(({ id: eraId, label, short, from, to }) => ({
      id: eraId,
      label,
      short,
      from,
      to,
      keeperLevel: keeperLevels.get(eraId),
    })),
    cards: cardList,
    pools: eraPools.map(({ era, nation, strength, members }) => ({
      era,
      nation,
      strength,
      members,
    })),
    summary: eraSummary,
    stats: {
      cards: cardList.length,
      bestOnly,
      noNation: eraStats.noNation,
      noName: eraStats.noName,
      otherNations: Object.fromEntries([...eraStats.otherNations].sort()),
      sameName: eraStats.sameName,
    },
  };
  const { yardstick, links, pool } = calibration;
  return {
    legends,
    primes,
    eras,
    stats,
    calibration: {
      yardstick,
      links,
      pool,
      poolYears: POOL_YEARS,
      lift: {
        baseline: Math.round(baseline * 100) / 100,
        top: LIFT_TOP,
        from: LIFT_FROM,
        titles: Object.fromEntries(
          [...lifts].map(([edition, l]) => [
            edition >= 90 ? `FIFA ${edition}` : titleName(String(edition).padStart(2, '0')),
            l.lift,
          ]),
        ),
      },
    },
    notes,
  };
}
