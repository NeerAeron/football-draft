# RUN screens — World Cup Run, Daily Challenge, Exhibition, challenge links

The screens that turn a drafted XI into a tournament and a result people share. Rules live in
`app/core/competition/` (`docs/competition-api.md`); these screens orchestrate, persist and
render. Follow `docs/ui-guide.md` for components, tokens and flows.

| Route | Screen | Files |
| --- | --- | --- |
| `#/run` | World Cup Run hub + end screen | `screens/run/run.js`, `run-parts.js`, `run-end.js`, `run.css` |
| `#/daily` | Daily Challenge | `screens/daily/daily.js`, `daily.css` |
| `#/exhibition` | Exhibition picker | `screens/exhibition/exhibition.js`, `exhibition.css` |
| `#/challenge?c=…&r=…` | challenge link landing | `screens/run/challenge.js` |

Shared pieces: `lib/run-store.js` (persistence, Home summary, prematch sides, stakes,
links, daily record), `lib/share-image.js` (1080 × 1350 share card), `screens/run/auto-sim.js`
(engine auto-sims) + `auto-sim-worker.js`, `sim-ticker.js` (`useSimTicker` results ticker), `share-panel.js`,
`team-view.js` (XI → PlayerViews, share card data), `honours.js` (`Awards`: the three award
cards, `SquadTable`, `useAwards(run)`, `honoursFor(run, awards)` for the share line), `trophy.js` (the gold `Cup`); the cups and
medals are `components/cup.js` (`Cup`, `Medal`, `Prize`).

## World Cup Run flow

1. **Arrival.** The hub boots with `completedDraft() ?? await loadDraft()` (draft-store). A completed draft whose
   `context.kind` is `'run'` becomes a run: `createRunFromDraft(catalog, { session, context })`
   → `createCupRun(catalog, { mode, difficulty, seed, user: session.matchSide(0) })` (challenge
   drafts — `useDefaultRules` — keep `DEFAULT_CONFIG.draft` so a friend meets the same
   opponents) → `saveRun()` → `clearDraft()`; the hub opens on "The draw" (pots 4/3/2).
2. **Play.** The next-fixture card offers exactly four ways to play the match (`playOptions(group)`;
   `PLAY_OPTIONS` is the knockout list), before the first match and after every one, and under
   them one button to the line-up editor:
   * **Watch highlights (1 min)** and **Watch full match (3 min)** → `openPrematch({ id:
     'run:<runId>:<round>', seed: run.matchSeed(round), sides, view: 'key' | 'full',
     competition: { mode: 'ai', difficulty, knockout }, meta: { context: 'run', title,
     returnTo: '/run', fixture: id } })`: the pre-match opens with that view selected (it can
     still be changed there). A knockout fixture (`knockout: true`) plays extra time before
     penalties: `buildMatchConfig` adds it, for the watched match and the auto-sim alike. The pending fixture `{ id, round, seed }` is saved first. In the
     **group stage** (rounds 0–2, `m.formationLocked` from `run.nextMatch()`) the user side
     carries `formationLocked: true`: the formation chosen before the draft cannot change
     before kick-off or during the match (`changeFormation` refuses it; the request's
     `meta.formationLocked` lists the side; `CupRun.setLineup` refuses it too); from the Round
     of 32 on it can.
   * **Sim this match** → `useSimTicker().start(run, { limit: 1, … })`: the engine plays
     just the next fixture (live clock + score), then the hub shows its "Full time" banner.
   * **Sim group stage** (while the group is being played) → the same ticker with `limit` =
     the group matches left and no stage pop-up: it stops after matchday 3 and the hub comes
     back before the Round of 32, so the line-up can be set up for the knockouts. From the
     Round of 32 on the fourth option reads **Sim the rest** → the ticker without a limit
     (step 4).
   * **Line-up and tactics** (after the group: "Line-up, formation and tactics";
     `data-testid="edit-lineup"`) → the same `openPrematch` with `meta.lineupOnly: true`: the
     pre-match screen as an editor — no kick-off, no view picker, a **Done** button
     (`data-testid="lineup-done"`) that goes back to `meta.returnTo`. The fixture is saved as
     pending like a watched one, so the hub keeps what was set up (below) — also when the
     match is then simmed.
   A match in progress adds "Resume match" above them.
   **The line-up stays.** What is set up in a pre-match — player positions, mentality and,
   once allowed, the formation — is kept with the run for the matches that follow, watched or
   simulated: when the hub loads with a pending fixture it reads that fixture's pre-match as
   it was left (not kicked off yet), else the kick-off config of its match request (a
   pre-match is forgotten once its match has a result) —
   `fixtureLineup(id, { prematch, request })` → `applyLineup(run, lineup)` →
   `run.setLineup(…)` → `saveRun`. The run's user side (`run.user`: `formation`, `players` in
   slot order, `tactics`) is then what `nextMatch().home`, the next pre-match
   (`matchSideFor` passes the tactics), `fixtureConfig()` (auto-sims) and the XI panels use;
   the team OVR follows the new slots. Changes made during a match (the in-match tactics
   panel) are not kept. The Daily never opens a pre-match — its XI plays every match as
   drafted, in the day's formation.
3. **Return.** `readMatchResult(id)` (fallback: the stored result with the same seed and
   `context: 'run'`) → `run.recordResult(runResultFor(result, 0))` → `clearMatch(id)` → save.
   A tie that went to extra time carries `extraTime: true` (so does `runSide(result)` for
   auto-sims): the score is the one after 120 minutes, the outcome a win or a defeat unless
   penalties decided it, and the screens write it `2–1 (aet)` (`scoreText`; the banner's
   eyebrow reads "After extra time", the W/L chip's title "Won after extra time"). The ticker's
   clock runs on to 105' and 120'. (`runResultFor` is the one conversion of a result to `recordResult` input — the auto-sim's `runSide(result)` calls it — and carries the winner of a level match that had no shootout; the fixture's pre-match was forgotten when its result was stored.)
   The hub shows a "Full time" banner, the other group match ticking in, table moves. A lost
   semi-final does not end the run: the next fixture is the third-place play-off (the path's
   last node reads "3rd").
4. **Sim the rest (the whole cup).** `useSimTicker().start(run, { configFor, idFor, onDone })` plays
   every remaining match with the engine (same seed + config as the match screen's Instant view)
   and records it; live clock + score per match, the other group result after each matchday,
   Skip (no pauses) and Stop (after the current match). A cleared stage (into the semi-finals,
   into the final) stops it on a small pop-up with two buttons side by side, centred: "Stop"
   and "Keep simming". Knockout opponents stay hidden until
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
   record W–D–L, the tournament's awards, the squad's table, Player of the Tournament, Held you
   back, XI, share text + image, Challenge a friend, Play again. No letter grades.
   **Awards** (`<Awards>`, right under the headline): Golden Boot, Golden Ball and Golden
   Glove over the whole tournament (`run.awardsSteps()` through `stepped()` after the first
   paint — the cards keep their height while it runs): the player, his nation's flag and the
   number that won it (goals / average rating / clean sheets); a winner from the user's XI is
   lit (`.is-yours`, `data-yours="1"`). On Legendary the field is the 48 nations of the run's
   World Cup, otherwise the user and the nine teams of his path (`docs/competition-api.md`).
   **The squad's table** (`<SquadTable rows=${run.squadStats()}>`, in "Your squad" with the
   Player of the Tournament): one row per player — matches, goals, assists, clean sheets (the
   keeper only), average match rating — whichever way each match was played: Full, Key
   Moments, Instant, "Simulate this match", "Simulate the whole cup" (the engine's lines), or
   the fast model (the fastSim switch: modelled scorers). No horizontal scrolling at 390 px.
   The share text gets one line (`⚽ top scorer · 👟 Golden Boot · ⭐ Golden Ball · 🧤 Golden
   Glove`) and the share image a third stat, "Top scorer". `saveRun()` puts every finished run into the **trophy
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
schedule: day.schedule, seed: day.seed, formation, daily: id,
useDefaultRules: true, returnTo: '/daily' })` → back on `#/daily`: `createCupRun(catalog,
{ ...day.cup, user })`, `perfectXI` (in a module Worker: `screens/daily/perfect-xi.js`, ~250 ms
of best-XI search off the main thread; main-thread fallback) / `perfectPercent`,
`beginDailyAttempt()` (the streak counts from here) → engine auto-sim with `DEFAULT_CONFIG` tuning (everyone with the same XI gets the
same results) → `dailyScore` → `finishDailyAttempt()` → result card (points, where it finished
with its cup or medal, % of perfect, streak, share, replays of each match via `requestMatch(…, view 'key')`).
The result shows the same honours as a run's end — the three award cards (the Daily's field is
the user and its nine fixed opponents) and the squad's table — for the days whose full run is
kept (the latest 7); the share text has the honours line.

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
| `football-draft-run-state` | `{ format: 1, run: CupRun.serialize() (its `user` holds the line-up: `formation`, `players` in slot order, `tactics?`; each of its `matches` the XI's player lines `players` and, from the engine, the other side's `against`; Legendary its World Cup's ties `field.matches` — a run saved without them still opens: no lines → no stats for that match, no field → the awards count the teams of its path), meta, pending: { id, round, seed } \| null, log: [{ round, score, shootout, goals: [{ team, name, minute, ownGoal, penalty }], motm, view }] }` — `meta = { id, kind: 'run', type, mode, difficulty, formation (the draft's, for the challenge link), seed, hideRatings, uniqueNations, defaultRules, budget, challenge: { by, token } \| null, links, startedAt, celebrated? }` |
| `football-draft-run` | Home summary: `{ format: 3, mode: 'run', type, stage: 'G1' \| 'G2' \| 'G3' \| 'R32' \| 'R16' \| 'QF' \| 'SF' \| 'F' \| '3P' (the play-off), record: { w, d, l }, team, status, complete, place, placeLabel, medal, perfect, budget, stageLabel, difficulty, rounds: 8, updatedAt }` |
| `football-draft-daily` | `{ streak, best, lastPlayed: UTC day, lastResult: 'w-d-l', streakState: { current, best, last }, results: { [day]: { id, number, record, results, stage, stageLabel, status, place, placeLabel, medal, points, parts, rating, perfect, formation, hideRatings, run?, finishedAt } }, draft: { id, context, session, savedAt } \| null (the day's draft from its first pick, as the draft store saves it), current: { id, number, run, rating, perfect, formation, hideRatings, log, startedAt } \| null }` — 40 days kept, full `run` only for the latest 7 |
| `football-draft-draft` | `{ format: 2, context, session: DraftSession.serialize() (format 2), savedAt }` (`docs/ui-draft.md`) |
| `football-draft-records` | `{ format: 3, levels: { pro \| worldclass \| legendary: { runs, gold, silver, bronze, perfect, best } }, budget: { the same per level, for Budget-mode runs }, ultimate: { count, first: ISO date \| null }, seen: [run ids, last 24], last: { id, level, budget, news: ['title' \| 'perfect' \| 'best' \| 'cabinet' \| 'ultimate'] } }` — `best` is the index of the best place (0 group stage, 1 R32, 2 R16, 3 QF, 4 fourth, 5 third, 6 runners-up, 7 champions); World Cup Runs only (the Daily keeps its own streak) |
| `football-draft-exhibition` | `{ home: key, away: key }` (`nation:…`, `club:…`, `boss:…`, `random:<seed>`) |
| `football-draft-dev` | `{ fastSim: true }` — dev/test only: auto-sims use the fast rating model |

Readers are tolerant (`lib/saved.js` and `lib/records.js` for Home, `readRunState()` / `readDaily()`): unknown or
broken data reads as "nothing saved".

**One cut-off for older saves and links.** The game reads today's formats only: cup format 4,
cabinet format 3, draft format 3 (the session's rules of this version), the three
difficulties, the three draft modes, the two link kinds. Nothing older is converted — it
reads as "nothing saved" or "link not valid" through the same tolerant readers, never a crash:

* a **run** in an older cup format, on a removed difficulty or mode, or with rules of an older
  shape: `readRunState()` / `loadRun()` return null, the hub shows "No run in progress", and
  Home shows no run for a summary without `format: 4` (finished ones too);
* a **draft** in the slot with an older `format`: `readSavedDraft()` and `loadDraft()` return
  null (status `empty`); today's slot with a session that does not restore (an older session
  format, unknown mode or difficulty, a missing player) is the draft screen's error state;
* the **trophy cabinet** in formats 1–2 reads as empty; the next finished run writes format 3;
* a **Daily** attempt being simulated that does not restore reads as no attempt (the day stays
  used); an entry without a place shows no place;
* **links**: a token with a removed difficulty (`a`, `s`), Club & Country (`x`), a Quick Match
  or Versus kind (`q`, `v`), the two-sides flag (`2`) or the short `#c=` form is not a link
  (the challenge screen's "broken link" card, or Not found for `#c=`); a result with a letter
  grade where the place goes reads as no result.

Kept on purpose: `ui/main.js` still deletes the old `football-draft-settings-v1` key, and a
setup query or saved choice with an unknown difficulty or type falls back to Pro / Nations
(input normalisation, not a conversion).

## Share text and challenge links

`shareText(snapshot, …)` from core, with the link `challengeLink(challenge, { record, place })`
→ `<page origin + path>#/challenge?c=<encodeChallenge token>&r=<w>-<d>-<l>.<place>` (place
tokens: `ch` champions, `ru` runners-up, `th` third, `fo` fourth, `qf`, `rs` Round of 16, `rt`
Round of 32, `gs` group stage). The landing shows the
friend's result (with its cup or medal) and starts the same draft:
`startDraft({ kind, type, difficulty, formation, seed, options, useDefaultRules: true,
challenge: { token, by }, returnTo })`; "Review the settings first" opens
`#/play/<mode>?type=…&difficulty=…&formation=…&seed=…&hide=…&unique=…[&budget=1]`. A **Budget
run's link** carries the flag (`runChallenge(meta)` → `budget: meta.budget === true` → flag
`b` in the token): the landing shows a "Budget" chip and both ways in start a Budget draft
(`options.budget`). Daily links point to
`#/daily`.

## Tests

- `tests/run-ui-store.test.mjs` — persistence round trips, tolerant readers, the cabinet (medals,
  Budget, the ultimate), the cut-off for older formats and the readers' tolerance of junk, the play-off summary, stakes, links, daily record + streak,
  the Daily's lock from the first pick, share image layout.
- `tests/competition-awards.test.mjs` — modelled scorers, the squad's stats for every way a
  match is recorded, the awards (deterministic, ladder and real field, the user's player or
  anybody else's, runs saved without lines or field).
- `tests/browser/flows.mjs` — `run` (the four ways to play; awards and squad table after
  "Simulate the whole cup"), `run-end` (every finish, seeded; `honours()` checks the three award
  cards, the table of eleven, no sideways scroll and the share line),
  `run-lineup` (a new formation and mentality after the group stage, kept for the next match),
  `run-replace` (the question before a run in progress is replaced, from every entry),
  `home-cabinet` (empty, partly filled, an older format, complete), `daily`, `exhibition`,
  `challenge-link` (seeded, fast sims). Drafts finish on the real board via `#/draft?auto=1` + the completion sheet's
  Continue; matches kick off from the real pre-match (`[data-testid="kick-off"]`), and
  `finishMatch()` presses Instant and Continue on the match screen.
