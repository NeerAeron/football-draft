import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBlock, withBlock } from '../scripts/dev/preload.mjs';

test('the preload block of app/index.html lists the first screen (run `npm run preload`)', () => {
  const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8'),
    { block, modules, styles } = buildBlock(html);
  assert.equal(
    withBlock(html, block),
    html,
    'app/index.html is out of date: an import or stylesheet changed — run `npm run preload`',
  );
  // The entry graph: the shell, the Home screen, the vendored libraries, every stylesheet.
  assert.ok(modules > 20 && styles > 20);
  for (const needed of [
    './ui/shell/app.js',
    './ui/screens/home/home.js',
    './ui/vendor/preact/preact.module.js',
    './ui/vendor/htm/htm.module.js',
  ])
    assert.ok(block.includes(`<link rel="modulepreload" href="${needed}" />`), needed);
  assert.ok(block.includes('<link rel="preload" as="style" href="./ui/styles/tokens.css" />'));
  // Lazy screens stay lazy (Home warms them when idle).
  assert.ok(!block.includes('rel="modulepreload" href="./ui/screens/match/'));
});
