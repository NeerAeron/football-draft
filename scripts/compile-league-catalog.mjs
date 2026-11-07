import { rateClubCatalog } from '../app/core/players/team-ratings.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { compilePlayer, parseCSV, COMPILER_VERSION, SOURCE_URL } from './compile-players.mjs';
import { ATTRS } from '../app/core/players/ratings.js';
import { PATHS } from './data/paths.mjs';

export function compileLeagueCatalog(rows, reference, hash = null) {
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.player_id)) throw Error(`Duplicate ${row.player_id}`);
    seen.add(row.player_id);
  }
  // Selection policy: every player of every available league (no caps), in reference league
  // order, best source overall first. Then, when the reference enables it, club-less players
  // with a national-team call-up (real players whose clubs are outside the dataset): they get
  // no club or league, so they can join nation pools but never league or club pools.
  const indexed = rows.map((row, index) => ({ row, index })),
    byOverall = (a, b) => Number(b.row.overall) - Number(a.row.overall) || a.index - b.index,
    selected = [],
    leagues = [];
  for (const { cap, ...definition } of reference.leagues) {
    if (cap != null) throw Error(`League caps are no longer supported (${definition.name})`);
    const chosen = definition.available
      ? indexed.filter(({ row }) => row.league_id === definition.sourceLeagueId).sort(byOverall)
      : [];
    selected.push(...chosen);
    leagues.push({ ...definition, playerCount: chosen.length });
  }
  const clubless = reference.selection?.clublessNationalTeamPlayers
    ? indexed.filter(({ row }) => !row.club_team_id && !row.league_id && row.nation_team_id)
    : [];
  selected.push(...clubless.sort(byOverall));
  const players = selected.map(({ row, index }) => {
    const p = compilePlayer(row, index + 1);
    p.source.sha256 = hash;
    return p;
  });
  const colors = new Map(reference.colors.map(c => [String(c.id), c])),
    ratings = new Map(reference.clubs.map(c => [String(c.sourceTeamId), c]));
  const clubs = new Map();
  for (const p of players) {
    if (p.source.clubId == null) continue;
    const id = String(p.source.clubId);
    if (!clubs.has(id)) {
      const rating = ratings.get(id),
        color = colors.get(id);
      if (!rating) throw Error(`Missing verified club rating: ${p.source.club}`);
      clubs.set(id, {
        id,
        name: p.source.club,
        leagueId: p.source.leagueId,
        tier: rating.tier,
        optaScore: rating.score,
        optaRank: rating.rank,
        optaId: rating.optaClubId,
        primary: color?.primary || null,
        secondary: color?.secondary || null,
        colorSource: color?.sourceUrl || null,
        colorKind: color?.sourceKind || null,
        playerCount: 0,
      });
    }
    clubs.get(id).playerCount++;
  }
  return {
    schemaVersion: 2,
    compilerVersion: COMPILER_VERSION,
    source: {
      url: SOURCE_URL,
      author: 'rovnez',
      upstream: 'SoFIFA / EA SPORTS FC 26',
      license: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      sha256: hash,
      asOf: reference.rosterDate,
      optaAsOf: reference.optaDate,
    },
    selection: {
      sourceRows: rows.length,
      policy:
        'Every player of every available league, no caps; plus club-less players with a national-team call-up (no club or league: nation pools only)',
      leaguePlayers: selected.length - clubless.length,
      clublessNationalTeamPlayers: clubless.length,
      order:
        'Leagues in reference order, then club-less players; each by source overall descending, original row order breaking ties',
      excluded:
        'Leagues absent from the reference or unavailable (including the generic Brazilian Série A identities), players at clubs outside those leagues (no reviewed club metadata), and club-less players without a national-team call-up',
    },
    attributeKeys: Object.keys(ATTRS),
    leagues,
    teams: rateClubCatalog({ teams: [...clubs.values()], players }),
    players,
  };
}
async function main() {
  const [csv, referencePath, output, runtimeArg] = process.argv.slice(2);
  if (!csv || !referencePath || !output)
    throw Error('Usage: compile-league-catalog.mjs CSV REFERENCE OUTPUT [RUNTIME_OUTPUT]');
  const bytes = await readFile(csv),
    reference = JSON.parse(await readFile(referencePath, 'utf8'));
  const catalog = compileLeagueCatalog(
    parseCSV(bytes.toString('utf8')),
    reference,
    createHash('sha256').update(bytes).digest('hex'),
  );
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(catalog) + '\n');
  // The runtime catalog (format v3) is the only catalog file the browser fetches.
  const { writeRuntime } = await import('./data/build.mjs');
  const { runtime } = await writeRuntime(catalog, runtimeArg || PATHS.catalog);
  console.log(
    JSON.stringify({
      players: catalog.players.length,
      teams: catalog.teams.length,
      leagues: catalog.leagues.length,
      nations: runtime.nations.length,
      draftLeagues: catalog.leagues.filter(l => l.playerCount >= 5).length,
      keepers: catalog.players.filter(p => p.primaryPosition === 'GK').length,
      missingColors: catalog.teams.filter(t => !t.primary).length,
    }),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(e => {
    console.error(e.message);
    process.exitCode = 1;
  });
