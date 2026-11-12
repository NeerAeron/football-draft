// Lazy screens, loaded once and cached: a route's module and its stylesheets (lib/styles.js)
// together, so a screen never renders before its CSS applies. The shell's outlet uses
// loadScreen(); screens can warm likely next screens with preloadRoutes(['/play/:mode']) when
// idle.
import { routeTable } from './router.js';
import { loadStyles } from './styles.js';

const modules = new Map();

export function loadScreen(route) {
  if (!modules.has(route)) {
    const pending = Promise.all([route.load(), loadStyles(route.styles)]).then(
      ([module]) => module,
    );
    modules.set(route, pending);
    pending.catch(() => modules.delete(route)); // allow a retry after a failed load
  }
  return modules.get(route);
}

export function preloadRoutes(paths) {
  for (const route of routeTable())
    if (paths.includes(route.path)) loadScreen(route).catch(() => {});
}
