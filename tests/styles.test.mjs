// The stylesheet split: app.css is the first screen's CSS, every other screen sheet loads with
// its route (app/ui/lib/styles.js). Nothing at runtime notices a sheet that is not loaded —
// the screen is just unstyled — so these tests do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { entryStyles, moduleGraph } from '../scripts/dev/preload.mjs';
import { SCREEN_SHEETS } from '../app/ui/lib/styles.js';
import { routes } from '../app/ui/routes.js';

const UI = new URL('../app/ui/', import.meta.url);
const read = path => readFileSync(new URL(path, UI), 'utf8');
const sheetPath = name => `screens/${name}/${name}.css`;
/** The entry module of a route: the path in its `import('./screens/…')`. */
const entryOf = route => `ui/${String(route.load).match(/import\('\.\/([^']+)'\)/)?.[1]}`;
const placeholder = 'ui/screens/placeholder/placeholder.js';
const routeEntry = route => (route.path === '*' ? placeholder : entryOf(route));

test('every stylesheet is either in app.css (first screen) or a lazy screen sheet', () => {
  const eager = entryStyles().map(path => path.replace(/^ui\//, ''));
  const lazy = SCREEN_SHEETS.map(sheetPath);
  const onDisk = readdirSync(UI, { recursive: true })
    .map(String)
    .filter(path => path.endsWith('.css') && !/^(gallery|vendor)\//.test(path))
    .filter(path => path !== 'styles/app.css');
  assert.deepEqual([...eager, ...lazy].sort(), onDisk.sort());
  assert.equal(new Set([...eager, ...lazy]).size, eager.length + lazy.length, 'listed once');
  // The first screen: everything shared and Home; no other screen.
  for (const needed of ['styles/tokens.css', 'shell/shell.css', 'screens/home/home.css'])
    assert.ok(eager.includes(needed), needed);
  for (const path of readdirSync(new URL('components/', UI)).filter(f => f.endsWith('.css')))
    assert.ok(eager.includes(`components/${path}`), `${path} is shared: it belongs in app.css`);
});

test('a route names known sheets, its own among them', () => {
  for (const route of routes) {
    for (const name of route.styles || [])
      assert.ok(SCREEN_SHEETS.includes(name), `${route.path}: unknown sheet "${name}"`);
    const folder = routeEntry(route).split('/')[2];
    if (SCREEN_SHEETS.includes(folder))
      assert.ok(route.styles?.includes(folder), `${route.path} must load ${folder}.css`);
  }
});

// Class names a module can put on an element: class="…" attributes and every string inside
// class=${…}, cx(…) and classList calls (not the ones a comparison is made with). A name built
// in a template literal (pitch__link--${n}) comes back as its fixed start plus '*'.
function classNames(source) {
  const chunks = [];
  for (const m of source.matchAll(/class(?:Name)?\s*[=:]\s*(?:"([^"]*)"|'([^']*)')/g))
    chunks.push(m[1] ?? m[2]);
  for (const m of source.matchAll(/class(?:Name)?=\$\{|cx\(|classList\.\w+\(/g)) {
    let depth = 1,
      end = m.index + m[0].length;
    const start = end;
    for (; end < source.length && depth; end++)
      if ('{('.includes(source[end])) depth++;
      else if ('})'.includes(source[end])) depth--;
    const expression = source.slice(start, end).replace(/[!=]==?\s*(?:'[^']*'|"[^"]*")/g, '');
    for (const q of expression
      .replace(/\$\{[^}]*\}/g, '* ')
      .matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g))
      chunks.push(q[1] ?? q[2] ?? q[3]);
  }
  return new Set(chunks.flatMap(chunk => chunk.match(/[a-zA-Z_][\w-]*\*?/g) || []));
}
/** Selectors of the style rules of a sheet (keyframe steps and at-rule preludes left out). */
function selectors(css) {
  const out = [],
    stack = [];
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (let i = 0, start = 0; i < css.length; i++) {
    if (css[i] === '{') {
      const prelude = css.slice(start, i).trim();
      if (!prelude.startsWith('@') && !stack.some(p => /^@(-webkit-)?keyframes/.test(p)))
        out.push(...prelude.split(','));
      stack.push(prelude);
    } else if (css[i] === '}') stack.pop();
    if ('{};'.includes(css[i])) start = i + 1;
  }
  return out.map(selector => selector.trim()).filter(Boolean);
}

test('a route loads every screen sheet whose rules can match its markup', () => {
  const classesIn = files =>
    new Set(
      files
        .filter(file => file.startsWith('ui/') && !file.includes('/vendor/'))
        .flatMap(file => [...classNames(read(file.replace(/^ui\//, '')))]),
    );
  const shell = classesIn(moduleGraph(['ui/main.js']));
  const rules = Object.fromEntries(
    SCREEN_SHEETS.map(name => [name, selectors(read(sheetPath(name)))]),
  );
  const missing = [];
  for (const route of routes) {
    const used = new Set([...shell, ...classesIn(moduleGraph([routeEntry(route)]))]),
      starts = [...used].filter(name => name.endsWith('*')).map(name => name.slice(0, -1)),
      named = name => used.has(name) || starts.some(start => name.startsWith(start));
    for (const name of SCREEN_SHEETS) {
      if (route.styles?.includes(name)) continue;
      // A rule can match when the route's modules name every class of its selector.
      const matching = rules[name].filter(selector =>
        [...selector.replace(/:not\([^)]*\)/g, '').matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)].every(m =>
          named(m[1]),
        ),
      );
      if (matching.length)
        missing.push(`${route.path} uses ${name}.css (${matching.slice(0, 4).join(', ')})`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    'add the sheet to the route’s `styles` in app/ui/routes.js, or give the class its screen’s prefix',
  );
});
