import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Draft } from '../app/draft.js';
import { createAIOpponent } from '../app/ai.js';
import { playerTier, overallRating } from '../app/ratings.js';
import { createBudgetConfirmation } from '../app/budget-confirmation.js';

const catalog = JSON.parse(
  readFileSync(new URL('../app/data/players-runtime.json', import.meta.url)),
);
const random = seed => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const opponent = createAIOpponent(catalog, 'veryeasy', random(31));
const setup = () => new Draft(catalog, { opponent: opponent.players, funding: 'budget', seed: 43 });
const pool = (d, tier) =>
  catalog.players.filter(
    p => p.primaryPosition !== 'GK' && playerTier(p).name === tier && !d.used.has(p.profileId),
  );
function seedPick(d, p, slot) {
  d.picks[0][slot] = structuredClone(p);
  d.used.add(p.profileId);
}
function show(d, p) {
  d.league = d.leagues.find(l => l.id === p.source.leagueId);
  d.club = d.league.teams.find(t => t.id === p.source.clubId);
}

test('a fourth Star needs confirmation to spend a Superstar ticket, and keeps its original tier', () => {
  const d = setup(),
    stars = pool(d, 'Star').slice(0, 4);
  stars.slice(0, 3).forEach((p, i) => seedPick(d, p, i + 1));
  const p = stars[3];
  show(d, p);
  assert.deepEqual(d.budgetOffer(p), {
    playerGroup: 'star',
    slotGroup: 'superstar',
    requiresConfirmation: true,
  });
  const before = {
      rng: d.rng,
      used: [...d.used],
      slots: [...d.budgetSlots],
      history: [...d.history],
    },
    slot = d.bestSlot(p);
  assert.ok(d.available().includes(p));
  assert.equal(d.pick(slot, p.profileId), false);
  assert.equal(d.pick(slot, p.profileId, { confirmedBudgetSlot: 'star' }), false);
  assert.deepEqual(
    { rng: d.rng, used: [...d.used], slots: [...d.budgetSlots], history: [...d.history] },
    before,
  );
  assert.ok(d.pick(slot, p.profileId, { confirmedBudgetSlot: 'superstar' }));
  assert.equal(d.budgetState().used.superstar, 1);
  assert.equal(d.budgetState().counts.star, 4);
  assert.equal(playerTier(d.picks[0][slot]).name, 'Star');
  assert.equal(
    overallRating(d.picks[0][slot], true, p.primaryPosition),
    overallRating(p, true, p.primaryPosition),
  );
  assert.deepEqual(d.picks[0][slot].tags, p.tags);
  const supers = pool(d, 'Superstar');
  show(d, supers[0]);
  assert.ok(d.pick(d.bestSlot(supers[0]), supers[0].profileId));
  assert.equal(d.budgetAvailable(supers[1]), false);
  assert.equal(d.budgetState().used.superstar, 2);
});
test('own tickets are used first, then the closest higher tier; Normal and Bench share tickets', () => {
  const d = setup(),
    starters = pool(d, 'Starter').slice(0, 5);
  assert.deepEqual(d.budgetOffer(starters[0]), {
    playerGroup: 'starter',
    slotGroup: 'starter',
    requiresConfirmation: false,
  });
  starters.slice(0, 3).forEach((p, i) => seedPick(d, p, i + 1));
  assert.equal(d.budgetOffer(starters[3]).slotGroup, 'star');
  show(d, starters[3]);
  assert.ok(
    d.pick(d.bestSlot(starters[3]), starters[3].profileId, { confirmedBudgetSlot: 'star' }),
  );
  assert.equal(d.budgetState().used.star, 1);
  assert.equal(d.budgetState().counts.star, 0);
  const lower = setup(),
    normals = pool(lower, 'Normal').slice(0, 2),
    bench = pool(lower, 'Bench').slice(0, 2);
  [normals[0], normals[1], bench[0]].forEach((p, i) => seedPick(lower, p, i + 1));
  assert.deepEqual(lower.budgetOffer(bench[1]), {
    playerGroup: 'lower',
    slotGroup: 'starter',
    requiresConfirmation: true,
  });
  lower.funding = 'takeover';
  assert.equal(lower.budgetOffer(bench[1]).requiresConfirmation, false);
  const pvp = new Draft(catalog);
  assert.equal(pvp.budgetOffer(bench[1]).requiresConfirmation, false);
});
test('borrowing a higher ticket cannot strand the only remaining goalkeeper', () => {
  const base = setup(),
    keeper = catalog.players.find(
      p =>
        p.primaryPosition === 'GK' &&
        playerTier(p).name === 'Superstar' &&
        !base.used.has(p.profileId),
    );
  const data = {
      ...catalog,
      players: catalog.players.filter(
        p => p.primaryPosition !== 'GK' || p.profileId === keeper.profileId,
      ),
    },
    d = new Draft(data, { opponent: opponent.players, funding: 'budget', seed: 17 });
  const picked = [
    ...pool(d, 'Superstar').slice(0, 1),
    ...pool(d, 'Star').slice(0, 3),
    ...pool(d, 'Starter').slice(0, 3),
    ...pool(d, 'Normal').slice(0, 2),
  ];
  picked.forEach((p, i) => seedPick(d, p, i + 2));
  const starter = pool(d, 'Starter')[0],
    normal = pool(d, 'Normal')[0];
  assert.equal(d.budgetOffer(starter), null, 'the last Superstar ticket is needed by the keeper');
  assert.equal(d.budgetOffer(normal).slotGroup, 'lower');
  show(d, normal);
  assert.ok(d.pick(d.bestSlot(normal), normal.profileId));
  show(d, keeper);
  assert.ok(d.pick(0, keeper.profileId));
  assert.ok(d.complete);
});
test('spending a Superstar ticket on a cheaper player stops an unneeded Superstar guarantee', () => {
  const d = setup(),
    stars = pool(d, 'Star').slice(0, 5);
  stars.slice(0, 3).forEach((p, i) => seedPick(d, p, i + 1));
  for (const p of stars.slice(3)) {
    show(d, p);
    assert.ok(d.pick(d.bestSlot(p), p.profileId, { confirmedBudgetSlot: 'superstar' }));
  }
  assert.equal(d.budgetState().counts.superstar, 0);
  assert.equal(d.budgetState().used.superstar, 2);
  assert.ok(!d.revealNeeds().some(([tier]) => tier === 'superstar'));
});
function dialogFixture() {
  const dialog = new EventTarget();
  dialog.open = false;
  dialog.returnValue = '';
  dialog.showModal = () => {
    dialog.open = true;
  };
  dialog.close = value => {
    dialog.open = false;
    dialog.returnValue = value;
    queueMicrotask(() => dialog.dispatchEvent(new Event('close')));
  };
  return { dialog, controller: createBudgetConfirmation(dialog) };
}
test('confirmation accepts only an explicit confirm; Cancel and Escape leave the choice unaccepted', async () => {
  const { dialog, controller } = dialogFixture();
  let pending = controller.request();
  dialog.close('confirm');
  assert.equal(await pending, true);
  pending = controller.request();
  assert.equal(dialog.returnValue, 'cancel');
  dialog.close('cancel');
  assert.equal(await pending, false);
  pending = controller.request();
  dialog.dispatchEvent(new Event('cancel'));
  dialog.close(dialog.returnValue);
  assert.equal(await pending, false);
});
test('double clicks cannot replace a pending confirmation; navigating away cancels even a queued acceptance', async () => {
  const { dialog, controller } = dialogFixture(),
    pending = controller.request();
  assert.equal(await controller.request(), false);
  assert.ok(controller.active);
  dialog.close('confirm');
  controller.cancel();
  assert.equal(await pending, false);
  assert.equal(controller.active, false);
  const next = controller.request();
  controller.cancel();
  assert.equal(await next, false);
});
