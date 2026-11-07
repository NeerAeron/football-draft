// Module Worker for perfect-xi.js: decode the catalog (URL from the page) and compute the
// Daily's perfect XI off the main thread.
import { decodeCatalog, indexCatalog } from '../../../core/players/catalog-codec.js';
import { reconcileCatalog } from '../../../core/players/catalog-derived.js';
import { perfectXI } from '../../../core/competition/daily.js';

self.onmessage = async ({ data }) => {
  try {
    const response = await fetch(data.url);
    if (!response.ok) throw Error('Catalog unavailable');
    const catalog = indexCatalog(reconcileCatalog(decodeCatalog(await response.json())));
    const result = perfectXI(catalog, data.day, { formation: data.formation });
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({ ok: false, error: String(error?.message || error) });
  }
};
