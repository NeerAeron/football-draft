// npm run data:build — compile the whole catalog deterministically (byte-identical reruns):
//   data/raw/FC27_20260912.csv (npm run data:fetch; the EA ratings feed) + data/source-map.json
//   (its club, league and nation names → the reference; npm run data:reconcile) +
//   data/catalog-reference.json
//   → data/build/players.json        full catalog with provenance (gitignored, for audits)
//   → app/data/catalog.v3.json       runtime catalog, format v3 (catalog-codec.js)
//   → app/assets/flags/*.svg         flag of every nationality in the catalog
//   data/raw/FIFA15-23_male_players_legacy.csv (FIFA 15–23) + data/legacy-titles.json and
//   data/legacy-names.json (FIFA 98–14, in the repository) + the FC 24, FC 25 and FC 26 files
//   in data/raw/ + the compiled catalog
//   → app/data/legends.v1.json       Legends and Prime versions (legends-codec.js)
//   → data/build/legends.json        the same players with provenance (gitignored)
//   → app/data/eras.v1.json          era pools: nation × World Cup cycle (eras-codec.js)
//   → data/build/eras.json           the same with provenance (gitignored)
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
import { encodeEras } from '../../app/core/players/eras-codec.js';
import { badgeStamp } from '../../app/core/players/catalog-derived.js';
import {
  compileLegends,
  LEGACY,
  TITLES,
  SELECTION,
  ERA_SELECTION,
} from '../compile-legends.mjs';
import { fc24Rows, fc25Rows, fc26Rows, sofifaRows } from './modern-titles.mjs';
import { loadLegacyTitles } from './legacy-titles.mjs';
import {
  PATHS,
  SOURCE,
  LEGACY_SOURCE,
  LEGACY_TITLES,
  LEGACY_NAMES,
  MODERN_SOURCES,
} from './paths.mjs';

async function readText(path, source) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch {
    throw Error(`Missing ${path}: run \`npm run data:fetch\` first`);
  }
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== source.sha256)
    throw Error(`${path} has SHA-256 ${hash}, expected ${source.sha256}; run data:fetch`);
  return bytes.toString('utf8');
}
/** FC 24, FC 25 and FC 26 as compiler rows: [{ edition, rows, source }], oldest first. */
export async function readModernTitles() {
  const map = JSON.parse(await readFile(PATHS.sourceMap, 'utf8')),
    read = { 24: fc24Rows, 25: text => fc25Rows(parseCSV(text), map), 26: fc26Rows },
    out = [];
  for (const source of MODERN_SOURCES)
    out.push({
      edition: source.edition,
      rows: read[source.edition](await readText(PATHS.modernCsv(source.edition), source)),
      source: {
        url: source.page,
        author: source.author,
        upstream: source.upstream,
        license: source.license,
        revision: source.revision,
        sha256: source.sha256,
      },
    });
  return out;
}
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
 * Legends and Prime versions from the two pinned past sources, for a runtime catalog: the
 * file text (app/data/legends.v1.json), the players and the provenance (how every title was
 * put on the scale, where each card's numbers come from).
 */
export async function compileLegendsFile(compiled, runtime) {
  // The legacy file is 91 MB of 110 columns: only the columns the compiler reads are kept.
  const rows = sofifaRows(await readText(PATHS.legacyCsv, LEGACY_SOURCE)),
    hash = LEGACY_SOURCE.sha256,
    older = await loadLegacyTitles(PATHS.legacyTitles, LEGACY_TITLES.sha256, {
      path: PATHS.legacyNames,
      sha256: LEGACY_NAMES.sha256,
    }),
    modern = await readModernTitles(),
    marks = {
      goats: JSON.parse(await readFile(PATHS.goats, 'utf8')),
      captains: JSON.parse(await readFile(PATHS.captains, 'utf8')),
      worldCups: JSON.parse(await readFile(PATHS.worldCups, 'utf8')),
      starters: JSON.parse(await readFile(PATHS.starters, 'utf8')),
      handCards: JSON.parse(await readFile(PATHS.handCards, 'utf8')),
    },
    { legends, primes, eras, stats, calibration, notes } = compileLegends(
      rows,
      compiled,
      hash,
      older,
      modern,
      marks,
    ),
    sample = runtime.players[0].profileId.match(/^(\D*)\d+(\D.*)$/);
  if (older.source.sha256 !== LEGACY_TITLES.workbookSha256)
    throw Error(`${PATHS.legacyTitles} was made from another workbook than the pinned one`);
  const data = {
    compilerVersion: compiled.compilerVersion,
    source: {
      ...LEGACY,
      file: 'male_players (legacy).csv',
      revision: LEGACY_SOURCE.revision,
      sha256: hash,
      // The second past source: FIFA 98–14.
      older: {
        ...TITLES,
        url: LEGACY_TITLES.archive,
        file: `data/${LEGACY_TITLES.file}`,
        sha256: older.sha256,
        workbookSha256: older.source.sha256,
        namesSha256: older.names.sha256,
        titles: older.titles.length,
      },
      // FC 24, FC 25, FC 26.
      modern: modern.map(m => ({ edition: m.edition, rows: m.rows.length, ...m.source })),
    },
    selection: {
      sourceRows: rows.length,
      olderRows: older.titles.reduce((n, t) => n + t.players.length, 0),
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
  const eraData = {
    compilerVersion: compiled.compilerVersion,
    sources: data.source,
    selection: { ...ERA_SELECTION, nations: eras.summary },
    catalog: data.catalog,
    attributeKeys: data.attributeKeys,
    dictionaries: data.dictionaries,
    precomputed: data.precomputed,
    eras: eras.eras,
    cards: eras.cards,
    pools: eras.pools,
  };
  return {
    data,
    stats,
    provenance: { ...data, calibration, dropped: stats.dropped, merged: stats.merged, notes },
    text: JSON.stringify(encodeLegends(data)) + '\n',
    eras: {
      data: eraData,
      stats: eras.stats,
      summary: eras.summary,
      provenance: { ...eraData, stats: eras.stats },
      text: JSON.stringify(encodeEras(eraData)) + '\n',
    },
  };
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
  let legends = null,
    eraReport = null;
  if (rows) {
    const built = await compileLegendsFile(compiled, runtime),
      legendBytes = Buffer.from(built.text);
    await writeFile(PATHS.legends, built.text);
    await writeFile(PATHS.legendsProvenance, JSON.stringify(built.provenance) + '\n');
    const eraBytes = Buffer.from(built.eras.text);
    await writeFile(PATHS.eras, built.eras.text);
    await writeFile(PATHS.erasProvenance, JSON.stringify(built.eras.provenance) + '\n');
    const {
      sameName,
      otherNations: eraOthers,
      goats,
      captains,
      starters,
      handCards,
      displaced,
      ...eraCounts
    } = built.eras.stats;
    eraReport = {
      ...eraCounts,
      goatCards: goats.length,
      startersPlaced: starters.length,
      // pushed out of a pool by a starter: their cards stay in the file, in no pool
      displacedKept: displaced.length,
      handCards: handCards.length,
      captainCards: captains.length,
      sameName: sameName.length,
      otherNations: Object.keys(eraOthers).length,
      eras: built.eras.summary.map(e => `${e.label}: ${e.nations} of ${e.qualified}`),
      // qualified, but beyond the era's limit of nations (the strongest are kept)
      left: built.eras.summary.map(e => `${e.label}: ${e.left.join(", ") || "—"}`),
      // in beyond the limit, or with a pool under the minimum: World Cup sides, star nations
      always: built.eras.summary.map(e => `${e.label}: ${e.always.join(", ") || "—"}`),
      path: PATHS.eras,
      bytes: eraBytes.length,
      gzip: gzipSync(eraBytes, { level: 9 }).length,
      brotli: brotliCompressSync(eraBytes).length,
    };
    const { dropped, merged, otherNations, ...counts } = built.stats;
    legends = {
      legends: built.data.legends.length,
      primes: built.data.primes.length,
      ...counts,
      dropped: dropped.length,
      mergedIds: merged.length,
      otherNations,
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
        eras: eraReport,
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
