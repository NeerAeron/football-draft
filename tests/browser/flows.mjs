// User flows for scripts/dev/browser.mjs (smoke test + screenshots).
// Keep selectors in sync with app/ui (shell: index.html, gallery.html) when the UI changes. One flow (or group of flows) per screen owner.
// Each run() receives { page, shot, step, base, viewport }.

const visible = (page, selector, timeout = 15000) =>
  page.waitForSelector(selector, { state: 'visible', timeout });

// ---------- New UI (app/index.html shell, app/gallery.html) ----------

/** Seed localStorage before any page script runs (new context per flow). */
const seed = (page, entries) =>
  page.addInitScript(data => {
    for (const [key, value] of Object.entries(data))
      localStorage.setItem(key, JSON.stringify(value));
  }, entries);

const ONBOARDED = { 'football-draft-ui': { onboarded: true } };

// ---------- RUN-UI helpers (#/run, #/daily, #/exhibition, #/challenge) ----------

/**
 * Save a World Cup Run with given results (in the page): a seeded Nations draft, then
 * `results`: [goalsFor, goalsAgainst, shootout winner?] per match. A knockout draw without a
 * named winner is won on penalties.
 */
const savedRun = (page, { difficulty = 'pro', results = [], budget = false, seed = 42 }) =>
  page.evaluate(
    async ({ difficulty, results, budget, seed }) => {
      const { loadCatalog } = await import('./services/catalog.js');
      const { createDraftSession } = await import('./core/draft/session.js');
      const runStore = await import('./ui/lib/run-store.js');
      const catalog = await loadCatalog();
      const session = createDraftSession(catalog, { mode: 'nations', seed, difficulty });
      while (!session.complete) {
        session.spin();
        const move = session.suggestPick();
        session.pick(move.profileId, move.slot);
      }
      const { run, meta } = runStore.createRunFromDraft(catalog, {
        session,
        context: { kind: 'run', type: 'nations', difficulty, seed, budget },
      });
      for (const [goalsFor, goalsAgainst, pens] of results) {
        const knockout = run.nextMatch().knockout;
        run.recordResult({
          goalsFor,
          goalsAgainst,
          shootout:
            knockout && goalsFor === goalsAgainst
              ? { winner: pens || 'user', score: pens === 'opponent' ? [3, 4] : [4, 3] }
              : null,
        });
      }
      runStore.saveRun(run, meta, { pending: null, log: [] });
    },
    { difficulty, results, budget, seed },
  );

/**
 * A finished tournament's honours: three award cards with a winner each, the squad's table of
 * eleven with every match counted, and the awards' line in the share text.
 */
async function honours(page, matches) {
  await visible(page, '[data-testid="award-glove"]:not(.is-pending)');
  for (const id of ['boot', 'ball', 'glove']) {
    const card = page.locator(`[data-testid="award-${id}"]`),
      name = (await card.locator('.run-award__name').textContent()).trim(),
      value = (await card.locator('.run-award__value b').textContent()).trim();
    if (!name || !/^\d+(\.\d)?$/.test(value)) throw new Error(`${id}: "${name}" ${value}`);
  }
  const rows = await page.$$eval('[data-testid="squad-stats"] tbody tr', trs =>
    trs.map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim())),
  );
  if (rows.length !== 11) throw new Error(`${rows.length} rows in the squad's table`);
  if (matches && rows.some(r => Number(r[0]) !== matches))
    throw new Error(`matches: ${rows.map(r => r[0])}, played ${matches}`);
  if (rows.some(r => !/^\d\.\d$|^10\.0$/.test(r[4]))) throw new Error('a player has no rating');
  if (rows.filter(r => r[3] !== '').length !== 1) throw new Error('clean sheets: the keeper only');
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  if (!fits) throw new Error('the page scrolls sideways');
  const text = await page.textContent('[data-testid="share-text"]');
  if (!/👟 .+ \d+ · ⭐ .+ · 🧤 /u.test(text)) throw new Error(`share text: ${text}`);
}

/** Auto-sims use the fast rating model (screens/run/auto-sim.js) so the flows stay quick. */
const FAST_SIM = { 'football-draft-dev': { fastSim: true } };

/**
 * Finish a draft started with startDraft(): on DRAFT-UI's board auto-complete it
 * (#/draft?auto=1) and press Continue on the completion sheet, which returns to the run/daily
 * screen (context.returnTo); then wait for `until` there.
 */
async function completeDraft(page, until) {
  await page.waitForFunction(() => /^#\/(draft|run|daily)/.test(location.hash), null, {
    timeout: 15000,
  });
  if (await page.evaluate(() => location.hash.startsWith('#/draft'))) {
    await visible(page, '[data-screen="draft"][data-phase]');
    await page.evaluate(() => (location.hash = '#/draft?auto=1'));
    const go = 'dialog.complete-sheet[open] [data-testid="draft-continue"]';
    await visible(page, go);
    await page.click(go);
  }
  await visible(page, until, 30000);
}

/**
 * Play the requested match: pre-match → Kick off, match screen → Instant → Continue. While
 * #/match is still a placeholder, simulate the stored request in the page with the same
 * engine and come back the way Continue does.
 */
async function finishMatch(page) {
  await page.waitForFunction(() => /^#\/(match|prematch)/.test(location.hash), null, {
    timeout: 15000,
  });
  // Instant keeps flows fast: the pre-match screen hands off with autoKickoff, so the view
  // chosen there is the one the match screen plays.
  const chooseInstant = async screen => {
    const radio = page
      .locator(`[data-screen="${screen}"]`)
      .getByRole('radio', { name: /instant/i });
    if (await radio.count()) await radio.first().check({ force: true });
  };
  if (await page.evaluate(() => location.hash.startsWith('#/prematch'))) {
    const kickOff = page.locator('[data-screen="prematch"] [data-testid="kick-off"]');
    await kickOff.waitFor({ state: 'visible', timeout: 15000 });
    await chooseInstant('prematch');
    await kickOff.click();
    await page.waitForFunction(() => location.hash.startsWith('#/match'), null, {
      timeout: 15000,
    });
  }
  await visible(page, '[data-screen="match"], [data-screen="placeholder"]');
  if (await page.locator('[data-screen="match"]').isVisible()) {
    await chooseInstant('match');
    const go = page.locator('[data-screen="match"] [data-testid="continue"]');
    await go.waitFor({ state: 'visible', timeout: 90000 });
    await go.click();
    return;
  }
  await page.evaluate(async () => {
    const store = await import('./ui/lib/match-store.js');
    const { simulateRequest } = await import('./ui/screens/run/auto-sim.js');
    const request = store.currentRequest();
    store.saveMatchResult(await simulateRequest(request));
    location.hash = request.meta.returnTo;
  });
}

/** Start a seeded draft through the draft store (DRAFT-UI contract). */
const startDraftIn = (page, context) =>
  page.evaluate(async c => {
    const { startDraft } = await import('./ui/lib/draft-store.js');
    await startDraft(c);
  }, context);

// ---------- DRAFT-UI helpers (draft board) ----------

/** Wait until the board shows `n` picks for the side on the clock. */
const picksMade = (page, n) =>
  page.waitForFunction(
    count => document.querySelector('.draft-head__count')?.textContent.startsWith(`${count}/`),
    n,
    { timeout: 10000 },
  );

/** Start a draft from a setup URL and wait for the board. */
async function startFromSetup(page, base, url) {
  await page.goto(`${base}${url}`);
  await visible(page, '[data-screen="setup"]');
  await page.click('[data-testid="start-draft"]');
  await visible(page, '[data-screen="draft"][data-phase]');
}

/**
 * One pick: spin if needed, select the first playable row, optionally try another slot and
 * go back with Auto, then confirm (sheet on phones, dock on desktop).
 */
async function draftPick(page, { tryAuto = false, prime = false } = {}) {
  // After the first pick the next reel starts by itself (auto-spin); the button is only
  // there for a moment, so a missed click is fine.
  const spin = page.locator('[data-testid="spin"]');
  if (await spin.isVisible().catch(() => false))
    await spin.click({ timeout: 6000 }).catch(() => {});
  let row = page.locator('[data-testid="pool"] button.prow:not([disabled])').first();
  await row.waitFor({ state: 'visible', timeout: 10000 });
  // `prime`: a player with a better version when the pool has one (so the XI has a use for
  // the Prime whatever the reels land on).
  const better = page
    .locator('[data-testid="pool"] button.prow:not([disabled]):has(.prow__prime)')
    .first();
  if (prime && (await better.count())) row = better;
  await row.click();
  const confirm = page.locator('[data-testid="confirm-pick"]:visible');
  await confirm.waitFor({ state: 'visible', timeout: 5000 });
  if (tryAuto) {
    const other = page
      .locator(
        '.pitch--interactive .pitch-slot.is-fit-ok, .pitch--interactive .pitch-slot.is-fit-penalty',
      )
      .first();
    if (await other.isVisible().catch(() => false)) {
      await other.click();
      await page.click('[data-testid="auto-slot"]:visible');
    }
  }
  await confirm.click();
}

const GALLERY_SECTIONS = [
  'tokens',
  'buttons',
  'chips',
  'cards',
  'flags',
  'player-card',
  'player-row',
  'pitch',
  'meters',
  'reel',
  'overlays',
  'results',
  'states',
];

// ---------- Match screen (#/match, MATCH-UI) ----------

const MATCH = '#/match?demo=1';

/** Pre-kickoff → kick off. */
async function kickOff(page, step, shot) {
  await step('pre-kickoff', () =>
    visible(page, '[data-screen="match"] [data-testid="kickoff"]', 30000),
  );
  await page.evaluate(() => document.fonts.ready);
  if (shot) await shot('prematch');
  await step('kick off', () => page.click('[data-testid="kickoff"]'));
}

/** Click "Next clip" (Key Moments) until half-time or full time shows up. */
async function skipClips(page, until, limit = 80) {
  for (let i = 0; i < limit; i++) {
    if (
      await page
        .locator(until)
        .first()
        .isVisible()
        .catch(() => false)
    )
      return;
    const next = page.locator('[data-testid="next-clip"]');
    if (await next.isEnabled().catch(() => false)) await next.click().catch(() => {});
    await page.waitForTimeout(250);
  }
  await visible(page, until, 20000);
}

/**
 * A seed for the demo's level knockout tie (`et=1`) whose extra time ends the way a flow needs:
 * 'pens' (still level, a shootout) or 'aet' (a winner in extra time). Found with the engine in
 * the page, so the flows keep working when the engine changes.
 */
async function demoSeed(page, step, base, want) {
  let seed = null;
  await step(`find a seed: ${want}`, async () => {
    await page.goto(base);
    seed = await page.evaluate(async want => {
      const { loadCatalog } = await import('./services/catalog.js');
      const { buildDemoRequest, forceLevel } = await import('./ui/screens/match/demo.js');
      const { Match } = await import('./core/sim/engine.js');
      const catalog = await loadCatalog();
      for (let seed = 1; seed <= 80; seed++) {
        const request = buildDemoRequest(catalog, { et: '1', seed: String(seed) });
        const m = new Match(request.seed, request.duration);
        m.importConfig(request.config);
        forceLevel(m);
        while (!m.finished) m.step(1 / 60);
        if (!!m.shootout === (want === 'pens')) return seed;
      }
      return null;
    }, want);
    if (seed == null) throw new Error(`no demo seed ends in ${want}`);
  });
  return seed;
}

/** The break at 90 minutes: the score, a team talk, then "Extra time". */
async function extraTimeBreak(page, step, view, shot) {
  await step(`${view}: the break before extra time`, async () => {
    await visible(page, '[data-testid="halftime"]', 30000);
    const text = await page.textContent('[data-testid="halftime"]');
    if (!/Level after 90 minutes/.test(text)) throw new Error(`break reads "${text}"`);
    await visible(page, '[data-testid="halftime"] .segmented');
  });
  if (shot) await shot('break');
  await step(`${view}: extra time`, () => page.click('[data-testid="extra-time"]'));
}

/** The controller's own frame-time counter (window.__matchPerf). */
async function framePerf(page) {
  return page.evaluate(() => {
    const p = globalThis.__matchPerf;
    if (!p?.samples.length) return null;
    const s = [...p.samples].sort((a, b) => a - b);
    return { frames: p.frames, avg: p.total / p.frames, p95: s[Math.floor(s.length * 0.95)] };
  });
}

const matchFlows = [
  {
    name: 'match-key',
    async run({ page, shot, step, base, viewport }) {
      await page.goto(`${base}${MATCH}&view=key`);
      await kickOff(page, step, shot);
      await step('first clip plays', () => visible(page, '[data-testid="clip-minute"]', 30000));
      await step('the reel advances on its own', async () => {
        const clock = () => page.getAttribute('.match-bug', 'aria-label');
        const before = await clock();
        await page.waitForTimeout(1500);
        if ((await clock()) === before) throw new Error(`clock stuck at ${before}`);
      });
      await shot('first-half');
      await step('skip to half-time', () => skipClips(page, '[data-testid="halftime"]'));
      await shot('halftime');
      await step('half-time mentality', () =>
        page.click('[data-testid="halftime"] .segmented label:has-text("Push")'),
      );
      await step('second half', () => page.click('[data-testid="second-half"]'));
      await step('skip to full time', () => skipClips(page, '[data-testid="match-result"]'));
      await page.evaluate(() => document.fonts.ready);
      await shot('result');
      if (viewport === 'mobile') await shot('result-full', { fullPage: true });
      await step('result persisted', async () => {
        const saved = await page.evaluate(() => localStorage.getItem('football-draft-match'));
        if (!/"status":"done"/.test(saved || '')) throw new Error('result not stored');
      });
    },
  },
  {
    name: 'match-full',
    async run({ page, shot, step, base, note }) {
      await page.goto(`${base}${MATCH}&view=full`);
      await kickOff(page, step);
      await step('live canvas', () => visible(page, '.match-stage__canvas'));
      await step('auto mentality marks the one in effect', async () => {
        const row = '.match-controls__mentality';
        await visible(page, `${row} .segmented__item.is-selected:has-text("Auto")`);
        await visible(page, `${row} .mentality__now`);
      });
      await step('no camera toggle under reduced motion', async () => {
        if (await page.locator('[data-testid="camera-toggle"]').count())
          throw new Error('camera toggle shown although the camera never moves');
      });
      await page.waitForTimeout(2500);
      await shot('live');
      await step('speed 4x', () => page.click('.match-speed label:has-text("4×")'));
      await page.waitForTimeout(2000);
      await step('keyboard pause', async () => {
        await page.locator('.match-stage__canvas').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('Space');
        await visible(page, '.stage-play');
        await page.keyboard.press('Space');
      });
      await step('next moment', () => page.click('[data-testid="skip-moment"]'));
      await page.waitForTimeout(2500);
      await shot('after-skip');
      await step('mentality push overrides auto', async () => {
        await page.click('.match-controls__mentality label:has-text("Push")');
        await page.waitForFunction(
          () => !document.querySelector('.match-controls__mentality .mentality__now'),
        );
      });
      await step('open tactics', async () => {
        await page.click('[data-testid="open-tactics"]');
        await visible(page, 'dialog.modal[open] [data-testid="tactics-0"]');
      });
      await shot('tactics');
      await step('close tactics', async () => {
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('dialog.modal[open]'));
      });
      await step('leave asks first', async () => {
        await page.click('button[aria-label="Leave match"]');
        await visible(page, 'dialog.modal[open] >> text=Leave the match?');
        await page.click('dialog.modal[open] button:has-text("Keep watching")');
        await page.waitForFunction(() => !document.querySelector('dialog.modal[open]'));
      });
      const perf = await framePerf(page);
      if (perf)
        note(
          `frame ms avg ${perf.avg.toFixed(2)} p95 ${perf.p95.toFixed(2)} (${perf.frames} frames)`,
        );
    },
  },
  {
    // The camera only moves with motion on: this flow overrides the emulated reduced motion.
    name: 'match-camera',
    async run({ page, shot, step, base }) {
      await page.addInitScript(() => {
        try {
          localStorage.setItem('football-draft-ui', JSON.stringify({ motion: 'full' }));
        } catch {}
      });
      await page.goto(`${base}${MATCH}&view=key&auto=1`);
      await step('first clip plays', () => visible(page, '[data-testid="clip-minute"]', 30000));
      await step('the action camera zooms the clip', () =>
        visible(page, '.match-stage__scene.is-zoomed', 15000),
      );
      await shot('action');
      await step('the toggle shows the full pitch and remembers it', async () => {
        await page.click('[data-testid="camera-toggle"]');
        await page.waitForFunction(
          () => !document.querySelector('.match-stage__scene.is-zoomed'),
          null,
          { timeout: 20000 },
        );
        const saved = await page.evaluate(() =>
          localStorage.getItem('football-draft-match-camera'),
        );
        if (!/"key":"wide"/.test(saved || ''))
          throw new Error(`camera choice not stored: ${saved}`);
      });
      await shot('wide');
      await step('C switches back', async () => {
        await page.keyboard.press('c');
        await visible(page, '.match-stage__scene.is-zoomed', 20000);
      });
    },
  },
  {
    name: 'match-instant',
    async run({ page, shot, step, base, viewport }) {
      await page.goto(`${base}${MATCH}&view=instant&seed=3`);
      await kickOff(page, step);
      await step('result', () => visible(page, '[data-testid="match-result"]', 60000));
      await page.evaluate(() => document.fonts.ready);
      await shot('result');
      if (viewport === 'mobile') await shot('result-full', { fullPage: true });
      await step('rematch', async () => {
        await page.click('[data-testid="rematch"]');
        await visible(page, '[data-testid="kickoff"]');
      });
    },
  },
  {
    name: 'match-auto',
    viewports: ['desktop'],
    async run({ page, step, base }) {
      await page.goto(`${base}${MATCH}&view=full&auto=1`);
      await step('starts without a second pre-kickoff', async () => {
        await visible(page, '.match-stage__canvas', 30000);
        if (await page.locator('[data-testid="kickoff"]').count())
          throw new Error('pre-kickoff shown despite autoKickoff');
        await visible(page, '[data-testid="play-pause"][aria-label="Pause"]');
      });
    },
  },
  {
    // A knockout tie that is level at 90 minutes (demo `et=1`): the break, extra time, and —
    // with a seed whose extra time ends level — the shootout.
    name: 'match-pens',
    async run({ page, shot, step, base }) {
      const seed = await demoSeed(page, step, base, 'pens');
      // The shootout is a list of marks, never played on the pitch. Reduced motion (emulated
      // here) shows every kick and the winner at once; with motion they come one by one.
      for (const view of ['full', 'key']) {
        await page.goto(`${base}${MATCH}&view=${view}&et=1&seed=${seed}`);
        await kickOff(page, step);
        await extraTimeBreak(page, step, view, view === 'full' ? shot : null);
        if (view === 'full') {
          await step('full: extra time is played, first period then second', async () => {
            await page.click('.match-speed label:has-text("4×")');
            for (const period of ['ET1', 'ET2'])
              await page.waitForFunction(
                label =>
                  document.querySelector('.match-bug')?.getAttribute('aria-label')?.includes(label),
                period,
                { timeout: 60000 },
              );
          });
          await shot('extra-time');
        } else
          await step('key: the extra-time reel shows minutes after the ninetieth', async () => {
            await visible(page, '[data-testid="clip-minute"]', 30000);
            const minute = parseInt(await page.textContent('[data-testid="clip-minute"]'), 10);
            if (!(minute > 90 && minute <= 125)) throw new Error(`clip minute ${minute}`);
          });
        await step(`${view}: every kick and the winner`, async () => {
          // With reduced motion the panel shows every kick at once and gives way to the result
          // two seconds later: a runner that is late for the panel finds the same list there.
          const decided =
            '[data-testid="shootout"] .pens.is-decided, [data-testid="match-result"] .pens.is-decided';
          if (view === 'key') await skipClips(page, decided);
          await visible(page, decided, 90000);
          const marks = await page.locator('.pens__dot.is-goal, .pens__dot.is-miss').count();
          if (marks < 6) throw new Error(`only ${marks} kicks shown`);
          await visible(page, '.pens__row.is-winner');
        });
        if (view === 'full') await shot('shootout');
        await step(`${view}: result`, () => visible(page, '[data-testid="match-result"]', 30000));
        await step(`${view}: the result keeps the shootout`, () =>
          visible(page, '[data-testid="match-result"] .pens.is-decided'),
        );
        if (view === 'full') await shot('result');
        await page.evaluate(() => localStorage.removeItem('football-draft-match'));
      }
    },
  },
  {
    // The same tie with a seed whose extra time has a winner: no shootout, "AET".
    name: 'match-aet',
    async run({ page, shot, step, base, viewport }) {
      const seed = await demoSeed(page, step, base, 'aet');
      for (const view of ['key', 'instant']) {
        await page.goto(`${base}${MATCH}&view=${view}&et=1&seed=${seed}`);
        await kickOff(page, step);
        if (view === 'key') {
          await extraTimeBreak(page, step, view, shot);
          await step('key: extra time plays', () =>
            visible(page, '[data-testid="clip-minute"]', 30000),
          );
          await shot('extra-time');
          await step('key: skip to the end', () => skipClips(page, '[data-testid="match-result"]'));
        }
        await step(`${view}: decided after extra time, without penalties`, async () => {
          await visible(page, '[data-testid="match-result"]', 60000);
          const label = await page.getAttribute(
            '[data-testid="match-result"] .scorebug',
            'aria-label',
          );
          if (!/, AET$/.test(label || '')) throw new Error(`score bug reads "${label}"`);
          const hero = await page.textContent('.res-hero__ft');
          if (!/After extra time/.test(hero)) throw new Error(`result reads "${hero}"`);
          if (await page.locator('[data-testid="match-result"] .pens').count())
            throw new Error('a shootout panel on a match decided in extra time');
          const score = label.match(/ (\d+), .* (\d+), AET$/);
          if (!score || score[1] === score[2]) throw new Error(`no winner in "${label}"`);
        });
        if (view === 'key') {
          await page.evaluate(() => document.fonts.ready);
          await shot('result');
          if (viewport === 'mobile') await shot('result-full', { fullPage: true });
          await step('the stored result says extra time', async () => {
            const saved = await page.evaluate(() => localStorage.getItem('football-draft-match'));
            if (!/"extraTime":true/.test(saved || '')) throw new Error('extraTime not stored');
            if (!/\(aet\)/.test(saved || '')) throw new Error('share line without (aet)');
          });
        }
        await page.evaluate(() => localStorage.removeItem('football-draft-match'));
      }
    },
  },
];

export const flows = [
  {
    name: 'home',
    async run({ page, shot, step, base, viewport }) {
      await page.goto(base);
      await step('home screen', () => visible(page, '[data-screen="home"]'));
      await step('fonts', () => page.evaluate(() => document.fonts.ready));
      await step('Home does not fetch the era file', async () => {
        await page.waitForTimeout(600);
        const fetched = await page.evaluate(() =>
          performance.getEntriesByType('resource').some(e => /(eras|legends)\.v1/.test(e.name)),
        );
        if (fetched) throw new Error('eras.v1.json was fetched on Home');
      });
      await shot('landing');
      if (viewport === 'mobile') await shot('landing-full', { fullPage: true });
      await step('how-to sheet', async () => {
        await page.click('button[aria-label="How to play"]');
        await visible(page, 'dialog.modal[open] .howto');
      });
      await shot('how-to');
      await step('close how-to', async () => {
        await page.keyboard.press('Escape');
        await page
          .waitForSelector('dialog.modal[open]', { state: 'detached', timeout: 3000 })
          .catch(() => {});
        await page.waitForFunction(() => !document.querySelector('dialog.modal[open]'));
      });
      await step('the World Cup is a Nations draft; no footer links', async () => {
        if (await page.locator('.home-hero__seg').count()) throw new Error('draft type switch');
        const target = await page.getAttribute('[data-testid="start-run"]', 'href');
        if (target !== '#/play/run') throw new Error(`CTA points to ${target}`);
        if (await page.locator('.home__footer a').count()) throw new Error('footer links');
        const brand = await page.textContent('.brand__word');
        if (!/World Cup\s*Draft/i.test(brand)) throw new Error(`brand reads ${brand}`);
      });
      await step('dismiss first-run tips', async () => {
        await page.click('button[aria-label="Hide how it works"]');
        await page.waitForSelector('.home-first', { state: 'detached' });
      });
      await step('start run', async () => {
        await page.click('[data-testid="start-run"]');
        await visible(page, '[data-screen="setup"]');
      });
      await step('back home', async () => {
        await page.click('button[aria-label="Back"]');
        await visible(page, '[data-screen="home"]');
      });
    },
  },
  {
    name: 'home-continue',
    async run({ page, shot, step, base }) {
      await seed(page, {
        ...ONBOARDED,
        'football-draft-run': {
          mode: 'run',
          type: 'nations',
          stage: 'QF',
          record: { w: 4, d: 1, l: 0 },
          team: 'Brazil',
          rounds: 8,
          format: 4,
        },
        'football-draft-daily': { streak: 4, best: 9, lastPlayed: '2000-01-01' },
      });
      await page.goto(base);
      await step('continue card', () => visible(page, '.continue'));
      await page.evaluate(() => document.fonts.ready);
      await shot('continue');
      await step('draft in progress resumes from Home', async () => {
        await page.evaluate(async () => {
          const { startDraft } = await import('./ui/lib/draft-store.js');
          await startDraft({ kind: 'quick', type: 'leagues', seed: 11 }, { go: false });
        });
        await page.reload();
        await visible(page, '[data-testid="resume-draft-card"]');
        await page.click('[data-testid="resume-draft"]');
        await visible(page, '[data-screen="draft"][data-phase="pick"]');
      });
    },
  },
  {
    name: 'settings',
    async run({ page, shot, step, base }) {
      await seed(page, ONBOARDED);
      await page.goto(`${base}#/settings`);
      await step('settings screen', () => visible(page, '[data-screen="settings"]'));
      await page.evaluate(() => document.fonts.ready);
      await shot('page', { fullPage: true });
      await step('hide ratings switch', async () => {
        const toggle = page.getByRole('switch', { name: 'Hide ratings by default' });
        await toggle.check();
        const saved = await page.evaluate(() => localStorage.getItem('football-draft-ui'));
        if (!/"hideRatings":true/.test(saved || '')) throw new Error('preference not saved');
      });
      await step('reduced motion option', () => page.click('.segmented label:has-text("Reduced")'));
      await step('open reset dialog', async () => {
        await page.click('button:has-text("Reset local data")');
        await visible(page, 'dialog.modal[open]');
      });
      await shot('reset-dialog');
      await step('confirm reset', async () => {
        await page.click('[data-testid="confirm-reset"]');
        await visible(page, '.toast');
        const left = await page.evaluate(() =>
          Object.keys(localStorage).filter(k => k.startsWith('football-draft')),
        );
        if (left.length) throw new Error(`keys left after reset: ${left.join(', ')}`);
      });
      await shot('after-reset');
    },
  },
  {
    name: 'routes',
    viewports: ['mobile'],
    async run({ page, step, base }) {
      await seed(page, ONBOARDED);
      for (const path of ['nope']) {
        await step(`#/${path}`, async () => {
          await page.goto(`${base}#/${path}`);
          await visible(page, '[data-screen="placeholder"] h1');
        });
      }
      await step('installable: manifest, icons and the share card resolve', async () => {
        const missing = await page.evaluate(async () => {
          const head = document.head;
          const manifestUrl = head.querySelector('link[rel="manifest"]')?.href;
          const manifest = await (await fetch(manifestUrl)).json();
          const urls = [
            ...manifest.icons.map(i => new URL(i.src, manifestUrl).href),
            head.querySelector('link[rel="apple-touch-icon"]').href,
            // og:image is absolute (the deployment); check the same path locally.
            new URL(
              new URL(head.querySelector('meta[property="og:image"]').content).pathname
                .split('/')
                .slice(-2)
                .join('/'),
              location.href,
            ).href,
          ];
          const bad = [];
          for (const url of urls) if (!(await fetch(url)).ok) bad.push(url);
          if (!manifest.name || manifest.display !== 'standalone') bad.push('manifest fields');
          return bad;
        });
        if (missing.length) throw new Error(`missing: ${missing.join(', ')}`);
      });
    },
  },
  // ---------- DRAFT-UI: setup, draft board, pre-match ----------
  {
    name: 'setup',
    async run({ page, shot, step, base, viewport }) {
      await seed(page, ONBOARDED);
      await page.goto(`${base}#/play/run`);
      await step('run setup', () => visible(page, '[data-screen="setup"][data-mode="run"]'));
      await step('World Cup is a Nations draft: no draft-type choice', async () => {
        if (await page.locator('.type-card').count()) throw new Error('type cards on run setup');
        const text = await page.textContent('[data-screen="setup"]');
        if (/typical XI|Teams like|rated about/i.test(text))
          throw new Error('setup still shows ratings or example teams');
      });
      await page.evaluate(() => document.fonts.ready);
      await shot('run');
      if (viewport === 'mobile') await shot('run-full', { fullPage: true });
      await step('choose world class + 4-4-2', async () => {
        await page.click('.ladder__row:has-text("World Class")');
        await page.click('.formation-card:has-text("4–4–2")');
        for (const [name, value] of [
          ['setup-difficulty', 'worldclass'],
          ['setup-formation', '442'],
        ])
          if (!(await page.isChecked(`input[name="${name}"][value="${value}"]`)))
            throw new Error(`${name} is not ${value}`);
      });
      await step('quick setup prefilled from a challenge link', async () => {
        await page.goto(
          `${base}#/play/quick?type=leagues&difficulty=legendary&formation=4231&seed=123`,
        );
        await visible(page, '[data-screen="setup"][data-mode="quick"] .setup-challenge');
        for (const [name, value] of [
          ['setup-type', 'leagues'],
          ['setup-difficulty', 'legendary'],
          ['setup-formation', '4231'],
        ])
          if (!(await page.isChecked(`input[name="${name}"][value="${value}"]`)))
            throw new Error(`${name} is not ${value}`);
      });
      await step(
        'three difficulties, nothing about tokens; an old link on a removed one is Pro',
        async () => {
          const levels = await page.$$eval('input[name="setup-difficulty"]', l =>
            l.map(i => i.value),
          );
          if (levels.join() !== 'pro,worldclass,legendary') throw new Error(`levels: ${levels}`);
          // The tokens are the same on every level: the ladder does not count them.
          const ladder = await page.textContent('.ladder');
          if (/re-roll|respin|prime/i.test(ladder) || (await page.locator('.pips').count()))
            throw new Error('the ladder talks about tokens: ' + ladder);
          await page.goto(`${base}#/play/quick?type=nations&difficulty=amateur&seed=5`);
          await visible(page, '[data-screen="setup"][data-mode="quick"] .setup-challenge');
          if (!(await page.isChecked('input[name="setup-difficulty"][value="pro"]')))
            throw new Error('an unknown difficulty does not fall back to Pro');
        },
      );
      await shot('quick-challenge');
      await step('quick match offers nations, leagues and clubs', async () => {
        const types = await page.$$eval('input[name="setup-type"]', l => l.map(i => i.value));
        if (types.join() !== 'nations,leagues,clubs') throw new Error(`types: ${types}`);
      });
      await step('versus setup', async () => {
        await page.goto(`${base}#/play/versus`);
        await visible(page, '[data-screen="setup"][data-mode="versus"]');
        await page.fill('#player-0', 'Ana');
        await page.fill('#player-1', 'Bea');
      });
      await shot('versus');
      if (viewport === 'mobile') await shot('versus-full', { fullPage: true });
    },
  },
  {
    name: 'draft-nations',
    async run({ page, shot, step, base, viewport }) {
      await seed(page, ONBOARDED);
      await step('start a seeded run draft', () =>
        startFromSetup(page, base, '#/play/run?type=nations&seed=21&formation=433'),
      );
      await step('first spin lands', () => visible(page, '[data-testid="spin-result"]'));
      const state = () =>
        page.evaluate(() => JSON.parse(localStorage.getItem('football-draft-draft')).session.state);
      const landed = async () => ({
        era: (await page.textContent('[data-testid="spin-era"]')).trim(),
        nation: (await page.textContent('.reveal__title')).trim(),
      });
      await step(
        'it landed an era and a nation: both named, rows with a year, no odds',
        async () => {
          await visible(page, '.stage.is-eras');
          const { era, nation } = await landed();
          if (!/ (98|02|06|10|14|18|22|26)$/.test(era)) throw new Error('era: ' + era);
          // The heading names both, the era by its full name.
          const heading = (await page.textContent('#pool-title')).trim();
          if (!heading.startsWith(`${nation} · `) || heading.slice(-3) !== era.slice(-3))
            throw new Error('pool heading: ' + heading);
          const stage = await page.textContent('.stage');
          if (await page.locator('.reveal__odds').count()) throw new Error('the reels show odds');
          if (/%|chance|likely/i.test(stage)) throw new Error('odds text on the stage');
          const rows = page.locator('[data-testid="pool"] button.prow');
          const count = await rows.count();
          if (count < 1 || count > 26) throw new Error(`${count} players shown, expected 1–26`);
          const years = await page.locator('[data-testid="pool"] .prow__era').allTextContents();
          // A year of 1997–2026, two digits.
          if (years.length !== count || !years.every(t => /^’(9[7-9]|[01]\d|2[0-6])$/.test(t)))
            throw new Error('rows without a year: ' + years.join(' '));
          const text = await page.textContent('[data-screen="draft"]');
          if (/FIFA \d\d/.test(text)) throw new Error('an edition name is on screen');
          // The era file is fetched for the draft; the legends file is not needed any more.
          const fetched = await page.evaluate(() =>
            performance.getEntriesByType('resource').map(e => e.name),
          );
          if (!fetched.some(n => n.includes('eras.v1.json')))
            throw new Error('the era file was not fetched');
          if (fetched.some(n => n.includes('legends.v1.json')))
            throw new Error('the legends file was fetched');
        },
      );
      await step('three tokens, one of each', async () => {
        for (const kind of ['nation', 'era', 'prime']) {
          const token = page.locator(`[data-testid="token-${kind}"]:visible`);
          if ((await token.getAttribute('data-left')) !== '1')
            throw new Error(`${kind} token: ${await token.textContent()}`);
        }
        if (!(await page.locator('[data-testid="token-prime"]:visible').isDisabled()))
          throw new Error('the Prime is on offer with nobody drafted');
        const box = await page.locator('.draft-tokens:visible').boundingBox();
        if (box.x < 0 || box.x + box.width > viewport.width + 1)
          throw new Error('the tokens do not fit the screen');
      });
      await page.evaluate(() => document.fonts.ready);
      await shot('era-spin');
      await step('nation respin: the era stays, another nation', async () => {
        const before = await landed();
        await page.click('[data-testid="token-nation"]:visible');
        await page.waitForFunction(was => {
          const title = document.querySelector('.reveal__title');
          return title && title.textContent.trim() !== was;
        }, before.nation);
        const after = await landed();
        if (after.era !== before.era) throw new Error(`the era moved: ${after.era}`);
        const token = page.locator('[data-testid="token-nation"]:visible');
        if ((await token.getAttribute('data-left')) !== '0' || !(await token.isDisabled()))
          throw new Error('the nation respin is not spent');
        if ((await state()).rerollsLeft[0] !== 0) throw new Error('rerollsLeft');
      });
      await shot('nation-respin');
      await step('era respin: another era', async () => {
        const before = await landed();
        await page.click('[data-testid="token-era"]:visible');
        await page.waitForFunction(was => {
          const era = document.querySelector('[data-testid="spin-era"]');
          return era && era.textContent.trim() !== was;
        }, before.era);
        const spin = (await state()).current;
        const after = await landed();
        // The nation stays when the new era has it; otherwise it was drawn again.
        if (spin.kept !== (after.nation === before.nation))
          throw new Error(`kept ${spin.kept}: ${before.nation} → ${after.nation}`);
        const token = page.locator('[data-testid="token-era"]:visible');
        if ((await token.getAttribute('data-left')) !== '0' || !(await token.isDisabled()))
          throw new Error('the era respin is not spent');
      });
      await shot('era-respin');
      await step('select a player', async () => {
        await page.locator('[data-testid="pool"] button.prow:not([disabled])').first().click();
        await visible(page, '[data-testid="confirm-pick"]');
      });
      await step('his card shows the six stats', async () => {
        const card = page.locator('[data-testid="pick-card"]:visible').first();
        const stats = await card.locator('.pcard__stat').count();
        if (stats !== 6) throw new Error(`${stats} stats on the card, expected six`);
        if (await page.locator('[data-testid="player-attributes"]').count())
          throw new Error('the Stats dropdown is back');
      });
      await step('the card shows the year of that version', async () => {
        const era = await page
          .locator('[data-testid="pick-card"]:visible .pcard__era')
          .first()
          .textContent();
        if (!/^’\d\d$/.test(era)) throw new Error('no year on the card');
        const standing = await page
          .locator('[data-testid="pick-standing"]:visible')
          .first()
          .textContent();
        if (!/’\d\d/.test(standing))
          throw new Error('the sheet does not say his year: ' + standing);
      });
      await step('every open slot shows his overall there; the best one is marked', async () => {
        const pitch = page.locator('.pitch--interactive:visible').first();
        const open = await pitch.locator('.pitch-slot.is-empty:not(.is-fit-blocked)').count();
        const numbers = await pitch.locator('.pitch-slot__rating').allTextContents();
        if (numbers.length !== open || !numbers.every(t => /^\d\d$/.test(t)))
          throw new Error(`${numbers.length} ratings on ${open} open slots: ${numbers}`);
        const best = await pitch
          .locator('.pitch-slot.is-fit-best .pitch-slot__rating')
          .first()
          .textContent();
        const line = await page.locator('[data-testid="pick-slot"]:visible').first().textContent();
        if (!line.includes(best)) throw new Error(`the sheet says "${line}", not ${best}`);
      });
      await shot('pick');
      await step('pick 1 (other slot, then Auto)', async () => {
        await page.click(
          '.pitch--interactive .pitch-slot.is-fit-ok, .pitch--interactive .pitch-slot.is-fit-penalty',
        );
        await page.click('[data-testid="auto-slot"]:visible');
        await page.click('[data-testid="confirm-pick"]:visible');
        await picksMade(page, 1);
      });
      await shot('after-first-pick');
      for (let pick = 2; pick <= 11; pick++) {
        await step(`pick ${pick}`, async () => {
          await draftPick(page, { tryAuto: pick === 6, prime: true });
          await picksMade(page, pick);
        });
        if (pick === 5) await shot('mid-draft', viewport === 'mobile' ? { fullPage: true } : {});
        if (pick === 4 || pick === 8)
          await step('pool rows cut no tag: boost and Prime are whole', async () => {
            const spin = page.locator('[data-testid="spin"]');
            if (await spin.isVisible().catch(() => false))
              await spin.click({ timeout: 6000 }).catch(() => {});
            await page.waitForSelector('[data-testid="pool"] button.prow', { timeout: 10000 });
            const cut = await page.evaluate(() => {
              const bad = [];
              for (const row of document.querySelectorAll('[data-testid="pool"] .prow')) {
                const box = row.getBoundingClientRect();
                for (const tag of row.querySelectorAll('.prow__cost, .prow__boost, .prow__prime')) {
                  const r = tag.getBoundingClientRect();
                  if (tag.scrollWidth > tag.clientWidth + 1 || r.right > box.right - 4 || !r.width)
                    bad.push(row.getAttribute('aria-label'));
                }
              }
              return bad;
            });
            if (cut.length) throw new Error('rows with a cut tag: ' + cut.slice(0, 3).join(' | '));
          });
      }
      await step('one person once: eleven different people', async () => {
        const picks = (await state()).picks[0];
        const persons = new Set(picks.map(id => /^ea:(\d+):/.exec(id)?.[1] ?? id));
        if (persons.size !== 11) throw new Error('a man twice: ' + picks.join(' '));
        if (!picks.some(id => /:era$/.test(id))) throw new Error('no era card in the XI');
      });
      await step('completion sheet', () => visible(page, 'dialog.complete-sheet[open]'));
      await shot('complete');
      await step(
        'Prime: one sheet, eligible players show the bump, the rest are closed',
        async () => {
          await page.click('dialog.complete-sheet[open] [data-testid="token-prime"]');
          await visible(page, '.draft-prime [data-testid="prime-confirm"]');
          const rows = page.locator('.draft-prime__row');
          if ((await rows.count()) !== 11) throw new Error('the sheet does not list the XI');
          const options = page.locator('[data-testid="prime-option"]');
          if (!(await options.count())) throw new Error('nobody in this XI has a better version');
          if (!(await page.locator('.draft-prime__row:disabled').count()))
            throw new Error('players without a better version are selectable');
          const bump = await options.first().locator('.draft-prime__bump').textContent();
          if (!/^\s*\d\d\s*\d\d\s*[+−±]\d+\s*$/.test(bump)) throw new Error('no bump: ' + bump);
          if (!(await page.locator('[data-testid="prime-confirm"]').isDisabled()))
            throw new Error('confirm is enabled before a choice');
          await options.first().click();
        },
      );
      await shot('prime-sheet');
      await step('confirm: he is his best version, the Prime is spent', async () => {
        const before = await state();
        await page.click('[data-testid="prime-confirm"]');
        await page.waitForFunction(
          () =>
            JSON.parse(localStorage.getItem('football-draft-draft')).session.state.primesLeft[0] ===
            0,
        );
        const after = await state();
        if (before.primesLeft[0] !== 1) throw new Error('the Prime was not there');
        const changed = after.picks[0].filter((id, i) => id !== before.picks[0][i]);
        if (changed.length !== 1 || after.primed[changed[0]] === undefined)
          throw new Error('no primed player in the XI');
      });
      await step('the sheet stays open and shows it; a second tap does nothing', async () => {
        await visible(page, 'dialog.draft-prime[open] [data-testid="prime-done"]');
        const button = page.locator('[data-testid="prime-confirm"]');
        if (!/Done/.test(await button.textContent())) throw new Error('the button is not Done');
        // An impatient second tap must not fall through to "On to the World Cup".
        await button.click();
        await page.waitForTimeout(100);
        if ((await page.evaluate(() => location.hash)) !== '#/draft')
          throw new Error('the second tap left the draft');
        await shot('prime-done');
        await page.waitForTimeout(500);
        if (await page.locator('dialog.draft-prime[open]').count()) await button.click();
        await page.waitForSelector('dialog.draft-prime[open]', { state: 'detached' });
        await page.waitForTimeout(450);
      });
      await shot('primed');
      await step('continue to the run with the era cards', async () => {
        const picks = (await state()).picks[0];
        await page.click('[data-testid="draft-continue"]');
        await page.waitForFunction(() => location.hash === '#/run');
        await visible(page, '[data-screen="run"]');
        await page.waitForFunction(ids => {
          const run = JSON.parse(localStorage.getItem('football-draft-run-state') || 'null');
          return run?.run?.user?.players?.join() === ids.join();
        }, picks);
      });
      await shot('run');
    },
  },
  {
    name: 'draft-back',
    async run({ page, step, base }) {
      await seed(page, ONBOARDED);
      const saved = () =>
        page.evaluate(() => {
          const d = JSON.parse(localStorage.getItem('football-draft-draft') || 'null');
          return d && `${d.context.seed}:${d.session.state.current?.option.id}`;
        });
      let draft = null;
      await step('"Play again" (?go=1) starts a draft at once', async () => {
        await page.goto(base);
        await visible(page, '[data-screen="home"]');
        await page.evaluate(() => (location.hash = '#/play/run?type=nations&go=1'));
        await visible(page, '[data-screen="draft"][data-phase]');
        draft = await saved();
        if (!draft) throw new Error('no draft was saved');
      });
      await step('the device back button shows the setup: ?go=1 is spent', async () => {
        await page.goBack();
        await visible(page, '[data-screen="setup"] .setup-resume');
        await page.waitForTimeout(300);
        if ((await saved()) !== draft) throw new Error('going back started another draft');
        await page.goForward();
        await visible(page, '[data-screen="draft"] [data-testid="spin-result"]');
      });
      await step('the back arrow leaves for Home and keeps the draft', async () => {
        await page.click('.topbar__back');
        await visible(page, '[data-screen="home"] [data-testid="resume-draft"]');
        await page.waitForTimeout(300);
        if (!/^(#\/)?$/.test(await page.evaluate(() => location.hash)))
          throw new Error('not on Home');
        if ((await saved()) !== draft) throw new Error('the draft changed: it was started again');
      });
      await step('Resume shows the same spin', async () => {
        await page.click('[data-testid="resume-draft"]');
        await visible(page, '[data-screen="draft"] [data-testid="spin-result"]');
        if ((await saved()) !== draft) throw new Error('the draft changed on resume');
      });
    },
  },
  {
    name: 'draft-budget',
    async run({ page, shot, step, base, viewport }) {
      await seed(page, ONBOARDED);
      await step('the World Cup setup offers Budget mode', async () => {
        await page.goto(`${base}#/play/run`);
        await visible(page, '[data-screen="setup"][data-mode="run"]');
        if (await page.locator('[data-testid="setup-budget"]').count())
          throw new Error('Budget mode is on by default');
        // Budget mode is its own button on Home, under Start World Cup.
        await page.goto(base);
        await page.click('[data-testid="start-budget"]');
        await visible(page, '[data-screen="setup"][data-mode="run"] [data-testid="setup-budget"]');
        const text = await page.textContent('[data-screen="setup"]');
        if (!/2 Superstars \(88\+\), 2 Stars \(84–87\) and 3 Starters \(80–83\)/.test(text))
          throw new Error('Budget mode does not say its caps');
      });
      await page.evaluate(() => document.fonts.ready);
      await shot('setup');
      await step('Quick Match has no Budget mode', async () => {
        await page.goto(`${base}#/play/quick`);
        await visible(page, '[data-screen="setup"][data-mode="quick"]');
        if (await page.getByRole('switch', { name: 'Budget mode' }).count())
          throw new Error('Budget switch on the quick setup');
      });
      await step('start a seeded budget run draft', () =>
        startFromSetup(page, base, '#/play/run?type=nations&seed=8&formation=433&budget=1'),
      );
      await step('the budget slots are shown, all open', async () => {
        await visible(page, '[data-testid="spin-result"]');
        await visible(page, '.draft-budget');
        const on = await page.locator('.draft-budget__pips i.is-on').count();
        if (on !== 0) throw new Error(`${on} budget slots used before the first pick`);
        const tags = await page.locator('[data-testid="pool"] .prow__cost').count();
        if (!tags) throw new Error('pool rows do not show their tier');
      });
      await page.evaluate(() => document.fonts.ready);
      await shot('first-spin');
      await step('selecting a player says which slot he uses', async () => {
        await page.locator('[data-testid="pool"] button.prow:not([disabled])').first().click();
        await visible(page, '[data-testid="budget-effect"]:visible');
        await visible(page, '[data-testid="mates-effect"]:visible');
      });
      await shot('selected');
      await step('pick 1', async () => {
        await page.click('[data-testid="confirm-pick"]:visible');
        await picksMade(page, 1);
      });
      let closed = false;
      for (let pick = 2; pick <= 11; pick++) {
        await step(`pick ${pick}`, async () => {
          const spin = page.locator('[data-testid="spin"]');
          if (await spin.isVisible().catch(() => false))
            await spin.click({ timeout: 6000 }).catch(() => {});
          await visible(page, '[data-testid="pool"] button.prow:not([disabled])');
          // Closed rows sit under the players he can still pick: show the whole pool.
          const more = page.locator('[data-testid="pool"] .pool__more button');
          // (The list also loads its next page by itself near the end: the button may be gone.)
          if (!closed && (await more.count())) await more.click({ timeout: 2000 }).catch(() => {});
          const full = page.locator('[data-testid="pool"] .prow.is-disabled:has-text("full")');
          if (!closed && (await full.count())) {
            closed = true;
            await full.first().scrollIntoViewIfNeeded();
            await shot('band-full');
            await page.evaluate(() => scrollTo(0, 0));
          }
          await draftPick(page);
          await picksMade(page, pick);
        });
        if (pick === 6) await shot('mid-draft', viewport === 'mobile' ? { fullPage: true } : {});
      }
      await step('a full band closed its players', async () => {
        if (!closed) throw new Error('no pool row was closed by the budget');
      });
      await step('completion sheet shows the budget and the boosts', async () => {
        await visible(page, 'dialog.complete-sheet[open] .xi-summary__budget');
        await visible(page, 'dialog.complete-sheet[open] [data-testid="final-boosts"]');
        const used = await page.$$eval(
          'dialog.complete-sheet[open] .draft-budget__band[data-band]',
          l =>
            l.map(b => [
              b.querySelectorAll('.draft-budget__pips i.is-on').length,
              b.querySelectorAll('.draft-budget__pips i').length,
            ]),
        );
        if (used.map(u => u[1]).join() !== '2,2,3') throw new Error(`budget slots: ${used}`);
        if (used.some(([on, slots]) => on > slots)) throw new Error(`over budget: ${used}`);
      });
      await shot('complete');
      await step('the run remembers it was a Budget run', async () => {
        await page.click('[data-testid="draft-continue"]');
        await page.waitForFunction(() => location.hash === '#/run');
        await page.waitForFunction(
          () => JSON.parse(localStorage.getItem('football-draft-run-state') || 'null')?.meta,
        );
        const meta = await page.evaluate(
          () => JSON.parse(localStorage.getItem('football-draft-run-state')).meta,
        );
        if (meta.budget !== true) throw new Error(`run meta.budget = ${meta.budget}`);
      });
    },
  },
  {
    name: 'draft-clubs',
    async run({ page, shot, step, base }) {
      await seed(page, ONBOARDED);
      await step('start a seeded clubs quick draft', () =>
        startFromSetup(page, base, '#/play/quick?type=clubs&seed=11&difficulty=pro'),
      );
      await step('league + club land', () => visible(page, '[data-testid="spin-result"]'));
      await page.evaluate(() => document.fonts.ready);
      await shot('spin');
      await step('re-roll', async () => {
        const before = await page.textContent('.reveal__title');
        await page.click('[data-testid="reroll"]');
        await page.waitForFunction(
          prev => document.querySelector('.reveal__title')?.textContent !== prev,
          before,
        );
      });
      await shot('rerolled');
      await step('odds popover', async () => {
        await page.click('button[aria-label="Odds of this spin"]');
        await visible(page, 'dialog.modal[open] .spin-odds');
      });
      await shot('odds');
      await step('close odds', async () => {
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('dialog.modal[open]'));
      });
      for (let pick = 1; pick <= 3; pick++)
        await step(`pick ${pick}`, async () => {
          await draftPick(page);
          await picksMade(page, pick);
        });
      await step('filter + search the pool', async () => {
        // Auto-spin starts the reel by itself; click only if the button is still there.
        await page.click('[data-testid="spin"]', { timeout: 6000 }).catch(() => {});
        await visible(page, '[data-testid="pool"]');
        await page.click('[data-testid="pool"] .toggle-chip:has-text("DEF")');
        await page.fill('[data-testid="pool"] input[type="search"]', 'a');
      });
      await shot('after-picks');
      await step('auto-pick', async () => {
        await page.click('[data-testid="auto-pick"]');
        await picksMade(page, 4);
      });
    },
  },
  {
    name: 'draft-versus',
    async run({ page, shot, step, base }) {
      await seed(page, ONBOARDED);
      await step('start versus', async () => {
        await page.goto(`${base}#/play/versus?type=nations&seed=5`);
        await visible(page, '[data-screen="setup"]');
        await page.fill('#player-0', 'Ana');
        await page.fill('#player-1', 'Bea');
        await page.click('[data-testid="start-draft"]');
        await visible(page, '[data-screen="draft"]');
      });
      await step('coin toss interstitial', () => visible(page, 'dialog.pass-device[open]'));
      await page.evaluate(() => document.fonts.ready);
      await shot('coin-toss');
      for (let pick = 1; pick <= 4; pick++) {
        await step(`pick ${pick}`, async () => {
          await page.click('[data-testid="pass-spin"]');
          await page.waitForFunction(() => !document.querySelector('dialog.pass-device[open]'));
          await draftPick(page);
          if (pick < 4) await visible(page, 'dialog.pass-device[open]');
        });
        if (pick === 1) await shot('pass-device');
      }
      await step('both XIs', async () => {
        await page.click('button:has-text("See the board")');
        await page.waitForFunction(() => !document.querySelector('dialog.modal[open]'));
      });
      await shot('board');
      await step('finish (auto) → both XIs → pre-match', async () => {
        await page.goto(`${base}#/draft?auto=1`);
        await visible(page, 'dialog.complete-sheet[open]');
        await page.click('[data-testid="draft-continue"]');
        await visible(page, '[data-screen="prematch"] .pm-switch');
      });
      await shot('prematch');
    },
  },
  {
    name: 'prematch',
    async run({ page, shot, step, base }) {
      await seed(page, ONBOARDED);
      await step('quick draft, auto-completed', async () => {
        await startFromSetup(page, base, '#/play/quick?type=nations&seed=3&difficulty=worldclass');
        await page.goto(`${base}#/draft?auto=1`);
        await visible(page, 'dialog.complete-sheet[open]');
      });
      await page.evaluate(() => document.fonts.ready);
      await shot('complete');
      await step('opponent reveal', async () => {
        await page.click('[data-testid="draft-continue"]');
        await visible(page, '[data-testid="opponent-name"]');
      });
      await shot('opponent');
      await step('to the pre-match', async () => {
        await page.click('[data-testid="draft-continue"]');
        await visible(page, '[data-screen="prematch"] .lineup__pitch');
      });
      await page.evaluate(() => document.fonts.ready);
      await shot('prematch');
      await step('swap two players', async () => {
        const names = () =>
          page.$$eval('.lineup__pitch .pitch-slot', els =>
            els.map(e => e.getAttribute('aria-label')).join('|'),
          );
        const before = await names();
        await page.click('.lineup__pitch .pitch-slot[data-slot="9"]');
        await page.click('.lineup__pitch .pitch-slot[data-slot="10"]');
        await page.waitForFunction(
          prev =>
            [...document.querySelectorAll('.lineup__pitch .pitch-slot')]
              .map(e => e.getAttribute('aria-label'))
              .join('|') !== prev,
          before,
        );
      });
      await step('the formation picker shows the team OVR of every formation', async () => {
        const options = await page.$$eval('[data-testid="formation-select"] option', els =>
          els.map(e => e.textContent.trim()),
        );
        const bad = options.filter(text => !/ · \d\d\.\d( ★)?$/.test(text));
        if (options.length < 20 || bad.length)
          throw new Error(`formation options without a team OVR: ${bad.join(' | ')}`);
        if (!options.some(text => text.endsWith('★')))
          throw new Error('no formation is marked as the best');
      });
      await step('change a tactic', async () => {
        await page.click('.tactics__mentality label:has-text("Push")');
        await page.selectOption('[data-testid="formation-select"]', '442');
      });
      await shot('edited');
      await step('kick off', async () => {
        await page.click('[data-testid="kick-off"]');
        await page.waitForFunction(() => location.hash === '#/match');
        const saved = await page.evaluate(() => localStorage.getItem('football-draft-match'));
        if (!/"mentality":"push"/.test(saved || '')) throw new Error('tactics not handed over');
      });
      await step('match starts without a second pre-kickoff', async () => {
        await visible(page, '[data-screen="match"] .match-stage__canvas', 30000);
        if (await page.locator('[data-testid="kickoff"]').count())
          throw new Error('match screen showed its own pre-kickoff');
      });
    },
  },
  {
    name: 'gallery',
    async run({ page, shot, step, base, viewport }) {
      await page.goto(`${base}gallery.html`);
      await step('gallery renders', () => visible(page, '#player-card .pcard'));
      for (const id of GALLERY_SECTIONS) {
        await step(`section ${id}`, async () => {
          await page.goto(`${base}gallery.html?only=${id}`);
          await visible(page, `#${id}`);
          await page.evaluate(() => document.fonts.ready);
        });
        await shot(id, { fullPage: true });
      }
      await step('pitch keyboard', async () => {
        await page.goto(`${base}gallery.html?only=pitch`);
        await page.focus('.pitch--interactive .pitch-slot[tabindex="0"]');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
      });
      await step('reel spin', async () => {
        await page.goto(`${base}gallery.html?only=reel`);
        await page.click('button:has-text("Spin")');
        await page.waitForFunction(() => /Landed:/.test(document.body.textContent));
      });
      await step('overlays', async () => {
        await page.goto(`${base}gallery.html?only=overlays`);
        await page.click('[data-testid="toast"]');
        await page.click('[data-testid="achievement"]');
        await visible(page, '.toast--achievement');
      });
      await shot('toasts');
      await step('modal', async () => {
        await page.click('[data-testid="open-modal"]');
        await visible(page, 'dialog.modal[open]');
      });
      await shot('modal');
      await step('close modal, open sheet', async () => {
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('dialog.modal[open]'));
        await page.click('[data-testid="open-sheet"]');
        await visible(page, 'dialog.modal--sheet[open]');
      });
      if (viewport === 'mobile') await shot('sheet');
    },
  },
  // ---------- RUN-UI: World Cup Run, Daily Challenge, Exhibition, challenge links ----------
  {
    name: 'run',
    async run({ page, shot, step, base, viewport }) {
      await seed(page, { ...ONBOARDED, ...FAST_SIM });
      await step('empty hub', async () => {
        await page.goto(`${base}#/run`);
        await visible(page, '[data-screen="run"] [data-testid="start-run"]');
      });
      await step('draft (seeded) → arrival', async () => {
        await page.goto(base);
        await visible(page, '[data-screen="home"]');
        await startDraftIn(page, {
          kind: 'run',
          type: 'nations',
          difficulty: 'pro',
          formation: '433',
          seed: 42,
          returnTo: '/run',
        });
        await completeDraft(page, '[data-testid="next-fixture"]');
        await page.evaluate(() => document.fonts.ready);
      });
      await shot('arrival', { fullPage: viewport === 'mobile' });
      await step('four ways to play the next match', async () => {
        const options = await page.$$eval('.play-option', l =>
          l.map(b => b.querySelector('.play-option__title').textContent.trim()),
        );
        const expected = [
          'Watch highlights',
          'Watch full match',
          'Simulate this match',
          'Simulate the whole cup',
        ];
        if (options.join('|') !== expected.join('|')) throw new Error(`options: ${options}`);
        const hints = await page.$$eval('.play-option__hint', l => l.map(h => h.textContent));
        if (!/1 min/.test(hints[0]) || !/3 min/.test(hints[1])) throw new Error(`hints: ${hints}`);
        await page.locator('.play-options').scrollIntoViewIfNeeded();
      });
      await shot('play-options');
      const prematchView = () =>
        page.evaluate(async () => {
          const { prematchStore } = await import('./ui/lib/prematch-store.js');
          return prematchStore.get()?.view;
        });
      await step('"Watch full match" opens the pre-match on the full view', async () => {
        await page.click('[data-testid="play-full"]');
        await visible(page, '[data-screen="prematch"] [data-testid="kick-off"]');
        if ((await prematchView()) !== 'full') throw new Error(`view is ${await prematchView()}`);
        await page.goBack();
        await visible(page, '[data-testid="next-fixture"]');
      });
      await step(
        'matchday 1 is played in the draft formation (highlights preselected)',
        async () => {
          await page.click('[data-testid="play-fixture"]');
          await visible(page, '[data-screen="prematch"] [data-testid="formation-locked"]');
          if (!(await page.isDisabled('[data-testid="formation-select"]')))
            throw new Error('the formation can change in the group stage');
          // What is set up here stays for the run: push. (Back to the top: on a phone the
          // Kick off bar would otherwise cover the view radios finishMatch() presses.)
          await page.click('.tactics__mentality label:has-text("Push")');
          await page.evaluate(() => scrollTo(0, 0));
          if ((await prematchView()) !== 'key') throw new Error(`view is ${await prematchView()}`);
        },
      );
      await shot('first-match-locked');
      await step('play matchday 1', () => finishMatch(page));
      await step('result banner + record', async () => {
        await visible(page, '[data-testid="result-banner"]', 60000);
        const record = await page.textContent('.run-head__wdl');
        if (!/^\d–\d–\d$/.test(record.trim())) throw new Error(`record reads ${record}`);
      });
      await shot('after-match');
      await step('home continues the run', async () => {
        await page.goto(base);
        await visible(page, '[data-testid="continue-run"]');
        await page.click('[data-testid="continue-run"]');
        await visible(page, '[data-testid="next-fixture"]');
      });
      await step('matchday 2: still the draft formation, and the mentality was kept', async () => {
        await page.click('[data-testid="play-fixture"]');
        await visible(page, '[data-screen="prematch"] [data-testid="formation-locked"]');
        if (!(await page.isDisabled('[data-testid="formation-select"]')))
          throw new Error('the formation can change before matchday 2');
        if (!(await page.isChecked('.tactics__mentality input[value="push"]')))
          throw new Error('the mentality of matchday 1 was not kept');
        await page.goBack();
        await visible(page, '[data-testid="next-fixture"]');
      });
      await step('"Simulate this match" plays one fixture and shows its result', async () => {
        const before = await page.getAttribute('[data-testid="next-fixture"]', 'data-round');
        await page.click('[data-testid="sim-match"]');
        await visible(page, '[data-testid="result-banner"]', 60000);
        const eyebrow = await page.textContent('[data-testid="result-banner"] .eyebrow');
        if (!/Matchday 2/.test(eyebrow)) throw new Error(`banner reads ${eyebrow}`);
        const next = await page.getAttribute('[data-testid="next-fixture"]', 'data-round');
        if (before !== 'group2' || next !== 'group3')
          throw new Error(`fixtures: ${before} → ${next}`);
        const played = await page.$$eval('.run-path-strip .is-played', l => l.length);
        if (played !== 2) throw new Error(`${played} matches played, expected 2`);
      });
      await shot('after-sim-match');
      await step('"Simulate the whole cup" plays to the end', async () => {
        // With motion on, a cleared stage stops the sim on a pop-up until the player taps on.
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.click('[data-testid="sim-rest"]');
        const end = page.locator('[data-testid="run-end"]'),
          keep = page.locator('[data-testid="sim-keep"]');
        let popups = 0;
        for (const until = Date.now() + 120000; !(await end.count());) {
          if (Date.now() > until) throw new Error('the cup sim did not finish');
          if (await keep.count()) {
            await keep.click();
            popups++;
          } else await page.waitForTimeout(150);
        }
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const groupCleared = (await page.locator('.run-path-strip .is-played').count()) > 3;
        if (groupCleared && !popups) throw new Error('no stage pop-up after the group');
        const place = await page.getAttribute('[data-testid="run-end"]', 'data-place');
        const title = await page.textContent('.run-end__title');
        if (!place || /\b[SABCDF][+-]?\b grade/i.test(title)) throw new Error(`end: ${place}`);
        if (await page.locator('.grade').count()) throw new Error('a letter grade is shown');
      });
      await step("awards and the squad's stats, simulated matches included", () => honours(page));
      await shot('end');
      if (viewport === 'desktop') await shot('end-full', { fullPage: true });
      await step('share text + challenge link', async () => {
        const text = await page.textContent('[data-testid="share-text"]');
        if (!/World Cup Run/.test(text) || !/#\/challenge\?c=c1\.c\.n\.433\.p\./.test(text))
          throw new Error(`unexpected share text: ${text}`);
        if (!text.includes(new URL(base).host)) throw new Error('share link is not this page');
      });
      await step('end survives a reload', async () => {
        await page.reload();
        await visible(page, '[data-testid="run-end"]');
      });
      await step('the run is in the trophy cabinet on Home', async () => {
        // Let the reloaded page finish its font requests: leaving mid-download aborts them,
        // and the runner reports every failed request.
        await page.evaluate(() => document.fonts.ready);
        await page.waitForLoadState('networkidle');
        await page.goto(base);
        await visible(page, '[data-testid="cabinet"]');
        const foot = await page.textContent('.cabinet__foot');
        if (!/^1 run/.test(foot.trim())) throw new Error(`cabinet reads "${foot}"`);
        const status = await page.textContent('.cabinet__slot[data-level="pro"]');
        if (/Not played/.test(status)) throw new Error('the Pro slot ignores the run');
      });
      await shot('home-cabinet', { fullPage: true });
    },
  },
  {
    // A new World Cup draft asks before it replaces a run in progress — from the setup's
    // Start, "Play again" (?go=1), Budget mode and a challenge link alike; a finished run is
    // replaced without a question.
    name: 'run-replace',
    async run({ page, shot, step, base }) {
      await seed(page, { ...ONBOARDED, ...FAST_SIM });
      await page.goto(base);
      await visible(page, '[data-screen="home"]');
      await savedRun(page, { difficulty: 'pro', results: [[2, 0]] });
      const run = () => page.evaluate(() => localStorage.getItem('football-draft-run-state'));
      const dialog = 'dialog.replace-run[open]';
      const asked = async how => {
        await visible(page, `${dialog} [data-testid="replace-run"]`);
        if (!(await run())) throw new Error(`${how}: the run was dropped before the answer`);
      };
      const kept = async how => {
        await page.click(`${dialog} [data-testid="keep-run"]`);
        await page.waitForSelector(dialog, { state: 'detached', timeout: 5000 }).catch(() => {});
        if (await page.locator(dialog).count()) throw new Error(`${how}: the dialog stayed open`);
        await page.waitForTimeout(200);
        if (!(await run())) throw new Error(`${how}: "Keep run" lost the run`);
        if (await page.evaluate(() => !!localStorage.getItem('football-draft-draft')))
          throw new Error(`${how}: a draft started anyway`);
      };
      await step('Start on the setup asks first', async () => {
        await page.goto(base);
        await page.click('[data-testid="start-run"]');
        await visible(page, '[data-screen="setup"][data-mode="run"]');
        await page.locator('[data-testid="start-draft"]:visible').click();
        await asked('setup');
        await page.evaluate(() => document.fonts.ready);
      });
      await shot('ask');
      await step('"Keep run" changes nothing', () => kept('setup'));
      await step('Budget mode asks the same', async () => {
        await page.goto(base);
        await page.click('[data-testid="start-budget"]');
        await visible(page, '[data-screen="setup"] [data-testid="setup-budget"]');
        await page.locator('[data-testid="start-draft"]:visible').click();
        await asked('budget');
        await kept('budget');
      });
      await step('"Play again" (?go=1) asks instead of starting', async () => {
        await page.goto(base);
        await visible(page, '[data-screen="home"]');
        await page.evaluate(() => (location.hash = '#/play/run?type=nations&go=1'));
        await asked('go=1');
        await kept('go=1');
        if (!(await page.evaluate(() => location.hash.startsWith('#/play/run'))))
          throw new Error('left the setup');
      });
      await step('a challenge link asks, and "Start new" replaces the run', async () => {
        await page.goto(`${base}#/challenge?c=c1.c.n.433.p.0.16&r=6-1-1.th`);
        await page.click('[data-testid="accept-challenge"]');
        await asked('challenge');
        await kept('challenge');
        await page.click('[data-testid="accept-challenge"]');
        await asked('challenge');
        await page.click(`${dialog} [data-testid="replace-run"]`);
        await visible(page, '[data-screen="draft"][data-phase]');
        if (await run()) throw new Error('the old run is still saved');
        if (await page.evaluate(() => !!localStorage.getItem('football-draft-run')))
          throw new Error('Home would still show the old run');
      });
      await step('a finished run is replaced without a question', async () => {
        await page.goto(base);
        await visible(page, '[data-screen="home"]');
        await page.evaluate(() => localStorage.removeItem('football-draft-draft'));
        await savedRun(page, {
          difficulty: 'pro',
          results: [
            [0, 1],
            [0, 1],
            [0, 1],
          ],
        });
        await page.evaluate(() => (location.hash = '#/play/run?type=nations&go=1'));
        await visible(page, '[data-screen="draft"][data-phase]');
        if (await page.locator(dialog).count()) throw new Error('asked about a finished run');
      });
    },
  },
  {
    // The line-up of a run: after the group stage the formation can change, and what is set
    // up before a match (formation, mentality) is kept for the next ones and for auto-sims.
    name: 'run-lineup',
    async run({ page, shot, step, base }) {
      await seed(page, { ...ONBOARDED, ...FAST_SIM });
      await page.goto(base);
      await visible(page, '[data-screen="home"]');
      // Up to the semi-final: whatever its result, a match follows (the final or the play-off).
      await savedRun(page, { difficulty: 'pro', results: Array(6).fill([2, 0]) });
      const lineup = () =>
        page.evaluate(() => {
          const user = JSON.parse(localStorage.getItem('football-draft-run-state')).run.user;
          return `${user.formation}:${user.tactics?.mentality ?? '-'}:${user.players.join()}`;
        });
      let before = null,
        chosen = null;
      await step('after the group stage the formation can change', async () => {
        await page.goto(`${base}#/run`);
        await visible(page, '[data-testid="next-fixture"][data-round="sf"]');
        before = await lineup();
        await page.click('[data-testid="play-fixture"]');
        await visible(page, '[data-screen="prematch"] [data-testid="formation-select"]');
        if (await page.locator('[data-testid="formation-locked"]').count())
          throw new Error('the formation is still locked after the group stage');
        if (await page.isDisabled('[data-testid="formation-select"]'))
          throw new Error('the formation cannot change in a knockout match');
        chosen = before.startsWith('442:') ? '4231' : '442';
        await page.selectOption('[data-testid="formation-select"]', chosen);
        await page.click('.tactics__mentality label:has-text("Hold")');
        await page.evaluate(() => document.fonts.ready);
      });
      await shot('prematch-new-formation', { fullPage: true });
      await step('left without kicking off: the hub keeps the set-up', async () => {
        await page.goBack();
        await visible(page, '[data-testid="next-fixture"][data-round="sf"]');
        const now = await lineup();
        if (!now.startsWith(`${chosen}:hold:`)) throw new Error(`the run has ${now}`);
        const head = await page.textContent('.run-head__meta');
        const label = chosen === '442' ? '4–4–2' : '4–2–3–1';
        if (!head.includes(label)) throw new Error(`header reads "${head}", expected ${label}`);
      });
      await step('the match is played with it, and the next pre-match starts from it', async () => {
        await page.click('[data-testid="play-fixture"]');
        await visible(page, '[data-screen="prematch"] [data-testid="kick-off"]');
        if ((await page.inputValue('[data-testid="formation-select"]')) !== chosen)
          throw new Error('the pre-match forgot the formation');
        await finishMatch(page);
        await visible(page, '[data-testid="result-banner"]', 60000);
        const now = await lineup();
        if (!now.startsWith(`${chosen}:hold:`)) throw new Error(`after the match: ${now}`);
        if (await page.evaluate(() => !!localStorage.getItem('football-draft-prematch')))
          throw new Error('the pre-match of a finished match is still stored');
        await page.reload();
        await visible(page, '[data-testid="next-fixture"]');
        await page.click('[data-testid="play-fixture"]');
        await visible(page, '[data-screen="prematch"] [data-testid="kick-off"]');
        if ((await page.inputValue('[data-testid="formation-select"]')) !== chosen)
          throw new Error('the next pre-match was rebuilt from the draft');
        if (!(await page.isChecked('.tactics__mentality input[value="hold"]')))
          throw new Error('the next pre-match forgot the mentality');
        await page.evaluate(() => document.fonts.ready);
      });
      await shot('next-prematch', { fullPage: true });
    },
  },
  {
    // Where a run can finish (seeded results): champion, runners-up, third place after the
    // play-off, a quarter-final exit, and the ultimate achievement.
    name: 'run-end',
    async run({ page, shot, step, base, viewport }) {
      await seed(page, { ...ONBOARDED, ...FAST_SIM });
      await page.goto(base);
      await visible(page, '[data-screen="home"]');
      const W = [2, 0],
        L = [0, 1];
      const open = async (name, options) => {
        await page.goto(base);
        await visible(page, '[data-screen="home"]');
        await savedRun(page, options);
        await page.goto(`${base}#/run`);
        await visible(
          page,
          options.results.length < 8 && name !== 'qf'
            ? '[data-testid="next-fixture"]'
            : '[data-testid="run-end"]',
        );
        await page.evaluate(() => document.fonts.ready);
      };
      const place = () => page.getAttribute('[data-testid="run-end"]', 'data-place');
      await step('a lost semi-final leads to the third-place play-off', async () => {
        await open('playoff', { difficulty: 'pro', results: [W, W, W, W, W, W, L] });
        const round = await page.getAttribute('[data-testid="next-fixture"]', 'data-round');
        const title = await page.textContent('#fixture-title');
        if (round !== 'third' || !/Third-place play-off/.test(title))
          throw new Error(`next fixture: ${round} "${title}"`);
        if ((await page.locator('.play-option').count()) !== 4) throw new Error('four options');
      });
      await shot('playoff-hub', { fullPage: viewport === 'mobile' });
      await step('third place: bronze', async () => {
        await page.click('[data-testid="sim-match"]');
        await visible(page, '[data-testid="run-end"]', 60000);
        if (!['third', 'fourth'].includes(await place())) throw new Error(await place());
        await open('third', { difficulty: 'pro', results: [W, W, W, W, W, W, L, W] });
        if ((await place()) !== 'third') throw new Error(`place ${await place()}`);
        const title = await page.textContent('.run-end__title');
        if (!/Third place/.test(title)) throw new Error(`title reads ${title}`);
        await visible(page, '.run-end__cup .medal--bronze');
        const text = await page.textContent('[data-testid="share-text"]');
        if (!/7-0-1 · Third place/.test(text) || !/🥉/u.test(text))
          throw new Error(`share text: ${text}`);
      });
      await shot('third');
      await step('runners-up: silver', async () => {
        await open('second', { difficulty: 'worldclass', results: [W, W, [1, 1], W, W, W, W, L] });
        if ((await place()) !== 'final') throw new Error(`place ${await place()}`);
        const title = await page.textContent('.run-end__title');
        if (!/Runners-up/.test(title)) throw new Error(`title reads ${title}`);
        await visible(page, '.run-end__cup .medal--silver');
      });
      await shot('runner-up');
      await step('quarter-final exit: the round, no medal', async () => {
        await open('qf', { difficulty: 'pro', results: [W, L, W, W, W, [1, 1, 'opponent']] });
        if ((await place()) !== 'qf') throw new Error(`place ${await place()}`);
        const title = await page.textContent('.run-end__title');
        if (!/Out in the Quarter-finals/.test(title)) throw new Error(`title reads ${title}`);
        if (await page.locator('.run-end__cup').count()) throw new Error('a medal for a QF exit');
        await honours(page, 6);
      });
      await shot('qf-exit');
      await step('champions: the gold cup', async () => {
        await open('champion', { difficulty: 'pro', results: [W, [0, 0], W, W, W, W, W, W] });
        if ((await place()) !== 'champion') throw new Error(`place ${await place()}`);
        await visible(page, '.run-end__cup .cup--gold');
        const text = await page.textContent('[data-testid="share-text"]');
        if (!/7-1-0 · Champions/.test(text) || !/🏆/u.test(text))
          throw new Error(`share text: ${text}`);
        await honours(page, 8);
      });
      await shot('champion');
      await shot('champion-full', { fullPage: true });
      await step('Legendary + Budget + 8–0: the ultimate achievement', async () => {
        await open('ultimate', {
          difficulty: 'legendary',
          budget: true,
          results: [W, W, W, W, W, W, W, W],
        });
        await visible(page, '.run-end.is-ultimate .cup--holo');
        await visible(page, '.toast--achievement:has-text("Immortals")', 15000);
        const text = await page.textContent('[data-testid="share-text"]');
        if (!/👑 Immortals: Legendary · Budget · 8-0-0/u.test(text))
          throw new Error(`share text: ${text}`);
        // Legendary: the awards are over the whole 48-nation World Cup.
        await honours(page, 8);
      });
      await shot('ultimate');
      await step('the cabinet has them all, the ultimate slot is unlocked', async () => {
        await page.waitForLoadState('networkidle');
        await page.goto(base);
        await visible(page, '[data-testid="ultimate"][data-done="1"]');
        const best = level =>
          page.textContent(`.cabinet__slot[data-level="${level}"] .cabinet__best`);
        if (!/Champions/.test(await best('pro'))) throw new Error(`pro: ${await best('pro')}`);
        if (!/Runners-up/.test(await best('worldclass'))) throw new Error(await best('worldclass'));
        // The Legendary title was a Budget one: the standard slot is still to be won.
        if (!/Not played/.test(await best('legendary'))) throw new Error(await best('legendary'));
        // The Budget cabinet is one tap away and has the Legendary cup.
        await page.click('.cabinet__mode label:has-text("Budget")');
        await visible(page, '.cabinet__shelf[data-mode="budget"]');
        if (!/Champions/.test(await best('legendary'))) throw new Error(await best('legendary'));
      });
    },
  },
  {
    // The trophy cabinet on Home: empty, partly filled, and with the ultimate slot unlocked.
    name: 'home-cabinet',
    async run({ page, shot, step, base }) {
      await seed(page, ONBOARDED);
      const show = async records => {
        await page.goto(base);
        await visible(page, '[data-screen="home"]');
        await page.evaluate(data => {
          if (data) localStorage.setItem('football-draft-records', JSON.stringify(data));
          else localStorage.removeItem('football-draft-records');
        }, records);
        await page.reload();
        await visible(page, '[data-testid="cabinet"]');
        await page.evaluate(() => document.fonts.ready);
        await page.locator('[data-testid="cabinet"]').scrollIntoViewIfNeeded();
      };
      const tally = (runs, gold, silver, bronze, perfect, best) => ({
        runs,
        gold,
        silver,
        bronze,
        perfect,
        best,
      });
      await step('empty: Legendary in the middle, the ultimate slot locked', async () => {
        await show(null);
        const order = await page.$$eval('.cabinet__slot', l => l.map(a => a.dataset.level));
        if (order.join() !== 'pro,legendary,worldclass') throw new Error(`order: ${order}`);
        const sizes = await page.$$eval('.cabinet__slot', l =>
          l.map(a =>
            Math.round(a.getBoundingClientRect().width * a.getBoundingClientRect().height),
          ),
        );
        if (!(sizes[1] > sizes[0] && sizes[1] > sizes[2])) throw new Error(`sizes: ${sizes}`);
        const locked = await page.textContent('[data-testid="ultimate"][data-done="0"]');
        if (!/Immortals/.test(locked) || !/Legendary in Budget mode with eight wins/.test(locked))
          throw new Error(`locked slot reads ${locked}`);
        const target = await page.getAttribute('.cabinet__slot[data-level="legendary"]', 'href');
        if (target !== '#/play/run?difficulty=legendary') throw new Error(`slot → ${target}`);
      });
      await shot('empty');
      await step('partly filled: gold, silver and a round; Budget trophies alongside', async () => {
        await show({
          format: 3,
          levels: {
            pro: tally(9, 2, 1, 2, 1, 7),
            worldclass: tally(6, 0, 1, 1, 0, 6),
            legendary: tally(11, 0, 0, 0, 0, 3),
          },
          budget: {
            pro: tally(2, 1, 0, 0, 0, 7),
            worldclass: tally(1, 0, 0, 1, 0, 5),
            legendary: tally(0, 0, 0, 0, 0, 0),
          },
          ultimate: { count: 0, first: null },
          seen: [],
          last: null,
        });
        const text = level => page.textContent(`.cabinet__slot[data-level="${level}"]`);
        if (!/Champions ×2/.test(await text('pro'))) throw new Error(await text('pro'));
        if (!/Runners-up/.test(await text('worldclass'))) throw new Error(await text('worldclass'));
        if (!/Quarter-finals/.test(await text('legendary')))
          throw new Error(await text('legendary'));
        await visible(page, '[data-testid="ultimate"][data-done="0"]');
        await page.click('.cabinet__mode label:has-text("Budget")');
        await visible(page, '.cabinet__shelf[data-mode="budget"]');
        if (!/Third place/.test(await text('worldclass'))) throw new Error('budget bronze');
        await page.click('.cabinet__mode label:has-text("Classic")');
      });
      await shot('partly');
      await step('a cabinet saved in an older format reads as empty', async () => {
        await show({
          format: 2,
          levels: {
            amateur: { runs: 4, titles: 3, perfect: 1, best: 8 },
            pro: { runs: 5, titles: 1, perfect: 1, best: 8 },
            legendary: { runs: 2, titles: 0, perfect: 0, best: 7 },
          },
          seen: [],
        });
        const count = await page.getAttribute('.cabinet__count', 'aria-label');
        if (!/^0 of 3/.test(count)) throw new Error(`count: ${count}`);
        if ((await page.locator('.cabinet__slot', { hasText: 'Not played' }).count()) !== 3)
          throw new Error('an old cabinet still shows something');
      });
      await step('everything won: the ultimate slot unlocked', async () => {
        await show({
          format: 3,
          levels: {
            pro: tally(14, 4, 2, 2, 2, 7),
            worldclass: tally(9, 2, 1, 1, 0, 7),
            legendary: tally(21, 1, 2, 3, 0, 7),
          },
          budget: {
            pro: tally(3, 2, 0, 0, 1, 7),
            worldclass: tally(2, 0, 1, 0, 0, 6),
            legendary: tally(8, 2, 1, 1, 1, 7),
          },
          ultimate: { count: 1, first: '2026-11-12T19:30:00.000Z' },
          seen: [],
          last: null,
        });
        await visible(page, '[data-testid="ultimate"][data-done="1"] .cup--holo');
        const count = await page.getAttribute('.cabinet__count', 'aria-label');
        if (!/^3 of 3/.test(count)) throw new Error(`count: ${count}`);
      });
      await shot('complete');
    },
  },
  {
    name: 'daily',
    async run({ page, shot, step, base }) {
      await seed(page, { ...ONBOARDED, ...FAST_SIM });
      // An old, broken streak (seeded once: the reload below must keep today's attempt).
      await page.addInitScript(() => {
        if (!localStorage.getItem('football-draft-daily'))
          localStorage.setItem(
            'football-draft-daily',
            JSON.stringify({ streak: 2, best: 5, lastPlayed: '2000-01-01' }),
          );
      });
      await page.goto(`${base}#/daily`);
      await step('intro', () => visible(page, '[data-testid="start-daily"]', 30000));
      await page.evaluate(() => document.fonts.ready);
      await shot('intro', { fullPage: true });
      const dailyDraft = () =>
        page.evaluate(() => {
          const d = JSON.parse(localStorage.getItem('football-draft-daily') || '{}').draft;
          return d ? d.session.state.picks.flat().filter(Boolean).join() : null;
        });
      let picked = null;
      await step('the first pick locks the day: the draft is kept with the Daily', async () => {
        await page.click('[data-testid="start-daily"]');
        await visible(page, '[data-screen="draft"] [data-testid="spin-result"]');
        if (await dailyDraft()) throw new Error('locked before a pick was made');
        await page.click('[data-testid="auto-pick"]');
        await page.waitForFunction(
          () => !!JSON.parse(localStorage.getItem('football-draft-daily') || '{}').draft,
        );
        picked = await dailyDraft();
        if (!picked) throw new Error('no pick was kept');
      });
      await step('left mid-draft: Home and the Daily offer to resume, not to start', async () => {
        await page.click('.topbar__back');
        await visible(page, '[data-screen="home"] .home-daily');
        const card = await page.textContent('.home-daily');
        if (!/Started/.test(card) || !/Resume/.test(card)) throw new Error(`Daily card: ${card}`);
        // Another draft takes the one draft slot meanwhile.
        await page.evaluate(async () => {
          const store = await import('./ui/lib/draft-store.js');
          await store.startDraft({ kind: 'quick', type: 'clubs', seed: 5 }, { go: false });
        });
        await page.goto(`${base}#/daily`);
        await visible(page, '[data-testid="resume-daily"]', 30000);
        if (await page.locator('[data-testid="start-daily"]').count())
          throw new Error('the Daily can be started again after a pick');
        if ((await dailyDraft()) !== picked) throw new Error('the kept draft changed');
      });
      await shot('resume', { fullPage: true });
      await step('resume: the same draft with its pick, then auto picks', async () => {
        await page.click('[data-testid="resume-daily"]');
        await visible(page, '[data-screen="draft"][data-phase]');
        const state = await page.evaluate(() => {
          const d = JSON.parse(localStorage.getItem('football-draft-draft'));
          return [d.context.kind, d.session.state.picks.flat().filter(Boolean).join()];
        });
        if (state[0] !== 'daily' || !state[1].startsWith(picked))
          throw new Error(`resumed ${state.join(' ')}, kept ${picked}`);
        await completeDraft(page, '[data-testid="daily-sim"], [data-testid="daily-result"]');
        if (await dailyDraft()) throw new Error('the kept draft outlived the draft');
      });
      await step('auto-sim to the result', () =>
        visible(page, '[data-testid="daily-result"]', 120000),
      );
      await step("awards and the squad's stats", () => honours(page));
      await shot('result');
      await shot('result-full', { fullPage: true });
      await step('share text', async () => {
        const text = await page.textContent('[data-testid="share-text"]');
        if (!/Daily #\d+/.test(text) || !/[🟩🟨🟥]/u.test(text) || !/pts/.test(text))
          throw new Error(`unexpected share text: ${text}`);
      });
      await step('one attempt per day', async () => {
        await page.reload();
        await visible(page, '[data-testid="daily-result"]');
        if (await page.locator('[data-testid="start-daily"]').count())
          throw new Error('the daily can be started twice');
        const saved = await page.evaluate(() =>
          JSON.parse(localStorage.getItem('football-draft-daily')),
        );
        if (saved.streak !== 1 || saved.best !== 5) throw new Error('streak not updated');
      });
    },
  },
  {
    name: 'exhibition',
    async run({ page, shot, step, base }) {
      await seed(page, ONBOARDED);
      await page.goto(`${base}#/exhibition`);
      await step('picker', async () => {
        await visible(page, '[data-screen="exhibition"] .ex-team');
        await page.evaluate(() => document.fonts.ready);
      });
      await shot('picker');
      await step('pick a national team', async () => {
        await page.getByRole('tab', { name: /Nations/ }).click();
        await page.fill('.ex-search input', 'braz');
        await page.locator('.ex-team', { hasText: 'Brazil' }).first().click();
        const away = await page.textContent('[data-testid="slot-1"]');
        if (!/Brazil/.test(away)) throw new Error(`away slot reads ${away}`);
      });
      await step('random XI', async () => {
        await page.click('[data-testid="slot-0"]');
        await page.getByRole('tab', { name: /Random/ }).click();
        await page.click('[data-testid="roll-random"]');
        await page.waitForFunction(() =>
          /Random XI/.test(document.querySelector('[data-testid="slot-0"]').textContent),
        );
      });
      await shot('matchup');
      await step('kick off → result', async () => {
        await page.click('[data-testid="kick-off"]');
        await finishMatch(page);
        await visible(page, '[data-testid="exhibition-last"]', 60000);
      });
      await shot('result');
    },
  },
  {
    name: 'challenge-link',
    async run({ page, shot, step, base }) {
      await seed(page, { ...ONBOARDED, ...FAST_SIM });
      await step('links of older formats are not valid: no crash, the way Home', async () => {
        // A removed difficulty (a), Club & Country (x), a Quick Match link (q).
        for (const token of ['c1.c.n.433.a.0.16', 'c1.c.x.433.p.0.16', 'c1.q.n.433.p.0.16']) {
          await page.goto(`${base}#/challenge?c=${token}&r=5-1-1.bp`);
          await visible(
            page,
            '[data-screen="challenge"] .empty-state, [data-screen="challenge"] h1',
          );
          if (await page.locator('[data-testid="accept-challenge"]').count())
            throw new Error(`${token} can be accepted`);
        }
        // A letter grade where the place goes: the challenge opens, without a result.
        await page.goto(`${base}#/challenge?c=c1.c.n.433.p.0.16&r=5-1-1.bp`);
        await visible(page, '[data-screen="challenge"] [data-testid="accept-challenge"]');
        if (await page.locator('.friend-score').count())
          throw new Error('a grade read as a result');
        // The short '#c=' form is gone: not a route.
        await page.goto(`${base}#c=c1.c.n.433.p.0.16`);
        await visible(page, '[data-screen="placeholder"] h1');
      });
      await step('shared link with a result', async () => {
        await page.goto(`${base}#/challenge?c=c1.c.n.433.p.0.16&r=6-1-1.th`);
        await visible(page, '[data-screen="challenge"] .friend-score .medal');
        const label = await page.textContent('.friend-score__label');
        if (!/Third place/.test(label)) throw new Error(`friend result reads ${label}`);
        await page.evaluate(() => document.fonts.ready);
      });
      await shot('landing');
      await step('a Budget run’s link says Budget and starts a Budget draft', async () => {
        await page.goto(`${base}#/challenge?c=c1.c.n.433.p.b.16&r=6-1-1.th`);
        await visible(page, '[data-screen="challenge"] [data-testid="challenge-budget"]');
        const review = await page.getAttribute('.challenge-card__setup', 'href');
        if (!/budget=1/.test(review)) throw new Error(`the review link reads ${review}`);
        await page.evaluate(() => document.fonts.ready);
        await shot('landing-budget');
        await page.click('.challenge-card__setup');
        await visible(page, '[data-screen="setup"][data-mode="run"] [data-testid="setup-budget"]');
        await page.goBack();
        await page.click('[data-testid="accept-challenge"]');
        await visible(page, '[data-screen="draft"][data-phase]');
        const draft = await page.evaluate(() =>
          JSON.parse(localStorage.getItem('football-draft-draft')),
        );
        if (!draft.context.options.budget || !draft.session.options.budget)
          throw new Error('the friend’s draft is not a Budget draft');
        if (draft.context.seed !== 42 || !draft.session.options.useDefaultRules)
          throw new Error('not the same draft');
        // A link without the flag is no Budget draft.
        await page.evaluate(() => localStorage.removeItem('football-draft-draft'));
        await page.goto(`${base}#/challenge?c=c1.c.n.433.p.0.16&r=6-1-1.th`);
        await visible(page, '[data-screen="challenge"] .friend-score');
        if (await page.locator('[data-testid="challenge-budget"]').count())
          throw new Error('a normal link says Budget');
      });
      await step('accept → same draft → run', async () => {
        await page.click('[data-testid="accept-challenge"]');
        await completeDraft(page, '[data-testid="next-fixture"]');
        const eyebrow = await page.textContent('.run-head .eyebrow');
        if (!/Challenge/.test(eyebrow)) throw new Error(`not marked as a challenge: ${eyebrow}`);
      });
      await shot('run');
      await step('broken link', async () => {
        await page.goto(`${base}#/challenge?c=nope`);
        await visible(page, '[data-screen="challenge"] h1');
      });
    },
  },
  ...matchFlows,
  {
    // Offline play (app/sw.js + ui/lib/offline.js): one online visit, then without a network
    // the game still loads, drafts and plays a match. ?sw=1 enables the worker on loopback.
    name: 'offline',
    viewports: ['desktop'],
    async run({ page, shot, step, base }) {
      await seed(page, ONBOARDED);
      await step('first visit caches the game', async () => {
        await page.goto(`${base}?sw=1#/`);
        await visible(page, '[data-screen="home"]');
        await page.waitForSelector('html[data-offline-ready]', {
          state: 'attached',
          timeout: 30000,
        });
      });
      await page.context().setOffline(true);
      try {
        await step('reload offline', async () => {
          await page.reload();
          await visible(page, '[data-screen="home"]');
        });
        await step('draft offline', async () => {
          await startFromSetup(page, base, '?sw=1#/play/quick?type=nations&seed=8');
          await page.evaluate(() => (location.hash = '#/draft?auto=1'));
          await visible(page, 'dialog.complete-sheet[open]', 30000);
          await page.click('[data-testid="draft-continue"]');
          await visible(page, '[data-testid="opponent-name"]');
          await page.click('[data-testid="draft-continue"]');
          await visible(page, '[data-screen="prematch"] .lineup__pitch');
        });
        await shot('prematch-offline');
        await step('play a match offline', () => finishMatch(page));
      } finally {
        await page.context().setOffline(false);
      }
    },
  },
];
