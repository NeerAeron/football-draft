// Deploys against the offline copy (app/sw.js + app/ui/lib/offline.js), simulated.
//
//   node scripts/dev/offline-deploy.mjs            # ~40 s, exit 1 on a failed check
//   node scripts/dev/offline-deploy.mjs --from REV # start on REV's sw.js/offline.js, then
//                                                  # deploy the working tree's (an upgrade)
//
// Serves a copy of app/ from a temporary folder and plays, with a real service worker:
//   1. install build "a" (the warm-up of the installed app, forced with ?sw=1), check offline;
//   2. deploy "b": a lazy screen Home does not preload changes and imports a NEW file. Open
//      only Home online, go offline, open that screen in a fresh page: it must be b's;
//   3. deploy "c" with a screen missing, so the warm-up cannot finish: offline must still be
//      the whole build b, and nothing may report the copy ready;
//   4. repair it: the next online launch completes c and the older copies are deleted.
import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP_ROOT, startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = await import('playwright'));
}

const WORKER_FILES = ['sw.js', 'ui/lib/offline.js'];
const from = process.argv.includes('--from')
  ? process.argv[process.argv.indexOf('--from') + 1]
  : null;
const site = mkdtempSync(join(tmpdir(), 'football-draft-offline-'));
cpSync(APP_ROOT, site, { recursive: true });
if (from)
  for (const file of WORKER_FILES)
    writeFileSync(join(site, file), execFileSync('git', ['show', `${from}:app/${file}`]));

const SCREEN = join(site, 'ui/screens/exhibition/exhibition.js');
const pristine = readFileSync(SCREEN, 'utf8');
function deploy(build, { change = true } = {}) {
  writeFileSync(join(site, 'build.json'), `${JSON.stringify({ build })}\n`);
  if (from && build !== 'a')
    for (const file of WORKER_FILES) cpSync(join(APP_ROOT, file), join(site, file));
  if (!change) return;
  writeFileSync(
    join(site, `ui/screens/exhibition/added-${build}.js`),
    `export const BUILD = '${build}';\n`,
  );
  writeFileSync(
    SCREEN,
    `import { BUILD } from './added-${build}.js';\nglobalThis.__screenBuild = BUILD;\n${pristine}`,
  );
}

const server = await startServer({ port: 0, root: site });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(() => {
  try {
    localStorage.setItem('football-draft-ui', JSON.stringify({ onboarded: true }));
  } catch {
    // storage unavailable: the how-to sheet opens, the checks still run
  }
});
let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n      ${detail}`}`);
}
/** 'b:435:complete | c:120': each cache's build, entries and whether it is a complete copy. */
const cacheState = page =>
  page.evaluate(async () => {
    const out = [];
    for (const name of await caches.keys()) {
      const keys = await (await caches.open(name)).keys(),
        complete = keys.some(key => key.url.endsWith('/__offline-ready'));
      out.push(
        `${name.replace('football-draft-offline-', '')}:${keys.length}${complete ? ':complete' : ''}`,
      );
    }
    return out.join(' | ');
  });
/** Open Home online; wait for the warm-up, or `settle` ms when it cannot finish. */
async function openOnline({ settle = 0 } = {}) {
  const page = await context.newPage();
  await page.goto(`${server.url}?sw=1#/`);
  await page.waitForSelector('[data-screen="home"]');
  if (settle) await page.waitForTimeout(settle);
  else await page.waitForSelector('html[data-offline-ready]', { state: 'attached' });
  const ready = await page.evaluate(() => 'offlineReady' in document.documentElement.dataset);
  const state = await cacheState(page);
  await page.close();
  return { ready, state };
}
/** Without a network, in a fresh page: open Home, go to the lazy screen, report its build. */
async function openOffline() {
  await context.setOffline(true);
  const page = await context.newPage();
  const result = { opened: false, build: null, state: '', error: '' };
  try {
    await page.goto(`${server.url}?sw=1#/`);
    await page.waitForSelector('[data-screen="home"]', { timeout: 10000 });
    await page.evaluate(() => (location.hash = '#/exhibition'));
    await page.waitForSelector('[data-screen="exhibition"]', { timeout: 10000 });
    result.opened = true;
    result.build = await page.evaluate(() => globalThis.__screenBuild ?? null);
    result.state = await cacheState(page);
  } catch (error) {
    result.error = String(error).split('\n')[0];
  }
  await page.close();
  await context.setOffline(false);
  return result;
}

try {
  deploy('a', { change: false });
  await openOnline();
  let offline = await openOffline();
  check('installed: the game opens offline', offline.opened, JSON.stringify(offline));

  deploy('b');
  await openOnline();
  offline = await openOffline();
  check(
    'deploy b, only Home opened online: offline, the lazy screen is the new build',
    offline.build === 'b',
    JSON.stringify(offline),
  );
  check('only build b is kept', /^b:\d+:complete$/.test(offline.state), offline.state);

  deploy('c');
  const missing = join(site, 'ui/screens/daily/daily.js');
  renameSync(missing, `${missing}.gone`);
  const unfinished = await openOnline({ settle: 8000 });
  check('an unfinished copy is not reported ready', !unfinished.ready, unfinished.state);
  offline = await openOffline();
  check(
    'unfinished deploy c: offline is still the whole build b',
    offline.build === 'b' && /(^|\| )b:\d+:complete/.test(offline.state),
    JSON.stringify(offline),
  );

  renameSync(`${missing}.gone`, missing);
  await openOnline();
  offline = await openOffline();
  check(
    'deploy c repaired: offline is build c and the older copies are gone',
    offline.build === 'c' && /^c:\d+:complete$/.test(offline.state),
    JSON.stringify(offline),
  );
} finally {
  await browser.close();
  await server.close();
  rmSync(site, { recursive: true, force: true });
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
