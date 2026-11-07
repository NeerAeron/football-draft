// User flows for scripts/dev/browser.mjs (smoke test + screenshots).
// Keep selectors in sync with app/ui (new shell: index.html, gallery.html) and app/legacy/
// (legacy.html) when the UI changes. One flow (or group of flows) per screen owner.
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
  if (await page.evaluate(() => location.hash.startsWith('#/prematch'))) {
    const kickOff = page.locator('[data-screen="prematch"] [data-testid="kick-off"]');
    await kickOff.waitFor({ state: 'visible', timeout: 15000 });
    await kickOff.click();
    await page.waitForFunction(() => location.hash.startsWith('#/match'), null, {
      timeout: 15000,
    });
  }
  await visible(page, '[data-screen="match"], [data-screen="placeholder"]');
  if (await page.locator('[data-screen="match"]').isVisible()) {
    const instant = page.getByRole('button', { name: /instant/i }).first();
    if (await instant.isVisible().catch(() => false)) await instant.click();
    const go = page.getByRole('button', { name: /continue/i }).first();
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
async function draftPick(page, { tryAuto = false } = {}) {
  const spin = page.locator('[data-testid="spin"]');
  if (await spin.isVisible().catch(() => false)) await spin.click();
  const row = page.locator('[data-testid="pool"] button.prow:not([disabled])').first();
  await row.waitFor({ state: 'visible', timeout: 10000 });
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

// ---------- Legacy game (app/legacy.html) ----------

const LEGACY = 'legacy.html';

function spinIdle(page, id) {
  return page.waitForFunction(sel => {
    const b = document.querySelector(sel);
    return b && !/Spinning/.test(b.textContent);
  }, id);
}

/** League spin (always), then club spin when the league has clubs. */
async function legacySpins(page) {
  const leagueSpin = page.locator('#league-spin');
  if (await leagueSpin.isEnabled()) await leagueSpin.click();
  await spinIdle(page, '#league-spin');
  if (await page.locator('#team-spinner').isVisible()) {
    const teamSpin = page.locator('#team-spin');
    if (await teamSpin.isEnabled()) await teamSpin.click();
    await spinIdle(page, '#team-spin');
  }
}

/** First enabled card, revealing more of the list ("Show more") until one appears. */
async function pickableCard(page) {
  await page.waitForFunction(
    () =>
      document.querySelector('#draft-player-list .draft-card') ||
      /No players match/.test(document.querySelector('#draft-player-list')?.textContent || ''),
    null,
    { timeout: 10000 },
  );
  const card = page.locator('#draft-player-list .draft-card:not([disabled])').first();
  for (let i = 0; i < 12; i++) {
    if (await card.isVisible().catch(() => false)) return card;
    const more = page.locator('#draft-more');
    if (!(await more.isVisible().catch(() => false))) break;
    await more.click();
  }
  return (await card.isVisible().catch(() => false)) ? card : null;
}

// The legacy draft is unseeded: late picks can leave only blocked cards in view. Reveal more
// of the list first, then spend a team/league re-spin as a last resort.
async function draftOnePick(page) {
  await legacySpins(page);
  let card = await pickableCard(page);
  for (const kind of ['team', 'league']) {
    if (card) break;
    const respin = page.locator(`#${kind}-respin`);
    if (!(await respin.isVisible().catch(() => false)) || !(await respin.isEnabled())) continue;
    await respin.click();
    await spinIdle(page, `#${kind}-respin`);
    await legacySpins(page);
    card = await pickableCard(page);
  }
  if (!card) throw new Error('no pickable player card after Show more and re-spins');
  await card.click();
  const confirm = page.locator('#budget-confirm-dialog[open] #budget-confirm-accept');
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
}

export const flows = [
  {
    name: 'home',
    async run({ page, shot, step, base, viewport }) {
      await page.goto(base);
      await step('home screen', () => visible(page, '[data-screen="home"]'));
      await step('fonts', () => page.evaluate(() => document.fonts.ready));
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
      await step('draft type switch', async () => {
        await page.click('.home-hero__seg label:has-text("Clubs")');
        const target = await page.getAttribute('[data-testid="start-run"]', 'href');
        if (target !== '#/play/run?type=clubs') throw new Error(`CTA points to ${target}`);
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
          record: { w: 3, d: 1, l: 0 },
          team: 'Brazil',
        },
        'football-draft-daily': { streak: 4, best: 9, lastPlayed: '2000-01-01' },
      });
      await page.goto(base);
      await step('continue card', () => visible(page, '.continue'));
      await page.evaluate(() => document.fonts.ready);
      await shot('continue');
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
      for (const path of ['match', 'nope']) {
        await step(`#/${path}`, async () => {
          await page.goto(`${base}#/${path}`);
          await visible(page, '[data-screen="placeholder"] h1');
        });
      }
    },
  },
  // ---------- DRAFT-UI: setup, draft board, pre-match ----------
  {
    name: 'setup',
    async run({ page, shot, step, base, viewport }) {
      await seed(page, ONBOARDED);
      await page.goto(`${base}#/play/run`);
      await step('run setup', () => visible(page, '[data-screen="setup"][data-mode="run"]'));
      await step('opponents loaded', () => visible(page, '.ladder__examples:not(.is-muted)'));
      await page.evaluate(() => document.fonts.ready);
      await shot('run');
      if (viewport === 'mobile') await shot('run-full', { fullPage: true });
      await step('choose clubs + world class + 4-4-2', async () => {
        await page.click('.type-card:has-text("Clubs")');
        await page.click('.ladder__row:has-text("World Class")');
        await page.click('.formation-card:has-text("4–4–2")');
        for (const [name, value] of [
          ['setup-type', 'clubs'],
          ['setup-difficulty', 'worldclass'],
          ['setup-formation', '442'],
        ])
          if (!(await page.isChecked(`input[name="${name}"][value="${value}"]`)))
            throw new Error(`${name} is not ${value}`);
      });
      await step('quick setup prefilled from a challenge link', async () => {
        await page.goto(
          `${base}#/play/quick?type=leagues&difficulty=amateur&formation=4231&seed=123`,
        );
        await visible(page, '[data-screen="setup"][data-mode="quick"] .setup-challenge');
        for (const [name, value] of [
          ['setup-type', 'leagues'],
          ['setup-difficulty', 'amateur'],
          ['setup-formation', '4231'],
        ])
          if (!(await page.isChecked(`input[name="${name}"][value="${value}"]`)))
            throw new Error(`${name} is not ${value}`);
      });
      await shot('quick-challenge');
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
        startFromSetup(page, base, '#/play/run?type=nations&seed=7&formation=433'),
      );
      await step('first spin lands', () => visible(page, '[data-testid="spin-result"]'));
      await page.evaluate(() => document.fonts.ready);
      await shot('first-spin');
      await step('select a player', async () => {
        await page.locator('[data-testid="pool"] button.prow:not([disabled])').first().click();
        await visible(page, '[data-testid="confirm-pick"]');
      });
      await shot('selected');
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
          await draftPick(page, { tryAuto: pick === 6 });
          await picksMade(page, pick);
        });
        if (pick === 5) await shot('mid-draft', viewport === 'mobile' ? { fullPage: true } : {});
      }
      await step('completion sheet', () => visible(page, 'dialog.complete-sheet[open]'));
      await shot('complete');
      await step('continue to the run', async () => {
        await page.click('[data-testid="draft-continue"]');
        await page.waitForFunction(() => location.hash === '#/run');
      });
    },
  },
  {
    name: 'draft-clubs',
    async run({ page, shot, step, base }) {
      await seed(page, ONBOARDED);
      await step('start a seeded clubs quick draft', () =>
        startFromSetup(page, base, '#/play/quick?type=clubs&seed=11&difficulty=amateur'),
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
        await visible(page, 'dialog.modal[open] .odds');
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
        await page.click('[data-testid="spin"]');
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
        await startFromSetup(page, base, '#/play/quick?type=nations&seed=3&difficulty=semipro');
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
      await step('play matchday 1', async () => {
        await page.click('[data-testid="play-fixture"]');
        await finishMatch(page);
      });
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
      await step('sim rest of run', async () => {
        await page.click('[data-testid="sim-rest"]');
        await visible(page, '[data-testid="run-end"]', 120000);
      });
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
      await step('draft with auto picks', async () => {
        await page.click('[data-testid="start-daily"]');
        await completeDraft(page, '[data-testid="daily-sim"], [data-testid="daily-result"]');
      });
      await step('auto-sim to the result', () =>
        visible(page, '[data-testid="daily-result"]', 120000),
      );
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
      await step('short link lands on the challenge', async () => {
        await page.goto(`${base}#c=c1.c.n.433.p.0.16`);
        await visible(page, '[data-screen="challenge"] [data-testid="accept-challenge"]');
      });
      await step('shared link with a result', async () => {
        await page.goto(`${base}#/challenge?c=c1.c.n.433.p.0.16&r=5-1-1.bp`);
        await visible(page, '[data-screen="challenge"] .friend-score');
        await page.evaluate(() => document.fonts.ready);
      });
      await shot('landing');
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
  {
    name: 'legacy-home',
    async run({ page, shot, base }) {
      await page.goto(base + LEGACY);
      await visible(page, '#home-screen');
      await shot('landing');
    },
  },
  {
    name: 'legacy-draft-ai',
    async run({ page, shot, step, base }) {
      await page.goto(base + LEGACY);
      await step('choose classic mode', () => page.click('[data-game-mode="ai"]'));
      await step('financial takeover', () => page.selectOption('#funding', 'takeover'));
      await step('start draft', () => page.click('#begin-game'));
      await step('draft screen', () => visible(page, '#draft-screen', 30000));
      await shot('start');
      for (let pick = 0; pick < 11; pick++) {
        await step(`pick ${pick + 1}`, () => draftOnePick(page));
        if (pick === 0) await shot('after-first-pick');
        if (pick === 5) await shot('mid-draft', { fullPage: true });
      }
      await step('finish draft', async () => {
        await visible(page, '#draft-finish');
        await shot('complete');
        await page.click('#draft-finish');
      });
      await step('match screen', () => visible(page, '#match-screen', 30000));
      await page.waitForTimeout(500);
      await shot('kickoff');
      await step('play', () => page.click('#play'));
      await page.waitForTimeout(4000);
      await shot('live');
    },
  },
  {
    name: 'legacy-sandbox',
    async run({ page, shot, step, base }) {
      await page.goto(base + LEGACY);
      await step('choose sandbox', () => page.click('[data-game-mode="sandbox"]'));
      await page.waitForTimeout(300);
      await shot('setup');
      await step('start sandbox', () => page.click('#begin-game'));
      await step('match screen', () => visible(page, '#match-screen', 30000));
      await page.waitForTimeout(500);
      await shot('kickoff');
    },
  },
  {
    name: 'config',
    viewports: ['desktop'],
    async run({ page, shot, base }) {
      await page.goto(`${base}config.html`);
      await page.waitForTimeout(800);
      await shot('page');
    },
  },
];
