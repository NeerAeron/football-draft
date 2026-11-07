# Football Draft Challenge

A dependency-free draft and continuous 11v11 soccer game. Serve `app/` over HTTP; no build, account, database or external runtime API is required.

## Quick start

`app/` is the complete game: plain HTML, CSS and ES modules plus the player data. There is no build step. Serve it over HTTP (modules and the player catalog cannot load from `file://`):

```sh
npm ci          # dev tools only (Prettier, ESLint); the game itself has no dependencies
npm run dev     # http://127.0.0.1:8000 with live reload
```

Without Node.js: `python3 -m http.server 8000 --bind 127.0.0.1 --directory app`.

## Development

```sh
npm run check         # format check + lint + fast tests (~10 s)
npm test              # full node:test suite
npm run test:browser  # Playwright smoke run of the UI flows
npm run shots         # screenshots of every flow into .shots/
npm run verify        # everything above
```

See `CLAUDE.md` for the architecture map, invariants (determinism, config snapshots) and the data pipeline.

## Upload to GitHub

Unzip the repository archive, create an empty GitHub repository, and upload the **contents** of the `football-draft-repo` folder. Include `app/`, `scripts/`, `tests/`, this README and `.gitignore`.

To host the game with any static web host, publish the contents of `app/`. This export does not require ChatGPT Sites or its original hosting configuration.

This is the version 43 source export from **Create Soccer Simulation**, based on source commit `2a654aed377d8c6c9e04d913201e79069aa54943`. Game files, data, scripts, tests and existing credits are preserved. Original hosting metadata and Git internals are omitted. The original development notes follow below.

## Game modes

- **Player vs player:** shared-device alternating draft, with a coin toss. Each pick locks a league and, for A/B/C leagues, a club. D/F leagues open their whole pool. Tactics and badges unlock before kickoff and at half-time.
- **Classic Draft Challenge:** the human drafts eleven players against a preselected opponent. Very Easy randomly chooses a C club, Easy B, Medium A and Hard S. Impossible randomly assembles an all-star XI with natural and assigned overall at least 84. Only complete, position-compatible clubs are eligible. AI chooses its own formation and tactics. Harder coaches use squad strengths, opponent pace and instructions, fatigue, time and score. Human tactics remain editable live in continuous formats. All four lengths are available: 5 minutes, 3 minutes, 1-minute highlights with a tactics break at half-time, and an Instant result. Budget mode provides 2 Superstar, 3 Star, 3 Starter and 3 shared Normal/Bench slots. Players use their own tier first; a cheaper player may use the nearest available higher slot after explicit confirmation. Each confirmed replacement permanently consumes that budget slot, while the player keeps their real tier, abilities and badges. Legal pool lookahead preserves a fillable XI and a keeper. Financial Takeover removes the slot limits.
- **Sandbox:** choose either side from any stored club, or random XIs. Lineup opens the complete player catalog before kickoff; abilities and tactics are editable. For an incomplete club or incompatible formation, a squad builder preserves every compatible retained player and lets the user fill open slots from the catalog, manually or with the explicit auto-fill button.

Difficulty never changes execution, aiming, player reaction intervals, physical speed, or any skill formula. It changes squad selection and the AI coach only. The earlier win-rate targets and execution handicaps have been removed. Results emerge from the same engine in every mode.

Back-line defenders leave opponents well behind the ball to the midfield instead of chasing them out of shape; dangerous cutback receivers near the box retain their markers. A beaten or slow-to-close presser can receive cover near halfway when a free defender can help without abandoning a runner. Stranded backs use urgent recovery, with the existing pace, acceleration and stamina limits. The captured turnover regression and eight-game diagnostic are in `tests/breakaway-defense.test.mjs` and `tests/breakaway-comparison-results.json`.

Simple passes to feet use low scatter and dependable first touches. Pressure, distance, lead runs, loft, delivery type and lateral stretching shift execution risk toward difficult balls; skills, fatigue and weak foot still matter. Intended receivers can collect during an unrelated action cooldown, keepers move to meet backpasses, and a settled ball remains collectible under pressure. Fresh receivers can release one- or two-touch passes earlier, with a small preference for quick combinations and a faster One Touch badge; clear dribbling lanes remain useful. Team styles have slightly stronger passing and positioning preferences. Config exposes simple/difficult pass error and team-style influence. The paired 24-match audit is in `tests/contextual-passing-results.json`; none of its measured rates are production targets.

Technical quality improves passing scatter and demanding first touches gradually. Abilities already affect each action directly; the additional error modifier is now bounded to 0.72–1.28 and varies linearly with ability. Control and composure modestly resist execution pressure without hiding physical congestion from tactical or shooting decisions. Passing errors remain bounded to plausible visible misses. Natural keepers use their single GK rating for distribution, handling and foot control, rather than imported placeholder outfield ratings; an emergency outfield keeper retains their own technique. Vision and passing skill favor worthwhile progressive options, while aerial delivery decisions consider the receiver's heading.

High defensive awareness adds earlier runner anticipation, close jockeying and reachable passing-lane interceptions. Strong organizers improve nearby marking and coordinate a physical approach to deep build-up. Backs and advancing runners retain goal-side protection; pace, acceleration, sprint reserves and fatigue still limit every movement. Lower-rated defenders retain their existing movement baseline. Config exposes control, passing, defensive-reading and creative-ambition influence separately. There are no opponent-tier modifiers, prescribed pass-accuracy rates or possession quotas. Possession now includes uninterrupted pass flight, while loose balls and restarts remain uncredited. Reproducible real-club calibration fixtures and the runner are in `tests/fixtures/quality-gap-squads.json` and `tests/quality-gap-calibration.mjs`.

The v41 balance correction supersedes the earlier large pass-accuracy separation targets. Small ratings advantages should accumulate over a match without dominating every category. Default attribute amplification is 1.00 instead of 1.08; added control, passing, defensive-reading and creative-ambition influences are now 0.55, 0.65, 0.55 and 0.45. Extra pass disguise, pressure resistance and decision uncertainty are also reduced. Goal-side recovery, coordinated marking handovers, safe outlet screening, receiver collection and keeper fixes remain. Saved device settings upgrade unchanged older defaults once; custom values and explicit match settings retain their chosen numbers.

`tests/quality-balance-results.json` compares 44 paired fixtures against v40: 32 close-rating games, four equal controls and eight real-club mismatches. The close fixtures reuse roles and tendencies with a three-point ability increase on one side; runtime badge minima still apply. Across those 32 games, the stronger side's wins fall 27→17, draws rise 2→7, three-goal wins fall 15→7, and its average goal advantage falls 2.19→0.75. Shots change 6.25/3.19→4.47/4.03 and possession 53.3%/46.7%→50.1%/49.9%. Stronger teams still score more overall, but no longer lead every category. Larger real-club gaps still favor the stronger side in this sample. All 261 automated checks pass, including gradual changes around the former elite threshold and saved-setting migration. These are descriptive small-sample checks across six seeds, not enforced win rates. Reproduce them with `tests/quality-balance-calibration.mjs`; set `CALIBRATION_VALIDATION=1` for the additional seeds. Historical v39/v40 audits remain in `tests/quality-gap-results.json` and `tests/quality-followup-results.json`.

The v42 defensive correction addresses a separate press/retreat conflict. Against an advancing carrier, the designated presser now checks the distance to his interception point as well as the current ball position. Previously he could retreat into shape even while another defender moved up to cover him. Two captured City–Auxerre incidents reproduce the failure and close correctly with the fix. `tests/defensive-press.test.mjs` checks diagonal closing, separate cover, real movement, both halves and directions, and preservation of stationary/receding-carrier and low-block behavior. The v41 quality balance and all speed, marking, tackling and shot settings remain unchanged. The exact reported central split was not reproduced, so this is a targeted correction to the verified retreat problem rather than a claim to eliminate every defensive gap.

The v43 reception-tracking correction acts within ten meters of a controlled carrier. Defenders estimate a short first-touch launch from visible facing and velocity, with better reading improving the estimate; the estimate expires after 0.65 seconds and never reads an attacker's chosen target. Relative closing speed, acceleration and fatigue add up to 1.1 meters of braking room. Close goal-side jockeying follows the carrier's movement, using normal sprint reserves when necessary, instead of braking at a moving target. Speed and acceleration limits, tackle probabilities, foul rules and all configuration defaults are unchanged. `tests/carrier-tracking.test.mjs` reproduces the original failure and checks both halves/directions, diagonal runs, quality differences, fatigue, slow defenders, overcommitting and actual tackle opportunities. All 268 checks pass. Twelve paired City–Auxerre, City–Lorient and City–City checks across 180/300 seconds produced 44→51 goals, 109→114 shots, 80→47 successful tackles, 56→39 fouls and 81.55%→81.16% pass completion in total; these are a small descriptive sample, not calibrated targets or an assurance that outcome rates are identical.

Twelve preset kit combinations remain available. Actual clubs start with sourced simplified palettes; mirror colors switch the opponent to its secondary color. Solo uses **You**, multiplayer uses **Player 1 / Player 2**, and the AI uses its actual club name. Drafted lineup slots and formations can change only at half-time in Classic Draft Challenge and Player vs player. Before kickoff and during either half, Lineup is available for inspection only. The tactics and lineup panels display this rule. Sandbox lineup swaps retain player identity, stats and stamina at half-time. Edits remain session-local.

The pitch is the dominant desktop surface. One sidebar switches between Tactics and Player, with keyboard-operable tabs; clicking a player opens their details and half-time opens tactics. Match stats sit to the right of scrollable key moments in a compact row below the pitch. Top-level match controls share the header to preserve pitch height. The pitch projection extends about 13% farther goal-to-goal (130:80 canvas), retaining the touchline height and round player/ball tokens; physical coordinates remain 105×68. Narrow screens stack the panels. Returning Home pauses the simulation and preserves a resumable match in the current session.

## Configuration and TV mode

`config.html` provides grouped controls for draft weights and every league/club override, budget limits, player/team tiers, AI roster rules and coaching thresholds, gameplay execution factors, stamina, added time, match-format profiles, role overall weights/offsets, position familiarity, badge ability/preference boosts and display motion. Percentage controls use percent units; odds are normalized against eligible pools. Settings persist on this device with JSON import/export and section/all-default resets. Each match snapshots the configuration for replay and duration changes; changing global settings never rewrites an ongoing match.

TV mode uses native fullscreen when available and a viewport fallback otherwise. It shows the scoreboard, pitch and six live statistics. A translucent gray common player name follows each ball receipt, then fades after 2.5 seconds. Overlay controls pause/resume, leave TV mode, or open tactics when allowed. Receipt labels follow possession timestamps in live play and highlights, without consuming simulation randomness.

The v16 default change is +3% base movement speed and acceleration, +12% shooting willingness, +8% shot scatter, and +8% visual player radius. All modes retain identical physics. There are no goal or miss quotas. An exploratory 24-match paired neutral comparison averaged 3.33 goals in 3-minute games and 3.67 in 5-minute games, with more shots and off-target attempts in both formats. Five-minute spread is 0.475 and keeper save adjustment −0.37, which recovered scoring after the initial scatter increase. Combined goals averaged 3.50 versus 2.92 previously; these small samples are descriptive, not enforced targets or stable estimates for every squad. Fatigue stayed near 10% at full-time. Results are in `tests/gameplay-v16-comparison.json`.

The homepage defers the catalog fetch until it is needed. The runtime catalog is 7.66MB instead of the 12.55MB full provenance catalog (about 39% smaller); both are compiled from the same 7,733 profiles.

## Viewing and controls

- Sound effects use locally synthesized Web Audio: shot impacts scale with shot strength, saves and posts have distinct hits, goals combine a cheer swell and scoring cue, and whistles mark fouls and period breaks. League/club reel ticks follow the animation; successful Star and Superstar picks have distinct selection chimes. Mute works in the header and TV mode; desktop volume and mute are remembered on this device. Audio starts after a user gesture, stops on pause/home/hidden tabs, and follows only visible highlight events. Instant games play only the final whistle. Audio does not alter simulation or draft randomness.
- **5 min / 3 min:** continuous physical simulation at a fixed 1/60 step. Regulation includes dead-ball time; each half adds seeded, bell-curve stoppage time (typically 2 and 3 football minutes, scaled to the viewing duration). A final shot, goal celebration or awarded penalty can settle before the whistle. Half-time automatically pauses and opens tactics; the user explicitly starts the second half. Full-time presents the result before the report.
- **1 min:** 30 seconds of chronological highlights per half from the five-minute engine, separated by the same paused tactics break. Only the first half is simulated initially; edits at the interval affect the second half. Every goal is included; the match clock jumps between clips, movement within clips does not speed up.
- **Instant:** resolves the same five-minute engine, including stoppage time and recovery, without visual playback or an interactive interval, then opens the full report.
- Start/Pause/Resume and Space share a playback clock. The button has a fixed hit area, only changes its label when playback state changes, and handles each mouse/touch/pen gesture once; the following native click cannot toggle it a second time. Cancelled or outside releases do not activate it. Native keyboard and assistive clicks remain supported. Paused or hidden time never accumulates into a resumed frame. Held Space cannot repeatedly toggle playback. Space remains a text/input control while an input, select or dialog has focus.
- New match returns to setup. Sandbox can choose real clubs or randomized distinct players; shared drafts exclude duplicates across both XIs, including the preselected AI. Duration changes are available only before kickoff and preserve the lineup. Duration controls disappear for the rest of a started match, including manual pauses and half-time. Catalog replacements are pre-match Sandbox only.
- The half-time and full-time overlay buttons use the same single-activation pointer and keyboard handling as Pause. Their labels and hit targets remain stable between state transitions.
- Key moments scroll through the complete event feed; click its title to expand the timeline in a dialog. New entries preserve the reading position.

## Player identity and behavior

Each player is an independent entity with physical position and velocity, a target, decision timing, intention, stable individual preferences, resources and action state.

**Attributes govern execution:** Sprint speed, Acceleration, Finishing, Shot power, Long shots, Penalties, Heading, Short passes, Long passes, Crosses, Vision, Dribbling, First touch, Composure, Tackling, Defensive awareness, Stamina, Strength and one Goalkeeping rating. Six category tiles summarize outfield ability; **Expand ratings** reveals the detailed values and controls. Goalkeeping remains a single additional rating. Dominant foot is editable; a separate weak-foot proficiency influences awkward-side delivery and finishing. Pace and shot power affect actual motion. The inspector does not expose current player speed. Circles and squad buttons show up to three name initials; hover shows the name, current assigned position and position-adjusted overall, with the ongoing action on the pitch. Below the scoreboard, DEF averages the goalkeeper and defenders; MID averages DM/CM/AM/LM/RM; ATT averages ST/LW/RW. Each uses unrounded player overall before rounding the team line, updates with lineup/formation/attribute edits, and shows a dash if the line has no players. Clicking also exposes the position in the inspector for touch users.

**Hidden preferences govern choices:** advance, risk, carrying, roaming, overlaps, aggression, discipline, run timing and shooting. These are seeded once with bounded positional variation, paired across the default teams, and preserved in configuration/reset/replay. They are not freshly rerolled on each decision or used to secretly change match outcomes. At each choice, preferences combine 70% stored/source tendency with 30% bounded ability-based preference, then bounded badge changes. Holding position, inside movement, aerial involvement and sweeping are additional continuous preferences used directly by movement formulas. Slow recovery pace reduces a center back’s forward and roaming preference. These values stay hidden in the player interface.

**Badges improve execution and preferences:** 36 characteristic badges include Finesse, Knuckleball, Crosser, Long Ball, One Touch, Interceptor and keeper skills. Each adds small named ability bonuses, capped at +5 total per attribute. Those bonuses apply through the simulation's skill function, including physical motion for pace/acceleration/power/endurance badges; displayed base attributes and overall do not change. Contextual technique and tendency modifiers remain separate. Hover/focus a chip for a short flavor description; numerical effects and hidden tendencies stay out of the game UI. Techniques remain possible without a matching badge, and aerial height still determines whether a header or volley can be attempted.

Tier uses rounded natural-position overall, so changing assignment does not change badge allowance. Compiled profiles and runtime editing both enforce the range below; the UI shows the selected count against the upper bound, such as **6/7**. Keeper eligibility prevents filling keeper badges with unrelated attacking skills.

| Natural overall | Tier | Badge range |
| --- | --- | ---: |
| 85+ | Superstar | 5–7 |
| 80–84 | Star | 3–5 |
| 74–79 | Starter | 2–3 |
| 68–73 | Normal | 1–2 |
| Below 68 | Bench | 0–2 |

**Overall uses the detailed abilities for the assigned role plus a small role calibration, multiplied by position familiarity.** The calibration adds 0–1.5 points before familiarity, capped at 99, and does not modify gameplay attributes or copy source overall. Each role's detailed weights total 100%; all 18 outfield details contribute, with different importance by role. Goalkeepers use their single Goalkeeping value. Heading still contributes 14% of striker ability, so +10 heading raises an in-position striker's unrounded overall by 1.4. Config exposes role weights and the position adjustment. Simulation overall can differ from the original FC overall, which is retained in the full catalog. Tags, hidden preferences and current stamina affect play separately; match-performance ratings remain a separate 1–10 calculation.

Positions belong to the profile, while the lineup slot determines the assigned role. A weighted graph connects related roles. Let `d` be the shortest distance from the primary role, or from a secondary role plus 0.025, whichever is smaller. Familiarity is `F = 0.72 + 0.28 × exp(−1.4d)`; moving between GK and outfield uses 0.60. Overall is `round(clamp(destination-role ability + role offset, 1, 99) × F)`. Offsets: GK 0; CB/CM 0.25; LB/RB 1.5; DM/ST 1; AM 0.5; LM/RM/LW/RW 1.25. This accounts for both the attributes needed in the destination role and familiarity. For identical 80-rated abilities:

| Assignment | Familiarity | Resulting overall |
| --- | ---: | ---: |
| Primary ST |100%|81|
| RB with CB secondary → CB |99.0%|79|
| RW → RM |98.7%|80|
| ST, no secondaries → CB |73.4%|59|

Unfamiliarity also changes play: tackling and creative vision multiply by `F`, defensive reading by `F^1.5`, and decision/replanning intervals divide by `F²`. Receiving control and run timing also suffer. A striker playing CB therefore reacts substantially later and reads/tackles less effectively. Raw sprint speed, acceleration and shot power stay intrinsic. Roaming during a match does not change a player's assigned position or repeatedly apply a new penalty.

Short/long pass skill blends smoothly over 16–36 metres; crosses use 80% crossing and 20% long passing, cutbacks 70% short passing and 30% crossing. Both expected completion and actual scatter use this skill. Finishing blends into long-shot ability over 16–28 metres; penalties and headers use their dedicated attributes. Acceleration changes velocity and arrival estimates independently of top speed. Defensive awareness drives reading and anticipation independently of tackling. Existing control, composure, strength, dribbling, vision, power, endurance and keeper abilities continue to govern their corresponding physical actions.

The structure is inspired by official Konami explanations of [eFootball v5 player styles and awareness](https://www.konami.com/efootball/en/page/v5/versioninfo_v5-00), [v4 physical contact](https://www.konami.com/efootball/en/page/v4/versioninfo_v4-00), and [v6 attacking/defensive styles and headers](https://www.konami.com/efootball/en/page/v6/versioninfo_v6-00). The implementation and formulas here are original, not a reproduction of Konami's undisclosed engine.

## FC 26 compiler

```sh
node scripts/compile-league-catalog.mjs SOURCE.csv app/data/catalog-reference.json app/data/players-fc26.json
```

The deterministic dependency-free compiler parses the 18,405-row CSV once, validates IDs/positions/abilities, and selects each requested league by source overall (original row order breaks ties): A all players; B top200; C top100; D top50; F top20. No model or API is called per player. Compiler 1.7.0 emits 7,733 real profiles (6,968 outfield players and 765 goalkeepers), 522 retained clubs, and metadata for all50 leagues. The original league allocation is preserved; `catalog-reference.json` adds a cumulative expansion of 1,000 outfield players and 100 keepers, independently selected by source overall from unused players in available leagues. This expansion exceeds the original per-league caps without dropping any existing profile. Re-running the compiler produces the same IDs and does not add duplicates. The older `compile-players.mjs` entry point remains a bounded first-N fixture/debug compiler; it does not define the production selection.

Source: [rovnez's FC 26 Kaggle dataset](https://www.kaggle.com/datasets/rovnez/fc-26-fifa-26-player-data), `FC26_20250921.csv`, 110 columns. Every row is the September19,2025 rating update. The uploader declares [CC BY4.0](https://creativecommons.org/licenses/by/4.0/) and SoFIFA/EA SPORTS as upstream. Source row, player and club IDs, original overall, update identity and CSV SHA-256 are retained. All five A leagues include 2,679 players across96 clubs. League caps include goalkeepers.

Forty leagues have usable player data. Missing from FC26: Mexico, Russia, Japan, Argentina's second division, Israel, Slovakia, Morocco, Egypt and Algeria. Brazil's generic EA identities are excluded. Several other licensed leagues contain only some clubs. Missing rows are never generated or attributed by nationality. All50 leagues and their original logos appear in the coverage panel; only usable leagues enter spins.

`catalog-reference.json` contains explicit source-ID mappings and the verified September10,2026 [Opta snapshot](https://dataviz.theanalyst.com/opta-power-rankings/). Its 2026 club scores do not rewrite FC26's 2025 league membership. Team tiers now use the unrounded natural-position simulation OVR median of the top ten retained players: S≥82, A≥78, B≥74, C≥70, D≥66, F below 66. This yields 12 S clubs. Clubs with fewer than ten retained players use the available median and record the sample size; they cannot be AI opponents without a complete compatible XI. Opta club ratings are retained only as historical provenance. Every retained club has a reviewed Opta identity match. Palette provenance distinguishes explicit club metadata, display colors, actual-kit-art approximations, and official-kit-description approximations. Logos are unmodified marks from TheSportsDB and Brack's official media kit; credits and hashes are in `league-logo-sources.json`.

Detailed ratings map directly from corresponding source fields, with these explicit conversions:

| Simulation value | Source / conversion |
| --- | --- |
| Sprint speed / acceleration | `movement_sprint_speed` / `movement_acceleration` |
| Finishing / power / long shots | `attacking_finishing` / `power_shot_power` / `power_long_shots` |
| Penalties / heading | `mentality_penalties` / `attacking_heading_accuracy` |
| Short / long passes / crosses | `attacking_short_passing` / `skill_long_passing` / `attacking_crossing` |
| Vision / dribbling / first touch | `mentality_vision` / `skill_dribbling` / `skill_ball_control` |
| Composure / tackling | `mentality_composure` / `defending_standing_tackle` |
| Defensive awareness | Rounded 70% `defending_marking_awareness` + 30% `movement_reactions` |
| Stamina / strength | `power_stamina` / `power_strength` |
| Goalkeeping | GK source `overall`; emergency outfield GK skill uses mean of five keeper subratings |
| Dominant / weak foot | `preferred_foot`; stars 1–5 → proficiency 15, 35, 60, 82, 100 |
| Positions | First `player_positions` entry primary, remainder secondary; CDM→DM, CAM→AM |

Broad EA category summaries are not copied over detailed values; they are blank for keepers. Missing required abilities fail compilation instead of silently inventing ratings. Tendencies use stable position priors, ability balance, attacking positioning and aggression. Work rates are absent throughout this source: discipline uses an explicit neutral prior, not a fabricated observation.

Compiler 1.7.0 derives continuous hidden preferences and maps recognized PlayStyles and source tags to badges. It fills the tier minimum with the strongest position-eligible inferred abilities. The count varies within the tier range from overall within the tier and the amount of explicit source evidence. Higher-confidence explicit traits outrank inferred badges. Each selected badge retains its source or inference evidence. No categorical player type is emitted. PlayStyle+ increases selection priority, not the strength of the runtime bonus. Original trait names, plus flags, mapping evidence and unsupported traits are retained; unsupported traits are not falsely claimed as implemented. Technique tags remain probability modifiers, never exclusive unlocks.

League identity uses source IDs rather than ambiguous names. Per-league weights are A39, B11, C3, D0.8, F0.2, multiplied by `1 + clamp((OptaScore−80)×0.006, −0.10, 0.10)`. This keeps league tier dominant. Club weights are `2^((team median OVR−72)/interval)`: the doubling interval is 5 OVR in A leagues, 3.5 in B leagues, and 2.5 in C leagues. This makes stronger clubs progressively more favored in weaker leagues. The interval follows league tier, not club tier. Existing saved default odds upgrade automatically; customized weights and all other settings are preserved. Config shows the resulting opening league probabilities and conditional club probabilities, with a per-league and per-club multiplier. The draft spinner shows tier labels. A draw remains locked across all filters and repeated clicks. Only pools with a remaining eligible goalkeeper/outfield player can enter that pick; GK-last drafts therefore remain possible. A/B/C pools also require an eligible club. D/F bypass clubs entirely.

Club starting-XI eligibility uses rectangular Hungarian assignment for each formation, maximizing role-adjusted overall while requiring a goalkeeper, ten different outfield players and at least85% position familiarity in every slot. It costs O(11²×squad size) per formation and caches results by catalog. The current pool has288 complete, compatible clubs eligible for AI and522 Sandbox club choices; UI player lists paginate rather than mounting thousands of cards at once.

Draft browsing defaults to every available player in the selected league, sorted by natural overall. An optional position view sorts by overall at that role, with GK/outfield compatibility. Picks fill the best vacant compatible slot, favoring the selected role when it has an opening. The UI shows the intended assignment and adjusted rating before selection. There is no familiarity cutoff hiding out-of-position candidates. Each side must take one GK and ten outfield players; unavailable slot classes are excluded from league eligibility, preventing a last-pick keeper dead end.

`tests/fixtures/fc26-sample.csv` contains five actual source rows for deterministic compiler checks. The full raw source CSV is not shipped to browsers; the compiled catalog is loaded once and reused.

The small role calibration reduces mean absolute disagreement with FC OVR from 2.00 to 1.09 points over the first 1,000 outfield players (rounded OVR: 1.98 → 1.06). Across all 16,343 outfield rows it falls from 2.00 to 1.13. This is a descriptive dataset check, not an independent holdout. Keepers still use their exact source overall. Results and role offsets are in `tests/overall-calibration-results.json`.

## Team decisions and movement

Each team chooses from ten formations: 4–3–3, 4–4–2, 4–2–3–1, 4–1–4–1, 4–1–2–1–2, 4–3–2–1, 3–4–3, 3–5–2, 5–3–2 and 5–4–1. Support and restarts use role, formation geometry and ability rather than fixed midfielder slot numbers. Each team has one of six styles (Balanced, Possession, Counter attack, High press, Wing play, Park the bus), and four instructions on 1–5 scales: Tempo, Width, Press intensity and Fluidity. Low fluidity pulls ordinary support closer to a shape that moves with the ball and encourages quicker recovery. High fluidity widens roaming and extends combinations. Clear runs, receiving, loose-ball recovery, pressing and dangerous marking retain priority at every setting. Defenders still protect the counter and ordinary forward support respects the offside line; freedom is not random wandering.

Passing utility combines estimated completion, useful forward progress, the receiving player's next action and turnover danger. Lane risk compares ball travel time with defenders' actual arrival. Reaching the route does not guarantee an interception: awareness, tackling, speed and facing determine whether the defender reads and contacts the pass. Receiver margin includes the time to control the ball. Short support and third-man runs create alternatives to speculative long passes. Patient tempo reduces urgency without removing the value of safe forward progress.

Long distribution now compares ground and lofted routes. The lofted model assesses the ball's arc, defender reach, landing competition and receiver control. Long passing, vision, weak foot, fatigue, hidden risk/advance preferences, badges, tempo, width and team style influence the choice and execution. Wide teams value open switches; counters can lead quick runners from deeper positions. Pressured outfield players can clear long when carrying or a safe short outlet is unavailable; composure, conservative tendencies and defensive style affect that decision. No per-match quota is enforced. The Config gameplay section exposes Long Ball Preference and Clearance Willingness.

The v32 paired comparison covers 28 neutral-tactic matches per version, split across three/five minutes and default/catalog squads. Open-play deliveries of at least 28 m, excluding crosses and clearances, increase from 4.11 to 8.25 per match; lofted deliveries from 0 to 4.25, switches from 1.57 to 5.11, long through balls from 0.86 to 2.43 and long clearances from 0.18 to 0.61. The switch/through counts overlap the long-ball total. Mean goals change from 2.64 to 2.89 (median 3 in both), shots from 7.07 to 6.61, and pass completion from 75.46% to 74.19%. These are descriptive samples, not fixed rates; see `tests/long-ball-comparison-results.json` and the reproducible `tests/long-ball-calibration.mjs` runner.

Touchline carry targets reject routes collapsed by boundary clipping and evaluate the actual travel heading. This fixes a reproduced case where a pressured carrier chose a nine-centimetre waypoint and braked almost to a stop. Regression checks cover both touchlines, teams, halves and all four corners while preserving open-space dribbling decisions.

Dribbling evaluates forward, lateral and backward escape paths. Pressure, body orientation, strength, dribbling, stamina and supporting defenders affect success. A nearby second defender or a recent sequence of take-ons lowers the next attempt's probability. A regain clears stale tackle/stun state, initializes an immediate pressure-aware first touch and schedules a prompt decision. It does not grant blanket invulnerability.

Defenders bid for a diagonal interception using travel time, turning direction, sprint reserve and the risk of abandoning another attacker. Beaten defenders recover toward the inside shoulder ahead of the runner. Marking targets anticipate the runner’s motion and stay on the goal side; formation blending cannot pull them behind the attacker. Recovering and tracking runs can use sprint reserve. Dangerous runners receive priority in unique assignments, with switching costs for continuity. A covering defender is used only when that does not expose a more dangerous passing option. Center backs also stay behind opposition outlets while their team attacks. Slower center backs maintain a deeper support target, adjusted by ball security, available cover and individual willingness to advance. During pass flight, a defender either attacks a reachable lane or gets goal-side of the receiver. Displayed intentions have a brief debounce; actual action decisions remain independent.

Untyped full-backs choose how far to support based on ball side, security, midfield cover and the opposite full-back's height. Attacking full-back, Defensive full-back and Inverted full-back tags modify that decision continuously. They are not on/off attack switches. Midfield support is staggered, attackers can exchange channels, and safe central combinations can trigger a third-man run.

## Two stamina resources

- **Sprint reserve:** internal, measured in physical effort seconds. Bursts consume it, lower effort restores it. Stamina affects burst duration and recovery. Exhausted players must ease off; a run intention does not guarantee continuous maximum speed.
- **Match stamina:** selected-player bar only. Running, acceleration and sprinting consume energy throughout regulation and stoppage time. Drain is additive and workload-dependent, targeting an average path near 100% → 50% before half-time → 65% after recovery → 5–15% at full-time for outfield players. There is no prescribed halftime or final-energy assignment. Recovery adds 15 percentage points on average, with small endurance/tag differences; sprint reserve resets once. Keepers usually retain more. The bar is the energy used by movement, control, decisions and contact models. `drain = dt / duration × workload × (1.12 − .33 × stamina/100) × tagFactor × restartFactor × halfFactor`; second-half effort costs 10% more, and reserves below 18% progressively reduce spending as players tire. Workload normalizes movement against fatigue-adjusted speed so early exhaustion does not determine the entire curve.

Physical speed has no match-length multiplier. Fatigue can make two players move differently at the same physical timestamp because their matches have progressed by different fractions.

## Rules and outcomes

Fouls arise only at actual tackle or contested aerial-contact opportunities. Contextual probability uses approach angle, closing speed, reaching, defensive skill, balance, aggression, discipline and fatigue. Winning the ball does not automatically legalize contact. A contact foul inside the offender's own penalty area is a penalty; there is no separate random penalty generator.

Penalty takers are chosen by penalties and composure. The ball is at 11 m, keeper on the goal line, other players behind the spot, outside the area and at least 9.15 m away. The kick has physical flight, placement and a committed keeper dive. A moving frame or goalkeeper rebound can finish an extended penalty. Restart second-touch restrictions apply until another player touches the ball.

Offside uses the exact teammate-touch snapshot: beyond both ball and second-last opponent, in the attacking half. Level is onside. The whistle waits for reachable involvement or a modeled goalkeeper screen; merely being offside is not an offence. Direct goal kicks, throws and corners are exempt. Keeper distribution after a catch is not. Controlled deliberate opponent play clears the snapshot; saves and deflections preserve it. The restart is indirect and cannot score untouched.

Shot totals are classified from resolved outcomes. Goals and qualifying saves are on target; blocks, ordinary frame hits, high/wide shots and off-target balls gathered by keepers are not. A later goal from the same deflected shot upgrades its outcome without double-counting. A scoring attacking cross or dribble is retrospectively counted as a successful attempt; genuine own goals are handled separately.

Goalkeepers assess goalbound trajectories irrespective of whether the ball began as a shot or cross. Hand saves require both dimensions of the penalty area. Held possession is protected; short outlets require a safe arrival margin and an onward option. When there is no viable short outlet, the keeper can send the ball beyond the press.

Goal kicks allow 1.7 seconds for setup, corners 2.1 seconds, and throw-ins 1.15 seconds. Outfield players move toward restart-specific shape while the ball is dead; goal-kick opponents recover ahead of the receiver, and keepers stay near their own goal. Existing required-distance/encroachment corrections remain at the release. Stoppage time uses a separate seeded normal draw: rounded/clamped N(2, 0.8²) to 1–5 first-half minutes, N(3, 1²) to 1–6 second-half minutes. It does not scale player motion or add guaranteed chances. Football clocks show 45+ / 90+ time; the second-half clock begins at 45:00. First-half run/possession windows clear at the interval, without clearing match stats or player identity.

The modeled ruleset is deliberately bounded: no cards, handball model, advantage, substitutions, injuries, VAR or knockout extra time. Restart positioning and aerial contact remain simplified. These omissions are disclosed in How it works.

## Feedback and report

Ordinary passes, pressing and marking stay quiet. Significant deliveries, successful take-ons, possession wins, shots and referee interventions receive concise cues; goals have a larger celebration. There are no event levels. Trail and impact strength follows physical strike/contact intensity continuously.

Feed percentages are estimates at action time, labeled explicitly: on-target likelihood for shots, clean-win likelihood for tackles, take-on likelihood for dribbles and completion likelihood for meaningful passes. They are approximate forecasts, not guarantees or official xG. Shot forecasts include ability, geometry, composure, foot and pressure; the physical engine decides the outcome.

The report includes all 22 ratings, goals/assists, chances created, passes, take-ons, tackles, saves, fouls, offsides, penalties, shot outcome categories, goal origins, and top performers. Ratings are an explicit game heuristic, not an official rating model. The report always reflects the complete match behind highlights.

## Research and calibration

Source: [StatsBomb Open Data](https://github.com/hudl/open-data/tree/4b73468fc5b0f1950f9f66fada70ad3a4f9327cb), pinned to commit `4b73468fc5b0f1950f9f66fada70ad3a4f9327cb`. The 115 fixtures comprise the 2022 World Cup and Euro 2024. Periods 1–4 include extra time in 10 fixtures; shootouts are excluded. All rates below combine both teams per fixture.

| Real reference | Sample result |
| --- | ---: |
| Foul stoppages, excluding advantage |23.75 per match |
| Offsides, pass outcomes plus standalone events |3.57 per match |
| Penalties awarded |0.304 per match |
| Penalty conversion |26/35 =74.3% |
| Shots |24.08 per match |
| On target, including penalties |932/2769 =33.7% |
| Non-penalty on target |898/2734 =32.8% |
| Pass completion |83.1% |
| Unsuccessful dribbles |48.2% |
| Headers / shots |17.3% |

[IFAB Law 11](https://www.theifab.com/laws/latest/offside/), [Law 12](https://www.theifab.com/laws/latest/fouls-and-misconduct/) and [Law 14](https://www.theifab.com/laws/latest/the-penalty-kick/) guide the rules. `app/data/rules-reference.json` contains exact definitions, numerator/denominator counts and competition variation. The source attribution/logo is included in the app; no raw event data is bundled.

Spatial priors use the same sample's 2734 non-penalty shots and 250 goals, excluding shootouts and own goals:220 inside(88%),30 outside(12%),208 in the central six-yard-width corridor(83.2%). The user's 85/15 goal-location mix is the design reference, not the pooled source result or an enforced quota. Six zones preserve actual box and six-yard landmarks. Relative conversion and goal-mouth geometry influence chance selection and execution. See `app/data/goal-location-reference.json` and `app/goal-zones.js`.

Rates are research baselines, not event schedules. Match profiles adjust attacking support, passing-read windows, decisions and finishing for the short formats; neither counters nor score deficits cause an event. Foul and offside totals depend on the contacts and runs that actually happen. Lower action volume means short games contain fewer whistles than real 90-minute games. Default scoring aims for three total goals on average in each continuous format, with substantial natural variation. The short profile uses more precise deliveries, quicker decisions, less hesitation over a good box shot, and adjusted finishing. Attributes and pressure still determine delivery error. Player and ball speeds have no duration multiplier. No model forces a draw, desired score or prescribed location share.

## Verification and reproduction

The v13 league/type/badge integration sample ran eight complete matches: each AI difficulty at both 180 and 300 seconds, with autonomous AI formation selection before and after the draft. All drafts had 22 unique players and one GK per team; every match finished with finite state and retained types/badges through config roundtrips. `tests/league-integration-results.json` records the exact seeds, protocol, source hashes and outcomes. Reproduce with `node tests/league-integration.mjs /tmp/football-league-integration.json`. This is integration verification, not a new win-rate calibration.

The historical v12 draft/AI calibration used execution handicaps that are now removed. It used 24 deterministic three-minute games per difficulty (96 total), twelve human-first and twelve AI-first drafts. The automated human surrogate drafts with the Medium selection policy and keeps Balanced tactics at 3; the AI drafts and coaches at its chosen difficulty. This is a reproducible strategy comparison, not a measured population of human players. Draws are separate from wins.

| Difficulty | Human wins / draws / losses | Human win rate | Target |
| --- | --- | ---: | ---: |
| Easy | 20 / 4 / 0 | 83.3% | 80% |
| Medium | 11 / 7 / 6 | 45.8% | 50% |
| Hard | 4 / 3 / 17 | 16.7% | 20% |
| Impossible | 0 / 0 / 24 | 0% | 5% |

The first three historical estimates were close to their targets. They have not been re-established for league-constrained drafts and the new badge system. Impossible's 5% target remains unverified: this sample produced no human wins and little human scoring. Twenty-four games cannot establish a precise win rate. All games completed with finite player state and unique draft rosters. `tests/ai-calibration-results.json` retains the protocol, source hashes, difficulty parameters, seeds, per-match outcomes and uncertainty intervals. Run `node tests/ai-calibration.mjs /tmp/football-ai-calibration.json` on the v12 source revision to reproduce the full profiles, configurations, histories and results. These observations are never loaded by the game.

```sh
node --test tests/*.test.mjs
node tests/calibrate.mjs 32 8001
python tests/research-goal-locations.py /tmp/flow-goal-reference
python tests/research-rules.py /tmp/flow-rule-reference
```

Tests cover deterministic matches, regulation and seeded added time, resource-dependent physical motion, keeper handling/outlets, control and attribute effects, geometric offside, restart exemptions, referee involvement, penalty setup/extension, shot attribution, soft tags, multiple-defender take-ons, marking stability, low-tempo forward preference, pause/resume timing and complete chronological highlights. Statistical results are stored in `tests/calibration-results.json`; they are observations, never production inputs or target-rate correction tables.

The v16 regression suite passes all 126 checks and covers draft uniqueness and alternating turns, ten formations, continuous hidden identities, badge effects and tier ranges, both locked draws, D/F bypass, club squad assignment, AI tier eligibility and the 82+ floor, competitive editing rules, preserved half-time identities, and identical execution formulas across every difficulty. Existing checks also cover half-time freeze/recovery, edited second-half highlights, final-shot/celebration completion, bell-curve added time, and physical restart setup. Historical v14 integration used eight bounded matches (the four difficulties then available at both continuous lengths) finish with valid motion, stats, identities and an interactive half-time. These are functional checks, not a balance study. Page IDs, assets, local module imports and syntax pass source checks; browser visual testing was not performed.

Historical v11 neutral random-lineup samples use the expanded 1,100-player catalog and seeds beginning 42501. The five-minute check uses 16 matches; the three-minute check uses 24. The exact commands, parameters, rosters and per-match counts are in `tests/format-calibration-results.json` and the reproducible runner `tests/format-calibration.mjs`.

| Historical v11 sample | 5 min | 3 min |
| --- | ---: | ---: |
| Mean total goals |2.31|2.42|
| Mean shots |6.13|4.50|
| Mean off-target shots |2.81|1.17|
| Shots on target |46.9%|57.4%|
| Goals inside box |94.6%|74.1%|
| Pass completion |77.8%|79.0%|
| Outfield stamina before half-time |50.4%|50.4%|
| After recovery |65.4%|65.4%|
| At full-time |10.3%|11.0%|

The tweaks increase box-shot willingness and reduce finishing hesitation. Five-minute scatter is 0.44 → 0.50, with a small keeper-save adjustment (−0.30 → −0.35); three-minute scatter is 0.28 → 0.34. Increased spread offsets the accuracy benefit of fresher early-match legs. Normal physical pace, long-shot selection, passing error and spatial priors are unchanged. Longer restart setups and new stamina also affect opportunities, so these small samples do not establish an isolated causal change in shot counts. Source order produces uneven player quality and can change the match distribution. Individual stamina remains workload-dependent and can finish outside 5–15%; no final value or score is assigned.

The earlier engine with the same expanded catalog is captured in `tests/format-calibration-baseline.json` (16 paired seeds per format). It averaged 2.06/2.13 goals and used too much energy before half-time (28% → 33% recovery). Historical samples below used older catalogs or default synthetic squads and are not directly comparable.

The v8 engine reference passed all 85 regression checks, including actual delivery/shot outcomes for the new attributes, acceleration, unfamiliar-position performance, fluidity/offside behavior, halftime recovery, profile persistence and the compiler. Static checks verify page IDs, local assets, module imports and syntax. These are source/event/engine checks; no browser visual testing was performed.

Forty-eight independent seeds (31501–31548) per continuous format, with paired default squads, Balanced style and all four tactics at 3, produced:

| Historical v8 observation |5 minutes|3 minutes|
| --- | ---: | ---: |
| Mean total goals |3.00|2.96|
| Median total goals |3|3|
| Median team pass completion |75.0%|76.7%|
| Median match pass completion |74.6%|76.7%|
| Aggregate pass completion |74.9%|76.6%|
| Goals inside box |88.2%|83.1%|
| Shots on target |57.4%|67.7%|
| Mean outfield stamina at full time |10.5%|10.7%|
| Outfield finishes within 5–15% |99.9%|98.4%|
| Mean keeper stamina at full time |23.4%|23.5%|

The detailed-rating update uses a small delivery-scatter multiplier adjustment, 0.60→0.50, to keep neutral passing near the existing target. Completion still depends on detailed skill, distance, pressure, weak foot, fatigue, receiving control and interception. No targets are enforced. The source's first 100 players are a biased test catalog, so these balance measurements use the established paired default squads, not a claim about every possible real-player lineup. Per-match results and exact counts are in `tests/ratings-calibration-results.json`; earlier calibration files below describe historical engine versions.

Historical v6 validation, before the passing adjustment and detailed-rating update, used 48 independent matches per format, with paired default squads and neutral tactics. Five-minute seeds 21501–21548 averaged 2.90 goals (median 3), 58.8% of shots on target, 88.5% of goals inside the box, and 8.63% squad stamina remaining. Three-minute seeds 25501–25548 averaged 2.69 goals (median 2.5), 64.1% on target, 78.3% inside, and 9.29% squad stamina remaining. Combined: 2.79 total goals per match, 83.6% of 268 goals inside the box, and 8.96% stamina. Outfield players averaged 5.7%; keepers retained about 41%. These are finite-sample observations around the three-goal design target, not quotas or a guaranteed score. That revision passed all 65 regression checks.

The historical v7 targeted passing adjustment changed only the five-minute delivery-scatter multiplier from 1 to 0.60. Passing ability, distance, pressure, tempo, fatigue and weak foot still determine execution error; decisions, defense, physical speeds, finishing and completion accounting are unchanged. Repeating the same 48 five-minute seeds raises median match completion from 71.2% to 75.1% (median team completion 75.6%; aggregate 75.5%). Forward passes remain 67.7% of attempts, mean and median total goals are both 3, and mean squad stamina is 8.63%. The unchanged three-minute reference has 76.8% median match completion. Highlights and Instant inherit the five-minute adjustment. Results and per-match counts are in `tests/passing-calibration-results.json`; 46 relevant engine and rules/decision regression checks passed after this change.

A separate eight-seed comparison against the previous engine sampled dangerous off-ball runners every 0.5 seconds. Nearby goal-side coverage improved from 29.3% to 76.9%. Definitions and counts are in `tests/defense-comparison-results.json`; the sample compares the complete versions, including tactical/finishing changes. The pause-button checks exercise the real clock and match with mouse, touch, pen, native keyboard/assistive clicks, cancelled presses, outside release and repeated gestures. These are event/engine checks; no browser visual testing was performed.

The random-lineup update passed 39 focused assignment, compiler, control and replay checks and leaves match physics and ability formulas unchanged. Assignment checks cover all nine formation pairings, distinct identities, keeper allocation, global proficiency optimization, repeatable seeds, varied draws, isolated catalog data and preservation through Instant. The historical neutral-squad balance figures above are not guarantees for randomly drawn real-player teams.

## Match presentation update

Both draft spinners use a continuous horizontal reel with a fixed center marker and an eased stop on the already-resolved draw. Animation consumes no draft RNG, cancels when leaving the draft, respects reduced motion, and settles correctly if the viewport changes. The AI opponent card shows the actual club name, tier and kit colors; that club name carries into the match. Feed markers, goal accents, score-line ratings and match-stat bars/numbers follow the selected team colors. The feed has slightly more height and larger type.

TV mode presents the pitch, fading receipt names and stats. It uses native fullscreen when permitted, otherwise fills the browser viewport; Escape or Exit TV mode exits. Opening the final report exits fullscreen first. Field proportions and match timing are unchanged.

The 84+ Impossible floor applies to natural and assigned overall with at least 97% position familiarity. The current catalog has 122 eligible profiles and valid XIs in all ten formations. Unchanged saved 82+ defaults upgrade once; customized limits and replay settings are preserved. Difficulty continues to affect squad selection and coaching, with identical execution formulas in every mode.

To export the complete shipped player/club catalog, hidden preferences, compilation evidence and exact opening draw probabilities, run `node scripts/export-catalog-audit.mjs /tmp/football-draft-audit`. Odds are normalized from the same production helpers, with AI opponent removals and later-pick renormalization explained. The export checks player uniqueness, probability sums and all ten Impossible formations.

Player movement uses a 1.28 speed multiplier and 1.10 acceleration multiplier: a pace/acceleration/stamina-70 player at full match stamina crosses the usable pitch in about 12–13 seconds, including acceleration and sprint-reserve depletion. The same movement applies in every format. Shooting willingness is 1.24 and pass speed is 1.08 to support build-up at the quicker movement pace; scoring still emerges from chance quality and execution. Existing unchanged device defaults upgrade when the old commentary settings are loaded, while customized values and replay physics are retained.

A descriptive paired check across 8 seeds in each of 3- and 5-minute formats (half mirrored catalog squads, half mirrored default squads) found 6.44 → 8.31 shots and 2.63 → 3.44 goals per match, with 12–15% mean final outfield stamina. This is a small calibration sample, not an enforced rate or predicted score for drafted teams. Pooled pass completion was 72.5%; player quality, pressure and tactics still matter.

Superstar begins at natural OVR85 (Stars80–84). Recompiled badges keep Superstars at5–7 and Stars at3–5; badge progression scales across each tier’s rating range. In budget drafts, unpicked players blocked only by budget remain in the selected club/league rankings as disabled gray cards, including search and position filters. Draw eligibility still guarantees at least one selectable player.

Each human drafter has one league re-spin and one team re-spin for the entire draft. A successful re-spin consumes one credit and excludes the current result; a league re-spin clears the club, while a team re-spin retains the league. Invalid, exhausted or single-result requests spend nothing. Credits are independent in PvP. The UI locks every action while the existing reel animation resolves.

Re-spins apply a single relative weight multiplier before renormalizing eligible outcomes: slightly better ×1.20, moderately better ×1.15, much better ×1.05. Equal or worse results keep their ordinary weights. Clubs compare unrounded median top-ten OVR: positive gains up to3, over3 through7, and over7. Leagues compare the assigned A/B/C/D/F tier: one, two, or three-plus steps better; a stronger Opta score within the same tier counts as a slight improvement. Tier always takes precedence over league strength. Each re-spin compares against the result it replaces; bonuses do not carry into normal spins or stack onto the saved club/league weight. The config page exposes the boosts and bucket cutoffs.

Reel presentation uses the ordinary catalog pool, with only disabled baseline weights and unavailable catalog leagues removed. Budget, position and hidden reveal rules only constrain the landing result. The animation mix has its own deterministic state and does not depend on the chosen result or consume draft RNG. A single valid result still uses the same full-pool reel and duration; idle/settled neighbors also come from that normal pool. There is no guarantee label, styling, filtered reel, or shortened animation revealing the private rule.

Internal reveal pacing records **separate resolved player-pool draws**, once per tier and per human: Financial Takeover targets two Superstar opportunities and three Star opportunities; Budget and PvP retain three and five. These are the only tier guarantees. Once the targets are met, every eligible outcome uses ordinary weighted odds, including re-spin bonuses. A club showing five Superstars counts once; drawing it again counts as another opportunity. Re-renders and locked-result reads never count again, while a genuine team re-spin does. League draws count only when they directly reveal players (D/F); A/B/C count the club result. From the fourth pick, unmet usable targets condition the weighted draw on eligible pools. Filled budget tickets stop that tier's targeting, including tickets consumed by lower-tier replacements. Budget limits and remaining positions take priority; full XIs always finish and impossible custom-catalog targets fall back to valid draws. This rule has no in-game label, notice, odds readout or Config control.

The v22 role recalibration retains all detailed inputs and 14% ST heading weight, sharing the attacking wide-role weights across LW/RW/LM/RM. Positive constrained fits used source FC26 overalls for calibration with player ID modulo five held out, followed by small conservative role offsets. Runtime overall uses only abilities, role weights/offsets and position familiarity, without a hidden correction or copied source overall. All 6,633 profiles were recompiled; their abilities, tendencies, positions, identity and feet are unchanged. There are 75 Superstars at85+. Mean absolute rounded OVR error falls from1.013 to0.456 (held-out players0.452). Yamal is88, Olmo84 and Joan García83. See `tests/overall-v22-calibration.json`.

A-league base weight is36 (previously39). Within A leagues, only the extra club strength above the A-team floor receives an80% multiplier before exponentiation. Lower club tiers and B/C league club weights keep their existing curve; the boundary is continuous. League and club overrides still apply. Unchanged saved defaults upgrade once, preserving custom weights and original replay tuning.

Receipt names hold at their default opacity for0.5 seconds, then fade smoothly over0.75 seconds, including while the player is hovered. Superstar selection cards have two staggered full-card sparkle layers; budget-locked cards remain gray and still, and reduced-motion preferences disable animation.

Budget replacement confirmations show the player, the higher slot being consumed and how many of that slot remain. Cancel, Escape and leaving the draft preserve the pick, budget, draw and RNG. Repeated clicks cannot commit twice. The engine also rejects an unconfirmed replacement. The budget meter tracks consumed tickets separately from actual player tiers; shared Normal/Bench capacity is the remainder of eleven after the configured upper-tier slots. Higher-tier players cannot use cheaper tickets.

## Targeted quality, lane decisions, and badge update

Runtime execution uses `clamp(70 + (baseAbility − 70) × qualityImpact + badgeBonus, 1, 99)`, with `qualityImpact = 1.00` after the v41 moderation (previously 1.08). The 70-rating baseline and all displayed attributes, overall formulas, player tiers and team tiers remain unchanged. The setting is exposed under gameplay; difficulty still cannot alter execution.

A safe progressive carry checks opponent arrival times at two points along the next touch. It bypasses possession-duration passing urgency, while a materially better, high-completion through ball remains available. Existing close finishes, good box deliveries, and pressured passing stay intact. Pressers approach the goal-side shoulder; markers keep pace with a moving target rather than braking as though it were stationary. Run cushions include a small adjustment for a runner's velocity and speed advantage. No goal targets, duration profiles, global pace multipliers, or tackle rates changed.

League re-spins are available only before a club is resolved on the current pick. Resolving the team immediately locks the league re-spin in both the UI and draft model. Unused league credit stays available on a later pick; D/F draws still permit a league re-spin because they have no team spin.

Six new badges: Slalom, Press Escape, Give & Go, Late Arrival, Overlap Engine, and Backline Anchor. Inference combines detailed abilities with relevant hidden tendencies and role eligibility. Press Proven maps to Press Escape, Trickster to Slalom, and Tiki Taka supplies additional combination-play evidence. Give & Go extends the post-pass run; Late Arrival delays midfield support before joining; Press Escape considers retreating out of pressure; other tendencies shape take-ons, runs, overlaps and defensive restraint. Aerial badges affect box-run preferences and Long Ball favors safe switches. The full and lightweight catalogs were regenerated from the same source rows, preserving player identity, base ratings and badge tier limits.

A bounded comparison used six identical lineup seeds per continuous format before and after this update (`tests/v25-targeted-balance.json`). Combined mean goals were 3.08 before and 2.92 after. Five-minute means were 3.17 → 3.50 goals and 10.50 → 10.67 shots; three-minute means were 3.00 → 2.33 goals and 5.50 → 4.83 shots. Six games per format are too few to establish a scoring rate; the sample checks for gross drift, and no scoring compensation or quotas were applied. Targeted regression cases cover safe carrying, stronger through-ball alternatives, closed lanes, both defensive directions/halves, badge style effects, unchanged roster ratings, re-spin credit preservation, and AI short-format/half-time continuity.

Draft position locks apply in both the match model and UI: player swaps, formation changes and best-position fitting unlock only at half-time and relock when the second half starts. Drafted player replacements remain unavailable. AI opponent lineups remain under AI control. Normal team instructions and badge editing keep their existing access rules. The lock follows competition mode through match resets, duration changes and replay imports.
