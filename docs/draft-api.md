# Draft API (`app/core/draft/`)

Pure logic for the draft screens, the opponents and the competitions: no DOM, no storage,
deterministic for a seed.

| Module | What it gives you |
| --- | --- |
| `session.js` | `createDraftSession`, `restoreDraftSession` (spins, the Legend spin, Prime boosts), `buildSide`, `matchSetup`, `applyMatchSetup`, `DRAFT_MODES`, `DIFFICULTIES`, `DIFFICULTY_LABELS`, `NATURAL_FIT`, `seedNumber` |
| `links.js` | `teamLinks(players)`, `chemValues(players)`, `linkBoosts(rules)`, `captainSlot(players)` — mates (chemistry) and the Captain |
| `budget.js` | the player tiers (Superstar / Star / Starter / Normal / Bench) and Budget mode's slots: `budgetBands`, `bandIndex`, `bandUse`, `freeLabel`, `draftTiers`, `tierOfRating`, `BUDGET_TIERS` |
| `opponents.js` | the difficulty ladder: `pickOpponent`, `chooseOpponent`, `buildOpponent`, `opponentCandidates`, `ladderPreview`, `ladderTarget`, `MODE_BASELINES`, `LEVELS` |
| `pools.js` | catalog index (playable nations, field/pots, reel, leagues, clubs), `legendIndex`, `draftSquad` (`nation.squad`), `bestEleven`, cached `roleRating`/`roleFit`/`naturalRating`, `catalogStamp` |
| `nation-codes.js` | nationality → flag code fallback when the catalog has no `nations` table |

Input is a decoded catalog (`loadCatalog()` in the browser, `loadRuntimeCatalog()` in Node):
`players[]` with `profileId, name, primaryPosition, secondaryPositions, attrs, tags, source:
{club, clubId, leagueId, nationality}`, `leagues[]`, `teams[]`, optional `nations[]` (`{name,
code, flag}`; without it nations are grouped from `source.nationality`). Club-less national
players (`clubId`/`leagueId` null) appear in nation pools only.

## Modes and rules

| Mode (`mode`) | One spin lands on | Pool | Odds (shown on the reel) |
| --- | --- | --- | --- |
| `nations` (default) | a nation of the reel: every playable nation (56) and 7 star nations, 63 in all | its draft squad: the nation's best 30 of the players shown 65+ (3 GK, ≥ 9 DEF, ≥ 9 MID, ≥ 5 ATT, then by OVR; fewer when the nation has fewer), less the players taken — it never refills | uniform 1/63 |
| `leagues` | a league (41 usable) | the whole league | flat by tier A 4 · B 2 · C 1 · D 0.5 · F 0.25 |
| `clubs` | a league, then a club (two reels, one press) | the club squad (≥ 11 players a draft may offer: 472 of the 553 clubs) | league A 12 · B 4 · C 1 · D 0.5 · F 0.25, club S 4 · A 3 · B 2 · C 1 · D 0.5 · F 0.25 |

Three modes (`DRAFT_MODES`; `draftModeOf(id)` reads anything else as `nations`). The fourth,
Club & Country, is gone: a session, a saved draft, a saved run or a link in it is refused
('Unknown draft mode', 'Not a saved run', an invalid link) and the UI reads it as nothing saved.

Every pick is one spin. Re-rolls per drafter by `difficulty` (`DIFFICULTIES`: `pro`, `worldclass`,
`legendary`): Pro 2 · World Class 1 · Legendary 1 (or `rerolls: n`); any other id is an
unknown difficulty. A re-roll spins again without the options seen
this round. No reveal pacing. **Dead-end guard**: an option whose pool cannot fill
any open slot class (the GK slot vs outfield slots) gets weight 0 — so a keeper is always
available when only the GK slot is left. All numbers live in `CONFIG.draft` (`pickMinimum`, `nations`,
`leagueTierWeights`, `clubs`, `rerolls`, `ladder`, `links`, `budget`); a session snapshots them at creation.

**Only players shown 65+ are offered** (`draft.pickMinimum`, `selectable(p, minimum)` in
`pools.js`): a player is in a draft's pools only when the rating on his card — his natural
rating, rounded — is 65 or more. One rule, in `DraftSession.available()`: nation squads,
league and club pools, `suggestPick` / Auto-pick and every guard go through
it, so a spin lands only where a 65+ player can fill an open slot class (only the keeper slot
left: a 65+ keeper) and no row under 65 is ever listed; the Daily's perfect XI is built from the
same pools. Legends, prime versions and Budget tiers are not asked. **Teams are not drafts**:
opponents' XIs (nations, clubs, bosses), club squads and ratings, a nation's strength,
`playable` / `field`, the ladder and Exhibition sides keep their real players whatever they are
rated. Today 10,968 of the 15,788 players are selectable (961 of 1,719 keepers); the smallest
nation squads are Armenia 9 and Egypt 11 (one playable nation, Guinea, has no keeper of 65+,
so it never lands for the keeper slot), the smallest club pools 11. A session's
rules carry the minimum (0 offers everyone). The UI says nothing about it.

**A nation has at most 30 draftable players** (`draftSquad(players, rules)` in `pools.js`,
stored as `nation.squad` in the index; numbers in `CONFIG.draft.nations`: `squadSize` 30,
`squadGoalkeepers` 3, `squadDefenders` 9, `squadMidfielders` 9, `squadAttackers` 5). Of the
players shown 65+: the best three keepers, the best nine defenders, nine midfielders and five
attackers, then the best four outfield players left (natural OVR; ties by id). The squad is
fixed for a catalog and rules — it does not depend on the draft — and a nation spin's pool is
the squad less the players taken or excluded: it shrinks and never refills from deeper in the
nation. Every nation guard counts only these players (a nation lands only when one of its 30
can fill an open slot class and, in Budget mode, be afforded), the star-nation rule counts them
(`reelPlayers`), and the Daily's perfect XI is built from the same squads. Leagues and clubs
offer everyone shown 65+. Teams are not drafts: `nation.players`, a nation's strength, its XI as
an opponent and `playable` use everyone. Today 55 of the 63 reel nations have the full 30;
fewer: Armenia 9, Egypt 11, Costa Rica 12, Russia 14, New Zealand 18, Burkina Faso 20, Gambia
26 (the star nations) and Georgia 28 (the one playable nation); 1,788 players are draftable in
a nation draft (of the reel nations' 10,119 shown 65+; the largest nation has 786). Four reel
nations have no draftable keeper (Guinea, Egypt, Gambia, Armenia), Algeria and Mali one.
Measured (`draft-baselines.mjs --n 200 --modes nations --rerolls 1,2`, positional policy;
before → after): the typical XI did not move — OVR 83.15 / 83.29, effective 84.04 / 84.18 with
1 / 2 re-rolls, to the last digit (the best pick of a spin was in the 23 call-ups and is in the
30); World Cup drafts with the Legend spin and Prime boosts 84.79 / 85.02, unchanged; Budget
mode 82.90 → 82.82 / 83.13 → 83.04 (its pool no longer adds affordable players from deeper in
the nation).

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
**best past versions (29 titles, FIFA 98 – FC 26: the ratings of 1997–2025) the game shows at
`legends.minimum` (85) or more** — the rating on the card. Two kinds, 431 in all:

- 307 **players of the past**, who are not in the catalog (Ronaldo ’03 94, Xavi ’11, Zidane
  ’03 and Ronaldinho ’03 93, Buffon ’07 and Neymar ’19 92, Henry ’04 and Kaká ’08 91);
- 124 **current players at their best** (`legendOf` = the catalog player's `profileId`): a
  catalog player's best version when it shows 85+ and **at least 2 more than his card today**
  (Messi ’15 95 for 89 today; Neuer ’17 92 for 81; Salah ’25 91). A gain of one point is a
  prime version only; a player whose card today is his best is just a normal pick.

**What a past version is rated** (the compiler, `scripts/legends-calibration.mjs`): its overall
on EA's modern scale, which its card then shows — the skills are those of its year, all moved
by the same few points until the game's rating model (fitted on FC data) shows that overall.
The overall is the one EA printed where it printed one (FIFA 09–23: the best of all time stand
above today's cards, nothing is pulled down to them). FIFA 98–08 printed none: each is
chain-linked to the next title through the players both have (FIFA 08 against 09, 07 against
08, … back to 98) so that those players carry, on average and in spread, what the next title
gives them, less a year of ageing — real differences between years survive, no year's best is
forced to a number. **FC 27 is the baseline of the scale, never a ceiling**: EA printed lower
numbers for its best players in FIFA 09–16 than it does today, so a title whose 30 best average
less than FC 27's (89.03) is lifted by the difference — FIFA 09 +1.2, 10 +1.77, 11 +2.33, 12
+0.87, 13 +1.07, 14 +1.37, 15 +1.43, 16 +1.23; FIFA 98–08 carry FIFA 09's +1.2, the scale they
are linked to; FIFA 17–23 are at or above and stay as printed. The lift is for the top: in full
from the level of the title's best, fading to nothing at 84 (it makes four more legends, not a
flood). A card's `sourceOverall` is this lifted overall. FIFA 98–2003 have 8 to 16 levels and 8 to 17 skills and cannot tell a star
from a good player on their own (their ratings agree with the next data generation's about a
third as well as two official titles agree): such a card is rated by what all the data
generations within three years say about the player, weighed by that measured trust, and a
player whom only one coarse generation knows gets none. So 227 legends are from FIFA 98–14 (152
from the chain), but only 8 from before 2003 (Denilson ’97 86 the oldest), and keepers start
with FIFA 2005 (the first title with three keeper skills). Classic and all-star squads
(Classic XI, World XI, FIFA 2000's classic teams) are no source; an unlicensed stand-in ("No 9"
is Ronaldo in FIFA 2000–02) or an invented name is never shown.

A player's best version is his highest overall (ties: the latest title). **One person, one
place in an XI** (EA's player id ties FIFA 2000–23 and the catalog together; a man with two ids
— Raúl, Bergkamp — is merged by name, team and birthday; FIFA 98/99 rows join by name and
team): `baseProfileId(p)` is the catalog id of a legend or prime version, and the session
treats the versions as one player — drafting his
legend version takes his current version out of every pool, the reel guard, placement and the
opponents' XIs (the run excludes `baseProfileId` of your players), and a current version that
is taken or excluded takes the legend version off the Legend spin (a nation whose only legend
he is leaves the reel). A legend version offers no Prime boost: it is his best already.
Rules in `CONFIG.draft.legends`:

- the reel (`legendIndex(catalog).reel`) holds the 57 nations with a legend shown at `reelStar`
  (85) or more; the index filters by the shown rating itself, so nobody under `minimum` is ever
  offered, whatever the file holds;
- a nation's weight is `1 + weightPerLegend (0.15) × min(its legends, weightCap (20))`: 1.15 for
  one legend, 4 for twenty or more (Spain 52, Brazil 50, France 43, Germany 38, Italy 29,
  Argentina 27, England 25 and the Netherlands 21 legends: 4.0% each; Portugal 16, 3.4%;
  Belgium 12, 2.8%; the twenty nations with one legend 1.2% each). The spin
  carries the honest `weight` / `probability` like every reel; the UI shows no odds for this
  one;
- the pool is the nation's `shown` (10) highest-rated legends (the rating on the card, then the
  name) — one legend for twenty of the nations; if none of them could be placed (slot class,
  Budget tier), the best that can are shown instead. Never a dead end: a nation without a
  legend who is free, fits an open slot class and (Budget mode) a tier with a slot left has
  weight 0, so in local Versus a one-legend nation leaves the second side's reel once its legend
  is taken. Re-rolls, exclusions, `uniqueNations` (the legend's nation counts) and Budget mode
  (a legend costs the tier of his rating) work as for any spin;
- `spin.legend`, `snapshot().legendRound`, `history[].legend` mark it; a pool entry / slot player
  has `legend: true`, `edition` (the title's number: 98, 99 and 0–23 for FIFA 98 … FIFA 23)
  and `year` — **the year of that version's ratings**, stored with the player by the compiler:
  the source row's date (`fifa_update_date`, FIFA 15–23) or the year before the title's number
  (FIFA 98–14: the launch databases; FIFA 98 → 1997, FIFA 2000 → 1999). Release ratings are
  dated the autumn before the number (FIFA 19: 2018 — every version in the data is one), the
  last ratings of a cycle the year of the number. `editionYear(p)` / `editionLabel(p)` read it;
  the UI shows "’18" or "’97", never the edition (two digits tell 1997–2026 apart);
- `snapshot().legendYears` is `[first, last]` year of the legends' versions (`[1997, 2022]`;
  `legendIndex().years`): the Legend spin's one line, "Best versions, 1997–2025".

A legend is a club mate through the club of that edition when the catalog has it (401 of the
411: EA's team id; the early titles name their clubs, matched by name) and a nation mate like
anyone; he is never a Captain — a current Captain's legend version neither. 163 legends show
88+, 248 show 85–87; 52 are keepers. Today's best card shows 92: six legends stand above it
(Messi ’15 95, Cristiano Ronaldo ’18 and Ronaldo ’03 94, Xavi ’11, Buffon ’07 and van
Nistelrooy ’04 93), ten beside it (Zidane, Ronaldinho, Henry, Iniesta, Neymar, Neuer…).

**Prime boosts** (session option `primes: true` = `CONFIG.draft.primes` by difficulty — Pro 2,
World Class 1, Legendary 1 — or a number; the game: World Cup Run drafts). A boost turns a
drafted player into his **prime version** (`catalog.legends.primes`: 2,814 catalog players whose
best version shows more than their card today — **any gain**, a single point counts (527 of
them); EA must have rated him higher then than now, so a card is never just read more kindly —
the same best version a current player's legend is): the attributes, positions,
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
it. A typical drafted XI has 1.6–1.9 players with a prime version (1.5–1.7 under the +2 / 88+
rule, 2,362 stored); half of the XIs have two or more. Usable at any time after he is drafted, until the draft is
handed on (the run is created from `matchSide`); not reversible in core (the UI confirms).
Budget mode never refuses it and it uses no slot: a primed player keeps the tier slot of the
version that was drafted. His current version stays taken (`available` false) and opponents
never field it (`baseProfileId`). `snapshot()`: `primes: { perSide, left }`, `teams[i].primesLeft`,
`slots[i].prime` (the option, or null), and `primeVersion: { profileId, ovr, edition, year,
position }` on pool entries and slot players who have one (a legend version has none).

## Eras (`app/core/players/eras.js`) — the data of the two-spinner draft

A pick's pool is **"nation X in era Y"**: that nation's best 26 players of the era, each at his
best version inside the era's years. The data is `app/data/eras.v1.json` (one file, columnar,
`core/players/eras-codec.js`; fetched by `services/eras.js` `loadEras()` when a draft opens —
never on Home; in slices, `decodeErasSteps` + `attachErasSteps` driven by `stepped()`: 13,696
cards, 2.7 MB, 0.78 MB gzip / 0.63 MB brotli), attached to the catalog like the legends.
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
  **Only spinnable nations are listed** (50–81 per era, see below). `name` is the catalog's
  nation name (`code`/`flag` as in `catalog.nations`; a nation today's catalog does not have —
  none at the moment — would have `code: null`). `size` = players in the pool (**2 to 26** — see "Which nations can be spun"),
  **`keepers` = how many of them are goalkeepers: 0 to 3 — a spinnable pool may have none.**
  `strength` = the mean shown rating of the pool's best XI (best keeper + the ten best
  outfielders, one decimal): the number to weigh or order a reel by. A pool without a keeper
  is rated with the era's `keeperLevel` in goal — the weakest first-choice keeper any
  qualifying pool of that era has (70 / 70 / 62 / 61 / 58 / 53 / 58 / 53), i.e. the least a
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
  goat: true, captain: false,     // the marks (see "GOAT cards and Captains"): always booleans
                                  // on an era card, never both true
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

### GOAT cards and Captains (the marks)

Two reviewed lists are build inputs, and the compiler writes them onto the pools' cards
(`scripts/compile-legends.mjs`; an entry whose EA id, name, nation or era does not meet the
data fails the build — every entry, also the Captains behind the cut):

- **`data/goats.json` — GOAT cards: a player AND an era.** Seven players, 17 cards: Messi
  2010 / 2014 / 2018 / 2022, Cristiano Ronaldo 2010 / 2014 / 2018, Ronaldo 1998 / 2002, Zidane
  1998 / 2002 / 2006, Ronaldinho 2006, Xavi 2010 / 2014, Iniesta 2010 / 2014 (each with its
  reason; `closeCalls` names what could have gone the other way). Only the card of a listed
  era is a GOAT: Messi's 2006 and 2026 cards, Ronaldinho's 2002 card are ordinary cards.
- **`data/captains.json` — Captains: the leaders of 1997–2026, ranked, each with the eras in
  which he led** (87 entries; the first `size` = **40** count: 40 players, 89 cards). His cards of those eras are Captains; his other cards are not (Maldini 1998 /
  2002 / 2006, not 2010). **No player is in both lists** (Maldini, Buffon and Modrić are
  Captains). The old list of today's national-team captains is gone: of today's players only
  the list's own are Captains.

**How the flags reach you:**

| what you hold | `goat` | `captain` |
| --- | --- | --- |
| an era card (`player.era` set; from `eraPool`, `eraPlayer`, `personVersions`, `bestVersion`) | `true` / `false` | `true` / `false` |
| a catalog player (in a 2026 pool as he is, or anywhere else) | `undefined` — **never a GOAT** | `true` / `false` (catalog field, as before): van Dijk, Kane, Kimmich, Modrić, Marquinhos, Son |
| a legend / a prime version (`legends.js`) | `undefined` | legend `false`; a prime version carries the catalog player's |

So test `player.goat === true` and `player.captain === true` on whatever a pool or a slot
holds; nothing else is needed. A card is never both. The flag belongs to **the card, not the
person**: in the 2026 era a Captain is flagged on the object the pool holds (the catalog
player, or his FC 24–26 era card when that shows more — the catalog player is then a Captain
too). The cards kept outside the pools for the Prime (`bestVersion`) are flagged only when
they are also a pool's card of a listed era — so **a Prime swap takes the marks of the card
swapped in**: Xavi 2006 (ordinary) primed is Xavi ’11, a GOAT card; Kimmich today (Captain)
primed to an earlier card of an era in which he is not listed would lose the armband — if a
primed Captain should keep it, carry it over in the session (`drafted.captain || prime.captain`).

`eraMarks(catalog)` → `{ goats: [{ era, nation, player }], captains: [...] }` — every marked
card of the pools, by era then nation (frozen, built on first use): for a gallery, a count or
a test. Per era as built: GOAT cards 2 / 2 / 2 / 4 / 4 / 2 / 1 / 0; Captain cards 8 / 14 / 15 /
13 / 13 / 10 / 10 / 6 (in 8 / 9 / 8 / 8 / 11 / 9 / 9 / 6 pools).

**How often a draft meets one** (11 spins, era and then nation drawn evenly from the reels —
a model of the two-spinner draft, `size` is the lever):

| `size` | Captain cards | a spin's pool has a Captain | pools with a Captain per draft | at least one in a draft |
| --- | --- | --- | --- | --- |
| 20 | 45 | 8% | 0.85 | 59% |
| 30 | 70 | 11% | 1.21 | 72% |
| **40** | **89** | **14%** | **1.49** | **80%** |
| 50 | 107 | 15% | 1.62 | 83% |
| 60 | 126 | 17% | 1.92 | 88% |
| 87 (all) | 161 | 23% | 2.55 | 94% |

A Captain is within 4 points of his pool's best player in most of those pools (1.34 per draft
at 40), so a player who wants one gets one in roughly every second draft and is
offered one about every 0.7 drafts — the owner's "a captain every 0.3–1 game". A GOAT card
is in 3% of pools: 0.33 per draft, at least one in 29% of drafts. Re-rolls and a reel
weighted by strength raise all of these (the Captains' nations are the strong ones). The boosts
and the look are the draft's (`links.js`, the UI); the data only says who.

**Which nations can be spun in an era** (decided by the compiler — `ERA_SPIN`, `ERA_STAR`,
`ERA_NATIONS` in `scripts/compile-legends.mjs`, recorded in the file's `selection`). Three ways
in:

1. **A World Cup side**: a nation that played that era's World Cup finals
   (`data/world-cups.json`: the 32 finalists of 1998–2022, the 48 of 2026) — **with whatever
   players the data has for it**.
2. **A star nation**: a nation with a card that shows **85 or more** in that era (`ERA_STAR`) —
   Weah's Liberia, Shevchenko's Ukraine of 1998, Yorke's Trinidad and Tobago, Aboutrika's
   Egypt, Mkhitaryan's Armenia — again with whatever it has, **even two players**.
3. **Everyone else**: a pool of at least **14 players** (was 18), at least 3 defenders, 4
   midfielders — a forward beyond the pool's first four counts as one — and 2 forwards
   (counted before a second striker is settled: a pool can end with one fewer), and a place
   among the era’s **70 strongest** pools (France 98: 41, and three in ten of the players
   must be men a later title knows by EA's id — no Canada of first names).

**A goalkeeper is never required.** As built:

| era | nations | under 26 players | under 14 | no keeper | strongest | weakest |
| --- | --- | --- | --- | --- | --- | --- |
| France 98 | 50 | 17 | Ukraine 9, Saudi Arabia 10, Korea Republic 8, Liberia 2, Trinidad and Tobago 2 | Ghana, Uruguay, Ukraine, Liberia, Trinidad and Tobago | Italy 87.2 | Trinidad and Tobago |
| Korea/Japan 02 | 72 | 11 | Liberia 5, Ecuador 2 | Georgia, Ghana, Guinea, Costa Rica, New Zealand, Liberia, Ecuador | Brazil 88.5 | Ecuador |
| Germany 06 | 71 | 12 | Iran 12, Estonia 8 | Guinea, Georgia, Egypt, Iran, Burkina Faso | Brazil 89.9 | Estonia |
| South Africa 10 | 73 | 13 | Korea DPR 3 | Mali, Peru, Guinea, Algeria, Honduras, Burkina Faso, Congo DR, Korea DPR | Spain 88.9 | Korea DPR |
| Brazil 14 | 71 | 1 | Iran 9 | Honduras | Spain 89.3 | Iran |
| Russia 18 | 73 | 2 | — | Armenia, Panama | Spain 88.5 | Panama |
| Qatar 22 | 73 | 2 | — | Gabon | France 87.9 | Qatar |
| USA/Canada/Mexico 26 | 81 | 5 | Uzbekistan 8, Jordan 6 | Egypt, Iraq, Uzbekistan, Jordan | France 88.4 | Jordan |

**What this changes for the draft — read this:**

- **A pool can be tiny.** `eraNations(...)[i].size` goes down to **2** (it was at least 18);
  `eraPool` of such a nation is just those players, best first. 563 pools in all, 33 of them
  without a keeper, 15 with fewer than 14 players. **The draft's guards must look at the
  pool, not only at `keepers`**: a spin may land on a nation only when its pool has a player
  the XI can still take — one for an open slot (by position, as the draft judges a fit) who
  is not already in the XI (`personId`). With two players in Liberia 98, that is Weah or
  nothing: once a striker's slot is the only thing Weah could fill and it is taken, Liberia 98
  must not be landed on. The same check covers a keeperless pool when only the keeper's slot
  is open.
- **`strength` of a small pool is honest**: the mean of the best XI where **a place the pool
  cannot fill counts 60** (`ERA_FILL`) — Liberia 98 is 64.5, not 83. A reel weighted by
  strength gives such a nation little; a flat reel gives every nation the same chance (then
  a tiny pool lands as often as Brazil — weigh by `size` if that is not wanted).
- **`keeperLevel`** (what a keeperless pool is rated with in goal) is the weakest first-choice
  keeper of the era's *full* pools: 70 / 67 / 57 / 61 / 58 / 53 / 52 / 53.
- **The always-in lists are data, not code for the draft**: nothing to read at run time —
  `eraList` simply has more nations. In beyond the strongest 70, or with a pool under the
  minimum: France 98 — United States, South Africa, Morocco, Japan, Jamaica, Iran, Tunisia,
  Saudi Arabia, Korea Republic, Paraguay (World Cup 1998), Ukraine, Liberia, Trinidad and
  Tobago (stars); 2002 — Côte d'Ivoire, Trinidad and Tobago, Costa Rica, New Zealand, United
  Arab Emirates (14–16 players), Liberia, Ecuador; 2006 — Japan, Iran, Georgia, Peru, Egypt,
  Estonia; 2010 — Egypt, Togo, New Zealand, Korea DPR; 2014 — Iran; 2018 — Iran, Panama,
  Armenia; 2022 — Tunisia, Saudi Arabia, Qatar; 2026 — Iran, Costa Rica, New Zealand, Qatar,
  Haiti, Panama, Curacao, South Africa, Iraq, Uzbekistan, Jordan. The one World Cup side with
  no pool: Saudi Arabia 2006 (no Saudi player in FIFA 04–07).
- **Who is in a pool** is still "the 26 best-rated of the cycle", with two reviewed
  exceptions that put a man in: a **World Cup starter** of `data/world-cup-starters.json` (57
  entries: Karembeu 1998, Grosso 2006, Capdevila 2010, Fred 2014, Carvajal 2018, Tchouaméni and
  Richarlison 2022 …) and every player with a breakout-lag correction — he takes the place of
  the pool's lowest-rated player (a keeper a keeper's; an outfielder the lowest-rated
  outfielder's whose line keeps its minimum). Their cards are ordinary cards.
- **Hand-made cards** (`data/judgement-cards.json`, 18): notable players the source lacks or
  cannot tell apart — Gary Neville 1998, Francescoli, Stojković, Hong Myung-bo 1998 and 2002,
  Köpke, Pagliuca, Shevchenko and Rebrov 1998, Aboutrika 2006 and 2008, Al-Deayea, Al-Owairan,
  Daei, Davala, Edmundo, Lalas, Wynalda. Position, skills and club are a real row of his (another
  id, another title), the overall is a judgement; at run time they are ordinary era cards
  (the provenance `data/build/eras.json` → `stats.handCards` lists them).

**The judgement on single cards** (`PLAYER_JUDGEMENT`, each entry with `kind` and its reason;
`NATION_JUDGEMENT`): the agreed peaks (`peak`), 24 icons of 1997–2002 the coarse titles
under-rate (`icon`: Keane, Batistuta, Bergkamp, Cafu, Roberto Carlos, Thuram …), 43 players
with **breakout lag** (`breakout`: a key man of his side at that World Cup whose card of the
year still shows a prospect — Müller and Busquets 2010, Lahm 2006, Klose 2002, Saka and
Musiala 2022 … lifted by one to three points, Xavi and Iniesta 2010 to 91; the starter rule
puts each in his squad), and England's players
in FIFA 98–2004 two points down at 90 (fading to nothing at 76). `node
tools/research/era-names.mjs` lists who of about 300 notable players per era is still not in
his nation's pool.

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
- **France 98 is the thinnest**: 50 nations, no Brazil-size depth outside Europe and Argentina/Brazil
  (FIFA 98/99 use their own player ids and mostly surnames: a player counts only when
  FIFA 2000–03 know him by name and club, or by name, national team and part of the pitch — or when both titles list him, at a club or in a national squad). Japan of 1998 is not spinnable (16 players); Liberia never is (Weah has no pool).
- A pool can have 0, 1 or 2 keepers, and as few as 18 players.
- 8,380 people are in a pool; 3,697 of them in two or more eras. 505 best
  versions are kept outside the pools for the Prime.
- Era cards and `catalog.legends` are separate objects for the same men (a legend's id ends
  in `:legend`, an era card's in `:era`): do not mix the two systems in one XI without
  comparing `personId`.

`catalog.legends` (Legend spin) and its primes keep working unchanged until the draft stops
using them; the era file does not depend on the legends file.

## Flow

```js
import { createDraftSession, restoreDraftSession, matchSetup, applyMatchSetup } from './core/draft/session.js';

const draft = createDraftSession(catalog, {
  mode: 'nations',           // 'nations' | 'leagues' | 'clubs'
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
`captainBoost`. `linkBoosts(rules)` gives the three numbers; `validLinks(rules)` says whether a rules
object has them (a saved run must: `restoreCupRun`). Real national XIs are all nation mates (+1.5
each, +2.5 for club mates inside them, +1 with their captain), real club XIs club mates. A pool
entry's `boost` says what a player would get in the XI as it stands, `captainBoost` what he
would give it.

**Captains** are the reviewed list of the leaders of 1997–2026 (`data/captains.json`, see
"GOAT cards and Captains" under Eras: player + eras, ranked, cut at `size` 40). Among today's
catalog players the Captains are the list's players who lead in the 2026 era — van Dijk, Kane,
Kimmich, Modrić, Marquinhos, Son (Messi, a GOAT-list player, is none) — and the build fails
when an id, name or nation does not match the catalog. The numbers that follow were measured
with the list before it (today's national-team captains, 10 of them) and the Nations draft:
the size was cut so that about one drafted World Cup XI in three has a captain:
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

Then came the legends of FIFA 98–14, past versions at the overall EA gave them and primes for
any gain (`draft-baselines.mjs --legend --primes default --n 200 --modes nations --rerolls 1,2`,
pick the best player; before → after): OVR 83.88 → 83.89 / 84.11 → 84.16, effective 84.79 →
84.77 / 85.02 → 85.05; the legend plays at 88.8 → 89.0; players with a prime version per XI
1.46 → 1.64; Prime boosts used 0.76 → 0.77 / 1.12 → 1.17, worth 3.3 → 3.6 / 4.3 → 4.8 slot
points. The drafted XI is as strong as it was; `MODE_BASELINES` and `CUP_TUNING` were not
touched.

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
history, the Prime boosts left, plus `catalog: catalogStamp(catalog)`. Restore throws if a saved
player is missing from the catalog — a draft with a legend or a primed player needs
`catalog.legends` attached first; compare the stamp with `catalogStamp(catalog)` to warn about a changed
database. Restored sessions continue with identical spins. `SESSION_FORMAT` is 2 (the rules
of this version: a nation's draft squad, the pick minimum, the named tiers, mates and the
Captain, three difficulties and modes): anything else — an older format, no rules — throws 'Not
a saved draft session'. There is one cut-off and no conversion of older saves.

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
- Never a dead end: the spin guard also needs an affordable player for an open slot class. A
  nation's pool is its draft squad as always (the stars you cannot afford are listed, closed);
  nobody is added from deeper in the nation, so a nation whose squad has nobody you can
  afford for an open slot class is off the reel for that spin — France, Spain, Brazil, England
  and Germany have no outfield player under 80 in their 30, Italy three.
- Serialised with the session (`options.budget`, `rules.budget`: the three named tiers).
- The game offers it in the World Cup Run only (`context.options.budget` → run
  `meta.budget`).

Measured: the table under "Mates and the Captain" (`tools/calibration/draft-baselines.mjs
--budget "off;default" --legend --primes default`): a Budget XI is about 0.8–1.0 effective
points weaker than a normal one (it was 2.0 with one Superstar slot and the 48-nation reel).
