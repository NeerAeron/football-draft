# UI guide — the new interface (`app/ui/`)

The rules and building blocks every screen follows. Read this before adding a screen; keep it
current when you add a component or pattern.

**Look and feel — "Floodlit night".** Ink-navy night with floodlight haze, striped pitch greens,
**volt** (lime) as the one primary accent, **gold foil** for stars/trophies/daily, **coral** for
negatives. Bold condensed numerals (Barlow Condensed), Inter for UI text. Premium and playful:
foil tier frames, circular flag tokens, big scorelines, one confident CTA per view.
Mobile-first single column (390 px) that becomes a two-pane layout from 960 px.

## 1. Folder conventions

```
app/
  index.html              the app shell page (import map → ui/main.js)
  gallery.html            component gallery (design review + screenshot QA)
  assets/fonts/           Barlow Condensed + Inter woff2 subsets + OFL texts
ui/
  main.js                 entry: render the shell
  routes.js               route table — one line per screen
  vendor/                 Preact 10.29.8, htm 3.1.1, Lucide subset (+ licences, README.txt)
  styles/
    app.css               the ONE stylesheet entry: @layer order + @import of what the first
                          screen paints with (tokens, base, every component, shell, Home);
                          the other screens' sheets load with their screen (lib/styles.js)
    fonts.css tokens.css base.css
  lib/                    framework-free helpers (no JSX, no DOM except motion/audio/router)
    html.js               html`` (htm bound to Preact), cx(), nextId()
    store.js              createStore, useStore, shallowEqual
    create-store.js       the store without the hook (framework-free modules and Node tests import it here)
    random.js             randomSeed, randomId — UI-side randomness only, never in core
    router.js             hash router: startRouter, useRoute, href, navigate, back, leave, rewrite
    screen-loader.js      lazy screens (module + stylesheets): loadScreen, preloadRoutes
    styles.js             lazy screen stylesheets: SCREEN_SHEETS (cascade order), loadStyles
    prefs.js              UI preferences (motion, hideRatings, onboarded, draftType)
    motion.js             isReducedMotion(), useReducedMotion()
    audio.js              soundStore, toggleSound, setVolume, playCue (wraps services/sound.js)
    player-view.js        PlayerView shape, playerView(), makePlayerView(catalog), summaryStats()
    tiers.js color.js     tierOf/resolveTier/isTopTier (Superstar 88+ · Star 84+ · Starter 80+ ·
                          Normal 74+ · Bench); teamStyle/readableOn/contrastRatio
    kits.js               nation home kits (NATION_KITS, nationKit, sideColors, kitColors) — use
                          them wherever a national side is shown; never a generic default colour
    format.js             fmt1/fmt2/int/signed1/pct/boost and fmtDate ("12 Nov 2026") — the ONLY number and date formatting for display
                          ('.' decimals, ',' thousands; never toLocaleString for numbers)
    saved.js storage.js   saved run/daily/draft readers; safe localStorage helpers
    catalog-warm.js       loadWarmCatalog()/warmCatalog()/warmOpponents(): fill core's rating cache
                          in ≤ 8 ms slices, then the draft index and the opponent list, each in
                          its own task — use it (not bare loadCatalog) wherever a screen drafts,
                          builds a run or lists opponents (no main-thread task > 200 ms)
    offline.js            registerOffline(routes): registers app/sw.js (network first); the
                          installed app's first launch — and the first after each deploy (a new
                          stamp in app/build.json) — caches every screen, font, worker, the
                          catalog, flags and logos, then sets <html data-offline-ready>. Add new
                          module workers to its WORKERS list. Off on localhost unless ?sw=1.
  components/             shared components: <name>.js + <name>.css, props documented on top
  shell/                  app.js (outlet, transitions, focus, errors), top-bar.js, brand.js,
                          how-to-play.js, shell.css
  screens/<name>/         one folder per screen: <name>.js (+ <name>.css, sub-components)
  gallery/                gallery.js/.css, fixture.js (generated), make-fixture.mjs
```

- UI code may import `app/core/**` and `app/services/**`; never the other way round. Game rules,
  draft state machines and simulation stay in `core/`; screens only orchestrate and render.
- Load the catalog **only** via `loadCatalog()` from `app/services/catalog.js` (cached promise).
- Never `innerHTML` catalog text. htm/Preact escape everything you interpolate.

## 2. Run, screenshot, review

```sh
npm run dev                                   # http://127.0.0.1:8000/ (shell), /gallery.html
npm run shots -- --only home --out <dir>      # PNGs per flow × desktop 1366×860 + mobile 390×844
npm run shots -- --only gallery --mobile      # every gallery section, one PNG each
npm run test:browser                          # all flows, fails on console errors / 4xx / page errors
```

- View PNGs with the Read tool. `gallery.html?only=<section>` renders one section
  (`tokens buttons icons chips cards flags player-card player-row pitch meters reel overlays
results states`).
- Flows live in `tests/browser/flows.mjs`; **one flow (group) per screen owner**. Use
  `data-screen="<name>"` on your screen root and wait for it; prefer roles/labels/`data-testid`
  over CSS classes in selectors. `seed(page, {...})` writes localStorage before load.
- Review checklist before committing: 390 px has no horizontal scroll (the runner fails on
  console errors, not overflow — check the PNG), 1366 px uses the width (two panes, no giant empty
  areas), one primary CTA per view, rhythm on the 4 px grid, text ≥ 4.5:1, focus rings visible,
  reduced motion still works (the runner emulates it).
- A missing flag/logo file is an HTTP 404 → the smoke test fails. That is intended.

## 3. Tech: Preact + htm, no build

`index.html` and `gallery.html` declare the import map (`preact`, `preact/hooks`, `htm`). Write
components as tagged templates:

```js
import { html, cx } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Button } from '../../components/index.js';

export function Counter({ start = 0 }) {
  const [n, setN] = useState(start);
  return html`<div class=${cx('counter', n > 9 && 'is-big')}>
    <span class="num">${n}</span>
    <${Button} variant="primary" onClick=${() => setN(n + 1)}>Add<//>
  </div>`;
}
```

- Components: `<${Comp} prop=${x}>…<//>`; spread with `...${obj}`; use `class`, not `className`.
- **Whitespace gotcha:** htm drops whitespace that contains a line break. Prettier (which formats
  these templates) re-wraps long lines, so prose mixing text and inline elements can lose spaces
  (`on<a>Kaggle</a>`). Build such prose from arrays of strings and nodes (see the credits in
  `screens/settings/settings.js`), or keep the space inside the string.
- Keys on lists (`key=${id}`); conditional rendering with `${cond && html`…`}`.
- Pure helpers in `lib/` stay framework-free so Node tests can import them.

## 4. Add a screen

1. Create `app/ui/screens/<name>/<name>.js` with a default export. It receives
   `{ params, query, route }`:

   ```js
   export default function DraftScreen({ query }) {
     return html`<div class="screen container" data-screen="draft">
       <h1 class="sr-only-mobile">Draft</h1>
       …
     </div>`;
   }
   ```

2. Add `app/ui/screens/<name>/<name>.css` and its name to `SCREEN_SHEETS` in
   `app/ui/lib/styles.js` (the list is the cascade order inside the `screens` layer).
3. Point the route's `load` in `app/ui/routes.js` at it and name its stylesheets:
   `{ path: '/draft', title: 'Draft', back: '/', styles: ['draft'], load: () => import('./screens/draft/draft.js') }`
   `styles` lists every screen sheet whose classes the screen's markup uses: its own, and
   another screen's when it renders that screen's parts (Daily shows the run's bracket:
   `['run', 'daily']`). `tests/styles.test.mjs` fails when one is missing.
4. Add/extend your flow in `tests/browser/flows.mjs`; screenshot desktop + mobile; iterate.

Screen anatomy: root `div.screen` (+ `container` / `container-narrow`), exactly one `h1`. The shell
focuses the `h1` after navigation and sets `document.title` from `route.title`. On phones the top
bar already shows `route.title`, so a big visible h1 that repeats it should get `sr-only-mobile`.
For a full-screen view (match) set `immersive: true` on the route (no top bar) and provide your
own exit. Two-pane desktop: `.split` (main + 420 px side; `.split.is-side-left`) or your own grid
from 960 px. Primary action on phones: `div.action-bar` (sticky bottom, safe-area aware).

## 5. Routing

Hash routes (static hosting, back button works). Table in `app/ui/routes.js`:
`{ path, title, load, styles?, back?, leave?, immersive? }`; `'*'` is the not-found route. `leave: true`
(the draft): the top-bar back arrow always goes to `back` (Home), however many screens ago that was.

| Route         | Owner (P2)   | Meaning                                                         |
| ------------- | ------------ | --------------------------------------------------------------- |
| `#/`          | foundation   | Home                                                            |
| `#/play/:mode`| RUN/DRAFT    | setup for `run · quick · versus · daily`; `?type=` nations · leagues · clubs (`run` is always nations) |
| `#/draft`     | DRAFT-UI     | the draft board                                                 |
| `#/match`     | MATCH-UI     | match screen                                                    |
| `#/run`       | RUN-UI       | World Cup Run hub (Home's "Continue" goes here)                 |
| `#/daily`     | RUN-UI       | Daily Challenge                                                 |
| `#/exhibition`| RUN-UI       | Exhibition picker                                               |
| `#/prematch`  | DRAFT-UI     | pre-match for any two XIs (`prematch-store.js`)                 |
| `#/challenge` | RUN-UI       | challenge-link landing (`?c=…&r=…`)                             |
| `#/settings`  | foundation   | Settings (`?section=credits` scrolls to a panel)                |

```js
import { href, navigate, back, useRoute } from '../../lib/router.js';
href('/play/:mode', { mode: 'run' }, { type: 'clubs' }); // '#/play/run?type=clubs'
navigate('/draft');            // push;  navigate('/', { replace: true })
back('/');                     // history back inside the app, else replace with fallback
leave('/');                    // out of a flow: back to that screen, however many steps it is
rewrite('/play/run');          // new URL for the current entry, no navigation (spends ?go=1)
const { path, params, query, direction } = useRoute();
```

Put shareable state (seed, mode, type) in the query so "Challenge a friend" links are just URLs.
Keep large in-progress state in a store (below), persisted under a `football-draft-*` key.

## 6. State

```js
import { createStore, useStore, shallowEqual } from '../../lib/store.js';
export const draftSession = createStore({ pick: 0, selected: null });
draftSession.set({ selected: id });                 // shallow merge
draftSession.set(s => ({ ...s, pick: s.pick + 1 })); // updater
const pick = useStore(draftSession, s => s.pick);   // re-render only when pick changes
const { a, b } = useStore(store, s => ({ a: s.a, b: s.b }), shallowEqual);
```

One store per concern, created at module level in the owning screen folder (or `lib/` if shared).
State is immutable. Existing stores: `prefs` (`motion`, `hideRatings`, `onboarded`, `draftType`),
`soundStore` (`on`, `volume`, `available`), `motionStore`, `routeStore`, `toastStore`.
localStorage keys must start with `football-draft` (Settings → Reset clears exactly those).
Home reads `football-draft-run` (`{ mode, type, stage: 'G1'…'F', record: { w, d, l }, team }`)
and `football-draft-daily` (`{ streak, best, lastPlayed: 'YYYY-MM-DD' }`) via `lib/saved.js`, and
the trophy cabinet (`football-draft-records`) via `lib/records.js` — RUN-UI owns writing them
and may extend the shape (keep the readers tolerant).

## 7. Players: catalog → PlayerView

Components never read raw catalog records; they take a **PlayerView**
(`lib/player-view.js`): `{ id, name, fullName, position, positions, ovr, tier?, nation: { name,
code }, club: { name, colors: [p, s] }, league: { name, logo, tier }, stats: [{ key, label,
value }×6], badges: [{ id, label }] }`.

```js
const catalog = await loadCatalog();
const toView = makePlayerView(catalog);   // maps nationality → flag code, club colours, logo
html`<${PlayerCard} player=${toView(p)} />`;
```

Pass `ovr`/`tier` you computed for the context (e.g. `overallRating(p, true, slotRole)`), and
`tier` (a draft pool entry's `tier`) when a session plays with other thresholds. `hideRatings` on every player component
implements "Ball Knower". Club-less players have no `club`/`league`.

## 8. Components (props are documented at the top of each file)

| Component | Key props |
| --- | --- |
| `Button` | `variant` primary·secondary·ghost·danger, `size` sm·md·lg·xl, `icon`, `iconEnd`, `loading`, `block`, `href` |
| `IconButton` | `icon`, `label` (required), `variant`, `size`, `pressed`, `badge`, `href` |
| `Icon` | `name` (see `ICON_NAMES`; Lucide + `ball pitch reel`), `size`, `title` |
| `Chip` / `ToggleChip` / `ChipGroup` | tone neutral·volt·gold·coral·green·sky·amber·holo; `pressed`; `options`, `value`, `multiple`, `scroll` |
| `Segmented` | `label`, `options [{value,label,icon,hint}]`, `value`, `onChange`, `size`, `block`, `tone` |
| `Card` / `Panel` | `variant` default·raised·outline·glass·hero·gold·volt, `padding`, `href`/`onClick`; Panel `title eyebrow description actions` |
| `Flag` | `code`, `name`, `shape` circle·rect, `size`, `src`, `decorative` (falls back to initials) |
| `Crest` / `LeagueLogo` | `name`, `colors`, `shape` disc·shield, `size` / `src`, `name`, `tier` |
| `PlayerCard` | `player`, `size` s·m·l, `tier`, `selected`, `disabled`, `hideRatings`, `onClick`, `children` (footer) |
| `CaptainMark` | the "C" armband mark (`size` sm \| md); rows, cards and pitch tokens show it for `player.captain`, and the year tag ("’18") for an era card (`player.era`) |
| `GoatMark` | the holographic "GOAT" tag (`size` sm \| md; same file as `CaptainMark`); rows, cards and pitch tokens show it for `player.goat` and wear `.is-goat-edge` |
| `PlayerRow` | `player`, `fit`, `cost { label, tone }` (Budget tier tag), `boost { label, text }` ("+1.5 nation mate"), `stats` (count), `selected`, `disabled`, `hideRatings`, `rank`, `onClick` |
| `FitTag` | `fit { state: best·ok·penalty·swap·blocked·neutral, label, from, to, at }` (`at` + `to`: "81 at CM") |
| `PitchView` | `formation` (FORMATIONS key) or `rows`, `players[]` by slot, `highlights {i: fit}`, `links [{from,to,strength 1-3}]`, `linkMode` quiet·focus·all (quiet: faint lines, hover/focus/selected lights one player's links; >14 links → focus), `selected`, `onSelect(i)`, `hideRatings`, `boosts` (array · `false`; default: the mates boosts of the players), `names` |
| `Meter` / `StatBar` / `StatTile` | `label value max tone(auto) size valueText delta compare hint` |
| `Reel` | `items`, `landIndex` (decided first!), `spinKey`, `onLand`, `onTick`, `skip`, `duration`, `size` |
| `Modal` / `Sheet` | `open`, `onClose`, `title` (required), `eyebrow`, `description`, `footer`, `size`, `dismissible` |
| `Tabs` | `label`, `tabs [{id,label,icon,badge}]`, `value`, `onChange`, `variant` underline·pill, children(fn) |
| `toast()` / `achievement()` | `{ title, message, tone, icon, duration, action }`; `<Toaster/>` is in the shell |
| `ScoreBug` | `home/away { name, short, code, colors, score }`, `clock`, `period`, `live`, `pens`, `size` |
| `Cup`, `Medal`, `Prize` | run trophies: `Cup` `metal` gold·silver·bronze·holo, `size`, `glow`, `empty`, `budget`, `emblem`; `Medal` `metal`, `size`, `budget`; `Prize` `medal` (gold → cup, silver/bronze → medal, none → unlit cup) |
| `Confetti` | `fire` (change to burst), `count`, `origin`, `colors` (no-op with reduced motion) |
| `EmptyState` / `Skeleton` | `icon tone title message action size` / `variant text·rect·circle·card·row`, `lines` |
| `Switch` / `Range` / `Field` | native inputs: `label checked onChange` / `label value onInput valueText` |
| `ErrorBoundary` | wraps each screen in the shell; `fallback(error, reset)` |

Import from `components/index.js`. New shared component → `components/<name>.js` + `.css`, a line
in `styles/app.css` (then `npm run preload`) and in `components/index.js`, a gallery section,
and a row here.

**PitchView fit flow (draft):** when a player is selected, compute per-slot fit in `core/` and pass
`highlights`: `best` (auto-place target), `ok` (natural), `penalty { from, to }` (OVR after
familiarity, shown "79 → 75"), `swap` (occupied), `blocked` (not selectable). Mates lines and boost chips come from the
chemistry rules (`strength` 3 nation mates · gold, 2 club mates · volt, 1 a faint dashed line; the green `+1` / `+1.5` / `+2.5` chips are worked out from the players' `source` unless `boosts` is passed).

## 9. Tokens (`styles/tokens.css`)

Use custom properties only — no raw hex, px font sizes or durations in screen CSS.

- **Colour:** `--bg`, `--surface-1…4`, `--line-1…3`, `--text-1…3`; accents `--volt-*`
  (primary, `--on-volt` text), `--gold-*` (`--on-gold`), `--coral-*`, `--green-*`, `--amber-*`,
  `--sky-*`; semantic `--accent --positive --negative --warning --info --focus-ring`; pitch
  `--pitch-*`, `--pitch-stripe-a/b`, `--pitch-line`.
- **Tiers:** `--tier-{superstar|star|starter|normal|bench|hidden}` (solid), `-frame` (foil
  gradient), `-fill`, `-sheen`. Superstars and Stars also get a thin outline in the tier's
  colour wherever they are listed or shown (rows, cards, pitch tokens); lower tiers are plain. Text helpers `.tier-text-<id>`; medals `--medal-{gold,silver,bronze}`, Budget trophies `--budget`.
- **Team colours:** `style=${teamStyle(colors)}` sets `--team --team-2 --team-ink` (contrast-safe,
  lifted when too dark for navy).
- **Type:** `--font-display` (Barlow Condensed: headings, numerals, CTAs lg/xl) and `--font-ui`
  (Inter). Scales `--text-2xs…xl` (11–20 px) and `--display-xs…2xl` (18–96 px, fluid). Classes
  `.display`, `.eyebrow`, `.num` (tabular condensed numerals), `.lead`.
- **Space** `--space-0…11` (2,4,8,12,16,20,24,32,40,48,64,80); `--gutter` 16 → 24 px;
  **radii** `--radius-xs…xl, -pill`; **elevation** `--shadow-sm…xl`, `--glow-volt|gold|coral`;
  **motion** `--dur-instant|fast|base|slow|slower`, `--ease-out|in-out|spring|emph`;
  **z** `--z-raised|sticky|topbar|overlay|modal|toast|confetti`; `--touch` 44 px.
- **Layout classes** (`base.css`): `.container`, `.container-narrow`, `.stack(-sm|md|lg|xl)`,
  `.cluster`, `.row`, `.spread`, `.split`, `.grid-auto`, `.action-bar`, `.truncate`,
  `.visually-hidden`, `.sr-only-mobile`. Breakpoints: 560 (large phone), 720 (tablet), 960 (two-pane).
- **Cascade layers** (`app.css`): `tokens < base < components < shell < screens < overrides`.
  Screen CSS wins over component CSS regardless of specificity — no `!important` needed.
- **What loads when.** `app.css` (render-blocking, its imports preloaded by `index.html`) is
  the first screen's CSS: tokens, base, all shared components, the shell and Home. Every other
  screen sheet is loaded by `loadScreen()` together with the screen's module, before the
  screen renders (no unstyled flash), as `<style data-sheet="<name>">@import … layer(screens)`.
  Once loaded a sheet stays, and the elements keep the order of `SCREEN_SHEETS` whatever order
  screens are opened in — so screen CSS is still global: prefix classes with the screen's
  name. The gallery page links only `app.css` (it shows components, no screen).

## 10. Accessibility rules

- Every interactive element is a real `<button>`/`<a>`/input; icon-only buttons need `label`.
- Touch targets ≥ 44 px on touch devices (`--touch`; components enforce it under
  `pointer: coarse`). Visible focus: never remove outlines without a replacement ring.
- Text contrast ≥ 4.5:1 (`--text-3` is the dimmest allowed body colour, only on surfaces 1–3).
  Don't convey state by colour alone (FitTag pairs colour with icon/text).
- Dialogs: use `Modal` (native `<dialog>`, labelled, focus restored). Tabs: `Tabs`. Choices:
  `Segmented` (radios). Live updates: polite regions, never re-announce several times a second
  (the match ticker should batch).
- One `h1` per screen; headings in order; `lang`, titles and landmarks come from the shell.
- `hideRatings` must hide OVR/stats everywhere, including aria-labels (components do this).

## 11. Motion, sound, randomness

- Reduced motion = OS setting or Settings override (`html[data-motion]`). CSS: use `--dur-*`
  tokens (they collapse to ~0) — keyframe animations are stopped globally. JS animation must
  check `isReducedMotion()` / `useReducedMotion()` and jump to the end state.
- **Honest reels:** decide the outcome in `core/` first, then animate to it with `Reel`. UI never
  calls draft or simulation RNG; `Math.random()` is fine for confetti only.
- Sound: `playCue('tick' | 'reveal' | 'pick' | 'pick-star' | 'pick-superstar' | 'goal' | …)`;
  `selectionSound(tier)` from `services/sound.js` picks the pick fanfare. Mute/volume live in
  the top bar and Settings.

## 12. Gallery fixture

`app/ui/gallery/fixture.js` holds 16 real players (a superstar 4-3-3 XI + one per tier + a
club-less player) as PlayerViews. Regenerate after catalog changes:
`node app/ui/gallery/make-fixture.mjs` (formats itself with Prettier).
