# Football Draft Challenge — agent guide

Browser football (soccer) game: draft an XI from real EA FC 26 players, then watch/coach a
continuous 2D 11v11 physics simulation. Static site, **no build step**: `app/` is served as-is
(native ES modules). Node ≥ 22 for tooling/tests. Only dev dependencies (Prettier, ESLint).

## Commands (run from repo root)

| Command | What it does | Time |
| --- | --- | --- |
| `npm ci` | install dev tools | ~3 s |
| `npm run dev` | serve `app/` on http://127.0.0.1:8000 with live reload | — |
| `npm run check` | Prettier check + ESLint + fast tests — **run before every commit** | ~9 s |
| `npm run test:fast` | unit tests minus full-match simulations | ~6 s |
| `npm test` | all tests (`node:test`) | ~30 s |
| `node scripts/dev/test.mjs draft respin` | only test files whose path contains a word | — |
| `node scripts/dev/test.mjs --grep "offside"` | only tests whose name matches | — |
| `npm run test:browser` | Playwright smoke run of every UI flow, fails on console/page errors | ~25 s |
| `npm run shots -- --only draft --desktop` | screenshots into `.shots/` (view PNGs with the Read tool) | — |
| `npm run sim:fingerprint` | deterministic results/hashes of 12 full matches + timings | ~35 s |
| `npm run format` / `npm run lint` | Prettier write / ESLint (`--max-warnings 0`) | — |
| `npm run verify` | everything incl. full tests + browser smoke (before pushing) | ~60 s |

Browser tooling uses the machine's pre-installed Playwright + Chromium (`require('playwright')`).
Never `npm i playwright` or run `playwright install` locally (CI installs its own copy).

## Layout

```
app/                    served statically (deploy = publish this folder); runtime files only
  index.html            new UI shell (import map, fonts) → app/ui/main.js; legacy.html = old UI
  config.html           tuning/config page — legacy UI
  core/                 pure logic: no DOM, no storage, Node-testable
    sim/                engine, rules, cards, periods, replay, in-match AI coach
    players/            ratings, traits/badges, formations, club + random lineups, labels
    draft/              Draft state machine, league/club weights, AI opponent selection
    config/             config.js (DEFAULT_CONFIG, CONFIG, overrides, normalizeConfig)
    util/               rng.js (LCG), math.js (clamp/lerp/dist), text.js (escapeHtml, searchKey)
  services/             browser-side services reusable by any UI: sound, playback, fullscreen
  legacy/               the pre-overhaul UI (scripts + style/game/squad/config.css)
  ui/                   NEW UI (Preact + htm, vendored, no build): lib/, components/, screens/, styles/ —
                        read docs/ui-guide.md before touching it
  data/catalog.v3.json  compiled columnar catalog (the only JSON fetched; decode via services/catalog.js)
  assets/logos/         league logos (paths in the catalog are relative to the page)
  assets/flags/         flag-icons SVGs (MIT) for every nation in the catalog
data/                   repo root, NOT deployed: catalog-reference.json (compiler input), logo sources,
                        rules-reference.json, goal-location-reference.json (research outputs);
                        raw/ (downloaded CSV) and build/ (provenance catalog) are generated, gitignored
scripts/                catalog compiler (compile-league-catalog.mjs + compile-players.mjs), audit export
scripts/data/           data:fetch / data:build pipeline; catalog-file.mjs = loadRuntimeCatalog() for Node
scripts/dev/            serve.mjs, test.mjs, browser.mjs, sim-fingerprint.mjs
tests/*.test.mjs        node:test suites; tests/fixtures/ inputs (also used by tools/calibration)
tests/browser/flows.mjs Playwright flows used by test:browser and shots — keep selectors in sync
tools/calibration/      manual calibration/integration runners (write to /tmp; not run by npm test)
tools/research/         StatsBomb research scripts (Python) behind data/*-reference.json
docs/                   history.md (pre-overhaul README / dev log), calibration notes
.github/workflows/      ci.yml (format, lint, tests, browser smoke), pages.yml (deploys app/)
```

New UI work goes under `app/ui/` (entry `app/index.html`, component gallery `app/gallery.html`);
`app/legacy/` is the pre-overhaul UI, still reachable at `app/legacy.html` (and `config.html`, the
advanced tuning page) until it is replaced. UI contracts: `docs/ui-guide.md` (screens, stores,
routing, components), `docs/engine-events.md` (match events/state), `docs/ui-match.md` (match
requests/results), `docs/draft-api.md` + `docs/competition-api.md` (draft and run logic). UI code may import `core/` and
`services/`; `core/` must never import `services/`, `legacy/` or `ui/`. Runtime URLs such as
catalog asset paths (`./assets/logos/…`, `./assets/flags/…`) resolve against the page in `app/`,
not against the module file. Load the catalog only through `loadCatalog()` (`app/services/catalog.js`,
browser) or `loadRuntimeCatalog()` (`scripts/data/catalog-file.mjs`, Node) — never fetch the JSON
directly. The decoded catalog has `players`, `leagues`, `teams`, `nations` and the Maps `byId`,
`byNation`, `byLeague`, `byClub`; club-less national-team players have `source.club === null` and
appear only in nation pools.

### Module map (`app/core/` unless noted)

- **Simulation** (`sim/`) — `engine.js` (`Match`, `Player`: fixed 1/60 s step, decisions,
  passing, shooting, defending, restarts, fouls/cards, stats; re-exports `ATTRS`, `clamp`),
  `player-model.js` (hidden tendencies), `rules.js` (offside etc.), `discipline.js` (cards),
  `goal-zones.js`, `periods.js` (clock, stoppage), `replay.js` (record/highlights/instant,
  `performanceRating`), `coach.js` (`coachAI` in-match AI tactics, `tacticAccess`). The engine
  imports only `sim/`, `players/`, `config/` and `util/` — never `draft/`.
- **Players & ratings** (`players/`) — `ratings.js` (attributes, role weights, `overallRating`,
  `positionFamiliarity`, tiers), `traits.js` (badges/BADGES, styles, tactics, `badgeBoost`),
  `badges.js` (badge normalisation by tier), `formations.js` (10 formations: `[x, y, role]`
  rows), `team-ratings.js`, `club-lineups.js` (best XI per club, Hungarian assignment),
  `lineups.js` (random XIs, `playerInitials`), `player-labels.js`.
- **Draft** (`draft/`) — `draft.js` (`Draft`: spins, eligibility, budget tickets, re-spins,
  hidden reveal pacing, `bestSlots`, `KITS`), `leagues.js` (league/club weights), `opponent.js`
  (`DIFFICULTIES`, `createAIOpponent`, `chooseAIFormation`, `draftValue`).
- **Config** (`config/config.js`) — `DEFAULT_CONFIG`, live `CONFIG`, persisted overrides,
  `normalizeConfig`; each `Match` snapshots it into `match.tuning`.
- **Util** (`util/`) — `rng.js` (`lcgNext`, `lcg(seed)`, `LCG_RANGE`: the one LCG everyone
  uses, each with its own state), `math.js`, `text.js` (`escapeHtml`, `foldDiacritics`,
  `searchKey`).
- **Services** (`app/services/`) — `sound.js` (Web Audio), `playback.js` (`PlaybackClock`),
  `fullscreen.js` (TV mode).
- **Legacy UI** (`app/legacy/`) — `app.js` (match screen controller + canvas renderer + global
  wiring), `game-ui.js` (home + draft screens), `squad-ui.js` (cards, mini pitch),
  `draft-reel.js`, `budget-confirmation.js`, `config-ui.js`.

## Invariants — do not break

- **Determinism.** The engine uses only its seeded RNG (`match.rand()`/`noise()`); same seed +
  config ⇒ identical match. Never use `Math.random()`/`Date.now()` inside simulation code. UI,
  audio and animation must never consume simulation or draft RNG (draft reels use their own state).
- **Config snapshot.** A running match reads `match.tuning` (or `player.tuning`), never live
  `CONFIG`. Changing settings must not alter an in-progress match or a replay.
- **Hot paths.** `Player.skill`, `positionFamiliarity`, `badgeBoost`, `dist`, `Match.plan` and the
  defensive assignment helpers run thousands of times per step. No allocations/closures there;
  caches must stay correct when tests mutate `p.attrs`/`p.tags`/`match.tuning` in place.
- **Behaviour-neutral refactors** of `app/core/sim/engine.js` (or anything it imports) must keep
  `npm run sim:fingerprint` identical: record before (`… --json > /tmp/before.json`) and compare
  after (`node scripts/dev/sim-fingerprint.mjs --compare /tmp/before.json`). Intentional gameplay
  changes are expected to change it — then justify with tests/stats instead.
- **Data.** Never invent player ratings. The catalog comes only from the compiler.

## Data pipeline

Source: rovnez, "FC 26 (FIFA 26) player data", `FC26_20250921.csv` (18,405 rows, CC BY 4.0,
SHA-256 `4399cb2bcc2a14a2872e76a118f8f4bf64d7954503949c75751a14f33863e3b2`). An identical public
copy: `https://raw.githubusercontent.com/Din1225/Data-Mining-Hw1/2276bf1434028fbd55a564d450d3971e75b425c5/data/FC26_20250921.csv`.

```sh
npm run data:fetch   # pinned CSV -> data/raw/ (SHA-256 checked; no-op when present)
npm run data:build   # -> app/data/catalog.v3.json, app/assets/flags/, data/build/players-fc26.json
```

Builds are deterministic (byte-identical reruns). Format v3 is columnar
(`app/core/players/catalog-codec.js`); it also carries precomputed badges, club ratings and club
best XIs per formation, stamped with the config/FORMATIONS they were derived from. If you change
rating, tier, minimum-fit, badge or formation defaults, rebuild the data (the data tests check the
stamps). Selection: every player of every usable league plus club-less national-team players
(`data/catalog-reference.json` → `selection`); every club player's club must have a reviewed entry
there. Never invent ratings or club metadata.

## Conventions

- Plain modern JS (ES2024 modules), no framework, no runtime dependencies, no bundler.
- Prettier: single quotes, 100 columns, `arrowParens: avoid`. ESLint flat config.
- Escape any catalog text inserted with `innerHTML` with `escapeHtml` from `core/util/text.js`
  (player/club names contain accents, quotes).
- UI must work at 390 px wide (touch) and 1366 px desktop; respect `prefers-reduced-motion`.
- After UI changes: `npm run shots -- --only <flow>` and look at the PNGs; update
  `tests/browser/flows.mjs` when selectors or flows change; `npm run test:browser` must pass.
- Commit in logical steps with clear messages; run `npm run check` first.
