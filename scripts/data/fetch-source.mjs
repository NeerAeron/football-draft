// npm run data:fetch — download the pinned source CSVs into data/raw/ and verify their
// SHA-256: the FC 27 ratings file (current players), the FIFA 15–23 legacy file and the FC 24,
// FC 25 and FC 26 files (era pools, Legends, Prime versions). No-op for a file whose valid copy is already there.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PATHS, SOURCE, LEGACY_SOURCE, MODERN_SOURCES } from './paths.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const FILES = [
  { source: SOURCE, path: PATHS.csv },
  { source: LEGACY_SOURCE, path: PATHS.legacyCsv },
  ...MODERN_SOURCES.map(source => ({ source, path: PATHS.modernCsv(source.edition) })),
];

export async function verifySource(path = PATHS.csv, source = SOURCE) {
  try {
    return sha256(await readFile(path)) === source.sha256;
  } catch {
    return false;
  }
}

async function fetchFile({ source, path }) {
  if (await verifySource(path, source)) {
    console.log(`${source.file} already present and verified (${path})`);
    return;
  }
  console.log(`Downloading ${source.url}`);
  const response = await fetch(source.url);
  if (!response.ok) throw Error(`Download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer()),
    actual = sha256(bytes);
  if (actual !== source.sha256)
    throw Error(`SHA-256 mismatch: expected ${source.sha256}, got ${actual}`);
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + '.part';
  await writeFile(temporary, bytes);
  await rm(path, { force: true });
  await rename(temporary, path);
  console.log(`Saved ${bytes.length} bytes to ${path} (SHA-256 verified)`);
}

async function main() {
  for (const file of FILES) await fetchFile(file);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(e => {
    console.error(e.message);
    process.exitCode = 1;
  });
