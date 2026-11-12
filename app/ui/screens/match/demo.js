// #/match?demo=1[&view=key|full|instant][&knockout=1][&et=1][&seed=n]: a match request from
// two real club XIs (best XI in each club's best formation) for testing and screenshots.
// `et=1` (or `pens=1`): a knockout match that is level at 90' — it opens on the break before
// extra time; the seed decides whether extra time settles it or it goes to penalties.
import { clubSquads } from '../../../core/players/club-lineups.js';
import { buildMatchConfig, createMatchRequest, MATCH_VIEWS } from '../../lib/match-store.js';

export const DEMO_SEED = 7;
const TOP = 16;

export function buildDemoRequest(catalog, query = {}) {
  const raw = Number(query.seed);
  const seed =
    query.seed != null && query.seed !== '' && Number.isFinite(raw) ? raw >>> 0 : DEMO_SEED;
  const level = query.et === '1' || query.pens === '1',
    knockout = query.knockout === '1' || level;
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
      title: level ? 'Demo · Extra time' : knockout ? 'Demo · Knockout' : 'Demo · Friendly',
      returnTo: '#/',
      userSides: [0],
      forceLevel: level,
      autoKickoff: query.auto === '1',
    },
  });
}

/**
 * Demo/testing only: a knockout match at the full-time whistle, level — in the break before
 * extra time (or, without `competition.extraTime`, straight into the shootout).
 */
export function forceLevel(m) {
  if (!m.competition?.knockout) m.competition = { ...m.competition, knockout: true };
  m.half = 2;
  m.periodStart = m.duration / 2;
  m.elapsed = m.duration;
  m.time = 5400;
  m.mode = 'play';
  m.finishPeriod();
  return m;
}
