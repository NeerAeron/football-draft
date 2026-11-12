// npm run data:reconcile — fit a source snapshot to the game's reviewed reference, in one pass.
//
// The source feed names clubs, leagues and nations but carries no ids. This tool ties every
// name to data/catalog-reference.json and writes data/source-map.json (the compiler's input):
//   * clubs    by the players they share with the catalog in app/data (same EA player id →
//              the club he had there), then by name inside the league; ambiguous ones are left
//              out and listed
//   * leagues  by the reference league most of their matched clubs belong to
//   * nations  by the nationality the same players have in the catalog (Holland → Netherlands)
// Decisions already in the map are kept (hand corrections survive; a re-run only looks at
// what is new), so a new snapshot is reconciled in well under a second after the CSV parse.
//
// Clubs of an available league that the reference does not know (promoted sides) are listed;
// with --add-clubs they get a reference entry: the EA team id found in older snapshots
// (--ids <sofifa-style.csv>…, else a local id from 900001), and with --enrich (network) their
// Opta Power Rankings score and ESPN display colours. Review data/build/reconcile-report.json
// and the diff of both JSON files before building.
//
// Options: --source <csv> (default: the pinned file)  --fresh (ignore the existing map)
//          --add-clubs  --ids <csv> [<csv>…]  --enrich  --opta <index.js>  --dry
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCSV } from '../compile-players.mjs';
import { loadRuntimeCatalog } from './catalog-file.mjs';
import { clubKey, menOf, isoDate } from './ea-source.mjs';
import { PATHS, SOURCE } from './paths.mjs';

const WORDS = new Set(
  (
    'fc cf sc ac afc sk fk if bk ik ks kv ca cd ce ud sd rc us as ss ssc sv vfl vfb tsg club de da ' +
    'the 1 futbol football kulubu calcio'
  ).split(' '),
);
export const normal = name =>
  String(name)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const tokens = name => normal(name).split(' ').filter(t => t && !WORDS.has(t));
// The feed drops a letter from some names ("Club Len", "FC Jurez"): one missing letter is the
// same word.
const subsequence = (short, long) => {
  let i = 0;
  for (const c of long) if (c === short[i]) i++;
  return i === short.length;
};
const near = (a, b) =>
  a === b ||
  (Math.min(a.length, b.length) >= 3 &&
    Math.abs(a.length - b.length) === 1 &&
    (a.length < b.length ? subsequence(a, b) : subsequence(b, a)));
/**
 * 0…1: shared name words (ignoring "FC", "Club"…) over the longer name; 0.8 when the shorter
 * name is wholly inside the longer one ("Vicenza" in "L. R. Vicenza"). `loose`: a word may
 * miss one letter.
 */
export function similarity(a, b, loose = false) {
  const x = tokens(a),
    y = tokens(b);
  if (!x.length || !y.length) return 0;
  const same = loose ? near : (s, t) => s === t,
    shared = x.filter(s => y.some(t => same(s, t))).length,
    score = shared / Math.max(x.length, y.length);
  return shared === Math.min(x.length, y.length) && score < 1 ? Math.max(score, 0.8) : score;
}
const tally = (map, key, by = 1) => map.set(key, (map.get(key) || 0) + by);
const ranked = map => [...map].sort((a, b) => b[1] - a[1]);
const sortKeys = object =>
  Object.fromEntries(Object.entries(object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** Clear winner of a vote: at least `least` votes and more than twice the runner-up. */
function winner(votes, least) {
  const [[id, n] = [null, 0], [, second] = [null, 0]] = ranked(votes);
  return id != null && n >= least && n > 2 * second ? { id, votes: n } : null;
}

/**
 * @param rows men's rows of the feed
 * @param previous Map(EA player id → { clubId, nationality }) of the catalog in app/data
 * @param reference data/catalog-reference.json
 * @param existing the current source map (or null)
 * @param codes data/nation-codes.json `codes` (nation name → flag code)
 * @returns {{ map, report }}
 */
export function reconcile(rows, previous, reference, existing = null, codes = {}) {
  const refClubs = new Map(reference.clubs.map(c => [String(c.sourceTeamId), c])),
    refLeagues = new Map(
      reference.leagues.filter(l => l.sourceLeagueId != null).map(l => [l.sourceLeagueId, l]),
    );
  // One pass over the players: the clubs of the feed with their votes, and the nation votes.
  const clubs = new Map(),
    nationVotes = new Map(),
    nationPlayers = new Map();
  for (const r of rows) {
    const key = clubKey(r.league, r.club);
    let club = clubs.get(key);
    if (!club) clubs.set(key, (club = { key, league: r.league, club: r.club, n: 0, votes: new Map() }));
    club.n++;
    tally(nationPlayers, r.nationality);
    const was = previous.get(r.player_id);
    if (!was) continue;
    if (was.clubId != null) tally(club.votes, String(was.clubId));
    if (!nationVotes.has(r.nationality)) nationVotes.set(r.nationality, new Map());
    tally(nationVotes.get(r.nationality), was.nationality);
  }
  // Clubs. 1: decisions already made; 2: shared players, strongest claim first.
  const map = { clubs: {}, leagues: {}, nations: {} },
    taken = new Set(),
    how = new Map();
  const assign = (club, id, method) => {
    map.clubs[club.key] = id;
    taken.add(id);
    how.set(club.key, method);
  };
  for (const club of clubs.values()) {
    const id = existing?.clubs?.[club.key];
    if (id != null && refClubs.has(String(id)) && !taken.has(String(id)))
      assign(club, String(id), 'kept');
  }
  const claims = [];
  for (const club of clubs.values()) {
    if (club.key in map.clubs) continue;
    const won = winner(club.votes, 4);
    if (won && refClubs.has(won.id)) claims.push({ club, ...won });
  }
  claims.sort((a, b) => b.votes - a.votes || (a.club.key < b.club.key ? -1 : 1));
  for (const { club, id } of claims) if (!taken.has(id)) assign(club, id, 'shared players');
  // Leagues: the reference league most matched clubs of a feed league are in (their league
  // of last time: promoted and relegated sides are a minority).
  const leagueVotes = new Map(),
    leagueClubs = new Map();
  for (const club of clubs.values()) {
    tally(leagueClubs, club.league);
    const ref = refClubs.get(map.clubs[club.key]);
    if (!ref) continue;
    if (!leagueVotes.has(club.league)) leagueVotes.set(club.league, new Map());
    tally(leagueVotes.get(club.league), ref.sourceLeagueId);
  }
  for (const league of leagueClubs.keys()) {
    if (existing?.leagues && league in existing.leagues) {
      map.leagues[league] = existing.leagues[league];
      continue;
    }
    const votes = leagueVotes.get(league) || new Map(),
      [[id, n] = [null, 0]] = ranked(votes),
      total = ranked(votes).reduce((s, [, v]) => s + v, 0);
    // …and they must be most of the league: a few relegated sides do not name their new one.
    map.leagues[league] =
      id != null && n / total >= 0.6 && n / leagueClubs.get(league) >= 0.5 ? id : null;
  }
  // 3: a club nobody shares enough players with, by its name inside its league.
  for (const club of clubs.values()) {
    if (club.key in map.clubs) continue;
    const league = map.leagues[club.league],
      same = reference.clubs.filter(
        c =>
          !taken.has(String(c.sourceTeamId)) &&
          (league == null || c.sourceLeagueId === league) &&
          normal(c.name) === normal(club.club),
      );
    if (same.length === 1) assign(club, String(same[0].sourceTeamId), 'same name');
  }
  // Nations: the name the catalog uses for the same players (a name the catalog has too is
  // that nation: players do change nationality).
  const known = new Set([...Object.keys(codes), ...[...previous.values()].map(p => p.nationality)]);
  for (const [name, votes] of nationVotes) {
    if (existing?.nations && name in existing.nations) {
      map.nations[name] = existing.nations[name];
      continue;
    }
    const [[was, n]] = ranked(votes),
      total = ranked(votes).reduce((s, [, v]) => s + v, 0);
    if (was !== name && !known.has(name) && n >= 3 && n / total >= 0.7) map.nations[name] = was;
  }
  for (const [name, target] of Object.entries(existing?.nations || {}))
    if (nationPlayers.has(name)) map.nations[name] = target;
  // Report.
  const unmatched = [...clubs.values()].filter(c => !(c.key in map.clubs)),
    newClubs = [],
    outside = new Map();
  for (const club of unmatched) {
    const league = refLeagues.get(map.leagues[club.league]);
    if (league?.available) newClubs.push({ ...club, leagueId: league.sourceLeagueId });
    else tally(outside, club.league, club.n);
  }
  const moved = [];
  for (const club of clubs.values()) {
    const ref = refClubs.get(map.clubs[club.key]),
      league = map.leagues[club.league];
    if (ref && league != null && ref.sourceLeagueId !== league)
      moved.push({ key: club.key, id: String(ref.sourceTeamId), from: ref.sourceLeagueId, to: league });
  }
  const used = new Set(Object.values(map.clubs));
  const report = {
    players: rows.length,
    knownPlayers: rows.filter(r => previous.has(r.player_id)).length,
    clubs: clubs.size,
    matched: Object.keys(map.clubs).length,
    methods: Object.fromEntries(ranked(new Map([...how.values()].map(m => [m, 0])))),
    renamed: [...clubs.values()]
      .filter(c => refClubs.has(map.clubs[c.key]) && how.get(c.key) !== 'kept')
      .filter(c => normal(refClubs.get(map.clubs[c.key]).name) !== normal(c.club))
      .map(c => `${c.club} = ${refClubs.get(map.clubs[c.key]).name}`),
    changedLeague: moved,
    newClubs: newClubs.map(c => ({ key: c.key, players: c.n, leagueId: c.leagueId })),
    referenceClubsNotInSource: reference.clubs
      .filter(c => !used.has(String(c.sourceTeamId)))
      .map(c => `${c.name} (${c.leagueName})`),
    leaguesWithoutReference: Object.fromEntries(ranked(outside)),
    leagues: map.leagues,
    nations: map.nations,
    newNations: [...nationPlayers.keys()].filter(n => !known.has(map.nations[n] ?? n)).sort(),
  };
  for (const m of how.values()) report.methods[m]++;
  map.clubs = sortKeys(map.clubs);
  map.leagues = sortKeys(map.leagues);
  map.nations = sortKeys(map.nations);
  return { map, report, newClubs };
}

/** EA team ids of older sofifa-style snapshots: Map(player id → { id, name }) (latest row). */
function idHints(files) {
  const latest = new Map();
  for (const rows of files)
    for (const r of rows) {
      if (!r.club_team_id) continue;
      const version = Number(r.fifa_version) * 1000 + Number(r.fifa_update || 0),
        held = latest.get(r.player_id);
      if (!held || version > held.version)
        latest.set(r.player_id, { version, id: r.club_team_id, name: r.club_name });
    }
  return latest;
}

const tierOf = (score, thresholds) =>
  Object.entries(thresholds)
    .sort((a, b) => b[1] - a[1])
    .find(([, least]) => score >= least)[0];

/** The Opta Power Rankings table inside the page bundle: the largest array of contestants. */
export function optaTable(bundle) {
  let best = [];
  for (const m of bundle.matchAll(/JSON\.parse\(`(\[\{"rank":[^`]*)`\)/g)) {
    try {
      const table = JSON.parse(m[1]);
      if (table.length > best.length && table[0].contestantId) best = table;
    } catch {
      // Not a plain JSON table.
    }
  }
  if (!best.length) throw Error('No club table found in the Opta bundle');
  return best;
}
/** The one item whose names fit `name` best ({ item, score, exact }), or null when unclear. */
const best = (name, list, nameOf) => {
  const scored = list
    .map(item => ({
      item,
      score: Math.max(...nameOf(item).map(n => similarity(name, n, true))),
      exact: nameOf(item).some(n => similarity(name, n) === 1),
    }))
    .filter(x => x.score >= 0.5)
    .sort((a, b) => b.score - a.score);
  return scored[0] && (scored.length === 1 || scored[0].score > scored[1].score) ? scored[0] : null;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Reference entries for the clubs the reference does not know. Adds to reference.clubs /
 * reference.colors and to map.clubs; returns one review line per club.
 */
async function addClubs(newClubs, rows, map, reference, { hints, opta, enrich, today }) {
  const ids = new Set(reference.clubs.map(c => String(c.sourceTeamId)));
  let local = Math.max(900000, ...[...ids].map(Number).filter(n => n >= 900000));
  const byClub = new Map();
  for (const r of rows) {
    const key = clubKey(r.league, r.club);
    if (!byClub.has(key)) byClub.set(key, []);
    byClub.get(key).push(r.player_id);
  }
  // Clubs older snapshots know under exactly this name (one id per name).
  const hintNames = new Map(),
    clash = new Set();
  for (const hint of hints.values()) {
    const name = normal(hint.name);
    if (hintNames.has(name) && hintNames.get(name) !== hint.id) clash.add(name);
    hintNames.set(name, hint.id);
  }
  for (const name of clash) hintNames.delete(name);
  const leagues = new Map(reference.leagues.map(l => [l.sourceLeagueId, l]));
  const usedOpta = new Set(reference.clubs.map(c => c.optaClubId).filter(Boolean)),
    usedEspn = new Set(
      reference.colors.filter(c => c.provider === 'ESPN').map(c => String(c.sourceTeamId)),
    );
  const espn = new Map(); // slug → teams
  const slugOf = leagueId => {
    const votes = new Map();
    for (const c of reference.colors) {
      const slug = c.leagueId === leagueId && c.sourceApi?.match(/soccer\/([a-z0-9.]+)\/teams/);
      if (slug) tally(votes, slug[1]);
    }
    return ranked(votes)[0]?.[0] ?? null;
  };
  const lines = [];
  for (const club of newClubs) {
    const league = leagues.get(club.leagueId);
    // The EA team id, when older snapshots know the squad under a similar name.
    const votes = new Map(),
      names = new Map();
    for (const id of byClub.get(club.key)) {
      const hint = hints.get(id);
      if (!hint) continue;
      tally(votes, hint.id);
      names.set(hint.id, hint.name);
    }
    const won = winner(votes, 3),
      named = hintNames.get(normal(club.club)),
      real =
        won && !ids.has(won.id) && similarity(club.club, names.get(won.id), true) >= 0.5
          ? won.id
          : named && !ids.has(named)
            ? named
            : null,
      id = real ?? String(++local);
    if (real) names.set(real, names.get(real) ?? club.club);
    ids.add(id);
    const entry = {
      sourceTeamId: id,
      name: club.club,
      leagueName: league.name,
      genericRoster: false,
      idSource: real ? `EA team id (older snapshot: ${names.get(real)})` : 'local id',
      method: 'reconcile',
      sourceLeagueId: league.sourceLeagueId,
      leagueTier: league.tier,
      addedAt: today,
    };
    if (opta) {
      const found = best(
        club.club,
        opta.filter(o => o.leagueId === league.optaId && !usedOpta.has(o.contestantId)),
        o => [o.contestantName, o.contestantShortName, o.contestantClubName],
      );
      if (found) {
        const o = found.item;
        Object.assign(entry, {
          name: found.exact ? club.club : o.contestantName,
          optaId: o.optaId,
          optaClubId: o.contestantId,
          optaName: o.contestantName,
          score: o.currentRating,
          rank: o.rank,
          tier: tierOf(o.currentRating, reference.thresholds),
          method: found.exact ? 'exact-name-context' : 'reconcile-similar-name-context',
          optaLeagueId: o.leagueId,
          currentOptaLeagueMatch: true,
        });
        usedOpta.add(o.contestantId);
      }
    }
    let colour = null;
    const slug = enrich ? (league.espn ?? slugOf(league.sourceLeagueId)) : null;
    if (slug) {
      if (!espn.has(slug)) {
        const api = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/teams?limit=200`,
          response = await fetch(api);
        const body = response.ok ? await response.json() : null;
        espn.set(slug, {
          api,
          teams: (body?.sports?.[0]?.leagues?.[0]?.teams || []).map(t => t.team),
        });
        await sleep(1200);
      }
      const { api, teams } = espn.get(slug),
        found = best(
          entry.optaName ?? club.club,
          teams.filter(t => !usedEspn.has(String(t.id))),
          t => [t.displayName, t.shortDisplayName, t.name, t.location].filter(Boolean),
        ),
        t = found?.item;
      // ESPN fills clubs it has no colours for with black: that is not a colour.
      if (t?.color && !/^0{6}$/.test(t.color)) {
        usedEspn.add(String(t.id));
        colour = {
          id,
          name: entry.name,
          leagueId: league.sourceLeagueId,
          provider: 'ESPN',
          primary: `#${t.color.toUpperCase()}`,
          secondary:
            t.alternateColor && t.alternateColor !== t.color
              ? `#${t.alternateColor.toUpperCase()}`
              : null,
          sourceUrl: t.links?.[0]?.href ?? null,
          sourceApi: api,
          sourceKind: 'display-colors',
          badgeUrl: t.logos?.[0]?.href ?? null,
          sourceTeamId: String(t.id),
          sourceTeamName: t.displayName,
          retrievedAt: today,
        };
        reference.colors.push(colour);
      }
    }
    reference.clubs.push(entry);
    map.clubs[club.key] = id;
    lines.push(
      `${club.key} → ${id} (${entry.idSource}) "${entry.name}"` +
        ` | Opta: ${entry.optaName ?? '—'} ${entry.score?.toFixed(1) ?? ''}` +
        ` | colours: ${colour ? `${colour.sourceTeamName} ${colour.primary}/${colour.secondary}` : '—'}`,
    );
  }
  map.clubs = sortKeys(map.clubs);
  return lines;
}

async function main() {
  const args = process.argv.slice(2),
    flag = name => args.includes(name),
    value = name => (flag(name) ? args[args.indexOf(name) + 1] : null),
    list = name => {
      const out = [];
      for (let i = args.indexOf(name) + 1; i > 0 && i < args.length && !args[i].startsWith('--'); i++)
        out.push(args[i]);
      return out;
    };
  const started = performance.now();
  const csv = parseCSV(await readFile(value('--source') ?? PATHS.csv, 'utf8')),
    rows = menOf(csv),
    reference = JSON.parse(await readFile(PATHS.reference, 'utf8')),
    existing =
      !flag('--fresh') && existsSync(PATHS.sourceMap)
        ? JSON.parse(await readFile(PATHS.sourceMap, 'utf8'))
        : null;
  const parsed = performance.now();
  const previous = new Map();
  for (const p of loadRuntimeCatalog().players)
    previous.set(p.profileId.split(':')[1], {
      clubId: p.source.clubId,
      nationality: p.source.nationality,
    });
  const loaded = performance.now();
  const { codes } = JSON.parse(await readFile(PATHS.nationCodes, 'utf8'));
  const { map, report, newClubs } = reconcile(rows, previous, reference, existing, codes);
  const done = performance.now();
  let added = [];
  if (flag('--add-clubs') && newClubs.length) {
    const hints = idHints(
      await Promise.all(list('--ids').map(async f => parseCSV(await readFile(f, 'utf8')))),
    );
    let opta = null;
    if (flag('--enrich') || flag('--opta')) {
      const file = value('--opta'),
        bundle = file
          ? await readFile(file, 'utf8')
          : await (await fetch(reference.teamSources)).text();
      opta = optaTable(bundle);
    }
    added = await addClubs(newClubs, rows, map, reference, {
      hints,
      opta,
      enrich: flag('--enrich'),
      today: new Date().toISOString().slice(0, 10),
    });
    report.addedClubs = added;
  }
  const output = {
    description:
      'Names of the current-player source (EA ratings feed) → the reviewed reference: league name → reference league id (null: not a league of the reference), "league | club" → reference team id, nationality → the catalog\'s nation name. Maintained by `npm run data:reconcile`; hand corrections are kept. A club that is not listed has no reviewed entry: its players join nation pools only.',
    source: {
      file: SOURCE.file,
      sha256: SOURCE.sha256,
      edition: csv[0].edition,
      snapshot: isoDate(csv[0].snapshot_date),
    },
    ...map,
  };
  if (!flag('--dry')) {
    await writeFile(PATHS.sourceMap, JSON.stringify(output, null, 2) + '\n');
    if (added.length) await writeFile(PATHS.reference, JSON.stringify(reference) + '\n');
    await mkdir(dirname(PATHS.reconcileReport), { recursive: true });
    await writeFile(PATHS.reconcileReport, JSON.stringify(report, null, 2) + '\n');
  }
  const ms = (a, b) => Math.round(b - a);
  console.log(
    JSON.stringify(
      {
        players: report.players,
        knownPlayers: report.knownPlayers,
        clubs: report.clubs,
        matched: report.matched,
        methods: report.methods,
        changedLeague: report.changedLeague.length,
        newClubs: report.newClubs.map(c => c.key),
        addedClubs: added,
        referenceClubsNotInSource: report.referenceClubsNotInSource.length,
        leaguesWithoutReference: report.leaguesWithoutReference,
        nations: report.nations,
        newNations: report.newNations,
        ms: {
          parse: ms(started, parsed),
          catalog: ms(parsed, loaded),
          reconcile: ms(loaded, done),
        },
        report: flag('--dry') ? null : PATHS.reconcileReport,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(e => {
    console.error(e.stack || e.message);
    process.exitCode = 1;
  });
