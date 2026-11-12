// npm run data:build — compile the whole catalog deterministically (byte-identical reruns):
//   data/raw/FC27_20260912.csv (npm run data:fetch; the EA ratings feed) + data/source-map.json
//   (its club, league and nation names → the reference; npm run data:reconcile) +
//   data/catalog-reference.json
//   → data/build/players.json        full catalog with provenance (gitignored, for audits)
//   → app/data/catalog.v3.json       runtime catalog, format v3 (catalog-codec.js)
//   → app/assets/flags/*.svg         flag of every nationality in the catalog
//   data/raw/FIFA15-23_male_players_legacy.csv (past editions) + the compiled catalog
//   → app/data/legends.v1.json       Legends and Prime versions (legends-codec.js)
//   → data/build/legends.json        the same players with provenance (gitignored)
// Options: --from <file.json>  re-encode a compiled or schema-2 runtime catalog instead of the CSV.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { compileLeagueCatalog } from '../compile-league-catalog.mjs';
import { parseCSV } from '../compile-players.mjs';
import { encodeCatalog } from '../../app/core/players/catalog-codec.js';
import { toRuntimeCatalog } from './runtime-catalog.mjs';
import { adaptSource } from './ea-source.mjs';
import { writeFlags } from './flags.mjs';
import { encodeLegends, catalogIds } from '../../app/core/players/legends-codec.js';
import { badgeStamp } from '../../app/core/players/catalog-derived.js';
import { compileLegends, LEGACY, SELECTION } from '../compile-legends.mjs';
import { PATHS, SOURCE, LEGACY_SOURCE } from './paths.mjs';

async function readSource(path, source) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch {
    throw Error(`Missing ${path}: run \`npm run data:fetch\` first`);
  }
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== source.sha256)
    throw Error(`${path} has SHA-256 ${hash}, expected ${source.sha256}; run data:fetch`);
  return { rows: parseCSV(bytes.toString('utf8')), hash };
}

/**
 * The current catalog from the pinned CSV: { compiled, rows } (rows: the feed's men, in the
 * compiler's column names, with the clubs, leagues and nations of the reference).
 */
export async function compileSource() {
  const source = await readSource(PATHS.csv, SOURCE),
    reference = JSON.parse(await readFile(PATHS.reference, 'utf8')),
    map = JSON.parse(await readFile(PATHS.sourceMap, 'utf8')),
    captains = JSON.parse(await readFile(PATHS.captains, 'utf8'));
  if (map.source.sha256 !== source.hash)
    throw Error(`${PATHS.sourceMap} was made for another snapshot: run \`npm run data:reconcile\``);
  const rows = adaptSource(source.rows, map, reference);
  return { compiled: compileLeagueCatalog(rows, reference, source.hash, captains), rows };
}

/**
 * Legends and Prime versions from the pinned legacy CSV, for a runtime catalog: the file text
 * (app/data/legends.v1.json) and the players.
 */
export async function compileLegendsFile(compiled, runtime) {
  const { rows, hash } = await readSource(PATHS.legacyCsv, LEGACY_SOURCE),
    { legends, primes, stats } = compileLegends(rows, compiled, hash),
    sample = runtime.players[0].profileId.match(/^(\D*)\d+(\D.*)$/);
  const data = {
    compilerVersion: compiled.compilerVersion,
    source: {
      ...LEGACY,
      file: 'male_players (legacy).csv',
      revision: LEGACY_SOURCE.revision,
      sha256: hash,
    },
    selection: {
      sourceRows: rows.length,
      ...SELECTION,
    },
    catalog: {
      players: runtime.players.length,
      ids: catalogIds(runtime),
      profileId: { prefix: sample[1], suffix: sample[2] },
    },
    attributeKeys: runtime.attributeKeys,
    dictionaries: runtime.dictionaries,
    precomputed: { badges: badgeStamp() },
    legends,
    primes,
  };
  return { data, stats, text: JSON.stringify(encodeLegends(data)) + '\n' };
}

export async function writeRuntime(compiled, path = PATHS.catalog) {
  const { codes } = JSON.parse(await readFile(PATHS.nationCodes, 'utf8'));
  const runtime = toRuntimeCatalog(compiled, codes),
    text = JSON.stringify(encodeCatalog(runtime)) + '\n';
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
  const flags = await writeFlags(runtime.nations.map(n => n.code));
  return { runtime, text, flags };
}

async function main() {
  const args = process.argv.slice(2),
    from = args.includes('--from') ? args[args.indexOf('--from') + 1] : null;
  let compiled,
    rows = null;
  if (from) compiled = JSON.parse(await readFile(from, 'utf8'));
  else {
    ({ compiled, rows } = await compileSource());
    await mkdir(dirname(PATHS.provenance), { recursive: true });
    await writeFile(PATHS.provenance, JSON.stringify(compiled) + '\n');
  }
  const { runtime, text, flags } = await writeRuntime(compiled);
  const bytes = Buffer.from(text);
  // Legends and Prime versions (not with --from: they need both CSVs).
  let legends = null;
  if (rows) {
    const built = await compileLegendsFile(compiled, runtime),
      legendBytes = Buffer.from(built.text);
    await writeFile(PATHS.legends, built.text);
    await writeFile(PATHS.legendsProvenance, JSON.stringify(built.data) + '\n');
    legends = {
      legends: built.data.legends.length,
      primes: built.data.primes.length,
      ...built.stats,
      path: PATHS.legends,
      bytes: legendBytes.length,
      gzip: gzipSync(legendBytes, { level: 9 }).length,
      brotli: brotliCompressSync(legendBytes).length,
    };
  }
  console.log(
    JSON.stringify(
      {
        players: runtime.players.length,
        goalkeepers: runtime.players.filter(p => p.primaryPosition === 'GK').length,
        clubless: runtime.players.filter(p => p.source.clubId == null).length,
        teams: runtime.teams.length,
        leagues: runtime.leagues.length,
        nations: runtime.nations.length,
        catalog: {
          path: PATHS.catalog,
          bytes: bytes.length,
          gzip: gzipSync(bytes, { level: 9 }).length,
          brotli: brotliCompressSync(bytes).length,
        },
        captains: runtime.players.filter(p => p.captain).map(p => p.name),
        legends,
        flags,
        provenance: from ? null : PATHS.provenance,
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
