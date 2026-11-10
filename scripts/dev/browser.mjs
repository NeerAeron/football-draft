// Browser smoke test + screenshot tool (Playwright + the pre-installed Chromium).
//
//   node scripts/dev/browser.mjs                  # every flow, desktop + mobile, screenshots
//   node scripts/dev/browser.mjs --only draft     # flows whose name contains "draft"
//   node scripts/dev/browser.mjs --desktop        # desktop viewport only (--mobile likewise)
//   node scripts/dev/browser.mjs --no-shots       # smoke only: fail on errors, no images
//   node scripts/dev/browser.mjs --out DIR        # screenshot directory (default .shots/)
//   node scripts/dev/browser.mjs --scale 2        # deviceScaleFactor for human-facing images
//   node scripts/dev/browser.mjs --jobs 1         # one flow at a time (default: 3 in parallel)
//
// Flows live in tests/browser/flows.mjs. Each flow gets { page, shot, step, base, viewport,
// note } (note(text) prints a line with the flow's result).
// The run fails (exit 1) on uncaught page errors, console errors, failed local
// requests or a thrown flow step. Reduced motion is emulated so reels settle fast.
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { startServer } from './serve.mjs';
import { flows } from '../../tests/browser/flows.mjs';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = await import('playwright'));
}

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const only = option('--only', '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const shots = !args.includes('--no-shots');
const out = resolve(option('--out', '.shots'));
const scale = Number(option('--scale', 1));
const viewports = [
  !args.includes('--mobile') && { name: 'desktop', viewport: { width: 1366, height: 860 } },
  !args.includes('--desktop') && {
    name: 'mobile',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  },
].filter(Boolean);

if (shots) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
}

const server = await startServer({ port: 0 });
const browser = await chromium.launch();
const failures = [];
const written = [];
const started = performance.now();
// Each flow runs in its own browser context, so several can run at once. Their output is
// printed when each finishes; --jobs 1 keeps the order of flows.mjs.
const jobs = Math.max(1, Number(option('--jobs', 3)) || 1);
const queue = [];
for (const flow of flows.filter(f => !only.length || only.some(o => f.name.includes(o))))
  for (const vp of viewports)
    if (!flow.viewports || flow.viewports.includes(vp.name)) queue.push({ flow, vp });

async function runJob({ flow, vp }) {
  {
    {
      const context = await browser.newContext({
        viewport: vp.viewport,
        deviceScaleFactor: scale,
        isMobile: vp.isMobile,
        hasTouch: vp.hasTouch,
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      const label = `${flow.name}@${vp.name}`;
      const problems = [],
        notes = [];
      page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
      page.on('console', m => {
        if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
      });
      page.on('requestfailed', r => {
        if (r.url().startsWith(server.url))
          problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`);
      });
      page.on('response', r => {
        if (r.url().startsWith(server.url) && r.status() >= 400)
          problems.push(`HTTP ${r.status()}: ${r.url()}`);
      });
      let n = 0;
      const shot = async (name, options = {}) => {
        if (!shots) return;
        const file = `${out}/${flow.name}-${String(++n).padStart(2, '0')}-${name}-${vp.name}.png`;
        await page.screenshot({ path: file, fullPage: options.fullPage ?? false });
        written.push(file);
      };
      const step = async (name, fn) => {
        try {
          return await fn();
        } catch (e) {
          throw new Error(`${name}: ${e.message.split('\n')[0]}`);
        }
      };
      const t0 = performance.now();
      try {
        await flow.run({
          page,
          shot,
          step,
          base: server.url,
          viewport: vp.name,
          note: text => notes.push(`        ${text}`),
        });
      } catch (e) {
        problems.push(`flow failed: ${e.message}`);
        if (shots) {
          const file = `${out}/${flow.name}-FAILED-${vp.name}.png`;
          await page.screenshot({ path: file }).catch(() => {});
          written.push(file);
        }
      }
      const ms = Math.round(performance.now() - t0);
      if (problems.length) failures.push({ label, problems });
      console.log(
        [
          ...notes,
          `${problems.length ? 'FAIL' : 'ok  '}  ${label}  ${ms}ms`,
          ...problems.map(p => `        ${p}`),
        ].join('\n'),
      );
      await context.close();
    }
  }
}

try {
  await Promise.all(
    Array.from({ length: Math.min(jobs, queue.length) }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) await runJob(job);
    }),
  );
} finally {
  await browser.close();
  await server.close();
}

if (written.length) console.log(`\n${written.length} screenshots in ${out}/`);
console.log(
  `${failures.length ? `${failures.length} failing flow run(s)` : 'all flows passed'} in ${Math.round(performance.now() - started)}ms`,
);
process.exitCode = failures.length ? 1 : 0;
