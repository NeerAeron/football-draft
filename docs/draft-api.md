# Draft API (`app/core/draft/`)

Pure logic for the draft screens, the opponents and the competitions: no DOM, no storage,
deterministic for a seed.

| Module | What it gives you |
| --- | --- |
| `session.js` | `createDraftSession`, `restoreDraftSession`, `buildSide`, `matchSetup`, `applyMatchSetup`, `DRAFT_MODES`, `DIFFICULTIES`, `DIFFICULTY_LABELS`, `NATURAL_FIT`, `seedNumber` |
| `links.js` | `teamLinks(players)`, `chemValues(players)`, `linkBoosts(rules)` — mates (chemistry) |
| `budget.js` | the player tiers (Superstar / Star / Starter / Normal / Bench) and Budget mode's slots: `budgetBands`, `bandIndex`, `bandUse`, `freeLabel`, `draftTiers`, `tierOfRating`, `BUDGET_TIERS` |
| `opponents.js` | the difficulty ladder: `pickOpponent`, `chooseOpponent`, `buildOpponent`, `opponentCandidates`, `ladderPreview`, `ladderTarget`, `MODE_BASELINES`, `LEVELS` |
| `pools.js` | catalog index (nations field/pots, leagues, clubs), `callUps`, `bestEleven`, cached `roleRating`/`roleFit`/`naturalRating`, `catalogStamp` |
| `nation-codes.js` | nationality → flag code fallback when the catalog has no `nations` table |

Input is a decoded catalog (`loadCatalog()` in the browser, `loadRuntimeCatalog()` in Node):
`players[]` with `profileId, name, primaryPosition, secondaryPositions, attrs, tags, source:
{club, clubId, leagueId, nationality}`, `leagues[]`, `teams[]`, optional `nations[]` (`{name,
code, flag}`; without it nations are grouped from `source.nationality`). Club-less national
players (`clubId`/`leagueId` null) appear in nation pools only.

## Modes and rules

| Mode (`mode`) | One spin lands on | Pool | Odds (shown on the reel) |
| --- | --- | --- | --- |
| `nations` (default) | a nation of the field: the 48 strongest nations with ≥ 23 players and ≥ 2 GK (best-XI rating), shown in 4 pots of 12 | best 23 available call-ups: 3 GK, ≥ 7 DEF, ≥ 7 MID, ≥ 4 ATT, then by OVR; refills as players are taken | uniform 1/48 |
| `leagues` | a league (40 usable) | the whole league | flat by tier A 4 · B 2 · C 1 · D 0.5 · F 0.25 |
| `clubs` | a league, then a club (two reels, one press) | the club squad (≥ 11 players) | league A 12 · B 4 · C 1 · D 0.5 · F 0.25, club S 4 · A 3 · B 2 · C 1 · D 0.5 · F 0.25 |
| `clubAndCountry` | alternately a nation (picks 1, 3, 5…) and a league (2, 4, 6…) | as above | as above |

Every pick is one spin. Re-rolls per drafter by `difficulty` (`DIFFICULTIES`: `pro`, `worldclass`,
`legendary`): Pro 2 · World Class 1 · Legendary 1 (or `rerolls: n`). A removed id (`amateur`,
`semipro`) in a saved draft or a link plays as Pro (`difficultyOf`). A re-roll spins again without the options seen
this round. No reveal pacing. **Dead-end guard**: an option whose pool cannot fill
any open slot class (the GK slot vs outfield slots) gets weight 0 — so a keeper is always
available when only the GK slot is left. All numbers live in `CONFIG.draft` (`nations`,
`leagueTierWeights`, `clubs`, `rerolls`, `ladder`, `links`, `budget`); a session snapshots them at creation.

Players already drafted (by either side) and excluded players/nations/clubs never appear in a
pool. Seeds are mixed before use, so consecutive seeds (dates, counters) give unrelated spins.

**Wildcard nations.** A nation spin lands on the 48-nation field (pots 1–4) or on a wildcard
(pot 5, `index.spinField`): a nation outside the field with at least one player rated
`nations.wildcardStar` (80) and `wildcardPlayers` (9) players — Nigeria, Algeria, DR Congo,
Kosovo, Guinea, Venezuela, Finland, Tunisia, Saudi Arabia, Iceland, Burkina Faso, New Zealand,
Egypt, Gabon, Armenia. They are spun, never met as opponents (most have no two keepers in the
data, which is why they are not in the field).

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
  phase: 'spin' | 'pick' | 'complete', complete, first, turn,
  pickIndex, totalPicks, round,       // picks made overall / needed; the side's round 0–10
  category,                           // what the next/current spin draws: nation | league | club
  spin,                               // as returned by spin(), or null
  rerolls: [left per side], canReroll,
  pool: [{                            // the current spin's players, best open-slot fit first
    profileId, name, fullName, position, secondary, ovr, tier, nation, nationCode,
    club, clubId, league, leagueId,   // tier: 'Superstar' | 'Star' | 'Starter' | 'Normal' | 'Bench'
    band,                             // Budget mode: 'superstar' | 'star' | 'starter' | null (free)
    boost,                            // the mates boost he would get in this XI:
                                      // { value: 1.5, kinds: ['nation'] } | null (no mate)
    best: { slot, role, rating, familiarity, delta },  // best open slot (delta vs natural)
    naturalSlots,                     // open slots with familiarity >= 0.95
    available, reason,                // false + 'Goalkeeper slot filled', 'No Star slot left' etc.
  }],
  teams: [{                           // one per side
    side, name, color, secondary, formation, filled, complete, rerollsLeft,
    rating, lines: { DEF, MID, ATT },  // team OVR meters (mean slot ratings, 1 decimal)
    slots: [{ slot, role, x, y, line, player, rating, familiarity, link }],
    links: { score, maxScore, total, chem, linked, pairs,
             boosts },                // boosts: per slot, the mates boost (null = open)
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
`'Spin first'`, `'Already drafted'`, `'Not in this pool'`, `'Slot filled'`,
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

## Mates (chemistry)

One rule (`links.js`, numbers in `CONFIG.draft.links`: `{ nation: 1.5, club: 1 }`): a player
with a **nation team-mate** in the XI gets **+1.5**, with a **club mate +1**, and the two
**stack** (both: **+2.5**). One mate is enough, there are no thresholds and no league mates.
That boost is the player's `chem` (attribute points the engine adds to every skill; the
engine caps it at 5).

`teamLinks(players)` (players in slot order, `null` = open slot) returns
`players[i] = { boost, kinds, chem, mates: { nation, club } }` (`boost` = the mates boost,
`kinds` = what gives it, `chem` = the same number under the engine's name, `mates` = number
of XI mates per kind), `pairs: [{ a, b, kind, kinds }]` (every pair of nation or club mates —
one line per pair for the pitch, `kind: 'nation'` when they share the nation), `score` =
`total` (sum of the boosts, max `maxScore` = 27.5: the UI's "Boosts +7.5"), `chem` (mean
boost), `linked` (players with a mate).
`linkBoosts(rules)` gives the two numbers; rules saved before this rule (thresholds per
kind) read as the defaults, and a saved `captain` number is ignored. Real national XIs are
all nation mates (+1.5 each, +2.5 for club mates inside them), real club XIs club mates (+1,
+2.5 for compatriots). In a Nations draft a nation mate needs the same nation twice — lucky
and strong; club mates are the common boost there. A pool entry's `boost` says what a player
would get in the XI as it stands.
Measured typical drafted XI (300 drafts, 1 re-roll, pick the best player): chem 0.48
(Nations), 0.67 (Leagues), 0.52 (Clubs); with 0 / 2 re-rolls 0.48 / 0.48, 0.61 / 0.71,
0.50 / 0.53. A drafter who also values the boosts gets 0.58 / 1.14 / 0.83 for −0.05 to
−0.3 OVR (effective +0.04 / +0.21 / +0.13). `MODE_BASELINES` still holds the chem of the
old rule (+2 / +2 and a Captain's +1) until it is re-measured.

There is **no Captain** for now: the catalog still carries the `captain` flag (34 players;
`scripts/compile-players.mjs` derives it from international reputation and age) and the codec
keeps it, but nothing reads it — no boost, no mark.

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
Legendary +7, using the re-roll count of that difficulty. Candidates: national best XIs
(Nations), club XIs (Leagues, Clubs), both (Club & Country), plus bosses **World XI** (88.5)
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
history, plus `catalog: catalogStamp(catalog)`. Restore throws if a saved player is missing
from the catalog; compare the stamp with `catalogStamp(catalog)` to warn about a changed
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
`CONFIG.draft.budget` (`Superstar`, `Star`, `Starter`, each `{ minimum, slots }`): **1
Superstar, 2 Stars, 3 Starters**, everyone else under 80 (free). What a row shows is what it
costs.

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

Measured (300 Nations drafts, 1 re-roll; `tools/calibration/draft-baselines.mjs --budget
"off;default" --policies positional,smart`): team OVR 81.23 ± 0.58 (83.13 ± 1.03 without),
chem 0.40 (0.48), effective 81.63 ± 0.67 (83.61 ± 1.11 without) — a Budget XI is 1.98
effective points weaker (2.26 under the old mates rule); the best player of a spin is closed
in 4.5 picks per draft; a drafter who values boosts and saves tier slots for the top of a
tier reaches 81.79 (+0.16; without the budget the same drafter gains +0.04).
