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
| `m.pauseAtHalf = true` | Stop in `mode === 'halftime'` until `m.resumeHalf()`; otherwise the break passes automatically. Two breaks use it: half-time (`half === 1`) and, in a knockout match with extra time that is level after 90 minutes, the break before extra time (`half === 2`; `resumeHalf()` starts extra time). Tactics, the formation and the line-up can be changed in both. |
| `m.setTactic(team, key, value)` | See _Tactics_. `true` applied · `false` locked (formation in AI/PvP) · `undefined` invalid. |
| `m.swapLineup(a, b)`, `m.setPlayerProfile(id, profile)`, `m.setTags(id, tags)` | Pre-match / half-time lineup edits (unchanged). |
| `m.winner()` | `0` / `1` once decided (score, shootout, or the opponent of an abandoned side), `null` for a draw or while running. |

`config.competition`: `{ mode: 'sandbox' | 'ai' | 'pvp', difficulty, knockout?: boolean,
extraTime?: boolean, edge?: false }`. `mode: 'ai'` lets `coach.js` run team 1's tactics.
`knockout: true` decides a level match by a penalty shootout (see below); with `extraTime:
true` it plays extra time first (see _Extra time_). The engine only does what the config says;
the game's rule — every knockout match plays extra time — is `buildMatchConfig`'s
(docs/ui-match.md).

**The player's side as favourite** (`tuning.userEdge`, `m.edge`). In `mode: 'ai'` team 0 is
the player's side. When its XI has the higher overall at kick-off (mean `overallRating` of the
eleven in their roles, without chemistry), `m.edge[0]` = lead × `perPoint` (0.006), at most
`cap` (0.05); otherwise `[0, 0]` — never for the weaker side, never for team 1, never in
`'pvp'` or `'sandbox'`, and not when `competition.edge === false` (the match screen sets that
for an Exhibition, where both sides are the player's pick). Its one effect is in `keeperSave`:
every save chance is multiplied by `1 + edge[keeper's team] − edge[other team]`, so a 5-point
favourite's keeper is 3% surer and the keeper facing it 3% less sure — about +3% / −3% on the
two sides' conversion. `m.edge` is `null` until the first step, is worked out once there and
then travels with the match (worker halves, half-time): no RNG, nothing re-read later. The fast
rating model (`competition/model.js`) does not include it.

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
| `addedMinutes` | `[firstHalf, secondHalf]` stoppage minutes (announced by an `added` event; 1.6 and 2.1 on average, `tuning.periods`) |
| `heldTime` | real seconds each period ran past its deadline because the whistle was held (`[0, 0, 0, 0]`, filled in as the periods end), see _The final whistle_ |
| `periodDeadline()`, `expectedDuration()` | real-second end of this period / of the whole match (progress bars) |
| `mode` | `'restart'` (dead ball, players setting up) · `'play'` · `'halftime'` (a break: half-time when `half === 1`, the one before extra time when `half === 2`) · `'fulltime'` · `'shootout'` |
| `phase` | short label: `'Build-up'`, `'In transition'`, `'Final third'`, `'Keeper possession'`, `'Shot on goal'`, `'Moving the ball'`, `'Ball in dispute'`, a restart type, `'Half-time'`, `'Full time'`, `'Penalty shootout'`, `'Match abandoned'` |
| `restart` | `{ type, team, x, y, timer, taker, build, routine, waited }` while `mode === 'restart'` (`build`: a goal kick or a deep free kick, see _Building up from the back_; `waited`: seconds since it was awarded). Types: `Kickoff`, `Goal`, `Second half`, `Extra time`, `Goal kick`, `Corner`, `Throw-in`, `Free kick`, `Indirect free kick`, `Offside`, `Penalty` |
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
| `restart` | `restart`: the restart type (corners, goal kicks, throw-ins, indirect free kicks). For a corner, `m.restart` also has `routine` (`'near post' | 'far post' | 'edge'`), `target` (player id) and `aim` (`{ x, y }`) while it is set up; for a goal kick or a deep free kick `routine` (`'short' | 'long'`, see _Building up from the back_) |
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
| `full` | a final whistle (also: match abandoned). `extraTime: true`: the whistle at 90 minutes of a level knockout tie that goes on to extra time (not `finished`: the break follows). `shootout: true`: it goes to penalties (not `finished` yet). `afterExtraTime: true`: the whistle that ends extra time (with `shootout: true` when it is still level) |
| `extra-time` | `period: 1 | 2` — start of each extra-time period |
| `shootout-start` | `first` (team taking the first kick) |
| `shootout` | one kick, at its outcome: `playerId`, `keeperId`, `round` (1…), `suddenDeath`, `outcome`: `'goal' | 'saved' | 'missed' | 'post'`, `shootoutScore` (`[h, a]` after the kick), `decisive`, `kickedAt` (elapsed of the strike) |
| `shootout-end` | `winner` (team), `shootoutScore` |

### The level of the match

`m.level` is `null` until the first step, then `[team 0, team 1]`: the level each side attacks
at (`kickoffLevel`, read once from the line-ups like `m.edge`). The match part is the same for
both — the mean overall of the 22 in points above 78, plus `gameplay.levelGap` per point
between the two sides; `gameplay.levelUnits` adds, per side, the opponent's defence level
above the opponent's overall less its own attack level above its own (`unitLevels` /
`unitLean`, `players/unit-levels.js`); clamped to ±14. Per point a side's shots scatter
`gameplay.levelScatter` × 4% more and are saved `levelSaves` × 0.4% more (penalties and
shootouts excepted). It keeps the goals of a match from following the general level of the
players while a side's scoring still follows its attack against the defence it meets
(docs/calibration.md, Phases 9 and 10). No RNG, nothing per step.

### Building up from the back: goal kicks, deep free kicks, the keeper's hands

Three situations share one shape and one chooser (restarts.js `buildUpSpot`, passing.js
`buildUpOption`): a goal kick, a free kick within 40 m of the taker's own goal line (`Offside`,
`Free kick`, `Indirect free kick` — `m.restart.build` is true for these and for goal kicks) and
the keeper with the ball in his hands in open play (`ball.kind === 'held'`).

**Nobody is placed.** When the restart is awarded every outfield player gets a target and runs
there through the ordinary movement code (82% of top speed; a free kick's attackers re-aim
every step so they hold at the last line while it drops). Only the ball is put on its spot.
The taker — the keeper at a goal kick, the nearest defender or midfielder at a deep free kick
— walks to the ball and waits at least 1 s (`m.restart.timer`), then until the sides are set
(`buildUpSet`: his back line and midfield within 5 m of their spots, everybody else within
14 m, the opponents out of the box / 9.15 m away) or `gameplay.buildUpWait` (3.5 s) has
passed (`m.restart.waited`); a taker still on his way gets 2 s more. The 9.15 m and
out-of-the-box corrections at the kick remain as a safety net. With the ball in the keeper's
hands the same targets come from planning.js (`Offering for the build-up` / `Dropping off`)
and the keeper holds it until the sides are set or `buildUpWait`. After the kick everybody
plays on from where he is — no return to formation spots.

* The side without the ball drops into a mid-block — forwards 44 m, midfield 56 m, back line
  70 m from the other goal line at a goal kick — or, when its `press` is 4+ or its mentality
  in effect is Push, comes up to the edge of the box (23 / 40 / 70 m). For a free kick `o`
  metres further up than a goal kick the lines are 0.45 `o` (back line 0.4 `o`) higher, never
  nearer than 11 m to the ball.
* `m.restart.routine` (`buildUpRoutine`): `'short'` against a mid-block — centre-backs either
  side of the box (the middle one of a three in front of it), full-backs wide at 22 m,
  midfield from 30 m; `'long'` against the press, or when the side itself is on Push — back
  line at 29–33 m, midfield around 50 m, forwards at 64 m and narrower. At a free kick these
  move up by 0.5–0.6 `o` and nobody stands beyond the last opponent.
* The kick (`buildUpOption`): short (never in a `'long'` routine) only to a team-mate along
  the ground, 8–31 m away, with nobody within 13 m of where he takes it, lane risk under 0.25
  and 0.8 s to spare, not on a touchline; otherwise long — a lofted pass to the best header of
  the ball up the pitch (heading, strength, aerial tendency, team-mates within 16 m for the
  second ball; onside unless it is a goal kick; led up to 10 m towards the spot he is running
  to), aimed no closer than 13 m to a touchline. A goal kick is kicked from the ground at the
  end of the restart (the ball is never `'held'` at a goal kick any more). The keeper in open
  play throws or passes the short ball as soon as it is on (after the format's `release`
  time: the quick throw to a free defender) and goes long only once the sides are set.
* The man the keeper gives it to in their own half (any pass from the keeper, for 2 s) plays
  only a ball that is really on — risk under 0.3, 0.3 s to spare, completion over 72% — or,
  unpressed, takes it on a few steps and looks again (decisions.js).

### The back line and first touches

* **One line a side** (planning.js `planTeam`: `c.line`, `c.hold`; `gameplay.lineAwareness`,
  0 switches all of this off). With the ball: 18 m behind it up to 48 m from the own goal
  line, 24 m behind beyond that, deeper as a unit for slow centre-backs or a pressed carrier,
  and goal-side of an opposing forward who is level with it or in front of it; a forward
  clearly behind it (an offside position) is left, nobody covers, the keeper stands up to 13 m
  out. Without the ball: the block's line; a back-line defender whose man is beyond it shows
  the action `Holding the line` (intent `shape`) when `holdsLine` says stepping up is the
  better bet — the man standing or coming back, or the carrier pressed, moving away or far
  off — and goes with a runner otherwise. Poor readers sometimes go anyway.
* **First touch** (`firstTouchChance`, `gameplay.freeTouch`): for a receiver with no opponent
  within 4.5 m the height, delivery demand and in-the-air speed of a team-mate's ball count
  30%; full from a pressure of 0.3.

### The final whistle

The referee does not blow for half-time or full time (or the end of an extra-time period) in
the middle of an attack (`sim/whistle.js`, `whistleHeld`). When the clock, added time included,
runs out, play goes on while

* the attacking side has the ball within `periods.holdRange` (30 m) of the goal line — once the
  whistle is held, anywhere in the attacking third — or its pass, cross or through ball is on
  its way there, its shot is in flight, or a loose ball is in the box it attacks (or anywhere in
  that third while the whistle is held);
* its corner, or its free kick in the attacking third, has been awarded and is being set up;
* a penalty has been awarded: it is always taken and the kick decided (as before).

The whistle goes as soon as that is over: a goal (after its celebration), the keeper holding
the ball (at once), the ball out for a goal kick or a throw-in, a free kick or offside against
the attackers (at once), or the attackers without the ball for half a second (cleared, a
defender on it, a pass gone astray). Caps, all in `match.tuning.periods` (real seconds of play —
2 s are a minute on the match clock): an attack gets `holdAttack` (4 s), counted again from the
delivery of a set piece it wins, and is not cut while its cross is in the air towards the box;
of the corners awarded after time was up `holdCorners` (1) are taken (one already awarded when
time ran out does not count); a new set piece is only waited for when it can be delivered and
played for 2 s before `holdMaximum` (10 s); beyond `holdMaximum` only a struck shot and the goal
it scores are allowed to finish (4 s more). Nothing here draws RNG and no state is added to the
clock: `time` simply runs on as added time (`"45+03:10"` with two minutes announced) and
`heldTime[half − 1]` records how long. A match in which nothing is on at any whistle is, step
for step, the match it was before. The whole thing happens inside `step()`, so Full, Key
Moments, Instant and the auto-sim worker get the same match; a goal scored in held time is a
goal of that half (`story` has `stoppage`) and is in its reel like any other.

Measured on 960 club fixtures (`tools/calibration/lib/fixtures.mjs`): the whistle is held in
28% of the periods, for 3.1 s on average (docs/calibration.md, Phase 8).

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

### Tight angles

A shot's accuracy is an angle off the boot, its aim a point on the goal line: the scatter is
multiplied by 1 / the sine of the angle the shot makes with the line (1 from in front, 1.4 from
45°, 2 from 60°, at most 4), so a ball struck along the goal line rarely lands between the
posts. A carrier's urge to shoot fades from 50° off the centre line and is gone by 78° (he cuts
back or crosses, `decide`). With the ball wide and within 5.5 m of his goal line — or an
opponent's pass on its way there — the keeper drops to his near post, a quarter of the ball's
own distance off his line (`planKeeper`), and a shot from more than 60° off the centre line
that comes within his reach is kept out more surely the tighter the angle (`keeperSave`). `xg`
fades the same way beyond 53°. Measured over 288 club fixtures: shots seeing less than 12° of
goal from inside 20 m scored 30% before and 3% after; shots from in front (within 30° of the
centre line, 5–16.5 m) 47% before and after (docs/calibration.md).

### Rebounds (second balls)

A shot the keeper parried, a defender blocked or the woodwork kept out is a **rebound** while
the ball is loose within 30 m of that goal line, for at most 3 s (`sim/rebound.js`:
`startRebound(team)` sets `ball.reboundTeam` — the side defending the goal — and
`ball.reboundAt`; `reboundSide()` returns that side or −1; taking the ball or a restart ends
it). `gameplay.secondBalls` 0 switches all of it off. While it lasts:

- **Both sides see it in the same instant**: the next step plans, and nobody waits for his own
  `rethinkAt`. The side that shot is still the attacking side and the other one defends,
  whoever touched the ball last (after a parry the defending side used to count as "in
  possession" and ran out to its support positions).
- **The defending side's nearest two outfielders go for the ball** (`intent: 'recover'`,
  actions `Attacking the loose ball` / `Attacking the second ball`); the rest mark. The
  attacking side sends its nearest man and keeps its runs into the box. All of them run at
  `loosePoint(p)`: the first point on the ball's rolled-forward path (bounces, grass) they can
  reach in time, turning included — and a man turning for a rebound brakes 1.6 × harder than he
  accelerates (both sides).
- **A defender who reaches it in his own box with an attacker within 4.5 m of the ball clears
  it** first time (`shouldClearRebound` / `clearRebound`, action `Clearing the rebound`, no
  event): lofted upfield through the widest gap between the attackers closing in; a clumsy
  one (4–30% by defending, composure and power) is sliced square towards the touchline. He
  lunges for it (reach + 0.7 m; + 0.25 m for a rebound nobody contests, which he controls as
  usual).
- **The keeper claims** a rebound in his box that he reaches before any attacker
  (`intent: 'sweep'`, action `Claiming the loose ball`), and a parry back into the box is
  pushed harder and — likelier the better the keeper — away from the attacker following in.
- **The shooter is in his follow-through** for 0.5 s: a ball blocked back at him is not at his
  feet again in the same instant.

Who gets there first is still decided by legs and distance: attackers reach about a fifth of
the rebounds first (a third of the parries labelled `'parry into danger'`), see
docs/calibration.md, Phase 11.

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

## Extra time (knockout)

With `competition.knockout` and `competition.extraTime`, a match level after 90 minutes (added
and held time included) does not end: `finishPeriod` adds a `full` event with `extraTime: true`
and puts the match in a **break** — `mode: 'halftime'`, `half: 2`, `phase: 'Extra time'` —
which behaves like half-time: with `pauseAtHalf` the match waits for `resumeHalf()` (tactics,
formation and line-up can change), without it the next step goes on. Then two periods of a
sixth of the match length each (30 s of the 180 s match: 15 match minutes, a third of the
ninety in all) with one minute of added time each (`addedMinutes[2..3]`), `half` 3 and 4, clock
`5400…6300` and `6300…7200`; the second follows the first at once — an `extra-time` event, a
kick-off, the sides change ends, no break. Both are always played. Everything carries over:
the score, cards and sendings-off, the tactics, the stamina — legs get a third of half-time's
recovery at the break (`stamina.halftimeRecovery × 0.3`) and tire 20% faster than in the first
half. `'auto'` mentality and the AI coach read the score from the first minute of extra time
(a side behind pushes, a side ahead holds; the coach chases or shuts up shop as after 75').
The whistle is held for an attack at the end of each period like any other (`heldTime[2..3]`).
If one side leads after the second period the match is `finished` (`full` with
`afterExtraTime: true`, `winner()` by the score); still level, it goes to the shootout.

Measured on 480 club fixtures made level at 90 minutes: 0.61 goals in extra time (0.69 in 30
ordinary minutes), 45% decided there and 55% on penalties; mean outfield energy 0.59 at 90
minutes and 0.39 at the end.

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
| `simulateHalf(match, onProgress, cancelled)` | Records one stretch of a live match between two breaks → `{ result, frames, clips, viewDuration, viewOffset }`: the first half, the second (to the end, or to the break before extra time) — 30 s of clips each — or the whole of extra time (both periods; `EXTRA_TIME_REEL` = 20 s of clips, `viewOffset` 60). `result.mode === 'halftime'` means another stretch follows |
| `RECORD_STEP` | frames are stored every 3 steps (20 per second) |
| `snapshot(m, previous?)` | one frame: clock, score, stats, player positions (Float32Array), states, ball, effects, mode, phase, restart, `momentumSamples`, `shootout`. Given the frame before it, the parts that did not change (most players' states, a side's stats, the restart) are shared with it, not copied — a recorded half is a third of the size to hand from the worker to the page. Frames are read-only |
| `applyReplayFrame(target, recording, viewTime)` | Writes the interpolated frame for `viewTime` (seconds into the highlight reel) onto a display `Match`, including `events` up to that moment (shot outcomes reset to `'in flight'` until resolved) and `momentum` (samples up to the frame). A reel plays at 60 fps from 20 frames a second: when the display match already shows the frame, only the interpolated parts (positions, ball, clock, events) are written again. Between the last frame before a goal and the next (ball back on the centre spot) the ball runs on along its path, into the net. Returns the 1-based clip number. |
| `selectHighlights(events, duration, budget = 60)` | Chronological clips `{ start, end, offset }` totalling `budget` s. Every goal and every red card is included (they share the reel when there are many); other moments are ranked by `highlightScore`. A penalty shootout is never in a reel: clips end at the `shootout-start` event, and `simulateHalf` / `simulateComplete` record no frames after it (`result.shootout` has the kicks). |
| `highlightScore(event)` | Interest of a non-goal moment: xG and big chances for shots, near misses and woodwork, save difficulty, red cards and penalties, delivery/take-on strength. `0` = never a highlight. |
| `performanceRating(player, match)` | 3–10 match rating |
