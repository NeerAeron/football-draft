// Offline play: registers app/sw.js (network first — online, every request still goes to
// the network; the cache only answers when there is none).
//
//   registerOffline(routes)   // from ui/main.js, once
//
// In a browser tab the worker just keeps what the player has used, at no extra cost. Opened
// as an installed app (display-mode standalone), a launch asks the worker whether it holds a
// complete copy of the deployed build (app/build.json, written by the deploy). If not — the
// first launch, or the first one after a deploy — it warms the whole game: the files loaded
// before the worker took control, the catalog with its flags and league logos, every lazy
// screen module and stylesheet and every font face. Then <html data-offline-ready> is set and the game opens
// and plays without a network (~2.3 MB download, once per deploy). The previous complete copy
// keeps answering offline until the new one is whole (see sw.js).
// Skipped on loopback hosts (dev server, browser tests) unless the page URL has ?sw=1, which
// also forces the warm-up; and wherever service workers are unavailable (insecure origins).
import { loadStyles } from './styles.js';

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/;
// Module workers (paths relative to app/index.html): created on demand, so not in the
// performance entries of the first page. Keep in sync when a worker moves.
const WORKERS = [
  './services/sim-worker.js',
  './ui/screens/run/auto-sim-worker.js',
  './ui/screens/daily/perfect-xi-worker.js',
];
// Data fetched on demand (the Legends and Prime versions, the era pools: first when a draft
// starts).
const DATA = ['./data/legends.v1.json', './data/eras.v1.json'];

const idle = fn => (globalThis.requestIdleCallback || (cb => setTimeout(cb, 500)))(fn);
const installed = () =>
  globalThis.matchMedia?.('(display-mode: standalone)').matches ||
  globalThis.navigator?.standalone === true;
const markReady = () => (document.documentElement.dataset.offlineReady = 'true');

/** Post `message` to the worker; resolves with its answer (null if none came in time). */
function ask(worker, message, patience = 60000) {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = event => resolve(event.data);
    worker.postMessage(message, [channel.port2]);
    setTimeout(() => resolve(null), patience); // never wait forever on a busy worker
  });
}

/** Cache the whole game as `build`; true when the worker recorded a complete copy. */
async function warmUp(worker, routes, build) {
  const page = location.href.split('#')[0];
  const loaded = () => performance.getEntriesByType('resource').map(entry => entry.name);
  await document.fonts?.ready;
  await ask(worker, {
    build,
    cache: [page, ...loaded(), ...[...WORKERS, ...DATA].map(path => new URL(path, page).href)],
  });
  // Fetched through the worker now that it controls the page, so all of it gets cached:
  // every screen's module graph and stylesheets and every declared font face (fonts load
  // lazily otherwise).
  await new Promise(idle);
  const settled = await Promise.allSettled([
    ...routes.filter(route => route.load).map(route => route.load()),
    ...routes.map(route => loadStyles(route.styles)),
    ...[...(document.fonts || [])].map(face => face.load()),
  ]);
  const failed = settled.some(result => result.status === 'rejected');
  // Files still downloading at the first list bypassed the worker: list them again. The
  // worker records the copy as complete only when everything was cached (else: again at the
  // next launch).
  const answer = await ask(worker, { build, cache: loaded(), artwork: true, done: true, failed });
  return answer === 'done';
}

export function registerOffline(routes = []) {
  const sw = globalThis.navigator?.serviceWorker;
  if (!sw || !globalThis.isSecureContext) return false;
  const forced = new URLSearchParams(location.search).has('sw');
  if (LOOPBACK.test(location.hostname) && !forced) return false;
  // Ask the controlling worker about its copy and warm it if it is not this build's. Runs
  // again when another worker takes control (the first install; an updated sw.js, whose
  // predecessor does not answer): only the latest run goes on.
  let run = 0;
  const check = async () => {
    const id = ++run,
      worker = sw.controller;
    if (!worker) return;
    const state = await ask(worker, { status: true }, 15000);
    if (id !== run || !state) return;
    if (state.ready) return markReady();
    // Without a network (no build) there is nothing to warm.
    if (state.build && (await warmUp(worker, routes, state.build)) && id === run) markReady();
  };
  const start = () => {
    sw.register('./sw.js').catch(() => {});
    if (!(forced || installed())) return;
    // The worker claims open pages when it activates; until then requests bypass it.
    sw.addEventListener('controllerchange', () => check().catch(() => {}));
    check().catch(() => {});
  };
  const begin = () => idle(start);
  if (document.readyState === 'complete') begin();
  else addEventListener('load', begin, { once: true });
  return true;
}
