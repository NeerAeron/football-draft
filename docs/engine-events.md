# Match engine — UI contract

What a match screen can rely on from `app/core/sim/`. Everything here is plain data on a
`Match` instance (or returned by `replay.js`); the UI only reads it, except for the control
calls listed under _Controls_. The engine is deterministic: the same seed + config gives the
same match, and nothing in this contract consumes simulation RNG.

Status: everything below is live on the engine branch (Phase 1).

```js
import { Match } from './core/sim/engine.js';
import { simulateComplete, applyReplayFrame, selectHighlights } from './core/sim/replay.js';
import { matchClock } from './core/sim/periods.js';
```

## Lifecycle and controls

| Call | Notes |
| --- | --- |
| `new Match(seed, duration)` | `duration` (real seconds): `180` — `MATCH_SECONDS`, the one length the game plays (live, highlights, instant, auto-sims) — or `300`, a profile kept for tests and tools (`DURATION_PROFILES`). 90 match minutes are compressed into it; physics is never scaled. |
| `m.importConfig(config)` / `m.exportConfig()` | `{ tuning, competition, teams, players }`. Import resets the match. Export is a full snapshot (tactics incl. mentality, every player profile incl. `chem`). |
| `m.step(1 / 60)` | Advance one fixed step. Call at 60 Hz (or faster for instant results). No-op once `finished`. |
| `m.pauseAtHalf = true` | Stop in `mode === 'halftime'` until `m.resumeHalf()`; otherwise half-time passes automatically. |
| `m.setTactic(team, key, value)` | See _Tactics_. `true` applied · `false` locked (formation in AI/PvP) · `undefined` invalid. |
| `m.swapLineup(a, b)`, `m.setPlayerProfile(id, profile)`, `m.setTags(id, tags)` | Pre-match / half-time lineup edits (unchanged). |
| `m.winner()` | `0` / `1` once decided (score, shootout, or the opponent of an abandoned side), `null` for a draw or while running. |

`config.competition`: `{ mode: 'sandbox' | 'ai' | 'pvp', difficulty, knockout?: boolean,
extraTime?: boolean }`. `mode: 'ai'` lets `coach.js` run team 1's tactics. `knockout: true`
decides a level match by a penalty shootout (see below).

### Tactics (`team.tactics`)

| Key | Values |
| --- | --- |
| `formation` | key of `FORMATIONS` (`'433'`, `'442'`, …) |
| `style` | `'balanced' | 'possession' | 'counter' | 'press' | 'wings' | 'bus'` |
| `tempo`, `width`, `press`, `fluidity` | integers 1–5 |
| `mentality` | `'auto' | 'push' | 'balanced' | 'hold'` (engine default `'balanced'`; `MENTALITIES` in `insights.js`). `'auto'` follows the game state; `m.mentality(team)` returns the one in effect |

Mentality is a live, replay-safe tactic like the others (part of `exportConfig`, never draws
RNG). The rule: **Push raises the chance of a goal at both ends, Hold lowers it at both ends,
Balanced is the zero point**; between even sides the three are worth about the same points, so
the choice is about how open the game should be. What each changes is in
`tuning.mentality.push` / `.hold` (differences from Balanced; `m.mentalityShift(team)` returns
the set in effect, `m.lean(team)` +1 / 0 / −1). `push`: higher line (+8), more runners and
overlaps, +15% shooting urge, quicker restarts (−15%), +5% energy cost, and room to shoot at
both ends (`chances` 0.55 for its own shots, `exposure` 0.3 for the shots it concedes). `hold`:
deeper block (−10), fewer runners, safer passing, slower restarts (×1.25), −5% energy cost, and
less room at both ends (`chances` −0.33, `exposure` −0.24). `m.shootingRoom(team)` is the sum
for a shot by `team` (its own `chances` + the defending side's `exposure`); a non-penalty
shot's scatter is divided by `1 + room` (clamped to 0.5–2). Two small rewards for a well-timed
choice are read from the score at the moment of the shot: a side that is behind and pushing
gets `tuning.mentality.chase` (0.1) more room for its own shots, a side that is ahead and
holding takes `protect` (0.1) off the opponent's. They apply to the mentality in effect, so
`'auto'` earns them too when it resolves to push or hold. Over 1,400 even club fixtures, all
match: push 1.51–1.41 goals, balanced 1.24–1.19, hold 0.94–0.89 (docs/calibration.md).
`gameStateMentality(m, team)` (coach.js) returns the
game-state choice — after 70' a trailing side pushes, from 75' a leading side holds. The AI
coach applies it to team 1; a side whose mentality is `'auto'` gets it too (the UI's default
for a side that did not choose, so instant sims and highlights also chase a game). Tactics also cost energy: press
level out of possession (±11% per step from 3, +8% for the press style) and tempo in
possession (±7% per step). `tacticAccess(mode, team, state)` (coach.js) says whether the human
may edit a side right now.

### Player config (`config.players[i]`)

Profile fields as before (`name`, `fullName`, `primaryPosition`, `secondaryPositions`, `attrs`,
`tags`, `foot`, `weakFoot`, `tendencies`, `profileId`, `sourcePlayerId`, `sourceOverall`, …)
plus **`chem`**: links/chemistry bonus, a number clamped to 0–2 (default 0), added to every
`Player.skill()` value. The draft computes it; the engine only applies it.

## Match state

| Field | Meaning |
| --- | --- |
| `score` | `[home, away]` goals (regulation + extra time; shootout kicks are separate) |
| `teams[t]` | `{ name, short, color, tactics }` — team 0 is home |
| `elapsed` | real seconds simulated |
| `time`, `half` | match clock in seconds (`0…2700` first half, `2700…5400` second, extra time `5400…6300` half 3 and `6300…7200` half 4; beyond a period's end = added time). Display with `matchClock(time, half)` → `"45+01:12"`. `PERIOD_START` / `PERIOD_END` in `periods.js`. The clock stops during a shootout. |
| `addedMinutes` | `[firstHalf, secondHalf]` stoppage minutes (announced by an `added` event) |
| `periodDeadline()`, `expectedDuration()` | real-second end of this period / of the whole match (progress bars) |
| `mode` | `'restart'` (dead ball, players setting up) · `'play'` · `'halftime'` · `'fulltime'` · `'shootout'` |
| `phase` | short label: `'Build-up'`, `'In transition'`, `'Final third'`, `'Keeper possession'`, `'Shot on goal'`, `'Moving the ball'`, `'Ball in dispute'`, a restart type, `'Half-time'`, `'Full time'`, `'Penalty shootout'`, `'Match abandoned'` |
| `restart` | `{ type, team, x, y, timer, taker }` while `mode === 'restart'`. Types: `Kickoff`, `Goal`, `Second half`, `Extra time`, `Goal kick`, `Corner`, `Throw-in`, `Free kick`, `Indirect free kick`, `Offside`, `Penalty` |
| `finished`, `abandonedTeam` | match over; `abandonedTeam` set when a side drops below 7 players |
| `stats[t]` | team totals: `possession` (seconds), `passes`, `completed`, `shots`, `onTarget`, `blocked`, `offTarget`, `woodwork`, `saves`, `xg`, `boxShots`, `crosses`, `throughBalls`, `tackles`, `takeons`, `dribbleAttempts`, `fouls`, `foulsWon`, `yellowCards`, `redCards`, `offsides`, `penalties`, `penaltyGoals`, `miscontrols`, … `stats[t].xg` is the sum of that side's shot `xg` |
| `players[i]` | 22 players, `id = team * 11 + slot`: `x, y, vx, vy, facing, energy (0–1), role, team, slot, number, name, action, intent, animation, yellowCards, sentOff, emergencyKeeper, chem, stats` (per-player `goals, assists, shots, onTarget, saves, keyPasses, tackles, …`) |
| `activePlayers` | players still on the pitch |
| `ball` | `x, y, z` (m), `vx, vy, vz`, `owner` (player id or `null`), `kind`: `'dribble' | 'held' | 'pass' | 'shot' | 'loose'` |
| `effects` | short-lived visual cues `{ type, x, y, life, maxLife, team, label?, strength? }`: `whistle`, `goal`, `shot`, `tackle`, `feint`, `catch`, `parry` (label `PARRIED` / `TIPPED OVER`), `header` (`WON IN THE AIR`), `delivery` |
| `players[i].animation` | `{ type, start, duration, … }`: `pass`, `shot`, `feint`, `beaten`, `stumble`, `tackle`, `dive` (with `stretch` 0–1 for a keeper's dive; `hold: true` for a penalty dive — he stays stretched out where he landed) |
| `goalHistory` | goal events in order (oldest first) |
| `halftime` | `{ score, energyBefore, energyAfter }` after the break |
| `momentum` | rolling momentum series, see below |
| `shootout` | `null`, or the shootout state, see below |

Pitch: 105 × 68 m (`W`, `H`), goal 7.32 m wide (`GOAL`), 2.44 m high. Team 0 attacks towards
x = 105 in the first half; ends swap at half-time (`m.direction(t)` is `+1` / `-1`).

## Events

`m.events` is **newest first** (`unshift`). Each event:
`{ id, type, text, team, time, half, elapsed, ...fields }` — `id` increases monotonically,
`team` is the side the event is _for_ (`null` for neutral events), `text` is a ready-made
feed line. `playerId` / `assistId` / … index `m.players`. Optional numeric hints:
`chance` (0–1, with `chanceLabel`) and `strength` (0–1, visual intensity).

Two events are **updated in place** later — key UI caches on `id` + `outcome`:
a `shot` gets its final `outcome` and `resolvedAt` when the ball's fate is known, and a `goal`
may gain `'winner'` / `'late winner'` in `story` at full time.

| Type | Extra fields |
| --- | --- |
| `kickoff` | — |
| `restart` | `restart`: the restart type (corners, goal kicks, throw-ins, indirect free kicks). For a corner, `m.restart` also has `routine` (`'near post' | 'far post' | 'edge'`), `target` (player id) and `aim` (`{ x, y }`) while it is set up |
| `shot` | `playerId`, `assistId` (key pass, or `null`), `shotType` (`Placed finish`, `Driven shot`, `Power shot`, `Curler`, `Knuckleball`, `Header`, `Volley`, `Penalty`), `xg` (0–1), `bigChance`, `oneOnOne`, `situation`, `setPiece`, `direct` (direct free kick), `penalty`, `distance` (m), `box`, `zone`, `foot`, `origin` (`{ x, y, attackX, box, zone }`), `chance` (estimated on-target probability), `outcome`: `'in flight'` → `'goal' | 'saved' | 'blocked' | 'post' | 'off target'`, `resolvedAt` |
| `save` | `playerId` (keeper), `shooterId`, `shotEventId`, `xg`, `bigChance`, `saveType`: `'catch' | 'parry' | 'parry into danger' | 'tip over'`, `difficulty` (0 routine … 1 spectacular: 1 − the save probability from the dive model — stretch, power, height), `chance` (save probability). The ball does what the type says: a catch is held, a tip over clears the bar and goes behind for a corner (the lift is computed from the distance left to the line), a parry goes wide/behind outside the post or back into play — a saved ball never crosses the line under the bar (tests/set-pieces-and-keepers.test.mjs). `'parry into danger'` = an attacker is first to the rebound; a goal from it is a new shot |
| `block` | `playerId` (blocker), `shooterId`, `shotEventId`, `xg`, `bigChance`; a blocked cross, or a delivery a pressed defender stabs away in his own box (text "… deflects it."), has `cross: true` and no shot fields |
| `post` | woodwork: `playerId` (shooter), `shotEventId`, `xg`, `bigChance`, `frame: 'post' | 'bar'` |
| `near-miss` | just wide / over: `playerId`, `shotEventId`, `xg`, `bigChance`, `miss: 'wide' | 'over'`, `by` (metres, < 0.6) |
| `goal` | `playerId` (`null` for an own goal), `assistId`, `ownGoal`, `shotType`, `shotEventId`, `xg`, `bigChance`, `oneOnOne`, `situation`, `setPiece`, `penalty`, `box`, `zone`, `origin`, **`scoreAfter`** (`[h, a]` including this goal — use it for banners, not `m.score`), **`story`** (see below) |
| `cross`, `cutback`, `through` | completed final-third delivery: `playerId` (passer), `chance`, `strength` |
| `dribble` | successful take-on: `playerId`, `chance`, `strength` |
| `tackle` | `playerId` (winner), `chance`, `strength` |
| `intercept` | `playerId` |
| `foul` | `playerId` (fouled), `offenderId`, `origin` — also used for a double touch |
| `penalty` | penalty awarded (a foul in the box): same fields as `foul` |
| `offside` | `playerId`, `line` |
| `yellow`, `red` | `playerId`, `reason`, `secondYellow` |
| `reshape` | after a red card, when the side closed the hole: `playerIds` (who moved) and `roles` (their new positions). See _Ten men_ |
| `added` | `minutes` |
| `half` | half-time |
| `full` | full time (also: match abandoned). In a knockout that goes to penalties, `shootout: true` (the match is not `finished` yet) |
| `extra-time` | `period: 1 | 2` — start of each extra-time half |
| `shootout-start` | `first` (team taking the first kick) |
| `shootout` | one kick, at its outcome: `playerId`, `keeperId`, `round` (1…), `suddenDeath`, `outcome`: `'goal' | 'saved' | 'missed' | 'post'`, `shootoutScore` (`[h, a]` after the kick), `decisive`, `kickedAt` (elapsed of the strike) |
| `shootout-end` | `winner` (team), `shootoutScore` |

### Penalties (in the match)

A foul in the box → `penalty` event, then `restart.type === 'Penalty'` for about 2.6 s. The set-up
is immediate (`setupPenalty`, the UI cuts to it): the keeper on his line in the middle of the goal,
the taker 3.4 m behind the ball, everyone else outside the box and the arc and behind the ball
(spread along the edge, two of the taker's defenders and one opposing forward up the pitch). The
taker runs up in the last second, through the ball (he arrives as he strikes it); at the strike the keeper commits
(`startPenaltyDive`: left 45% / right 45% / stays 10%, independent of the taker's side) and
`players[keeper].penaltyDive` (`{ at, until, x0, y0, x, y }`) moves him ~2 m in a third of a second
(`movement.js stepDive`). The save model then works from where the dive put him: only a keeper who
went the right way can reach it. Play is live after the kick (rebounds count). Measured over
1,600 fixtures (347 penalties): 76% scored, 18% saved, 5% off target or woodwork (before: 82% /
3% / 16%) — a shootout (every taker, not only the best) is 74% / 17% / 10%.

### Ten men

A red card never leaves a hole: `coverDismissal` (fouls.js) swaps formation slots at once, for
either side. A lost defender is replaced by the midfielder who knows the position best
(`positionFamiliarity`) and a forward drops into the midfield; a lost midfielder costs a forward
(the second striker, else an attacking midfielder or winger); a lost lone striker is replaced by
another attacker; one of two strikers costs nothing. A dismissed keeper's stand-in
(`emergencyKeeper`) has his old position covered the same way. Slots are swapped with the player
who left, so later formation changes keep the shape; `reset()` restores them. No RNG.

**`situation`** (how the attack began, `SHOT_SITUATIONS`): `'open play'`, `'counter'` (ball won
in own half, shot within 15 s), `'regain'` (ball won high, rel. x ≥ 62 m, shot within 10 s),
`'set piece'` (within 8–12 s of a corner / free kick / throw-in by the same possession;
`setPiece: 'corner' | 'free kick' | 'throw-in'`), `'penalty'`.

**`xg`** is the engine's own expected goals: a logistic fit of how often this engine's shots go
in (`shotXg` in insights.js: distance — flat beyond 28 m — and goal angle; header; blockers in
the shooter–posts triangle; pressure; a keeper off the shot line), not public real-football
conversion: the game's shots score about a quarter of the time, so a real-world xG read a third
of the goals. Summed xG ≈ goals over many matches (docs/calibration.md, Phase 6). Roughly 0.8
from 3 m, 0.45 from the penalty spot, 0.25 from the edge of the box, 0.07 from 30 m; penalty =
0.76 (`PENALTY_XG`, the measured conversion). Shot quality only: finishing skill shows up as
goals minus xG. Display only — nothing in the simulation reads it. `bigChance`: `xg ≥ 0.6`, a
one-on-one with `xg ≥ 0.5`, or a penalty (about one shot in twenty; they go in ~63%).

**`story`** tags on goals: `opener`, `equaliser`, `go-ahead`, `comeback` (go-ahead goal by a side
that trailed earlier), `brace`, `hat-trick`, `haul` (4+), `late` (80'+), `stoppage` (added time);
at full time the winning side's last go-ahead goal gains `winner`, plus `late winner` if 80'+.

## Momentum

`m.momentum = { step: 60, samples: [{ time, half, values: [home, away] }], current: [home, away] }`.
One sample per match minute (`time` is the match clock at the sample; first-half stoppage
samples come before the second half's). Each value is 0–1: that side's recent pressure (time on
the ball in the final third plus 0.7 × xG of its shots in the minute, exponentially smoothed).
Draw `home − away` for a momentum bar. Cheap: updated in `step()`, no allocation except one
sample object per match minute.

## Penalty shootout (knockout)

With `competition.knockout === true`, a match level after regulation (incl. stoppage; after
extra time when `competition.extraTime === true`) goes to a shootout: `mode` becomes
`'shootout'`, then `finished` once a winner is known. Kicks alternate, five each then sudden
death; takers are ordered by penalties + composure (keeper last); each kick is simulated
physically (keeper dive, ball flight; no follow-ups). The UI does not show that: it steps the
match to the end and lists the kicks as marks (docs/ui-match.md), and recordings stop at the
final whistle. All kicks
are taken at the x = 105 goal (`m.direction()` follows the kicking side). Each kick is set up at
once (no walking between kicks: the kicker 3.4 m behind the ball, the keeper on his line in the
middle, the other keeper beside the goal, both teams lined up on halfway) and takes about
3.5 s: 0.9 s over the ball, a 0.8 s run-up, the strike with the keeper's dive (as in a match
penalty, above), a 1.15 s pause on the verdict with the keeper where he landed and a scored ball
in the net (`phase` stays `'Penalty shootout'`); after the decisive kick
`winner` is set at once and the match finishes ~1.6 s later with a `shootout-end` event. Kicks
never count as match shots or xG. The first kicker is a seeded coin toss.

```js
m.shootout = {
  first,            // team taking the first kick
  kicks: [{ team, playerId, keeperId, round, outcome, scored, suddenDeath }],
  score: [h, a],    // shootout goals (m.score keeps the regulation score)
  winner,           // null until decided, then 0 | 1
}
```

## Replay, highlights and instant results (`replay.js`)

| API | Notes |
| --- | --- |
| `simulateComplete(config, seed, record, onProgress, cancelled)` | Runs a full match (`MATCH_SECONDS`) → `{ result, frames, clips }` (`frames`/`clips` only when `record`). Pure: can run in a Web Worker. |
| `simulateHalf(match, onProgress, cancelled)` | Records one half of a live match → `{ result, frames, clips, viewDuration: 30, viewOffset }` |
| `RECORD_STEP` | frames are stored every 3 steps (20 per second) |
| `snapshot(m, previous?)` | one frame: clock, score, stats, player positions (Float32Array), states, ball, effects, mode, phase, restart, `momentumSamples`, `shootout`. Given the frame before it, the parts that did not change (most players' states, a side's stats, the restart) are shared with it, not copied — a recorded half is a third of the size to hand from the worker to the page. Frames are read-only |
| `applyReplayFrame(target, recording, viewTime)` | Writes the interpolated frame for `viewTime` (seconds into the highlight reel) onto a display `Match`, including `events` up to that moment (shot outcomes reset to `'in flight'` until resolved) and `momentum` (samples up to the frame). A reel plays at 60 fps from 20 frames a second: when the display match already shows the frame, only the interpolated parts (positions, ball, clock, events) are written again. Between the last frame before a goal and the next (ball back on the centre spot) the ball runs on along its path, into the net. Returns the 1-based clip number. |
| `selectHighlights(events, duration, budget = 60)` | Chronological clips `{ start, end, offset }` totalling `budget` s. Every goal and every red card is included (they share the reel when there are many); other moments are ranked by `highlightScore`. A penalty shootout is never in a reel: clips end at the `shootout-start` event, and `simulateHalf` / `simulateComplete` record no frames after it (`result.shootout` has the kicks). |
| `highlightScore(event)` | Interest of a non-goal moment: xG and big chances for shots, near misses and woodwork, save difficulty, red cards and penalties, delivery/take-on strength. `0` = never a highlight. |
| `performanceRating(player, match)` | 3–10 match rating |
