import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeCatalog } from '../scripts/data/catalog-file.mjs';
import { createDraftSession, restoreDraftSession } from '../app/core/draft/session.js';
import { budgetBands, bandIndex, bandUse, freeLabel } from '../app/core/draft/budget.js';
import { naturalRating } from '../app/core/draft/pools.js';
import { DEFAULT_CONFIG, normalizeConfig } from '../app/core/config/config.js';
import { lcg } from '../app/core/util/rng.js';

const catalog = loadRuntimeCatalog();
const bands = budgetBands(DEFAULT_CONFIG.draft.budget);
const price = p => Math.round(naturalRating(p));

// Policies: (session) => { profileId, slot }.
const greedy = s => s.suggestPick();
const randomPolicy = random => s => {
  const pool = s.snapshot().pool.filter(e => e.available),
    e = pool[Math.floor(random() * pool.length)];
  return { profileId: e.profileId, slot: s.autoSlot(e.profileId).slot };
};
// The most expensive affordable player first, the keeper last: fills the bands at once and
// leaves the single GK slot for the end (the hardest case for the dead-end guard).
const spender = s => {
  const pool = s.snapshot().pool.filter(e => e.available),
    outfield = pool.filter(e => e.position !== 'GK'),
    e = (outfield.length ? outfield : pool).reduce((a, b) => (b.ovr > a.ovr ? b : a));
  return { profileId: e.profileId, slot: s.autoSlot(e.profileId).slot };
};
function finish(s, policy, each = () => {}) {
  while (!s.complete) {
    if (s.phase === 'spin') s.spin();
    each(s);
    const move = policy(s);
    assert.ok(move, 'the spin offers someone affordable');
    const result = s.pick(move.profileId, move.slot);
    assert.ok(result.ok, result.reason);
  }
  return s;
}
function assertWithinBudget(s) {
  for (let side = 0; side < s.sides; side++) {
    const used = bandUse(bands, s.lineup(side).map(price));
    used.forEach((n, i) => assert.ok(n <= bands[i].slots, `${bands[i].label}: ${n}`));
  }
}

test('bands: 88+ ×1, 84–87 ×2, 80–83 ×3, the rest free', () => {
  assert.deepEqual(
    bands.map(b => [b.id, b.label, b.minimum, b.slots]),
    [
      ['band1', '88+', 88, 1],
      ['band2', '84–87', 84, 2],
      ['band3', '80–83', 80, 3],
    ],
  );
  assert.equal(freeLabel(bands), 'Under 80');
  assert.deepEqual(
    [91, 88, 87, 84, 83, 80, 79, 60].map(r => bandIndex(bands, r)),
    [0, 0, 1, 1, 2, 2, -1, -1],
  );
  assert.deepEqual(bandUse(bands, [90, 85, 85, 81, 70]), [1, 2, 1]);
  // Rules saved before Budget mode read as the defaults.
  assert.deepEqual(budgetBands(undefined), bands);
  assert.deepEqual(budgetBands({}), bands);
  assert.throws(() =>
    normalizeConfig({ draft: { budget: { band2: { minimum: 90 } } } }, { lenient: false }),
  );
});

test('a budget draft never exceeds a band, whatever the policy, and never dead-ends', () => {
  const policies = [greedy, spender, randomPolicy(lcg(5))];
  let closed = 0;
  for (const mode of ['nations', 'leagues', 'clubs'])
    for (let seed = 1; seed <= 40; seed++) {
      const s = createDraftSession(catalog, {
        mode,
        seed: seed * 7919,
        budget: true,
        sides: seed % 5 === 0 ? 2 : 1,
        uniqueNations: seed % 3 === 0,
        rerolls: seed % 2,
        formation: ['433', '4231', '442', '352', '343'][seed % 5],
      });
      finish(s, policies[seed % policies.length], s => {
        if (s.snapshot().canReroll && s.random() < 0.3) s.reroll();
        const snap = s.snapshot();
        assert.ok(
          snap.pool.some(e => e.available),
          'someone to pick',
        );
        for (const e of snap.pool) {
          const p = s.player(e.profileId);
          assert.equal(e.band, bands[bandIndex(bands, e.ovr)]?.id ?? null);
          if (!s.affordable(p)) {
            closed++;
            assert.equal(e.available, false);
            assert.match(e.reason, /^No (88\+|84–87|80–83) slot left$|filled$/);
            assert.equal(s.pick(e.profileId).ok, false);
            assert.ok(s.placementOptions(e.profileId).every(o => !o.allowed));
          }
        }
        // Auto-pick never suggests a player the budget does not allow.
        assert.ok(s.affordable(s.player(s.suggestPick().profileId)));
      });
      assertWithinBudget(s);
    }
  assert.ok(closed > 200, 'the caps did close players: ' + closed);
});

test('the team view counts the slots; a full band closes its players with a reason', () => {
  const s = createDraftSession(catalog, { seed: 3, budget: true, rerolls: 0 });
  assert.equal(s.snapshot().budget, true);
  assert.deepEqual(
    s.snapshot().teams[0].budget.map(b => [b.label, b.slots, b.used, b.left]),
    [
      ['88+', 1, 0, 1],
      ['84–87', 2, 0, 2],
      ['80–83', 3, 0, 3],
    ],
  );
  finish(s, spender);
  const view = s.snapshot().teams[0].budget;
  assert.deepEqual(
    view.map(b => b.used),
    bandUse(bands, s.lineup(0).map(price)),
  );
  assert.ok(view.every(b => b.used <= b.slots && b.left === b.slots - b.used));
  // Off by default: no bands, nothing closed by rating.
  const plain = createDraftSession(catalog, { seed: 3 });
  plain.spin();
  assert.equal(plain.snapshot().budget, false);
  assert.equal(plain.snapshot().teams[0].budget, null);
  assert.ok(plain.snapshot().pool.every(e => e.band === null));
});

test('a nation spin with a full band still shows the stars (closed) and a full squad to pick', () => {
  // Fill the 88+ slot and both 84–87 slots, then look at a strong nation's pool.
  let found = false;
  for (let seed = 1; seed <= 60 && !found; seed++) {
    const s = createDraftSession(catalog, { seed, budget: true, rerolls: 0 });
    while (!s.complete && !found) {
      s.spin();
      const snap = s.snapshot(),
        closed = snap.pool.filter(e => /slot left$/.test(e.reason));
      if (closed.length >= 5) {
        found = true;
        const open = snap.pool.filter(e => e.available);
        assert.ok(open.length >= 11, 'a full choice of affordable call-ups: ' + open.length);
        assert.ok(snap.pool.length > s.rules.nations.squadSize, 'the squad was extended');
        assert.ok(
          snap.pool.findIndex(e => !e.available) > open.length - 1,
          'affordable players are listed first',
        );
      }
      const move = spender(s);
      s.pick(move.profileId, move.slot);
    }
  }
  assert.ok(found);
});

test('budget drafts are deterministic and survive serialize/restore', () => {
  const run = () => {
    const s = createDraftSession(catalog, { seed: 'budget-1', budget: true });
    for (let i = 0; i < 6; i++) {
      s.spin();
      const m = spender(s);
      s.pick(m.profileId, m.slot);
    }
    s.spin();
    return s;
  };
  const a = run(),
    b = run();
  assert.deepEqual(a.snapshot(), b.snapshot());
  const saved = JSON.parse(JSON.stringify(a.serialize()));
  assert.equal(saved.options.budget, true);
  assert.deepEqual(saved.rules.budget, DEFAULT_CONFIG.draft.budget);
  const again = restoreDraftSession(catalog, saved);
  assert.deepEqual(again.snapshot(), a.snapshot());
  finish(a, greedy);
  finish(again, greedy);
  assert.deepEqual(again.picks, a.picks);
  assertWithinBudget(again);
});
