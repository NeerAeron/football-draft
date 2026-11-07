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
| `npm run format` / `npm run lint` | Prettier write / ESLint | — |
| `npm run verify` | everything incl. full tests + browser smoke (before pushing) | ~60 s |

Browser tooling uses the machine's pre-installed Playwright + Chromium (`require('playwright')`).
Never `npm i playwright` or run `playwright install`.

## Layout

```
app/                    served statically (deploy = publish this folder)
  index.html            game shell (home, draft, match screens + dialogs)
  config.html           tuning/config page (config-ui.js)
  *.css                 style.css (shell/home/draft), game.css (match), squad.css, config.css
  data/players-runtime.json   compiled player catalog loaded by the game (lazy fetch)
  data/players-fc26.json      same catalog + full provenance (tests/scripts only)
  data/catalog-reference.json league/club metadata, Opta ratings, colours (compiler input)
  assets/logos/         league logos
scripts/                catalog compiler (compile-league-catalog.mjs + compile-players.mjs), audit export
scripts/dev/            serve.mjs, test.mjs, browser.mjs, sim-fingerprint.mjs
tests/*.test.mjs        node:test suites; tests/fixtures/ inputs; tests/*-results.json are
                        historical calibration records (never loaded by the game)
tests/browser/flows.mjs Playwright flows used by test:browser and shots — keep selectors in sync
```

### Module map (`app/`)

- **Simulation** — `engine.js` (`Match`, `Player`: fixed 1/60 s step, decisions, passing, shooting,
  defending, restarts, fouls/cards, stats), `player-model.js` (hidden tendencies), `rules.js`
  (offside etc.), `discipline.js` (cards), `goal-zones.js`, `periods.js` (clock, stoppage),
  `replay.js` (record/highlights/instant, `performanceRating`), `ai.js` (AI opponent selection,
  coaching, `tacticAccess`).
- **Players & ratings** — `ratings.js` (attributes, role weights, `overallRating`,
  `positionFamiliarity`, tiers), `traits.js` (badges/BADGES, styles, tactics, `badgeBoost`),
  `badges.js` (badge normalisation by tier), `formations.js` (10 formations: `[x, y, role]` rows).
- **Draft** — `draft.js` (`Draft`: spins, eligibility, budget tickets, re-spins, hidden reveal
  pacing, `bestSlots`), `leagues.js` (league/club weights), `team-ratings.js`, `club-lineups.js`
  (best XI per club, Hungarian assignment), `lineups.js` (random XIs).
- **UI** — `app.js` (match screen controller + canvas renderer + global wiring), `game-ui.js`
  (home + draft screens), `squad-ui.js` (cards, mini pitch), `draft-reel.js`,
  `budget-confirmation.js`, `playback.js`, `fullscreen.js` (TV mode), `sound.js` (Web Audio),
  `player-labels.js`.
- **Config** — `config.js` (`DEFAULT_CONFIG`, persisted overrides, `normalizeConfig`); each
  `Match` snapshots it into `match.tuning`.

## Invariants — do not break

- **Determinism.** The engine uses only its seeded RNG (`match.rand()`/`noise()`); same seed +
  config ⇒ identical match. Never use `Math.random()`/`Date.now()` inside simulation code. UI,
  audio and animation must never consume simulation or draft RNG (draft reels use their own state).
- **Config snapshot.** A running match reads `match.tuning` (or `player.tuning`), never live
  `CONFIG`. Changing settings must not alter an in-progress match or a replay.
- **Hot paths.** `Player.skill`, `positionFamiliarity`, `badgeBoost`, `dist`, `Match.plan` and the
  defensive assignment helpers run thousands of times per step. No allocations/closures there;
  caches must stay correct when tests mutate `p.attrs`/`p.tags`/`match.tuning` in place.
- **Behaviour-neutral refactors** of `app/engine.js` (or anything it imports) must keep
  `npm run sim:fingerprint` identical: record before (`… --json > /tmp/before.json`) and compare
  after (`node scripts/dev/sim-fingerprint.mjs --compare /tmp/before.json`). Intentional gameplay
  changes are expected to change it — then justify with tests/stats instead.
- **Data.** Never invent player ratings. The catalog comes only from the compiler.

## Data pipeline

Source: rovnez, "FC 26 (FIFA 26) player data", `FC26_20250921.csv` (18,405 rows, CC BY 4.0,
SHA-256 `4399cb2bcc2a14a2872e76a118f8f4bf64d7954503949c75751a14f33863e3b2`). An identical public
copy: `https://raw.githubusercontent.com/Din1225/Data-Mining-Hw1/2276bf1434028fbd55a564d450d3971e75b425c5/data/FC26_20250921.csv`.

```sh
node scripts/compile-league-catalog.mjs FC26_20250921.csv app/data/catalog-reference.json app/data/players-fc26.json
```

writes `players-fc26.json` and `players-runtime.json` deterministically (byte-identical reruns).
Selection policy (league caps, expansion) lives in `catalog-reference.json`; every selected
player's club must have a reviewed entry there.

## Conventions

- Plain modern JS (ES2024 modules), no framework, no runtime dependencies, no bundler.
- Prettier: single quotes, 100 columns, `arrowParens: avoid`. ESLint flat config.
- Escape any catalog text inserted with `innerHTML` (player/club names contain accents, quotes).
- UI must work at 390 px wide (touch) and 1366 px desktop; respect `prefers-reduced-motion`.
- After UI changes: `npm run shots -- --only <flow>` and look at the PNGs; update
  `tests/browser/flows.mjs` when selectors or flows change; `npm run test:browser` must pass.
- Commit in logical steps with clear messages; run `npm run check` first.
