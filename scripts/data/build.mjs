// npm run data:build — compile the whole catalog deterministically (byte-identical reruns):
//   data/raw/FC26_20250921.csv (npm run data:fetch) + data/catalog-reference.json
//   → data/build/players-fc26.json   full catalog with provenance (gitignored, for audits)
//   → app/data/catalog.v3.json       runtime catalog, format v3 (catalog-codec.js)
//   → app/assets/flags/*.svg         flag of every nationality in the catalog
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
import { writeFlags } from './flags.mjs';
import { PATHS, SOURCE } from './paths.mjs';

export async function compileSource() {
  let bytes;
  try {
    bytes = await readFile(PATHS.csv);
  } catch {
    throw Error(`Missing ${PATHS.csv}: run \`npm run data:fetch\` first`);
  }
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== SOURCE.sha256)
    throw Error(`${PATHS.csv} has SHA-256 ${hash}, expected ${SOURCE.sha256}; run data:fetch`);
  const reference = JSON.parse(await readFile(PATHS.reference, 'utf8'));
  return compileLeagueCatalog(parseCSV(bytes.toString('utf8')), reference, hash);
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
  let compiled;
  if (from) compiled = JSON.parse(await readFile(from, 'utf8'));
  else {
    compiled = await compileSource();
    await mkdir(dirname(PATHS.provenance), { recursive: true });
    await writeFile(PATHS.provenance, JSON.stringify(compiled) + '\n');
  }
  const { runtime, text, flags } = await writeRuntime(compiled);
  const bytes = Buffer.from(text);
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
