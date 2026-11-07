# Loose-ball recovery and discipline validation

The recovery fix separates challenge cooldown from ball collection. An active
player can collect a loose ball while waiting before another tackle, and the
chosen recoverer replaces stale movement instructions immediately. A genuinely
poor touch keeps a short recovery window; a ball settled at the feet becomes
collectable after 0.12 seconds. Stuns, offside and restart second-touch rules remain.

Elite technique has a slightly smaller error-reduction bonus above 75 control.
Passing scatter increases gradually above 78 passing ability. Controlled probes
with no badges, neutral quality scaling, 60% stamina and an unpressured ground
reception produced the following first-touch error probabilities:

| Control | Before | After |
|---|---:|---:|
| 65 | 15.666% | 15.666% |
| 75 | 11.6625% | 11.6625% |
| 85 | 8.217% | 8.5905% |
| 90 | 6.7035% | 7.194% |
| 95 | 5.3295% | 5.8905% |

Cards are assessed only after an actual contact foul. Angle, relative velocity,
aggression, discipline, stamina and match length affect contact severity. A clear
goal-chance denial uses position, direction and covering defenders, including
the penalty exception for a genuine challenge for the ball. Booked players avoid
risky challenges and have lower foul risk. Second yellows still dismiss. No card
count target is enforced during a match.

The 64-match sample spans 3- and 5-minute matches, balanced 73 and 80 squads,
elite possession sides and mixed catalog sides. Half are the existing paired
fixtures; half use those lineups with seed + 13000. All rates below are per match,
both teams combined. Raw results and source hashes are in cards-balance-results.json.

| Measure | Average |
|---|---:|
| Fouls | 4.140625 |
| Yellow cards | 2.1875 |
| Red cards | 0.078125 |
| Long balls, excluding crosses/clearances | 8.625 |
| Clearances | 0.84375 |
| Receiving miscontrol possession losses | 7.84375 |
| Clean interception possession losses | 7.609375 |
| Goals | 2.5 |
| Shots | 7.734375 |

There were five red cards and no second-yellow dismissals in this sample. These
rare-event estimates remain noisy. Forced second-yellow, goalkeeper dismissal,
seven-player, abandonment, restart and replay scenarios verify the uncommon paths.
On the 32 identical pre/post fixtures, shots averaged 7.84375 both before and after;
goals moved from 2.4375 to 2.5. Long-ball preference increased 10% and clearance
willingness 6%; additional pressure-sensitive clearance preference applies to
centre-backs with limited passing, control, dribbling and vision. Actual counts
remain dependent on the match situation, and safe short exits remain preferred.

Engine and replay tests verify card state, active-player exclusion, emergency
keepers, halftime and reset. JavaScript syntax and static module dependencies
were checked. Browser layout inspection was unavailable for this buildless static
project in the managed preview environment; yellow pitch markers and scoreboard
red-card indicators were reviewed in source.
