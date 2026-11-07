// TEMP STUB — replaced by DRAFT-UI at merge.
// Minimal stand-in for DRAFT-UI's pre-match screen: openPrematch() hands the match straight
// to the match screen (no line-up/tactics step). Contract:
//   openPrematch({ id?, seed, sides: [{ name, short, colors, flagCode?, kind, formation,
//                  tactics?, players (11 in slot order), editable }],
//                  competition: { mode, difficulty, knockout },
//                  meta: { context, title, returnTo, fixture? } })
import { buildMatchConfig, requestMatch } from './match-store.js';

export function openPrematch({ id, seed, sides, competition = {}, meta = {} }) {
  const config = buildMatchConfig({
    sides,
    competition: { ...competition, mode: competition.mode === 'pvp' ? 'pvp' : 'ai' },
  });
  const returnTo = meta.returnTo || '/';
  return requestMatch({
    id: id ?? meta.fixture,
    seed,
    view: 'key',
    config,
    meta: {
      ...meta,
      returnTo: returnTo.startsWith('#') ? returnTo : `#${returnTo}`,
      sides: sides.map(s => ({
        name: s.name,
        short: s.short,
        kind: s.kind,
        flagCode: s.flagCode ?? null,
        colors: s.colors,
      })),
    },
  });
}
