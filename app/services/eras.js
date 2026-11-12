// Era pools loader: fetches app/data/eras.v1.json once (only when a draft or a run needs it —
// never on Home), decodes it (core/players/eras-codec.js) and attaches it to the catalog as
// `catalog.eras` (core/players/eras.js). One file for all eras: a draft spins an era per pick
// and its session is synchronous. The URL resolves against the page.
import { decodeErasSteps } from '../core/players/eras-codec.js';
import { attachErasSteps } from '../core/players/eras.js';
import { loadCatalog, stepped } from './catalog.js';

export const ERAS_URL = './data/eras.v1.json';
let loading = null;

/** The catalog with `catalog.eras` attached (the same catalog object loadCatalog gives). */
export function loadEras() {
  loading ??= Promise.all([
    loadCatalog(),
    fetch(ERAS_URL).then(response => {
      if (!response.ok) throw Error('Eras unavailable');
      return response.json();
    }),
  ])
    .then(async ([catalog, file]) => {
      // In slices: decoding and attaching 12,000 cards is ~250 ms of work on a laptop, far
      // too long for one task on a phone.
      const data = await stepped(decodeErasSteps(file));
      return stepped(attachErasSteps(catalog, data));
    })
    .catch(error => {
      loading = null; // let a later call retry
      throw error;
    });
  return loading;
}
