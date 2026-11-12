// Legends and Prime versions loader: fetches app/data/legends.v1.json once (only when a draft
// or a run needs it — never on Home), decodes it (core/players/legends-codec.js) and attaches
// it to the catalog as `catalog.legends` (core/players/legends.js). The URL resolves against
// the page.
import { decodeLegends } from '../core/players/legends-codec.js';
import { attachLegends } from '../core/players/legends.js';
import { loadCatalog } from './catalog.js';

export const LEGENDS_URL = './data/legends.v1.json';
let loading = null;

/** The catalog with `catalog.legends` attached (the same catalog object loadCatalog gives). */
export function loadLegends() {
  loading ??= Promise.all([
    loadCatalog(),
    fetch(LEGENDS_URL).then(response => {
      if (!response.ok) throw Error('Legends unavailable');
      return response.json();
    }),
  ])
    .then(async ([catalog, file]) => {
      // A task of its own: the decode (~2,600 players) is a few milliseconds on a laptop.
      await new Promise(resolve => setTimeout(resolve, 0));
      return attachLegends(catalog, decodeLegends(file));
    })
    .catch(error => {
      loading = null; // let a later call retry
      throw error;
    });
  return loading;
}
