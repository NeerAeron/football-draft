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
      await step('first clip plays', () => visible(page, '.stage-chip:has-text("Clip")', 30000));
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
    async run({ page, shot, step, base }) {
      await page.goto(`${base}${MATCH}&view=full`);
      await kickOff(page, step);
      await step('live canvas', () => visible(page, '.stage__canvas'));
      await page.waitForTimeout(2500);
      await shot('live');
      await step('speed 4x', () => page.click('.match-speed label:has-text("4×")'));
      await page.waitForTimeout(2000);
      await step('keyboard pause', async () => {
        await page.locator('.stage__canvas').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('Space');
        await visible(page, '.stage-play');
        await page.keyboard.press('Space');
      });
      await step('next moment', () => page.click('[data-testid="skip-moment"]'));
      await page.waitForTimeout(2500);
      await shot('after-skip');
      await step('mentality push', () =>
        page.click('.match-controls__mentality label:has-text("Push")'),
      );
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
        console.log(
          `        frame ms avg ${perf.avg.toFixed(2)} p95 ${perf.p95.toFixed(2)} (${perf.frames} frames)`,
        );
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
        await visible(page, '.stage__canvas', 30000);
        if (await page.locator('[data-testid="kickoff"]').count())
          throw new Error('pre-kickoff shown despite autoKickoff');
        await visible(page, '[data-testid="play-pause"][aria-label="Pause"]');
      });
    },
  },
  {
    name: 'match-pens',
    async run({ page, shot, step, base }) {
      await page.goto(`${base}${MATCH}&view=full&pens=1`);
      await kickOff(page, step);
      await step('shootout panel', () => visible(page, '.pens', 20000));
      await step('speed 4x', () => page.click('.match-speed label:has-text("4×")'));
      await page.waitForTimeout(3000);
      await shot('shootout');
      await step('shootout decided', () => visible(page, '[data-testid="match-result"]', 90000));
      await shot('result');
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
      for (const path of ['run', 'daily', 'exhibition', 'nope']) {
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
      await step('match starts without a second pre-kickoff', async () => {
        await visible(page, '[data-screen="match"] .stage__canvas', 30000);
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
  ...matchFlows,
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
