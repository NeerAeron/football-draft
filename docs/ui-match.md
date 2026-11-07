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
- Kit clash: the away side wears its secondary colour (same rule as `matchSetup`). Nations
  without a kit colour get a default — pass `colors` for real kits.
- Returns `{ tuning, competition, teams, players }` round-tripped through
  `Match.importConfig` / `exportConfig` (plain JSON, exactly what the engine expects).
  `teamCode(name)` gives the 3-letter code used when `short` is missing ('Real Madrid' → 'RMA').

## `requestMatch(request, { go = true })`

Validates (`createMatchRequest`), stores and navigates to `#/match` (`go: false` to only
store). Defaults: `id` = `match-<seed36>`, `seed` = random, `view` = `'key'`, `duration` =
180 for Full (300 allowed), `meta.context` = `'quick'`, `meta.returnTo` = `'#/'`,
`meta.userSides` = every side whose `kind` is not `'ai'`. Only one match is held at a time; a
new request replaces the previous one (and its result).

Views:

| `view` | What the user sees | Engine |
| --- | --- | --- |
| `key` | Key Moments: ~30 s of highlights per half, half-time talk (mentality/tactics), second half simulated after the edits | `simulateHalf` twice in a Web Worker on `new Match(seed, 300)` |
| `full` | the whole match live (3 min), 1× / 2× / 4×, skip to next moment, live mentality + tactics | `new Match(seed, duration)` stepped on the main thread |
| `instant` | a short "simulating" beat, then the result | `simulateComplete` in a Web Worker (300 s profile) |

With no half-time edits, Key Moments and Instant give the same result for the same request.

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
  share: '⚽ Liverpool 2–1 Real Madrid · Salah 23\' 67\' · Football Draft',
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
`match-full`, `match-instant`, `match-pens` in `tests/browser/flows.mjs`.

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
