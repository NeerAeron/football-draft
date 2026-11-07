// Player catalog loader shared by every UI: fetches app/data/catalog.v3.json once, decodes it
// (core/players/catalog-codec.js), recomputes values the live configuration invalidates and
// adds lookup Maps (byId, byNation, byLeague, byClub). The URL resolves against the page.
import { decodeCatalog, indexCatalog } from '../core/players/catalog-codec.js';
import { reconcileCatalog } from '../core/players/catalog-derived.js';

export const CATALOG_URL = './data/catalog.v3.json';
let loading = null;

export function loadCatalog() {
  loading ??= fetch(CATALOG_URL)
    .then(response => {
      if (!response.ok) throw Error('Catalog unavailable');
      return response.json();
    })
    .then(file => {
      const catalog = indexCatalog(reconcileCatalog(decodeCatalog(file)));
      if (catalog.players.length < 22) throw Error('Invalid catalog');
      return catalog;
    })
    .catch(error => {
      loading = null; // let a later call retry
      throw error;
    });
  return loading;
}
