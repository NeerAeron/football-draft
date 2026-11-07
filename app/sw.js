// Service worker: offline play (registered by ui/lib/offline.js).
//
// Network first: online, every request goes to the network exactly as without this worker
// (nothing is ever served stale) and a copy of each successful same-origin GET is kept in one
// cache. Without a network, requests are answered from that cache, and page loads fall back
// to the cached app shell. So whatever a player has used works offline afterwards.
//
// The installed app also asks for a one-time warm-up (message below): the files its first
// page loaded before this worker existed, the catalog and its flags and league logos. The
// page itself loads every screen module and font through the worker, then sends `done`.
//
// No version list to maintain: the cache holds whatever the app fetched, keyed by URL, and is
// refreshed by every online request (unchanged files — same ETag — are not rewritten).
const CACHE = 'football-draft-offline-v1';
const here = path => new URL(path, self.location.href).href;
const SHELL = here('./');
const CATALOG = here('./data/catalog.v3.json');
// Marker entry: the warm-up finished (ui/lib/offline.js checks it with caches.match).
const WARMED = here('./__offline-ready');

const sameOrigin = url => {
  try {
    return new URL(url, self.location.href).origin === self.location.origin;
  } catch {
    return false;
  }
};
// Never cache endless streams (the dev server's live reload) or partial responses.
const cacheable = request =>
  request.method === 'GET' &&
  sameOrigin(request.url) &&
  !request.headers.has('range') &&
  !(request.headers.get('accept') || '').includes('text/event-stream') &&
  !new URL(request.url).pathname.endsWith('/__live');
const version = response =>
  response?.headers.get('etag') || response?.headers.get('last-modified') || null;

async function store(cache, key, response) {
  if (response.status !== 200 || response.type !== 'basic') return;
  const old = await cache.match(key);
  if (old && version(old) && version(old) === version(response)) return;
  await cache.put(key, response);
}

async function fetchAndStore(url) {
  const cache = await self.caches.open(CACHE);
  if (await cache.match(url)) return;
  await store(cache, url, await fetch(url));
}

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(fetchAndStore(SHELL).catch(() => {}));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      for (const name of await self.caches.keys())
        if (name.startsWith('football-draft-offline-') && name !== CACHE)
          await self.caches.delete(name);
      // Page loads start downloading while the worker boots (no added latency).
      await self.registration.navigationPreload?.enable().catch(() => {});
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (!cacheable(request)) return;
  // A DevTools quirk: only-if-cached requests outside same-origin mode must not be handled.
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;
  const network = async () =>
    (request.mode === 'navigate' && (await event.preloadResponse)) || fetch(request);
  event.respondWith(
    network().then(
      response => {
        const copy = response.clone();
        event.waitUntil(
          self.caches
            .open(CACHE)
            .then(cache => store(cache, request, copy))
            .catch(() => {}),
        );
        return response;
      },
      async error => {
        const hit = await self.caches.match(request, { ignoreVary: true });
        if (hit) return hit;
        if (request.mode === 'navigate') {
          const shell = await self.caches.match(SHELL);
          if (shell) return shell;
        }
        throw error;
      },
    ),
  );
});

// Every flag and league logo the catalog refers to (plain './assets/…' strings in the file).
async function catalogArtwork() {
  const response = await self.caches.match(CATALOG);
  if (!response?.ok) return [];
  const paths = (await response.text()).match(/\.\/assets\/(?:flags|logos)\/[\w.-]+\.(?:svg|png)/g);
  return [...new Set(paths || [])].map(here);
}

// Warm-up messages from the page; each is answered with 'done' on its port, if any, once
// every URL was tried:
//   { cache: [url, …] }   cache these (already cached ones are skipped) and the catalog
//   { artwork: true }     cache the catalog's flags and league logos
//   { done: true }        record the warm-up as finished (only if every URL was cached)
self.addEventListener('message', event => {
  const { cache, artwork = false, done = false } = event.data || {};
  if (!Array.isArray(cache) && !artwork && !done) return;
  event.waitUntil(
    (async () => {
      const urls = Array.isArray(cache) ? [...cache, CATALOG] : [];
      const art = artwork ? await catalogArtwork() : [];
      const wanted = [...new Set([...urls, ...art])].filter(
        url => typeof url === 'string' && sameOrigin(url) && !url.includes('/__live'),
      );
      const results = await Promise.allSettled(wanted.map(fetchAndStore));
      const complete = results.every(r => r.status === 'fulfilled') && (!artwork || art.length > 0);
      if (done && complete) await (await self.caches.open(CACHE)).put(WARMED, new Response('ok'));
      event.ports?.[0]?.postMessage(complete ? 'done' : 'partial');
    })(),
  );
});
