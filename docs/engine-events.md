# Match engine — UI contract

What a match screen can rely on from `app/core/sim/`. Everything here is plain data on a
`Match` instance (or returned by `replay.js`); the UI only reads it, except for the control
calls listed under _Controls_. The engine is deterministic: the same seed + config gives the
same match, and nothing in this contract consumes simulation RNG.

Status: everything below is live except the penalty shootout (`competition.knockout`, `mode
'shootout'`, `m.shootout`, `shootout*` events) and the `'tip over'` save type, which land in the
next commits of the engine branch with exactly these shapes.

```js
import { Match } from './core/sim/engine.js';
import { simulateComplete, applyReplayFrame, selectHighlights } from './core/sim/replay.js';
import { matchClock } from './core/sim/periods.js';
```

## Lifecycle and controls

| Call | Notes |
| --- | --- |
| `new Match(seed, duration)` | `duration` (real seconds): `180` or `300` (`DURATION_PROFILES`). 90 match minutes are compressed into it; physics is never scaled. |
| `m.importConfig(config)` / `m.exportConfig()` | `{ tuning, competition, teams, players }`. Import resets the match. Export is a full snapshot (tactics incl. mentality, every player profile incl. `chem`). |
| `m.step(1 / 60)` | Advance one fixed step. Call at 60 Hz (or faster for instant results). No-op once `finished`. |
| `m.pauseAtHalf = true` | Stop in `mode === 'halftime'` until `m.resumeHalf()`; otherwise half-time passes automatically. |
| `m.setTactic(team, key, value)` | See _Tactics_. `true` applied · `false` locked (formation in AI/PvP) · `undefined` invalid. |
| `m.swapLineup(a, b)`, `m.setPlayerProfile(id, profile)`, `m.setTags(id, tags)` | Pre-match / half-time lineup edits (unchanged). |

`config.competition`: `{ mode: 'sandbox' | 'ai' | 'pvp', difficulty, knockout?: boolean,
extraTime?: boolean }`. `mode: 'ai'` lets `coach.js` run team 1's tactics. `knockout: true`
decides a level match by a penalty shootout (see below).

### Tactics (`team.tactics`)

| Key | Values |
| --- | --- |
| `formation` | key of `FORMATIONS` (`'433'`, `'442'`, …) |
| `style` | `'balanced' | 'possession' | 'counter' | 'press' | 'wings' | 'bus'` |
| `tempo`, `width`, `press`, `fluidity` | integers 1–5 |
| `mentality` | `'push' | 'balanced' | 'hold'` (default `'balanced'`; `MENTALITIES` in `insights.js`) |

Mentality is a live, replay-safe tactic like the others (part of `exportConfig`, never draws
RNG). The AI coach may set it for team 1. `tacticAccess(mode, team, state)` (coach.js) says
whether the human may edit a side right now.

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
| `time`, `half` | match clock in seconds (`0…2700` first half, `2700…5400` second; beyond = added time). Display with `matchClock(time, half)` → `"45+1:12"` |
| `addedMinutes` | `[firstHalf, secondHalf]` stoppage minutes (announced by an `added` event) |
| `periodDeadline()`, `expectedDuration()` | real-second end of this period / of the whole match (progress bars) |
| `mode` | `'restart'` (dead ball, players setting up) · `'play'` · `'halftime'` · `'fulltime'` · `'shootout'` |
| `phase` | short label: `'Build-up'`, `'In transition'`, `'Final third'`, `'Keeper possession'`, `'Shot on goal'`, `'Moving the ball'`, `'Ball in dispute'`, a restart type, `'Half-time'`, `'Full time'`, `'Penalty shootout'`, `'Match abandoned'` |
| `restart` | `{ type, team, x, y, timer, taker }` while `mode === 'restart'`. Types: `Kickoff`, `Goal`, `Second half`, `Goal kick`, `Corner`, `Throw-in`, `Free kick`, `Indirect free kick`, `Offside`, `Penalty` |
| `finished`, `abandonedTeam` | match over; `abandonedTeam` set when a side drops below 7 players |
| `stats[t]` | team totals: `possession` (seconds), `passes`, `completed`, `shots`, `onTarget`, `blocked`, `offTarget`, `woodwork`, `saves`, `xg`, `boxShots`, `crosses`, `throughBalls`, `tackles`, `takeons`, `dribbleAttempts`, `fouls`, `foulsWon`, `yellowCards`, `redCards`, `offsides`, `penalties`, `penaltyGoals`, `miscontrols`, … `stats[t].xg` is the sum of that side's shot `xg` |
| `players[i]` | 22 players, `id = team * 11 + slot`: `x, y, vx, vy, facing, energy (0–1), role, team, slot, number, name, action, intent, animation, yellowCards, sentOff, emergencyKeeper, chem, stats` (per-player `goals, assists, shots, onTarget, saves, keyPasses, tackles, …`) |
| `activePlayers` | players still on the pitch |
| `ball` | `x, y, z` (m), `vx, vy, vz`, `owner` (player id or `null`), `kind`: `'dribble' | 'held' | 'pass' | 'shot' | 'loose'` |
| `effects` | short-lived visual cues `{ type, x, y, life, maxLife, team, label?, strength? }`: `whistle`, `goal`, `shot`, `tackle`, `feint`, `catch`, `parry`, `delivery` |
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
| `restart` | — (corners, goal kicks, throw-ins, indirect free kicks) |
| `shot` | `playerId`, `assistId` (key pass, or `null`), `shotType` (`Placed finish`, `Driven shot`, `Power shot`, `Curler`, `Knuckleball`, `Header`, `Volley`, `Penalty`), `xg` (0–1), `bigChance`, `oneOnOne`, `situation`, `setPiece`, `direct` (direct free kick), `penalty`, `distance` (m), `box`, `zone`, `foot`, `origin` (`{ x, y, attackX, box, zone }`), `chance` (estimated on-target probability), `outcome`: `'in flight'` → `'goal' | 'saved' | 'blocked' | 'post' | 'off target'`, `resolvedAt` |
| `save` | `playerId` (keeper), `shooterId`, `shotEventId`, `xg`, `bigChance`, `saveType`: `'catch' | 'parry' | 'parry into danger' | 'tip over'`, `difficulty` (0 routine … 1 spectacular), `chance` (save probability) |
| `block` | `playerId` (blocker), `shooterId`, `shotEventId`, `xg`, `bigChance` |
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
| `added` | `minutes` |
| `half` | half-time |
| `full` | full time (also: match abandoned). In a knockout that goes to penalties, `shootout: true` |
| `shootout-start` | `first` (team taking the first kick) |
| `shootout` | one kick: `playerId`, `keeperId`, `round` (1…), `suddenDeath`, `outcome`: `'goal' | 'saved' | 'missed' | 'post'`, `shootoutScore` (`[h, a]` after the kick), `decisive` |
| `shootout-end` | `winner` (team), `shootoutScore` |

**`situation`** (how the attack began, `SHOT_SITUATIONS`): `'open play'`, `'counter'` (ball won
in own half, shot within 15 s), `'regain'` (ball won high, rel. x ≥ 62 m, shot within 10 s),
`'set piece'` (within 8–12 s of a corner / free kick / throw-in by the same possession;
`setPiece: 'corner' | 'free kick' | 'throw-in'`), `'penalty'`.

**`xg`** is shot quality only (geometry: distance + goal angle; header factor; blockers in the
shooter–posts triangle; pressure; one-on-one; a keeper off the shot line), fitted to public
open-play conversion by location. Penalty = 0.76. `bigChance`: `xg ≥ 0.3`, a one-on-one with
`xg ≥ 0.2`, or a penalty. Finishing quality shows up as goals minus xG.

**`story`** tags on goals: `opener`, `equaliser`, `go-ahead`, `comeback` (go-ahead goal by a side
that trailed earlier), `brace`, `hat-trick`, `haul` (4+), `late` (80'+), `stoppage` (added time);
at full time the winning side's last go-ahead goal gains `winner`, plus `late winner` if 80'+.

## Momentum

`m.momentum = { step: 60, samples: [{ time, half, values: [home, away] }], current: [home, away] }`.
One sample per match minute (`time` is the match clock at the sample; first-half stoppage
samples come before the second half's). Each value is 0–1: that side's recent pressure (time on
the ball in the final third plus 2.5 × xG of its shots in the minute, exponentially smoothed).
Draw `home − away` for a momentum bar. Cheap: updated in `step()`, no allocation except one
sample object per match minute.

## Penalty shootout (knockout)

With `competition.knockout === true`, a match level after regulation (incl. stoppage; after
extra time when `competition.extraTime === true`) goes to a shootout: `mode` becomes
`'shootout'`, then `finished` once a winner is known. Kicks alternate, five each then sudden
death; takers are ordered by penalties + composure; each kick is simulated physically
(keeper dive, ball flight), so live play and replays show it.

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
| `simulateComplete(config, seed, record, onProgress, cancelled)` | Runs a full 300 s match → `{ result, frames, clips }` (`frames`/`clips` only when `record`). Pure: can run in a Web Worker. |
| `simulateHalf(match, onProgress, cancelled)` | Records one half of a live match → `{ result, frames, clips, viewDuration: 30, viewOffset }` |
| `RECORD_STEP` | frames are stored every 3 steps (20 per second) |
| `snapshot(m)` | one frame: clock, score, stats, player positions (Float32Array), states, ball, effects, mode, phase, restart, `momentumSamples`, `shootout` |
| `applyReplayFrame(target, recording, viewTime)` | Writes the interpolated frame for `viewTime` (seconds into the highlight reel) onto a display `Match`, including `events` up to that moment (shot outcomes reset to `'in flight'` until resolved), `momentum` (samples up to the frame) and `shootout`. Returns the 1-based clip number. |
| `selectHighlights(events, duration, budget = 60)` | Chronological clips `{ start, end, offset }` totalling `budget` s. Every goal is included; other moments are ranked by `highlightScore`. |
| `highlightScore(event)` | Interest of a non-goal moment: xG and big chances for shots, near misses and woodwork, save difficulty, red cards and penalties, delivery/take-on strength. `0` = never a highlight. |
| `performanceRating(player, match)` | 3–10 match rating |
