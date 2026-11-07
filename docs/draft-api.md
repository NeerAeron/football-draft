# Draft API (`app/core/draft/`)

Pure logic for the new draft screens: no DOM, no storage, deterministic for a seed. The legacy
`Draft` class (`draft.js`) still serves the legacy UI and is not used here.

| Module | What it gives you |
| --- | --- |
| `session.js` | `createDraftSession`, `restoreDraftSession`, `buildSide`, `matchSetup`, `applyMatchSetup`, `DRAFT_MODES`, `DIFFICULTIES`, `DIFFICULTY_LABELS`, `NATURAL_FIT`, `seedNumber` |
| `links.js` | `teamLinks(players)`, `chemValues(players)` — Links (chemistry) |
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

Every pick is one spin. Re-rolls per drafter by `difficulty`: Amateur 2 · Semi-pro 2 · Pro 1 ·
World Class 1 · Legendary 0 (or `rerolls: n`). A re-roll spins again without the options seen
this round. No reveal pacing, no budget. **Dead-end guard**: an option whose pool cannot fill
any open slot class (the GK slot vs outfield slots) gets weight 0 — so a keeper is always
available when only the GK slot is left. All numbers live in `CONFIG.draft` (`nations`,
`leagueTierWeights`, `clubs`, `rerolls`, `ladder`, `links`); a session snapshots them at creation.

Players already drafted (by either side) and excluded players/nations/clubs never appear in a
pool. Seeds are mixed before use, so consecutive seeds (dates, counters) give unrelated spins.

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
  mode, modeLabel, difficulty, sides, hideRatings, uniqueNations, daily,
  phase: 'spin' | 'pick' | 'complete', complete, first, turn,
  pickIndex, totalPicks, round,       // picks made overall / needed; the side's round 0–10
  category,                           // what the next/current spin draws: nation | league | club
  spin,                               // as returned by spin(), or null
  rerolls: [left per side], canReroll,
  pool: [{                            // the current spin's players, best open-slot fit first
    profileId, name, fullName, position, secondary, ovr, tier, nation, nationCode,
    club, clubId, league, leagueId,
    best: { slot, role, rating, familiarity, delta },  // best open slot (delta vs natural)
    naturalSlots,                     // open slots with familiarity >= 0.95
    available, reason,                // false + 'Goalkeeper slot filled' etc.
  }],
  teams: [{                           // one per side
    side, name, color, secondary, formation, filled, complete, rerollsLeft,
    rating, lines: { DEF, MID, ATT },  // team OVR meters (mean slot ratings, 1 decimal)
    slots: [{ slot, role, x, y, line, player, rating, familiarity, link }],
    links: { score, maxScore, chem, linked, pairs, levels },
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
`'Goalkeepers only'`, `'Outfield players only'`, `'Not this side’s turn'`,
`'The draft is complete'`. Light up `allowed` slots; mark `familiarity < NATURAL_FIT` (0.95)
as out of position.

## Links (chemistry)

`teamLinks(players)` (players in slot order, `null` = open slot):
per player, count XI players sharing the club / nation / league (the player included):
club 2 / 5 / 8, nation 2 / 5 / 8, league 3 / 5 / 8 → +1 / +2 / +3 each; the link **level** is
the sum capped at 3; team **Links** = sum of levels (0–33); engine **chem** = level / 3 × 2
(0–2 attribute points, added in `Player.skill` by the engine). `pairs: [{ a, b, kind, kinds }]`
list linked pairs (indexes into the XI) for drawing lines — `kind` is the strongest shared link
(club > nation > league). Real club and national XIs are fully linked (33, chem 2).
Measured typical drafted XI: chem ≈ 0.6 (Nations), 0.4 (Leagues), 0.35 (Clubs); a link-chasing
drafter gains ≈ +0.15 chem for −0.1 OVR, i.e. Links are a tiebreaker, not a strategy trap.

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
drafted XI (`MODE_BASELINES`, measured with `tools/calibration/draft-baselines.mjs`: 240
solo drafts per mode × re-roll count, positional policy):

| Mode | OVR (Pro) | chem | effective with 0 / 1 / 2 re-rolls |
| --- | --- | --- | --- |
| Nations | 82.90 ± 1.03 | 0.64 | 83.06 / 83.54 / 83.68 |
| Leagues | 81.45 ± 1.77 | 0.40 | 81.14 / 81.85 / 82.44 |
| Clubs | 77.73 ± 1.69 | 0.34 | 77.59 / 78.06 / 78.40 |
| Club & Country | 82.30 ± 1.46 | 0.41 | 82.17 / 82.71 / 83.24 |

Gap (`CONFIG.draft.ladder`): Amateur −7 · Semi-pro −3.5 · Pro 0 · World Class +4 ·
Legendary +7, using the re-roll count of that difficulty. Candidates: national best XIs
(Nations), club XIs (Leagues, Clubs), both (Club & Country), plus bosses **World XI** (88.5)
and **All-Stars** (87.3, the best XI without the World XI). Real XIs carry +2 chem, so a
national XI of 81.5 OVR is a fair Pro opponent for an 82.9 draft. Nations examples:
Amateur ≈ Ireland/Kosovo/Paraguay, Semi-pro ≈ Poland/Austria/Japan, Pro ≈ Belgium/Uruguay/
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
