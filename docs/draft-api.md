# Draft API (`app/core/draft/`)

Pure logic for the draft screens, the opponents and the competitions: no DOM, no storage,
deterministic for a seed.

| Module | What it gives you |
| --- | --- |
| `session.js` | `createDraftSession`, `restoreDraftSession` (spins, the Legend spin, Prime boosts), `buildSide`, `matchSetup`, `applyMatchSetup`, `DRAFT_MODES`, `DIFFICULTIES`, `DIFFICULTY_LABELS`, `NATURAL_FIT`, `seedNumber` |
| `links.js` | `teamLinks(players)`, `chemValues(players)`, `linkBoosts(rules)`, `captainSlot(players)` — mates (chemistry) and the Captain |
| `budget.js` | the player tiers (Superstar / Star / Starter / Normal / Bench) and Budget mode's slots: `budgetBands`, `bandIndex`, `bandUse`, `freeLabel`, `draftTiers`, `tierOfRating`, `BUDGET_TIERS` |
| `opponents.js` | the difficulty ladder: `pickOpponent`, `chooseOpponent`, `buildOpponent`, `opponentCandidates`, `ladderPreview`, `ladderTarget`, `MODE_BASELINES`, `LEVELS` |
| `pools.js` | catalog index (playable nations, field/pots, reel, leagues, clubs), `legendIndex`, `callUps`, `bestEleven`, cached `roleRating`/`roleFit`/`naturalRating`, `catalogStamp` |
| `nation-codes.js` | nationality → flag code fallback when the catalog has no `nations` table |

Input is a decoded catalog (`loadCatalog()` in the browser, `loadRuntimeCatalog()` in Node):
`players[]` with `profileId, name, primaryPosition, secondaryPositions, attrs, tags, source:
{club, clubId, leagueId, nationality}`, `leagues[]`, `teams[]`, optional `nations[]` (`{name,
code, flag}`; without it nations are grouped from `source.nationality`). Club-less national
players (`clubId`/`leagueId` null) appear in nation pools only.

## Modes and rules

| Mode (`mode`) | One spin lands on | Pool | Odds (shown on the reel) |
| --- | --- | --- | --- |
| `nations` (default) | a nation of the reel: every playable nation (56) and 7 star nations, 63 in all | best 23 available call-ups: 3 GK, ≥ 7 DEF, ≥ 7 MID, ≥ 4 ATT, then by OVR (fewer when the nation has fewer); refills as players are taken | uniform 1/63 |
| `leagues` | a league (41 usable) | the whole league | flat by tier A 4 · B 2 · C 1 · D 0.5 · F 0.25 |
| `clubs` | a league, then a club (two reels, one press) | the club squad (≥ 11 players a draft may offer: 472 of the 553 clubs) | league A 12 · B 4 · C 1 · D 0.5 · F 0.25, club S 4 · A 3 · B 2 · C 1 · D 0.5 · F 0.25 |
| `clubAndCountry` | alternately a nation (picks 1, 3, 5…) and a league (2, 4, 6…) | as above | as above |

Every pick is one spin. Re-rolls per drafter by `difficulty` (`DIFFICULTIES`: `pro`, `worldclass`,
`legendary`): Pro 2 · World Class 1 · Legendary 1 (or `rerolls: n`). A removed id (`amateur`,
`semipro`) in a saved draft or a link plays as Pro (`difficultyOf`). A re-roll spins again without the options seen
this round. No reveal pacing. **Dead-end guard**: an option whose pool cannot fill
any open slot class (the GK slot vs outfield slots) gets weight 0 — so a keeper is always
available when only the GK slot is left. All numbers live in `CONFIG.draft` (`pickMinimum`, `nations`,
`leagueTierWeights`, `clubs`, `rerolls`, `ladder`, `links`, `budget`); a session snapshots them at creation.

**Only players shown 65+ are offered** (`draft.pickMinimum`, `selectable(p, minimum)` in
`pools.js`): a player is in a draft's pools only when the rating on his card — his natural
rating, rounded — is 65 or more. One rule, in `DraftSession.available()`: nation call-ups,
league and club pools, the Budget extras, `suggestPick` / Auto-pick and every guard go through
it, so a spin lands only where a 65+ player can fill an open slot class (only the keeper slot
left: a 65+ keeper) and no row under 65 is ever listed; the Daily's perfect XI is built from the
same pools. Legends, prime versions and Budget tiers are not asked. **Teams are not drafts**:
opponents' XIs (nations, clubs, bosses), club squads and ratings, a nation's strength,
`playable` / `field`, the ladder and Exhibition sides keep their real players whatever they are
rated. Today 10,968 of the 15,788 players are selectable (961 of 1,719 keepers); the smallest
nation pools are Armenia 9 and Egypt 11 (one playable nation, Guinea, has no keeper of 65+,
so it never lands for the keeper slot), the smallest club pools 11. A draft
saved before the rule has no `pickMinimum` in its rules: it loads and offers everyone. The UI
says nothing about it.

Players already drafted (by either side) and excluded players/nations/clubs never appear in a
pool. Seeds are mixed before use, so consecutive seeds (dates, counters) give unrelated spins.

**Playable nations and the reel.** A nation can field an XI with at least
`nations.minimumPlayers` (11) players, `minimumGoalkeepers` (1) and a best XI with a real keeper
and nobody under the engine's minimum fit (`ai.minimumFit`, no fallback) . The
strongest `nations.playableSize` (56) of them, by that XI, are **playable** (`index.playable`,
strongest first: France … Venezuela, Iceland). Every playable nation is on the reel and can be met
as an opponent (the Pro / World Class ladder, Quick Match, Exhibition). The reel
(`index.spinField`, one pool, all equally likely) adds the **star nations**: nations that are not
playable (no XI, or an XI outside the 56) but have a player shown at `nations.reelStar` (80) or
more and `reelPlayers` (9) players a draft may offer (shown 65+) — Russia, Burkina Faso, Egypt,
Gambia, New Zealand, Costa Rica, Armenia (three of them have no 65+ keeper): spun, never met.
63 nations in all.
`index.field` is the strongest `fieldSize` (48) playable nations in pots of 12: the Daily's
schedule uses it, and it is the fallback of Legendary's draw, which qualifies its own 48 for
every run (`docs/competition-api.md`). A nation with one keeper whose keeper you drafted cannot
field an XI any more: the ladder draws another opponent, the World Cup draw the nearest nation.

**The Legend spin** (session option `legendSpin`; the game: World Cup Run drafts, normal and
Budget — not Quick Match, Versus or the Daily). The side's first spin lands on a nation with a
legend and offers that nation's legends; the other ten spins are ordinary. Legends are the
players of `catalog.legends` (`players/legends.js`, loaded from `app/data/legends.v1.json`):
**best past versions (FIFA 15–23) the game shows at `legends.minimum` (85) or more** — the
rating on the card, its own rating model, never EA's overall. Two kinds, 189 in all:

- 97 **players of the past**, who are not in the catalog (Neymar ’19, Hazard ’19, Bale ’16);
- 92 **current players at their best** (`legendOf` = the catalog player's `profileId`): a
  catalog player's best version when it shows 85+ and more than his card today, however far
  apart the two are (Messi ’19 95 for 89 today; Neuer ’17 92 for 81). A player whose card
  today is his best is just a normal pick.

A player's best version is his highest shown rating (ties: the higher EA overall, then the
latest edition). **One person, one place in an XI**: `baseProfileId(p)` is the catalog id of a
legend or prime version, and the session treats the versions as one player — drafting his
legend version takes his current version out of every pool, the reel guard, placement and the
opponents' XIs (the run excludes `baseProfileId` of your players), and a current version that
is taken or excluded takes the legend version off the Legend spin (a nation whose only legend
he is leaves the reel). A legend version offers no Prime boost: it is his best already.
Rules in `CONFIG.draft.legends`:

- the reel (`legendIndex(catalog).reel`) holds the 39 nations with a legend shown at `reelStar`
  (85) or more; the index filters by the shown rating itself, so nobody under `minimum` is ever
  offered, whatever the file holds;
- a nation's weight is `1 + weightPerLegend (0.15) × min(its legends, weightCap (20))`: 1.15 for
  one legend, 4 for twenty or more (Spain 23 and Brazil 21 legends, 6.0% each; Germany 19, 5.8%;
  France 16, 5.1%; England 12, 4.2%; Italy 11, 4.0%; the sixteen nations with one legend 1.7%
  each). The spin
  carries the honest `weight` / `probability` like every reel; the UI shows no odds for this
  one;
- the pool is the nation's `shown` (10) highest-rated legends (the rating on the card, then the
  name) — one legend for fourteen of the nations; if none of them could be placed (slot class,
  Budget tier), the best that can are shown instead. Never a dead end: a nation without a
  legend who is free, fits an open slot class and (Budget mode) a tier with a slot left has
  weight 0, so in local Versus a one-legend nation leaves the second side's reel once its legend
  is taken. Re-rolls, exclusions, `uniqueNations` (the legend's nation counts) and Budget mode
  (a legend costs the tier of his rating) work as for any spin;
- `spin.legend`, `snapshot().legendRound`, `history[].legend` mark it; a pool entry / slot player
  has `legend: true`, `edition` (15–23) and `year` — **the year of that version's ratings
  snapshot**, stored with the player by the compiler from the source row's date
  (`fifa_update_date`): release ratings are dated the autumn before the edition's number (FIFA
  19: 2018 — every version in the data is one), the last ratings of a cycle the year of the
  number. `editionYear(p)` / `editionLabel(p)` read it; the UI shows "’18", never the edition;
- `snapshot().legendYears` is `[first, last]` year of the legends' versions (`[2014, 2022]`;
  `legendIndex().years`): the Legend spin's one line, "Best versions, 2014–2022".

A legend is a club mate through the club of that edition when the catalog has it (all 189
today) and a nation mate like anyone; he is never a Captain — a current Captain's legend
version neither. 46 legends show 88+, 143 show 85–87; 26 are keepers.

**Prime boosts** (session option `primes: true` = `CONFIG.draft.primes` by difficulty — Pro 2,
World Class 1, Legendary 1 — or a number; the game: World Cup Run drafts). A boost turns a
drafted player into his **prime version** (`catalog.legends.primes`: 2,362 catalog players whose
best version shows 2+ more than their card today, or 88+ and more — the same best version a
current player's legend is): the attributes, positions,
badges and rating of that edition, the same name, nation, club and Captain tag (so mates and
the armband do not change), `profileId` `ea:<id>:fc<edition>:prime`, `primeOf` = his catalog id.

```js
draft.primeOptions(0);       // [{ slot, profileId, name, from: { ovr, rating }, to: { profileId,
                             //    ovr, rating, edition, year, position, tier }, allowed, reason }]
draft.prime(slot, 0);        // { ok: true, side, slot, profileId, primeOf, rating } | { ok: false, reason }
```

`rating` is the rating in that slot — a prime version may play another position, so `to.rating`
can be no higher than `from.rating` while `to.ovr` is (Mkhitaryan at CM: 83 → 78, his ’17
version is an RM 85); the option is still allowed (the pre-match can move him) and the UI says
it. A typical drafted XI has 1.8–1.9 players with a prime version (1.3–1.4 under the old rule:
EA overall 3+ above, 1,963 stored); 60% of XIs have two or more (40%). Usable at any time after he is drafted, until the draft is
handed on (the run is created from `matchSide`); not reversible in core (the UI confirms).
Budget mode never refuses it and it uses no slot: a primed player keeps the tier slot of the
version that was drafted. His current version stays taken (`available` false) and opponents
never field it (`baseProfileId`). `snapshot()`: `primes: { perSide, left }`, `teams[i].primesLeft`,
`slots[i].prime` (the option, or null), and `primeVersion: { profileId, ovr, edition, year,
position }` on pool entries and slot players who have one (a legend version has none).

## Flow

```js
import { createDraftSession, restoreDraftSession, matchSetup, applyMatchSetup } from './core/draft/session.js';

const draft = createDraftSession(catalog, {
  mode: 'nations',           // 'nations' | 'leagues' | 'clubs' | 'clubAndCountry'
  seed: 123456,              // required: number or string. Never Math.random() inside core.
  sides: 1,                  // 2 = local versus: a seeded coin toss picks who drafts first
  formation: '433',          // or formations: ['433', '4231'] per side
  difficulty: 'pro',         // sets re-rolls; the opponent ladder uses the same ids
  hideRatings: false,        // data flag only ("Ball Knower"): the UI hides numbers
  uniqueNations: false,      // each nation at most once per side
  budget: false,             // Budget mode: tier caps (see below)
  legendSpin: false,         // the first spin is the Legend spin (needs catalog.legends)
  primes: null,              // Prime boosts: true (by difficulty) | a number | none
  excludeNations: [], excludeClubs: [], excludePlayers: [], // e.g. a pre-chosen opponent
  teams: [{ name: 'You', color: '#d9f580', secondary: '#16213a' }],
  useDefaultRules: false,    // true: DEFAULT_CONFIG rules (daily, challenge links)
});

const spin = draft.spin();            // phase 'spin' -> 'pick'
// spin = { category: 'nation', option: { id: 'France', name, code: 'fr', flag, pot: 1, strength },
//          league: null,              // clubs mode: the league leg
//          reels: [{ category, options: [{ id, name, weight, probability, ... }], landing }],
//          side, round, reroll: 0, scheduled: false }
// Animate each reel honestly: options with weight > 0 are what could have been drawn; stop on
// reels[i].options[landing]. Use your own animation RNG, never the session's.

draft.snapshot().pool;                // call-ups, best fit first (see below)
draft.placementOptions(profileId);    // per slot: fit numbers and why a slot is closed
draft.autoSlot(profileId);            // { slot, role, rating, familiarity, natural } | null
draft.pick(profileId);                // Auto: best natural slot (familiarity >= 0.95) first
draft.pick(profileId, 7);             // explicit slot, e.g. out of position
// -> { ok: true, side, slot, role, profileId, rating, familiarity } | { ok: false, reason }

if (draft.snapshot().canReroll) draft.reroll(); // instead of picking
```

Loop `spin()` → (`reroll()`)* → `pick()` until `draft.complete`. With `sides: 2` the side to
act is `draft.turn` (alternates after every pick; `snapshot().first` is the coin toss).
Other actions: `draft.suggestPick()` (positional "best pick" for an Auto/skip button or a
hint), `draft.move(side, fromSlot, toSlot)` (swap/move placed players; GK slot keepers only),
`draft.setFormation(side, formation)` (placed players move to their best slots).

### `snapshot()`

Plain JSON, cached until the state changes (treat as read-only):

```js
{
  mode, modeLabel, difficulty, sides, hideRatings, uniqueNations, budget, daily,
  legendSpin, legendRound, legendYears, primes, // see "The Legend spin" and "Prime boosts" above
  phase: 'spin' | 'pick' | 'complete', complete, first, turn,
  pickIndex, totalPicks, round,       // picks made overall / needed; the side's round 0–10
  category,                           // what the next/current spin draws: nation | league | club
  spin,                               // as returned by spin(), or null
  rerolls: [left per side], canReroll,
  pool: [{                            // the current spin's players, best open-slot fit first
    profileId, name, fullName, position, secondary, ovr, tier, nation, nationCode,
    club, clubId, league, leagueId,   // tier: 'Superstar' | 'Star' | 'Starter' | 'Normal' | 'Bench'
    band,                             // Budget mode: 'superstar' | 'star' | 'starter' | null (free)
    captain, legend, prime, edition, year, primeVersion,
    boost,                            // the mates boost he would get in this XI:
                                      // { value: 1.5, kinds: ['nation'] } | null (no mate)
    captainBoost,                     // 1 when he would be the XI's first Captain, else 0
    best: { slot, role, rating, familiarity, delta },  // best open slot (delta vs natural)
    naturalSlots,                     // open slots with familiarity >= 0.95
    available, reason,                // false + 'Goalkeeper slot filled', 'No Star slot left' etc.
  }],
  teams: [{                           // one per side
    side, name, color, secondary, formation, filled, complete, rerollsLeft,
    rating, lines: { DEF, MID, ATT },  // team OVR meters (mean slot ratings, 1 decimal)
    slots: [{ slot, role, x, y, line, player, rating, familiarity, link }],
    links: { score, maxScore, total, chem, linked, pairs, captain, captainBoost,
             boosts },                // boosts: per slot, mates + Captain (null = open)
    budget,                           // Budget mode: [{ id, label, range, minimum, slots, used, left }]
  }],
  history: [{ side, round, slot, role, profileId, category, optionId, optionName, leagueId, rerolls }],
}
```

`x, y` are pitch coordinates from `players/formations.js` (105 × 68 m, attacking right).

### Placement and fit

`placementOptions(id)` returns 11 entries `{ slot, role, rating, natural, delta, familiarity,
allowed, reason }`. `rating` is the OVR in that slot after familiarity (what the slot shows:
"79 → 75" = `natural → rating`, `delta = rating − natural`). `reason` when not allowed:
`'Spin first'`, `'Already drafted'` (he, or another version of him), `'Not in this pool'`, `'Slot filled'`,
`'Goalkeepers only'`, `'Outfield players only'`, `'Not this side’s turn'`, `'No Star slot left'` (Budget mode),
`'The draft is complete'`. Light up `allowed` slots; mark `familiarity < NATURAL_FIT` (0.95)
as out of position.

Familiarity (`positionFamiliarity`, `players/ratings.js`) multiplies the role rating and
follows the steps between positions: 1 at his own position, ~0.997 at a listed secondary one,
0.985–0.999 one step away (CM ↔ DM / AM / LM / RM, LW ↔ LM, wing ↔ wing, AM ↔ ST / wing,
CB ↔ DM / full-back, full-back ↔ wide midfielder, ST ↔ wing), ~0.945 at two steps (CM → CB),
~0.89 at three, 0.6 for an outfielder in goal. It is set against EA's own per-position
ratings: a neighbouring role costs about what EA says (CM → DM −1, ST → AM −5, with the
attribute weights doing most of it), so neighbouring roles count as natural (≥ 0.95) and far
moves stay costly. Club and ladder XIs field a player only at `ai.minimumFit` 0.965 or better
(his own, a secondary or a neighbouring role); the boss XIs at 0.99 (own or secondary).

## Mates (chemistry) and the Captain

One rule (`links.js`, numbers in `CONFIG.draft.links`: `{ nation: 1.5, club: 1, captain: 1 }`):
a player with a **nation team-mate** in the XI gets **+1.5**, with a **club mate +1**, and the
two **stack** (both: **+2.5**). One mate is enough, there are no thresholds and no league
mates. An XI with a **Captain** gives **every player +1** on top (one captain counts; two do
not stack). The sum is the player's `chem` (attribute points the engine adds to every skill,
capped at 5): 0–3.5.

`teamLinks(players)` (players in slot order, `null` = open slot) returns
`players[i] = { boost, kinds, chem, mates: { nation, club } }` (`boost` = the mates boost,
`kinds` = what gives it, `chem` = boost + the Captain's boost, `mates` = number of XI mates per
kind), `pairs: [{ a, b, kind, kinds }]` (every pair of nation or club mates — one line per pair
for the pitch, `kind: 'nation'` when they share the nation), `score` (sum of the mates boosts,
max `maxScore` = 27.5), `total` (sum of `chem`, Captain included: the UI's "Boosts +13"),
`chem` (mean chem), `linked` (players with a mate), `captain` (slot of the armband or null:
`captainSlot(players)`, the highest source rating among the Captains, first slot on a tie) and
`captainBoost`. `linkBoosts(rules)` gives the three numbers; rules saved before the mates rule
(thresholds per kind) read as the defaults, and rules saved while the game had no Captain
(`{ nation, club }`) keep playing without one. Real national XIs are all nation mates (+1.5
each, +2.5 for club mates inside them, +1 with their captain), real club XIs club mates. A pool
entry's `boost` says what a player would get in the XI as it stands, `captainBoost` what he
would give it.

**Captains** are a reviewed list of real national-team captains, current players only
(`data/captains.json`: name, sofifa id, nation, source URL, reason, ranked leaders first). The
compiler tags its first `size` (10) players — van Dijk, Kimmich, Modrić, Kane, Messi, Son,
Marquinhos, Xhaka, Koulibaly, Robertson — and fails when an id, name or nation does not match
the catalog. The size is cut so that about one drafted World Cup XI in three has a captain:
measured with `draft-baselines.mjs --legend --primes default --captains N` (400 drafts, pick the
best player; 1 / 2 re-rolls): 8 → 29% / 33%, **10 → 32% / 35%**, 12 → 35% / 38%, 15 → 44% / 49%,
20 → 65% / 69%. The tag goes with a player into his prime version; legends are never captains.
Opponents with a captain get the boost too.

Measured typical World Cup XI (300 drafts, pick the best player, the 93-nation reel; 1 / 2
re-rolls = World Class and Legendary / Pro), effective = OVR + chem:

| Draft | OVR | chem | effective | captain |
| --- | --- | --- | --- | --- |
| no legend, no primes | 80.25 / 80.68 | 0.63 / 0.71 | 80.88 / 81.39 | 36% / 40% |
| + Legend spin (the legend plays at 87.0) | 80.79 / 81.20 | 0.60 / 0.67 | 81.39 / 81.87 | 31% / 34% |
| + Prime boosts, spent on the biggest gain (0.78 / 1.17 used, +2.7 / +3.5 slot points) | 81.04 / 81.53 | 0.60 / 0.67 | **81.64 / 82.20** | 31% / 34% |
| Budget, no legend, no primes | 79.69 / 80.02 | 0.57 / 0.61 | 80.26 / 80.63 | 31% / 33% |
| Budget + Legend spin | 80.08 / 80.37 | 0.49 / 0.53 | 80.58 / 80.91 | 23% / 25% |
| Budget + Legend spin + Prime boosts | 80.32 / 80.68 | 0.49 / 0.53 | **80.81 / 81.21** | 23% / 25% |

`MODE_BASELINES` is older than all of this (the 48-nation reel, no Captain, no legends: Nations
83.61 with one re-roll) and is due a re-measure: the reel of every playable nation alone costs
about 2 OVR.

The table above is from before the legends of current players, the +2 prime rule and the 65+
pick minimum. With them (`draft-baselines.mjs --legend --primes default --budget "off;default"`,
200 drafts, 1 / 2 re-rolls; before → after): normal effective 84.57 → 84.75 / 84.94 → 85.06,
Budget 82.73 → 82.86 / 82.97 → 83.12; the legend plays at 87.7 → 88.7; players with a prime
version per XI 1.36 → 1.85 (Budget 1.29 → 1.88); Prime boosts used 0.73 → 0.89 / 1.09 → 1.45. `MODE_BASELINES` and
`CUP_TUNING` were not touched.

## Match setup

```js
const home = draft.matchSide(0);      // { name, short, color, secondary, formation, players,
                                      //   rating, effective, links, kind, id, code }
const away = pickOpponent(catalog, { mode: 'nations', level: 'pro', seed,
                                     excludePlayers: home.players.map(p => p.profileId) });
const match = new Match(seed, 180);
match.importConfig(applyMatchSetup(match.exportConfig(), matchSetup(home, away), { mode: 'ai' }));
```

`players` are catalog clones with `slot`, `role` and `chem`. `matchSetup` puts home first and
swaps the away kit to its secondary colour on a clash (nations have `color: null` and a flag
`code`; give them a kit in the UI). `buildSide({ name, color, secondary, formation, players })`
makes the same side object from any XI (exhibition teams, tests).

## Opponents and difficulty

A level is a target **effective rating** (team OVR + mean chem) relative to the mode's typical
drafted XI (`MODE_BASELINES`, measured with `tools/calibration/draft-baselines.mjs`: 300
solo drafts per mode × re-roll count, positional policy; the table is from before the
+1.5 / +1 mates rule and is due a re-measure — under the new rule the same drafts give
83.20 / 83.61 / 83.75 (Nations), 81.62 / 82.31 / 82.91 (Leagues), 77.98 / 78.49 / 78.89
(Clubs)):

| Mode | OVR (Pro) | chem | effective with 0 / 1 / 2 re-rolls |
| --- | --- | --- | --- |
| Nations | 82.89 ± 1.07 | 1.52 | 83.92 / 84.41 / 84.59 |
| Leagues | 81.47 ± 1.72 | 1.33 | 82.10 / 82.80 / 83.39 |
| Clubs | 77.71 ± 1.71 | 0.87 | 78.03 / 78.58 / 78.98 |
| Club & Country (no longer offered) | 82.30 ± 1.46 | 0.41 | 82.17 / 82.71 / 83.24 |

Gap (`CONFIG.draft.ladder`): Pro 0 · World Class +4 ·
Legendary +7, using the re-roll count of that difficulty. Candidates: the best XI of every
playable nation (Nations), club XIs (Leagues, Clubs), both (Club & Country), plus bosses **World XI** (88.5)
and **All-Stars** (87.3, the best XI without the World XI; `bosses: false` in `chooseOpponent`
/ `modeCandidates` leaves them out, as the World Cup Run and the Daily do). Real national XIs carry +1.5 chem or more, club XIs +1 or more (club mates in a national XI and compatriots in a club XI get +2.5). Nations examples:
Pro ≈ Belgium/Uruguay/
Croatia/Switzerland, World Class ≈ Brazil/Spain/France/England, Legendary ≈ World XI.

```js
pickOpponent(catalog, { mode, level, seed, offset = 0, avoid = [], excludePlayers = [] })
// -> side + { key: 'nation:France', target, nominal, flag }
chooseOpponent(catalog, { mode, level, seed, offset, avoid })  // reference only, no XI
buildOpponent(catalog, ref, { excludePlayers })                // XI without those players
opponentCandidates(catalog)        // every team with an XI: { key, kind, id, name, code, flag,
                                   //   color, secondary, formation, rating, chem, effective }
ladderPreview(catalog, mode)       // per level: { id, label, target, examples: [5 teams] }
```

Selection: uniform (seeded) among candidates within ±1.5 of the target, widened in 0.5 steps
until three qualify. Build opponents **after** the draft with the user's players excluded (a
national XI fields its best available players — "you took their star").
Exhibition: pick any two `opponentCandidates` entries and `buildOpponent` both.

## Persisting a draft

```js
localStorage.setItem('draft', JSON.stringify(draft.serialize()));  // ~3–8 KB
const again = restoreDraftSession(catalog, JSON.parse(localStorage.getItem('draft')));
```

`serialize()` holds options, the rules snapshot, RNG state, picks (ids), the current spin and
history, the Prime boosts left, plus `catalog: catalogStamp(catalog)`. Restore throws if a saved
player is missing from the catalog — a draft with a legend or a primed player needs
`catalog.legends` attached first; compare the stamp with `catalogStamp(catalog)` to warn about a changed
database. Restored sessions continue with identical spins.

## Determinism contract

Same catalog + options + rules + seed + sequence of `spin`/`reroll`/`pick` calls ⇒ the same
spins. Only those three calls consume the RNG (one draw per reel; a scheduled/daily spin
consumes none). For shareable runs (daily, challenge links) use `useDefaultRules: true` so the
device's config cannot change the odds.

## Player tiers and Budget mode (`budget.js`, session option `budget: true`)

**Tiers.** A player is a **Superstar** (rated 88+), a **Star** (84–87), a **Starter**
(80–83), a **Normal** (74–79) or a **Bench** player by the OVR shown on him (his rounded
natural rating). The top three start at `CONFIG.draft.budget[tier].minimum`; `draftTiers()`
lists all five, `tierOfRating(rating, bands)` names one, and pool entries / slot players
carry it as `tier`. The UI's frames, outlines and pick celebrations use the same tiers
(`ui/lib/tiers.js`). They are separate from `CONFIG.playerTiers`, which only sets how many
badges a player carries (stamped into the catalog) and is not shown to the player.

**Budget mode** is a harder draft: the XI may hold only so many players per tier —
`CONFIG.draft.budget` (`Superstar`, `Star`, `Starter`, each `{ minimum, slots }`): **2
Superstars, 2 Stars, 3 Starters**, everyone else under 80 (free). What a row shows is what it
costs. A legend counts on the tier of his rating; a Prime boost is free (the player keeps the
slot of the version that was drafted).

- A player whose tier is full is not available: pool entries carry `band` (`'superstar'`,
  `'star'`, `'starter'` or `null` = free), `available: false` and `reason: 'No Star slot
left'`; `placementOptions` gives the same reason, `pick` refuses, `suggestPick` (Auto-pick)
  skips him. `affordable(player, side)` is the check.
- `snapshot().budget` is the flag; `teams[i].budget` is `[{ id, label, range, minimum, slots,
used, left }]` (`label: 'Star'`, `range: '84–87'`; or `null`). Helpers: `budgetBands(rules)`,
  `bandIndex`, `bandUse`, `freeLabel` ('Under 80').
- Never a dead end: the spin guard also needs an affordable player for an open slot class, and
  a nation's pool is its usual 23 call-ups (the stars you cannot afford are listed, closed)
  plus the best 23 call-ups you can afford.
- Serialised with the session (`options.budget`, `rules.budget`); old saves have no budget,
  and rules saved with numbered bands (`band1`–`band3`) keep their numbers under the tier
  names.
- The game offers it in the World Cup Run only (`context.options.budget` → run
  `meta.budget`).

Measured: the table under "Mates and the Captain" (`tools/calibration/draft-baselines.mjs
--budget "off;default" --legend --primes default`): a Budget XI is about 0.8–1.0 effective
points weaker than a normal one (it was 2.0 with one Superstar slot and the 48-nation reel).
