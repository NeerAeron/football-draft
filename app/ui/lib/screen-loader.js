// Lazy screen modules, loaded once and cached. The shell's outlet uses loadScreen(); screens
// can warm likely next screens with preloadRoutes(['/play/:mode']) when idle.
import { routeTable } from './router.js';

const modules = new Map();

export function loadScreen(route) {
  if (!modules.has(route)) {
    const pending = route.load();
    modules.set(route, pending);
    pending.catch(() => modules.delete(route)); // allow a retry after a failed load
  }
  return modules.get(route);
}

export function preloadRoutes(paths) {
  for (const route of routeTable())
    if (paths.includes(route.path)) loadScreen(route).catch(() => {});
}
