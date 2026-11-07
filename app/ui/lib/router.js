// Hash router: '#/play/run?type=nations' → { path: '/play/run', params: { mode: 'run' },
// query: { type: 'nations' } }. Hash URLs work on static hosting (GitHub Pages) and keep
// the browser back button working. The route table lives in app/ui/routes.js.
//
//   startRouter(routes)                 // once, from the shell
//   const route = useRoute();           // { path, params, query, route, direction, depth }
//   navigate('/settings');              // push;  navigate('/', { replace: true })
//   href('/play/:mode', { mode: 'run' }, { type: 'nations' }) → '#/play/run?type=nations'
//   back('/')                           // history back when we came from inside the app
import { createStore, useStore } from './store.js';

let table = [];
const visited = []; // in-app stack of paths, for direction + back()
let replacing = false;

export function parseHash(hash = globalThis.location?.hash || '') {
  const raw = hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart = ''] = raw.split('?');
  const path = '/' + pathPart.replace(/^\/+|\/+$/g, '');
  const query = Object.fromEntries(new URLSearchParams(queryPart));
  return { path, query };
}

/** Match '/play/:mode' against '/play/run' → { mode: 'run' } (or null). '*' matches anything. */
export function matchPath(pattern, path) {
  if (pattern === '*') return {};
  const want = pattern.split('/').filter(Boolean);
  const have = path.split('/').filter(Boolean);
  if (want.length !== have.length) return null;
  const params = {};
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(':')) params[want[i].slice(1)] = decodeURIComponent(have[i]);
    else if (want[i] !== have[i]) return null;
  }
  return params;
}

export function resolveRoute(routes, path) {
  for (const route of routes) {
    const params = matchPath(route.path, path);
    if (params) return { route, params };
  }
  return { route: null, params: {} };
}

/** Build a hash href. href('/play/:mode', { mode: 'run' }, { type: 'nations' }). */
export function href(pattern, params = {}, query = {}) {
  const path = pattern.replace(/:([A-Za-z_]\w*)/g, (_, k) => encodeURIComponent(params[k] ?? ''));
  const entries = Object.entries(query).filter(([, v]) => v != null && v !== '');
  const search = entries.length ? `?${new URLSearchParams(entries)}` : '';
  return `#${path}${search}`;
}

function snapshot(direction = 'forward') {
  const { path, query } = parseHash();
  const { route, params } = resolveRoute(table, path);
  return { path, query, params, route, direction, depth: visited.length };
}

export const routeStore = createStore({
  path: '/',
  query: {},
  params: {},
  route: null,
  direction: 'forward',
  depth: 0,
});

function onHashChange() {
  const { path, query } = parseHash();
  const full = path + (Object.keys(query).length ? `?${new URLSearchParams(query)}` : '');
  let direction = 'forward';
  if (replacing) {
    replacing = false;
    visited[Math.max(0, visited.length - 1)] = full;
    direction = 'none';
  } else if (visited.length > 1 && visited[visited.length - 2] === full) {
    visited.pop();
    direction = 'back';
  } else if (visited[visited.length - 1] !== full) visited.push(full);
  routeStore.set(snapshot(direction));
}

/** Install the route table and start listening. Safe to call again (replaces the table). */
export function startRouter(routes) {
  table = routes;
  if (!startRouter.listening) {
    globalThis.addEventListener?.('hashchange', onHashChange);
    startRouter.listening = true;
    const { path, query } = parseHash();
    visited.push(path + (Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''));
  }
  routeStore.set(snapshot('none'));
}

/** The installed route table (see app/ui/routes.js). */
export const routeTable = () => table;

export function useRoute() {
  return useStore(routeStore);
}

/** Go to a path ('/settings', '/play/run?type=clubs' or '#/…'). */
export function navigate(to, { replace = false } = {}) {
  const target = to.startsWith('#') ? to : `#${to.startsWith('/') ? to : `/${to}`}`;
  if (globalThis.location.hash === target) return;
  if (replace) {
    replacing = true;
    const url = new URL(globalThis.location.href);
    url.hash = target;
    globalThis.location.replace(url);
  } else globalThis.location.hash = target;
}

/** Back within the app if possible, otherwise replace with the fallback path. */
export function back(fallback = '/') {
  if (visited.length > 1) globalThis.history.back();
  else navigate(fallback, { replace: true });
}
