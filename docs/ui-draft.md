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

## Setup query parameters (challenge links land here)

`#/play/quick?type=leagues&difficulty=amateur&formation=4231&seed=123&hide=1&unique=1`

| Param | Values | Notes |
| --- | --- | --- |
| `type` | `nations` · `leagues` · `clubs` · `club-country` (also `clubAndCountry`) | default: last Home choice (`prefs.draftType`) |
| `difficulty` | `amateur` · `semipro` · `pro` · `worldclass` · `legendary` | default: last choice for the mode, else `pro` |
| `formation` | any `FORMATIONS` key (`433`, `4231-wide`, …) | default: last choice, else `433` |
| `seed` | digits (uint32) or any string (FNV-1a, like the core) | **implies standard rules** (`useDefaultRules`), shows the Challenge banner |
| `hide` / `unique` | `1` / `0` | Ball Knower / one player per nation (nation spins only) |

Last choices per mode are remembered in `football-draft-setup` (`{ run: { difficulty, formation,
uniqueNations, names, kits }, … }`). The difficulty ladder shows opponent strength (`ladderTarget`),
re-rolls, example teams (`ladderPreview`) and, for runs, the stage a typical draft reaches
(`projectRun` on the mode baseline).

## `lib/draft-store.js` (framework-free, Node-tested)

```js
import { startDraft, loadDraft, completedDraft, clearDraft, draftStore } from '../../lib/draft-store.js';

await startDraft(context, { go = true, spin = true });  // → #/draft, first spin made (not Versus)
// context = { kind: 'run' | 'quick' | 'versus' | 'daily', type, difficulty, formation,
//             options: { hideRatings, uniqueNations }, seed,
//             schedule?, rerolls?, useDefaultRules?,          // daily: pass day.draft's values
//             names?: [p1, p2], kits?: ['volt', 'sky'],        // versus (KIT_COLORS ids)
//             returnTo?, daily?, meta? }                       // run/daily: where Continue goes;
//                                                              // daily/meta are kept as given
completedDraft();      // { session, context } when every pick is made (in memory), else null
await loadDraft();     // the same after a reload (restores 'football-draft-draft'), or null
readSavedDraft();      // sync summary { context, picks, total, complete, savedAt } | null
clearDraft();          // forget it (memory + storage)
```

* `type` accepts `club-country` and `clubAndCountry`; `seed` numbers, digit strings or any
  string; kind `daily` implies `useDefaultRules`. `normalizeContext()` / `sessionOptions()`
  show exactly what reaches `createDraftSession`.
* Persisted after **every** action: `{ format: 1, context, session: session.serialize(),
  savedAt }` under `football-draft-draft`. A reload restores the board where it was (a spin that
  was animating is shown landed).
* Actions used by the board: `spinDraft()`, `rerollDraft()`, `pickPlayer(id, slot | null)`,
  `autoPick()` (spin if needed + `suggestPick()` + pick — the board's **Auto-pick**,
  `data-testid="auto-pick"`), `autoComplete()`, `markLanded()`.
* `draftStore` state: `{ status: 'idle'|'loading'|'ready'|'empty'|'error', context, snap
  (session.snapshot()), animate (spin token to animate or null), lastPick, error, version }`.
  Works with `useStore`.
* **Completion** (`finishDraft()`, the completion sheet's Continue):
  * `run` / `daily` → `location.hash = '#' + (context.returnTo || '/run' | '/daily')`. The
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
  view?: 'key' | 'full' | 'instant',
}, { go = true });                  // → #/prematch
```

* `id` falls back to `meta.fixture`, then `match-<seed36>`; `meta` is kept intact (plus
  `context`/`title`/`returnTo` defaults). Sides: `players` may be `draft.matchSide(i).players`
  or `buildOpponent(...).players` (their `chem` is kept); `editable` defaults to `kind !== 'ai'`.
* Persisted under `football-draft-prematch` (edits survive a reload). Edits: `swapPlayers(side,
  a, b)` (GK slot keepers only), `changeFormation(side, f)` (exact best re-slot, keeper in
  goal), `setSideTactic(side, key, value)` (`style tempo width press mentality`),
  `setMatchView(view)` (remembered in `football-draft-match-view`).
* `kickOff({ go = true })` → `buildMatchConfig({ sides, competition: engineCompetition(data) })`
  and `requestMatch({ id, seed, view, config, meta: { ...meta, sides, userSides } })`.
  `engineCompetition`: mode `ai` (or `pvp` when both sides are human), AI coach level from the
  draft difficulty (`COACH_LEVEL`: amateur `veryeasy` … legendary `impossible`). In `ai` mode the
  engine's coach runs **side 1**, so put the AI side second.
* Pure helpers for screens/tests: `slotFits`, `lineupStrength` (OVR, effective, Links),
  `canSwap`, `swapSlots`, `reslot`.

## The draft board (`screens/draft/`)

| File | Part |
| --- | --- |
| `draft.js` | screen + board orchestration (layout per breakpoint, actions, effects) |
| `draft-model.js` | pure: pool filter/sort/search, row fit, slot highlights, reel items, odds, projection, pick preview |
| `spin-stage.js` | honest reels (decoy start, clubs: league leg then club leg), reveal card, idle panel, odds dialog |
| `pool-list.js` | chips (Best fit · Overall · GK · DEF · MID · ATT), search, rows in pages of 30 (IntersectionObserver + "Show more") |
| `team-panel.js` | meters strip (OVR · Links · projection), pitch, line meters, Versus strip, picks history |
| `pick-panel.js` | select-then-lock: `PickSheet` (phones) and `PickDock` (desktop) |
| `complete-sheet.js` | XI summary + stars, quick-match opponent reveal, Versus both XIs, Reveal ratings |
| `moments.js` | Star/Superstar pick flourish (foil sweep + `selectionSound`, confetti for Superstars; skipped with reduced motion), Versus pass-the-device |
| `use-media.js` | `useMedia('(min-width: 960px)')` — one primary CTA in the DOM per layout |

* **Reels are honest**: the session draws first; only options with `weight > 0` are on the
  reel; the reel mounts on a decoy item and travels to `landing` (never the draft RNG).
  Durations: 1.4 s (nation/league), 0.8 s + 1.15 s (clubs); tap to skip; reduced motion
  lands at once. The odds dialog (ⓘ) shows the landed option's chance and the per-pot/tier
  odds of that spin.
* **Fit**: rows show `✓ ROLE` (natural), `84 → 79` (best slot out of position) or `No slot`.
  Selecting lights the pitch: `★ Best` (Auto), `✓` natural, amber `natural → in-slot` for
  drops up to 7, a muted in-slot rating for poor fits (still selectable), closed slots dimmed.
  Tap a lit slot to choose it, tap it again (or **Draft …**) to lock; **Auto** returns to
  `autoSlot`. The sheet/dock preview the team OVR and Links after the pick and who he links
  with.
* **Ball Knower** (`hideRatings`): no numbers anywhere (rows, pitch, meters, projection,
  odds-free sorting: pool by line then name, no Overall chip), no tier celebrations; the
  completion sheet offers **Reveal ratings**.
* **Projection**: open slots count at the mode's typical drafted rating (`estimateRating`);
  run/daily → `projectRun` stage, quick → win chance vs the difficulty target, versus → win
  chance vs the other drafter.
* Test hooks: `data-testid` `spin`, `reroll`, `auto-pick`, `spin-result`, `pool`,
  `confirm-pick`, `auto-slot`, `draft-done`, `draft-continue`, `opponent-name`, `pass-spin`;
  `data-screen="draft"` + `data-phase="spin|spinning|pick|complete"`.

Browser flows (`tests/browser/flows.mjs`): `setup`, `draft-nations` (11 picks, select → Auto
→ confirm), `draft-clubs` (re-roll, odds, filters, auto-pick), `draft-versus` (coin toss, four
alternating picks), `prematch` (quick draft → opponent reveal → swap, tactic, formation →
Kick off → `#/match`). Node: `tests/draft-ui-store.test.mjs`, `tests/draft-ui-model.test.mjs`.
