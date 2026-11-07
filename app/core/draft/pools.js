// Catalog index for the draft session, the opponents and the competitions: nations (field,
// pots, call-ups), leagues and clubs, cached role ratings and fast best-XI assignment.
// Pure and deterministic: every list has a total order (rating, then profileId / name).
import { CONFIG } from '../config/config.js';
import { overallRating, positionFamiliarity, playerTier } from '../players/ratings.js';
import { FORMATIONS } from '../players/formations.js';
import { NATION_CODES } from './nation-codes.js';

export const ROLES = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LM', 'RM', 'LW', 'RW', 'ST'];
const ROLE_INDEX = Object.fromEntries(ROLES.map((r, i) => [r, i]));
/** Pitch line of a role: GK, DEF (CB/LB/RB), MID (DM/CM/AM/LM/RM) or ATT (LW/RW/ST). */
export const LINE_OF = {
  GK: 'GK',
  CB: 'DEF',
  LB: 'DEF',
  RB: 'DEF',
  DM: 'MID',
  CM: 'MID',
  AM: 'MID',
  LM: 'MID',
  RM: 'MID',
  LW: 'ATT',
  RW: 'ATT',
  ST: 'ATT',
};
export const LEAGUE_TIERS = ['A', 'B', 'C', 'D', 'F'];
export const isKeeper = p => p.primaryPosition === 'GK';

// ---- role ratings ---------------------------------------------------------------------
// overallRating() costs ~2 µs; drafting and best-XI search read it thousands of times.
// The table is rebuilt whenever CONFIG.ratings changes (checked once per public call).
let ratingStamp = null,
  ratingTable = new WeakMap();
export function refreshRatings() {
  const stamp = JSON.stringify(CONFIG.ratings);
  if (stamp !== ratingStamp) {
    ratingStamp = stamp;
    ratingTable = new WeakMap();
  }
  return ratingStamp;
}
refreshRatings();
// Lazily filled: [0..11] unrounded OVR per role, [12..23] familiarity per role, [24] natural.
function table(p) {
  let t = ratingTable.get(p);
  if (!t) ratingTable.set(p, (t = new Float64Array(25).fill(NaN)));
  return t;
}
/** Unrounded OVR of a player in a role (after familiarity). */
export function roleRating(p, role) {
  const t = table(p),
    i = ROLE_INDEX[role];
  return t[i] === t[i] ? t[i] : (t[i] = overallRating(p, false, role));
}
/** Position familiarity 0.6–1 of a player in a role. */
export function roleFit(p, role) {
  const t = table(p),
    i = 12 + ROLE_INDEX[role];
  return t[i] === t[i] ? t[i] : (t[i] = positionFamiliarity(p, role));
}
/** Unrounded OVR in the player's primary position. */
export function naturalRating(p) {
  const t = table(p);
  return t[24] === t[24] ? t[24] : (t[24] = overallRating(p, false, p.primaryPosition));
}
/** Highest natural rating first; ties by profileId (total order, deterministic). */
export const byNatural = (a, b) =>
  naturalRating(b) - naturalRating(a) || (a.profileId < b.profileId ? -1 : 1);

// ---- best XI ------------------------------------------------------------------------------
// Rectangular Hungarian assignment of slots to players maximising the summed slot rating.
// Same model as players/club-lineups.js assignClubLineup, on cached ratings.
function assign(rows, players, minimumFit) {
  const n = rows.length,
    m = players.length;
  if (m < n) return null;
  const cost = new Float64Array(n * m);
  for (let i = 0; i < n; i++) {
    const role = rows[i][2];
    for (let j = 0; j < m; j++) {
      const p = players[j];
      cost[i * m + j] =
        (role === 'GK') !== isKeeper(p) || roleFit(p, role) < minimumFit
          ? 1e6
          : -roleRating(p, role);
    }
  }
  const u = new Float64Array(n + 1),
    v = new Float64Array(m + 1),
    owner = new Int32Array(m + 1),
    via = new Int32Array(m + 1),
    best = new Float64Array(m + 1),
    used = new Uint8Array(m + 1);
  for (let i = 1; i <= n; i++) {
    owner[0] = i;
    let column = 0;
    best.fill(Infinity);
    used.fill(0);
    do {
      used[column] = 1;
      const row = owner[column];
      let delta = Infinity,
        next = 0;
      for (let j = 1; j <= m; j++)
        if (!used[j]) {
          const reduced = cost[(row - 1) * m + j - 1] - u[row] - v[j];
          if (reduced < best[j]) {
            best[j] = reduced;
            via[j] = column;
          }
          if (best[j] < delta) {
            delta = best[j];
            next = j;
          }
        }
      for (let j = 0; j <= m; j++)
        if (used[j]) {
          u[owner[j]] += delta;
          v[j] -= delta;
        } else best[j] -= delta;
      column = next;
    } while (owner[column] !== 0);
    do {
      const previous = via[column];
      owner[column] = owner[previous];
      column = previous;
    } while (column !== 0);
  }
  const lineup = Array(n);
  let total = 0;
  for (let j = 1; j <= m; j++)
    if (owner[j]) {
      const c = cost[(owner[j] - 1) * m + j - 1];
      if (c >= 1e5) return null;
      lineup[owner[j] - 1] = players[j - 1];
      total -= c;
    }
  return { players: lineup, total };
}
// Only the best 11 eligible players per role can appear in an optimal XI (an unused better
// player could always be swapped in), so large pools are pruned to that union. Very large
// national pools are first cut to their best 80 outfield players and 5 keepers by natural OVR.
function candidates(players, formations, minimumFit) {
  if (players.length <= 30) return players;
  const sorted = [...players].sort(byNatural),
    head = [
      ...sorted.filter(p => !isKeeper(p)).slice(0, 80),
      ...sorted.filter(isKeeper).slice(0, 5),
    ];
  const roles = new Set(formations.flatMap(f => FORMATIONS[f].map(r => r[2])));
  const keep = new Set();
  for (const role of roles)
    head
      .filter(p => (role === 'GK') === isKeeper(p) && roleFit(p, role) >= minimumFit)
      .sort(
        (a, b) => roleRating(b, role) - roleRating(a, role) || (a.profileId < b.profileId ? -1 : 1),
      )
      .slice(0, 11)
      .forEach(p => keep.add(p));
  return [...keep].sort(byNatural);
}
/**
 * Best XI of a squad: the formation and slot assignment with the highest mean slot rating.
 * Players below `minimumFit` in a slot are not considered there; if no formation works at
 * the minimum, a fallback of 0.6 (any compatible position) is tried.
 * @returns {{formation, players, rating}|null} players in formation slot order.
 */
export function bestEleven(
  players,
  { formations = Object.keys(FORMATIONS), minimumFit = CONFIG.ai.minimumFit } = {},
) {
  for (const fit of minimumFit > 0.6 ? [minimumFit, 0.6] : [minimumFit]) {
    const pool = candidates(players, formations, fit);
    let best = null;
    for (const formation of formations) {
      const result = assign(FORMATIONS[formation], pool, fit);
      if (result && (!best || result.total > best.total + 1e-9))
        best = { formation, players: result.players, total: result.total };
    }
    if (best) return { formation: best.formation, players: best.players, rating: best.total / 11 };
  }
  return null;
}
/** Mean slot rating of an XI in a formation (slot order). Missing players are skipped. */
export function lineupRating(players, formation) {
  const rows = FORMATIONS[formation];
  let sum = 0,
    n = 0;
  players.forEach((p, i) => {
    if (p) {
      sum += roleRating(p, rows[i][2]);
      n++;
    }
  });
  return n ? sum / n : 0;
}

// ---- catalog index --------------------------------------------------------------------
const rulesStamp = rules =>
  JSON.stringify([rules.nations, rules.clubs, rules.minimumLeaguePlayers]);
const indexes = new WeakMap();
/** The draft rules a session snapshots (defaults: the live CONFIG.draft). */
export function draftRules(source = CONFIG.draft) {
  return structuredClone({
    nations: source.nations,
    leagueTierWeights: source.leagueTierWeights,
    clubs: source.clubs,
    rerolls: source.rerolls,
    ladder: source.ladder,
    links: source.links,
    minimumLeaguePlayers: source.minimumLeaguePlayers,
  });
}
/**
 * Index a decoded catalog ({players, leagues, teams, nations?}). Cached per catalog object,
 * draft rules and ratings. Works with or without catalog.nations (then nations are grouped
 * from players[].source.nationality and flag codes come from NATION_CODES).
 */
export function catalogIndex(catalog, rules = draftRules()) {
  const stamp = refreshRatings() + rulesStamp(rules);
  const cached = indexes.get(catalog);
  if (cached?.stamp === stamp) return cached.index;
  const index = buildIndex(catalog, rules);
  indexes.set(catalog, { stamp, index });
  return index;
}
function buildIndex(catalog, rules) {
  const players = catalog.players;
  const byId = new Map(players.map(p => [p.profileId, p]));
  // Nations
  const meta = new Map((catalog.nations || []).map(n => [n.name, n]));
  const groups = new Map();
  for (const p of players) {
    const name = p.source?.nationality;
    if (!name) continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(p);
  }
  const nations = new Map();
  for (const [name, members] of groups) {
    const info = meta.get(name),
      code = info?.code || NATION_CODES[name] || null;
    members.sort(byNatural);
    nations.set(name, {
      id: name,
      name,
      code,
      flag: info?.flag ?? null,
      players: members,
      goalkeepers: members.filter(isKeeper).length,
    });
  }
  const n = rules.nations;
  const eligible = [...nations.values()]
    .filter(x => x.players.length >= n.minimumPlayers && x.goalkeepers >= n.minimumGoalkeepers)
    .map(x => ({ nation: x, xi: bestEleven(x.players) }))
    .filter(x => x.xi);
  for (const { nation, xi } of eligible) nation.strength = xi.rating;
  eligible.sort((a, b) => b.xi.rating - a.xi.rating || a.nation.name.localeCompare(b.nation.name));
  const field = eligible.slice(0, n.fieldSize).map(({ nation }, i) => {
    nation.pot = Math.floor(i / n.potSize) + 1;
    return nation;
  });
  // Leagues and clubs
  const teamsById = new Map((catalog.teams || []).map(t => [String(t.id), t]));
  const leagueGroups = new Map();
  for (const p of players) {
    const id = p.source?.leagueId == null ? '' : String(p.source.leagueId);
    if (!id) continue;
    if (!leagueGroups.has(id)) leagueGroups.set(id, []);
    leagueGroups.get(id).push(p);
  }
  const leagues = (catalog.leagues || [])
    .filter(
      l =>
        l.available !== false &&
        (leagueGroups.get(String(l.id))?.length || 0) >= rules.minimumLeaguePlayers,
    )
    .map(l => {
      const members = leagueGroups.get(String(l.id)).sort(byNatural),
        clubGroups = new Map();
      for (const p of members) {
        const id = String(p.source.clubId);
        if (!clubGroups.has(id)) clubGroups.set(id, []);
        clubGroups.get(id).push(p);
      }
      const league = {
        id: String(l.id),
        name: l.name,
        tier: LEAGUE_TIERS.includes(l.tier) ? l.tier : 'F',
        logo: l.logo || null,
        players: members,
      };
      league.clubs = [...clubGroups]
        .map(([id, squad]) => {
          const t = teamsById.get(id) || {};
          return {
            id,
            name: t.name || squad[0].source.club || id,
            leagueId: league.id,
            leagueName: league.name,
            tier: t.tier || null,
            primary: t.primary || null,
            secondary: t.secondary || null,
            players: squad,
            goalkeepers: squad.filter(isKeeper).length,
            strength:
              squad.slice(0, 11).reduce((s, p) => s + naturalRating(p), 0) /
              Math.min(11, squad.length),
          };
        })
        .sort((a, b) => b.strength - a.strength || a.name.localeCompare(b.name));
      league.spinnableClubs = league.clubs.filter(
        c => c.players.length >= rules.clubs.minimumPlayers,
      );
      return league;
    })
    .sort(
      (a, b) =>
        LEAGUE_TIERS.indexOf(a.tier) - LEAGUE_TIERS.indexOf(b.tier) || a.name.localeCompare(b.name),
    );
  const clubs = new Map(leagues.flatMap(l => l.clubs.map(c => [c.id, c])));
  return {
    catalog,
    players,
    byId,
    nations,
    field,
    leagues,
    leagueById: new Map(leagues.map(l => [l.id, l])),
    clubs,
  };
}

/**
 * Best available call-ups of a nation: the best `squadGoalkeepers` keepers and at least
 * `squadDefenders` / `squadMidfielders` / `squadAttackers` by line, then the best remaining
 * outfield players up to `squadSize` (natural OVR order). `available(p)` filters drafted or
 * excluded players, so the list refills from the next best as players are taken.
 */
export function callUps(nation, available, rules = CONFIG.draft.nations) {
  const need = {
    GK: rules.squadGoalkeepers,
    DEF: rules.squadDefenders,
    MID: rules.squadMidfielders,
    ATT: rules.squadAttackers,
  };
  let open = need.GK + need.DEF + need.MID + need.ATT;
  const chosen = new Set();
  for (const p of nation.players) {
    if (!open) break;
    const line = LINE_OF[p.primaryPosition];
    if (need[line] > 0 && available(p)) {
      need[line]--;
      open--;
      chosen.add(p);
    }
  }
  for (const p of nation.players) {
    if (chosen.size >= rules.squadSize) break;
    if (!chosen.has(p) && !isKeeper(p) && available(p)) chosen.add(p);
  }
  return [...chosen].sort(byNatural);
}

const stamps = new WeakMap();
/**
 * Short fingerprint of a catalog's draft-relevant content (ids, positions, nation, club,
 * league). Saved drafts and challenge links carry it so a changed database can be detected.
 */
export function catalogStamp(catalog) {
  let stamp = stamps.get(catalog);
  if (!stamp) {
    let h = 0x811c9dc5;
    for (const p of catalog.players) {
      const s = p.source || {},
        text = `${p.profileId}|${p.primaryPosition}|${s.nationality}|${s.clubId}|${s.leagueId};`;
      for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    }
    stamp = catalog.players.length.toString(36) + h.toString(36);
    stamps.set(catalog, stamp);
  }
  return stamp;
}
/** Tier name (Superstar / Star / Starter / Normal / Bench) of a player's natural rating. */
export const tierName = p => playerTier(p).name;
