# Match screen — hand-off contract (`#/match`)

How the other screens (draft → pre-match, World Cup Run, Daily, Quick match, Versus,
Exhibition) hand a match to the match screen and read its result. The API lives in
`app/ui/lib/match-store.js` (framework-free; Node tests import it). Engine data is described in
`docs/engine-events.md`.

```js
import {
  buildMatchConfig, requestMatch, readMatchResult, runResultFor, clearMatch,
} from '../../lib/match-store.js';

// 1. Build the engine config from two sides (draft.matchSide(i), opponent XIs, club XIs …)
const config = buildMatchConfig({
  sides: [home, away],              // see below
  competition: { mode: 'ai', difficulty: 'pro', knockout: true },
});

// 2. Hand it over — stores the request and navigates to #/match
requestMatch({
  id: 'run:qf',                     // your id; the result carries it back
  seed: m.seed,                     // uint32; same seed + config ⇒ same match (Key/Instant)
  view: 'key',                      // 'key' (default) | 'full' | 'instant' — the user can change it
  config,
  meta: {
    context: 'run',                 // 'run' | 'quick' | 'versus' | 'exhibition' | 'daily'
    title: 'Quarter-final',         // shown above the score bug
    sides: [                        // presentation only (defaults come from config.teams)
      { name: 'France', short: 'FRA', kind: 'user', flagCode: 'fr', colors: ['#1d3c8f', '#fff'] },
      { name: 'Brazil', short: 'BRA', kind: 'ai', flagCode: 'br', colors: ['#f7d417', '#1d7a3a'] },
    ],
    userSides: [0],                 // sides the player controls: [0], or [0, 1] in Versus
    returnTo: '#/run',              // where "Continue" goes after full time
    autoKickoff: true,              // skip the match screen's own pre-kickoff (a pre-match
                                    // screen already chose view, tactics and mentality)
  },
});

// 3. Back on your screen (after Continue → meta.returnTo)
const result = readMatchResult('run:qf');      // null until the match is over
if (result) {
  run.recordResult(runResultFor(result, 0));   // { goalsFor, goalsAgainst, outcome, shootout, players }
  clearMatch('run:qf');                        // so a refresh cannot apply it twice
}
```

## `buildMatchConfig({ sides, competition, tuning })`

- `sides`: two objects `{ name, short?, colors: [primary, secondary] | color + secondary,
  formation, players, tactics?, kind?, id?, code? }`. `players` = 11 profiles **in formation
  slot order** (`FORMATIONS[formation]` rows): catalog players, `assignClubLineup(...)` output or
  `draft.matchSide(i).players` (their `chem` is kept). A `draft.matchSide(i)` object can be
  passed as-is. `tactics` may set `style tempo width press fluidity mentality`.
- `competition`: merged over `{ mode: 'ai', difficulty: 'medium' }`. `mode: 'ai'` lets the
  engine's coach run side 1's tactics; use `'pvp'` for Versus. `knockout: true` → a level score
  goes to a penalty shootout (`extraTime: true` plays 30 minutes first).
- `tuning`: config snapshot, default the live `CONFIG` (Daily/challenges: `DEFAULT_CONFIG`).
- Kit clash: the away side wears its secondary colour (same rule as `matchSetup`). A side
  without `colors` but with a nation `code`/`flagCode` wears its home kit from `lib/kits.js`
  (`nationKit`); only sides with neither get the generic default.
- Returns `{ tuning, competition, teams, players }` round-tripped through
  `Match.importConfig` / `exportConfig` (plain JSON, exactly what the engine expects).
  `teamCode(name)` gives the 3-letter code used when `short` is missing ('Real Madrid' → 'RMA').

## `requestMatch(request, { go = true })`

Validates (`createMatchRequest`), stores and navigates to `#/match` (`go: false` to only
store). Defaults: `id` = `match-<seed36>`, `seed` = random, `view` = `'key'`, `duration` =
180 (`MATCH_SECONDS`: every view plays the same 3-minute match), `meta.context` = `'quick'`,
`meta.returnTo` = `'#/'`,
`meta.userSides` = every side whose `kind` is not `'ai'`. Only one match is held at a time; a
new request replaces the previous one (and its result).

Views:

| `view` | What the user sees | Engine |
| --- | --- | --- |
| `key` | Key Moments: ~30 s of highlights per half, half-time talk (mentality/tactics), second half simulated after the edits; while the first half simulates the stage shows the line-ups walking out (team sheet + progress) | `simulateHalf` twice in a Web Worker on `new Match(seed, 180)` |
| `full` | the whole match live (3 min), 1× / 2× / 4×, skip to next moment, live mentality + tactics | `new Match(seed, duration)` stepped on the main thread |
| `instant` | a short "simulating" beat, then the result | `simulateComplete` in a Web Worker |

All three views run the same 180 s match: with no tactical edits along the way, a request gives
the same result whichever way it is watched. A side that did not choose a mentality gets
`'auto'` (`buildMatchConfig`): it pushes when behind late and holds a late lead.

## The result (`readMatchResult(id)`)

Stored when the match finishes (and persisted, so a refresh shows it again):

```js
{
  id, seed, view, durationMode,          // durationMode === view
  context, title,
  teams: [{ name, short, color, secondary, formation, flagCode, kind }],   // home first
  userSides: [0],
  score: [h, a],                         // incl. extra time; never the shootout
  shootout: null | { score: [h, a], winner: 0 | 1, first,
                     kicks: [{ team, playerId, name, keeperId, round, suddenDeath, outcome, scored }] },
  winner: 0 | 1 | null,                  // null = draw (non-knockout only)
  outcomes: ['W' | 'D' | 'L', …],        // per side by the score: a shootout win is a 'D'
  extraTime: false, abandoned: null | team,
  xg: [h, a],
  momentum: [0.12, -0.3, …],             // per match minute, home − away (−1…1)
  stats: [{ possession /* % */, shots, onTarget, xg, bigChances, passes, completed,
            passAccuracy /* % */, saves, tackles, fouls, yellowCards, redCards, offsides,
            corners, woodwork }, …],
  events: [{ id, type, team, time, half, minute /* "67'" or "90+2'" */, text,
             playerId, player, assistId, assist, xg, bigChance, story, scoreAfter, ownGoal,
             penalty, shotType, saveType, difficulty, outcome, miss, frame, … }], // oldest first:
             // goals, saves (hard), woodwork, near misses, missed big chances, penalties,
             // cards, shootout kicks
  goals: [ /* the goal events above */ ],
  players: [{ id, profileId, team, slot, number, name, fullName, role, rating /* 3–10, 1 dp */,
              goals, assists, shots, onTarget, keyPasses, saves, tackles, interceptions,
              passes, completed, yellowCards, sentOff }],      // all 22, id = team * 11 + slot
  motm: { ...player, line: '2 goals · 1 assist' },
  heldYouBack: { ...player, reason } | null,   // lowest-rated player of userSides[0]
  heldBack: [player | null, player | null],    // per user side (Versus)
  analysis: [{ id, tone: 'positive' | 'negative' | 'neutral', label, detail }], // 2–3 chips
  share: '⚽ Liverpool 2–1 Real Madrid · Salah 23\' 67\' · World Cup Draft',
  finishedAt: ISO string,
}
```

`runResultFor(result, side)` converts it to `CupRun.recordResult` input (`goalsFor`,
`goalsAgainst`, `shootout: { winner: 'user' | 'opponent', score: [for, against] }`, `players:
[{ profileId, rating, goals, assists }]` of that side) plus `outcome`.

Other helpers: `currentRequest()`, `matchStore` (`{ request, status: 'ready' | 'live' | 'done',
result }`, works with `useStore`), `rematch()` (same request, new seed), `clearMatch(id?)`,
`MATCH_KEY` (`'football-draft-match'`), `teamCode(name)`.

After full time the screen offers **Continue** (→ `meta.returnTo`), **Rematch** (Quick,
Versus, Exhibition, demo — not Run/Daily) and **Home**. A refresh during a match restarts it
from kickoff (same seed); a refresh after full time shows the result again.

## Demo and tests

`#/match?demo=1[&view=key|full|instant][&knockout=1][&pens=1][&auto=1][&seed=n]` builds a request from
two real club XIs (`loadCatalog()` → `clubSquads` → best XI; `buildDemoRequest` in
`screens/match/demo.js`). `pens=1` sets `meta.forceShootout`: the match jumps straight to a
level knockout's penalty shootout (`forceShootout`, demo/test only — never in real requests). Browser flows: `match-key`,
`match-full`, `match-camera`, `match-instant`, `match-auto`, `match-pens` in
`tests/browser/flows.mjs`. The flows emulate reduced motion, which hides every animation;
`match-camera` turns motion back on (`football-draft-ui` → `{ motion: 'full' }`) to exercise the
action camera. To judge motion by eye, open the demo with normal motion and take bursts of
screenshots.

## Off-main-thread simulation (`app/services/sim-client.js`)

```js
import { createSimClient } from '../../services/sim-client.js';
const sim = createSimClient();                    // module Worker, main-thread fallback
const job = sim.complete(config, seed, { record: false, onProgress });   // Instant
const job = sim.half(match, { onProgress });      // Key Moments: one half from a live Match
const { result, frames, clips } = await job.promise;   // result is a real Match again
job.cancel();                                     // promise resolves to null
```

Results equal the in-thread `simulateComplete` / `simulateHalf` (same code; the Match is
structured-cloned and rehydrated). Recorded frames are trimmed to the highlight clips.

## The screen (`app/ui/screens/match/`)

| File | Role |
| --- | --- |
| `match.js` | route entry: demo/request → pre-kickoff, live view or stored result; leave confirmation |
| `controller.js` | `MatchController`: Match objects, RAF loop (runs only while something moves), Key Moments reels from the worker (half 1 is prefetched while the pre-kickoff is open), Full-mode ring buffer (12 s) for goal replays and "Next moment" (fast-forward, then the build-up at 1×), the action camera, cuts, moment captions, hit-stop and shake, commentary, sound (`MatchSoundEvents`), throttled HUD store |
| `renderer/` | canvas renderer `draw(ctx, view, state)` (`draw.js`: kit tokens with numbers, ball height/shadow, shot/pass trails, labels, effects, captions), `camera.js` (`ActionCamera`), `geometry.js` (transforms, `fullView`), `pitch.js` (the Floodlit-night pitch, painted once per size), `kits.js` |
| `camera-prefs.js` | camera choice per view (`football-draft-match-camera`: `{ key, full }`, each `'action'` or `'wide'`) |
| `commentary.js`, `report.js`, `demo.js` | pure helpers (Node-tested): event lines, result summary, analysis chips, share line, demo request |
| `prematch.js`, `live.js`, `hud.js`, `tactics.js`, `result.js` | Preact views |

Controls: Space play/pause, ←/→ (or ↓/↑) speed 1×/2×/4×, N next moment (Full) / next clip (Key
Moments), C camera. Mentality (Auto / Hold / Balanced / Push) is live in Full and at half-time
in Key Moments: Auto is the default (`tactics.mentality === 'auto'`), the control marks the
mentality in effect (`match.mentality(team)` → HUD `effective`), and picking one of the other
three overrides it until Auto is picked again. The tactics sheet follows `tacticAccess`
(formation only at half-time in AI/Versus matches). Goals (and the deciding penalty) get a
celebration banner, team-colour confetti and a slow-motion replay (reduced motion: a static
banner, no confetti, no replay, no camera moves). Screen readers hear goals only (`aria-live`,
never per tick).

### How the stage is drawn

Presentation reads match state and never writes it or draws simulation RNG (the renderer and
camera are Node-tested for that in `tests/match-ui-renderer.test.mjs`).

- **Layers.** `.match-stage__scene` holds two pitch canvases and the players' canvas. The pitch
  is painted once per size (`paintPitch`): a 1:1 copy for the full-pitch view and a 1.25×
  copy that CSS moves (`translate3d … scale`) when the camera zooms. A frame clears and redraws
  only the transparent players' canvas. Backing stores are capped at DPR 2 (measured: DPR 3 on
  a phone cost a third of the frames without making tokens easier to read).
- **No per-frame allocations** in `draw()` or the controller's `render()`: the view/scene
  objects are reused, positions, crowd scales, the ball trail and label boxes live in typed
  arrays (`createRenderState()`), font strings and text widths are cached (cleared when web
  fonts load). Keep it that way: no closures per token, no `measureText` per frame, no array
  literals in the draw path. Preact only re-renders through the HUD store (throttled to ~9 Hz,
  stats and the mentality mark about once a second).
- **Readability.** Token radius ≈ 1.06 m on screen (min 6.4 px, × DPR); tokens shrink to 66 %
  when another is within about two radii; draw order is by id with the receiver, scorer and
  carrier on top. The ball is at least 4 px in radius with a dark keyline and a halo, sits just
  outside the carrier's token, rises off its shadow with height, stretches along its path
  when struck and leaves a trail on passes and shots. Labels: the carrier (or set-piece taker),
  the intended receiver and — after a goal and through its replay — the scorer; each is placed
  in whichever of eight spots around the token covers the fewest tokens.
- **Camera** (`ActionCamera`): `'wide'` is the whole pitch; `'follow'` tracks the ball at
  1.5× (1.7× in goal replays, wider at 2× / 4× speed, tighter on stages much wider than the
  pitch), easing out for long passes, shots (the goal stays in frame) and set pieces, and wide
  for kick-offs and goal kicks; the ball can never leave the frame. Key Moments default to the
  action camera, Full to the whole pitch; the toggle in the controls (C) stores the choice per
  view. Goal replays are always the close-up. The shootout close-up goes through the same
  camera. Reduced motion: no camera at all (the toggle is hidden; the shootout view is set
  without easing).
- **Cuts.** When a restart repositions four or more players at once (corners, kick-offs,
  penalties) or places the ball outside the zoomed view, the controller shows a cut — a short
  fade (`.stage-cut`) and a camera snap — instead of tokens sliding across the pitch. Clip
  changes and replays cut the same way.
- **Moments.** Engine effects are drawn with their labels (shot type, SAVED / PARRIED / TIPPED
  OVER, FOUL, OFFSIDE, cards, PENALTY; SCORED / SAVED / MISSED in a shootout). The controller
  adds captions from events: OFF THE POST! / OFF THE BAR!, JUST WIDE! / JUST OVER!, GREAT SAVE!
  (save `difficulty` ≥ 0.3) / WHAT A SAVE! (≥ 0.6), CHANCE MISSED! (a big chance off target).
  A take-on shows afterimages and a swoosh on the dribbler and leaves the beaten defender
  faded and spinning. Hard shots, saves that mattered and the woodwork get a hit-stop (55–110
  ms of frozen picture — the simulation is stepped exactly as before, just later) and a short
  scene shake; goals shake too. Only at 1× speed and never under reduced motion.
