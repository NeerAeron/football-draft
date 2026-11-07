# Documentation

Start with the top-level [`README.md`](../README.md) (the game, running, data, credits) and
[`CLAUDE.md`](../CLAUDE.md) (layout, module map, storage keys, invariants, conventions).

## Contracts and guides

Keep these current when you change the code they describe.

| Document | Covers |
| --- | --- |
| [`ui-guide.md`](ui-guide.md) | The UI (`app/ui/`): folders, Preact + htm, adding a screen, routing, stores, PlayerView, components, tokens, accessibility, motion and sound, gallery fixture |
| [`draft-api.md`](draft-api.md) | `app/core/draft/`: draft modes and odds, the session flow and snapshot, placement and fit, Links, match setup, the opponent ladder, persistence, determinism |
| [`competition-api.md`](competition-api.md) | `app/core/competition/`: World Cup Run, the fast rating model, the Daily Challenge, share text and challenge links |
| [`engine-events.md`](engine-events.md) | `app/core/sim/` as seen by a match screen: state, events, controls |
| [`ui-match.md`](ui-match.md) | Handing a match to `#/match` and reading its result (`match-store.js`), views, the simulation worker client, the match screen files |
| [`ui-draft.md`](ui-draft.md) | Setup, the draft board and pre-match screens; `draft-store.js` and `prematch-store.js` |
| [`ui-run.md`](ui-run.md) | World Cup Run, Daily Challenge, Exhibition and challenge-link screens; their persistence |

## Calibration notes

| Document | Covers |
| --- | --- |
| [`calibration.md`](calibration.md) | Match engine calibration: method, `match-calibration.mjs` runs, before/after of the engine package |
| [`retention-calibration.md`](retention-calibration.md) | Possession and shot-volume calibration of the engine (method, runners, results) |
| [`cards-calibration.md`](cards-calibration.md) | Loose-ball recovery and discipline (fouls, cards) validation |

Calibration runners live in `tools/calibration/` (manual, not part of `npm test`); the draft
baselines behind the opponent ladder come from `tools/calibration/draft-baselines.mjs`.

## History

| Document | Covers |
| --- | --- |
| [`history.md`](history.md) | The pre-overhaul README and development log, kept verbatim (paths and some claims are out of date) |
