// Player catalog loader shared by every UI: fetches app/data/catalog.v3.json once, decodes it
// (core/players/catalog-codec.js), recomputes values the live configuration invalidates and
// adds lookup Maps (byId, byNation, byLeague, byClub). The URL resolves against the page.
import { decodeCatalogSteps, indexCatalog } from '../core/players/catalog-codec.js';
import { reconcileCatalog } from '../core/players/catalog-derived.js';

export const CATALOG_URL = './data/catalog.v3.json';
const SLICE_MS = 8;
export const nextTask = () =>
  globalThis.scheduler?.yield
    ? globalThis.scheduler.yield()
    : new Promise(resolve => setTimeout(resolve, 0));
let loading = null;

/**
 * Drive one of core's step-wise builders (a generator), handing the main thread back every
 * 8 ms so taps and animation stay responsive. Resolves to the generator's return value.
 */
export async function stepped(steps) {
  let start = performance.now(),
    step = steps.next();
  while (!step.done) {
    if (performance.now() - start > SLICE_MS) {
      await nextTask();
      start = performance.now();
    }
    step = steps.next();
  }
  return step.value;
}

export function loadCatalog() {
  loading ??= fetch(CATALOG_URL)
    .then(response => {
      if (!response.ok) throw Error('Catalog unavailable');
      return response.json();
    })
    .then(async file => {
      // Decode in slices, then reconcile and index in tasks of their own: nothing here
      // blocks a tap on a phone (decoded in one go it was ~250 ms there).
      const decoded = await stepped(decodeCatalogSteps(file));
      await nextTask();
      const reconciled = reconcileCatalog(decoded);
      await nextTask();
      const catalog = indexCatalog(reconciled);
      if (catalog.players.length < 22) throw Error('Invalid catalog');
      return catalog;
    })
    .catch(error => {
      loading = null; // let a later call retry
      throw error;
    });
  return loading;
}
