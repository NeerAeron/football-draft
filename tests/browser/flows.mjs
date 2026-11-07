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
 * Finish a draft started with startDraft(): on DRAFT-UI's board press its auto-pick control
 * until the draft returns; the TEMP STUB draft-store drafts instantly (nothing to do).
 */
async function completeDraft(page, until) {
  for (let i = 0; i < 40; i++) {
    if (
      await page
        .locator(until)
        .first()
        .isVisible()
        .catch(() => false)
    )
      return;
    const auto = page.locator('[data-screen="draft"] [data-testid="auto-pick"]');
    if (await auto.isVisible().catch(() => false)) await auto.click();
    await page.waitForTimeout(250);
  }
  await visible(page, until, 30000);
}

/**
 * Play the requested match: pre-match → Kick off, match screen → Instant → Continue. Until
 * those screens exist (placeholders), simulate the stored request in the page with the same
 * engine and come back the way Continue does.
 */
async function finishMatch(page) {
  await page.waitForFunction(() => /^#\/(match|prematch)/.test(location.hash), null, {
    timeout: 15000,
  });
  const kickOff = page.locator('[data-screen="prematch"] [data-testid="kick-off"]');
  if (await kickOff.isVisible().catch(() => false)) await kickOff.click();
  const matchScreen = page.locator('[data-screen="match"]');
  if (await matchScreen.isVisible({ timeout: 3000 }).catch(() => false)) {
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
        await visible(page, '[data-screen="placeholder"]');
      });
      await shot('play-placeholder');
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
      for (const path of ['play/quick', 'draft', 'match', 'nope']) {
        await step(`#/${path}`, async () => {
          await page.goto(`${base}#/${path}`);
          await visible(page, '[data-screen="placeholder"] h1');
        });
      }
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
