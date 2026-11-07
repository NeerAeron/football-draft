// Catalog warm-up in small main-thread slices. The first draft-related call on a fresh
// catalog (core/draft/pools.js catalogIndex: nation fields, best XIs, league/club pools)
// computes thousands of role ratings in one synchronous block — 300–500 ms on a laptop,
// seconds on a phone. Ratings are cached per player (pools.js), so filling that cache in
// ≤ 8 ms slices first turns the index into a short task and keeps taps responsive.
//
//   await warmCatalog(catalog);   // idempotent per catalog; resolves when catalogIndex is built
//   await loadWarmCatalog();      // loadCatalog() + warmCatalog(): what draft/run screens use
//
// Only reads through core's public, cached rating functions — results are identical to a
// cold build (same functions, same cache), so draft/match determinism is untouched.
import {
  ROLES,
  naturalRating,
  roleRating,
  roleFit,
  isKeeper,
  catalogIndex,
} from '../../core/draft/pools.js';
import { opponentCandidates } from '../../core/draft/opponents.js';
import { loadCatalog } from '../../services/catalog.js';

const SLICE_MS = 8;
// Mirrors pools.js candidates(): only a nation's best 80 outfielders and 5 keepers can make
// its best XI, so their per-role ratings are the ones the index needs.
const HEAD_OUTFIELD = 80;
const HEAD_KEEPERS = 5;

const OUTFIELD = ROLES.filter(r => r !== 'GK');
const warmed = new WeakMap();

const yieldToMain = () =>
  globalThis.scheduler?.yield
    ? globalThis.scheduler.yield()
    : new Promise(resolve => setTimeout(resolve, 0));

/** Run `work(item)` over `items`, yielding to the main thread every SLICE_MS. */
async function sliced(items, work) {
  let start = performance.now();
  for (let i = 0; i < items.length; i++) {
    work(items[i]);
    if ((i & 31) === 31 && performance.now() - start > SLICE_MS) {
      await yieldToMain();
      start = performance.now();
    }
  }
}

/** Fill the rating cache in slices, then build the draft index. Resolves to the catalog. */
export function warmCatalog(catalog) {
  if (!catalog?.players) return Promise.resolve(catalog);
  let job = warmed.get(catalog);
  if (job) return job;
  job = (async () => {
    const players = catalog.players;
    await sliced(players, naturalRating);
    const byNation = new Map();
    for (const p of players) {
      const name = p.source?.nationality;
      if (!name) continue;
      if (!byNation.has(name)) byNation.set(name, []);
      byNation.get(name).push(p);
    }
    const head = [];
    for (const members of byNation.values()) {
      members.sort((a, b) => naturalRating(b) - naturalRating(a));
      head.push(
        ...members.filter(p => !isKeeper(p)).slice(0, HEAD_OUTFIELD),
        ...members.filter(isKeeper).slice(0, HEAD_KEEPERS),
      );
    }
    await yieldToMain();
    await sliced(head, p => {
      if (isKeeper(p)) roleRating(p, 'GK');
      else
        for (const role of OUTFIELD) {
          roleFit(p, role);
          roleRating(p, role);
        }
    });
    await yieldToMain();
    catalogIndex(catalog);
    await yieldToMain();
    return catalog;
  })().catch(error => {
    warmed.delete(catalog);
    throw error;
  });
  warmed.set(catalog, job);
  return job;
}

const opponents = new WeakMap();
/**
 * Every club/nation XI the opponent ladder and the cup draw choose from (core
 * opponentCandidates, cached by core): ~170 ms once, in a task of its own. Await it before
 * creating a run so that work is not added to the run screen's first render.
 */
export function warmOpponents(catalog) {
  if (!catalog?.players) return Promise.resolve(catalog);
  let job = opponents.get(catalog);
  if (!job) {
    job = warmCatalog(catalog)
      .then(yieldToMain)
      .then(() => opponentCandidates(catalog))
      // Resolve in a fresh task: the caller's next step (a render) must not join this one.
      .then(yieldToMain)
      .then(() => catalog);
    opponents.set(catalog, job);
  }
  return job;
}

/**
 * loadCatalog() then warmCatalog(): the catalog, ready for drafts. The opponent list warms
 * up afterwards when the browser is idle (runs, quick-match opponents, exhibition).
 */
export const loadWarmCatalog = () =>
  loadCatalog()
    .then(warmCatalog)
    .then(catalog => {
      const idle = globalThis.requestIdleCallback || (fn => setTimeout(fn, 200));
      idle(() => warmOpponents(catalog).catch(() => {}));
      return catalog;
    });
