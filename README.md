# Football Draft Challenge

A browser football (soccer) game. Draft an XI from 7,733 real EA SPORTS FC 26 player profiles
across 40 leagues, then watch and coach a continuous, physics-based 2D 11v11 match.

- **Modes:** Classic Draft Challenge against an AI club (Very Easy → Impossible), shared-device
  player vs player, and a Sandbox with every stored club and the full player catalog.
- **Draft:** league and club spins weighted by tier and Opta strength, optional budget tiers,
  re-spins, ten formations.
- **Match:** a deterministic fixed-step simulation (5 min, 3 min, 1-minute highlights or an
  instant result) with styles and tactics, badges, stamina, fouls, yellow and red cards,
  penalties, offside, restarts and added time, plus a post-match report with player ratings.

It is a static site: plain HTML, CSS and native ES modules, no build step, no runtime
dependencies, no accounts or server.

## Run it

```sh
npm ci        # dev tools only (Prettier, ESLint); the game itself has no dependencies
npm run dev   # http://127.0.0.1:8000 with live reload
```

Without Node.js, serve `app/` with any static server, for example
`python3 -m http.server 8000 --bind 127.0.0.1 --directory app`. Opening the HTML from `file://`
does not work (modules and the player catalog have to load over HTTP).

## Development

Node 22 or newer. Run everything from the repository root.

| Command | What it does |
| --- | --- |
| `npm run check` | Prettier check, ESLint and the fast tests — run before every commit |
| `npm run test:fast` | unit tests without the full-match simulations |
| `npm test` | every `node:test` suite in `tests/` |
| `node scripts/dev/test.mjs draft respin` | only test files whose path contains a word |
| `node scripts/dev/test.mjs --grep "offside"` | only tests whose name matches |
| `npm run test:browser` | Playwright smoke run of every UI flow; fails on console or page errors |
| `npm run shots -- --only draft --desktop` | screenshots of the flows into `.shots/` |
| `npm run sim:fingerprint` | deterministic results and hashes of 12 full matches, plus timings |
| `npm run format` / `npm run lint` | Prettier write / ESLint (zero warnings allowed) |
| `npm run verify` | everything, including the full tests and the browser smoke run |

The browser tools need Playwright with Chromium available to Node (`require('playwright')`).
[`CLAUDE.md`](CLAUDE.md) has the module map and the invariants that changes must keep
(determinism, per-match config snapshots, hot paths, behaviour-neutral refactors).

## Project layout

```
app/                  the deployed site, served as-is
  index.html          game shell (legacy UI)
  config.html         tuning page (legacy UI)
  core/               pure logic, no DOM or storage; runs in Node
    sim/              match engine, rules, cards, periods, replay, AI coach
    players/          ratings, badges/traits, formations, club and random lineups
    draft/            draft state machine, league/club weights, AI opponent selection
    config/           defaults, persisted overrides, normalisation
    util/             seeded RNG, math and text helpers
  services/           browser services shared by UIs: sound, playback clock, fullscreen
  legacy/             the current UI (scripts and stylesheets)
  data/               catalog.v3.json, the compiled player catalog the game fetches
  assets/             league logos, flags
data/                 compiler inputs and reference data (not deployed)
scripts/              catalog compiler and audit export; scripts/dev/ holds the dev tools
tests/                node:test suites, fixtures, browser flows
tools/calibration/    calibration and integration runners (manual, not part of the tests)
tools/research/       StatsBomb research scripts that produced the reference data
docs/                 development history and calibration notes
```

## Data pipeline

The player catalog is compiled, never hand-edited. Source: rovnez, "FC 26 (FIFA 26) player
data" on Kaggle, file `FC26_20250921.csv` (18,405 rows, CC BY 4.0, SHA-256
`4399cb2bcc2a14a2872e76a118f8f4bf64d7954503949c75751a14f33863e3b2`). An identical public copy:
<https://raw.githubusercontent.com/Din1225/Data-Mining-Hw1/2276bf1434028fbd55a564d450d3971e75b425c5/data/FC26_20250921.csv>.

```sh
npm run data:fetch   # downloads the pinned CSV into data/raw/ and checks its SHA-256
npm run data:build   # compiles app/data/catalog.v3.json, the flags and data/build/players-fc26.json
```

The build is deterministic, so a rerun is byte-identical. The catalog holds every player of every
league we have reviewed club metadata for (15,378 players, 546 clubs, 152 nations), including
national-team players without a club. League selection and the reviewed club metadata (Opta
scores, colours, logos) live in `data/catalog-reference.json`.

## Deploy

Deploying means publishing the `app/` folder to any static host; nothing else in the
repository is needed at runtime.

GitHub Pages is set up in `.github/workflows/pages.yml`: every push to `main` (or a manual run)
uploads `app/` and deploys it. To use it, enable Pages once under **Settings → Pages → Build and
deployment → Source: GitHub Actions**. `.github/workflows/ci.yml` runs the format check, lint,
tests and browser smoke test on every push and pull request.

## Credits and licences

- **Player data:** "FC 26 (FIFA 26) player data" by rovnez, licensed
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); upstream data from SoFIFA /
  EA SPORTS FC. Player ratings are converted, not invented (see the compiler).
- **Club and league strength:** a September 2026 snapshot of the
  [Opta Power Rankings](https://dataviz.theanalyst.com/opta-power-rankings/), stored in
  `data/catalog-reference.json`.
- **Flags:** [flag-icons](https://github.com/lipis/flag-icons) 7.6.0 by Panayiotis Lipiridis,
  MIT licence (`app/assets/flags/LICENSE`), optimised with svgo.
- **League logos:** provided via [TheSportsDB](https://www.thesportsdb.com/) and the
  Brack.Alltron official media kit; per-asset sources and terms are in
  `data/league-logo-sources.json`. League names and logos belong to their respective owners.
- **Research baselines:** [StatsBomb Open Data](https://github.com/hudl/open-data) (2022 World Cup
  and Euro 2024, pinned commit `4b73468f`), summarised in `data/rules-reference.json` and
  `data/goal-location-reference.json`; no raw event data is bundled.
- **Rules:** modelled on the [IFAB Laws of the Game](https://www.theifab.com/laws/) (offside,
  fouls and misconduct, penalty kick).

EA SPORTS FC, club and league names are trademarks of their respective owners; this is an
unofficial fan project.

The development history before the current overhaul is in [`docs/history.md`](docs/history.md).
