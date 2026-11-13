// Pre-match hand-off: any screen that has two XIs (Quick and Versus drafts, RUN-UI's run
// matches and exhibitions) opens the generic pre-match screen (#/prematch) with
// openPrematch(); the screen edits lineups/tactics through the helpers below and kickOff()
// hands the match to MATCH-UI (lib/match-store.js requestMatch). Framework-free (Node tests).
// Full documentation: docs/ui-draft.md#pre-match.
//
//   openPrematch({
//     id: 'run:abc:qf',              // carried to requestMatch → readMatchResult(id)
//     seed,                          // match seed (uint32)
//     sides: [{ name, short?, colors: [p, s], flagCode?, kind: 'user'|'ai'|'p2', formation,
//               tactics?, players: [11 profiles in slot order], editable,
//               formationLocked? (the formation cannot change, here or in the match: a World Cup
//               run's group stage) }, …],
//     competition: { mode?: 'ai'|'pvp', difficulty: 'pro', knockout: false },
//     meta: { context: 'run', title: 'Quarter-final', returnTo: '#/run', fixture: 'run:abc:qf' },
//   });
import { FORMATIONS } from '../../core/players/formations.js';
import { STYLES, TACTICS } from '../../core/players/traits.js';
import { roleRating, roleFit, naturalRating, isKeeper } from '../../core/draft/pools.js';
import { teamLinks, CHEM_CAP } from '../../core/draft/links.js';
import { NATURAL_FIT } from '../../core/draft/session.js';
import { CONFIG, DEFAULT_CONFIG } from '../../core/config/config.js';
import {
  buildMatchConfig,
  requestMatch,
  matchStore,
  teamCode,
  MATCH_VIEWS,
} from './match-store.js';
import { nationKit, nationTrigram } from './kits.js';
import { readJSON, writeJSON, removeKey } from './storage.js';
import { createStore } from './create-store.js';
import { randomSeed } from './random.js';

export const PREMATCH_KEY = 'football-draft-prematch';
export const VIEW_KEY = 'football-draft-match-view';
const FORMAT = 1;
const KINDS = ['user', 'ai', 'p2'];
// Just the four options: no helper lines under them anywhere.
export const MENTALITIES = [
  { value: 'auto', label: 'Auto' },
  { value: 'push', label: 'Push' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'hold', label: 'Hold' },
];
export const TACTIC_DEFAULTS = {
  style: 'balanced',
  tempo: 3,
  width: 3,
  press: 3,
  mentality: 'auto',
};
export const TACTIC_SLIDERS = ['tempo', 'width', 'press'].map(key => ({ key, ...TACTICS[key] }));

/** Engine coach level for a draft difficulty id (other values pass through). */
export const COACH_LEVEL = {
  pro: 'medium',
  worldclass: 'hard',
  legendary: 'impossible',
};
const DEFAULT_KITS = [
  ['#d9f580', '#16213a'],
  ['#baaff0', '#16213a'],
];

// ---------- normalising ----------

function cleanTactics(t = {}) {
  const out = { ...TACTIC_DEFAULTS };
  if (STYLES[t.style]) out.style = t.style;
  for (const { key } of TACTIC_SLIDERS)
    if (Number.isFinite(Number(t[key]))) out[key] = Math.min(5, Math.max(1, Math.round(t[key])));
  if (MENTALITIES.some(m => m.value === t.mentality)) out.mentality = t.mentality;
  return out;
}

function normalizeSide(side, i) {
  if (!side || typeof side !== 'object') throw new TypeError(`Side ${i + 1} is missing`);
  if (!FORMATIONS[side.formation]) throw new RangeError(`Unknown formation "${side.formation}"`);
  if (!Array.isArray(side.players) || side.players.length !== 11 || side.players.some(p => !p))
    throw new RangeError(`Side ${i + 1} needs eleven players in slot order`);
  const colors = (side.colors || [side.color, side.secondary]).filter(Boolean);
  const kind = KINDS.includes(side.kind) ? side.kind : i === 0 ? 'user' : 'ai';
  return {
    name: String(side.name || `Team ${i + 1}`),
    short:
      side.short ||
      nationTrigram(side.flagCode ?? side.code) ||
      teamCode(side.name || `Team ${i + 1}`),
    colors: colors.length ? colors : nationKit(side.flagCode ?? side.code) || DEFAULT_KITS[i],
    flagCode: side.flagCode ?? side.code ?? null,
    kind,
    formation: side.formation,
    tactics: cleanTactics(side.tactics),
    players: side.players.map(p => p),
    editable: side.editable ?? kind !== 'ai',
    // The formation picked before the draft, kept for this match (World Cup: the group stage).
    formationLocked: !!side.formationLocked,
    // A run opponent in knockout form (core/competition/cup.js FIELD_FORM): rating points its
    // players carry on top of their boosts — counted in the side's effective rating.
    form: Number.isFinite(side.form) ? side.form : 0,
  };
}

function storedView() {
  const own = readJSON(VIEW_KEY, null);
  return MATCH_VIEWS.includes(own) ? own : 'key';
}

/** Fill defaults and validate an openPrematch() payload (throws on malformed sides). */
export function normalizePrematch(input = {}) {
  if (!Array.isArray(input.sides) || input.sides.length !== 2)
    throw new TypeError('openPrematch needs two sides');
  const sides = input.sides.map(normalizeSide);
  const seed = Number.isFinite(input.seed) ? input.seed >>> 0 : randomSeed();
  const meta = { ...(input.meta || {}) };
  const id = String(input.id ?? meta.fixture ?? `match-${seed.toString(36)}`);
  return {
    format: FORMAT,
    id,
    seed,
    sides,
    competition: {
      mode: input.competition?.mode ?? null,
      difficulty: input.competition?.difficulty ?? 'pro',
      knockout: !!input.competition?.knockout,
      extraTime: !!input.competition?.extraTime,
    },
    meta: {
      ...meta,
      context: meta.context || 'quick',
      title: meta.title || '',
      returnTo: meta.returnTo || '#/',
    },
    useDefaultRules: !!input.useDefaultRules,
    // Ball Knower: no OVRs, odds or rating numbers until the result.
    hideRatings: !!(input.hideRatings ?? meta.hideRatings),
    view: MATCH_VIEWS.includes(input.view) ? input.view : storedView(),
  };
}

function load() {
  const saved = readJSON(PREMATCH_KEY, null);
  if (!saved || saved.format !== FORMAT) return null;
  try {
    return normalizePrematch(saved);
  } catch {
    return null;
  }
}

/** The pending pre-match (or null), persisted under 'football-draft-prematch'. */
export const prematchStore = createStore(load(), { merge: false });
prematchStore.subscribe(state => {
  if (state) writeJSON(PREMATCH_KEY, state);
  else removeKey(PREMATCH_KEY);
});

/** Store a pre-match and (by default) go to #/prematch. Returns the normalised payload. */
export function openPrematch(input, { go = true } = {}) {
  const data = normalizePrematch(input);
  prematchStore.set(data);
  const loc = globalThis.location;
  if (go && loc && loc.hash !== '#/prematch') loc.hash = '#/prematch';
  return data;
}

export function clearPrematch() {
  prematchStore.set(null);
}
// A pre-match has served once its match is over: when the result of the match it kicked off
// is stored, it is forgotten (the key does not outlive the match; going back from a finished
// match never offers to kick the same fixture off again).
const served = state => {
  const pending = prematchStore.get();
  if (pending && state?.result && state.request?.id === pending.id) clearPrematch();
};
matchStore.subscribe(served);
served(matchStore.get());

// ---------- lineup helpers (pure) ----------

const rolesOf = formation => FORMATIONS[formation].map(r => r[2]);

/** Per slot: { role, rating (in that role), natural, familiarity, natural fit? }. */
export function slotFits(players, formation) {
  return rolesOf(formation).map((role, i) => {
    const p = players[i];
    if (!p) return null;
    const familiarity = roleFit(p, role);
    return {
      role,
      rating: Math.round(roleRating(p, role)),
      natural: Math.round(naturalRating(p)),
      familiarity,
      fits: familiarity >= NATURAL_FIT,
    };
  });
}

/**
 * Team OVR (mean slot rating), mates summary and effective rating (OVR + chem; `form`: what a
 * run opponent in knockout form carries on top, up to the chem cap).
 */
export function lineupStrength(players, formation, links = CONFIG.draft.links, form = 0) {
  const roles = rolesOf(formation);
  const ratings = players
    .map((p, i) => (p ? roleRating(p, roles[i]) : null))
    .filter(r => r != null);
  const rating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
  const summary = teamLinks(players, links);
  const filled = summary.players.filter(Boolean),
    chem = form
      ? filled.reduce((sum, e) => sum + Math.min(CHEM_CAP, e.chem + form), 0) /
        Math.max(1, filled.length)
      : summary.chem;
  return {
    rating: Math.round(rating * 10) / 10,
    effective: Math.round((rating + chem) * 100) / 100,
    links: {
      score: summary.score,
      maxScore: summary.maxScore,
      total: summary.total,
      shown: summary.shown,
      pairs: summary.pairs,
    },
  };
}

/** Can the players in slots a and b swap? (the GK slot takes keepers only) */
export function canSwap(players, formation, a, b) {
  const roles = rolesOf(formation);
  if (a === b || !roles[a] || !roles[b]) return false;
  const ok = (p, slot) => !p || (roles[slot] === 'GK') === isKeeper(p);
  return ok(players[a], b) && ok(players[b], a);
}

const placed = (p, slot, role) => ({ ...p, slot, role });

/** Swap two slots (returns a new array, or null when not allowed). */
export function swapSlots(players, formation, a, b) {
  if (!canSwap(players, formation, a, b)) return null;
  const roles = rolesOf(formation);
  const next = [...players];
  [next[a], next[b]] = [next[b], next[a]];
  next[a] = placed(next[a], a, roles[a]);
  next[b] = placed(next[b], b, roles[b]);
  return next;
}

// The best assignment of an XI to a formation: the best keeper in goal, the outfield players
// on the slots that give the highest total slot rating (= the best team OVR). Exact: a DP over
// slot masks on a 10 × 10 table of slot ratings (about 10,000 additions, so all 21 formations
// are compared in a millisecond or two — no worker needed, even on a phone). Not the Hungarian
// solver of core/util/assignment.js: with a slot rating table this small the exact DP is
// simpler, handles fewer than ten outfield players (any subset of the slots) and takes a
// memoised rating function.
function bestSlots(players, formation, rate = roleRating) {
  const roles = rolesOf(formation);
  const gkSlot = roles.indexOf('GK');
  let keeper = null;
  for (const p of players)
    if (p && isKeeper(p) && (!keeper || rate(p, 'GK') > rate(keeper, 'GK'))) keeper = p;
  const outfield = players.filter(p => p && p !== keeper);
  const slots = roles.map((r, i) => i).filter(i => i !== gkSlot);
  const n = outfield.length,
    size = 1 << slots.length;
  const table = outfield.map(p => slots.map(slot => rate(p, roles[slot])));
  // best[mask]: the best total with the first popcount(mask) players on the slots of mask.
  const best = new Float64Array(size).fill(-Infinity),
    choice = new Int8Array(size).fill(-1);
  best[0] = 0;
  for (let mask = 1; mask < size; mask++) {
    let i = -1;
    for (let m = mask; m; m &= m - 1) i++;
    if (i >= n) continue;
    for (let k = 0; k < slots.length; k++) {
      if (!(mask & (1 << k))) continue;
      const v = best[mask ^ (1 << k)] + table[i][k];
      if (v > best[mask] + 1e-9) {
        best[mask] = v;
        choice[mask] = k;
      }
    }
  }
  // With fewer than ten outfield players any n slots may be used: take the best set.
  let end = 0;
  for (let mask = 1; mask < size; mask++) {
    let bits = 0;
    for (let m = mask; m; m &= m - 1) bits++;
    if (bits === n && best[mask] > best[end] + 1e-9) end = mask;
  }
  const next = Array(roles.length).fill(null);
  if (keeper) next[gkSlot] = keeper;
  for (let mask = end, i = n - 1; i >= 0; i--) {
    const k = choice[mask];
    next[slots[k]] = outfield[i];
    mask ^= 1 << k;
  }
  const total = (n ? best[end] : 0) + (keeper ? rate(keeper, 'GK') : 0);
  return { players: next, roles, total, count: n + (keeper ? 1 : 0) };
}

/**
 * Re-slot an XI into another formation: the best keeper in goal, the outfield players on the
 * assignment with the highest total slot rating — the best team OVR that formation can give.
 */
export function reslot(players, formation) {
  const { players: next, roles } = bestSlots(players, formation);
  return next.map((p, i) => (p ? placed(p, i, roles[i]) : p));
}

/**
 * The team OVR (one decimal) every formation would give this XI with its best lineup:
 * { '433': 84.2, '4231': 83.9, … } — what the formation picker shows.
 */
export function formationRatings(players) {
  const out = {},
    seen = new Map(), // player → { role: rating }: 21 formations share a dozen roles
    rate = (p, role) => {
      let row = seen.get(p);
      if (!row) seen.set(p, (row = {}));
      return (row[role] ??= roleRating(p, role));
    };
  for (const formation of Object.keys(FORMATIONS)) {
    const { total, count } = bestSlots(players, formation, rate);
    out[formation] = count ? Math.round((total / count) * 10) / 10 : 0;
  }
  return out;
}

// ---------- edits on the stored pre-match ----------

function editSide(index, fn) {
  const state = prematchStore.get();
  if (!state?.sides[index]) return false;
  const side = state.sides[index];
  const next = fn(side);
  if (!next || next === side) return false;
  const sides = [...state.sides];
  sides[index] = next;
  prematchStore.set({ ...state, sides });
  return true;
}

/** Swap two players of a side (tap-tap on the pitch). */
export function swapPlayers(index, a, b) {
  return editSide(index, side => {
    const players = swapSlots(side.players, side.formation, a, b);
    return players && { ...side, players };
  });
}

/** Change a side's formation; players move to their best slots in the new shape. */
export function changeFormation(index, formation) {
  if (!FORMATIONS[formation]) return false;
  return editSide(index, side =>
    side.formation === formation || side.formationLocked
      ? side
      : { ...side, formation, players: reslot(side.players, formation) },
  );
}

/** Set one tactic of a side (style, tempo, width, press, mentality). */
export function setSideTactic(index, key, value) {
  return editSide(index, side => {
    const tactics = cleanTactics({ ...side.tactics, [key]: value });
    return tactics[key] === side.tactics[key] ? side : { ...side, tactics };
  });
}

/** Choose Key Moments / Full / Instant (remembered as the next default). */
export function setMatchView(view) {
  const state = prematchStore.get();
  if (!state || !MATCH_VIEWS.includes(view)) return false;
  writeJSON(VIEW_KEY, view);
  prematchStore.set({ ...state, view });
  return true;
}

/** competition for buildMatchConfig: engine mode + the AI coach level. */
export function engineCompetition(data) {
  const humans = data.sides.filter(s => s.kind !== 'ai').length;
  const c = data.competition || {};
  const mode = ['ai', 'pvp', 'sandbox'].includes(c.mode) ? c.mode : humans === 2 ? 'pvp' : 'ai';
  return {
    mode,
    difficulty: COACH_LEVEL[c.difficulty] || c.difficulty || 'medium',
    knockout: !!c.knockout,
    ...(c.extraTime ? { extraTime: true } : {}),
  };
}

/** Build the engine config and hand the match to #/match (requestMatch). */
export function kickOff({ go = true } = {}) {
  const data = prematchStore.get();
  if (!data) return null;
  const config = buildMatchConfig({
    sides: data.sides.map(s => ({
      name: s.name,
      short: s.short,
      colors: s.colors,
      formation: s.formation,
      players: s.players,
      tactics: s.tactics,
      kind: s.kind,
      code: s.flagCode,
    })),
    competition: engineCompetition(data),
    ...(data.useDefaultRules ? { tuning: DEFAULT_CONFIG } : {}),
  });
  return requestMatch(
    {
      id: data.id,
      seed: data.seed,
      view: data.view,
      config,
      meta: {
        ...data.meta,
        hideRatings: data.hideRatings,
        autoKickoff: true, // this screen was the pre-match: #/match starts straight away
        sides: data.sides.map(s => ({
          name: s.name,
          short: s.short,
          kind: s.kind,
          flagCode: s.flagCode,
          colors: s.colors,
        })),
        userSides: data.sides.map((s, i) => (s.kind === 'ai' ? null : i)).filter(i => i !== null),
        formationLocked: data.sides
          .map((s, i) => (s.formationLocked ? i : null))
          .filter(i => i !== null),
      },
    },
    { go },
  );
}
