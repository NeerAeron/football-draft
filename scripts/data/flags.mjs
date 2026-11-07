// Copy the flag-icons 4x3 SVG of every nation in the catalog into app/assets/flags/, optimised
// with svgo. Flags of 16 KB or more carry detailed coats of arms; their paths are rounded to
// whole units of the 640×480 view box (visually identical at flag sizes, about a third of the
// bytes). Deterministic for pinned flag-icons and svgo versions.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { optimize } from 'svgo';
import { PATHS } from './paths.mjs';

const DETAILED = 16 * 1024;

export async function writeFlags(codes, { source = PATHS.flagSource, target = PATHS.flags } = {}) {
  await mkdir(target, { recursive: true });
  const wanted = new Set(codes.map(c => `${c}.svg`));
  for (const file of await readdir(target))
    if (file.endsWith('.svg') && !wanted.has(file)) await rm(join(target, file));
  let before = 0,
    after = 0;
  for (const file of [...wanted].sort()) {
    const svg = await readFile(join(source, 'flags/4x3', file), 'utf8');
    const out = optimize(svg, {
      path: file,
      multipass: true,
      ...(svg.length >= DETAILED ? { floatPrecision: 0 } : {}),
    }).data;
    before += svg.length;
    after += out.length;
    await writeFile(join(target, file), out + '\n');
  }
  const licence = await readFile(join(source, 'LICENSE'), 'utf8');
  await writeFile(
    join(target, 'LICENSE'),
    'Flag SVGs from flag-icons 7.6.0 (https://github.com/lipis/flag-icons), optimised with svgo.\n\n' +
      licence,
  );
  return { flags: wanted.size, sourceBytes: before, bytes: after };
}
