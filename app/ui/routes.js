// Route table for the hash router (lib/router.js). One line per screen; screens are
// lazy-loaded ES modules whose default export is the screen component:
//   export default function DraftScreen({ params, query }) { … }
//
// Fields: path ('/play/:mode'), title (document title + top bar), load (dynamic import),
// back (where the top-bar back button goes; omit on Home), immersive (true = no top bar,
// e.g. a full-screen match).
// To add a screen: create app/ui/screens/<name>/<name>.js (+ .css imported in styles/app.css)
// and point its route's load() at it — see docs/ui-guide.md#add-a-screen.
const placeholder = () => import('./screens/placeholder/placeholder.js');

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
  { path: '/draft', title: 'Draft', back: '/', load: () => import('./screens/draft/draft.js') },
  {
    path: '/prematch',
    title: 'Pre-match',
    back: '/',
    load: () => import('./screens/prematch/prematch.js'),
  },
  { path: '/match', title: 'Match', back: '/', load: placeholder },
  { path: '/run', title: 'World Cup Run', back: '/', load: placeholder },
  { path: '/daily', title: 'Daily Challenge', back: '/', load: placeholder },
  { path: '/exhibition', title: 'Exhibition', back: '/', load: placeholder },
  { path: '*', title: 'Not found', back: '/', load: placeholder },
];
