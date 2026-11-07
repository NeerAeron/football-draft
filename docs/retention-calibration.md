# Possession and shot-volume calibration

Baseline: `fd23f57dee138e5d94c7749d4b8be730b4f17320` (v32).
The published candidate's engine/config hashes, individual match results and
summaries are recorded in `retention-comparison-results.json`.

## Method

32 paired seeded matches at 60 simulation steps/second: four real-roster seeds
for each of 73-rated balanced, 80-rated balanced and elite possession squads,
at both 180 and 300 seconds, plus the eight original catalog audit fixtures.
The first 24 matches use mirrored XIs with full positional proficiency. Stronger
mirror teams also face stronger defending; these are not isolated attribute tests.

A turnover means secure opposition control or an opposition restart following
possession. Shots, goals and period endings are excluded. A receiving miscontrol
includes bobbles subsequently recovered by the same team; it is not necessarily
a turnover. Observers assert pass/completion totals and miscontrol accounting.
One complete observed/unobserved replay additionally verified identical RNG,
score, team statistics and elapsed time.

## Paired sample: averages per game, both teams combined

| Metric | Before | After |
| --- | ---: | ---: |
| Turnovers | 33.84 | 22.53 |
| Receiving miscontrols, including recovered | 13.63 | 3.91 |
| Shots | 6.63 | 8.63 |
| Off-target shots | 2.25 | 3.34 |
| Blocked shots | 0.84 | 1.19 |
| Goals | 2.59 | 2.56 |
| Long balls, excluding crosses/clearances | 9.88 | 9.97 |

Weighted pass completion increased from 75.5% to 86.6%. The original eight
catalog audit matches specifically fell from 16.88 to 3.75 receiving bobbles
per game (13.13 fewer). These are simulation samples, not guaranteed match rates.

| Turnover cause | Before/game | After/game |
| --- | ---: | ---: |
| Receiving miscontrol | 6.94 | 1.66 |
| Clean interception | 9.09 | 7.91 |
| Carrier tackled off the ball | 8.91 | 6.72 |
| Pass near receiver without collection | 3.34 | 1.28 |
| Untouched pass out | 1.47 | 1.00 |
| Failed take-on | 1.31 | 0.97 |
| Heavy dribbling touch | 1.72 | 2.16 |
| Opponent deflection then recovery | 0.81 | 0.59 |
| Offside | 0.13 | 0.16 |
| Carried out | 0.13 | 0.09 |

Heavy-touch losses increased slightly as uninterrupted possession increased;
the heavy-touch formula was not changed.

## Quality benchmarks

| Mirrored squad | Before losses/team | After losses/team | After, 3 min | After, 5 min |
| --- | ---: | ---: | ---: | ---: |
| 73 balanced | 16.44 | 11.50 | 6.13 | 16.88 |
| 80 balanced | 16.94 | 11.94 | 8.00 | 15.88 |
| Elite possession | 17.25 | 8.25 | 6.88 | 9.63 |

Eight supplementary games used fixed 73-rated opposition (two seeds, both
durations). The 80-rated home squads averaged 10.25 turnovers and elite
possession squads 8.50. The elite rough target of five has not been reached.
Further reductions would require a broader change: mirrored elite teams already
complete 91.1% of roughly 70.5 passes per team, while facing elite defenders.

Goals by length in the paired sample: 3-minute 2.69 to 2.63; 5-minute 2.50 to 2.50.
Shot volume increased through longer possession and completed attacks, without
raising shooting-willingness settings. A modest keeper adjustment offsets the
extra attempts. Penalty conversion retains its existing calculation.

## Reproduction

From the repository root:

```sh
node tests/retention-calibration.mjs /tmp/retention-results.json
CALIBRATION_FIXTURES=tests/fixtures/retention-fixed-opposition.json node tests/retention-calibration.mjs /tmp/retention-fixed-opposition-results.json
VALIDATE_OBSERVER=1 CASE_LIMIT=1 node tests/retention-calibration.mjs /tmp/retention-observer-check.json
node --test tests/receiving-and-retention.test.mjs
```

For baseline replay, check out the baseline commit's complete `dist` directory
into a separate location and set `CALIBRATION_ENGINE` to that engine's file URL.
Keep its dependency modules together; do not combine the old engine with the
new configuration. The fixture IDs resolve against the unchanged player catalog.
