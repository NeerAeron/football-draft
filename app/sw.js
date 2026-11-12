// Service worker: offline play (registered by ui/lib/offline.js).
//
// Network first: online, every request goes to the network exactly as without this worker
// (nothing is ever served stale) and a copy of each successful same-origin GET is kept.
// Without a network, requests are answered from those copies, and page loads fall back to the
// cached app shell. So whatever a player has used works offline afterwards.
//
// One cache per build. ./build.json holds the build stamp: the deploy writes the commit there
// (.github/workflows/ci.yml); the checked-in file says "dev". The worker reads it at every
// page load and keeps what it fetches in that build's cache, so a deploy never leaves old and
// new files mixed in one copy.
//
// The installed app also asks for a warm-up of every new build (messages below): the files its
// page has loaded, the catalog with its flags and league logos, and — through this worker —
// every screen module, stylesheet and font. When all of it has been fetched fresh the cache is
// marked complete and the older caches are deleted. Until then the last complete copy stays
// and answers first offline: the working game is never thrown away for an unfinished one.
const PREFIX = 'football-draft-offline-';
// The stamp of a copy nobody stamped (the dev server, a host that publishes app/ as it is).
const UNSTAMPED = 'dev';
const here = path => new URL(path, self.location.href).href;
const SHELL = here('./');
const BUILD = here('./build.json');
const CATALOG = here('./data/catalog.v3.json');
// Marker entry of a complete cache (ui/lib/offline.js learns of it through `status`).
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

// The deployed build: a promise of its stamp, or of null without a network. Read again at
// every page load, so a deploy is noticed the next time the game is opened.
let build = null;
function readBuild() {
  const reading = fetch(BUILD, { cache: 'no-store' })
    .then(response => (response.ok ? response.json() : {}))
    .then(
      data => (/^[\w.-]{1,64}$/.test(data?.build) ? data.build : UNSTAMPED),
      () => null,
    );
  build = reading;
  reading.then(stamp => stamp && prune(stamp)).catch(() => {});
  return reading;
}
const currentBuild = () => build || readBuild();

// Every cache of the game, newest first, with whether it is a complete copy.
async function copies() {
  const names = (await self.caches.keys()).filter(name => name.startsWith(PREFIX)).reverse();
  return Promise.all(
    names.map(async name => {
      const cache = await self.caches.open(name);
      return { name, cache, complete: !!(await cache.match(WARMED)) };
    }),
  );
}

// Old copies go once the current build's copy is complete. Until then one of them stays as
// the offline fallback: the newest complete one, else the newest.
async function prune(stamp) {
  const all = await copies(),
    others = all.filter(copy => copy.name !== PREFIX + stamp),
    current = all.find(copy => copy.name === PREFIX + stamp),
    keep = current?.complete ? null : others.find(copy => copy.complete) || others[0];
  await Promise.all(
    others.filter(copy => copy !== keep).map(copy => self.caches.delete(copy.name)),
  );
}

// Offline: a complete copy answers first (one build, whole), then the newer partial ones.
async function lookup(request) {
  const all = await copies();
  for (const { cache } of [...all.filter(c => c.complete), ...all.filter(c => !c.complete)]) {
    const hit = await cache.match(request, { ignoreVary: true });
    if (hit) return hit;
  }
  return undefined;
}

// Keep a response in the build's cache. A file that did not change (same ETag) is not
// rewritten, and the complete copy of a stamped build is a snapshot: files are added to it,
// never replaced (what arrives later may already belong to the next deploy).
async function store(stamp, key, response) {
  if (response.status !== 200 || response.type !== 'basic') return;
  const cache = await self.caches.open(PREFIX + stamp),
    old = await cache.match(key);
  if (old) {
    if (version(old) && version(old) === version(response)) return;
    if (stamp !== UNSTAMPED && (await cache.match(WARMED))) return;
  }
  await cache.put(key, response);
}

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    readBuild()
      .then(async stamp => stamp && store(stamp, SHELL, await fetch(SHELL)))
      .catch(() => {}),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      // Page loads start downloading while the worker boots (no added latency).
      await self.registration.navigationPreload?.enable().catch(() => {});
      await self.clients.claim();
    })(),
  );
});

// The warm-up in progress: its build, and the URLs fetched fresh for it (past the HTTP
// cache, which may still hold the previous deploy's files). Lost when the worker restarts:
// the warm-up then checks everything again.
let warming = null;
const fresh = new Set();

self.addEventListener('fetch', event => {
  const { request } = event;
  if (!cacheable(request)) return;
  // A DevTools quirk: only-if-cached requests outside same-origin mode must not be handled.
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;
  const page = request.mode === 'navigate';
  if (page) readBuild();
  const reading = currentBuild(),
    revalidate = !page && warming !== null;
  const network = async () =>
    (page && (await event.preloadResponse)) ||
    fetch(request, revalidate ? { cache: 'no-cache' } : undefined);
  event.respondWith(
    network().then(
      response => {
        const copy = response.clone();
        event.waitUntil(
          (async () => {
            // The network answered: if the stamp could not be read before, it can be now.
            const stamp = (await reading) || (await (build === reading ? readBuild() : build));
            if (!stamp) return;
            await store(stamp, request, copy);
            if (revalidate && stamp === warming) fresh.add(request.url);
          })().catch(() => {}),
        );
        return response;
      },
      async error => {
        const hit = (await lookup(request)) || (page && (await lookup(SHELL)));
        if (hit) return hit;
        throw error;
      },
    ),
  );
});

// Fetch `url` past the HTTP cache into the build's cache, once per warm-up.
async function fetchFresh(stamp, url) {
  if (fresh.has(url)) return;
  const response = await fetch(url, { cache: 'no-cache' });
  if (response.status >= 500) throw Error(`${response.status} for ${url}`);
  if (response.status === 404) await (await self.caches.open(PREFIX + stamp)).delete(url);
  else await store(stamp, url, response);
  fresh.add(url);
}

// Every flag and league logo the catalog refers to (plain './assets/…' strings in the file).
async function catalogArtwork(stamp) {
  const response = await (await self.caches.open(PREFIX + stamp)).match(CATALOG);
  if (!response?.ok) return [];
  const paths = (await response.text()).match(/\.\/assets\/(?:flags|logos)\/[\w.-]+\.(?:svg|png)/g);
  return [...new Set(paths || [])].map(here);
}

async function warm(stamp, { cache, artwork = false, done = false, failed = false }) {
  // Only the build that is deployed now can be warmed (the page asked for an older one if a
  // deploy landed meanwhile: it starts again at its next launch).
  if (!stamp || (await currentBuild()) !== stamp) return false;
  if (warming !== stamp) fresh.clear();
  warming = stamp;
  try {
    return await warmStep(stamp, { cache, artwork, done, failed });
  } finally {
    if (done) {
      warming = null;
      fresh.clear();
    }
  }
}

async function warmStep(stamp, { cache, artwork, done, failed }) {
  const settled = async urls =>
    (await Promise.allSettled(urls.map(url => fetchFresh(stamp, url)))).every(
      result => result.status === 'fulfilled',
    );
  const listed = Array.isArray(cache) ? [...cache, SHELL, CATALOG] : [];
  let complete = await settled(
    [...new Set(listed)].filter(
      url => typeof url === 'string' && sameOrigin(url) && !url.includes('/__live'),
    ),
  );
  if (artwork) {
    const art = await catalogArtwork(stamp);
    complete = (await settled(art)) && art.length > 0 && complete;
  }
  if (!done || !complete || failed) return complete && !failed;
  // Whatever else this cache holds (kept by the fetch handler before the warm-up began) is
  // checked against the server too, so the whole copy is this build's.
  const copy = await self.caches.open(PREFIX + stamp),
    rest = (await copy.keys()).map(request => request.url).filter(url => url !== WARMED);
  if (!(await settled(rest))) return false;
  await copy.put(WARMED, new Response(stamp));
  await prune(stamp);
  return true;
}

// The state of the offline copy: the deployed build (null without a network) and whether a
// complete copy of it — offline: of any build — is cached.
async function status() {
  const stamp = (await currentBuild()) || (await readBuild()),
    all = await copies();
  return {
    build: stamp,
    ready: all.some(copy => copy.complete && (!stamp || copy.name === PREFIX + stamp)),
  };
}

// Messages from the page (ui/lib/offline.js); each is answered on its port, if any:
//   { status: true }                        → { build, ready }
//   { build, cache: [url, …] }              fetch these and the catalog into the build's cache
//   { build, artwork: true }                … and the catalog's flags and league logos
//   { build, done: true, failed }           the last one: … and, unless the page failed to load
//                                           something, mark the cache complete and drop the
//                                           older ones
// The last three answer 'done' when everything asked for was cached, else 'partial'.
self.addEventListener('message', event => {
  const message = event.data || {};
  const reply = answer => event.ports?.[0]?.postMessage(answer);
  if (message.status) return event.waitUntil(status().then(reply));
  if (!Array.isArray(message.cache) && !message.artwork && !message.done) return;
  event.waitUntil(
    warm(message.build, message).then(
      complete => reply(complete ? 'done' : 'partial'),
      () => reply('partial'),
    ),
  );
});
