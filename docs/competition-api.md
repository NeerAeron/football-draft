# Competition API (`app/core/competition/`)

Pure state for the World Cup Run, the Daily Challenge, share text and challenge links. The UI
plays the user's matches with the engine (instant / highlights / full) and reports results;
everything else here is deterministic for a seed. Storage, clipboard and dates belong to the UI.

| Module | Exports |
| --- | --- |
| `cup.js` | `createCupRun`, `restoreCupRun`, `CupRun`, `standings`, `cupGrade`, `projectRun`, `CUP_ROUNDS`, `CUP_TUNING`, `STAGE_LABELS`, `GRADES` |
| `model.js` | `simulateResult`, `simulateShootout`, `outcomeProbabilities`, `expectedGoals`, `MATCH_MODEL` |
| `daily.js` | `dailyId`, `dailyNumber`, `dailyIdFromNumber`, `previousDay`, `nextDay`, `dailyChallenge`, `perfectXI`, `perfectPercent`, `dailyScore`, `canPlayDaily`, `updateStreak`, `currentStreak`, `DAILY_EPOCH`, `DAILY_RULES`, `DAILY_POINTS` |
| `share.js` | `shareText`, `resultEmoji`, `encodeChallenge`, `decodeChallenge`, `challengeUrl`, `parseChallengeUrl`, `challengeDraftOptions` |

## World Cup Run

Group of four (you + three AI teams), three matches, top two advance, then Round of 16,
quarter-final, semi-final, final. Opponents come from the draft ladder
(`docs/draft-api.md`), offset per round (`CUP_TUNING`, effective rating vs the level target):

| Round | MD1 | MD2 | MD3 | R16 | QF | SF | Final |
| --- | --- | --- | --- | --- | --- | --- | --- |
| offset | −4.5 | −3.5 | −2.5 | −2 | −1 | 0 | +1 |

The group is "drawn from lower pots" (pot labels 4/3/2 by strength, weakest first) and the
knockouts escalate; no opponent repeats; every opponent XI excludes the user's players.
With the fast model, a typical drafted XI projects to: Amateur — champions ~60%, Semi-pro —
semi-finals (champions ~28%), Pro — quarter-finals (champions ~6%, out in the group ~20%),
World Class — group stage (~55% out), Legendary — group stage (~80% out).

```js
import { createCupRun, restoreCupRun, projectRun } from './core/competition/cup.js';

const run = createCupRun(catalog, {
  mode: 'nations', difficulty: 'pro', seed,     // the draft's seed is fine
  user: draft.matchSide(0),                     // or { name, color, secondary, formation, players }
  // daily only: opponents: challenge.opponents, rules: DEFAULT_CONFIG.draft, rerolls: 2, daily: id
});

for (let m = run.nextMatch(); m; m = run.nextMatch()) {
  // m = { round 0–6, id: 'group1'…'final', label, stage, knockout, seed, opponent, home, away }
  // Engine: new Match(m.seed, 180) + applyMatchSetup(…, matchSetup(m.home, m.away), …).
  // knockout: a draw goes to the engine's penalty shootout.
  run.recordResult({
    goalsFor: 2, goalsAgainst: 1,
    shootout: null,                    // knockout draws: { winner: 'user' | 'opponent', score: [5, 4] }
    players: [{ profileId, rating, goals, assists }], // user XI; rating = performanceRating (3–10)
  });
  // run.simulateNext() plays it with the fast model instead ("Sim rest of run", tests).
}
```

`run.snapshot()` (JSON):

```js
{ mode, difficulty, daily, status: 'playing' | 'eliminated' | 'champion', complete, round,
  stage: 'group' | 'r16' | 'qf' | 'sf' | 'final' | 'champion', stageLabel,
  user: { name, rating, effective },
  rounds: [{ id, label, stage, knockout,
             opponent: { key, kind, id, name, code, flag, color, secondary, formation, rating,
                         effective, nominal, target, pot },
             result: { goalsFor, goalsAgainst, outcome: 'W'|'D'|'L', shootout } | null }],
  group: { teams, fixtures: [{ md, home, away, score }], table: [{ key, name, user, position,
           played, won, drawn, lost, gf, ga, gd, points, decidedBy }] },
  results: ['W', 'D', …], record: { w, d, l, gf, ga, played }, grade: { grade, verdict, … } | null }
```

* **Record** is W-D-L by the 90-minute score: a knockout won on penalties is a D (and the run
  continues). Perfect = 7-0.
* **Standings** (`standings(keys, fixtures, lots)`): points, goal difference, goals scored;
  for teams still level, head-to-head points, GD, goals; then a seeded drawing of lots.
  `decidedBy` tells the UI why a team is above the next ('points' | 'goalDifference' |
  'goalsFor' | 'headToHead' | 'lots').
* **AI vs AI** group results use a seeded stream that does not depend on the user's results.
* **Grades** (`cupGrade`): champion 7-0 **S+** Perfect Seven · unbeaten **S** Invincibles ·
  **A+** World Champions · lost final **A** Final Heartbreak (Heartbreak on Penalties) ·
  semi-final **B+** Semi-final Heartbreak (5 wins) / **B** Semi-finalists · quarter-final
  **C+** Quarter-final Heartbreak (4 wins) / **C** Quarter-finalists · Round of 16 **D**
  Round of 16 Exit (Out on Penalties) · group **F** Group Stage Exit (no points: Early Flight
  Home).
* `run.playerOfTheTournament()` → `{ profileId, name, role, average, matches, goals, assists,
  … }` (best average rating, at least half the matches). `run.heldYouBack(n)` → the lowest
  averages with a `reason` ("Out of position at LB: 71 (natural 79)", "Weakest link: …",
  "Lowest match rating: 5.8"); before any rated match it ranks by slot rating.
* `projectRun({ rating: team.effective, mode, difficulty })` → `{ stage, label: 'Projected:
  Quarter-finals', probabilities }` — a seeded 300-run Monte-Carlo (~5 ms) for the live meter.
* Persist with `localStorage.setItem(key, JSON.stringify(run.serialize()))` (~5 KB) and
  `restoreCupRun(catalog, data)`. Persist after every `recordResult`.

### Fast rating model (`model.js`)

Independent Poisson goals on effective ratings: `λA = 1.3·e^{0.09(rA−rB)}`,
`λB = 1.3·e^{−0.09(rA−rB)}` — gap 0: 37% W / 26% D / 37% L; gap +4: 60/22/18; gap +8: 80/13/6.
Shootouts: five kicks each then sudden death, each scored with p = 0.75 ± 0.01 per rating
point. Fitted roughly to the pre-overhaul engine (review match-gap sample); refit when the
engine overhaul lands (`MATCH_MODEL`).

## Daily Challenge

```js
import { dailyId, dailyChallenge, perfectXI, perfectPercent, dailyScore,
         canPlayDaily, updateStreak, currentStreak } from './core/competition/daily.js';

const today = dailyId(new Date());           // UTC 'YYYY-MM-DD'
const day = dailyChallenge(catalog, today);  // { id, number, seed, mode: 'nations',
//   difficulty: 'pro', rerolls: 2, formation, schedule: { rounds: [{ spin, alternate }] × 11 },
//   opponents: [7 keys], draft: {…}, cup: {…} }
const draft = createDraftSession(catalog, day.draft);   // spins follow the schedule
// … draft (a re-roll lands on that round's fixed alternate; one alternate per round) …
const run = createCupRun(catalog, { ...day.cup, user: draft.matchSide(0) });
// … auto-sim every match with the engine (seed: run.nextMatch().seed) …
const optimum = perfectXI(catalog, day, { formation: draft.formations[0] });
const perfect = perfectPercent(draft.matchSide(0).rating, optimum);   // 0–100
const points = dailyScore(run.snapshot(), { rating: draft.matchSide(0).rating, perfect });
```

* Everyone gets the same 11 nations, the same alternates and the same seven opponents for a
  date (DEFAULT_CONFIG rules; the device's config cannot change them). Opponent XIs still
  drop the players you drafted.
* **Perfect XI**: the exact hindsight optimum — one player per round from that round's
  call-ups (repeat nations refill), using the alternate in at most `rerolls` rounds, distinct
  players and slots. A positional drafter averages ≈ 97.7% of it.
* **Points** (`DAILY_POINTS`): W 100 · D 40 · shootout won +20 · stage R16 20 / QF 40 / SF 80 /
  final 120 / champion 200 · 10 per team-OVR point above 70 · 10 per % of perfect above 80.
* One attempt per day: `canPlayDaily(lastPlayedId, today)`. Streaks:
  `updateStreak(streak, today)` after a finished attempt → `{ current, best, last }`;
  `currentStreak(streak, today)` for display (alive until a day is missed). Store
  `{ lastPlayed, streak, results }` in localStorage yourself.

## Share text and challenge links

```js
import { shareText, challengeUrl, parseChallengeUrl, challengeDraftOptions } from './core/competition/share.js';

shareText(run.snapshot(), { daily: day, rating, perfectPct, points, hideRatings, uniqueNations,
                            url: challengeUrl(location.href, { kind: 'daily', daily: day.number }) });
// ⚽ Football Draft · Daily #7
// 🟩🟨🟩 🟨🟥
// 2-2-1 · Quarter-finals · C Quarter-finalists
// XI 82.9 · 98.4% of perfect · 1,104 pts
// Nations · Pro · 🙈 Ratings hidden
// https://…#c=c1.d.n.442.p.0.7
```

Without `daily` the title reads "World Cup Run". Group results, a space, knockout results;
champions end with 🏆.

Challenge links: `challengeUrl(base, { kind: 'cup' | 'quick' | 'versus' | 'daily', mode, seed,
formation, difficulty, hideRatings, uniqueNations, sides, catalog })` →
`base#c=c1.<kind>.<mode>.<formation>.<level>.<flags>.<seed36>[.<stamp>]` (only `[a-z0-9.-]`).
On load: `const c = parseChallengeUrl(location.href)` (null if absent/invalid; never throws),
then `createDraftSession(catalog, challengeDraftOptions(c))` replays the same spins (and
`createCupRun(catalog, { mode: c.mode, difficulty: c.difficulty, seed: c.seed, rules:
DEFAULT_CONFIG.draft, user })` the same opponents and AI results). Daily links carry the
challenge number: `dailyIdFromNumber(c.daily)`. Pass `catalog: catalogStamp(catalog)` to detect
a friend on a different player database.
