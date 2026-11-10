// App shell: top bar, routed screen outlet (lazy screens, transitions, error boundary,
// focus + title management), toasts and the how-to sheet.
import { useEffect, useState } from 'preact/hooks';
import { html, cx } from '../lib/html.js';
import { useRoute, startRouter } from '../lib/router.js';
import { routes } from '../routes.js';
import { loadScreen } from '../lib/screen-loader.js';
import { ErrorBoundary } from '../components/error-boundary.js';
import { Toaster } from '../components/toast.js';
import { Skeleton } from '../components/skeleton.js';
import { TopBar } from './top-bar.js';
import { HowToPlaySheet } from './how-to-play.js';

const APP_NAME = 'World Cup Draft';
let firstScreen = true; // no focus move / scroll on the initial page load

function Outlet() {
  const r = useRoute();
  const [state, setState] = useState({ route: null, Screen: null, error: null });
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!r.route) return;
    let live = true;
    const timer = setTimeout(() => live && setSlow(true), 180);
    loadScreen(r.route)
      .then(mod => live && setState({ route: r.route, Screen: mod.default, error: null }))
      .catch(error => {
        console.error('[ui] failed to load screen', error);
        if (live) setState({ route: r.route, Screen: null, error });
      })
      .finally(() => {
        clearTimeout(timer);
        if (live) setSlow(false);
      });
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [r.route]);

  // Title, scroll and focus after each navigation (not on first load)
  useEffect(() => {
    if (!state.Screen || state.route !== r.route) return;
    document.title =
      r.route.path === '/'
        ? `${APP_NAME} — draft an XI, win it all`
        : `${r.route.title} · ${APP_NAME}`;
    if (firstScreen) {
      firstScreen = false;
      return;
    }
    globalThis.scrollTo?.(0, 0);
    // Screens that load data first (run hub, daily, pre-match) render their h1 a moment
    // later: wait for it (up to 3 s) instead of leaving focus on <body>, but never take
    // focus from something the user has focused meanwhile.
    const main = document.getElementById('main');
    const idle = () => [document.body, main, null].includes(document.activeElement);
    const focusHeading = () => {
      const heading = document.querySelector('#main h1');
      if (!heading) return false;
      if (idle()) {
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
      return true;
    };
    if (focusHeading() || !main) return;
    const observer = new MutationObserver(() => focusHeading() && stop());
    const timer = setTimeout(() => {
      stop();
      if (idle()) main.focus({ preventScroll: true });
    }, 3000);
    const stop = () => {
      observer.disconnect();
      clearTimeout(timer);
    };
    observer.observe(main, { childList: true, subtree: true });
    return stop;
  }, [state, r.path, r.query]);

  if (state.error && state.route === r.route) throw state.error; // rendered by the ErrorBoundary below
  if (!state.Screen || state.route !== r.route)
    return slow
      ? html`<div class="container screen" aria-busy="true">
          <${Skeleton} variant="rect" height=${220} label="Loading screen" />
        </div>`
      : null;
  const { Screen } = state;
  return html`<div
    key=${r.path}
    class=${cx('screen-enter', r.direction === 'back' && 'is-back')}
    data-route=${r.route.path}
  >
    <${Screen} params=${r.params} query=${r.query} route=${r.route} />
  </div>`;
}

export function App() {
  const r = useRoute();
  const immersive = !!r.route?.immersive;
  return html`<a
      class="skip-link"
      href="#main"
      onClick=${e => {
        e.preventDefault();
        document.getElementById('main')?.focus();
      }}
      >Skip to content</a
    >
    ${!immersive && html`<${TopBar} route=${r} />`}
    <main id="main" tabindex="-1" class=${cx('app-main', immersive && 'is-immersive')}>
      <${ErrorBoundary} key=${r.path}>
        <${Outlet} />
      <//>
    </main>
    <${Toaster} />
    <${HowToPlaySheet} />`;
}

/** Start routing and render the shell into `root`. */
export function mountApp(root, render) {
  startRouter(routes);
  render(html`<${App} />`, root);
}
