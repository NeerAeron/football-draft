// Route table for the hash router (lib/router.js). One line per screen; screens are
// lazy-loaded ES modules whose default export is the screen component:
//   export default function DraftScreen({ params, query }) { … }
//
// Fields: path ('/play/:mode'), title (document title + top bar), load (dynamic import),
// back (where the top-bar back button goes; omit on Home), leave (true = the back button always
// goes to `back`, not one step back in history), immersive (true = no top bar, e.g. a
// full-screen match).
// To add a screen: create app/ui/screens/<name>/<name>.js (+ .css imported in styles/app.css)
// and point its route's load() at it — see docs/ui-guide.md, "Add a screen".
const placeholder = () => import('./screens/placeholder/placeholder.js');

// Challenge links in the core's short form ('#c=<token>', share.js challengeUrl) land on the
// challenge screen; the RUN screens share '#/challenge?c=<token>' links directly.
const loc = globalThis.location;
if (loc && /^#c=[0-9a-z.-]+/i.test(loc.hash))
  globalThis.history?.replaceState(
    null,
    '',
    `${loc.pathname}${loc.search}#/challenge?${loc.hash.slice(1)}`,
  );

export const routes = [
  { path: '/', title: 'Home', load: () => import('./screens/home/home.js') },
  {
    path: '/settings',
    title: 'Settings',
    back: '/',
    load: () => import('./screens/settings/settings.js'),
  },
  {
    path: '/play/:mode',
    title: 'Set up',
    back: '/',
    load: () => import('./screens/setup/setup.js'),
  },
  {
    path: '/draft',
    title: 'Draft',
    back: '/',
    // The back arrow leaves the draft for Home (it stays saved), never for the setup screen.
    leave: true,
    load: () => import('./screens/draft/draft.js'),
  },
  {
    path: '/prematch',
    title: 'Pre-match',
    back: '/',
    load: () => import('./screens/prematch/prematch.js'),
  },
  {
    path: '/match',
    title: 'Match',
    back: '/',
    immersive: true,
    load: () => import('./screens/match/match.js'),
  },
  { path: '/run', title: 'World Cup Run', back: '/', load: () => import('./screens/run/run.js') },
  {
    path: '/daily',
    title: 'Daily Challenge',
    back: '/',
    load: () => import('./screens/daily/daily.js'),
  },
  {
    path: '/exhibition',
    title: 'Exhibition',
    back: '/',
    load: () => import('./screens/exhibition/exhibition.js'),
  },
  {
    path: '/challenge',
    title: 'Challenge',
    back: '/',
    load: () => import('./screens/run/challenge.js'),
  },
  { path: '*', title: 'Not found', back: '/', load: placeholder },
];
