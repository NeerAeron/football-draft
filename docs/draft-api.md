# Draft API (`app/core/draft/`)

Pure logic for the draft screens, the opponents and the competitions: no DOM, no storage,
deterministic for a seed.

| Module | What it gives you |
| --- | --- |
| `session.js` | `createDraftSession`, `restoreDraftSession` (spins; World Cup drafts: an era and a nation per spin, the respins, the Prime), `TOKENS`, `buildSide`, `matchSetup`, `applyMatchSetup`, `DRAFT_MODES`, `DIFFICULTIES`, `DIFFICULTY_LABELS`, `NATURAL_FIT`, `seedNumber` |
| `links.js` | `teamLinks(players)`, `chemValues(players)`, `linkBoosts(rules)`, `captainSlot(players)` — mates (chemistry) and the Captain |
| `budget.js` | the player tiers (Superstar / Star / Starter / Normal / Bench) and Budget mode's slots: `budgetBands`, `bandIndex`, `bandUse`, `freeLabel`, `draftTiers`, `tierOfRating`, `BUDGET_TIERS` |
| `opponents.js` | the difficulty ladder: `pickOpponent`, `chooseOpponent`, `buildOpponent`, `opponentCandidates`, `ladderPreview`, `ladderTarget`, `ladderBaseline`, `MODE_BASELINES`, `LEVELS` |
| `pools.js` | catalog index (playable nations, field/pots, reel, leagues, clubs), `draftSquad` (`nation.squad`), `bestEleven`, cached `roleRating`/`roleFit`/`naturalRating`, `catalogStamp` |
| `nation-codes.js` | nationality → flag code fallback when the catalog has no `nations` table |

Input is a decoded catalog (`loadCatalog()` in the browser, `loadRuntimeCatalog()` in Node):
`players[]` with `profileId, name, primaryPosition, secondaryPositions, attrs, tags, source:
{club, clubId, leagueId, nationality}`, `leagues[]`, `teams[]`, optional `nations[]` (`{name,
code, flag}`; without it nations are grouped from `source.nationality`). Club-less national
players (`clubId`/`leagueId` null) appear in nation pools only.

## Modes and rules

| Mode (`mode`) | One spin lands on | Pool | Odds (shown on the reel) |
| --- | --- | --- | --- |
| `nations` + `eras: true` — **World Cup drafts** (the run, the Daily) | an era, then a nation of that era (two reels, one press) | that nation's squad of that era: ≤ 26, each at his best version of the cycle, no rating minimum (`eraPool`), less the people taken | all eras equal, then the era's nations equal; never shown |
| `nations` (default) | a nation of the reel: every playable nation (56) and 7 star nations, 63 in all | its draft squad: the nation's best 30 of the players shown 65+ (3 GK, ≥ 9 DEF, ≥ 9 MID, ≥ 5 ATT, then by OVR; fewer when the nation has fewer), less the players taken — it never refills | uniform 1/63 |
| `leagues` | a league (41 usable) | the whole league | flat by tier A 4 · B 2 · C 1 · D 0.5 · F 0.25 |
| `clubs` | a league, then a club (two reels, one press) | the club squad (≥ 11 players a draft may offer: 472 of the 553 clubs) | league A 12 · B 4 · C 1 · D 0.5 · F 0.25, club S 4 · A 3 · B 2 · C 1 · D 0.5 · F 0.25 |

Three modes (`DRAFT_MODES`; `draftModeOf(id)` reads anything else as `nations`). The fourth,
Club & Country, is gone: a session, a saved draft, a saved run or a link in it is refused
('Unknown draft mode', 'Not a saved run', an invalid link) and the UI reads it as nothing saved.

Every pick is one spin. **Tokens** per drafter are the same on every `difficulty`
(`DIFFICULTIES`: `pro`, `worldclass`, `legendary`; any other id is an unknown difficulty):
`CONFIG.draft.tokens` = `{ nation: 1, era: 1, prime: 1 }`. A draft of today's players (Quick
Match, Versus) has the `nation` token as its **re-roll** (or `rerolls: n` — Versus chooses 0–2):
`reroll()` spins again without the options seen this round. A World Cup draft has all three
(below). The per-difficulty `draft.rerolls` and `draft.primes` are gone; the ladder still reads
the baseline column each level was measured against (`ladderBaseline(mode, level)`: Pro the
two-re-roll column, the others the one-re-roll column) until it is re-measured.
No reveal pacing. **Dead-end guard**: an option whose pool cannot fill
any open slot class (the GK slot vs outfield slots) gets weight 0 — so a keeper is always
available when only the GK slot is left. All numbers live in `CONFIG.draft` (`pickMinimum`, `nations`,
`leagueTierWeights`, `clubs`, `tokens`, `ladder`, `links`, `budget`); a session snapshots them at creation.

**Only players shown 65+ are offered** in a draft of today's players (`draft.pickMinimum`, `selectable(p, minimum)` in
`pools.js`): a player is in a draft's pools only when the rating on his card — his natural
rating, rounded — is 65 or more. One rule, in `DraftSession.available()`: nation squads,
league and club pools, `suggestPick` / Auto-pick and every guard go through
it, so a spin lands only where a 65+ player can fill an open slot class (only the keeper slot
left: a 65+ keeper) and no row under 65 is ever listed. **A World Cup draft asks nobody**: its
session's minimum is 0, an era pool is a squad of 26 whatever its players are rated. Budget
tiers are not asked. **Teams are not drafts**:
opponents' XIs (nations, clubs, bosses), club squads and ratings, a nation's strength,
`playable` / `field`, the ladder and Exhibition sides keep their real players whatever they are
rated. Today 10,968 of the 15,788 players are selectable (961 of 1,719 keepers); the smallest
nation squads are Armenia 9 and Egypt 11 (one playable nation, Guinea, has no keeper of 65+,
so it never lands for the keeper slot), the smallest club pools 11. A session's
rules carry the minimum (0 offers everyone). The UI says nothing about it.

**A nation has at most 30 draftable players** in a draft of today's players (`draftSquad(players, rules)` in `pools.js`,
stored as `nation.squad` in the index; numbers in `CONFIG.draft.nations`: `squadSize` 30,
`squadGoalkeepers` 3, `squadDefenders` 9, `squadMidfielders` 9, `squadAttackers` 5). Of the
players shown 65+: the best three keepers, the best nine defenders, nine midfielders and five
attackers, then the best four outfield players left (natural OVR; ties by id). The squad is
fixed for a catalog and rules — it does not depend on the draft — and a nation spin's pool is
the squad less the players taken or excluded: it shrinks and never refills from deeper in the
nation. Every nation guard counts only these players, the star-nation rule counts them
(`reelPlayers`). Leagues and clubs
offer everyone shown 65+. Teams are not drafts: `nation.players`, a nation's strength, its XI as
an opponent and `playable` use everyone. In a World Cup draft the era pool of 26 takes the
squad's place.

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

## World Cup drafts: an era and a nation per spin (session option `eras: true`)

The game: the World Cup Run's draft (normal and Budget) and the Daily — not Quick Match, Versus
or Exhibition, which draft today's players as above. Needs `catalog.eras` (the session throws
'This draft needs the era data' without it; so does `primes` alone) and `mode: 'nations'`.

```js
const draft = createDraftSession(catalog, { seed, eras: true, primes: true, difficulty });
const spin = draft.spin();
// { category: 'nation',
//   era: { id: 2002, name: 'Korea/Japan 02', short: 'Korea/Japan 02', from, to, weight, probability },
//   option: { id: 'Brazil', name, code, flag, strength, weight, probability },
//   reels: [{ category: 'era', options: [8 eras], landing },
//           { category: 'nation', options: [the era's nations], landing }],
//   side, round, reroll, scheduled }
draft.respinBlocked('nation');   // '' | 'Spin first' | 'No nation respin left' | 'No other nation'
draft.respin('nation');          // the era stays, another nation: + respin: 'nation', spun: [false, true]
draft.respinBlocked('era');      // '' | 'Spin first' | 'No era respin left' | 'No other era'
draft.respin('era');             // another era: + respin: 'era', kept, spun: [true, !kept]
draft.primeOptions(0);           // who has a better version, and what it would make him
draft.prime(slot, 0);            // the Prime: he becomes his best version across all titles
```

- **The spin.** The era reel holds the eight eras of `ERAS` (`name` = the full label for
  headers, `short` = the one for a reel or a chip — never hard-code a label); the nation reel
  holds `eraNations(catalog, era)`. Both are **weighted** (`draft/reels.js`, numbers in
  `CONFIG.draft.reels`, never shown in the UI) by "the rule of fun": famous, deep squads come
  up more often than a one-star or no-star squad, nobody is shut out, and the greatest stay
  an event.
  - A nation: `q(r) = (r − 72) / 20` clamped to 0…1 on the shown ratings of its pool;
    `score = 5·q(2nd best) + 3·q(3rd) + 2·q(4th) + 1·q(mean of 5th–8th) + 1·q(best) +
    2.5·(players / 26)`; `weight = 1 + 4 · (score / 14.5)² · rarity`, where `rarity` is 0.25 for
    a squad whose best is shown 93+ (an all-timer) and 1 otherwise. Weights run from 1 to 5:
    the likeliest nation of an era is 3–4 times as likely as the least likely (Italy 5.5% …
    Hungary 2.0% in France 98; France 2.6% … Cabo Verde 0.8% in 2026).
  - An era: `1 + 0.25 · (nations / 70) + 0.25 · q(median of its nations' best players)`: 11.1%
    (France 98) to 12.9% (2026).
  - Measured per draft of eleven spins (`node tools/calibration/reel-odds.mjs`; `--uniform` for
    the reference): a squad with an all-timer once every 6 drafts (uniform: every 4.9), a 90+
    player on offer in 2.3 spins (1.6), 85+ in 5.6 (4.4), 80+ in 9.9 (9.4); a squad whose
    fourth best is 80+ in 6.3 spins (5.0).
  An option that cannot be landed on has weight 0 (below); the guards only ever zero a weight.
  Respins and the Daily's schedule draw with the same weights. The spin carries honest
  `weight` / `probability` like every reel. One spin consumes two draws of the RNG (era, nation).
- **The pool** is `eraPool(catalog, era, nation)` less the people taken or excluded: ≤ 26, each
  at his best version inside the era's years, **no rating minimum**; it never refills. Pool
  entries and slot players carry `era` (the era id), `year` (the year of that version's
  ratings; today's catalog players 2026) and `edition`; `history[]` carries `era` and
  `eraName`. A catalog player in the 2026 pool is the catalog object itself (his Captain tag,
  his club); an era card (`ea:<id>:fc<edition>:era`) is never a Captain and is a club mate
  through the club of that version when the catalog has it.
- **One person once** (`personId`): a man is in an XI once across eras and versions — taken
  with any card of his, he is out of every pool, guard and placement ('Already drafted');
  `excludePlayers` takes out every version of each id's person; the run's opponents exclude
  `baseProfileId` of your players (the catalog player of an era card, `eraOf`), and the Prime
  swaps a card for another of the same person.
- **Never a dead end.** A nation is on the reel only when its pool has an available — in
  Budget mode affordable — player for an open slot class; an era only when it has such a
  nation. With only the keeper slot left that means a nation (and an era) with an available
  keeper. **A pool may have no keeper at all** (the data does not require one): *while the
  keeper slot is open beside others, at least half of the nations on the reel have an available
  keeper* — every nation with one is on the reel, and keeper-less nations stay only as many as
  there are of those, the strongest first (the reel's order, deterministic); the rest have
  weight 0 for that spin. Both respins go through the same reels. `uniqueNations` counts a
  nation once whatever the era. Brute force: `tests/draft-eras.test.mjs` (five policies ×
  Budget on/off × 30 seeds, respins late in the draft, seven pools in ten stripped of keepers).
- **Tokens** (`TOKENS` = `['nation', 'era', 'prime']`; `snapshot().tokens` = per kind
  `{ perSide, left, can }` for the side to act, `era` / `prime` null when the draft has none):
  - **nation respin** — the era stays, the nation is drawn again without the ones seen in this
    era this round; only the nation reel moves (`spun: [false, true]`);
  - **era respin** — another era (not one seen this round) is drawn; **the nation stays when
    the new era's reel has it** (it is there and can be landed on: `kept: true`, `spun: [true,
    false]`), otherwise the nation is drawn too (`kept: false`). The UI shows which reels move;
  - **the Prime** — `bestVersion(catalog, player)`: the card of the same person that shows the
    most across all titles, any gain; `primeOption(slot)` → `{ slot, profileId, name, from:
    { ovr, rating }, to: { profileId, ovr, rating, edition, year, position, tier }, allowed,
    reason }` (`rating` = in that slot; a best version may play another position, so
    `to.rating` can be lower while `to.ovr` is higher — still allowed), null when no card of
    his shows more. `prime(slot)` swaps the card in (its own attributes, positions, badges,
    club and year; an era card is not a Captain), marks him (`slots[i].player.prime`,
    `history[].primeOf`, `state.primed`), and is not reversible. Usable at any time after he
    is drafted until the draft is handed on. Budget mode never refuses it and it uses no slot:
    he keeps the tier slot of the version that was drafted.
  One of each per side, on every difficulty; a token does not come back. `rerollsLeft`,
  `eraRespinsLeft`, `primesLeft` per side are in the state and in `teams[i]`.
- **A schedule** (the Daily): `schedule.rounds[i] = { era, spin, alternate, eraAlternate:
  { era, nation } }` fixes the round's era and nation, the nation a nation respin lands on
  (in the scheduled era) and where an era respin lands (the nation stays when it can, else
  `eraAlternate.nation`). A scheduled landing the guards do not allow is drawn from the RNG
  instead (`spin.scheduled` false).

Measured (`draft-baselines.mjs --eras --primes default --n 200 --modes nations --rerolls 0,1
--policies positional --budget "off;default"`: 200 drafts, pick the best player; respins when
the best pick is under 78, the nation first; the Prime on the biggest gain in the slot):

| World Cup draft | OVR (sd) | chem | effective | captain | tokens used |
| --- | --- | --- | --- | --- | --- |
| no tokens | 83.55 (1.48) | 0.38 | 83.93 | 4% | — |
| the three tokens | 84.58 (1.34) | 0.41 | **84.99** | 4% | nation 0.75 · era 0.47 · Prime 0.96 (+3.7 slot points) |
| Budget, no tokens | 82.71 (1.24) | 0.35 | 83.06 | 3% | — |
| Budget, the three tokens | 83.56 (1.18) | 0.36 | **83.92** | 3% | nation 0.88 · era 0.67 · Prime 0.97 (+3.8) |

Against the draft before (Legend spin, re-rolls by difficulty, Prime boosts: effective 84.77 /
85.05 with 1 / 2 re-rolls, Budget 82.86 / 83.12): about the same without Budget, about a point
more in Budget mode; mates are rarer (eleven picks from 500 era pools: chem 0.4 against 0.9),
a Captain rarer still (only today's cards are Captains). `MODE_BASELINES` and `CUP_TUNING`
were not touched.

## Eras (`app/core/players/eras.js`) — the data of the two-spinner draft

A pick's pool is **"nation X in era Y"**: that nation's best 26 players of the era, each at his
best version inside the era's years. The data is `app/data/eras.v1.json` (one file, columnar,
`core/players/eras-codec.js`; fetched by `services/eras.js` `loadEras()` when a draft opens —
never on Home; in slices, `decodeErasSteps` + `attachErasSteps` driven by `stepped()`: 12,486
cards, 2.4 MB, 0.71 MB gzip / 0.56 MB brotli), attached to the catalog like the legends.
Everything below is synchronous and pure once attached. In Node: `attachEras(await
loadRuntimeCatalog(), decodeEras(JSON.parse(readFileSync(PATHS.eras))))`;
`node tools/research/era-report.mjs [era nation]` prints the summary or one pool.

```js
import {
  ERAS, eraById, eraOfYear, attachEras,
  eraList, eraNations, eraPool, eraPlayer, eraOf,
  personId, personVersions, bestVersion,
} from '../players/eras.js';
import { baseProfileId } from '../players/legends.js';
```

**Eras** are World Cup cycles, named by their tournament; `year` is the year of a card's
ratings (a title's launch ratings: the year before its number).

| `id` | `label` | `from`–`to` | titles |
| --- | --- | --- | --- |
| 1998 | France 98 | 1997–1998 | FIFA 98, 99 |
| 2002 | Korea/Japan 02 | 1999–2002 | FIFA 2000–2003 |
| 2006 | Germany 06 | 2003–2006 | FIFA 2004–07 |
| 2010 | South Africa 10 | 2007–2010 | FIFA 08–11 |
| 2014 | Brazil 14 | 2011–2014 | FIFA 12–15 |
| 2018 | Russia 18 | 2015–2018 | FIFA 16–19 |
| 2022 | Qatar 22 | 2019–2022 | FIFA 20–23 |
| 2026 | USA/Canada/Mexico 26 | 2023–2026 | FC 24, 25, 26 and today's catalog (FC 27) |

Every era is named by its hosts. Each also has **`short`** — the same text, except
`USA/CAN/MEX 26` for 2026 (14 characters; the longest is `South Africa 10`, 15). **Use `short`
wherever the label shares a line or sits in a fixed box** (the era reel, chips, pool rows, the
pick summary at 390 px) **and `label` where it has a line of its own** (the pool header, a
sentence, the share text).

- `ERAS` — the table above, oldest first: `[{ id, label, short, from, to }]` (static: no data
  needed).
  `eraById(id)`, `eraOfYear(year)` → the era object or `null`.
- `attachEras(catalog, data)` → the catalog, with `catalog.eras` set (idempotent). `data` is
  `decodeEras(file)`. A file built for another catalog build still attaches: cards of people
  the catalog does not know are simply nobody's other version.
- `eraList(catalog)` → `[{ id, label, short, from, to, keeperLevel, nations: [{ name, code,
  flag, strength, size, keepers }] }]`, oldest era first, an era's nations strongest first.
  **Only spinnable nations are listed** (20–70 per era, see below). `name` is the catalog's
  nation name (`code`/`flag` as in `catalog.nations`; a nation today's catalog does not have —
  none at the moment — would have `code: null`). `size` = players in the pool (≤ 26),
  **`keepers` = how many of them are goalkeepers: 0 to 3 — a spinnable pool may have none.**
  `strength` = the mean shown rating of the pool's best XI (best keeper + the ten best
  outfielders, one decimal): the number to weigh or order a reel by. A pool without a keeper
  is rated with the era's `keeperLevel` in goal — the weakest first-choice keeper any
  qualifying pool of that era has (71 / 63 / 62 / 61 / 58 / 53 / 58 / 53), i.e. the least a
  keeper drafted from that era would be: no invented player, and such a nation is never
  rated above what it could field.
- `eraNations(catalog, eraId)` → that era's `nations` array (`[]` for an unknown era).
- `eraPool(catalog, eraId, nation)` → the pool: an array of ≤ 26 players, best first (shown
  rating, then the later year, then the id), **the same frozen array every call**;
  `[]` when the nation is not spinnable in that era. No minimum rating. Balance where the data
  has the players: 3 keepers, at least 7 defenders, 7 midfielders and 4 forwards (lines as
  `LINE_OF` in `draft/pools.js`), the rest by rating.
- `eraPlayer(catalog, profileId)` → an era card by id (also the cards kept only as someone's
  best version), or `null`.
- `eraOf(player)` → the era id a player was drafted from: `player.era`, 2026 for a catalog
  player.

**An era card** is shaped like a catalog player (so `overallRating`, `playerTier`, Links,
`buildSide`, the engine and the UI take it as it is):

```js
{
  profileId: 'ea:1397:fc3:era',   // 'ea:<EA id>:fc<edition>:era'; unique; edition 98, 99, 0–26
  era: 2002, year: 2002, edition: 3,
  name, fullName, primaryPosition, secondaryPositions, attrs, foot, weakFoot, tendencies, tags,
  sourceOverall,                  // the overall of that version on the common scale
  captain: false,
  person: 'ea:1397',              // one person, whatever the card (see below)
  eraOf: 'ea:…:fc27:u…' | undefined, // the catalog player's profileId when he is in the catalog
  source: { club, clubId, leagueId, nationality }, // the club of that version when the catalog
                                  // has it (EA team id) — else null; nationality = catalog name
  inference: { badges },
}
```

**The 2026 era** (USA/Canada/Mexico 26) is today's catalog plus the FC 24–26 versions of the same people: a player's
2026 card is his best of the four titles (ties: the latest). When that is today's card, the
pool holds **the catalog player object itself** (`catalog.byId` identity: no `era`, no `year`);
otherwise an era card with `eraOf` = his catalog profileId. People who left the game after FC
24–26 have era cards only.

**One person is one person.** `personId(player)` → a stable key (`'ea:<EA id>'`) for any
player object — catalog player, era card, legend, prime version: the same man has the same key
in every era and in the catalog (two EA ids of one man are merged by the compiler). An XI
holds a person once: compare `personId`. `baseProfileId(player)` (from `legends.js`) still
gives the catalog player's profileId for a prime, a legend version **and an era card of a
catalog player** (`eraOf`), so existing "is he already picked / excluded" code keeps working
for people in the catalog; for people outside it use `personId`.
`personVersions(catalog, player)` → his cards in era order (`[]` if he has none; for a catalog
player the list ends with the catalog object when it is his 2026 card).

**Prime** = a drafted player's best version across all titles, any gain:
`bestVersion(catalog, player)` → the era card of the same person that shows the most (ties:
the latest year), or `null` when no card of his shows more than `player` does. It works for
every drafted player — "Brazil 2002 Ronaldinho" → Ronaldinho ’05; a catalog player → his best
past card. The card may come from an era in which he is not in his nation's 26 (it is kept in
the file for this). Swap it in place of the drafted player: same person, its own positions,
attributes, badges, club and year (`editionLabel(card)` → "’05").

**Which nations can be spun in an era** (decided by the compiler, `ERA_SPIN` in
`scripts/compile-legends.mjs`, recorded in the file's `selection`): a nation whose pool has at
least 18 players, at least 5 defenders, 5 midfielders and 2 forwards (counted before a second
striker is settled as a striker or a No. 10: a pool can end with 4 midfielders or 1 forward) —
**a goalkeeper is not required**; if more than 70 qualify, the 70 strongest; an era needs at
least 20 (the build fails otherwise). As built:

| era | nations | pools under 26 | fewer than 3 keepers | no keeper | strongest | weakest |
| --- | --- | --- | --- | --- | --- | --- |
| France 98 | 27 | 8 (18–25) | 6 | — | England 82.7 | Hungary 70.9 |
| Korea/Japan 02 | 54 | 7 | 15 | Ghana, China PR | Brazil 86.9 | China PR 69.6 |
| Germany 06 | 62 | 3 | 13 | Guinea | Brazil 89.7 | China PR 71.0 |
| South Africa 10 | 70 | 9 | 21 | Mali, Peru, Algeria, Honduras, Congo DR | Brazil 88.5 | New Zealand 66.5 |
| Brazil 14 | 70 of 84 | 0 | 13 | Honduras | Spain 89.3 | Guinea 71.4 |
| Russia 18 | 70 of 98 | 1 | 5 | — | Spain 88.5 | Bulgaria 73.9 |
| Qatar 22 | 70 of 100 | 1 | 5 | Gabon | France 87.9 | South Africa 74.5 |
| USA/Canada/Mexico 26 | 70 of 99 | 1 | 5 | Egypt | France 88.4 | North Macedonia 73.9 |

**What changed for the draft (keeper rule dropped, 2026 renamed)** — against the first build:

1. `eraList(...).nations[i].keepers` can be **0** (10 of the 493 era–nation pools; listed
   above). `eraPool` of such a nation has no `GK` at all. Nothing else about a pool changed:
   still ≥ 18 players, best first, frozen.
2. The data no longer guarantees a keeper per landing: **the draft must** — while the keeper
   slot is open, at least half of the nations a spin can land on must have `keepers > 0`; when
   the keeper is the only slot left, only nations with `keepers > 0` may be landed on. Every
   era has plenty (27 / 52 / 61 / 65 / 69 / 70 / 69 / 69 pools with a keeper).
3. Nation counts moved: Korea/Japan 02 52 → 54, Germany 06 61 → 62, South Africa 10 65 → 70;
   the 70-nation eras swapped a few of their weakest (more qualify, the cap is the same).
4. `strength` of a keeperless pool uses `era.keeperLevel` (see `eraList`); pools with a keeper
   are rated as before.
5. Era 2026: `label` is `USA/Canada/Mexico 26` (was `2026`), and every era has `short`. The id
   (2026), `CURRENT_ERA` and the years did not change.

Things a draft should know about the data:

- **The early eras are lower at the top.** FIFA 98–2003 have coarse scales (8–16 levels): a
  card of those years is rated by what the titles within three years say about the player
  together with the title's average, so it stays nearer the average — Zidane ’98 and
  Ronaldo ’98 are 88, Ronaldo ’00 92, and France 98's best XIs are in the low 80s. Their Prime (the fully
  described 2003–04 versions) is where those players reach 90+. A reel that weighs by
  `strength` will favour later eras unless it weighs inside an era.
- **France 98 is thin**: 27 nations, no Brazil-size depth outside Europe and Argentina/Brazil
  (FIFA 98/99 use their own player ids and mostly surnames: a player counts only when
  FIFA 2000–03 know him by name and club, or by name, national team and part of the pitch). Japan, Mexico, the United States or Nigeria of 1998 are not spinnable.
- A pool can have 0, 1 or 2 keepers, and as few as 18 players.
- 7,334 people are in a pool; 3,455 of them in two or more eras (Messi in six). 601 best
  versions are kept outside the pools for the Prime.

The draft reads only the era file: `catalog.legends` (`legends.v1.json`) is no longer loaded
by the game.

## Flow

```js
import { createDraftSession, restoreDraftSession, matchSetup, applyMatchSetup } from './core/draft/session.js';

const draft = createDraftSession(catalog, {
  mode: 'nations',           // 'nations' | 'leagues' | 'clubs'
  seed: 123456,              // required: number or string. Never Math.random() inside core.
  sides: 1,                  // 2 = local versus: a seeded coin toss picks who drafts first
  formation: '433',          // or formations: ['433', '4231'] per side
  difficulty: 'pro',         // the opponent ladder's id (the tokens are the same on each)
  rerolls: undefined,        // re-rolls (nation respins) per side; default rules.tokens.nation
  hideRatings: false,        // data flag only ("Ball Knower"): the UI hides numbers
  uniqueNations: false,      // each nation at most once per side
  budget: false,             // Budget mode: tier caps (see below)
  eras: false,               // a World Cup draft: an era and a nation per spin (needs catalog.eras)
  primes: null,              // the Prime: true (rules.tokens.prime) | a number | none
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

draft.snapshot().pool;                // the spin's players, best fit first (see below)
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
  eras, primes, tokens,               // see "World Cup drafts" above
  phase: 'spin' | 'pick' | 'complete', complete, first, turn,
  pickIndex, totalPicks, round,       // picks made overall / needed; the side's round 0–10
  category,                           // what the next/current spin draws: nation | league | club
  spin,                               // as returned by spin(), or null
  rerolls: [left per side], canReroll,
  pool: [{                            // the current spin's players, best open-slot fit first
    profileId, name, fullName, position, secondary, ovr, tier, nation, nationCode,
    club, clubId, league, leagueId,   // tier: 'Superstar' | 'Star' | 'Starter' | 'Normal' | 'Bench'
    band,                             // Budget mode: 'superstar' | 'star' | 'starter' | null (free)
    captain, prime, era, edition, year, primeVersion,
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
  history: [{ side, round, slot, role, profileId, category, optionId, optionName, leagueId, rerolls,
              era?, eraName?, primeOf? }],
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
not stack). A **GOAT** (an era card flagged `goat`: one of the few greatest of all time, in
his year) gives **every player +1.5** (`links.goat`) — more than a Captain, and felt in
matches: +1.5 effective is about +5 points of title odds on World Class in the fast model (8%
→ 13% at the typical XI; Pro 18% → 25%, Legendary 6% → 9%). A second GOAT adds half of that
(+0.75), a third a quarter (`goatBoost(count, value)`); a Captain and a GOAT in one XI both
count (a card is never both). The sum is the player's `chem` (attribute points the engine
adds to every skill), **capped at 5** (`CHEM_CAP`).

`teamLinks(players)` (players in slot order, `null` = open slot) returns
`players[i] = { boost, kinds, chem, mates: { nation, club } }` (`boost` = the mates boost,
`kinds` = what gives it, `chem` = boost + the Captain's and the GOATs' boosts (at most 5), `mates` = number of XI mates per
kind), `pairs: [{ a, b, kind, kinds }]` (every pair of nation or club mates — one line per pair
for the pitch, `kind: 'nation'` when they share the nation), `score` (sum of the mates boosts,
max `maxScore` = 27.5), `total` (sum of `chem`, Captain included: the UI's "Boosts +13"),
`chem` (mean chem), `linked` (players with a mate), `captain` (slot of the armband or null:
`captainSlot(players)`, the highest source rating among the Captains, first slot on a tie) and
`captainBoost`. `goats` (the slots of the GOATs, `goatSlots(players)`) and `goatBoost` (what they
give every player). `linkBoosts(rules)` gives the three numbers; `validLinks(rules)` says whether a rules
object has them (a saved run must: `restoreCupRun`). Real national XIs are all nation mates (+1.5
each, +2.5 for club mates inside them, +1 with their captain), real club XIs club mates. A pool
entry's `boost` says what a player would get in the XI as it stands, `captainBoost` what he
would give it.

**Captains** are a reviewed list of real national-team captains, current players only
(`data/captains.json`: name, sofifa id, nation, source URL, reason, ranked leaders first). The
compiler tags its first `size` (10) players — van Dijk, Kimmich, Modrić, Kane, Messi, Son,
Marquinhos, Xhaka, Koulibaly, Robertson — and fails when an id, name or nation does not match
the catalog. The size was cut so that about one drafted XI in three had a captain when World
Cup drafts spun today's players; in an era draft only the 2026 cards can be Captains (an era
card never is), so a World Cup XI has one in about 4% of drafts — see the table under "World
Cup drafts". Opponents with a captain get the boost too.

`MODE_BASELINES` (Nations 83.58 / 84.04 / 84.18 with 0 / 1 / 2 re-rolls) is the draft of
today's players; a World Cup draft with its tokens measures 84.99 (above).

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

Gap (`CONFIG.draft.ladder`): Pro 0 · World Class +4 ·
Legendary +7, using the re-roll count of that difficulty. Candidates: the best XI of every
playable nation (Nations), club XIs (Leagues, Clubs), plus bosses **World XI** (88.5)
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
history, the tokens left and who was primed, plus `catalog: catalogStamp(catalog)`. Restore throws if a saved
player is missing from the catalog — a World Cup draft holds era cards (`ea:<id>:fc<edition>:era`) and needs
`catalog.eras` attached first; compare the stamp with `catalogStamp(catalog)` to warn about a changed
database. Restored sessions continue with identical spins. `SESSION_FORMAT` is 3 (the rules
of this version: era drafts and their tokens, a nation's draft squad, the pick minimum, the named tiers, mates and the
Captain, three difficulties and modes): anything else — an older format, no rules — throws 'Not
a saved draft session'. There is one cut-off and no conversion of older saves.

## Determinism contract

Same catalog + options + rules + seed + sequence of `spin`/`reroll`/`pick` calls ⇒ the same
spins. Only those calls (`respin` included) consume the RNG (one draw per reel; a scheduled/daily spin
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
costs — in a World Cup draft the shown rating of the era card. The Prime is free (the player keeps the
slot of the version that was drafted).

- A player whose tier is full is not available: pool entries carry `band` (`'superstar'`,
  `'star'`, `'starter'` or `null` = free), `available: false` and `reason: 'No Star slot
left'`; `placementOptions` gives the same reason, `pick` refuses, `suggestPick` (Auto-pick)
  skips him. `affordable(player, side)` is the check.
- `snapshot().budget` is the flag; `teams[i].budget` is `[{ id, label, range, minimum, slots,
used, left }]` (`label: 'Star'`, `range: '84–87'`; or `null`). Helpers: `budgetBands(rules)`,
  `bandIndex`, `bandUse`, `freeLabel` ('Under 80').
- Never a dead end: the spin guard also needs an affordable player for an open slot class. A
  nation's pool is its draft squad as always (the stars you cannot afford are listed, closed);
  nobody is added from deeper in the nation, so a nation whose squad has nobody you can
  afford for an open slot class is off the reel for that spin — France, Spain, Brazil, England
  and Germany have no outfield player under 80 in their 30, Italy three. In a World Cup draft
  the same guard runs on the era pools of 26 (and the keeper counted for the keeper-share rule
  must be affordable).
- Serialised with the session (`options.budget`, `rules.budget`: the three named tiers).
- The game offers it in the World Cup Run only (`context.options.budget` → run
  `meta.budget`).

Measured: the table under "World Cup drafts" — a Budget XI is about one effective point weaker
than a normal one.
