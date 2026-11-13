// The Daily's perfect XI (core/competition/daily.js perfectXI) tries every re-roll
// combination of the day's spins: ~200–300 ms of best-XI assignments. Run it in a module
// Worker (which decodes its own copy of the catalog) so the main thread never blocks;
// without Worker support, or if the worker fails, compute it here.
//
//   const optimum = await perfectXIOffThread(catalog, day, { formation });
//
// The worker has no saved tuning (no localStorage), i.e. DEFAULT_CONFIG — what the Daily
// is defined on, so every device gets the same optimum.
import { perfectXI } from '../../../core/competition/daily.js';
import { CATALOG_URL } from '../../../services/catalog.js';
import { ERAS_URL } from '../../../services/eras.js';

const TIMEOUT_MS = 15000;

export function perfectXIOffThread(catalog, day, { formation } = {}) {
  const here = () => perfectXI(catalog, day, { formation });
  if (typeof Worker !== 'function' || !globalThis.location) return Promise.resolve(here());
  return new Promise(resolve => {
    let worker;
    let done = false;
    const finish = value => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker?.terminate();
      resolve(value ?? here());
    };
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);
    try {
      worker = new Worker(new URL('./perfect-xi-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => finish(data?.ok ? data.result : null);
      worker.onerror = () => finish(null);
      worker.postMessage({
        url: new URL(CATALOG_URL, globalThis.location.href).href,
        eras: new URL(ERAS_URL, globalThis.location.href).href,
        day: JSON.parse(JSON.stringify(day)),
        formation,
      });
    } catch {
      finish(null);
    }
  });
}
