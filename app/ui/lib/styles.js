// Stylesheets of the lazy screens.
//
// styles/app.css — the page's one render-blocking stylesheet — holds what the first screen
// paints with: tokens, base, every shared component, the shell and Home. The sheets of the
// other screens arrive with their screen: a route names them (`styles` in ui/routes.js) and
// loadScreen() awaits them together with the module, so a screen never renders unstyled.
//
//   await loadStyles(['draft', 'prematch']);   // ui/screens/<name>/<name>.css
//
// A sheet is added once, into the `screens` cascade layer, and stays: screen CSS is still
// global, so keep prefixing classes with the screen's name. The <style> elements keep the
// order of SCREEN_SHEETS in the document whatever order the screens are opened in, so rules
// of two screens with the same specificity always resolve the same way.

/** Every lazy screen sheet, in cascade order (earlier loses a tie). Add new screens here. */
export const SCREEN_SHEETS = [
  'settings',
  'placeholder',
  'setup',
  'draft',
  'prematch',
  'run',
  'daily',
  'exhibition',
  'match',
];
// A sheet that neither loads nor fails (no engine is known to do that) must not hold a
// screen back for ever.
const PATIENCE = 10000;
const loading = new Map(); // name → promise of the loaded sheet

function loadSheet(name) {
  if (loading.has(name)) return loading.get(name);
  const index = SCREEN_SHEETS.indexOf(name);
  if (index < 0) return Promise.reject(Error(`Unknown screen stylesheet "${name}"`));
  const style = document.createElement('style'),
    url = new URL(`../screens/${name}/${name}.css`, import.meta.url).href;
  style.dataset.sheet = name;
  // <link> cannot name a cascade layer; an @import can. `load` fires once the import applies.
  style.textContent = `@import url("${url}") layer(screens);`;
  const loaded = new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, PATIENCE);
    style.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    style.onerror = () => {
      clearTimeout(timer);
      style.remove();
      loading.delete(name); // allow a retry
      reject(Error(`The ${name} stylesheet could not be loaded`));
    };
  });
  loading.set(name, loaded);
  const next = SCREEN_SHEETS.slice(index + 1)
    .map(later => document.head.querySelector(`style[data-sheet="${later}"]`))
    .find(Boolean);
  document.head.insertBefore(style, next || null);
  return loaded;
}

/** Load the named screen stylesheets (once each); resolves when all of them apply. */
export function loadStyles(names = []) {
  return Promise.all(names.map(loadSheet));
}
