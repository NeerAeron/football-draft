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
//               tactics?, players: [11 profiles in slot order], editable }, …],
//     competition: { mode?: 'ai'|'pvp', difficulty: 'pro', knockout: false },
//     meta: { context: 'run', title: 'Quarter-final', returnTo: '#/run', fixture: 'run:abc:qf' },
//   });
import { FORMATIONS } from '../../core/players/formations.js';
import { STYLES, TACTICS } from '../../core/players/traits.js';
import { roleRating, roleFit, naturalRating, isKeeper } from '../../core/draft/pools.js';
import { teamLinks } from '../../core/draft/links.js';
import { NATURAL_FIT } from '../../core/draft/session.js';
import { CONFIG, DEFAULT_CONFIG } from '../../core/config/config.js';
import { buildMatchConfig, requestMatch, teamCode, MATCH_VIEWS } from './match-store.js';
import { readJSON, writeJSON, removeKey } from './storage.js';

export const PREMATCH_KEY = 'football-draft-prematch';
export const VIEW_KEY = 'football-draft-match-view';
const FORMAT = 1;
const KINDS = ['user', 'ai', 'p2'];
export const MENTALITIES = [
  { value: 'push', label: 'Push', hint: 'Go for it' },
  { value: 'balanced', label: 'Balanced', hint: 'Stay in shape' },
  { value: 'hold', label: 'Hold', hint: 'Sit deeper' },
];
export const TACTIC_DEFAULTS = {
  style: 'balanced',
  tempo: 3,
  width: 3,
  press: 3,
  mentality: 'balanced',
};
export const TACTIC_SLIDERS = ['tempo', 'width', 'press'].map(key => ({ key, ...TACTICS[key] }));
export const STYLE_OPTIONS = Object.entries(STYLES).map(([value, s]) => ({
  value,
  label: s.label,
  description: s.description,
}));

/** Engine coach level for a draft difficulty id (other values pass through). */
export const COACH_LEVEL = {
  amateur: 'veryeasy',
  semipro: 'easy',
  pro: 'medium',
  worldclass: 'hard',
  legendary: 'impossible',
};
const DEFAULT_KITS = [
  ['#d9f580', '#16213a'],
  ['#baaff0', '#16213a'],
];

// ---------- observable ----------

function observable(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set(next) {
      const value = typeof next === 'function' ? next(state) : next;
      if (Object.is(value, state)) return;
      state = value;
      for (const listener of [...listeners]) listener(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

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
    short: side.short || teamCode(side.name || `Team ${i + 1}`),
    colors: colors.length ? colors : DEFAULT_KITS[i],
    flagCode: side.flagCode ?? side.code ?? null,
    kind,
    formation: side.formation,
    tactics: cleanTactics(side.tactics),
    players: side.players.map(p => p),
    editable: side.editable ?? kind !== 'ai',
  };
}

function storedView() {
  const own = readJSON(VIEW_KEY, null);
  if (MATCH_VIEWS.includes(own)) return own;
  const pref = readJSON('football-draft-ui', null)?.matchView;
  return MATCH_VIEWS.includes(pref) ? pref : 'key';
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
    view: MATCH_VIEWS.includes(input.view) ? input.view : storedView(),
  };
}

function randomSeed() {
  const buf = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(buf);
  else buf[0] = (Date.now() * 2654435761) >>> 0;
  return buf[0] >>> 0;
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
export const prematchStore = observable(load());
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

/** Re-read from storage (e.g. after Settings → reset). */
export const reloadPrematch = () => prematchStore.set(load());

export function clearPrematch() {
  prematchStore.set(null);
}

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

/** Team OVR (mean slot rating), Links summary and effective rating (OVR + chem). */
export function lineupStrength(players, formation, links = CONFIG.draft.links) {
  const roles = rolesOf(formation);
  const ratings = players
    .map((p, i) => (p ? roleRating(p, roles[i]) : null))
    .filter(r => r != null);
  const rating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
  const summary = teamLinks(players, links);
  return {
    rating: Math.round(rating * 10) / 10,
    effective: Math.round((rating + summary.chem) * 100) / 100,
    links: { score: summary.score, maxScore: summary.maxScore, pairs: summary.pairs },
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

/**
 * Re-slot an XI into another formation: the best keeper in goal, the outfield players on the
 * assignment with the highest total slot rating (exact DP over slot masks).
 */
export function reslot(players, formation) {
  const roles = rolesOf(formation);
  const gkSlot = roles.indexOf('GK');
  const keepers = players
    .filter(isKeeper)
    .sort((a, b) => roleRating(b, 'GK') - roleRating(a, 'GK'));
  const keeper = keepers[0] || null;
  const outfield = players.filter(p => p !== keeper);
  const slots = roles.map((r, i) => i).filter(i => i !== gkSlot);
  const memo = new Map();
  const solve = (i, mask) => {
    if (i === outfield.length) return { v: 0, slots: [] };
    const key = i * 4096 + mask;
    if (memo.has(key)) return memo.get(key);
    let best = null;
    slots.forEach((slot, k) => {
      if (mask & (1 << k)) return;
      const rest = solve(i + 1, mask | (1 << k));
      const v = roleRating(outfield[i], roles[slot]) + rest.v;
      if (!best || v > best.v + 1e-9) best = { v, slots: [slot, ...rest.slots] };
    });
    memo.set(key, best);
    return best;
  };
  const next = Array(roles.length).fill(null);
  if (keeper) next[gkSlot] = keeper;
  solve(0, 0).slots.forEach((slot, i) => (next[slot] = outfield[i]));
  return next.map((p, i) => (p ? placed(p, i, roles[i]) : p));
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
    side.formation === formation
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
        sides: data.sides.map(s => ({
          name: s.name,
          short: s.short,
          kind: s.kind,
          flagCode: s.flagCode,
          colors: s.colors,
        })),
        userSides: data.sides.map((s, i) => (s.kind === 'ai' ? null : i)).filter(i => i !== null),
      },
    },
    { go },
  );
}
