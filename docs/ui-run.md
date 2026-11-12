# RUN screens — World Cup Run, Daily Challenge, Exhibition, challenge links

The screens that turn a drafted XI into a tournament and a result people share. Rules live in
`app/core/competition/` (`docs/competition-api.md`); these screens orchestrate, persist and
render. Follow `docs/ui-guide.md` for components, tokens and flows.

| Route | Screen | Files |
| --- | --- | --- |
| `#/run` | World Cup Run hub + end screen | `screens/run/run.js`, `run-parts.js`, `run-end.js`, `run.css` |
| `#/daily` | Daily Challenge | `screens/daily/daily.js`, `daily.css` |
| `#/exhibition` | Exhibition picker | `screens/exhibition/exhibition.js`, `exhibition.css` |
| `#/challenge?c=…&r=…` | challenge link landing (`#c=…` short links are redirected here by `routes.js`) | `screens/run/challenge.js` |

Shared pieces: `lib/run-store.js` (persistence, Home summary, prematch sides, stakes,
links, daily record), `lib/share-image.js` (1080 × 1350 share card), `screens/run/auto-sim.js`
(engine auto-sims) + `auto-sim-worker.js`, `sim-ticker.js` (`useSimTicker` results ticker), `share-panel.js`,
`team-view.js` (XI → PlayerViews, share card data), `trophy.js` (the gold `Cup`); the cups and
medals are `components/cup.js` (`Cup`, `Medal`, `Prize`).

## World Cup Run flow

1. **Arrival.** The hub boots with `completedDraft() ?? await loadDraft()` (draft-store). A completed draft whose
   `context.kind` is `'run'` becomes a run: `createRunFromDraft(catalog, { session, context })`
   → `createCupRun(catalog, { mode, difficulty, seed, user: session.matchSide(0) })` (challenge
   drafts — `useDefaultRules` — keep `DEFAULT_CONFIG.draft` so a friend meets the same
   opponents) → `saveRun()` → `clearDraft()`; the hub opens on "The draw" (pots 4/3/2).
2. **Play.** The next-fixture card offers exactly four ways to play the match (`PLAY_OPTIONS`),
   before the first match and after every one:
   * **Watch highlights (1 min)** and **Watch full match (3 min)** → `openPrematch({ id:
     'run:<runId>:<round>', seed: run.matchSeed(round), sides, view: 'key' | 'full',
     competition: { mode: 'ai', difficulty, knockout }, meta: { context: 'run', title,
     returnTo: '/run', fixture: id } })`: the pre-match opens with that view selected (it can
     still be changed there). The pending fixture `{ id, round, seed }` is saved first. In the
     **group stage** (rounds 0–2, `m.formationLocked` from `run.nextMatch()`) the user side
     carries `formationLocked: true`: the formation chosen before the draft cannot change
     before kick-off or during the match (`changeFormation` refuses it; the request's
     `meta.formationLocked` lists the side; `CupRun.setLineup` refuses it too); from the Round
     of 32 on it can.
   * **Simulate this match** → `useSimTicker().start(run, { limit: 1, … })`: the engine plays
     just the next fixture (live clock + score), then the hub shows its "Full time" banner.
   * **Simulate the whole cup** → the same ticker without a limit (step 4).
   A match in progress adds "Resume match" above them.
   **The line-up stays.** What is set up in a pre-match — player positions, mentality and,
   once allowed, the formation — is kept with the run for the matches that follow, watched or
   simulated: when the hub loads with a pending fixture it reads that fixture's pre-match as
   it was left (kicked off or not; else the kick-off config of its match request) —
   `fixtureLineup(id, { prematch, request })` → `applyLineup(run, lineup)` →
   `run.setLineup(…)` → `saveRun`. The run's user side (`run.user`: `formation`, `players` in
   slot order, `tactics`) is then what `nextMatch().home`, the next pre-match
   (`matchSideFor` passes the tactics), `fixtureConfig()` (auto-sims) and the XI panels use;
   the team OVR follows the new slots. Changes made during a match (the in-match tactics
   panel) are not kept. The Daily never opens a pre-match — its XI plays every match as
   drafted, in the day's formation.
3. **Return.** `readMatchResult(id)` (fallback: the stored result with the same seed and
   `context: 'run'`) → `run.recordResult(runResultFor(result, 0))` → `clearMatch(id)` (and `clearPrematch()` for that fixture's pre-match) → save.
   The hub shows a "Full time" banner, the other group match ticking in, table moves. A lost
   semi-final does not end the run: the next fixture is the third-place play-off (the path's
   last node reads "3rd").
4. **Simulate the whole cup.** `useSimTicker().start(run, { configFor, idFor, onDone })` plays
   every remaining match with the engine (same seed + config as the match screen's Instant view)
   and records it; live clock + score per match, the other group result after each matchday,
   Skip (no pauses) and Stop (after the current match). Knockout opponents stay hidden until
   their tie starts.
   **Replacing a run in progress.** A new World Cup draft asks first, wherever it starts —
   the setup's Start (Home's two buttons lead there), "Play again" (`?go=1`), a challenge
   link's Accept: `useReplaceRun()` (`screens/run/replace-run.js`) shows one small dialog
   ("Start a new World Cup? Your run in progress will be lost." — Keep run / Start new) when
   `runInProgress()` (a resumable, unfinished run). "Start new" forgets the run (`clearRun`)
   and starts the draft; "Keep run" does nothing. A finished run is replaced without a
   question, and the hub's own "Abandon this run" keeps its dialog.
5. **End.** The headline is where the run finished — World Champions (gold cup + confetti),
   Runners-up (silver medal), Third place (bronze), Fourth place, or "Out in the …" — with the
   record W–D–L, Player of the Tournament, Held you back, XI, share text + image, Challenge a
   friend, Play again. No letter grades. `saveRun()` puts every finished run into the **trophy
   cabinet** once (`lib/records.js` `recordRun(summary, meta.id)`), and the end screen announces
   what was new (`runNews(meta.id)`: first title on a difficulty, first perfect eight, a
   personal best, the cabinet completed, the ultimate achievement) plus the medal.

**Trophy cabinet** (Home, `screens/home/cabinet.js`): always shown. A podium of the three
difficulties with **Legendary in the middle, the largest slot** ("The big one"): each slot shows
the best finish (gold cup, silver / bronze medal, or the round reached, as an unlit cup), the
medal counts, a star for a perfect run, and links to a run on that difficulty. **Budget mode**
(`meta.budget === true`, from the draft context; missing = false) is recorded in a cabinet of its
own: a green trophy pill in each slot with that level's best Budget finish. The **ultimate
achievement** — "Immortals": Legendary + Budget mode + a perfect 8–0 — has its own slot: locked
it says what it takes, unlocked it shows the holographic cup, the count and the first date; the
run end fires an achievement toast and the share text gets a line for it.

Auto-sims (`autoSimulate`) run the engine in a module Worker (`auto-sim-worker.js`, which runs
the same `simulateHere()` loop and streams the ticker updates); without Worker support or if the
worker fails they run on the main thread in ~14 ms slices. Same seed + config ⇒ the same result
as the match screen's Instant view.

## Daily Challenge flow

Intro (date, rules, group, streak, countdown) → `startDraft({ kind: 'daily', type: 'nations',
schedule: day.schedule, seed: day.seed, formation, rerolls, daily: id,
useDefaultRules: true, returnTo: '/daily' })` → back on `#/daily`: `createCupRun(catalog,
{ ...day.cup, user })`, `perfectXI` (in a module Worker: `screens/daily/perfect-xi.js`, ~250 ms
of best-XI search off the main thread; main-thread fallback) / `perfectPercent`,
`beginDailyAttempt()` (the streak counts from here) → engine auto-sim with `DEFAULT_CONFIG` tuning (everyone with the same XI gets the
same results) → `dailyScore` → `finishDailyAttempt()` → result card (points, where it finished
with its cup or medal, % of perfect, streak, share, replays of each match via `requestMatch(…, view 'key')`).

**One attempt, from the first pick.** As soon as a Daily draft has a pick, the draft store
keeps it with the Daily record too (`lockDailyDraft(saved)` after every action →
`football-draft-daily.draft`). From then on the day can only be resumed, never started again:
the intro's button reads "Resume today's draft" (`data-testid="resume-daily"`) and reopens the
board — the one in memory, or the kept copy (`resumeDraft(locked)`) when another draft took the
draft slot meanwhile; a completed XI that was left on the completion sheet starts its
tournament from the kept copy (`restoreSaved`). Home's Daily card says "Started" and "Resume"
(`readDailyStatus().inProgress`). Before the first pick (the first spin only) nothing is kept.
The streak and `lastPlayed` still move when the XI is complete (`beginDailyAttempt`, which
drops the kept draft): a day whose draft is never finished is used, and does not count for the
streak. The next day the kept draft is dropped; one that no longer fits the player database is
dropped too and the day can start again.

## Persistence (`localStorage`, all keys start with `football-draft`)

| Key | Shape |
| --- | --- |
| `football-draft-run-state` | `{ format: 1, run: CupRun.serialize() (its `user` holds the line-up: `formation`, `players` in slot order, `tactics?`), meta, pending: { id, round, seed } \| null, log: [{ round, score, shootout, goals: [{ team, name, minute, ownGoal, penalty }], motm, view }] }` — `meta = { id, kind: 'run', type, mode, difficulty, formation (the draft's, for the challenge link), seed, hideRatings, uniqueNations, defaultRules, budget, challenge: { by, token } \| null, links, startedAt, celebrated? }` |
| `football-draft-run` | Home summary: `{ format: 3, mode: 'run', type, stage: 'G1' \| 'G2' \| 'G3' \| 'R32' \| 'R16' \| 'QF' \| 'SF' \| 'F' \| '3P' (the play-off), record: { w, d, l }, team, status, complete, place, placeLabel, medal, perfect, budget, stageLabel, difficulty, rounds: 8, updatedAt }` |
| `football-draft-daily` | `{ streak, best, lastPlayed: UTC day, lastResult: 'w-d-l', streakState: { current, best, last }, results: { [day]: { id, number, record, results, stage, stageLabel, status, place, placeLabel, medal, points, parts, rating, perfect, formation, hideRatings, run?, finishedAt } }, draft: { id, context, session, savedAt } \| null (the day's draft from its first pick, as the draft store saves it), current: { id, number, run, rating, perfect, formation, hideRatings, log, startedAt } \| null }` — 40 days kept, full `run` only for the latest 7 |
| `football-draft-records` | `{ format: 3, levels: { pro \| worldclass \| legendary: { runs, gold, silver, bronze, perfect, best } }, budget: { the same per level, for Budget-mode runs }, ultimate: { count, first: ISO date \| null }, seen: [run ids, last 24], last: { id, level, budget, news: ['title' \| 'perfect' \| 'best' \| 'cabinet' \| 'ultimate'] } }` — `best` is the index of the best place (0 group stage, 1 R32, 2 R16, 3 QF, 4 fourth, 5 third, 6 runners-up, 7 champions); World Cup Runs only (the Daily keeps its own streak) |
| `football-draft-exhibition` | `{ home: key, away: key }` (`nation:…`, `club:…`, `boss:…`, `random:<seed>`) |
| `football-draft-dev` | `{ fastSim: true }` — dev/test only: auto-sims use the fast rating model |

Readers are tolerant (`lib/saved.js` and `lib/records.js` for Home, `readRunState()` / `readDaily()`): unknown or
broken data reads as "nothing saved".

**Older saves** (cup formats 1 and 2: before the Round of 32, before the third-place play-off
and the three difficulties):

* A **run in progress** cannot be resumed — `readRunState()` returns null (so does a run on a
  removed difficulty), the hub shows "No run in progress", and Home ignores a playing summary
  without `format: 3`; a finished run's summary still shows as the last run (by its stage
  label; its grade is not shown).
* A **Daily attempt** being simulated restarts from matchday 1 with the same XI against the
  day's opponents; finished Daily entries keep their record, stage and points (the grade is no
  longer shown; their match replays no longer rebuild).
* The **trophy cabinet** migrates when read (`records.js`): on Pro, World Class and Legendary
  titles become golds, perfect runs and run counts carry over, a best of "lost final" becomes
  one silver, a lost semi-final reads as fourth place (there was no play-off) and earlier
  rounds keep their round (format 1's knockout rounds move up by one first); entries of the
  removed Amateur and Semi-pro are dropped. The next finished run writes format 3.
* **Draft sessions, setup choices and links** on a removed difficulty read as Pro
  (`difficultyOf`, `decodeChallenge`).

## Share text and challenge links

`shareText(snapshot, …)` from core, with the link `challengeLink(challenge, { record, place })`
→ `<page origin + path>#/challenge?c=<encodeChallenge token>&r=<w>-<d>-<l>.<place>` (place
tokens: `ch` champions, `ru` runners-up, `th` third, `fo` fourth, `qf`, `rs` Round of 16, `rt`
Round of 32, `gs` group stage). A link from before the places carried a letter grade there
(`sp`, `b`, …): it still opens, the record shows and the grade is ignored. The landing shows the
friend's result (with its cup or medal) and starts the same draft:
`startDraft({ kind, type, difficulty, formation, seed, options, useDefaultRules: true,
challenge: { token, by }, returnTo })`; "Review the settings first" opens
`#/play/<mode>?type=…&difficulty=…&formation=…&seed=…&challenge=1`. Daily links point to
`#/daily`.

## Tests

- `tests/run-ui-store.test.mjs` — persistence round trips, tolerant readers, the cabinet (medals,
  Budget, the ultimate, migration), the play-off summary, stakes, links, daily record + streak,
  the Daily's lock from the first pick, share image layout.
- `tests/browser/flows.mjs` — `run` (the four ways to play), `run-end` (every finish, seeded),
  `run-lineup` (a new formation and mentality after the group stage, kept for the next match),
  `run-replace` (the question before a run in progress is replaced, from every entry),
  `home-cabinet` (empty, partly filled, migrated, complete), `daily`, `exhibition`,
  `challenge-link` (seeded, fast sims). Drafts finish on the real board via `#/draft?auto=1` + the completion sheet's
  Continue; matches kick off from the real pre-match (`[data-testid="kick-off"]`), and
  `finishMatch()` presses Instant and Continue on the match screen.
