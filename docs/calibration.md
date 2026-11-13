# Match engine calibration

Reproducible with `tools/calibration/match-calibration.mjs` (worker threads; ~2 min for 128
matches on 2 workers):

```sh
# after: the working tree
node tools/calibration/match-calibration.mjs --workers 2 --out /tmp/after.json
# before: any other checkout's app/ folder on the same specs
git archive <commit> app | tar -x -C /tmp/before
node tools/calibration/match-calibration.mjs --workers 2 --engine /tmp/before/app --out /tmp/before.json
node tools/calibration/match-calibration.mjs --compare /tmp/before.json /tmp/after.json
```

Options: `--matches N`, `--duration 180|300` (subset), `--tuning patch.json` (deep-merged into
the tuning; try a change without editing `config.js` — only keys that exist in `DEFAULT_CONFIG`
survive `importConfig`'s normalisation), `--summary file.json`.

**The batch** (128 matches, deterministic): club XIs from the runtime catalog — close pairs
(OVR gap < 3), moderate (3–9), big gaps (≥ 10), low-rated pairs (both < 70) — an all-star XI
against weak and elite clubs, and the default squads. 180 s and 300 s alternate. Team 1 is
AI-coached (`medium` / `hard` / `impossible`); team 0 follows the same game-state mentality
(a sensible human). Every number is emergent: no quotas, no score fixing, no RNG tied to
outcomes.

## Phase 12: drop kicks, offside and deep free kicks — and nobody is placed any more

Owner's notes: "Drop kicks and offside free kicks have a lot of the same problems as goal
kicks did." and "It looks a little odd where players are after a goal kick. Don't reset them,
have them move to realistic places to be after the goal kick. Same for above."

**Measured first.** `blunders.mjs` now follows three more restarts for 4 s from the kick — the
keeper's kick or throw from his hands, the free kick after an offside and any other free kick
within 40 m of the taker's goal line — and prints, per 100 of each, how many were lost (an
opponent has the ball or it is his side's restart), how many of those in the own half, and
why. 192 club fixtures (`--matches 192`; the default 24 hold only 27 keeper distributions and
4 offsides), before → after:

| lost within 4 s, per 100 | n | lost | in the own half | to an opponent | out of play | receiver robbed |
| --- | --- | --- | --- | --- | --- | --- |
| keeper's hands | 304 → 255 | 21.1 → 15.7 | 20.1 → 7.8 | 5.6 → 7.1 | 9.5 → 0.4 | 5.6 → 7.8 |
| offside free kick | 42 → 26 | 21.4 → 15.4 | 14.3 → 7.7 | 14.3 → 11.5 | 0 → 0 | 7.1 → 3.8 |
| deep free kick | 112 → 119 | 17.0 → 15.1 | 13.4 → 3.4 | 5.4 → 6.7 | 0 → 0 | 11.6 → 6.7 |

What is still lost is mostly the long ball that the other side's centre-back heads away
beyond halfway — a 50–60% ball by design, as at goal kicks. Goal kicks given away (Phase 9's
finding): 0.12 → 0.07 a match.

**What was wrong** (watch.mjs, e.g. fixture 11 at 29.4 s, fixture 53 at 171.9 s, fixture 14
at 33.5 s on the engine before): the keeper caught the ball with twenty players around his
box and nobody moved — his side stayed where the attack had ended, the attackers kept marking
— so after 2.5 s without an outlet `clearKeeper` hoofed a 30–45 m ball at whoever stood
widest, half of them straight into touch (the 9.5% "out of play"). The offside free kick was
taken 0.75 s after the whistle by whoever stood nearest, into the same crowd (fixture 53: lost
at once and a goal against seven seconds later).

**What changed** (docs/engine-events.md, _Building up from the back_): goal kicks, free kicks
within 40 m of the own goal line and the keeper's hands share one shape (`buildUpSpot`: Phase
9's goal-kick shape, moved up the pitch with the ball) and one chooser (`buildUpOption`:
Phase 9's — short when it is really on, else long to the best header, now onside and led
towards his run). And nobody is placed any more, at goal kicks either: both sides get targets
and run to them; the taker waits until they are set or `gameplay.buildUpWait` (3.5 s) is up.
A goal kick now looks like this (fixture 1 at 56 s): the ball goes out, the attackers jog out
of the box and back towards halfway, the centre-backs split to the corners of the box, the
full-backs go wide and higher, the keeper puts the ball down and after 3.5 s rolls it to the
free full-back, who carries it out; play goes on from where everybody is.

**The price is time**: sides that have attacked with ten men need 30–50 m to their spots, so
the cap nearly always decides. Per restart: goal kick 1.7 → 3.5 s (2.5 a match), offside 0.7
→ 3.4 s, free kicks 0.9 → 1.6 s on average (the deep ones ~3.5 s); the ball is in play 85%
of the match instead of 89%. With `buildUpWait` 2.5 the keeper's losses in the own half are
back at 16 per 100 and goal kicks given away at 0.11 a match; 3.0 is in between.

**Goal level.** Four points less playing time and fewer balls given away near the own box
cost about 0.1–0.2 goals (`match-calibration.mjs --matches 256 --duration 180`, 128 matches
of 180 s, the same specs: 2.61 → 2.52; the 192 club fixtures 2.72 → 2.50, ± 0.12), so
`gameplay.shotScatter` 0.9 → 0.88 re-centres: 2.61 → 2.60 and 2.72 → 2.71 (0.86 gave 2.59
and 2.84). The per-mode table of Phase 11 was not re-run.

`blunders.mjs --compare`, 192 fixtures, everything else: unpressed giveaways 0.40 → 0.45,
plain passes out 0.32 → 0.28, loose 4 s+ 0.63 → 0.72 (0.54–0.61 in three other passes of the
same change: noise), open shots in the box 0.38 → 0.36, hopeless shots 0.75 → 0.54, soft
goals 0.59 → 0.55, rebounds left 0.39 → 0.41, offsides 0.23 → 0.14; long free kicks won by
the opponent now count as a `restart-giveaway` (0.09 → 0.05 all the same).

## Phase 11: rebounds — the defending side reacts to the second ball

Owner's note: "Sometimes defenders fall asleep on saves, meaning rebounds go to the attackers
too often. Fix this, but don't mess up the goal targets."

**Measured first** (180 s; a rebound = a keeper's save that is not a catch, a defender's block
of a shot, or the woodwork, with the ball still in play — 3.3 a match between strong nations).
300 World-Cup-like matches between two of the 40 strongest nations (`opponentCandidates` /
`buildOpponent`, the Exhibition's sides) and the first 96 club fixtures of
`tools/calibration/lib/fixtures.mjs`, before → after, the same matches:

| | nations before → after | club fixtures before → after |
| --- | --- | --- |
| first to the rebound: an attacker | 31% → 20% | 34% → 16% |
| … a defender (of which first-time clearances) | 32% → 48% (32%) | 30% → 52% (36%) |
| … the keeper | 7% → 8% | 8% → 8% |
| … nobody: out of play (corner, goal kick, throw-in) | 25% → 19% | 21% → 21% |
| … straight in (a deflected shot) / nobody for 4 s | 5% → 5% | 7% → 3% |
| attackers' share of the rebounds somebody won | 45% → 26% | 48% → 21% |
| parry "into danger": an attacker first | 47% → 29% | 51% → 34% |
| a second shot within 3 s | 27% → 20% | 30% → 14% |
| rebound goals a match (share of all goals) | 0.53 → 0.32 (17% → 10%) | 0.43 → 0.21 (15% → 7%) |
| a defender closer at the save, and still a second shot (`rebound-left`) | 0.66 → 0.49 a match | 0.60 → 0.29 |
| nearest outfielder at the save: attacker · defender (m) | 7.7 · 5.7 | 7.5 · 5.2 |
| first man running at the ball after: attacker · defender (s) | 0.06 · 0.06 → 0.02 · 0.02 | 0.07 · 0.07 → 0.02 · 0.02 |
| the keeper goes for it | 27% → 57% | 25% → 56% |
| goals a match | 3.02 → 3.12 | 2.76 → 2.80 |

So before the change a defender was the closer man at 83% of the saves (5.7 m against 7.7 m)
and the attackers still won nearly half of the rebounds anybody won; a sixth of all goals were
second shots.

**What the defenders did wrong** (traces of the bad ones, e.g. fixtures 47 at 161.0 s, 20 at
36.9 s, 16 at 159.3 s on the old engine):

1. **The defending side thought it was attacking.** A parry or a block is a touch, and without
   an owner the side that touched the ball last was planned as "in possession": one man chased
   the ball and everybody else ran out to his support position ("Protecting against the
   counter", "Offering a forward link", "Joining the attack") with the ball loose in their
   six-yard box — while the attackers were planned as defending and mostly marked. Nobody was
   assigned to the second ball, and the one chaser changed from plan to plan.
2. **They ran at where the ball was.** The chaser aimed at a straight intercept that knows
   neither the turn nor the roll: a centre-back sprinting back at his goal overran a ball
   parried out past him and needed a full second to brake (7 m/s² either way), an arm's length
   from a ball an attacker arriving at speed then took.
3. **A touch or nothing.** A defender who got there had to control the ball (0.85 m reach, a
   first touch that can fail) with the attacker on him, and was robbed; he never just put his
   foot through it.
4. **No delay in noticing** (0.06 s both sides — it was never a reaction-time handicap), but
   the keeper only re-planned at his own rhythm (up to 0.3 s after his dive) and by then judged
   the attacker closer; and a shot blocked back at the shooter was at his feet again in the
   same frame, for a second shot a quarter of a second after the first.

**What changed** (`sim/rebound.js`, contract in docs/engine-events.md _Rebounds_;
`gameplay.secondBalls` 0 = the old behaviour, for `--tuning` comparisons): for 3 s after the
save, while the ball is loose within 30 m of that goal — both sides re-plan in the same step;
the side that shot is the one attacking; the defending side's nearest two outfielders go for
the ball, at the first point of its path they can really reach (turn, bounce and roll
included), and a man turning for a rebound brakes 1.6 × harder (both sides); a defender who
reaches it in his own box with an attacker within 4.5 m clears it first time (a lunge of 1.55
m; lofted through the widest gap, 4–30% sliced square or behind — never between his own
posts); the keeper claims what he reaches before any attacker and pushes a parry into the box
harder and, likelier the better he is, away from the man following in; the shooter is in his
follow-through for 0.5 s. No outcome is decided: the attackers still reach a fifth of the
rebounds first, a third of the parries into danger, and score 0.2–0.3 goals a match from
them. No RNG outside the clearance and the parry (both part of the match's seeded stream), no
allocation in a step (`loosePoint` returns a scratch object). `npm run sim:fingerprint` (12
matches, one core): 5.3 s before, 5.2–5.6 s after.

**Goal targets.** The lost rebound goals are given back to first shots: `gameplay.shotScatter`
0.94 → 0.9; `saveAbility` stays 0.97. Per mode (the sides and sample sizes of Phase 9's table,
200–280 matches a row, ± 0.10; "before" = Phase 10's table, and in brackets the same engine
re-measured on today's data where it was):

| mode | goals before → after | an attacker first to the rebound | a second shot within 3 s | rebound goals a match |
| --- | --- | --- | --- | --- |
| World Cup run, Pro | 3.04 (3.05) → 2.89 | 28% → 21% | 23% → 19% | 0.39 → 0.32 |
| World Cup run, World Class | 2.92 → 3.10 | 21% | 21% | 0.41 |
| World Cup run, Legendary | 3.11 (2.94) → 2.93 | 31% → 20% | 25% → 20% | 0.39 → 0.35 |
| Daily | 3.15 → 3.06 | 20% | 20% | 0.36 |
| Quick Match, nations | 2.94 (2.94) → 2.85 | 29% → 18% | 24% → 18% | 0.43 → 0.29 |
| Quick Match, leagues | 3.08 (3.08) → 2.94 | 28% → 21% | 23% → 21% | 0.41 → 0.38 |
| Quick Match, clubs | 3.00 → 3.02 | 19% | 16% | 0.28 |
| Exhibition, clubs | 3.04 → 2.93 | 19% | 19% | 0.27 |
| Exhibition, nations | 3.08 → 3.13 | 18% | 18% | 0.31 |
| club fixtures (71 v 71, not a mode) | 2.95 → 2.74 | 16% | 16% | 0.23 |

Every mode is in 2.85–3.13 (mean 2.98; 3.04 in Phase 10). With `shotScatter` 0.91 the same
table read 2.97 / 2.94 / 2.76 / 2.93 / 2.81 / 3.21 / 3.06 / 2.99 / 3.08 / 2.75 — the rows move
by ± 0.15 between two passes, so 0.9 and 0.91 cannot be told apart and the level was left at
0.9. In the modes a star XI converts what it still gets: rebound goals fall by about a fifth
there (0.40 → 0.33 a match), by half between two even club sides. User wins in run matches:
Pro 72%, World Class 69%, Legendary 60% (71 / 64 / 57% in Phase 10; ± 3). The 71-rated club
fixtures, which no mode produces, lose 0.2 goals: their rebounds were worth more to them and a
tighter shot gives a 65-rated finisher less back.

Tight angles (192 club fixtures, before → after): shots seeing under 12° of goal inside 20 m
scored 0 of 15 → 2 of 17 (one of the two 2.5 s after a parry), 60°+ off the centre line from
5–16.5 m 5 of 23 → 9 of 36 (22% → 25%; 8 of the 36 within 3.5 s of a save, 5 of the 23
before); from in front (within 30°, 5–16.5 m) 54% → 50%, from 22–30 m 15% → 13%. Still rare
(0.06 goals a match from all tight angles together), but both rows are at the upper end of
what Phases 7–10 measured — small numbers, to be watched.

`blunders.mjs --compare` (24 fixtures; goals 3.21 → 3.25): rebound left to an attacker 0.33 →
0.13 a match, rebound goals 0.42 → 0.17, soft goals 1.13 → 0.92, unpressed giveaways 0.54 →
0.50, long loose balls 0.58 → 0.58, open shots in the box 0.17 → 0.29 and unmarked receivers
0.17 → 0.33 (4 → 7 and 4 → 8 events). Over 96 fixtures (goals 2.76 → 2.80): rebound left 0.60 →
0.29, rebound goals 0.43 → 0.21, rebounds 2.68 → 2.67, open shots in the box 0.42 → 0.40, soft
goals 0.68 → 0.66, hopeless shots 0.68 → 0.74, giveaways 0.42 → 0.43, long loose balls 0.48 →
0.71, own goals 1 → 3. The detector is new: `rebound-left` (a save, a blocked shot or the woodwork, then an
attacker's shot within 3 s although a defender was the closer man at the save), with
`rebound-goal` and `rebound` for scale (`tools/calibration/lib/rebounds.mjs`,
`tests/rebounds.test.mjs`; `--list rebound-left` gives `watch.mjs` arguments, `at` = the save).

**Fast rating model**: not refitted. The run matches of the table average 2.97 goals
(736 matches; 3.02 in Phase 10, 3.00 for today's Pro and Legendary rows before the change) against `MATCH_MODEL.goals` 1.46 a side; `CUP_TUNING`
untouched.

**Not done / unsure.** Blocked shots are the largest remaining group (1.2 a match, 0.1 goals):
the deflection drops among the attackers in the box, and the blocker himself needs 0.3 s
before he can play it. Lofted clearances land 20–30 m out and are fought for there: balls
loose for 4 s+ rise from 0.48 to 0.71 a match in the 96 fixtures. The brake factor and the
lunge are for rebounds only — everywhere else a player still turns as slowly as he
accelerates.

## Phase 10: the level per side — overall, and defence against attack

Owner's note on Phase 9's level: "look at defense vs offense levels AS WELL as overall … use
both, total overall and D / keeper overall. Some parts can be adjusted, some parts can be baked
into the sim engine." So there are two layers, and `match.level` is now one number per
attacking side (`kickoffLevel`, read once at kick-off as before):

1. **In play (the engine).** Better defenders and keepers win duels, block and save — this
   was already most of it, and is unchanged.
2. **At kick-off (adjustable).** The match term of Phase 9 for both sides alike — mean overall
   of the 22 above 78, plus `gameplay.levelGap` per point between the sides — **plus**
   `gameplay.levelUnits` (0.4) per point of `unitLean` (`players/unit-levels.js`): the
   opponent's defence level above the opponent's overall, less the side's own attack level
   above its own overall. Defence = keeper ×2, centre-backs 1, full-backs 0.8, holding
   midfielder 0.7, a little of the midfield; attack = strikers 1, wingers 0.9, attacking
   midfielder 0.85, wide midfielders 0.6, central 0.4. A typical real XI is at 0
   (`UNIT_BALANCE`), so the averages stay where Phase 9 put them. `levelUnits: 0` = overall only.

**The grid** (`grid.mjs` in the session's scratch folder; 80 matches a pair, 180 s, sides
alternating ends, no favourite's edge): six strong clubs (S) and six modest ones (M) in 4-3-3
with their lines swapped. SS 87.8 overall (attack 87.9, defence 87.8 by line); SW = S's attack
with M's defence, 78.1 (87.9 / 69.9); BB a real club halfway, 79.8 (79.2 / 80.2); WS = M's
attack with S's defence, 82.8 (76.8 / 87.8); MM 73.0 (76.8 / 69.9). Goals for the first · the
second side:

| pair | unit term off (engine + overall) | unit term on | level each side attacks at (on) |
| --- | --- | --- | --- |
| SS v MM | 2.21 · 0.35 | 2.31 · 0.41 | 13.6 · 12.4 |
| SS v SW (same weak defence, star attack) | 2.04 · 1.06 | 2.29 · 1.20 | 10.6 · 9.1 |
| SS v BB | 1.66 · 0.89 | 1.63 · 0.91 | 13.1 · 12.5 |
| SS v WS (modest side, star defence and keeper) | 1.46 · 0.65 | 1.46 · 0.53 | 12.9 · 13.2 |
| SS v SS | 1.59 · 1.45 | 1.36 · 1.57 | 10.4 · 9.6 |
| SW v WS | 1.29 · 1.20 | 1.63 · 1.25 | 4.0 · 5.9 |
| SW v BB | 1.73 · 1.41 | 1.68 · 1.63 | −0.6 · 0.3 |
| WS v BB | 1.06 · 1.07 | 0.99 · 0.96 | 8.3 · 7.5 |
| SW v SW | 1.88 · 2.04 (3.91) | 2.44 · 2.36 (4.80) | −3.5 · −3.3 |
| BB v BB | 1.46 · 1.23 (2.69) | 1.20 · 1.20 (2.40) | 2.7 · 2.7 |
| WS v WS | 1.00 · 0.90 (1.90) | 0.90 · 0.85 (1.75) | 9.8 · 9.6 |
| MM v MM | 1.46 · 1.38 (2.84) | 1.43 · 1.41 (2.84) | −6.7 · −5.9 |

Read down the first five rows: the same star attack scores 2.2–2.3 against a 70 defence —
whether the side in front of it is modest (MM) or has a star attack of its own (SW) — 1.65
against an 80 one and 1.46 against an 88 one, although WS's overall (82.8) is five points
below SS's. A modest side with a fine defence and keeper concedes less than its overall says
(WS: 1.46 from the star attack, where the overall-alike BB concedes 1.65), and a side with a
star attack and a poor back line concedes more (SW: 2.0–2.3). Regressing a side's goals on
`unitLean` (line means, the overall gap taken out at the model's slope): **2.45% a point with
the unit term off — the engine's own doing — and 3.6% with it on**; about two thirds of the
matchup effect is play, a third the kick-off term. The engine layer was left as it is: it
already carries most of it and nothing in the grid runs the wrong way (the open pairs score
most, the closed ones least, in both columns). ±0.15 goals of noise per cell.

**Modes, with the unit term** (as Phase 9's table; `shotScatter` 0.92 → 0.94 re-centres):
World Cup run Pro 3.04, World Class 2.92, Legendary 3.11, Daily 3.15, Quick Match nations 2.94,
leagues 3.08, clubs 3.00, Exhibition clubs 3.04, nations 3.08, club fixtures 2.95 — every row in
2.9–3.15; the regression gives −0.1% per point of level and ±5.6% per point of gap. User wins
in run matches: Pro 71%, World Class 64%, Legendary 57%. Tight angles (192 fixtures): shots
seeing under 12° of goal 0 of 15 scored, 60°+ off the centre line 5 of 23. `blunders.mjs
--compare` against Phase 9 (24 fixtures; goals 3.00 → 3.21): goal kicks given away 0.21 →
0.08, unpressed giveaways 0.25 → 0.54 (0.42 before Phase 9: noise of 24 matches), open shots
in the box 0.29 → 0.17, hopeless shots 0.83 → 0.63, soft goals 0.96 → 1.13.

**Fast rating model.** `MATCH_MODEL.goals` 1.33 → 1.46: the `gaps` sample refits to 1.50 a
side (480 matches, slope 0.0525 again; the user's constant is down to 0.04, 0.8 rating
points — the era data merged since moved the drafted XIs), the 980 run matches of the mode
table say 1.44. Title odds, `runs --runs 400`, `CUP_TUNING` unchanged: Pro 18.5% → 19.0%, World
Class 9.3% → 8.5%, Legendary 5.0% → 6.3%. The model can now read the units too:
`expectedGoals` / `outcomeProbabilities` / `simulateResult` take `units = [a, b]`
(`unitLevels(players)` of each side) and a side then scores 3.6% less per point of `unitLean`
(`MATCH_MODEL.units`, the grid's slope). Since then the sides of a run carry their units
(`side.units` from `buildSide`, on every opponent candidate) and the cup's modelled results
take them — `unitsOf(a, b)` in `cup.js` and `awards.js`; numbers in docs/competition-api.md
"Fast rating model". Results without `units` are exactly as before.

## Phase 9: about three goals a match in every mode

Owner's note: "try to get average goals in every mode to roughly 3". Measured in the game's
180 s match with the sides each mode really produces (a typically drafted XI — Legend spin and
Prime boosts in World Cup drafts — against the run's or the ladder's opponents, the AI coach at
the difficulty's level; Exhibition: two of the 60 strongest clubs / 40 strongest nations;
club fixtures: `tools/calibration/lib/fixtures.mjs`, any club, mean overall 71). Goals in
regular time; ± 0.10 of noise per row (200–290 matches each).

| mode (mean ratings) | goals before → after | shots | goals per shot | draws |
| --- | --- | --- | --- | --- |
| World Cup run, Pro (85 v 77) | 3.63 → 3.00 | 11.6 → 11.5 | 31% → 26% | 12% → 24% |
| World Cup run, World Class (85 v 79) | 3.42 → 3.00 | 11.6 → 11.7 | 29% → 26% | 17% → 19% |
| World Cup run, Legendary (85 v 82) | 3.32 → 3.01 | 11.5 → 12.0 | 29% → 25% | 20% → 26% |
| Daily (85 v 77) | 3.70 → 3.26 | 11.6 → 11.5 | 32% → 28% | 15% → 15% |
| Quick Match, nations (84 v 88) | 3.57 → 2.92 | 12.3 → 12.5 | 29% → 23% | 26% → 25% |
| Quick Match, leagues (84 v 88) | 3.58 → 3.14 | 12.1 → 12.2 | 30% → 26% | 19% → 23% |
| Quick Match, clubs (79 v 83) | 3.14 → 3.10 | 11.4 → 11.2 | 28% → 28% | 19% → 27% |
| Exhibition, clubs (83 v 83) | 2.85 → 2.85 | 10.6 → 11.1 | 27% → 26% | 22% → 24% |
| Exhibition, nations (83 v 83) | 3.19 → 3.06 | 10.9 → 11.0 | 29% → 28% | 21% → 25% |
| club fixtures (71 v 71) | 2.03 → 2.78 | 8.6 → 9.0 | 24% → 31% | 35% → 27% |
| fast rating model, gap 0 · gap 6 | 3.42 · 3.59 → 2.66 · 2.79 | | | 22% → 26% (gap 0) |

Extra time stays proportional without a setting of its own: 0.83 goals in the 140 extra times
of the cup rows (a third of the match at 0.88 of its rate would be 0.88). The user's win rate
in his run matches: Pro 77% → 68%, World Class 68% → 68%, Legendary 61% → 61% (`CUP_TUNING`
untouched; the lead retunes difficulty).

**Why star XIs scored so much more.** A Poisson regression of a side's goals on the mean
rating of the two sides and the gap between them, over those 2,310 matches: **+3.3% per point
of level** (ten points: ×1.39) and ±6.4% per point of gap. The level is two things: shots
(+2.2% a point: better passing gets more attacks to a shot) and the share on target (+2.5% a
point: 46% at 71, 65–70% at 85 — a shot's scatter is `0.7 + (1 − skill) × 7.5`, twice as wide
for a 60 finisher as for an 85 one), against which better keepers only give back 1.3% a
point. Nothing else answers finishing: defenders are measured against attackers in every duel,
shooters against nobody. And a mismatch scored most of all (the favourite's rate rises faster
than the underdog's falls, the favourite's edge on top). The game-state mentality (after 70')
and the favourite's edge move the totals by a few percent only.

**What changed.** The match has a level, read once at kick-off like the edge (`match.level`,
`kickoffLevel`): the mean overall of the 22 in points above 78, plus `gameplay.levelGap` (0.8)
points for every point between the two sides, between −14 and +14. Per point of level a shot
scatters 6% more (`levelScatter` 1.5 × 0.04) and a save is 0.4% likelier (`levelSaves` 1 ×
0.004) — for both sides alike, so who is better, and by how much, counts as before: the
regression after the change gives +0.3% per point of level and the same ±6% per point of gap.
A side two goals up manages the game (`gameStateMentality`: Hold at any minute), and the level
is set with `gameplay.shotScatter` 1.08 → 0.92 and `saveAbility` 1.02 → 0.97. Shots on target
are now 53–60% in every mode (they were 46–70%), saves 50–62% of them. `levelScatter` /
`levelSaves` / `levelGap` 0 switch each part off (`--tuning`).

Tight angles did not come back (192 club fixtures, before → after): shots seeing under 12° of
goal inside 20 m scored 0 of 12 → 0 of 20; 60°+ off the centre line from 5–16.5 m 5 of 29 → 4
of 28. What the low-rated club fixtures gained is conversion, not volume: central shots from
5–16.5 m 43% → 55%, shots from 22–30 m 8% → 13%, goals with xG under 0.19 0.38 → 0.66 a match
(20% → 23% of the goals) — matches between 71-rated sides are outside what the modes produce,
and the price of the same three goals from nine shots. Not done: more shots for modest sides
instead (it needs better build-up from them, which is what their ratings say they lack).

**Fast rating model** (`competition/model.js`): refitted with the tool it names
(`cup-calibration.mjs gaps` 480 + 144 matches, `fit`): goals 1.71 → 1.33 a side, slope kept at
0.0525 (fit with a constant for the user's side: 1.32 / 0.0550 / 0.14 — the user's XI is worth
about 2.5 rating points more than its rating, not in the model). Title odds of the fast model,
`runs --runs 400`, `CUP_TUNING` unchanged (±2 points of noise): Pro 18.3% → 18.5%, World Class
11.3% → 9.3%, Legendary 4.3% → 5.0%; out in the group 5.0 / 8.8 / 18.5% → 5.0 / 11.0 / 20.0%.

## Phase 9: goal kicks

Owner's note: "opponents seem to mess up goal kicks too much". Followed every goal kick of 240
club fixtures (`tools/calibration/lib/fixtures.mjs`) and of 200 matches between the 40 strongest
nation XIs, 180 s. A goal kick is **given away** when it goes straight out of play, its first
touch is an opponent's within 45 m of the kicking side's goal line, or the man it went to is
robbed within 40 m of his goal and 3.5 s of the kick (`blunders.mjs`, `goal-kick-given-away`).

| | clubs before | after | nations before | after |
| --- | --- | --- | --- | --- |
| goal kicks a match | 3.5 | 3.5 | 2.4 | 2.6 |
| straight out of play | 5.4% | 0.2% | 8.2% | 0.2% |
| straight to an opponent within 45 m | 1.1% | 0.7% | 2.0% | 0.8% |
| the receiver robbed within 40 m, 3.5 s | 5.1% | 3.2% | 5.7% | 2.5% |
| **given away** (per match) | 11.6% (0.40) | 4.2% (0.15) | 16.0% (0.39) | 3.5% (0.09) |
| given away and a shot against within 10 s | 5.6% | 2.7% | 8.8% | 2.0% |
| long kicks (42 m+) · won by the opponent beyond 45 m | 1% · 0.6% | 11% · 5.5% | 5% · 0% | 31% · 15% |

What was wrong (both sides alike, team 0 and the AI-coached team 1 within a point of each
other): nobody was ever set. The kick was taken 1.7 s after the ball went out, with twenty
players still around the box the attack had ended in, so the keeper passed short into a crowd
— or, after waiting 2.5 s for an outlet, hoofed a 35 m ball at a full-back on the touchline (a
third of those went straight out). And the centre-back he found played his first touch forward
into the midfield's press. What changed (docs/engine-events.md, _Goal kicks_): the goal kick
is a cut, like the corner — both sides are placed when it is awarded, the defending side in a
mid-block or, with `press` 4+ or on Push, up at the box; the kicking side builds up short only
when the ball is really on (nobody within 13 m of the receiver) and otherwise goes long to its
best header beyond halfway with the midfield around him; the man the keeper gives it to takes
his time for two seconds. A long kick is a 50–60% ball, and losing it costs a header on
halfway, which is the point. With the scoring changes above in, over the run's own matches
(World Cup run, Pro, 275–290 matches): given away 22.2% → 5.0% of goal kicks (straight out 13.1% →
0.3%), a shot against within 10 s of one 12.0% → 3.6%. `blunders.mjs --compare`, 24 fixtures,
the whole phase: goal kicks given away 0.46 → 0.21 a match (0.44 → 0.18 over 96), unpressed
giveaways 0.42 → 0.25, open shots in the box against a set defence 0.50 → 0.29, soft goals
0.71 → 0.96 (see above); long goal kicks won by the opponent no longer count as a
`restart-giveaway` (goal kicks have their own finding).

## Phase 8: the whistle waits for the attack

Owner's note: "sometimes the game ends on an attack, so let attacks finish, and corners".
`sim/whistle.js` holds the whistle while an attack is on when time runs out (rules and caps in
docs/engine-events.md, _The final whistle_; `periods.holdRange` 30 m, `holdAttack` 4 s,
`holdCorners` 1, `holdMaximum` 10 s). Held time is the most dangerous time there is — every
second of it is an attack near goal — so it scores three times as fast as ordinary play, and
the announced added time was trimmed to pay for it: `periods.firstHalfMean` 2 → 1.5 and
`secondHalfMean` 3 → 2 (1.6 and 2.1 minutes once rounded, with the minimum of one; 2.0 and 3.0
before). Club fixtures of `tools/calibration/lib/fixtures.mjs`, 180 s, before → after:

| | before | after |
| --- | --- | --- |
| first 24 fixtures: goals a match | 2.33 | 2.33 |
| first 24: periods with the whistle held · mean held · held time a match | — | 17 of 48 · 3.1 s · 2.2 s |
| 960 fixtures: goals a match | 2.10 | 2.07 |
| 960: periods with the whistle held · mean held · longest | (6%: a shot in flight) | 28% · 3.1 s · 13.5 s |
| 960: goals from shots struck after time was up, a match | 0.010 | 0.080 |
| 960: real seconds a match | 189.5 | 189.2 |

How the trim was sized: held time alone (old added time) adds 0.052–0.07 goals a match
(+2.5–3.4%, counted directly: shots struck after the deadline; the totals of two runs differ by
±2% of noise at 960 matches). A minute of added time is worth 0.025 goals (960 fixtures of the
old engine: 0.027 a first-half minute, 0.025 a second-half one, against 0.022 a regular minute),
and the trim takes 1.4 minutes: −0.034, about −1.6%. Net: within a percent of where it was, and
the measured totals say 2.10 → 2.07. A wider range (35 m, 5 s) held the whistle in 32% of
periods and added 3.4% before any trim; a tighter one (20–25 m, 3 s) still added 2%, because
the goals come from the attacks that are closest when time runs out — so the range was set for
what reads right (an attack within shooting or crossing distance), not to save goals.
`blunders.mjs --compare` on the 24 fixtures: no finding moved by more than its noise (giveaways
0.46 → 0.42, pass-out 0.46 → 0.38, loose-long 0.63 → 0.54, swarm 0.75 → 0.85 s).

With the old added-time means, the 18 of 48 fixtures in which no whistle was held are identical
to the old engine's, step for step (score, clock, events, stats, every player's position).

## Phase 7: tight angles, a few goals fewer

Owner's notes: "angles seem to score more than expected" and "a little too many goals".
Measured on the first 288 club fixtures of `tools/calibration/lib/fixtures.mjs` (180 s, the
FC 26 catalog, team 1 AI-coached), before → after:

| | before | after |
| --- | --- | --- |
| goals / match | 2.42 | 2.25 (−7%) |
| non-penalty shots / match · scored | 8.6 · 25.8% | 8.5 · 24.3% |
| shots seeing under 12° of goal, inside 20 m: per match · scored | 0.17 · 30% (15 of 50) | 0.11 · 3% (1 of 31) |
| shots 60°+ off the centre line, 5–16.5 m: per match · scored | 0.17 · 38% (18 of 48) | 0.16 · 17% (8 of 46) |
| shots within 30° of the centre line, 5–16.5 m: scored | 46.6% | 46.2% |
| shots from 22–30 m: scored | 8.6% | 8.2% |

(Shots are bucketed by where they were struck; the 60°+ row includes point-blank finishes just
outside a post, where the goal is still wide open.)

What was wrong: the aim of a shot is a point on the goal line and its scatter was the same
length of goal line from any angle, so a ball struck from the byline, along the line, landed
between the posts as surely as one from the penalty spot — and the keeper stood 2.5 m off his
line with the ball on the byline, so it rolled in behind him. What changed (docs/engine-events.md,
_Tight angles_): scatter × 1 / sin(angle to the goal line) (at most 4); the keeper at his near
post, close to his line, when the ball is (or is being passed) wide within 5.5 m of the line; a
tight-angle shot within his reach is kept out more surely; a carrier's urge to shoot fades from
50° off the centre line (he cuts back or crosses); `xg` fades the same way. That is 6 of the 7
points; the rest is `gameplay.saveAbility` 1 → 1.02. Long shots, take-ons and the save model
for shots from in front are untouched.

`blunders.mjs --compare` (24 fixtures) shows nothing new: hopeless shots 0.79 → 0.75 a match,
soft goals 0.38 → 0.38, free in the box 0.05 → 0.11 s; giveaways 0.42 → 0.67 and long loose
balls 0.63 → 0.88 are within what 24 different matches vary by (neither is touched by the
change). The fast rating model's `goals` (competition/model.js) was scaled by the same 7%
(1.84 → 1.71), not refitted; `CUP_TUNING` is as it was.

## Phase 6: saves that do what they say, penalties, ten men, xG of this engine

Measured on 1,600 deterministic club fixtures (`tools/calibration/lib/fixtures.mjs`, 180 s, even
sides, team 1 AI-coached), before → after:

| | before | after |
| --- | --- | --- |
| goals / match | 2.393 | 2.384 |
| shots / match | 8.70 | 8.72 |
| xG / match (xG ÷ goals) | 0.768 (0.32) | 2.319 (0.97) |
| "tip over" saves · of them in the net straight after | 237 · 134 | 106 · 0 (104 corners) |
| penalties: scored · saved · off target or woodwork | 82% · 3% · 16% | 76% · 18% · 5% |

**Tip over.** The lift ignored how far the keeper stood from his line (2.2–3.7 m/s up, 3–5 m/s
back): from more than about a metre out the ball dropped under the bar — 57% of "tipped over"
saves were goals. The lift is now worked out from the time the ball needs to reach the line, so
it always clears the bar. Those 0.08 goals a match came back by making a shot under the bar
harder to save in the first place (save probability × (1 − 0.7 × `high`), shots only).

**Penalties.** The keeper used to walk towards a side at running speed after the ball was
struck (and the format's save adjustment left him 3%): he now commits at the strike and a
scripted dive covers ~2 m during the flight; he can only save what he guessed (45% right way;
then about 40%). Aim is 1.95 m either side of centre (2.35 before), so fewer miss the target.

**Ten men.** `coverDismissal` (docs/engine-events.md): no RNG, both sides.

**xG.** The old model was fitted to public open-play conversion, but this engine's shots go in
about three times as often (8.7 shots, 2.4 goals), so the match report's xG was a third of the
score. `shotXg` (insights.js) is a logistic regression on the engine's own shots — 10,557
non-penalty shots of fixtures 0–1199 for the fit, fixtures 1200–1599 held out (884 goals against
858 xG) — over the features the old model already used:
`sigmoid(1.28 − 0.141·min(distance, 28) + 0.6·angle − 0.44·header − 0.216·min(blockers, 3) −
0.15·pressure + 1.35·exposed)`, clamped to 0.02–0.92; a penalty is 0.76 (347 penalties: 76%).

| distance | shots | conversion | xG before | xG after |
| --- | --- | --- | --- | --- |
| 0–6 m | 242 | 0.665 | 0.348 | 0.714 |
| 6–11 m | 1,972 | 0.544 | 0.158 | 0.523 |
| 11–16.5 m | 3,450 | 0.351 | 0.085 | 0.336 |
| 16.5–22 m | 3,234 | 0.189 | 0.044 | 0.200 |
| 22–28 m | 3,601 | 0.100 | 0.030 | 0.101 |
| 28 m+ | 1,111 | 0.099 | 0.022 | 0.066 |

The remaining 3% are own goals, crosses that go in and long-range specialists. xG is shot
quality, so mismatches still show finishing: in the 64-match `match-calibration.mjs --duration
180` batch (all-star XIs, big rating gaps) it reads 2.35 xG against 2.81 goals. Display only:
results are unchanged by it. Everything that reads xG moved to the new scale — `bigChance`
(≥ 0.6, or a one-on-one ≥ 0.5: the best twentieth of shots, as before), highlight ranking,
the momentum weight (0.7 × xG), the slow-down before a big shot (≥ 0.5) and the two xG rows of
`blunders.mjs` (28 m+ under 0.08; a goal under 0.19), which are therefore not comparable with
an `--engine` from before this phase.

## Ratings against EA's overall (the top stretched)

The weighted attributes compressed the very top: a player EA rates 89 came out at 87, so the
game showed 18 players at 88+ where EA has 27. `calibratedRoleAbility` now adds
`ratings.topLift` (0.1) for every point above `ratings.topFrom` (78), and the role offsets
moved (CB 0.25 → 0.5, LB/RB 1.5 → 2, DM 1 → 1.25, CM 0.25 → 0.5). Keepers are not stretched:
a keeper's overall is his goalkeeping attribute, which is EA's overall already. Rounded rating
at the primary position against `sourceOverall`, all 15,378 catalog players:

| players EA rates | n | mean ours − EA, before → now | mean absolute difference |
| --- | --- | --- | --- |
| 85+ | 95 | −0.91 → −0.08 | 0.93 → 0.34 |
| 85+, outfield only | 81 | −1.06 → −0.10 | |
| 80+ | 488 | −0.39 → +0.15 | 0.56 → 0.43 |
| 75+ | 1,780 | −0.18 → +0.10 | 0.47 → 0.41 |
| everyone | 15,378 | −0.02 → +0.16 | 0.49 → 0.46 |

Players shown at 88+ (the draft's Superstars): 18 → 28 (EA 27); 85+: 75 → 99 (EA 95); 84–87
(Stars) 123, 80–83 (Starters) 374. Club ratings rose with their best players: 17 clubs are tier
S (82+) where 12 were. The catalog was rebuilt (badges, club ratings and club XIs are stamped
with `CONFIG.ratings`).

## Phase 5: mentality, rating gaps, out-of-position ratings

**Mentality means one thing.** Push raises the chance of a goal at both ends, Hold lowers it at
both ends, Balanced is the zero point, and between even sides all three are worth the same
points. Before, Push only made a side worse (1.11–1.23 goals against 1.22–1.16 by default over
700 even club fixtures) and Hold was simply better (1.26–1.06).

What was tried first: every positional lean on its own, at four to five times its old size
(line ±5 m, support positions ±8 m, rest defence ±10 m, runs in behind ±60%, full-back and late
runs, press distance, shot urge ±50–60%, restart time ×2), 400 fixtures each. None moved a
side's goals by more than about 0.08: shot volume is bound by real-time physics at about nine
a match whatever a side wants (as Phase 4 found), and a side's goals follow chance quality, not
how many bodies it sends. Two things did move: risky passing (the old Push lean) just hands
the ball over (own goals −0.2, conceded +0.05), and safe passing takes 0.1–0.2 goals off the
opponent. Deliberate marking lapses for the pushing side would have worked too (+18% goals and
+11% shots when both sides lapse) but "attackers left free in the box" is exactly what Phase 4
removed, so they stay off.

What it is now (`tuning.mentality`, all differences from Balanced; `--tuning` patches work):
the leans a viewer sees stay (line, runners, overlaps, shot urge, restart speed, energy), Push
no longer passes riskier, Hold passes safer (`turnoverCost` +25%), and the effect itself is
carried by **room to shoot**: a shot's scatter is divided by `1 + chances(shooting side) +
exposure(defending side)` — Push 0.55 / 0.3, Hold −0.33 / −0.24 (`Match.shootingRoom`). A side
that commits bodies forward finds, and leaves, more room; a side that sits in gives and gets
less. Two small rewards for a well-timed choice, read from the score when the shot is taken: a
side behind and pushing gets `chase` 0.1 more room for its own shots, a side ahead and holding
takes `protect` 0.1 off the opponent's. They apply to the mentality in effect, so Auto earns
them when the game state makes it push or hold (otherwise Auto would be a trap); an explicit
choice works all match, Auto only late.

| 1,400 even club fixtures, team 0 on the setting all match | goals for – against | total | shots for – against | W / D / L | points (opp.) |
| --- | --- | --- | --- | --- | --- |
| before: push | 1.11 – 1.23 | 2.33 | 4.27 – 4.43 | 32 / 30 / 38 | 1.25 (1.45) |
| before: balanced | 1.20 – 1.14 | 2.34 | 4.44 – 4.31 | 37 / 31 / 33 | 1.41 (1.29) |
| before: hold | 1.26 – 1.06 | 2.32 | 4.33 – 4.01 | 40 / 30 / 31 | 1.49 (1.21) |
| push | 1.51 – 1.41 | 2.91 (+20%) | 4.47 – 4.39 | 39 / 26 / 36 | 1.42 (1.32) |
| balanced | 1.24 – 1.19 | 2.43 | 4.40 – 4.34 | 36 / 28 / 36 | 1.36 (1.36) |
| hold | 0.94 – 0.89 | 1.83 (−25%) | 4.37 – 3.93 | 34 / 32 / 34 | 1.33 (1.35) |

(Before: 700 fixtures. Team 1 is AI-coached and follows the game state late on.) Goals move at
both ends; shots barely do — more of them are on target. From the 60th minute, 2,000 fixtures,
the matches in which team 0 is one goal down / up at that point:

| from 60' | n | result | goals for – against after 60' |
| --- | --- | --- | --- |
| one down, stays balanced | 439 | draw or win 25.5% (win 3.9%) | 0.44 – 0.41 |
| one down, pushes | 439 | draw or win 29.0% (win 6.2%) | 0.57 – 0.48 |
| one up, stays balanced | 470 | keeps the win 74.3%, loses 4.0% | 0.50 – 0.47 |
| one up, holds | 470 | keeps the win 76.4%, loses 1.9% | 0.47 – 0.38 |

The fast model's logic says the same: with independent Poisson goals, scaling both sides'
rates by 1.24 takes a side one down with a third of the match left from 23.7% to 26.5% (27.6%
with the chase reward), and scaling them by 0.79 takes a side one up from 76.3% to 79.4% (80.3% with the protect
reward).
For a whole match the same arithmetic says the opposite of the folk rule: more goals favour the
better side (a side 4 rating points better goes from 1.76 to 1.83 points a match by pushing,
one 4 points worse from 0.98 to 0.94), so an underdog should hold and a favourite push — the
game state, not the rating, is the reason to push. Default play (both sides on Auto, before
the rating change below): goals 2.17 → 2.37 over 700 club fixtures, draws 32% → 28% (more
late equalisers and killers).

**Rating gaps count a little more.** `gameplay.qualityImpact` 1 → 1.25: every skill is
`70 + (attribute − 70) × 1.25` (+ badges and chem, capped at 99), so differences between
players and sides are a quarter larger. Tried and dropped: `keeperRange` 1.4 (no effect on the
stronger side), the four "stat influence" knobs × 1.4 (+0.5 points), `qualityImpact` 1.15 /
1.2 (+2 points at most). Stronger side's wins, same matches before → after:

| | n | stronger side W / D / L before | after |
| --- | --- | --- | --- |
| club v club, gap 4–8, both on Auto | 1,217 | 51.8 / 29.5 / 18.7 | 57.4 / 25.7 / 16.9 |
| drafted XI v ladder, gap 1.5–4 | 632 | 49.4 / 22.6 / 28.0 | 53.8 / 22.0 / 24.2 |
| drafted XI v ladder, gap 4–8 | 1,362 | 62.8 / 20.1 / 17.2 | 64.8 / 19.7 / 15.6 |
| drafted XI v ladder, gap 8–13 | 276 | 77.5 / 13.8 / 8.7 | 82.6 / 11.2 / 6.2 |

Side effects: goals by level of the two clubs (700 fixtures, Auto) under 68 OVR 1.85 → 2.01,
68–75 2.41 → 2.42, 75 and over 2.81 → 3.25 (the best attackers score more: 85+ attackers 0.44
→ 0.98 goals a match in the calibration batch); attributes of 94 and over reach the 99 cap; the
user's drafted XI gains about 0.4 rating points on ladder sides of the same rating (stars count
for more). The fast model was refitted to 2,592 matches: goals 1.84, slope 0.0525
(`competition-api.md`; the engine before this pass refits to 1.74 / 0.0500 — the 1.6 / 0.0575
in use dated from an older engine). Shootouts were not re-measured.

**Frustrating plays** (`blunders.mjs`, 120 fixtures, per match, before → after all three
changes): unpressed pass cut out 0.37 → 0.36, pass out of play 0.35 → 0.34, restart giveaway
0.23 → 0.07, open danger-zone shot against a set defence 0.38 → 0.25, unmarked receiver 0.41
→ 0.28, hopeless long shot 0.78 → 0.70, soft goal 0.47 → 0.49, keeper off his line 0.29 →
0.36 s, ping-pong 0.42 → 0.42; goals 2.29 → 2.40, shots 8.5 → 8.4. The paired 64-match 180 s
calibration batch (which includes big gaps and all-star sides): goals 2.45 → 3.00, draws 37.5%
→ 21.9%, 0–0 9.4% → 4.7%, pass completion 83.2% → 84.8%.

**Out of position.** A player's rating in a role is his role rating (attribute weights fitted
to FC 26) times a familiarity factor. EA publishes each player's rating at every position
(`ls st rs lw … gk` in the source CSV); against those, for the 13,653 outfield players of the
catalog, our attribute weights alone already agree (mean difference under a point for every
neighbouring pair), so the old familiarity factor was a second penalty on top: 5–13 points too
harsh everywhere (mean absolute difference from EA over the 110 outfield pairs: 8.0). Now
familiarity follows steps between positions, `base + bonus · exp(−(decay · steps)²)` with
`familiarityDecay` 0.235: 0.985 one step away (about a point), 0.945 at two, 0.89 at three,
0.84 at four; twin wide roles (LW/LM, RW/RM) a quarter step, ST → AM three quarters, a listed
secondary position 0.4 (`secondaryDistance`); an outfielder in goal stays at 0.6. Mean
difference from EA is now 1.5 points, all of it on far moves, which stay costly on purpose.

| primary → role (mean change in OVR) | ours before | ours now | EA |
| --- | --- | --- | --- |
| CM → DM | -4.8 | -1.3 | -1.9 |
| DM → CM | -3.2 | -2.6 | -1.8 |
| CM → AM | -5.7 | -0.8 | -0.5 |
| AM → CM | -4.0 | -3.1 | -2.9 |
| LW → LM | -0.6 | -0.1 | -0.8 |
| LM → LW | -0.7 | -0.1 | 0.5 |
| ST → AM | -12.3 | -4.7 | -3.3 |
| AM → ST | -11.5 | -3.7 | -3.8 |
| ST → LW | -14.2 | -4.6 | -2.9 |
| LW → ST | -13.1 | -3.7 | -3.2 |
| LW → RW | -4.1 | -0.7 | 0.0 |
| AM → LW | -6.0 | -0.5 | -0.5 |
| LW → AM | -8.9 | -2.5 | -1.4 |
| CM → LM | -8.7 | -1.0 | -1.0 |
| LM → CM | -14.1 | -7.1 | -5.2 |
| LB → RB | -6.7 | -0.9 | 0.0 |
| LB → LM | -4.8 | -3.6 | -2.1 |
| LM → LB | -18.5 | -10.5 | -12.9 |
| CB → DM | -12.7 | -4.1 | -3.9 |
| DM → CB | -10.6 | -3.1 | -1.3 |
| CB → LB | -13.1 | -4.8 | -4.7 |
| LB → CB | -12.7 | -4.5 | -2.2 |
| CM → CB | -15.9 | -7.4 | -5.4 |
| CM → LB | -15.7 | -4.8 | -3.7 |
| DM → LB | -15.6 | -4.7 | -2.2 |
| ST → CM | -20.9 | -12.4 | -9.2 |
| LB → ST | -22.1 | -11.5 | -7.5 |
| ST → CB | -32.1 | -25.3 | -22.4 |
| CB → ST | -28.7 | -21.0 | -16.8 |
| ST → GK | -61.0 | -61.0 | -50.5 |

Because a neighbouring role is now ≥ 0.985, the thresholds moved with the scale:
`ai.minimumFit` 0.85 → 0.965 (club and ladder XIs: own, secondary or neighbouring role),
the boss XIs 0.95 → 0.99 (own or secondary, as before); the draft's `NATURAL_FIT` 0.95 now
also covers neighbouring roles (two steps is 0.945: still "out of position"). The catalog was
rebuilt (club best XIs changed with the fit rule). In the engine a far move costs less than it
did (a striker at centre-back reads the game at 82% of his awareness instead of 64%).

## Phase 4: frustrating plays, one match length, fun over realism

The steer for this pass: the engine should be fun to watch (long shots, dribbles, saves) and
free of moments that look stupid. Two tools find and measure those moments:

```sh
node tools/calibration/blunders.mjs --matches 60 --out /tmp/after.json     # counts per match
node tools/calibration/blunders.mjs --engine /tmp/before/app --out /tmp/before.json
node tools/calibration/blunders.mjs --compare /tmp/before.json /tmp/after.json
node tools/calibration/blunders.mjs --list giveaway --limit 10             # samples: fixture + time
node tools/calibration/watch.mjs --fixture 3 --at 81.4                     # contact sheet PNG
```

`blunders.mjs` replays club fixtures (`lib/fixtures.mjs`: real club XIs within 6 rating points,
the 180 s match, team 1 AI-coached) step by step and flags what a viewer would call dumb;
`watch.mjs` renders any moment as a strip of frames. What each finding means is in `DETECTORS`.

**What was wrong and what changed** (60 fixtures, per match, before → after):

| | before | after | cause → fix |
| --- | --- | --- | --- |
| plain pass rolled out of play | 1.53 | 0.35 | every ground pass arrives at 14 m/s and the receiver's reach was 1.1 m, so a pass 1.5 m off his feet ran 25 m past him. The intended receiver now stretches (reach +0.7 m, a heavier touch the further he reaches) and a late receiver runs to where he can meet the ball (`receivePoint`). Passes missing their receiver: 9.1 → 4.8. |
| unpressed pass cut out | 1.72 | 0.32 | `laneRisk` counted a defender standing in the lane as someone who still had to arrive (turning + accelerating). A body in — or running into — the lane is now a block. |
| shot from 28 m+ with xG < 0.03 | 1.13 | 0.62 | non-specialists stop at about 30 m; nobody shoots through three bodies; a carrier outside the box feeds a free team-mate inside it. |
| danger-zone shot by an unmarked player, set defence | 0.53 | 0.20 | deliberate ball-watching lapses (`markingLapses`) are off by default, and in and around his own box a marker stands within a stride of his man (`markingPoint`'s cushion × 0.55–1). |
| pass received unmarked in the danger zone | 0.52 | 0.30 | as above; what remains is late runs from deep and balls in behind. |

**Keepers.** A save ignored how much time the keeper had: on-target shots beat him 40–60% of
the time from 25 m as from 12 m. `keeperSave` now measures the time he has to set himself
(`set`: 0 point-blank … 1 from about 20 m): set, he is surer and a stretch costs less; at
point-blank a finish is harder to stop. The blanket `saveAbility: 0.9` is back to 1 and the
180 s profile's `saveBoost` weighs mostly on reflex saves. Scored per shot, by distance (60
fixtures): under 8 m 60%, 8–14 m 49%, 14–20 m 28%, 20–28 m 10%, 28 m+ 3% (before: 39 / 37 /
17 / 10 / 10%).

**Fun over realism.** With defenders no longer gifting chances, goals come from attacking
skill: a marked striker still gets his shot away (pressure costs half the accuracy it did, the
marker at his shoulder blocks half as often), long shots are frequent again (3.3 a match from
20 m+, accuracy no longer falls off a cliff at the edge of the box, a struck shot into a corner
beats a set keeper), take-ons are up (9.1 → 12.7 attempts, 5.1 → 6.7 won) and a player who
has just beaten his man shoots while the space is there.

**One match length.** The game now plays every match on the 180 s profile (`MATCH_SECONDS`);
the 300 s profile remains for tests and tools. Calibrate with `--duration 180`:

| 128 matches, 180 s | Phase 3 | Phase 4 |
| --- | --- | --- |
| goals / match | 2.73 | 2.54 |
| 0–0 | 5% | 5% |
| shots · on target · saves | 9.1 · 4.7 · 2.3 | 9.1 · 5.4 · 3.0 |
| box shots | 5.0 | 5.5 |
| xG / match | 0.79 | 0.82 |
| take-ons won | 5.1 | 6.7 |
| pass completion | 77% | 83% |

A drafted XI against ladder opponents (`cup-calibration.mjs gaps`, 792 matches) averages 3.4
goals; the fast model (`competition-api.md`) was refitted to that sample.

**Tried and dropped:** softer pass weights (the reach fix was enough), `runsInBehind` 1.6 and
`markingLapses` 1.5 (no measurable gain), clinical finishers aiming for the corners (more
corner goals, as many more misses), more long-shot urge (0.3 → 0.4: same shot count, fewer
goals — range shots replaced better chances), tempo knobs of the 180 s profile (shot volume is
bound by real-time physics at about nine a match).

**Restarts.** A free kick or throw-in was passed to the best-scored option whatever its risk:
a quarter of the throw-ins in a side's own third and a fifth of the free kicks near the box
went straight to an opponent, some "throws" travelled 55 m. The taker is unpressed and the
defence is set, so he now takes the best ball that is on (`restartOption`: lane risk under
0.5, receiver first to it, completion over 50%; otherwise the safest), a throw reaches 30 m
at most, and the two nearest team-mates come short to offer one (`setupThrowIn`). Restart
passes kept: 78–94% → 91–96%; restart giveaways 0.28 → 0.07 a match; a shot within 12 s of
the restart as often as before, and over 300 fixtures shots (8.3) and goals are unchanged.
A first version that insisted on a safe ball (risk under 0.3) sent free kicks 10 m backwards
on average and cost goals — dropped.

**Ball on grass.** Ground balls looked frictionless: a loose ball slowed by only 2 m/s² and
rolled 50 m, and a pass arrived at 14 m/s having barely slowed. Now (`constants.js`) a ground
pass decelerates at `PASS_ROLL` 5.5 m/s² and is struck to arrive at `PASS_ARRIVAL` 13 m/s (a
20 m pass leaves at ~20 m/s and visibly slows); a loose ball slows by 3.2 m/s² + 0.12 × speed;
shots keep 2 m/s². The renderer rolls the ball (its panels turn with the distance covered). Over
300 fixtures: loose balls lingering 4 s+ 0.66 → 0.47 a match, passes out of play 0.33 → 0.29,
open danger-zone shots 0.31 → 0.25, goals 2.15 → 2.42; the paired 128-match calibration moves
goals 2.50 → 2.58 and evens the halves (shots 2nd/1st 0.86 → 1.00).

**Known gaps:** a free kick near the box is a pass or a shot, never a delivery with a set-up
like a corner's; players are placed (not walked) into kick-off, penalty and (since Phase 9) goal-kick
positions (the match view cuts there).

## Before / after (Phase 3: goals and drama)

Before = `claude/cool-mccarthy-rlaa0m` at cdece64 (Phase 1 engine, stage 4); after = this
branch. Same 128 specs, paired.

| Metric | Before | After | Target |
| --- | --- | --- | --- |
| goals / match | 2.08 | 3.07 | 2.9–3.4 |
| goals sd | 1.54 | 1.70 | real variance |
| shots / match | 10.3 | 11.7 | 12–16 |
| on target | 44.3% | 48.6% |  |
| keeper saves (of on target) | 54.7% | 46.9% | 45–60% |
| goals per shot | 20.2% | 26.3% |  |
| xG / match | 1.02 | 1.16 |  |
| corners / match | 1.0 | 1.4 | ≥ 2.5 (stretch) |
| penalties / match | 0.26 | 0.13 | 0.15–0.3 |
| headed goals | 6.0% | 6.6% | ≥ 9% (stretch) |
| 0–0 | 14.1% | 3.1% | ≤ 7% |
| draws | 28.1% | 14.8% | 18–25% |
| stronger side wins, gap ≥ 10 (n = 26) | 88.5% | 88.5% | 75–85% |
| stronger side wins, gap < 3 (n = 59) | 40.7% | 40.7% | open |
| top-3 attackers: share of shots | 60.5% | 59.7% |  |
| top-3 attackers: share of goals | 69.4% | 65.6% |  |
| 85+ attacker: shots · goals / match | 1.86 · 0.64 | 1.82 · 0.68 | involved |
| longest shot drought: mean · worst (match min) | 24.2 · 54 | 20.5 · 40 |  |
| low-rated matchups: goals (n = 18) | 1.50 | 2.72 | ≥ 2.2 |
| fouls · yellow cards / match | 3.5 · 1.10 | 2.9 · 0.82 |  |
| offsides · through balls / match | 0.20 · 5.4 | 0.65 · 7.2 | |
| own goals (share of goals) | 0.4% | 1.0% | |

Per format (after, 128 batch): 180 s — 9.1 shots, 2.73 goals (was 1.89), saves 43%, 0–0 4.7%
(was 14%); 300 s — 14.3 shots, 3.41 goals (was 2.27), saves 50%, 0–0 1.6%. Save types: catch 173,
parry 97, parry into danger 96, tip over 18. Goal situations: open play 109, counter 102, set
piece 91, regain 76, penalty 15.

**Independent check** (256 matches, `--matches 256`: different clubs and seeds, same mix;
before → after): goals 1.93 → 3.08 (sd 1.46 → 1.86), shots 10.3 → 11.1, on target 42% → 49%,
saves 56% → 44.7%, 0–0 14.1% → 4.7%, draws 26.2% → 23.4%, stronger side wins with a 10+ gap
78% → 80% (n = 50: club gaps 26/36, all-star XI 14/14), low-rated matchups 1.47 → 2.31, headed
goals 7.9% → 7.9%, corners 1.2 → 1.3, penalties 0.21 → 0.19, 85+ attackers 0.52 → 0.81
goals a match. The 128-match draws (14.8%) and strong-gap
wins (88.5%, n = 26) sit at the edge of their noise (±4 and ±8 points between batches); the
256 batch is the steadier read.

`npm run sim:fingerprint` (12 matches, one core): 16.1 s before → 15.4 s after under the same
load (the new mechanics are a few comparisons per planning pass, no allocations).

## What moved the numbers (Phase 3: goals and drama)

The previous pass found chance creation, not shooting willingness, to be the limit. The
levers below create more and better chances; four are new `gameplay` settings (0 turns the
first three off, 1 restores the old crossing) so they can be compared with `--tuning`:

- **Marking lapses** (`markingLapses` 1). A marker whose runner is in his own third and away
  from the ball ball-watches for part of a slow per-player rhythm (a sine of time and player id:
  deterministic, no RNG): he holds his line with 30% of his usual marking weight and the
  runner gets free — far-post runs, cut-backs, second balls. Share of the time:
  (96 − focus) / 50, capped at 0.6, where focus = awareness·0.7 + composure·0.3; tired legs
  ×(1.4 − 0.4·energy) and an organised back line ×(1 − coordination/2) scale it; only a
  96-focus marker never lapses. Lower-rated defences lapse far more, so low-rated matchups gain
  the most, but good defences lapse too — upsets happen.
- **Runs in behind** (`runsInBehind` 1). A forward (or an advancing midfielder) level with the
  second-last defender bursts 7–11 m past the line while a teammate on the ball 8–40 m away,
  behind the line and not pressed, can play it; the run lasts 1.1–1.6 s with a 2.5 s rest, and
  the carrier's next look comes at once (the run is the cue). He starts onside; the passer still
  has to time it, so offsides rise a little. Through-ball completion 42% → ~49%.
- **Deflections** (`deliveryDeflections` 1). A defender in his own box who meets a fast low
  delivery with an attacker within 3 m stabs at it (likelier for faster balls, closer attackers
  and poorer technique); 70% head for the byline. Contested headers glance behind more often,
  and glancing headers and blocked crosses now travel far enough to go out (they used to die
  in the box). Corners 1.0 → ~1.4.
- **Crossing willingness** (`crossWillingness` 1.5): a discerning passer (good vision and
  composure) used to cross only when the cross was likely and nearly his best option; the
  chance bar is divided and the score window multiplied by it. Headed goals 5.8% → 7.9% (256).
- **Aerial duels**: the defender's home edge in his own box 0.85 → 0.7 (logit); header scatter
  ×1.7 → ×1.5.
- **Keepers**: `saveAbility` 1 → 0.9 and, for 180 s, `saveBoost` 0 → −0.1 (180 s has 40% less
  play at the same real-time shot rate; the format knob compensates). Rating still sets reach,
  reaction and save quality; `keeperRange` (1) scales the quality spread for experiments.
- **300 s shot spread** 0.475 → 0.43 (on target 40% → 47%).

Tried and dropped: a lower turnover cost in the final third (more balls into the box, but no
more shots and stronger favourites), a higher long-range shot urge in 180 s (no extra shots),
a steeper keeper rating slope (`keeperRange` 1.25–1.5: more goals in low-rated games, but
stronger favourites).

## Known gaps (next calibration pass)

- **Shots ~11–12 vs 12–16.** 300 s matches reach ~14; 180 s stays near 9 because it has 40%
  less play at the same real-time shot rate (~2.8 per real minute in both). The 180 s profile
  compensates with conversion (`saveBoost`), not with more shots.
- **Stronger side wins with a 10+ gap (n = 26).** Eight of those 26 matches are the all-star XI
  (gap 21–24), which wins every time; club gaps of 10–17 win 72–83% (256 / 128 batch), and
  upsets now happen (2-3, 1-4, 2-3 in one batch). The 26-match number moves by ±8 points
  between batches; the 640-match gap sample behind the fast model (docs/competition-api.md) is
  the better curve.
- **Penalties 0.13–0.19 per match** (was 0.26): free runners in the box shoot instead of being
  fouled; at the bottom of the 0.15–0.3 range.
- **Corners ~1.4 vs ≥ 2.5, headed goals ~6–7% vs ≥ 9%.** Deflections, glancing headers and
  blocked crosses now go out, but the ball still rarely crosses the byline: there are ~6.5
  crosses a match (real ~20). More volume needs wide play that ends in crosses — and blocked
  crosses — far more often; header volume follows crosses and corners.

## Before / after (Phase 1 engine package, history)

Before = `claude/cool-mccarthy-rlaa0m` at 5993d5f (original engine, current catalog and badges);
after = the engine branch at 2497c1e. Same 128 specs.

| Metric | Before | After | Soft target |
| --- | --- | --- | --- |
| goals / match | 2.72 | 2.08 | 2.8–3.6 ✗ |
| goals sd | 1.78 | 1.54 | real variance |
| shots / match | 7.1 | 10.3 | 10–15 |
| on target | 45.9% | 44.3% | 35–45% |
| keeper saves (of on target) | 19.5% | 54.7% | 55–70% (≈) |
| goals per shot | 38.5% | 20.2% | (real ≈ 10%) |
| xG / match | 0.83 | 1.02 | |
| corners / match | 0.1 | 1.0 | 3–7 ✗ |
| penalties / match | 0.10 | 0.26 | 0.15–0.3 |
| headed goals | 6.6% | 6.0% | ≥ 10% ✗ (8–12% in smaller batches) |
| 0–0 | 7.0% | 14.1% | ≤ 7% ✗ |
| draws | 28.1% | 28.1% | 18–25% ✗ |
| stronger side wins, gap ≥ 10 (n = 26) | 80.8% | 88.5% | 75–85% (≈) |
| stronger side wins, gap < 3 (n = 59) | 35.6% | 40.7% | open |
| 2nd / 1st half: shots · goals | 0.91 · 0.88 | 0.96 · 1.00 | ≥ 1 |
| top-3 attackers: share of shots · goals | 54.5% · 61.0% | 60.5% · 69.4% | |
| 85+ attacker: shots / match | 1.37 | 1.86 | involved |
| longest shot drought: mean · worst (match min) | 30.7 · 95 | 24.2 · 54 | no long empty spells |
| low-rated matchups: goals (n = 18) | 1.94 | 1.50 | ≥ 2 ✗ (2.2 in the 64-match check) |
| fouls · yellow cards / match | 3.7 · 1.86 | 3.5 · 1.10 | ~⅓ booked |
| mean outfield energy at full time | 0.14 | 0.58 | |
| ms per match (single core) | 2844 | 1594 | |

Per format (after): 180 s — 8.2 shots, 1.89 goals, saves 54%; 300 s — 12.5 shots, 2.27 goals,
saves 55%. Real-time shot rates are equal (~2.5 per real minute); 180 s simply has 40% less
play. Save types (128 matches): catch 171, parry 92, parry into danger 83, tip over 10.
Penalty shootouts convert ~71% (real ~75%). Corner lab (200 corners): 48% lead to a shot within
7 s, ~10% to a goal (high per corner, but corners are rare).

### What moved the numbers (Phase 1)

- Keeper dive model replaces the flat negative `saveBoost`: saves 19% → 55%, goals per shot
  38% → 20% (the old engine scored almost every shot on target).
- Final-third flow (byline deliver-or-recycle, late runs, freer crossing), graded long shots
  and an attacking tuning: shots 7.1 → 10.3, shot droughts halved.
- Stamina budget (`stamina.drain` 1 → 0.55) and a lighter fatigue penalty on finishing: players
  no longer finish exhausted (0.14 → 0.58 energy), second halves are as busy as first halves.
- Bookings: `discipline.yellowSeverity` 1.2 → 0.75.
