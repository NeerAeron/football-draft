// User flows for scripts/dev/browser.mjs (smoke test + screenshots).
// Keep selectors in sync with app/ui (new shell: index.html, gallery.html) and app/legacy/
// (legacy.html) when the UI changes. One flow (or group of flows) per screen owner.
// Each run() receives { page, shot, step, base, viewport }.

const visible = (page, selector, timeout = 15000) =>
  page.waitForSelector(selector, { state: 'visible', timeout });

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
