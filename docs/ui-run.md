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
`team-view.js` (XI → PlayerViews, share card data), `trophy.js`.

## World Cup Run flow

1. **Arrival.** The hub boots with `completedDraft() ?? await loadDraft()` (draft-store). A completed draft whose
   `context.kind` is `'run'` becomes a run: `createRunFromDraft(catalog, { session, context })`
   → `createCupRun(catalog, { mode, difficulty, seed, user: session.matchSide(0) })` (challenge
   drafts — `useDefaultRules` — keep `DEFAULT_CONFIG.draft` so a friend meets the same
   opponents) → `saveRun()` → `clearDraft()`; the hub opens on "The draw" (pots 4/3/2).
2. **Play.** `openPrematch({ id: 'run:<runId>:<round>', seed: run.matchSeed(round), sides,
   competition: { mode: 'ai', difficulty: 'medium', knockout }, meta: { context: 'run',
   title, returnTo: '/run', fixture: id } })`. The pending fixture `{ id, round, seed }` is saved
   first. In the first match (round 0) the user side carries `formationLocked: true`: the
   formation chosen before the draft cannot change before kick-off or during the match
   (`changeFormation` refuses it; the request's `meta.formationLocked` lists the side); from
   the second match on it can.
3. **Return.** `readMatchResult(id)` (fallback: the stored result with the same seed and
   `context: 'run'`) → `run.recordResult(runResultFor(result, 0))` → `clearMatch(id)` → save.
   The hub shows a "Full time" banner, the other group match ticking in, table moves.
4. **Sim rest of run.** `useSimTicker().start(run, { configFor, idFor, onDone })` plays every
   remaining match with the engine (same seed + config as the match screen's Instant view) and
   records it; live clock + score per match, the other group result after each matchday,
   Skip (no pauses) and Stop (after the current match). Knockout opponents stay hidden until
   their tie starts.
5. **End.** Champion (trophy + confetti + achievements) or elimination; grade + verdict, record,
   Player of the Tournament, Held you back, XI, share text + image, Challenge a friend, Play again.
   `saveRun()` puts every finished run into the **trophy cabinet** once (`lib/records.js`
   `recordRun(summary, meta.id)`): Home shows one cup per difficulty (won, perfect, or the
   furthest round so far), each a link to a run on that difficulty, and the end screen
   announces what was new (`runNews(meta.id)`: first title on a difficulty, first perfect
   eight, a personal best, the cabinet completed).

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
`beginDailyAttempt()` (the day is used
from here on) → engine auto-sim with `DEFAULT_CONFIG` tuning (everyone with the same XI gets the
same results) → `dailyScore` → `finishDailyAttempt()` → result card (points, grade, % of
perfect, streak, share, replays of each match via `requestMatch(…, view 'key')`).

## Persistence (`localStorage`, all keys start with `football-draft`)

| Key | Shape |
| --- | --- |
| `football-draft-run-state` | `{ format: 1, run: CupRun.serialize(), meta, pending: { id, round, seed } \| null, log: [{ round, score, shootout, goals: [{ team, name, minute, ownGoal, penalty }], motm, view }] }` — `meta = { id, kind: 'run', type, mode, difficulty, formation, seed, hideRatings, uniqueNations, defaultRules, challenge: { by, token } \| null, links, startedAt, celebrated? }` |
| `football-draft-run` | Home summary: `{ mode: 'run', type, stage: 'G1' \| 'G2' \| 'G3' \| 'R32' \| 'R16' \| 'QF' \| 'SF' \| 'F', record: { w, d, l }, team, status, complete, grade, verdict, stageLabel, difficulty, rounds: 8, updatedAt }` |
| `football-draft-daily` | `{ streak, best, lastPlayed: UTC day, lastResult: 'w-d-l', streakState: { current, best, last }, results: { [day]: { id, number, record, results, stage, stageLabel, status, grade, verdict, points, parts, rating, perfect, formation, hideRatings, run?, finishedAt } }, current: { id, number, run, rating, perfect, formation, hideRatings, log, startedAt } \| null }` — 40 days kept, full `run` only for the latest 7 |
| `football-draft-records` | `{ format: 2, levels: { [difficulty]: { runs, titles, perfect, best } }, seen: [run ids, last 24], last: { id, level, news: ['title' \| 'perfect' \| 'best' \| 'cabinet'] } }` — `best` is the furthest round (0–7, 8 = champion); World Cup Runs only (the Daily keeps its own streak) |
| `football-draft-exhibition` | `{ home: key, away: key }` (`nation:…`, `club:…`, `boss:…`, `random:<seed>`) |
| `football-draft-dev` | `{ fastSim: true }` — dev/test only: auto-sims use the fast rating model |

Readers are tolerant (`lib/saved.js` and `lib/records.js` for Home, `readRunState()` / `readDaily()`): unknown or
broken data reads as "nothing saved".

**Saves from the seven-match format** (before the Round of 32; cup format 1): a run in progress
cannot be resumed — `readRunState()` returns null, so the hub shows "No run in progress", and
Home ignores a playing summary without `rounds: 8`; a finished run's summary still shows as the
last run. A Daily attempt being simulated restarts from matchday 1 with the same XI against the
day's eight opponents; finished Daily entries keep their record, grade and points (their match
replays no longer rebuild). The trophy cabinet's format-1 `best` of 3 (Round of 16) or more moves
up by one when read; titles and perfect runs carry over.

## Share text and challenge links

`shareText(snapshot, …)` from core, with the link `challengeLink(challenge, { record, grade })`
→ `<page origin + path>#/challenge?c=<encodeChallenge token>&r=<w>-<d>-<l>.<grade>` (grade
`S+` → `sp`). The landing shows the friend's result and starts the same draft:
`startDraft({ kind, type, difficulty, formation, seed, options, useDefaultRules: true,
challenge: { token, by }, returnTo })`; "Review the settings first" opens
`#/play/<mode>?type=…&difficulty=…&formation=…&seed=…&challenge=1`. Daily links point to
`#/daily`.

## Tests

- `tests/run-ui-store.test.mjs` — persistence round trips, tolerant readers, stakes, links,
  daily record + streak, share image layout.
- `tests/browser/flows.mjs` — `run`, `daily`, `exhibition`, `challenge-link` (seeded, fast
  sims). Drafts finish on the real board via `#/draft?auto=1` + the completion sheet's
  Continue; matches kick off from the real pre-match (`[data-testid="kick-off"]`), and
  `finishMatch()` presses Instant and Continue on the match screen.
