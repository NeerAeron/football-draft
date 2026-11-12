# World Cup Draft — agent guide

Browser football (soccer) game, **World Cup Draft**: draft an XI from real EA FC 27 players, then
play it through a continuous 2D 11v11 physics simulation in a World Cup Run (Nations draft only), the Daily Challenge, a Quick Match,
local Versus or an Exhibition. Static site, **no build step**: `app/` is served as-is (native ES
modules; Preact + htm are vendored). Node ≥ 22 for tooling/tests. Only dev dependencies
(Prettier, ESLint, svgo, flag-icons for the data build).

## Commands (run from repo root)

| Command | What it does | Time |
| --- | --- | --- |
| `npm ci` | install dev tools | ~3 s |
| `npm run dev` | serve `app/` on http://127.0.0.1:8000 with live reload | — |
| `npm run check` | Prettier check + ESLint + fast tests — **run before every commit** | ~10 s |
| `npm run test:fast` | unit tests minus full-match simulations | ~7 s |
| `npm test` | all tests (`node:test`) | ~35 s |
| `node scripts/dev/test.mjs draft session` | only test files whose path contains a word | — |
| `node scripts/dev/test.mjs --grep "offside"` | only tests whose name matches | — |
| `npm run test:browser` | Playwright smoke run of every UI flow (3 at a time; `--jobs N`), fails on console/page errors | ~1.5 min |
| `npm run shots -- --only draft --desktop` | screenshots into `.shots/` (view PNGs with the Read tool) | — |
| `npm run sim:fingerprint` | deterministic results/hashes of 12 full matches + timings | ~6 s |
| `npm run format` / `npm run lint` | Prettier write / ESLint (`--max-warnings 0`) | — |
| `npm run verify` | everything incl. full tests + browser smoke (before pushing) | ~4 min |
| `npm run data:fetch` / `npm run data:build` | pinned source CSVs / rebuild the catalog and legends (see below) | ~30 s |
| `npm run data:reconcile` | tie a new source snapshot's club, league and nation names to the reference (`data/source-map.json`) | ~1 s |
| `node tools/og/render.mjs` | re-render the link-preview card and app icons | — |
| `npm run preload` | regenerate the preload block of `app/index.html` after adding/removing an import or stylesheet of the first screen (a test fails until you do) | — |
| `node tools/calibration/blunders.mjs` | count frustrating plays over 24 club fixtures (`--compare`, `--list <type>`) | ~15 s |
| `node tools/calibration/watch.mjs --fixture 3 --at 81.4` | contact sheet (PNG) of what the engine did around a moment — view it with the Read tool | ~3 s |

Browser tooling uses the machine's pre-installed Playwright + Chromium (`require('playwright')`).
Never `npm i playwright` or run `playwright install` locally (CI installs its own copy).

## Layout

```
app/                     served statically (deploy = publish this folder); runtime files only
  index.html             the game: import map (preact, htm), fonts → ui/main.js
  gallery.html           component gallery (design review, screenshot QA)
  manifest.webmanifest   install metadata (icons, shortcuts); og/twitter preview tags live in index.html
  sw.js                  offline service worker, network first (registered by ui/lib/offline.js)
  core/                  pure logic: no DOM, no storage, Node-testable
    sim/                 match engine, rules, cards, periods, replay, shootout, in-match AI coach
    players/             ratings, badges, formations, club lineups, catalog codec + derived data
    draft/               draft session, catalog pools, Links, opponent ladder, nation codes
    competition/         World Cup Run (cup), fast rating model, Daily Challenge, share/links
    config/              DEFAULT_CONFIG, live CONFIG, normalizeConfig, CONFIG_FIELDS
    util/                rng.js (LCG), math.js (clamp/lerp/dist), text.js (escapeHtml, searchKey)
  services/              browser services any UI can use: catalog, sim client/worker, sound, playback
  ui/                    the UI (Preact + htm, no build) — read docs/ui-guide.md before touching it
    main.js routes.js    entry (renders the shell) and the hash-route table
    shell/               app frame: outlet, transitions, focus, top bar, how-to-play, errors
    lib/                 framework-free helpers and stores (Node-testable; see "Stores" below)
    components/          shared components (<name>.js + <name>.css), exported from index.js
    screens/<name>/      home, setup, draft, prematch, match, run, daily, exhibition, settings,
                         placeholder (not found) — one folder per screen
    styles/              app.css (the one stylesheet entry, cascade layers), tokens, base, fonts
    gallery/             gallery page + generated fixture (make-fixture.mjs)
    vendor/              Preact 10.29.8, htm 3.1.1, Lucide icon subset (+ licences, README.txt)
  data/catalog.v3.json   compiled columnar catalog (decode via services/catalog.js)
  data/legends.v1.json   Legends + Prime versions, fetched when a World Cup draft starts (services/legends.js)
  assets/                logos/ (league logos, 256 px palette PNGs), flags/ (flag-icons SVGs, MIT),
                         fonts/ (woff2 + OFL), icons/ (app icons), og-image.png (link-preview card)
data/                    repo root, NOT deployed: catalog-reference.json (compiler input),
                         source-map.json (the source's club/league/nation names → the reference),
                         captains.json (reviewed Captain list with sources), logo and
                         nation-code sources, rules-/goal-location-reference.json (research outputs);
                         raw/ (downloaded CSV) and build/ (provenance catalog) are generated, gitignored
scripts/                 catalog compiler (compile-league-catalog.mjs + compile-players.mjs),
                         compile-legends.mjs (Legends and Prime versions from the legacy CSV)
scripts/data/            data:fetch / data:reconcile / data:build pipeline (ea-source.mjs adapts the
                         source rows); catalog-file.mjs = loadRuntimeCatalog() for Node
scripts/dev/             serve.mjs, test.mjs, browser.mjs, sim-fingerprint.mjs
tests/*.test.mjs         node:test suites; tests/fixtures/ inputs (also used by tools/calibration)
tests/browser/flows.mjs  Playwright flows used by test:browser and shots — keep selectors in sync
tools/calibration/       manual calibration runners (write to /tmp; not run by npm test), incl.
                         match-calibration.mjs (engine stats, docs/calibration.md),
                         draft-baselines.mjs (MODE_BASELINES), ai-calibration.mjs (ladder results),
                         cup-calibration.mjs (fast-model fit, CUP_TUNING odds, docs/competition-api.md),
                         blunders.mjs (detector of frustrating plays) + watch.mjs (frame viewer),
                         lib/fixtures.mjs (their deterministic club fixtures)
tools/research/          StatsBomb research scripts (Python) behind data/*-reference.json
tools/og/                og-image.html + render.mjs: re-renders og-image.png and the app icons
docs/                    contracts, guides and calibration notes — index in docs/README.md
.github/workflows/       ci.yml: format, lint, tests, browser smoke — once per change (pull requests,
                         pushes to main, manual); on main a green run deploys app/ to Pages
```

**Contracts** (keep them current when you change the code they describe): `docs/ui-guide.md`
(folders, components, tokens, routing, stores, a11y), `docs/draft-api.md` (draft session,
Links, opponents), `docs/competition-api.md` (cup, fast model, daily, share/links),
`docs/engine-events.md` (match state/events), `docs/ui-match.md` (match requests/results, sim
client), `docs/ui-draft.md` (setup, draft board, pre-match), `docs/ui-run.md` (run, daily,
exhibition, challenge links, persistence).

**Import rules.** `ui/` may import `core/` and `services/`; `services/` may import `core/`;
`core/` never imports `services/` or `ui/`. Inside `core/`, the engine (`sim/`)
imports only `sim/`, `players/`, `config/` and `util/` — never `draft/` or `competition/`.
Runtime URLs such as catalog asset paths (`./assets/logos/…`, `./assets/flags/…`) and worker
modules resolve against the page in `app/`, not against the module file. Load the catalog only
through `loadCatalog()` (`app/services/catalog.js`, browser) or `loadRuntimeCatalog()`
(`scripts/data/catalog-file.mjs`, Node) — never fetch the JSON directly; screens that draft,
build a run or list opponents use `loadWarmCatalog()` (`ui/lib/catalog-warm.js`: the same
catalog, with core's rating caches filled in short slices first). The decoded catalog has
`players`, `leagues`, `teams`, `nations` and the Maps `byId`, `byNation`, `byLeague`, `byClub`
(the last three are built on first use); players whose club has no reviewed entry have
`source.club === null` and appear only in nation pools.

### Module map (`app/core/` unless noted)

- **Simulation** (`sim/`) — `engine.js` is the public entry (`Match`, `Player`, re-exports);
  `match.js` (state, clock, config import/export, fixed 1/60 s loop) installs the behaviour
  modules on `Match.prototype`: `planning.js`, `movement.js`, `possession.js`, `decisions.js`,
  `passing.js`, `shooting.js`, `ball.js`, `defence.js`, `restarts.js`, `fouls.js`. Also
  `player.js` (skill/awareness/speed view), `player-model.js` (hidden tendencies), `rules.js`
  (offside), `discipline.js` (cards; `fouls.js coverDismissal` reshapes a side to ten men),
  `keeper.js` (dive/save model; a save's ball does what its `saveType` says), `goal-zones.js`,
  `insights.js` (xG fitted to the engine's own conversion, situations — display only), `periods.js` (clock, stoppage), `shootout.js` (extra time, penalties), `replay.js`
  (record, highlights, `simulateComplete`/`simulateHalf`, `performanceRating`), `coach.js`
  (`coachAI` for side 1 in AI mode, `tacticAccess`), `constants.js`.
- **Players** (`players/`) — `ratings.js` (attributes, role weights, `overallRating`,
  `positionFamiliarity`, `playerTier`), `traits.js` (BADGES, styles, tactics, `badgeBoost`),
  `badges.js` (badge ranking/normalisation by tier), `formations.js` (21 formations: `[x, y,
  role]` rows, `formationLabel`), `team-ratings.js`, `club-lineups.js` (club squads, best XI per
  formation by Hungarian assignment, catalog stamps), `lineups.js` (seeded random XIs,
  `playerInitials`), `player-labels.js` (`commonName`), `catalog-codec.js` (v3 encode/decode,
  `indexCatalog`), `catalog-derived.js` (precomputed badges/club data, `reconcileCatalog`),
  `legends-codec.js` + `legends.js` (Legends and Prime versions: `attachLegends` puts them on
  `catalog.legends` — never in `catalog.players`; `legendPlayer`, `primeVersion`,
  `baseProfileId`, `editionLabel`: the UI shows the year of that version's ratings — stored
  with it, never the edition; a legend can be a catalog player's best past version, `legendOf`).
- **Draft** (`draft/`) — `session.js` (`createDraftSession`/`restoreDraftSession`: spins,
  re-rolls, picks, placement, the Legend spin (`legendSpin`: the first spin of a World Cup
  draft) and Prime boosts (`primes`, `prime(slot)`), `matchSide`, `buildSide`, `matchSetup`/`applyMatchSetup`,
  `DIFFICULTIES`: `pro`, `worldclass`, `legendary`; removed ids read as Pro via `difficultyOf`), `pools.js` (catalog index: nations field/pots, leagues, clubs, `callUps`,
  `bestEleven`, cached role ratings, `catalogStamp`, `selectable`: drafts offer only players shown at `draft.pickMinimum` (65) or more — pools and spin guards; teams' XIs never ask; `playable` = the 56 strongest nations that can field an XI (`nations.playableSize`), on the reel and met as an opponent, `field` = its strongest 48 in pots, `spinField` = the reel; `legendIndex` for the Legend spin), `links.js` (`teamLinks`, chem: nation mate +1.5, club mate +1, +1 for everyone with a Captain), `budget.js` (the player tiers Superstar 88+ / Star 84+ / Starter 80+ and Budget mode's slots),
  `opponents.js` (difficulty ladder: `pickOpponent`, `buildOpponent`, `opponentCandidates`,
  `ladderPreview`, `MODE_BASELINES`), `nation-codes.js`.
- **Competition** (`competition/`) — `cup.js` (`createCupRun`/`restoreCupRun`: group (top two +
  best thirds, `BEST_THIRD`) + five knockouts from the Round of 32 (the semi-final loser plays the
  third-place play-off), places and medals instead of grades (`PLACES`), Pro / World Class on the
  ladder (`CUP_TUNING`), Legendary on a real 48-nation World Cup (`worldCupDraw`: each run qualifies its own 48 of the playable nations, the top 30 always, the rest weighted by strength), standings, `projectRun`), `model.js` (fast Poisson rating model, shootouts),
  `daily.js` (daily seed/schedule/opponents, perfect XI, points, streaks), `share.js` (share
  text, challenge-link encode/decode).
- **Config** (`config/config.js`) — `DEFAULT_CONFIG` (draft session, player/team tiers, AI
  club-XI fit + coach, gameplay, the favourite's edge (`userEdge`: a slightly better save balance for the user's side when it is the stronger team, AI matches only), discipline, stamina, periods, formats, ratings, badges), live
  `CONFIG` (a copy of the defaults; `setRuntimeConfig` for tools and tests — nothing is stored),
  `normalizeConfig` (validates a patch; unknown keys are ignored), `CONFIG_FIELDS`. Each
  `Match` snapshots it into `match.tuning`; a draft session snapshots `CONFIG.draft`.
- **Util** (`util/`) — `rng.js` (`lcgNext`, `lcg(seed)`, `LCG_RANGE`: the one LCG everyone
  uses, each with its own state), `math.js`, `text.js` (`escapeHtml`, `foldDiacritics`,
  `searchKey`).
- **Services** (`app/services/`) — `catalog.js` (`loadCatalog`, cached), `legends.js`
  (`loadLegends`: the legends file, attached to the catalog), `sim-client.js`
  (`createSimClient`: Instant results and Key Moments halves in a module Worker, main-thread
  fallback) + `sim-worker.js` (the worker; `runSimJob`, `hydrateMatch`), `sound.js` (Web Audio
  cues, `MatchSoundEvents`, `selectionSound`), `playback.js` (`PlaybackClock`).
- **UI stores and state** (`app/ui/lib/`) — `store.js` (`createStore`/`useStore`), `router.js`
  (hash router), `prefs.js`, `audio.js`, `motion.js`, `draft-store.js` (draft hand-off),
  `prematch-store.js` (pre-match edits → kick-off), `match-store.js` (match requests/results),
  `run-store.js` (run/daily persistence, links), `records.js` (trophy cabinet: medals per difficulty, the Budget cabinet, the
  ultimate achievement; `recordRun`, `readRecords`), `saved.js` (tolerant readers for Home, incl. `readSavedDraft`), `storage.js` (safe localStorage), `player-view.js`, `share-image.js`,
  `tiers.js`, `color.js`, `kits.js` (nation kits, FIFA trigrams, `teamCode`), `format.js` (the
  only way to format displayed numbers: `fmt1`/`fmt2`/`int`/`signed1`/`pct`, never
  `toLocaleString`), `catalog-warm.js` (`loadWarmCatalog`, `warmOpponents`), `offline.js`
  (`registerOffline`: service worker + one-time warm-up of the installed app).
  The match stage (`ui/screens/match/renderer/`): the pitch is a DOM layer (`pitch.js`) under a
  transparent token canvas (`draw.js`), framed by `camera.js` (action camera: follows the ball,
  eases out for long balls, shots and set pieces; the ball never leaves the frame) — details in
  `docs/ui-match.md`. `draw()` runs every frame: no objects, arrays, closures or `measureText`
  there.
  Run auto-sims (`ui/screens/run/auto-sim.js`) play every remaining match with the engine in a
  module Worker (`auto-sim-worker.js`), falling back to main-thread slices; the Daily's perfect
  XI is computed in `ui/screens/daily/perfect-xi-worker.js` the same way. A new module worker
  must also be listed in `WORKERS` in `ui/lib/offline.js` (so the installed app caches it).
- **Tuning** is for developers only: edit `DEFAULT_CONFIG` (and rebuild data / recalibrate as
  the invariants say); tools take `--tuning` patches. Players cannot tune: `CONFIG` is a copy
  of `DEFAULT_CONFIG`, nothing reads saved settings, and `ui/main.js` deletes the old
  `football-draft-settings-v1` key.

### localStorage keys (all start with `football-draft`; Settings → Reset clears exactly those)

| Key | Owner | Holds |
| --- | --- | --- |
| `football-draft-ui` | `ui/lib/prefs.js` | motion, hideRatings, onboarded, draftType |
| `football-draft-sound` | `services/sound.js` | muted, volume |
| `football-draft-setup` | setup screen | last choices per mode |
| `football-draft-draft` | `draft-store.js` | the draft in progress (`session.serialize()`) |
| `football-draft-prematch` / `-match-view` | `prematch-store.js` | pre-match edits / last view |
| `football-draft-match` | `match-store.js` | current match request + result |
| `football-draft-match-camera` | `screens/match/camera-prefs.js` | camera per view (`key`/`full`: `'action'` or `'wide'`) |
| `football-draft-run-state` / `-run` | `run-store.js` | full run state / Home summary |
| `football-draft-daily` | `run-store.js` | daily streak, results, attempt in progress |
| `football-draft-records` | `ui/lib/records.js` | trophy cabinet: runs, medals and best finish per difficulty, Budget-mode trophies, the ultimate achievement |
| `football-draft-exhibition` | exhibition screen | last two teams |
| `football-draft-dev` | tests only | `{ fastSim: true }`: auto-sims use the fast model |

Shapes are in `docs/ui-draft.md`, `docs/ui-match.md` and `docs/ui-run.md`; readers must stay
tolerant of missing or broken data.

## Invariants — do not break

- **Determinism.** The engine uses only its seeded RNG (`match.rand()`/`noise()`); same seed +
  config ⇒ identical match (also across the worker and main thread). Never use
  `Math.random()`/`Date.now()` inside simulation, draft or competition code. UI, audio and
  animation must never consume simulation or draft RNG (reels decide in `core/` first and
  animate with their own state).
- **Config snapshot.** A running match reads `match.tuning` (or `player.tuning`), never live
  `CONFIG`. Changing settings must not alter an in-progress match or a replay. Daily Challenges
  and challenge links use `DEFAULT_CONFIG` so every device gets the same draft and results.
- **One match length.** The game plays every match on `MATCH_SECONDS` (180 s): Full, Key
  Moments, Instant and run auto-sims, so a seed gives the same match however it is watched. The
  engine keeps a 300 s profile for tests and tools only; tune and calibrate at 180 s.
- **Fun over realism, but no dumb moments.** Long shots, dribbles and saves are the show;
  passes to nobody, passes into an opponent, keepers beaten softly and attackers left free in
  the box are bugs. After a gameplay change run `tools/calibration/blunders.mjs` (before/after
  with `--engine`/`--compare`) as well as `match-calibration.mjs --duration 180`, and look at
  a few moments with `watch.mjs`.
- **Hot paths.** `Player.skill`, `positionFamiliarity`, `badgeBoost`, `dist`, `Match.plan` and the
  defensive assignment helpers run thousands of times per step. No allocations/closures there;
  caches must stay correct when tests mutate `p.attrs`/`p.tags`/`match.tuning` in place.
  Keep objects in V8's fast mode: declare every Player field in its constructor and every ball
  field in `Match.reset()` (adding a field later with `obj[key] = …` turns the object into a
  dictionary and made real-squad matches 3× slower); a new `ATTRS` key needs a line in
  `memoStale` (`sim/player.js`) and in `normalizeAttributes`. Attribute, badge and tuning
  edits made during a step are seen from the next step. Work that takes long on a phone
  (catalog decode, draft index, opponent list) is built through step-wise generators
  (`decodeCatalogSteps`, `catalogIndexSteps`, `opponentCandidatesSteps`) driven by
  `stepped()` in `services/catalog.js`.
- **Behaviour-neutral refactors** of `app/core/sim/engine.js` (or anything it imports) must keep
  `npm run sim:fingerprint` identical: record before (`… --json > /tmp/before.json`) and compare
  after (`node scripts/dev/sim-fingerprint.mjs --compare /tmp/before.json`). Intentional gameplay
  changes are expected to change it — then justify with tests/stats instead.
- **Data.** Never invent player ratings. The catalog comes only from the compiler.

## Data pipeline

Source (current players): EA SPORTS FC 27, EA's own ratings feed as of 12 September 2026
(`FC27_20260912.csv`: 19,789 rows × 60 columns, men and women; the game uses the 17,849 men).
Published as "EA SPORTS FC 27 Player Ratings" (mikedpad, Kaggle); pinned to the public copy
`https://raw.githubusercontent.com/LakshmiKanth11/EA_FC_ANALYSIS/c0b2542d9fcae72d2c538a472a30ee57c4e7c75e/EA_FC_PLAYERS_DATASET_AND_%20DASHBOARD/data/players.csv`
(SHA-256 `18ed434e5bb90f9afa72363d14438005c785eb4b8872a64c89c75bb38e14e911`; that repository states no
licence — player data belongs to Electronic Arts). `player_id` is EA's id, the same one the
past editions and `profileId` use.

The feed names clubs, leagues and nations but has no ids, so `scripts/data/ea-source.mjs`
turns its rows into the compiler's columns through `data/source-map.json` (league name →
reference league, `"league | club"` → reference team id, nationality → the catalog's nation
name). **`npm run data:reconcile`** (`scripts/data/reconcile.mjs`) maintains that map for a new
snapshot in one pass: a club is recognised by the name the feed gave it last time, else by the
players it shares with the catalog in `app/data` (same EA id → the club he had), else by name
inside its league; leagues and nations follow their clubs and players. Decisions already in the
map are kept, so hand corrections survive. `--add-clubs` adds a reference entry for a club of an
available league the reference lacks (promoted sides): EA team id from older snapshots
(`--ids <sofifa-style.csv>…`, else a local id from 900001) and, with `--enrich` (network), its
Opta score and ESPN colours — review the diff and `data/build/reconcile-report.json` before
building. New snapshot: pin it in `scripts/data/paths.mjs`, `data:fetch`, `data:reconcile`
(review), `data:build`, gallery fixture, tests, `MODE_BASELINES`.

Second source (Legends, Prime versions): jsulz/FIFA23 on Hugging Face, `male_players
(legacy).csv` (FIFA 15–23 career mode from sofifa.com, same 110 columns, MIT, revision
`0b74dbfc434808cf5573f0f11f4c977185bd0e0c`, SHA-256
`13389f463935d257e92811eebbd50405df1a982aa45233a63d1ce075daca133e`; pinned in
`scripts/data/paths.mjs`). `player_id` is the same EA id as the catalog's `profileId`.

```sh
npm run data:fetch   # both pinned CSVs -> data/raw/ (SHA-256 checked; no-op when present)
npm run data:build   # -> app/data/catalog.v3.json, app/data/legends.v1.json, app/assets/flags/,
                     #    data/build/players.json + legends.json (~30 s: 42,000 past versions are rated)
```

`app/data/legends.v1.json` (`core/players/legends-codec.js`, columnar; fetched only by
`services/legends.js` when a World Cup draft or run opens — never on Home) is compiled by
`scripts/compile-legends.mjs` through `compilePlayer`. Every threshold is in the rating the
game shows on a card (`overallRating` at the primary position), never EA's overall: a player's
**best version** is his highest shown rating (ties → EA overall, then the latest edition);
**legends** = best versions shown 85+, of players not in the catalog and of catalog players
whose card today shows less (`legendOf`; no rule about how far apart), with the club of that
edition when the catalog has it; **prime versions** = catalog players whose best version shows
2+ more than today, or 88+ and more. One person, one place in an XI: `baseProfileId` maps a
legend or prime version to the catalog player. Each stores `year`, the year of its ratings
snapshot (`fifa_update_date`; the build fails without one) — what `editionYear` /
`editionLabel` show. FIFA 15/16 have no composure: taken from the player's
nearest later edition, else his reactions. It is stamped with the catalog build (`catalog.ids`)
and the badge configuration, so rebuild both files together. **Captains** come from the reviewed
list `data/captains.json` (first `size` players; the build fails on a wrong id, name or nation).

Builds are deterministic (byte-identical reruns). Format v3 is columnar
(`app/core/players/catalog-codec.js`); it also carries precomputed badges, club ratings and club
best XIs per formation, stamped with the config/FORMATIONS they were derived from (player tiers,
team tiers, ratings, `ai.minimumFit`). If you change rating, tier, minimum-fit, badge or
formation defaults, rebuild the data (the data tests check the stamps). Selection: every player
of every reviewed club of an available league, plus the players rated
`selection.clublessMinimumOverall` (65, the draft's pick minimum) or more whose club has no
reviewed entry in `data/catalog-reference.json` — they get no club or league (nation pools
only). A draft offers only players shown at `draft.pickMinimum` (65) or more; teams field their
real squads. Never invent ratings or club metadata: a club without a sourced colour has none
(it wears the neutral kit). After catalog changes, regenerate the gallery fixture
(`node app/ui/gallery/make-fixture.mjs`) and re-measure `MODE_BASELINES`
(`tools/calibration/draft-baselines.mjs`) if the draft pools moved.

## Conventions

- Plain modern JS (ES2024 modules), no bundler, no runtime dependencies beyond the vendored
  Preact/htm/Lucide subset in `app/ui/vendor/` (copied unmodified; upgrade steps in its README).
- Prettier: single quotes, 100 columns, `arrowParens: avoid`. ESLint flat config.
- UI components never `innerHTML` catalog text (htm escapes interpolations). Plain-DOM code
  escapes catalog text with `escapeHtml` from `core/util/text.js`.
- UI must work at 390 px wide (touch) and 1366 px desktop; respect `prefers-reduced-motion`.
- **Mobile first: it must look great and run great on a mid-range phone**, not just fit. Check
  every UI change in phone screenshots (`npm run shots`, iPhone-size viewport) as well as
  desktop; keep animations on transform/opacity, the match frame loop allocation-free and 60 fps
  with the CPU throttled ×4 (Chrome DevTools / CDP `Emulation.setCPUThrottlingRate`), and no
  main-thread task over ~50 ms (heavy work goes to a worker or a step-wise generator).
- Screen CSS is global (every stylesheet is imported by `styles/app.css`): prefix screen classes
  with the screen's name (`.draft-…`, `.pm-…`, `.match-…`) — bare names like `.stage` collided.
- Displayed numbers go through `ui/lib/format.js` ('.' decimals everywhere, whatever the locale).
- After UI changes: `npm run shots -- --only <flow>` and look at the PNGs; update
  `tests/browser/flows.mjs` when selectors or flows change; `npm run test:browser` must pass.
- Commit in logical steps with clear messages; run `npm run check` first.
