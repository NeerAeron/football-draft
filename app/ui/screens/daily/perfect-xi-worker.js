// Module Worker for perfect-xi.js: decode the catalog and the era pools (URLs from the page)
// and compute the Daily's perfect XI off the main thread.
import { decodeCatalog, indexCatalog } from '../../../core/players/catalog-codec.js';
import { reconcileCatalog } from '../../../core/players/catalog-derived.js';
import { decodeEras } from '../../../core/players/eras-codec.js';
import { attachEras } from '../../../core/players/eras.js';
import { perfectXI } from '../../../core/competition/daily.js';

self.onmessage = async ({ data }) => {
  try {
    const [response, eras] = await Promise.all([fetch(data.url), fetch(data.eras)]);
    if (!response.ok || !eras.ok) throw Error('Catalog unavailable');
    const catalog = attachEras(
      indexCatalog(reconcileCatalog(decodeCatalog(await response.json()))),
      decodeEras(await eras.json()),
    );
    const result = perfectXI(catalog, data.day, { formation: data.formation });
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({ ok: false, error: String(error?.message || error) });
  }
};
