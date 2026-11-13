# Competition API (`app/core/competition/`)

Pure state for the World Cup Run, the Daily Challenge, share text and challenge links. The UI
plays the user's matches with the engine (instant / highlights / full) and reports results;
everything else here is deterministic for a seed. Storage, clipboard and dates belong to the UI.

| Module | Exports |
| --- | --- |
| `cup.js` | `createCupRun`, `restoreCupRun`, `CupRun`, `standings`, `worldCupDraw`, `projectRun`, `cupOffsets`, `thirdQualifies`, `CUP_ROUNDS`, `THIRD_ROUND`, `CUP_TUNING`, `FIELD_LEVEL`, `FIELD_TYPICAL`, `CUP_FORMAT`, `BEST_THIRD`, `KNOCKOUT_EDGE`, `STAGE_LABELS`, `PLACES`, `PLACE_LABELS`, `MEDALS` |
| `model.js` | `simulateResult`, `simulateShootout`, `outcomeProbabilities`, `expectedGoals`, `MATCH_MODEL` |
| `scorers.js` | `matchPerformances` (player lines for a modelled result) |
| `awards.js` | `tournamentSteps` (behind `CupRun.awards()` / `awardsSteps()`), `BALL_MATCHES`, `BALL_DEPTH`, `GLOVE_STAGE` |
| `daily.js` | `dailyId`, `dailyNumber`, `dailyIdFromNumber`, `previousDay`, `nextDay`, `dailyChallenge`, `perfectXI`, `perfectPercent`, `dailyScore`, `canPlayDaily`, `updateStreak`, `currentStreak`, `DAILY_EPOCH`, `DAILY_RULES`, `DAILY_POINTS` |
| `share.js` | `shareText`, `resultEmoji`, `isUltimate`, `ULTIMATE`, `encodeChallenge`, `decodeChallenge` |

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
  seed. Every run first **qualifies its own 48** of the playable nations (`catalogIndex(catalog)
  .playable`, 56): the strongest `nations.fieldCore` (30) are always in, the other 18 seats are
  drawn without replacement from the rest with odds that halve every `nations.fieldHalving`
  (1.5) rating points below the 30th nation — so a lower-rated nation sometimes makes it, like
  real qualification. The 48 are potted by strength (the draw returns `pots`), twelve groups with
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
  84.6, SF 85.6, final 86.5, play-off 84.9 (measured before the qualification draw and the
  Captain boost; `cup-calibration.mjs runs --runs 2000 --only legendary` now gives 76.0 / 79.2 /
  81.2, R32 80.2, R16 83.3, QF 84.2, SF 85.3, final 85.9, play-off 84.5 — the qualification
  draw only lowers matchday 1, by 1.2; with the strongest 48 the same code gives 77.2 / 79.2 /
  81.1, 80.3, 83.1, 84.2, 85.1, 85.9, 84.3). Outside a Nations draft there is no field: Legendary
  uses its `CUP_TUNING` row.

**Best thirds** (`BEST_THIRD`, `thirdQualifies(row)`): third place goes through with 4 points or
more and never with fewer (over many simulated sets of twelve groups every third on 4+ points
makes the real cut of 8/12).
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
  //       formationLocked (the group stage), opponent, home, away }
  // Engine: new Match(m.seed, 180) + applyMatchSetup(…, matchSetup(m.home, m.away), …).
  // knockout: level after 90 minutes → extra time, then the engine's penalty shootout.
  run.recordResult({
    goalsFor: 2, goalsAgainst: 1,      // the final score (after extra time when it was played)
    extraTime: false,                  // knockouts: true when the tie went to extra time
    shootout: null,                    // still level: { winner: 'user' | 'opponent', score: [5, 4] }
    players: [{ profileId, rating, goals, assists }], // user XI; rating = performanceRating (3–10)
    opponents: [{ profileId, rating, goals, assists }], // the other XI (engine matches; optional)
  });
  // run.simulateNext() plays it with the fast model instead (tests, the fastSim dev switch):
  // a result without `players` gets the lines of scorers.js, so every match has its scorers.
}
```

`run.snapshot()` (JSON):

```js
{ mode, difficulty, daily, status: 'playing' | 'eliminated' | 'champion', complete, round,
  stage: 'group' | 'r32' | 'r16' | 'qf' | 'sf' | 'third' | 'final' while playing; the place once over,
  stageLabel,
  place: null | 'group' | 'r32' | 'r16' | 'qf' | 'fourth' | 'third' | 'final' | 'champion',
  placeLabel: 'Third place' …, medal: 'gold' | 'silver' | 'bronze' | null, perfect: bool (8–0),
  user: { name, rating, effective, formation },
  rounds: [{ id, label, stage, knockout,           // 8; the last is the final, or the play-off
             opponent: { key, kind, id, name, code, flag, color, secondary, formation, rating,
                         effective, nominal, target, pot },
             result: { goalsFor, goalsAgainst, outcome: 'W'|'D'|'L', extraTime, shootout } | null }],
  group: { teams, fixtures: [{ md, home, away, score }], table: [{ key, name, user, position,
           played, won, drawn, lost, gf, ga, gd, points, decidedBy, qualifies }] },
  results: ['W', 'D', …], record: { w, d, l, gf, ga, played } }
```

* **The line-up** (`run.user`: `formation`, `players` in slot order, `rating`, `effective`,
  `tactics?`) can change between matches: `run.setLineup({ formation?, players?, tactics? })`
  takes the same eleven in a new slot order (ids or players; the keeper in goal), a formation
  — only once the group stage is over: `run.formationLocked` is true for the three group
  matches, which are played in the formation the XI was drafted in — and tactics as plain
  data (`{ mentality: 'push', … }`, handed back on `userSide().tactics`). It returns false and
  changes nothing when the line-up is not this XI or the formation is locked. Rating and
  effective rating follow the new slots, so `simulateNext()`, the awards ("Out of position at
  LB") and the snapshot (`user.formation`) read the line-up as it stands. Opponents were drawn
  at creation and do not move. Serialised with the run (format unchanged).
* **Status**: `'eliminated'` is every finished run without the title (a third place included);
  read `place` for where it finished. A lost semi-final keeps the run `'playing'`: the eighth
  round becomes `THIRD_ROUND` (`id: 'third'`) against `run.opponents[8]`.
* **Record** is W-D-L by the final score. A knockout tie that is level after 90 minutes goes
  to extra time (`result.extraTime`): won or lost there it is a W or an L like any other
  (`2–1 (aet)`); only a tie that is still level and goes to penalties is a D (and the run
  continues when the shootout is won). Perfect = 8-0, extra-time wins included.
* **Standings** (`standings(keys, fixtures, lots)`): points, goal difference, goals scored;
  for teams still level, head-to-head points, GD, goals; then a seeded drawing of lots.
  `decidedBy` tells the UI why a team is above the next ('points' | 'goalDifference' |
  'goalsFor' | 'headToHead' | 'lots').
* **AI vs AI** group results use a seeded stream that does not depend on the user's results.
* `run.playerOfTheTournament()` → `{ profileId, name, role, average, matches, goals, assists,
  … }` (best average rating, at least half the matches). `run.heldYouBack(n)` → the lowest
  averages with a `reason` ("Out of position at LB: 71 (natural 79)", "Weakest link: …",
  "Lowest match rating: 5.8"); before any rated match it ranks by slot rating.
* **Player stats, however a match was played.** Every recorded match keeps the XI's lines
  (`matches[i].players`): the engine's (`runResultFor` → `players`, and the other side's as
  `opponents` → `matches[i].against`), or — the fast model, a result reported without them —
  the lines of `scorers.js`, seeded by the match (`matchSeed(round)`), so they are the same on
  every device. `run.squadStats()` → the XI in slot order: `{ profileId, name, role, matches,
  goals, assists, average (null before a match), cleanSheets, slotRating, natural,
  familiarity }`.
  **The scorers rule** (`matchPerformances(xi, { goalsFor, goalsAgainst, random })`, `xi` =
  players with `role` and `attrs`): each goal goes to one of the eleven in proportion to a role
  weight (ST 1, AM 0.9, wingers 0.7, CM 0.5, wide midfielders 0.45, DM 0.25, full-backs 0.08,
  CB 0.06, GK 0) × 2^((finish − 70) / 12), finish = 0.5 finishing + 0.2 shot power + 0.15 long
  shots + 0.15 composure; 3% are own goals; 85% have an assist, drawn among the other ten by
  role (AM and wingers 1, wide midfielders 0.9, CM 0.8, DM and ST 0.5, full-backs 0.4) ×
  2^((create − 70) / 12), create = 0.4 vision + 0.3 short passes + 0.3 crosses. The rating
  follows the engine's `performanceRating` with what a result can say: a base per role
  (5.8–6.25), +1.1 a goal, +0.7 an assist, keeper and centre-backs +0.55 for a clean sheet or
  −0.09 per goal against, a keeper +0.22 a save (2–4, one more from three goals against), ±0.35
  of form. Weights and bases are the engine's own shares over 60 run matches.
* **Tournament awards** — `run.awards()` → `{ teams, boot, ball, glove }` once the run is over
  (null before), each `{ profileId, name, nation, role, user (one of the user's XI), team:
  { key, name, code, flag, kind, user }, matches, goals, assists, average, cleanSheets,
  conceded }`; computed once per run object, not stored (deterministic for the run).
  `run.awardsSteps()` is the same work as a generator for `stepped()` (a Legendary run builds
  38 squads, ~55 ms in Node).
  **The field.** Legendary in a Nations draft: all 48 nations of its World Cup — the run
  stores every tie `worldCupDraw` played (`run.field.matches`: `[stage, home key, away key,
  goals, goals, winner?]`, ~4 KB; the squads are `buildOpponent`'s, built when the awards are
  asked for). Pro, World Class, the Daily and every non-Nations run have no bracket: the field
  is **the user and the nine teams of his path** (`teams: 10`), and each knockout opponent gets
  the matches he must have played to be there — three group matches and a win per earlier
  round against sides nobody sees (only his own players count), the finalist beating the
  play-off opponent in the other semi-final. A run saved without `field` is counted that way
  too. In both cases what the user did not play is played by the fast model from the run's
  seed: whoever knocked him out takes his place in the bracket (the best of his group mates
  after a group exit) and meets the opponents that were waiting, to the final and the
  play-off. The user's matches count as recorded; every other side's lines come from
  `scorers.js` with a seed per match and side. Line-ups are the ones the run stores
  (`opponents[i].players` — whatever `buildOpponent` returned, legends included).
  **The rules.** Golden Boot: most goals; level → more assists, fewer matches, then the order
  of the tournament's matches. Golden Ball: best average match rating + `BALL_DEPTH` (0.1) per
  round the team went past the group (champions +0.6), among players with `BALL_MATCHES` (4) or
  more; level → goals, assists. Golden Glove: most clean sheets among keepers of teams that
  played a quarter-final (`GLOVE_STAGE`); level → fewer goals against per match, more matches.
  Over 60 fast-simulated Pro runs of one XI the user's players won 11 Boots, 13 Balls and 14
  Gloves; on Legendary 2, 3 and 1.
* `projectRun({ rating: team.effective, mode, difficulty })` → `{ stage ('group' … 'sf', 'final',
  'champion': the round reached), place, label: 'Projected: Quarter-finals', probabilities (by
  place) }` — a seeded 300-run Monte-Carlo (~5 ms) for the live meter.
* Persist with `localStorage.setItem(key, JSON.stringify(run.serialize()))` (~6 KB at the
  start, ~11 KB on Legendary with its field; each match adds its player lines, ~1.8 KB with
  both sides: a finished run is 21–25 KB) and
  `restoreCupRun(catalog, data)`. Persist after every `recordResult`. `CUP_FORMAT` is 3 (the
  play-off: nine opponents; three difficulties); anything else — an older format, a removed
  difficulty or draft mode, link rules that are not the three numbers — throws 'Not a saved
  run' (one cut-off, no conversion).

### Fast rating model (`model.js`)

Independent Poisson goals on effective ratings: `λA = 1.46·e^{0.0525(rA−rB)}`,
`λB = 1.46·e^{−0.0525(rA−rB)}` (1.33 before the level per side, docs/calibration.md Phase 10;
optional `units = [a, b]` — each side's `unitLevels` — make a side score 3.6% less per point
of `unitLean`: the opponent's defence above its overall, less its own attack above its own;
no caller passes them yet) — gap 0: 37% W / 26% D / 37% L; gap 6: 61 / 22 / 17 — refitted
(624 engine matches, `cup-calibration.mjs gaps` + `fit`) after the engine was brought to about
three goals a match in every mode (docs/calibration.md, Phase 9): 2.9 goals a match on those
gaps, engine against model −4…−1.5 24/28/48 vs 27/25/48, +4…+8 67/22/11 vs 61/21/18, +8…+13
83/11/6 vs 75/15/10; the user's XI now does about 2.5 rating points better than its rating
(0.14 in the exponent: the favourite's edge, Legend and Prime versions), not in the model.
Title odds of the fast model (`runs --runs 400`, `CUP_TUNING` unchanged) 1.71 → 1.33: Pro
18.3% → 18.5%, World Class 11.3% → 9.3%, Legendary 4.3% → 5.0%. The paragraph below is the
previous fit (goals 1.84, later scaled to 1.71), kept for its method. It was fitted to 2,592 matches of the engine in the game's 180 s match
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
no trend. **Extra time**: `simulateResult(a, b, random, { knockout: true })` plays it when
the 90 minutes end level (`extraTime: false` skips it): the same two rates × `MATCH_MODEL
.extraTime` (0.293 = 30 of 90 minutes at 0.88 of the scoring rate, as the engine's extra time
has: 0.61 goals against 0.69 for 30 ordinary minutes over 480 level club fixtures), `goals`
then include them and the result has `extraTime: true`. Every AI-vs-AI knockout tie of the
real field (`worldCupDraw`), `projectRun` and `simulateNext` (the fastSim switch) go through
it. At equal ratings 53% of the model's level ties are decided in extra time (engine, club
fixtures, which score less: 45%). Shootouts, when it is still level: five kicks each then sudden
death, each scored with p = 0.75 ± 0.005 per rating point (340 engine shootouts: a side 6 points
stronger wins 62%, 6 weaker 41%; `MATCH_MODEL`).

Title odds of the fast model before → after extra time (`cup-calibration.mjs runs --runs 400`,
`CUP_TUNING` unchanged; ±2 points of noise at 400 runs): Pro 15.3% → 16.5%, World Class 10.0% →
10.5%, Legendary 3.8% → 4.0%; out in the group 4.5 / 10.0 / 21.0% both times. `projectRun` for
the baseline XI over 80,000 runs: 17 / 6 / 4% before and after. Extra time is a longer look at
the two sides than five kicks each, so it helps whoever is stronger in a tie — the user in the
early rounds, the opponent in a World Class or Legendary final — and the two nearly cancel.

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
  nation (its draft squad of 30, `nation.squad`: a repeated nation offers the same squad
  again, less the players taken), using the alternate in at most `rerolls` rounds, distinct
  players and slots. A positional drafter averages ≈ 97.7% of it.
* **Points** (`DAILY_POINTS`): W 100 (a knockout won in extra time is a win) · D 40 · shootout won +20 · place R32 10 / R16 20 / QF 40 /
  fourth 80 / third 100 / runners-up 120 / champions 200 · 10 per team-OVR point above 70 · 10 per % of perfect above 80.
* One attempt per day: `canPlayDaily(lastPlayedId, today)`. Streaks:
  `updateStreak(streak, today)` after a finished attempt → `{ current, best, last }`;
  `currentStreak(streak, today)` for display (alive until a day is missed). Store
  `{ lastPlayed, streak, results }` in localStorage yourself.

## Share text and challenge links

```js
import { shareText, encodeChallenge, decodeChallenge } from './core/competition/share.js';

shareText(run.snapshot(), { daily: day, rating, perfectPct, points, hideRatings, uniqueNations, budget,
                            url: page + '#/challenge?c=' + encodeChallenge({ kind: 'daily', daily: day.number }) });
// ⚽ World Cup Draft · Daily #7
// 🟩🟨🟩 🟨🟥
// 2-2-1 · Quarter-finals
// XI 82.9 · 98.4% of perfect · 1,104 pts
// Nations · Pro · 🙈 Ratings hidden
// https://…#/challenge?c=c1.d.n.442.p.0.7
```

Without `daily` the title reads "World Cup Run". Group results, a space, knockout results; the
top three end with 🏆 / 🥈 / 🥉. The second line of text is the record and where the run finished
(`placeLabel`; the stage while it is played). `budget: true` adds "💰 Budget" to the flags line;
a perfect Legendary run in Budget mode (`isUltimate(snapshot, budget)`, the ultimate
achievement, `ULTIMATE.name` = Immortals) adds "👑 Immortals: Legendary · Budget · 8-0-0".

Challenge links — two kinds, the ones the game makes: a World Cup run (`cup`) and the Daily.
`encodeChallenge({ kind: 'cup' | 'daily', mode, seed, formation, difficulty, hideRatings,
uniqueNations, budget, catalog })` →
`c1.<kind>.<mode>.<formation>.<level>.<flags>.<seed36>[.<stamp>]` (only `[a-z0-9.-]`; kind `c`
/ `d`; mode `n` / `l` / `c`; flags `h` ratings hidden, `u` one per nation, `b` Budget mode — a
World Cup run's only — or `0`; level `p` / `w` / `l`). The UI puts the token in `#/challenge?c=<token>&r=…`
(`challengeLink`, `docs/ui-run.md`). `decodeChallenge(token)` gives the challenge back, or
null for anything else — never throws; then
`createDraftSession(catalog, { mode: c.mode, seed: c.seed, formation: c.formation,
difficulty: c.difficulty, hideRatings, uniqueNations, budget, useDefaultRules: true })` replays
the same spins (and `createCupRun(catalog, { mode: c.mode, difficulty: c.difficulty, seed:
c.seed, rules: DEFAULT_CONFIG.draft, user })` the same opponents and AI results). Daily links
carry the challenge number: `dailyIdFromNumber(c.daily)`. Pass `catalog:
catalogStamp(catalog)` to detect a friend on a different player database.

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

## Title odds with the 93-nation reel, legends, Prime boosts and captains

Nations baseline re-measured (effective 81.1 / 81.64 / 82.2 with 0 / 1 / 2 re-rolls, legend and
primes included). Real engine, 200 runs per level, before Pro and World Class went up half a
point per round: Pro 28.5%, World Class 14.5%, Legendary 5.0% (real field, drawn per run).
Fast model after the half point (1,000 runs): see `cup-calibration.mjs runs`; Budget mode
(`CUP_BUDGET=1`) reads about a quarter lower than normal on Pro and World Class.
