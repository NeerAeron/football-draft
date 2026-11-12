# World Cup Draft

A browser football (soccer) game. Spin for nations, leagues or clubs, draft an XI from 15,378
real EA SPORTS FC 26 player profiles, then take it through a World Cup in a continuous,
physics-based 2D 11v11 match simulation.

It is a static site: HTML, CSS and native ES modules with no build step, no server, no accounts.
Everything you do is saved in your own browser.

## How to play

1. **Pick a mode**, then a difficulty and a formation (Quick Match and Versus also pick a draft
   type).
2. **Spin.** One tap spins the reel; where it lands is decided before it moves. You get the
   players of what it lands on: a nation's best 23 call-ups, a league, or a club's squad.
3. **Pick and place.** Choose a player and the pitch lights up with how well he fits each open
   slot (`79 → 75` means he loses rating out of position). Lock him in. Eleven picks make your XI.
   A limited number of **re-rolls** (by difficulty) spin again without the options you saw.
4. **Mates.** A player with a nation team-mate in your XI gets **+1.5**, with a club mate
   **+1**, with both **+2.5** (shown as a green chip on the pitch; the pool says who would
   get one).
   **Budget mode** is the hard way: only 1 **Superstar** (rated 88+), 2 **Stars** (84–87) and
   3 **Starters** (80–83) — everyone else under 80.
5. **Play.** Before kick-off you can swap players, change formation and set tactics (in a World
   Cup Run the first match is played in the formation you drafted in). Watch
   **Key Moments** (highlights per half with a half-time team talk), the **Full** match live (three
   minutes, with live mentality and tactics), or go straight to an **Instant** result. All three
   are the same match: one seed, one result, however you watch it. The action camera follows the
   ball (the camera button or `C` switches to the whole pitch), and on **Auto** mentality your
   team reads the game itself: late on it pushes when behind and holds a lead.

### Modes

| Mode | What it is |
| --- | --- |
| **World Cup Run** | A Nations draft, then a group of four (three matches; the top two advance, and so does a third place on 4 points or more, as the 2026 format's best thirds), Round of 32, Round of 16, quarter-final, semi-final and final — or the third-place play-off for the beaten semi-finalist. Three difficulties: Pro, World Class and Legendary, the main challenge. Win all eight for a perfect run; every run ends on a place (champions, runners-up, third, fourth or the round you went out in) with a Player of the Tournament and a shareable result, and gold, silver and bronze go into the trophy cabinet on Home (Budget-mode trophies in their own; the ultimate achievement is a perfect Legendary run in Budget mode). Each match can be watched as highlights (1 min) or in full (3 min), or simulated — one match or the whole cup. |
| **Daily Challenge** | One run a day, the same for everyone: the same eleven Nations spins, re-roll alternates and eight opponents. Scored with points and "% of the perfect XI"; keep a daily streak. |
| **Quick Match** | Draft from nations, leagues or clubs, then one match against an AI team at your difficulty. |
| **Versus** | Two players on one device, drafting from nations, leagues or clubs: a coin toss, alternating picks, then kick off. |
| **Exhibition** | Any two real teams, clubs or national sides, with no draft. |

### Draft types (Quick Match and Versus; the World Cup is always Nations)

| Type | One spin lands on | You pick from |
| --- | --- | --- |
| **Nations** | one of the 48 strongest football nations (in four pots) | its best 23 available call-ups |
| **Leagues** | one of 40 leagues (stronger tiers more likely) | anyone who plays in it |
| **Clubs** | a league, then one of its clubs | that club's squad |

Three difficulties — Pro, World Class and Legendary — set your re-rolls (2, 1, 1) and how
strong the opponents are. **Ball Knower** hides every rating
until the end; **one player per nation** is an extra challenge for nation spins. Results can be
shared as text or an image, and **Challenge a friend** links replay the same spins and opponents.

## Run it

```sh
npm ci        # dev tools only (Prettier, ESLint); the game itself needs nothing installed
npm run dev   # http://127.0.0.1:8000 with live reload
```

Without Node.js, serve `app/` with any static server, for example
`python3 -m http.server 8000 --bind 127.0.0.1 --directory app`. Opening the HTML from `file://`
does not work (modules, workers and the player catalog have to load over HTTP).

Pages: `index.html` is the game and `gallery.html` the component gallery. Engine, draft and
rating parameters are tuned in code (`DEFAULT_CONFIG` in `app/core/config/config.js`), not by
players.

### Install it, play offline

The game is an installable web app: **Add to Home Screen** on a phone, or **Install** in a
desktop browser. The first launch of the installed app (online) caches the whole game once (about
2.3 MB to download, 5.6 MB on the device); after that it opens and plays without a network. In an ordinary browser tab only
what you have used is kept. Online, every file is always fetched fresh: the service worker
(`app/sw.js`) is network-first and its cache is only a fallback. It is not registered on
`localhost`/`127.0.0.1` (development and tests) unless the URL has `?sw=1`.

Shared links unfurl with a preview card (`app/assets/og-image.png`). Its absolute address in
`app/index.html` (`og:url`, `og:image`, `twitter:image`) points at the GitHub Pages deployment,
`https://neeraeron.github.io/football-draft/`; change those three tags if you host it elsewhere.
`node tools/og/render.mjs` re-renders the card and the app icons from `tools/og/og-image.html`.

## Development

Node 22 or newer. Run everything from the repository root.

| Command | What it does |
| --- | --- |
| `npm run check` | Prettier check, ESLint and the fast tests — run before every commit |
| `npm run test:fast` | unit tests without the full-match simulations |
| `npm test` | every `node:test` suite in `tests/` |
| `node scripts/dev/test.mjs draft session` | only test files whose path contains a word |
| `node scripts/dev/test.mjs --grep "offside"` | only tests whose name matches |
| `npm run test:browser` | Playwright smoke run of every UI flow, three at a time; fails on console or page errors |
| `npm run shots -- --only draft --desktop` | screenshots of the flows into `.shots/` |
| `npm run sim:fingerprint` | deterministic results and hashes of 12 full matches, plus timings |
| `npm run format` / `npm run lint` | Prettier write / ESLint (zero warnings allowed) |
| `npm run verify` | everything, including the full tests and the browser smoke run |

The browser tools need Playwright with Chromium available to Node (`require('playwright')`).
[`CLAUDE.md`](CLAUDE.md) has the module map, the storage keys and the invariants changes must
keep (determinism, per-match config snapshots, hot paths, behaviour-neutral refactors).
[`docs/`](docs/README.md) holds the API contracts and UI guides.

### Project layout

```
app/                  the deployed site, served as-is
  index.html          the game (loads ui/main.js)
  gallery.html        component gallery
  manifest.webmanifest, sw.js   install metadata and the offline service worker
  core/               pure logic, no DOM or storage; runs in Node
    sim/              match engine, rules, cards, periods, replay, shootouts, AI coach
    players/          ratings, badges, formations, club lineups, catalog codec
    draft/            draft session, pools, mates boosts, Budget mode, opponent ladder
    competition/      World Cup Run, fast rating model, Daily Challenge, share links
    config/           tuning defaults, saved overrides, normalisation
    util/             seeded RNG, math and text helpers
  services/           catalog loader, simulation worker + client, sound, playback clock
  ui/                 the interface: Preact + htm (vendored), shell, components, screens
  data/               catalog.v3.json, the compiled player catalog the game fetches
  assets/             league logos, flags, fonts, app icons, the link-preview card
data/                 compiler inputs and reference data (not deployed)
scripts/              catalog compiler; scripts/data/ the data pipeline, scripts/dev/ dev tools
tests/                node:test suites, fixtures, browser flows
tools/calibration/    calibration runners (manual, not part of the tests)
tools/og/             the link-preview card and app icons (HTML template + render script)
tools/research/       StatsBomb research scripts that produced the reference data
docs/                 API contracts, UI guides, calibration notes, development history
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
national-team players without a club, plus precomputed badges, club ratings and club best XIs.
League selection and the reviewed club metadata (Opta scores, colours, logos) live in
`data/catalog-reference.json`.

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
- **Fonts:** [Barlow Condensed](https://github.com/jpt/barlow) (The Barlow Project Authors) and
  [Inter](https://github.com/rsms/inter) (The Inter Project Authors), both under the SIL Open
  Font License 1.1 (`app/assets/fonts/OFL-*.txt`).
- **Libraries** (vendored, unmodified, in `app/ui/vendor/` with their licence files):
  [Preact](https://preactjs.com/) 10.29.8 (MIT), [htm](https://github.com/developit/htm) 3.1.1
  (Apache-2.0) and a subset of [Lucide](https://lucide.dev/) icons (ISC).
- **Research baselines:** [StatsBomb Open Data](https://github.com/hudl/open-data) (2022 World Cup
  and Euro 2024, pinned commit `4b73468f`), summarised in `data/rules-reference.json` and
  `data/goal-location-reference.json`; no raw event data is bundled.
- **Rules:** modelled on the [IFAB Laws of the Game](https://www.theifab.com/laws/) (offside,
  fouls and misconduct, penalty kick).

EA SPORTS FC, club, league and competition names are trademarks of their respective owners; this
is an unofficial fan project.

The development history before the overhaul is in [`docs/history.md`](docs/history.md).
