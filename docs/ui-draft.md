# Draft UI — setup, draft board, pre-match (`app/ui/`)

The draft experience of the new UI and its two hand-off stores. Core rules live in
`app/core/draft/` (`docs/draft-api.md`); the match hand-off is MATCH-UI's
`app/ui/lib/match-store.js` (`docs/ui-match.md`).

| Route | Screen | What it does |
| --- | --- | --- |
| `#/play/:mode` (`run` · `quick` · `versus`) | `screens/setup/` | draft type, difficulty, formation, options (Versus: names + kits). Preselected; one tap starts the draft **and its first spin**. `#/play/daily` redirects to `#/daily` (RUN-UI). |
| `#/draft` | `screens/draft/` | the board: spin → reel → pool → select → place → lock; meters; Versus turns; completion. `?auto=1` auto-completes (tests). |
| `#/prematch` | `screens/prematch/` | generic pre-match for any two XIs: lineup swaps, formation, tactics, opponent preview, view mode, Kick off. |

Home → Start (setup) → the reel is already spinning: two taps from Home to the first spin.
The draft's back arrow always leaves for Home (route `leave: true`), also mid-spin: the draft
stays saved, Home's card resumes it with that spin landed. "Play again" (`?go=1`) starts a
draft once — the parameter is removed from the history entry, so going back never starts another.
Starting a World Cup draft while a run is in progress asks first (`docs/ui-run.md`).

## Setup query parameters (challenge links land here)

`#/play/quick?type=leagues&difficulty=worldclass&formation=4231&seed=123&hide=1&unique=1`

| Param | Values | Notes |
| --- | --- | --- |
| `type` | `nations` · `leagues` · `clubs` (Quick Match, Versus) | the World Cup Run is always `nations`; otherwise default: last choice (`prefs.draftType`); anything else reads as `nations` |
| `difficulty` | `pro` · `worldclass` · `legendary` | default: last choice for the mode, else `pro` (so does any unknown id) |
| `formation` | any `FORMATIONS` key (`433`, `4231-wide`, …) | default: last choice, else `433` |
| `seed` | digits (uint32) or any string (FNV-1a, like the core) | **implies standard rules** (`useDefaultRules`), shows the Challenge banner |
| `hide` / `unique` | `1` / `0` | Ball Knower / one player per nation (nation spins only) |
| `budget` | `1` / `0` | Budget mode (World Cup Run only; a seeded link plays it only when it says so) |

Last choices per mode are remembered in `football-draft-setup` (`{ run: { difficulty, formation,
uniqueNations, budget, names, kits }, … }`). The World Cup setup has a **Budget mode** switch
(`#setup-budget`; `budgetCopy()` writes its sentence from `CONFIG.draft.budget`): a harder run
whose XI may hold only 2 Superstars (88+), 2 Stars (84–87) and 3 Starters (80–83) (`docs/draft-api.md`). For a run the
difficulty line also says the Prime boosts ("2 re-rolls and 2 Prime boosts per draft"). The difficulty ladder shows each level's name, a
word on the opponents and the re-rolls — no ratings or example teams — and, for runs, the stage
"a good manager reaches" (`projectRun` on the mode baseline). The World Cup setup says the
formation stays for the group stage (`formationLocked` on those pre-match sides, see
`docs/ui-run.md`).

## `lib/draft-store.js` (framework-free, Node-tested)

```js
import { startDraft, loadDraft, completedDraft, clearDraft, draftStore } from '../../lib/draft-store.js';

await startDraft(context, { go = true, spin = true });  // → #/draft, first spin made (not Versus)
// context = { kind: 'run' | 'quick' | 'versus' | 'daily', type, difficulty, formation,
//             options: { hideRatings, uniqueNations, budget? }, seed,   // budget: runs only
//             schedule?, rerolls?, useDefaultRules?,          // daily: pass day.draft's values
//             names?: [p1, p2], kits?: ['volt', 'sky'],        // versus (KIT_COLORS ids)
//             returnTo?, daily?, meta? }                       // run/daily: where Continue goes;
//                                                              // daily/meta are kept as given
completedDraft();      // { session, context } when every pick is made (in memory), else null
await loadDraft();     // the same after a reload (restores 'football-draft-draft'), or null
readSavedDraft();      // sync summary { context, picks, total, complete, savedAt } | null
                       // (lives in lib/saved.js, no catalog; Home's "Draft in progress" card)
clearDraft();          // forget it (memory + storage)
await restoreSaved(saved);  // { session, context, catalog } of a saved draft, not made current
await resumeDraft(saved);   // make a saved draft the current one → #/draft (the Daily's kept draft)
```

* `type` is the core draft mode (`nations` · `leagues` · `clubs`; anything else reads as
  `nations`); `seed` numbers, digit strings or any
  string; kind `daily` implies `useDefaultRules`. `normalizeContext()` / `sessionOptions()`
  show exactly what reaches `createDraftSession`.
* Persisted after **every** action: `{ format: 2, context, session: session.serialize(),
  savedAt }` under `football-draft-draft`. A reload restores the board where it was (a spin that
  was animating is shown landed). A Daily draft with a pick made is also kept with the Daily
  record after every action (`lockDailyDraft`, `docs/ui-run.md`): one attempt from the first
  pick. `readSavedDraft()` ignores a Daily draft of another day.
* A World Cup Run's Nations draft (`worldCupDraft(ctx)`) gets `legendSpin: true, primes: true`;
  for it (and when restoring one) the catalog loader is asked for `{ legends: true }` and
  fetches `app/data/legends.v1.json` (`services/legends.js`) — Home and every other screen but
  the run never fetch that file. `primeDrafted(slot)` spends a Prime boost.
* Actions used by the board: `spinDraft()`, `rerollDraft()`, `pickPlayer(id, slot | null)`,
  `autoPick()` (spin if needed + `suggestPick()` + pick — the board's **Auto-pick**,
  `data-testid="auto-pick"`), `autoComplete()`, `markLanded()`.
* `draftStore` state: `{ status: 'idle'|'loading'|'ready'|'empty'|'error', context, snap
  (session.snapshot()), animate (spin token to animate or null), lastPick, error, version }`.
  Works with `useStore`.
* **Completion** (`finishDraft()`, the completion sheet's Continue):
  * `run` / `daily` → `location.hash = '#' + (context.returnTo || '/run' | '/daily')`.
    `createRunFromDraft` copies `options.budget` to the run's `meta.budget`. The
    draft stays stored; RUN-UI takes the XI (`completedDraft()` / `await loadDraft()` →
    `session.matchSide(0)`) and calls `clearDraft()` once the run exists.
  * `quick` → the sheet reveals the opponent (`quickOpponent()`: `pickOpponent` with the
    difficulty, the draft seed and the user's players excluded; W/D/L from the fast model) →
    `openPrematch(prematchPayload())` → the draft is cleared.
  * `versus` → `openPrematch` with both XIs (`kind: 'user'` and `'p2'`, both editable,
    competition `pvp`) → cleared.

## `lib/prematch-store.js` (framework-free, Node-tested)

```js
import { openPrematch } from '../../lib/prematch-store.js';

openPrematch({
  id: 'run:abc:qf',               // kept and passed to requestMatch → readMatchResult(id)
  seed,                           // match seed (uint32; random if missing)
  sides: [{ name, short?, colors: [primary, secondary], flagCode?, kind: 'user' | 'ai' | 'p2',
            formation, tactics?, players: [11 profiles in slot order], editable? }, …2],
  competition: { mode?: 'ai' | 'pvp', difficulty: 'pro', knockout: false, extraTime? },
  meta: { context: 'run', title: 'Quarter-final', returnTo: '#/run', fixture: 'run:abc:qf' },
  useDefaultRules?: false,         // Daily/challenge: tuning = DEFAULT_CONFIG
  hideRatings?: false,             // Ball Knower: no OVRs, odds or rating tags (also read from
                                   // meta.hideRatings); passed on as request meta.hideRatings
  view?: 'key' | 'full' | 'instant',
}, { go = true });                  // → #/prematch
```

* `id` falls back to `meta.fixture`, then `match-<seed36>`; `meta` is kept intact (plus
  `context`/`title`/`returnTo` defaults). Sides: `players` may be `draft.matchSide(i).players`
  or `buildOpponent(...).players` (their `chem` is kept); `editable` defaults to `kind !== 'ai'`.
* Persisted under `football-draft-prematch` (edits survive a reload) until its match has a
  result: the store then forgets it (`clearPrematch()`; it subscribes to the match store), so
  the key does not outlive the match. Edits: `swapPlayers(side,
  a, b)` (GK slot keepers only), `changeFormation(side, f)` (exact best re-slot: the lineup with the best team OVR, keeper in
  goal), `setSideTactic(side, key, value)` (the screens set `mentality` only),
  `setMatchView(view)` (remembered in `football-draft-match-view`).
* `kickOff({ go = true })` → `buildMatchConfig({ sides, competition: engineCompetition(data) })`
  and `requestMatch({ id, seed, view, config, meta: { ...meta, sides, userSides } })`.
  `engineCompetition`: mode `ai` (or `pvp` when both sides are human), AI coach level from the
  draft difficulty (`COACH_LEVEL`: pro `medium`, worldclass `hard`, legendary `impossible`). In `ai` mode the
  engine's coach runs **side 1**, so put the AI side second.
* Pure helpers for screens/tests: `slotFits`, `lineupStrength` (OVR, effective, mates),
  `canSwap`, `swapSlots`, `reslot`, `formationRatings(players)` (`{ '433': 84.2, … }`: the
  team OVR every formation would give with its best lineup — an exact assignment per
  formation over a 10 × 10 table of slot ratings, all 21 in a few milliseconds, so it runs on
  the main thread).
* The lineup panel's formation picker (`data-testid="formation-select"`) lists every
  formation with that team OVR ("4–3–3 · Attacking · 84.2", ★ on the best; the formation in
  play shows the lineup as it stands) and choosing one fields its best lineup. No numbers
  with hidden ratings; a locked formation (a World Cup run's group stage) stays locked.

## The draft board (`screens/draft/`)

| File | Part |
| --- | --- |
| `draft.js` | screen + board orchestration (layout per breakpoint, actions, effects) |
| `draft-model.js` | pure: pool filter/sort/search, row fit and cost, slot highlights, reel items, odds, projection, pick preview, mates lines |
| `spin-stage.js` | honest reels (decoy start, clubs: league leg then club leg), reveal card, idle panel, odds dialog |
| `pool-list.js` | chips (Best fit · Overall · GK · DEF · MID · ATT), search, rows in pages of 30 (IntersectionObserver + "Show more") |
| `team-panel.js` | meters strip (OVR · Boosts · projection), Budget slots, pitch, line meters, Versus strip, picks history |
| `pick-panel.js` | select-then-lock: `PickSheet` (phones) and `PickDock` (desktop), both with the player's card and its six stats (`data-testid="pick-card"`) |
| `complete-sheet.js` | XI summary + stars, quick-match opponent reveal, Versus both XIs, Reveal ratings |
| `moments.js` | Star/Superstar pick flourish (foil sweep + `selectionSound`, confetti for Superstars; skipped with reduced motion), Versus pass-the-device |
| `use-media.js` | `useMedia('(min-width: 960px)')` — one primary CTA in the DOM per layout |

* **Reels are honest**: the session draws first; only options with `weight > 0` are on the
  reel; the reel mounts on a decoy item and travels to `landing` (never the draft RNG).
  Durations: 1.4 s (nation/league), 0.8 s + 1.15 s (clubs); tap to skip; reduced motion
  lands at once. The odds dialog (ⓘ) shows the landed option's chance and the per-pot/tier
  odds of that spin.
* **Pool rows** say what matters for the pick and nothing the row shows already: the boost
  he would get in your XI on the second line (`rowBoost`, from the pool entry's `boost`:
  "+1.5 nation mate", "+1 club mate", "+2.5 nation + club mate"), and at the end his rating
  at his best open slot when that is not his own position (`rowFit`: "81 at CM", amber when
  he loses rating there; nothing when he plays his own position at full rating), or why he
  cannot be picked (`Taken`, `No slot`, `Star full`). **Nothing important is ever cut**
  (`PlayerRow`): the second line spans the whole row under the name; its tags — the Budget
  cost, the boost, and "Prime 82 +7" (`primeNote`: a Prime boost is on offer, what it makes
  him and what it adds) — never shrink and wrap to another line when a 390 px row is too
  narrow; only the club text gives way, with an ellipsis. `tests/browser/flows.mjs` checks
  that no tag is cut. A Superstar's or a Star's row has a thin
  outline in the tier's colour (so have their cards and pitch tokens; lower tiers are plain).
* **The player's card**: selecting a player shows his `PlayerCard` with the six stats (Pace,
  Shooting, Passing, Dribbling, Defending, Physical; GK first for keepers) — in the sheet
  on phones (132 px wide, beside the fit and the effects of the pick, so the pitch and the
  Draft button stay in reach) and in the dock on desktop. **Everything about him is in the
  sheet** (and the dock), whatever his row had room for: positions, his tier by name
  ("Starter"; not with hidden ratings), "Legend ’18" for a legend (`data-testid=
  "pick-standing"`), club and league, the slot and his overall there ("At DM 76",
  `data-testid="pick-slot"`), the team OVR after the pick, the mates lines, the Captain line,
  the Prime boost on offer ("Prime ’19 88 +6", `data-testid="prime-effect"`) and the Budget
  slot.
* **Fit**: selecting lights the pitch, and **every open slot shows his overall there** — the
  number in the slot (`.pitch-slot__rating`, from `slotHighlights` → `{ role, rating }`), so RB
  75 and DM 76 compare at a glance; the tag above it says the role: `★ DM` (Auto: volt, the
  largest number), `✓ LB` natural, amber for drops up to 7, muted for poor fits (still
  selectable); closed slots are dimmed. With hidden ratings there are no numbers and the tags
  read as before (`★ Best`, `✓ LB`, `Poor`).
  Tap a lit slot to choose it, tap it again (or **Draft …**) to lock; **Auto** returns to
  `autoSlot`. The sheet/dock preview the team OVR after the pick and say his boost in words
  (`mateLines`: "Nation mate of Mbappé: +1.5 each", "Club mate of Hakimi: +1", "Both: +2.5",
  "Also lifts Dembélé to +2.5", "No mates in your XI yet").
* **Boosts**: every pitch (`PitchView`) shows a green `+1` / `+1.5` / `+2.5` chip on a
  boosted player (club mate +1, nation mate +1.5, both +2.5; worked out from the players,
  so pre-match and run pitches show it too) while the OVR badge stays the plain rating; mates
  lines are gold for nation mates (thickest) and volt for club mates. The meter "Boosts +7.5"
  is the sum of the chips (`team.links.total`). Boosts are written with `boost()` from
  `lib/format.js` (a decimal only when there is one).
* **Tiers**: one vocabulary (`lib/tiers.js`, from `core/draft/budget.js`): Superstar 88+,
  Star 84–87, Starter 80–83, Normal 74–79, Bench below — the frame a player wears, the
  celebration of a pick and the slot he costs in Budget mode all use it.
* **Budget mode** (`snap.budget`): a strip under the meters shows the capped tiers as slots
  filling up (`BudgetStrip`: "Superstar ●  Star ●○  Starter ●●○ · Under 80 free"; the slot
  the selected player would use pulses), every pool row carries its tier tag (`rowCost`:
  `Superstar`, `Star`, `Starter` or `Free`), rows of a full tier are closed with "Star full"
  and listed under the players he can still pick, and the pick preview says "Budget uses a
  Star slot · 1 left". The completion sheet shows the strip too.
* **Ball Knower** (`hideRatings`): no numbers anywhere (rows, pitch, meters, projection,
  odds-free sorting: pool by line then name, no Overall chip), no tier celebrations; the
  completion sheet offers **Reveal ratings**.
* **Projection**: open slots count at the mode's typical drafted rating (`estimateRating`);
  run/daily → `projectRun` stage, quick → win chance vs the difficulty target, versus → win
  chance vs the other drafter.
* **Legend spin** (World Cup Run drafts, `snap.legendRound`): the first spin's stage is gold
  (`.stage.is-legend`, "Legend spin", the button says "Legend spin", the pool "Pick a legend")
  and shows **no odds** (no ⓘ, no dialog: the reel's weighting is silent). One line says where
  the legends come from: "Best versions, 2014–2022" (`legendYearsLine(snap.legendYears)`,
  `data-testid="legend-years"`, from the data). At most ten legends are listed, nobody under 85.
  A legend's — and a prime version's — card, row and pitch token carry the year of that version
  ("’18": `view.era`, `editionLabel(player)` — the year stored with the version; an edition
  name is never shown). A legend can be a current player's best past version (Messi ’19): he is
  then gone from the ordinary pools, and has no Prime boost.
* **Prime boost** (`snap.primes`, `prime-sheet.js`): the `PrimeButton` ("Prime boost 2") sits
  under the meters and in the completion sheet's footer — boosts not used by "On to the World
  Cup" are gone. It opens one sheet (`PrimeSheet`) listing the XI: players with a prime version
  first with the bump in their slot ("84 → 86 +2", "Prime ’22"; a version that plays elsewhere
  says so, "CB · Prime ’16 · LB 86", and a slot that gains nothing shows "±0" / "−1" in grey),
  the rest dimmed and not selectable; select, then "Boost Son · Prime ’22" confirms (not
  reversible). **The sheet stays open after a boost**: his row keeps its place (the order is
  fixed when the sheet opens) with a tick, and the button says **Done** — or boosts the next
  choice. The button ignores taps for 450 ms after a boost, and the board's Spin / Re-roll /
  Auto-pick / Continue ignore taps for 400 ms after a sheet is closed (`hush()` in `draft.js`):
  those buttons sit exactly under the sheet's button, and a second tap used to re-roll the spin
  or start the World Cup. Players with a prime available carry
  a gold dot on the pitch and "Prime 94 +8" in their pool row while boosts are left.
* **Captain**: the "C" (`CaptainMark`) on his row, card and pitch token (the armband: the
  highest-rated Captain of the XI), the green chips include his +1, and the pick preview says
  "Captain: +1 to every player" when he would be the XI's first.
* Test hooks: `data-testid` `spin`, `reroll`, `auto-pick`, `spin-result`, `pool`,
  `confirm-pick`, `auto-slot`, `draft-done`, `draft-continue`, `opponent-name`, `pass-spin`,
  `team-boosts`, `mates-effect`, `budget-effect`, `captain-effect`, `prime-effect`, `pick-card`,
  `pick-slot`, `pick-standing`, `legend-years`, `final-boosts`, `prime-open`, `prime-option`,
  `prime-done`, `prime-confirm`;
  `data-screen="draft"` + `data-phase="spin|spinning|pick|complete"`.

Browser flows (`tests/browser/flows.mjs`): `setup`, `draft-nations` (the Legend spin: gold stage,
years on the rows and the years line, nobody under 85, no odds, the legends file fetched; the
sheet's tier and year, his overall in every open slot; 11 picks, select → Auto → confirm; no
pool row cuts a tag; the card's six stats; a Prime boost on the completion sheet that stays
open, shows the boost and swallows a second tap; the run keeps the legend and the prime),
`draft-back` (Play again → the device's back shows the setup, the back arrow goes Home, the
draft is kept and resumed), `draft-budget` (setup switch, tier tags, a full tier closes rows, run
`meta.budget`), `draft-clubs` (re-roll, odds, filters, auto-pick), `draft-versus` (coin toss, four
alternating picks), `prematch` (quick draft → opponent reveal → swap, tactic, formation picker
with team OVRs →
Kick off → `#/match`). Node: `tests/draft-ui-store.test.mjs`, `tests/draft-ui-model.test.mjs`.
