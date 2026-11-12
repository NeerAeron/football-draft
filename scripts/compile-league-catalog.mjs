import { rateClubCatalog } from '../app/core/players/team-ratings.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { compilePlayer, parseCSV, COMPILER_VERSION } from './compile-players.mjs';
import { ATTRS } from '../app/core/players/ratings.js';
import { PATHS, SOURCE } from './data/paths.mjs';

/**
 * The reviewed Captain list (data/captains.json) → Map(sofifa id → entry) of its first `size`
 * players. Every entry of the list must be a catalog player with that name and nation: a wrong
 * id fails the build.
 */
export function captainIds(captains, players) {
  const byId = new Map(players.map(p => [String(p.sourcePlayerId), p])),
    ids = new Map();
  const size = captains?.size ?? Infinity;
  for (const [i, c] of (captains?.players || []).entries()) {
    const p = byId.get(String(c.sofifaId));
    if (!p) throw Error(`Captain ${c.name} (${c.sofifaId}) is not in the catalog`);
    if (p.source.nationality !== c.nation)
      throw Error(`Captain ${c.name}: nation ${p.source.nationality}, expected ${c.nation}`);
    if (c.sourceName !== p.name)
      throw Error(`Captain ${c.name}: the source calls ${c.sofifaId} "${p.name}"`);
    if (i < size) ids.set(String(c.sofifaId), c);
  }
  return ids;
}
export function compileLeagueCatalog(rows, reference, hash = null, captains = null) {
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.player_id)) throw Error(`Duplicate ${row.player_id}`);
    seen.add(row.player_id);
  }
  // Selection policy: every player rated at least the reference's minimum overall, wherever he
  // plays. Players of the available leagues come first, in reference league order, best
  // source overall first; then the players whose club has no reviewed entry in the reference
  // (leagues the game does not carry): they get no club or league, so they can join nation
  // pools but never league or club pools.
  const minimum = reference.selection?.minimumOverall ?? 0,
    indexed = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => Number(row.overall) >= minimum),
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
  const clubless = indexed.filter(({ row }) => !row.club_team_id);
  selected.push(...clubless.sort(byOverall));
  const players = selected.map(({ row, index }) => {
    const p = compilePlayer(row, index + 1);
    p.source.sha256 = hash;
    return p;
  });
  for (const id of captainIds(captains, players).keys())
    players.find(p => String(p.sourcePlayerId) === id).captain = true;
  const colors = new Map(reference.colors.map(c => [String(c.id), c])),
    ratings = new Map(reference.clubs.map(c => [String(c.sourceTeamId), c]));
  const clubs = new Map();
  for (const p of players) {
    if (p.source.clubId == null) continue;
    const id = String(p.source.clubId);
    if (!clubs.has(id)) {
      const rating = ratings.get(id),
        color = colors.get(id);
      if (!rating) throw Error(`No reference entry for club ${p.source.club}`);
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
      url: SOURCE.page,
      author: SOURCE.author,
      upstream: SOURCE.upstream,
      license: SOURCE.license,
      licenseUrl: SOURCE.licenseUrl,
      sha256: hash,
      asOf: reference.rosterDate,
      optaAsOf: reference.optaDate,
    },
    captains: captains
      ? {
          rule: 'Reviewed list of real national-team captains (data/captains.json)',
          asOf: captains.asOf,
          size: Math.min(captains.size ?? Infinity, captains.players.length),
        }
      : null,
    selection: {
      sourceRows: rows.length,
      policy: `Every player rated ${minimum}+: with his club when it has a reviewed entry in an available league, otherwise without club or league (nation pools only)`,
      minimumOverall: minimum,
      leaguePlayers: selected.length - clubless.length,
      clublessPlayers: clubless.length,
      order:
        'Leagues in reference order, then club-less players; each by source overall descending, original row order breaking ties',
      excluded: `Women's football and players rated under ${minimum}`,
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
    reference = JSON.parse(await readFile(referencePath, 'utf8')),
    captains = JSON.parse(await readFile(PATHS.captains, 'utf8'));
  const catalog = compileLeagueCatalog(
    parseCSV(bytes.toString('utf8')),
    reference,
    createHash('sha256').update(bytes).digest('hex'),
    captains,
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
