# Competition API (`app/core/competition/`)

Pure state for the World Cup Run, the Daily Challenge, share text and challenge links. The UI
plays the user's matches with the engine (instant / highlights / full) and reports results;
everything else here is deterministic for a seed. Storage, clipboard and dates belong to the UI.

| Module | Exports |
| --- | --- |
| `cup.js` | `createCupRun`, `restoreCupRun`, `CupRun`, `standings`, `worldCupDraw`, `projectRun`, `cupOffsets`, `thirdQualifies`, `CUP_ROUNDS`, `THIRD_ROUND`, `CUP_TUNING`, `FIELD_LEVEL`, `FIELD_TYPICAL`, `CUP_FORMAT`, `BEST_THIRD`, `KNOCKOUT_EDGE`, `STAGE_LABELS`, `PLACES`, `PLACE_LABELS`, `MEDALS` |
| `model.js` | `simulateResult`, `simulateShootout`, `outcomeProbabilities`, `expectedGoals`, `MATCH_MODEL` |
| `daily.js` | `dailyId`, `dailyNumber`, `dailyIdFromNumber`, `previousDay`, `nextDay`, `dailyChallenge`, `perfectXI`, `perfectPercent`, `dailyScore`, `canPlayDaily`, `updateStreak`, `currentStreak`, `DAILY_EPOCH`, `DAILY_RULES`, `DAILY_POINTS` |
| `share.js` | `shareText`, `resultEmoji`, `isUltimate`, `ULTIMATE`, `encodeChallenge`, `decodeChallenge`, `challengeUrl`, `parseChallengeUrl`, `challengeDraftOptions` |

## World Cup Run

Group of four (you + three AI teams), three matches; the top two advance, and so does a third
place that makes the best-thirds cut; then Round of 32, Round of 16, quarter-final, semi-final
and the final — or, after a lost semi-final, the **third-place play-off** against the other
semi-final's loser. Eight matches for every run that reaches the semi-finals, as the 2026 World
Cup (48 teams, 12 groups, the top two and the eight best thirds to a Round of 32). A run ends on
a **place** (`PLACES`, worst to best): `group`, `r32`, `r16`, `qf` (out in that round), `fourth`,
`third` (bronze), `final` (runners-up, silver), `champion` (gold). There are no letter grades.

Three difficulties (`DIFFICULTIES`: `pro`, `worldclass`, `legendary`; re-rolls 2 / 1 / 1), real
teams only (no World XI / All-Stars in a run or the Daily):

* **Pro and World Class** draw opponents from the draft ladder (`docs/draft-api.md`), offset per
  round (`CUP_TUNING`, effective rating vs the level target; `cupOffsets(difficulty)` returns the
  nine offsets: group ×3, R32, R16, QF, SF, final, play-off):

  | Difficulty | MD1 | MD2 | MD3 | R32 | R16 | QF | SF | Final | 3rd | final opponents (typical) |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | Pro | −12.5 | −11 | −9.5 | −9.5 | −9 | −6 | −3 | +2 | −3 | Italy, England, Belgium, Germany (≈ 86.6) |
  | World Class | −13.5 | −12 | −10.5 | −10.5 | −10 | −6.5 | −3.5 | −0.5 | −3.5 | England, Spain, Germany, France (≈ 87.6) |

  The group is "drawn from lower pots" (pot labels 4/3/2 by strength, weakest first) and the
  knockouts escalate to a final against a top side for the level; the play-off opponent is of
  semi-final strength.
* **Legendary is the real field** in a Nations draft (`FIELD_LEVEL`; the UI does not say so):
  `worldCupDraw(catalog, { random, rules })` draws and plays a whole World Cup from the run's
  seed. The 48-nation field in its four pots (`catalogIndex(catalog).field`), twelve groups with
  one team per pot, the user in a pot-1 seat (the weakest pot-1 nation stays at home). The user's
  group opponents are that group's three teams (their real pots 2, 3, 4). The eleven other
  groups and every tie without the user are played by the fast model (`simulateResult`); the
  Round of 32 seeds the twelve group winners (the user's seat among them) and the four best
  runners-up against the rest in a bracket drawn at random, and the user's opponent in each
  round is whoever comes through the corresponding part of the bracket; the play-off opponent is
  the loser of the other semi-final. One simplification: the user's own group is played by the
  user, so its outcome is unknown when the bracket is drawn — his group mates do not enter the
  bracket (no opponent ever repeats), and the 31 other places go to the 22 top-two finishers of
  the other groups and the nine best of their eleven thirds. Typical effective ratings met
  (`FIELD_TYPICAL`, `projectRun`'s targets): group 77.2 / 79.1 / 81.3, R32 80.3, R16 83.5, QF
  84.6, SF 85.6, final 86.5, play-off 84.9. Outside a Nations draft there is no field: Legendary
  uses its `CUP_TUNING` row.

**Best thirds** (`BEST_THIRD`, `thirdQualifies(row)`): third place goes through with 4 points, or
3 points and a goal difference of −2 or better. A fixed, explainable rule standing in for the
ranking of twelve thirds: over many simulated sets of twelve groups (fast model), every third
on 4+ points makes the real cut, one on 3 points makes it 97% of the time at GD ≥ 0, ~90% at
−1, ~70% at −2 and at most ~50% below; the rule passes ~63% of thirds (the real cut is 8/12).
Snapshot table rows carry `qualifies` (as the table stands); the hub shows the rule under the
group table and in the last-matchday stakes. Since the rule came in (with the Round of 32),
fewer runs end in the group (World Class 13.7% → 4.7%, Legendary 23% → 10%), and the extra
knockout round takes their place.

Offsets are to the level's ladder target (`MODE_BASELINES` effective rating for the level's
re-rolls + `draft.ladder`: Pro 84.6, World Class 88.4 in Nations): weak groups and early rounds,
then knockouts that climb to a real final. `KNOCKOUT_EDGE` (1.5 rating points) is added to the
user in the fast model's knockout ties (`projectRun`, `simulateNext`): in the engine a drafted XI
goes through 77.6% of its cup knockout ties where independent Poisson goals say 73.0% (584 ties);
group matches agree with the model (81.7% vs 79.7% wins).

No opponent repeats; every opponent XI excludes the user's players. The Daily Challenge uses the
Pro offsets (nine fixed opponents).

**Odds** for a typical drafted XI (Nations, positional picks with the level's re-rolls, XI ≈
84.2–84.4), `tools/calibration/cup-calibration.mjs runs`: runs per level with the fitted model
for the user's matches (real opponents, AI-vs-AI group results; knockout ties with
`KNOCKOUT_EDGE`). Targets: Pro ≈ 20% titles, World Class ≈ 10%; Legendary is whatever the real
field gives. `--only <level> --tuning '[…nine offsets]'` tries other offsets for a ladder level;
`--only legendary` measures the field (offsets do not move it) and prints the ratings met per
round.

| Difficulty | runs | champions | out in the group | finished: group / R32 / R16 / QF / 4th / 3rd / 2nd / champions |
| --- | --- | --- | --- | --- |
| Pro | 1,000 | 20.1% | 0.8% | 1 / 11 / 11 / 18 / 5 / 11 / 24 / 20 |
| World Class | 3,000 | 9.9% | 3.3% | 3 / 18 / 17 / 18 / 9 / 11 / 13 / 10 |
| Legendary (real field) | 2,000 | 5.9% | 8.6% | 9 / 25 / 27 / 18 / 5 / 5 / 5 / 6 |

Legendary without `KNOCKOUT_EDGE` (plain model, nominal ratings) is ≈ 2.6–2.8% — the figure the
set-up was accepted on; the edge is what the engine has shown in knockout ties so far. These are
fast-model numbers on the engine, chemistry and ratings of this commit: re-fit after changes to
any of them (`cup-calibration.mjs runs --runs 1000 --engine 30 --workers 2` for the real engine).

`projectRun` plays the same rounds against the exact targets (the real candidates sit within a
point of them); the setup screen's "a good manager reaches …" line is its median stage
(300 runs).

```js
import { createCupRun, restoreCupRun, projectRun } from './core/competition/cup.js';

const run = createCupRun(catalog, {
  mode: 'nations', difficulty: 'pro', seed,     // the draft's seed is fine
  user: draft.matchSide(0),                     // or { name, color, secondary, formation, players }
  // daily only: opponents: challenge.opponents (9), rules: DEFAULT_CONFIG.draft, rerolls: 2, daily: id
});

for (let m = run.nextMatch(); m; m = run.nextMatch()) {
  // m = { round 0–7, id: 'group1'…'sf', then 'final' or 'third', label, stage, knockout, seed,
  //       opponent, home, away }
  // Engine: new Match(m.seed, 180) + applyMatchSetup(…, matchSetup(m.home, m.away), …).
  // knockout: a draw goes to the engine's penalty shootout.
  run.recordResult({
    goalsFor: 2, goalsAgainst: 1,
    shootout: null,                    // knockout draws: { winner: 'user' | 'opponent', score: [5, 4] }
    players: [{ profileId, rating, goals, assists }], // user XI; rating = performanceRating (3–10)
  });
  // run.simulateNext() plays it with the fast model instead (tests, the fastSim dev switch).
}
```

`run.snapshot()` (JSON):

```js
{ mode, difficulty, daily, status: 'playing' | 'eliminated' | 'champion', complete, round,
  stage: 'group' | 'r32' | 'r16' | 'qf' | 'sf' | 'third' | 'final' while playing; the place once over,
  stageLabel,
  place: null | 'group' | 'r32' | 'r16' | 'qf' | 'fourth' | 'third' | 'final' | 'champion',
  placeLabel: 'Third place' …, medal: 'gold' | 'silver' | 'bronze' | null, perfect: bool (8–0),
  user: { name, rating, effective },
  rounds: [{ id, label, stage, knockout,           // 8; the last is the final, or the play-off
             opponent: { key, kind, id, name, code, flag, color, secondary, formation, rating,
                         effective, nominal, target, pot },
             result: { goalsFor, goalsAgainst, outcome: 'W'|'D'|'L', shootout } | null }],
  group: { teams, fixtures: [{ md, home, away, score }], table: [{ key, name, user, position,
           played, won, drawn, lost, gf, ga, gd, points, decidedBy, qualifies }] },
  results: ['W', 'D', …], record: { w, d, l, gf, ga, played } }
```

* **Status**: `'eliminated'` is every finished run without the title (a third place included);
  read `place` for where it finished. A lost semi-final keeps the run `'playing'`: the eighth
  round becomes `THIRD_ROUND` (`id: 'third'`) against `run.opponents[8]`.
* **Record** is W-D-L by the 90-minute score: a knockout won on penalties is a D (and the run
  continues). Perfect = 8-0.
* **Standings** (`standings(keys, fixtures, lots)`): points, goal difference, goals scored;
  for teams still level, head-to-head points, GD, goals; then a seeded drawing of lots.
  `decidedBy` tells the UI why a team is above the next ('points' | 'goalDifference' |
  'goalsFor' | 'headToHead' | 'lots').
* **AI vs AI** group results use a seeded stream that does not depend on the user's results.
* `run.playerOfTheTournament()` → `{ profileId, name, role, average, matches, goals, assists,
  … }` (best average rating, at least half the matches). `run.heldYouBack(n)` → the lowest
  averages with a `reason` ("Out of position at LB: 71 (natural 79)", "Weakest link: …",
  "Lowest match rating: 5.8"); before any rated match it ranks by slot rating.
* `projectRun({ rating: team.effective, mode, difficulty })` → `{ stage ('group' … 'sf', 'final',
  'champion': the round reached), place, label: 'Projected: Quarter-finals', probabilities (by
  place) }` — a seeded 300-run Monte-Carlo (~5 ms) for the live meter.
* Persist with `localStorage.setItem(key, JSON.stringify(run.serialize()))` (~5 KB) and
  `restoreCupRun(catalog, data)`. Persist after every `recordResult`. `CUP_FORMAT` is 3 (the
  play-off: nine opponents; three difficulties); an older run (format 2 without the play-off,
  format 1 with seven rounds) or one on a removed difficulty throws 'Not a saved run'.

### Fast rating model (`model.js`)

Independent Poisson goals on effective ratings: `λA = 1.84·e^{0.0525(rA−rB)}`,
`λB = 1.84·e^{−0.0525(rA−rB)}` — gap 0: 39% W / 22% D / 39% L; gap 6: 63 / 18 / 19; gap 10:
77 / 13 / 10. Fitted to 2,592 matches of the engine in the game's 180 s match
(`cup-calibration.mjs gaps`: a typically drafted XI against ladder opponents at gaps of
−12…+20, the AI coach at each difficulty's level, both sides on the game-state mentality).
The engine by gap (W/D/L) against the model: −8…−4 19/20/61 vs 21/19/61; −4…−1.5 25/23/51 vs
28/21/51; +1.5…+4 60/18/22 vs 51/21/28; +4…+8 69/19/12 vs 63/18/19; +8…+13 83/11/5 vs
77/13/10; +13…+17 91/5/4 vs 90/7/4, and 3.9 goals a match on those gaps for both. The fit
follows three engine changes (docs/calibration.md, Phase 5): mentality that opens or closes
the game, out-of-position ratings in line with EA's, and `gameplay.qualityImpact` 1.25, which
makes the stronger side win 2–5 points more often at gaps of 2–13 (the engine before it refits
to 1.74 / 0.0500 on the same matches; the earlier 1.6 / 0.0575 was fitted to an older engine).
No home or coach constant in the model: the user's drafted XI does a little better than its
rating says (worth about 0.8 rating points, 0.4 before), which the cup's own measured edges
sit on top of, and the AI coach's level moves the user's edge by at most ±1 rating point with
no trend. Shootouts: five kicks each then sudden
death, each scored with p = 0.75 ± 0.005 per rating point (340 engine shootouts: a side 6 points
stronger wins 62%, 6 weaker 41%; `MATCH_MODEL`).

## Daily Challenge

```js
import { dailyId, dailyChallenge, perfectXI, perfectPercent, dailyScore,
         canPlayDaily, updateStreak, currentStreak } from './core/competition/daily.js';

const today = dailyId(new Date());           // UTC 'YYYY-MM-DD'
const day = dailyChallenge(catalog, today);  // { id, number, seed, mode: 'nations',
//   difficulty: 'pro', rerolls: 2, formation, schedule: { rounds: [{ spin, alternate }] × 11 },
//   opponents: [9 keys: group ×3, R32 … final, play-off], draft: {…}, cup: {…} }
const draft = createDraftSession(catalog, day.draft);   // spins follow the schedule
// … draft (a re-roll lands on that round's fixed alternate; one alternate per round) …
const run = createCupRun(catalog, { ...day.cup, user: draft.matchSide(0) });
// … auto-sim every match with the engine (seed: run.nextMatch().seed) …
const optimum = perfectXI(catalog, day, { formation: draft.formations[0] });
const perfect = perfectPercent(draft.matchSide(0).rating, optimum);   // 0–100
const points = dailyScore(run.snapshot(), { rating: draft.matchSide(0).rating, perfect });
```

* Everyone gets the same 11 nations, the same alternates and the same nine opponents for a
  date (DEFAULT_CONFIG rules; the device's config cannot change them). Opponent XIs still
  drop the players you drafted.
* **Perfect XI**: the exact hindsight optimum — one player per round from that round's
  call-ups (repeat nations refill), using the alternate in at most `rerolls` rounds, distinct
  players and slots. A positional drafter averages ≈ 97.7% of it.
* **Points** (`DAILY_POINTS`): W 100 · D 40 · shootout won +20 · place R32 10 / R16 20 / QF 40 /
  fourth 80 / third 100 / runners-up 120 / champions 200 · 10 per team-OVR point above 70 · 10 per % of perfect above 80.
* One attempt per day: `canPlayDaily(lastPlayedId, today)`. Streaks:
  `updateStreak(streak, today)` after a finished attempt → `{ current, best, last }`;
  `currentStreak(streak, today)` for display (alive until a day is missed). Store
  `{ lastPlayed, streak, results }` in localStorage yourself.

## Share text and challenge links

```js
import { shareText, challengeUrl, parseChallengeUrl, challengeDraftOptions } from './core/competition/share.js';

shareText(run.snapshot(), { daily: day, rating, perfectPct, points, hideRatings, uniqueNations, budget,
                            url: challengeUrl(location.href, { kind: 'daily', daily: day.number }) });
// ⚽ World Cup Draft · Daily #7
// 🟩🟨🟩 🟨🟥
// 2-2-1 · Quarter-finals
// XI 82.9 · 98.4% of perfect · 1,104 pts
// Nations · Pro · 🙈 Ratings hidden
// https://…#c=c1.d.n.442.p.0.7
```

Without `daily` the title reads "World Cup Run". Group results, a space, knockout results; the
top three end with 🏆 / 🥈 / 🥉. The second line of text is the record and where the run finished
(`placeLabel`; the stage while it is played). `budget: true` adds "💰 Budget" to the flags line;
a perfect Legendary run in Budget mode (`isUltimate(snapshot, budget)`, the ultimate
achievement, `ULTIMATE.name` = Immortals) adds "👑 Immortals: Legendary · Budget · 8-0-0".

Challenge links: `challengeUrl(base, { kind: 'cup' | 'quick' | 'versus' | 'daily', mode, seed,
formation, difficulty, hideRatings, uniqueNations, sides, catalog })` →
`base#c=c1.<kind>.<mode>.<formation>.<level>.<flags>.<seed36>[.<stamp>]` (only `[a-z0-9.-]`;
level `p` / `w` / `l`; an old link's `a` or `s` — Amateur, Semi-pro — decodes as Pro).
On load: `const c = parseChallengeUrl(location.href)` (null if absent/invalid; never throws),
then `createDraftSession(catalog, challengeDraftOptions(c))` replays the same spins (and
`createCupRun(catalog, { mode: c.mode, difficulty: c.difficulty, seed: c.seed, rules:
DEFAULT_CONFIG.draft, user })` the same opponents and AI results). Daily links carry the
challenge number: `dailyIdFromNumber(c.daily)`. Pass `catalog: catalogStamp(catalog)` to detect
a friend on a different player database.

## Title odds after the Phase 5 engine (three levels, Budget mode)

Played by the real engine (`cup-calibration.mjs runs --engine 500`, typical Nations draft; `CUP_BUDGET=1`
for Budget mode), before World Class was moved up by half a point per round:

| | Pro | World Class | Legendary (real field) |
| --- | --- | --- | --- |
| Normal | 23.0% | 14.8% | 5.8% |
| Budget mode | 9.2% | 4.8% | 1.0% |

World Class offsets then went +0.5 on every round (fast model: 10.6% → 8.2% normal, 4.0% → 3.0%
Budget; expect about 11% and 3.7% in the engine). Legendary is the real 48-nation field and is not
tuned. The engine gives the drafted XI more than the fast model does (it beats its rating by
about 0.8 points), so the model's own numbers read lower: 20.7 / 8.2 / 4.4% and 10.5 / 3.0 / 1.9%.
