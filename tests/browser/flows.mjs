// User flows for scripts/dev/browser.mjs (smoke test + screenshots).
// Keep selectors in sync with app/index.html and app/legacy/ when the UI changes.
// Each run() receives { page, shot, step, base, viewport }.

const visible = (page, selector, timeout = 15000) =>
  page.waitForSelector(selector, { state: 'visible', timeout });

async function draftOnePick(page) {
  // League spin (always), then club spin when the league has clubs.
  const leagueSpin = page.locator('#league-spin');
  if (await leagueSpin.isEnabled()) await leagueSpin.click();
  await page.waitForFunction(() => {
    const b = document.querySelector('#league-spin');
    return b && !/Spinning/.test(b.textContent);
  });
  const team = page.locator('#team-spinner');
  if (await team.isVisible()) {
    const teamSpin = page.locator('#team-spin');
    if (await teamSpin.isEnabled()) await teamSpin.click();
    await page.waitForFunction(() => {
      const b = document.querySelector('#team-spin');
      return b && !/Spinning/.test(b.textContent);
    });
  }
  const card = page.locator('#draft-player-list .draft-card:not([disabled])').first();
  await card.waitFor({ state: 'visible', timeout: 10000 });
  await card.click();
  const confirm = page.locator('#budget-confirm-dialog[open] #budget-confirm-accept');
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
}

export const flows = [
  {
    name: 'home',
    async run({ page, shot, base }) {
      await page.goto(base);
      await visible(page, '#home-screen');
      await shot('landing');
    },
  },
  {
    name: 'draft-ai',
    async run({ page, shot, step, base }) {
      await page.goto(base);
      await step('choose classic mode', () => page.click('[data-game-mode="ai"]'));
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
    name: 'sandbox',
    async run({ page, shot, step, base }) {
      await page.goto(base);
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
