// npm run data:fetch — download the pinned FC 26 CSV into data/raw/ and verify its SHA-256.
// No-op when a valid copy is already there.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PATHS, SOURCE } from './paths.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function verifySource(path = PATHS.csv) {
  try {
    return sha256(await readFile(path)) === SOURCE.sha256;
  } catch {
    return false;
  }
}

async function main() {
  if (await verifySource()) {
    console.log(`${SOURCE.file} already present and verified (${PATHS.csv})`);
    return;
  }
  console.log(`Downloading ${SOURCE.url}`);
  const response = await fetch(SOURCE.url);
  if (!response.ok) throw Error(`Download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer()),
    actual = sha256(bytes);
  if (actual !== SOURCE.sha256)
    throw Error(`SHA-256 mismatch: expected ${SOURCE.sha256}, got ${actual}`);
  await mkdir(dirname(PATHS.csv), { recursive: true });
  const temporary = PATHS.csv + '.part';
  await writeFile(temporary, bytes);
  await rm(PATHS.csv, { force: true });
  await rename(temporary, PATHS.csv);
  console.log(`Saved ${bytes.length} bytes to ${PATHS.csv} (SHA-256 verified)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(e => {
    console.error(e.message);
    process.exitCode = 1;
  });
