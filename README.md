# World Cup Draft

A browser football (soccer) game. Spin for nations, leagues or clubs, draft an XI from 15,788
real EA SPORTS FC 27 player profiles, then take it through a World Cup in a continuous,
physics-based 2D 11v11 match simulation.

It is a static site: HTML, CSS and native ES modules with no build step, no server, no accounts.
Everything you do is saved in your own browser.

## How to play

1. **Pick a mode**, then a difficulty and a formation (Quick Match and Versus also pick a draft
   type).
2. **Spin.** One tap spins the reels; where they land is decided before they move. In a
   **World Cup** draft (the run and the Daily) two reels land an **era** — a World Cup cycle
   from France 98 to 2026 — and a **nation** of it, and you get that nation's squad of those
   years: 26 players at most, each at his best version of the cycle ("Brazil · Korea/Japan
   02"). Quick Match and Versus draft today's players: a nation's best 30, a league, or a
   club's squad.
3. **Pick and place.** Choose a player and the pitch lights up with how well he fits each open
   slot (`79 → 75` means he loses rating out of position). Lock him in. Eleven picks make your XI.
   A World Cup draft has three **tokens**, the same on every difficulty: one **nation
   respin** (the era stays, another nation), one **era respin** (another era; the nation stays
   when that era has it) and one **Prime** (a drafted player becomes his best version of all
   time). A player is in your XI once, whatever the era. Quick Match has one **re-roll**.
4. **Mates.** A player with a nation team-mate in your XI gets **+1.5**, with a club mate
   **+1**, with both **+2.5** (shown as a green chip on the pitch; the pool says who would
   get one).
   A **Leader** (an "L" on his card) gives every player of your XI **+1** more.
   **Budget mode** is the hard way: only 2 **Superstars** (rated 88+), 2 **Stars** (84–87) and
   3 **Starters** (80–83) — everyone else under 80.
5. **Play.** Before kick-off you can swap players, change formation and set tactics (in a World
   Cup Run the group stage is played in the formation you drafted in, and what you set up
   stays for the next matches). Watch
   **Key Moments** (highlights per half with a half-time team talk), the **Full** match live (three
   minutes, with live mentality and tactics), or go straight to an **Instant** result. All three
   are the same match: one seed, one result, however you watch it. The action camera follows the
   ball (the camera button or `C` switches to the whole pitch), and on **Auto** mentality your
   team reads the game itself: late on it pushes when behind and holds a lead.

### Modes

| Mode | What it is |
| --- | --- |
| **World Cup Run** | A draft across the World Cup eras (an era and a nation per spin), then a group of four (three matches; the top two advance, and so does a third place on 4 points or more, as the 2026 format's best thirds), Round of 32, Round of 16, quarter-final, semi-final and final — or the third-place play-off for the beaten semi-finalist. Three difficulties: Pro, World Class and Legendary, the main challenge. Win all eight for a perfect run; every run ends on a place (champions, runners-up, third, fourth or the round you went out in) with a Player of the Tournament and a shareable result, and gold, silver and bronze go into the trophy cabinet on Home (Budget-mode trophies in their own; the ultimate achievement is a perfect Legendary run in Budget mode). Each match can be watched as highlights (1 min) or in full (3 min), or simulated — one match or the whole cup. |
| **Daily Challenge** | One run a day, the same for everyone: the same eleven era and nation spins, the same respin landings and the same opponents. Scored with points and "% of the perfect XI"; keep a daily streak. |
| **Quick Match** | Draft from nations, leagues or clubs, then one match against an AI team at your difficulty. |
| **Versus** | Two players on one device, drafting from nations, leagues or clubs: a coin toss, alternating picks, then kick off. |
| **Exhibition** | Any two real teams, clubs or national sides, with no draft. |

### Draft types (Quick Match and Versus; the World Cup always spins eras and nations)

| Type | One spin lands on | You pick from |
| --- | --- | --- |
| **Nations** | one of 63 football nations, all equally likely | its best 30 players (those still available) |
| **Leagues** | one of 41 leagues (stronger tiers more likely) | anyone who plays in it |
| **Clubs** | a league, then one of its clubs | that club's squad |

Three difficulties — Pro, World Class and Legendary — set how strong the opponents are; the
tokens are the same on each. **Ball Knower** hides every rating
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

The offline copy follows deploys. `app/build.json` holds a build stamp: the Pages deploy writes
the commit there (the checked-in file says `dev`). The worker keeps one cache per stamp; the
first online launch of the installed app after a deploy caches the whole new build, and only
when it is complete are the older caches deleted — until then the previous complete copy keeps
answering offline. If you publish `app/` some other way, write a new value into `build.json`
with every publish (any text of letters, digits, `.`, `_` or `-`), or the installed app keeps
its first copy of the screens it does not open.

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
  build.json          build stamp of the offline copy ("dev" here; the deploy writes the commit)
  core/               pure logic, no DOM or storage; runs in Node
    sim/              match engine, rules, cards, periods, replay, shootouts, AI coach
    players/          ratings, badges, formations, club lineups, catalog codec
    draft/            draft session, pools, mates boosts, Budget mode, opponent ladder
    competition/      World Cup Run, fast rating model, Daily Challenge, share links
    config/           tuning defaults, the live config, normalisation
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
tools/research/       StatsBomb research scripts that produced the reference data, and
                      legacy-titles.py (the FIFA 98–14 workbook → data/legacy-titles.json)
docs/                 API contracts, UI guides, calibration notes, development history
```

## Data pipeline

The player catalog is compiled, never hand-edited. Source: EA SPORTS FC 27, EA's own ratings feed
as of 12 September 2026 (19,789 rows; the game uses the 17,849 men), from the public copy at
<https://raw.githubusercontent.com/LakshmiKanth11/EA_FC_ANALYSIS/c0b2542d9fcae72d2c538a472a30ee57c4e7c75e/EA_FC_PLAYERS_DATASET_AND_%20DASHBOARD/data/players.csv>
(SHA-256 `18ed434e5bb90f9afa72363d14438005c785eb4b8872a64c89c75bb38e14e911`; published on Kaggle as
"EA SPORTS FC 27 Player Ratings" by mikedpad). The feed names clubs and leagues without ids;
`npm run data:reconcile` ties them to the reviewed reference (`data/source-map.json`).

Legends and prime versions come from a second pinned source: `male_players (legacy).csv` of the
Hugging Face dataset [jsulz/FIFA23](https://huggingface.co/datasets/jsulz/FIFA23) (MIT; career-mode
players of FIFA 15–23 from sofifa.com, the same columns; revision
`0b74dbfc434808cf5573f0f11f4c977185bd0e0c`, 90,933,390 bytes, SHA-256
`13389f463935d257e92811eebbd50405df1a982aa45233a63d1ce075daca133e`). The years back to 1997
come from a third one, `data/legacy-titles.json` (in the repository): the squad players of
FIFA 98 … FIFA 14 (FIFA 98–2003 whole, then the best 36 + 4 keepers per nationality and
title), extracted from the games' own PC databases
([soccergaming.com archive](https://soccergaming.com/forums/threads/fifa-dbs-since-fifa-98-download.6469756/))
and copied out of a workbook by `tools/research/legacy-titles.py`. FC 24, FC 25 and FC 26 each
come from a pinned public copy of an openly published file (`MODERN_SOURCES` in
`scripts/data/paths.mjs`: revision, SHA-256 and the licence each states).

```sh
npm run data:fetch   # downloads the five pinned CSVs into data/raw/ and checks their SHA-256
npm run data:reconcile  # a new snapshot only: its club, league and nation names -> the reference
npm run data:build   # compiles app/data/catalog.v3.json, legends.v1.json, eras.v1.json, the
                     # flags and data/build/*.json (provenance)
python3 -I tools/research/legacy-titles.py ratings.xlsb data/legacy-titles.json
                     # a new FIFA 98–14 workbook only (pyxlsb); the build needs no Python
```

The build is deterministic, so a rerun is byte-identical. The catalog holds every player of every
club we have reviewed metadata for (15,788 players, 553 clubs in 41 leagues, 163 nations),
including 831 players rated 65+ whose clubs the game does not carry (nation pools only), plus
precomputed badges, club ratings and club best XIs.
League selection and the reviewed club metadata (Opta scores, colours, logos) live in
`data/catalog-reference.json`; the Captains are a reviewed list of the leaders of 1997–2026, each with his eras
(`data/captains.json`), the GOAT cards a list of player + era (`data/goats.json`). `app/data/legends.v1.json` (no longer loaded by the game: the World Cup draft and the Prime
read the era file) holds 431 legends — best past versions of 1997–2025 the game shows at 85+: 307
players who are not in the catalog and 124 catalog players who were at least two points better
then — and the prime versions of 4,815 catalog players (any gain on today's card), compiled by
the same compiler. `app/data/eras.v1.json` holds the era pools: for each of eight World Cup
cycles (France 98 … USA/Canada/Mexico 26) and each nation that can field a squad then (50 to 81 per era), its
best 26 players, each at his best version of those years — 13,762 cards of 7,743 people. A
past version shows the overall EA gave it that year, lifted at the top where EA rated its best
lower than it does today (FIFA 09–16; never lowered): Messi ’15 95, Cristiano Ronaldo ’18 94.
FIFA 98–08 printed none and are chain-linked to FIFA 09's scale through the players
neighbouring titles share (Ronaldo ’03 94, Zidane ’03 and Ronaldinho ’03 93). A draft
offers only players shown at 65 or more (10,968 of the 15,788); teams field their real players.

## Deploy

Deploying means publishing the `app/` folder to any static host; nothing else in the
repository is needed at runtime.

`.github/workflows/ci.yml` runs the format check, lint, tests and browser smoke test once per
change: on every pull request and on every push to `main` (or by hand: Actions → CI → Run
workflow). On `main`, a green run then deploys `app/` to GitHub Pages (without the component
gallery, a development page, and with the commit as the build stamp in `build.json`), so nothing is published that did not pass. To use it, enable Pages
once under **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Credits and licences

- **Player data:** EA SPORTS FC 27 player ratings as published by EA (12 September 2026), from
  the copy in [EA_FC_ANALYSIS](https://github.com/LakshmiKanth11/EA_FC_ANALYSIS) by Lakshmi
  Kanth (no licence stated there); player data belongs to Electronic Arts. Player ratings are
  converted, not invented (see the compiler).
- **Legends and prime versions:** the [FIFA23 dataset](https://huggingface.co/datasets/jsulz/FIFA23)
  by jsulz on Hugging Face (`male_players (legacy).csv`, FIFA 15–23 career-mode players), MIT
  licence; upstream data from SoFIFA / EA SPORTS FIFA. The versions of 1997–2013 (FIFA 98–14)
  were extracted from the games' own databases
  ([soccergaming.com archive](https://soccergaming.com/forums/threads/fifa-dbs-since-fifa-98-download.6469756/);
  no licence stated — player data belongs to Electronic Arts). The versions of 2023–2025:
  FC 24 from stefanoleone992's "EA Sports FC 24 complete player dataset" (SoFIFA; copy
  [Belkin7/fifa24-player-values](https://huggingface.co/datasets/Belkin7/fifa24-player-values)
  on Hugging Face, no licence stated), FC 25 from EA's ratings feed (copy in
  [Rayen Khammessi's repository](https://github.com/Rayen-khammessi/Football-Data-Engineering-Analytics-Project-EA-Sports-FC-25),
  no licence stated) and FC 26 from rovnez's "FC 26 (FIFA 26) player data" (SoFIFA, CC BY 4.0;
  copy in [Din1225/Data-Mining-Hw1](https://github.com/Din1225/Data-Mining-Hw1)).
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
