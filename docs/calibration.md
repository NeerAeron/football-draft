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
