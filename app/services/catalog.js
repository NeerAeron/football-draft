// Player catalog loader shared by every UI: fetches app/data/catalog.v3.json once, decodes it
// (core/players/catalog-codec.js), recomputes values the live configuration invalidates and
// adds lookup Maps (byId, byNation, byLeague, byClub). The URL resolves against the page.
import { decodeCatalog, indexCatalog } from '../core/players/catalog-codec.js';
import { reconcileCatalog } from '../core/players/catalog-derived.js';

export const CATALOG_URL = './data/catalog.v3.json';
const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));
let loading = null;

export function loadCatalog() {
  loading ??= fetch(CATALOG_URL)
    .then(response => {
      if (!response.ok) throw Error('Catalog unavailable');
      return response.json();
    })
    .then(async file => {
      // Decode, reconcile and index in separate tasks: each stays well under the 50–200 ms
      // that would block a tap on a phone (one block was ~200 ms on a laptop).
      const decoded = decodeCatalog(file);
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
