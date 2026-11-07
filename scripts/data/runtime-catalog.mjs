// Compiled catalog (compile-league-catalog output, or a schema-2 runtime file) → the runtime
// catalog the game decodes: only the fields the game uses, a nations table, normalised badges
// and precomputed club ratings / lineups (deriveCatalog).
import { deriveCatalog, explicitEvidence } from '../../app/core/players/catalog-derived.js';

const pick = (object, keys) =>
  Object.fromEntries(keys.filter(k => object[k] !== undefined).map(k => [k, object[k]]));

export const LEAGUE_FIELDS = [
  'id',
  'name',
  'tier',
  'optaScore',
  'optaRank',
  'logo',
  'coverage',
  'available',
  'sourcePlayers',
  'playerCount',
];
export const TEAM_FIELDS = ['id', 'name', 'leagueId', 'optaScore', 'primary', 'secondary'];

export function nationTable(players, codes) {
  const nations = new Map();
  for (const p of players) {
    const name = p.source.nationality,
      code = codes[name];
    if (!code) throw Error(`No flag code for nationality "${name}" (data/nation-codes.json)`);
    if (!nations.has(name))
      nations.set(name, { name, code, flag: `./assets/flags/${code}.svg`, players: 0, goalkeepers: 0 });
    const n = nations.get(name);
    n.players++;
    if (p.primaryPosition === 'GK') n.goalkeepers++;
  }
  return [...nations.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function toRuntimeCatalog(compiled, nationCodes) {
  const players = compiled.players.map(p => ({
    profileId: p.profileId,
    name: p.name,
    fullName: p.fullName,
    primaryPosition: p.primaryPosition,
    secondaryPositions: [...p.secondaryPositions],
    attrs: { ...p.attrs },
    foot: p.foot,
    weakFoot: p.weakFoot,
    tendencies: { ...p.tendencies },
    tags: [...p.tags],
    sourceOverall: p.sourceOverall,
    source: {
      club: p.source.club,
      clubId: p.source.clubId,
      leagueId: p.source.leagueId,
      nationality: p.source.nationality,
    },
    inference: { badges: explicitEvidence(p) },
  }));
  const playerCount = new Map();
  for (const p of players)
    playerCount.set(String(p.source.clubId), (playerCount.get(String(p.source.clubId)) || 0) + 1);
  return deriveCatalog({
    compilerVersion: compiled.compilerVersion,
    source: compiled.source,
    selection: compiled.selection,
    attributeKeys: [...compiled.attributeKeys],
    leagues: compiled.leagues.map(l => pick(l, LEAGUE_FIELDS)),
    teams: compiled.teams.map(t => ({
      ...pick(t, TEAM_FIELDS),
      playerCount: playerCount.get(String(t.id)) || 0,
    })),
    nations: nationTable(players, nationCodes),
    players,
  });
}
