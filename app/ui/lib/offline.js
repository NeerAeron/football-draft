// Offline play: registers app/sw.js (network first — online, every request still goes to
// the network; the cache only answers when there is none).
//
//   registerOffline(routes)   // from ui/main.js, once
//
// In a browser tab the worker just keeps what the player has used, at no extra cost. Opened
// as an installed app (display-mode standalone), the first launch warms the whole game once:
// the files loaded before the worker took control, the catalog with its flags and league
// logos, every lazy screen module and every font face — then <html data-offline-ready> is set
// and the game opens and plays without a network (~2.3 MB download, once).
// Skipped on loopback hosts (dev server, browser tests) unless the page URL has ?sw=1, which
// also forces the warm-up; and wherever service workers are unavailable (insecure origins).
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/;
// Module workers (paths relative to app/index.html): created on demand, so not in the
// performance entries of the first page. Keep in sync when a worker moves.
const WORKERS = [
  './services/sim-worker.js',
  './ui/screens/run/auto-sim-worker.js',
  './ui/screens/daily/perfect-xi-worker.js',
];
const WARMED = './__offline-ready'; // marker entry written by sw.js after a warm-up

const idle = fn => (globalThis.requestIdleCallback || (cb => setTimeout(cb, 500)))(fn);
const installed = () =>
  globalThis.matchMedia?.('(display-mode: standalone)').matches ||
  globalThis.navigator?.standalone === true;
const markReady = () => (document.documentElement.dataset.offlineReady = 'true');

/** Post `message` to the worker; resolves true when every URL was cached. */
function ask(worker, message) {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = event => resolve(event.data === 'done');
    worker.postMessage(message, [channel.port2]);
    setTimeout(() => resolve(false), 60000); // never wait forever on a busy worker
  });
}

async function warmUp(worker, routes) {
  const page = location.href.split('#')[0];
  const loaded = () => performance.getEntriesByType('resource').map(entry => entry.name);
  await document.fonts?.ready;
  await ask(worker, {
    cache: [page, ...loaded(), ...WORKERS.map(path => new URL(path, page).href)],
  });
  // Fetched through the worker now that it controls the page, so all of it gets cached:
  // every screen's module graph and every declared font face (fonts load lazily otherwise).
  await new Promise(idle);
  const settled = await Promise.allSettled([
    ...routes.filter(route => route.load).map(route => route.load()),
    ...[...(document.fonts || [])].map(face => face.load()),
  ]);
  const complete = settled.every(result => result.status === 'fulfilled');
  // Files still downloading at the first list bypassed the worker: list them again. The
  // worker records the warm-up only when everything was cached (else: again next launch).
  if ((await ask(worker, { cache: loaded(), artwork: true, done: complete })) && complete)
    markReady();
}

export function registerOffline(routes = []) {
  const sw = globalThis.navigator?.serviceWorker;
  if (!sw || !globalThis.isSecureContext) return false;
  const forced = new URLSearchParams(location.search).has('sw');
  if (LOOPBACK.test(location.hostname) && !forced) return false;
  // The worker claims open pages when it activates; until then requests bypass it.
  const controlled = () =>
    sw.controller
      ? Promise.resolve(sw.controller)
      : new Promise(resolve =>
          sw.addEventListener('controllerchange', () => resolve(sw.controller), { once: true }),
        );
  const start = async () => {
    sw.register('./sw.js').catch(() => {});
    if (!(forced || installed())) return;
    if (await globalThis.caches?.match(new URL(WARMED, location.href).href)) return markReady();
    const worker = await sw.ready.then(controlled);
    if (worker) await warmUp(worker, routes);
  };
  const begin = () => idle(() => start().catch(() => {}));
  if (document.readyState === 'complete') begin();
  else addEventListener('load', begin, { once: true });
  return true;
}
