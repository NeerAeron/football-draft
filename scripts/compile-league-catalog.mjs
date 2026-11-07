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
  const indexed = rows.map((row, index) => ({ row, index })),
    selected = [],
    leagues = [];
  for (const definition of reference.leagues) {
    const available = indexed.filter(({ row }) => row.league_id === definition.sourceLeagueId);
    const ranked = available.sort(
      (a, b) => Number(b.row.overall) - Number(a.row.overall) || a.index - b.index,
    );
    const chosen = definition.available ? ranked.slice(0, definition.cap ?? ranked.length) : [];
    selected.push(...chosen);
    leagues.push({ ...definition, playerCount: chosen.length });
  }
  // Expansions are cumulative beyond the original league allocation. Keep that
  // allocation intact, then take the best unused outfield players and GKs separately.
  const expansion = { outfield: 0, goalkeepers: 0, ...reference.expansion };
  for (const key of ['outfield', 'goalkeepers'])
    if (!Number.isSafeInteger(expansion[key]) || expansion[key] < 0)
      throw Error(`Invalid expansion ${key}`);
  const selectedIds = new Set(selected.map(p => p.row.player_id)),
    eligibleLeagues = new Set(leagues.filter(l => l.available).map(l => l.sourceLeagueId));
  const remaining = indexed
    .filter(({ row }) => eligibleLeagues.has(row.league_id) && !selectedIds.has(row.player_id))
    .sort((a, b) => Number(b.row.overall) - Number(a.row.overall) || a.index - b.index);
  const isKeeper = p => p.row.player_positions.split(',')[0].trim() === 'GK',
    added = [];
  for (const [key, keeper] of [
    ['outfield', false],
    ['goalkeepers', true],
  ]) {
    const candidates = remaining.filter(p => isKeeper(p) === keeper);
    if (candidates.length < expansion[key])
      throw Error(
        `Not enough unused ${key}: requested ${expansion[key]}, available ${candidates.length}`,
      );
    added.push(...candidates.slice(0, expansion[key]));
  }
  selected.push(...added);
  for (const league of leagues) {
    league.basePlayerCount = league.playerCount;
    league.expansionPlayerCount = added.filter(
      p => p.row.league_id === league.sourceLeagueId,
    ).length;
    league.playerCount += league.expansionPlayerCount;
  }
  const players = selected.map(({ row, index }) => {
    const p = compilePlayer(row, index + 1);
    p.source.sha256 = hash;
    return p;
  });
  const colors = new Map(reference.colors.map(c => [String(c.id), c])),
    ratings = new Map(reference.clubs.map(c => [String(c.sourceTeamId), c]));
  const clubs = new Map();
  for (const p of players) {
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
      leagueCaps: { A: 'all', B: 200, C: 100, D: 50, F: 20 },
      expansion,
      order:
        'Base league allocation first; then additional outfield players and goalkeepers ranked by source overall descending, original row order breaking ties',
      excluded: 'Missing leagues and generic Brazilian identities',
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
