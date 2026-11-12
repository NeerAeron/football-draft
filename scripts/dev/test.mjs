// Test runner wrapper around `node --test`.
//
//   node scripts/dev/test.mjs                 # every tests/**/*.test.mjs, all cores
//   node scripts/dev/test.mjs --fast          # skip the slowest tests (~10 s)
//   node scripts/dev/test.mjs draft session   # only files whose path contains a word
//   node scripts/dev/test.mjs --grep "offside" # only tests whose name matches
//
// Extra flags after `--` are passed to node --test unchanged.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
// The slowest tests (complete matches, hundreds of drafts, data rebuilds). They dominate the
// suite's run time; --fast skips them. Keep this list short and name-based.
const SLOW = [
  'recorded, instant, and direct full simulations',
  'highlight halves preserve authoritative state',
  'real-player match preserves profiles and tactics',
  'survive swaps, reset, export and instant',
  'matches finish with finite positions',
  'continuous lengths include regulation',
  'every formation pairing draws',
  'formation variations have eleven usable roles',
  'same seed and inputs produce the same match state',
  'however it is played: complete, by halves, stepped',
  'event contract over a full match',
  'a budget draft never exceeds a band',
  'precomputed values match the live configuration',
  'stale configuration stamps recompute',
  // Recompiles the 91 MB legacy CSV (~20 s; only where data/raw has the pinned files).
  'the pinned CSVs give this exact file',
];

const argv = process.argv.slice(2);
const passthrough = argv.includes('--') ? argv.slice(argv.indexOf('--') + 1) : [];
const args = argv.includes('--') ? argv.slice(0, argv.indexOf('--')) : argv;
const fast = args.includes('--fast');
const grepIndex = args.indexOf('--grep');
const grep = grepIndex >= 0 ? args[grepIndex + 1] : null;
const words = args.filter((a, i) => !a.startsWith('--') && (grepIndex < 0 || i !== grepIndex + 1));

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith('.test.mjs')) files.push(relative(root, path));
  }
})(join(root, 'tests'));
const selected = files.filter(f => !words.length || words.some(w => f.includes(w))).sort();
if (!selected.length) {
  console.error(`No test files match: ${words.join(', ')}`);
  process.exit(1);
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const flags = [`--test-concurrency=${Math.max(1, availableParallelism())}`];
if (fast) flags.push(`--test-skip-pattern=${SLOW.map(escape).join('|')}`);
if (grep) flags.push(`--test-name-pattern=${grep}`);
const result = spawnSync(process.execPath, ['--test', ...flags, ...passthrough, ...selected], {
  cwd: root,
  stdio: 'inherit',
});
process.exitCode = result.status ?? 1;
