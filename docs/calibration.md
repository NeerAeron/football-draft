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
like a corner's; players are placed (not walked) into kick-off, penalty and goal-kick
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
