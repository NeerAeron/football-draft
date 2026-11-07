# Competition API (`app/core/competition/`)

Pure state for the World Cup Run, the Daily Challenge, share text and challenge links. The UI
plays the user's matches with the engine (instant / highlights / full) and reports results;
everything else here is deterministic for a seed. Storage, clipboard and dates belong to the UI.

| Module | Exports |
| --- | --- |
| `cup.js` | `createCupRun`, `restoreCupRun`, `CupRun`, `standings`, `cupGrade`, `projectRun`, `cupOffsets`, `CUP_ROUNDS`, `CUP_TUNING`, `KNOCKOUT_EDGE`, `STAGE_LABELS`, `GRADES` |
| `model.js` | `simulateResult`, `simulateShootout`, `outcomeProbabilities`, `expectedGoals`, `MATCH_MODEL` |
| `daily.js` | `dailyId`, `dailyNumber`, `dailyIdFromNumber`, `previousDay`, `nextDay`, `dailyChallenge`, `perfectXI`, `perfectPercent`, `dailyScore`, `canPlayDaily`, `updateStreak`, `currentStreak`, `DAILY_EPOCH`, `DAILY_RULES`, `DAILY_POINTS` |
| `share.js` | `shareText`, `resultEmoji`, `encodeChallenge`, `decodeChallenge`, `challengeUrl`, `parseChallengeUrl`, `challengeDraftOptions` |

## World Cup Run

Group of four (you + three AI teams), three matches, top two advance, then Round of 16,
quarter-final, semi-final, final. Opponents come from the draft ladder
(`docs/draft-api.md`), offset per round and difficulty (`CUP_TUNING`, effective rating vs the
level target; `cupOffsets(difficulty)` returns the seven offsets):

| Difficulty | MD1 | MD2 | MD3 | R16 | QF | SF | Final | final opponents (typical) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Amateur | −10.5 | −9.5 | −9 | −8.5 | −8 | −5 | +3 | Norway, Senegal, Scotland, Czechia (≈ 79.5) |
| Semi-pro | −11 | −9.5 | −8 | −7 | −4 | −1 | +2 | Uruguay, Colombia, USA, Morocco (≈ 81.4) |
| Pro | −12.5 | −11 | −9.5 | −8.5 | −5.5 | −2.5 | +2.5 | Brazil, Italy, England, Argentina (≈ 86.3) |
| World Class | −12.5 | −11 | −9.5 | −8.5 | −5.5 | −2.5 | 0 | Brazil, France, Spain, Italy (≈ 87) |
| Legendary | −13 | −11.5 | −10 | −9 | −6 | −3 | −1 | World XI, All-Stars, France (≈ 88.6) |

Offsets are to the level's ladder target (Amateur 76.7 … Legendary 90.1 in Nations): weak groups
and early rounds, then knockouts that climb to a real final (the Amateur floor is the weakest
nations, ~66–70). `KNOCKOUT_EDGE` (1.5 rating points) is added to the user in the fast
model's knockout ties (`projectRun`, `simulateNext`): in the engine a drafted XI goes through
77.6% of its cup knockout ties where independent Poisson goals say 73.0% (584 ties); group
matches agree with the model (81.7% vs 79.7% wins).

The group is "drawn from lower pots" (pot labels 4/3/2 by strength, weakest first) and the
knockouts escalate to a final against a top side for the level; no opponent repeats; every
opponent XI excludes the user's players. The Daily Challenge uses the Pro offsets.

**Odds** for a typical drafted XI (Nations, positional picks with the level's re-rolls, XI ≈
83.0–83.6), `tools/calibration/cup-calibration.mjs runs`: 1,000 runs per level with the fitted
model for the user's matches (real opponents, AI-vs-AI group results), and `projectRun` at the
mode baseline (6,000 runs):

| Difficulty | champions | out in the group | reached: group / R16 / QF / SF / final / champions | `projectRun` |
| --- | --- | --- | --- | --- |
| Amateur | 59.6% | 0.6% | 1 / 4 / 5 / 9 / 22 / 60 | 61% · Champions |
| Semi-pro | 37.8% | 2.7% | 3 / 10 / 13 / 19 / 17 / 38 | 34% · Final |
| Pro | 19.8% | 4.8% | 5 / 14 / 18 / 23 / 21 / 20 | 18% · Semi-finals |
| World Class | 8.2% | 14.7% | 15 / 23 / 21 / 24 / 9 / 8 | 8% · Quarter-finals |
| Legendary | 3.4% | 24.3% | 24 / 27 / 23 / 17 / 6 / 3 | 3% · Quarter-finals |

**Real engine** for the user's matches (30 runs per level, 180 s / 300 s alternating; ±9 points
at this size): champions Amateur 46.7%, Semi-pro 40.0%, Pro 20.0% (no group exits), World Class
3.3%, Legendary 10.0%. Match by match it agrees with the model plus `KNOCKOUT_EDGE`: group wins
74.0% vs 75.1%, knockout ties won 74.8% vs 69.9% without the edge (≈ 74% with it). Re-check with
`cup-calibration.mjs runs --runs 1000 --engine 30 --workers 2` after engine changes.

`projectRun` plays the same rounds against the exact targets (the real candidates sit within a
point of them); the setup screen's "a typical draft reaches …" line is its median stage
(300 runs).

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

Independent Poisson goals on effective ratings: `λA = 1.82·e^{0.0525(rA−rB)}`,
`λB = 1.82·e^{−0.0525(rA−rB)}` — gap 0: 39% W / 22% D / 39% L; gap +4: 55/21/24; gap +8:
70/16/14; gap +12: 83/10/7. Fitted by Poisson maximum likelihood to 840 engine matches of the
Phase 3 engine (`cup-calibration.mjs gaps`: a typically drafted XI against ladder opponents at
gaps of −12…+20, the AI coach at each difficulty's level, 180 s and 300 s alternating). The
engine by gap (W/D/L) against the model: −8…−4 19/15/66 vs 21/19/60; +4…+8 59/25/17 vs
63/18/19; +8…+13 80/14/6 vs 78/13/9; +13…+17 88/7/5 vs 89/7/4. 180 s matches score less (1.58
per side at gap 0) than 300 s (2.06) with the same slope; the model uses the blend. No home or
coach constant: the AI coach's level moves the user's edge by at most ±1 rating point with no
trend; Poisson draws match the engine (16.4% vs 16.9%). Shootouts: five kicks each then sudden
death, each scored with p = 0.75 ± 0.005 per rating point (340 engine shootouts: a side 6 points
stronger wins 62%, 6 weaker 41%; `MATCH_MODEL`).

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
