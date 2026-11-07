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
the tuning; try a change without editing `config.js`), `--summary file.json`.

**The batch** (128 matches, deterministic): club XIs from the runtime catalog — close pairs
(OVR gap < 3), moderate (3–9), big gaps (≥ 10), low-rated pairs (both < 70) — an all-star XI
against weak and elite clubs, and the default squads. 180 s and 300 s alternate. Team 1 is
AI-coached (`medium` / `hard` / `impossible`); team 0 follows the same game-state mentality
(a sensible human). Every number is emergent: no quotas, no score fixing, no RNG tied to
outcomes.

## Before / after (Phase 1 engine package)

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

## What moved the numbers

- Keeper dive model replaces the flat negative `saveBoost`: saves 19% → 55%, goals per shot
  38% → 20% (the old engine scored almost every shot on target).
- Final-third flow (byline deliver-or-recycle, late runs, freer crossing), graded long shots
  and an attacking tuning: shots 7.1 → 10.3, shot droughts halved.
- Stamina budget (`stamina.drain` 1 → 0.55) and a lighter fatigue penalty on finishing: players
  no longer finish exhausted (0.14 → 0.58 energy), second halves are as busy as first halves.
- Bookings: `discipline.yellowSeverity` 1.2 → 0.75.

## Known gaps (next calibration pass)

- **Goals 2.1 vs 2.8–3.6.** With keepers at 55% and 44% on target, ~14 shots per match are
  needed; chance creation, not shooting willingness, is the limit (raising shot urges adds
  < 1 shot). Levers worth trying: compress dead-ball time in 180 s matches, more runners in
  behind on transitions, cutback volume, a slightly lower keeper ceiling.
- **Corners 1.0 vs 3–7.** The ball rarely leaves play over the byline (~5 times a match vs ~25 in
  real football): crosses and clearances are aimed in-field. Deflections, glancing headers,
  blocked crosses and byline tackles now go behind; more volume needs crosses that miss.
- **0–0 and draws** follow from the low goal count.
- Batches of 64 vs 128 matches differ by up to ±0.3 goals; judge changes with paired runs.
