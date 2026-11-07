// #/match?demo=1[&view=key|full|instant][&knockout=1][&pens=1][&seed=n]: a match request from
// two real club XIs (best XI in each club's best formation) for testing and screenshots.
import { clubSquads } from '../../../core/players/club-lineups.js';
import { buildMatchConfig, createMatchRequest, MATCH_VIEWS } from '../../lib/match-store.js';

export const DEMO_SEED = 7;
const TOP = 16;

export function buildDemoRequest(catalog, query = {}) {
  const raw = Number(query.seed);
  const seed =
    query.seed != null && query.seed !== '' && Number.isFinite(raw) ? raw >>> 0 : DEMO_SEED;
  const knockout = query.knockout === '1' || query.pens === '1';
  const clubs = clubSquads(catalog)
    .filter(c => c.bestFormation && c.lineups?.[c.bestFormation])
    .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0) || String(a.id).localeCompare(String(b.id)))
    .slice(0, TOP);
  if (clubs.length < 2) throw new Error('The catalog has no club XIs');
  const i = seed % clubs.length,
    j = (i + 1 + (Math.floor(seed / clubs.length) % (clubs.length - 1))) % clubs.length;
  const sides = [clubs[i], clubs[j]].map((c, n) => ({
    name: c.name,
    colors: [c.primary, c.secondary],
    formation: c.bestFormation,
    players: c.lineups[c.bestFormation],
    kind: n === 0 ? 'user' : 'ai',
    id: c.id,
  }));
  const config = buildMatchConfig({
    sides,
    competition: { mode: 'ai', difficulty: 'medium', knockout },
  });
  return createMatchRequest({
    id: `demo-${seed}${knockout ? '-ko' : ''}`,
    seed,
    view: MATCH_VIEWS.includes(query.view) ? query.view : 'key',
    config,
    meta: {
      context: 'demo',
      title:
        query.pens === '1' ? 'Demo · Penalties' : knockout ? 'Demo · Knockout' : 'Demo · Friendly',
      returnTo: '#/',
      userSides: [0],
      forceShootout: query.pens === '1',
    },
  });
}
