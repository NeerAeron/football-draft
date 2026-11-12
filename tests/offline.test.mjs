import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the checked-in build stamp is "dev" and the Pages deploy writes the commit over it', () => {
  // app/sw.js keeps one cache per stamp: "dev" marks a copy nobody stamped (the dev server),
  // whose cache is refreshed by every online request instead of being a frozen snapshot.
  assert.deepEqual(JSON.parse(read('app/build.json')), { build: 'dev' });
  const workflow = read('.github/workflows/ci.yml');
  assert.match(workflow, /"\$GITHUB_SHA" > _site\/build\.json/);
  // The worker reads the file it is given a stamp in, and accepts a commit hash.
  const worker = read('app/sw.js');
  assert.match(worker, /here\('\.\/build\.json'\)/);
  const pattern = worker.match(/\/(\^\[\\w\.-\]\{1,64\}\$)\//);
  assert.ok(pattern, 'the stamp pattern of app/sw.js');
  assert.ok(new RegExp(pattern[1]).test('3b3899e0c1d2e3f4a5b6c7d8e9f00112233445566'));
});

test('every worker and data file the offline warm-up lists exists', () => {
  const source = read('app/ui/lib/offline.js');
  const lists = [...source.matchAll(/const (?:WORKERS|DATA) = \[([^\]]*)\]/g)].map(m => m[1]);
  assert.equal(lists.length, 2, 'WORKERS and DATA of ui/lib/offline.js');
  const listed = [...lists.join().matchAll(/'(\.\/[^']+)'/g)].map(m => m[1]);
  assert.ok(listed.length >= 4);
  for (const path of listed)
    assert.ok(existsSync(new URL(`../app/${path.slice(2)}`, import.meta.url)), path);
});
