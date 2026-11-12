// Draft hand-off store: the one draft session of the new UI (setup → #/draft → what comes
// next). Framework-free (no Preact, no router import) so Node tests can drive it; the tiny
// observable has the same get/set/subscribe shape as lib/store.js, so useStore() works on it.
// Full documentation: docs/ui-draft.md.
//
//   import { startDraft, completedDraft, clearDraft } from '../../lib/draft-store.js';
//
//   await startDraft({ kind: 'run', type: 'nations', difficulty: 'pro', formation: '433',
//                      options: { hideRatings: false, uniqueNations: false }, seed });
//   // … the draft screen spins and picks; on completion its Continue calls finishDraft():
//   //   run / daily → location '#' + (context.returnTo || '/run')
//   //   quick       → opponent reveal (quickOpponent()) → openPrematch(…)
//   //   versus      → openPrematch(…) with both XIs
//   const done = completedDraft();   // { session, context } once all picks are made (in memory)
//   const again = await loadDraft(); // same, restored from localStorage after a reload
//   clearDraft();                    // RUN-UI: once the run is created from the XI
//
// Persistence: { format, context, session: session.serialize(), savedAt } under
// 'football-draft-draft' after every action. The UI never consumes the draft RNG: reels
// animate to the landing the session already decided.
import {
  createDraftSession,
  restoreDraftSession,
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  DRAFT_MODES,
  seedNumber,
} from '../../core/draft/session.js';
import { pickOpponent } from '../../core/draft/opponents.js';
import { FORMATIONS } from '../../core/players/formations.js';
import { baseProfileId } from '../../core/players/legends.js';
import { CONFIG, DEFAULT_CONFIG } from '../../core/config/config.js';
import { loadWarmCatalog } from './catalog-warm.js';
import { sideColors, teamCode, nationTrigram } from './kits.js';
import { DRAFT_KEY, DRAFT_FORMAT, readSavedDraft } from './saved.js';
import { readJSON, writeJSON, removeKey } from './storage.js';

export { DRAFT_KEY, readSavedDraft };
export const DRAFT_KINDS = ['run', 'quick', 'versus', 'daily'];
const FORMAT = DRAFT_FORMAT;

/** UI draft types (Home chip, setup, query ?type=) → core session modes. */
export const TYPE_TO_MODE = {
  nations: 'nations',
  leagues: 'leagues',
  clubs: 'clubs',
  'club-country': 'clubAndCountry',
  clubAndCountry: 'clubAndCountry',
};
const MODE_TO_TYPE = {
  nations: 'nations',
  leagues: 'leagues',
  clubs: 'clubs',
  clubAndCountry: 'club-country',
};
export const draftMode = type => TYPE_TO_MODE[type] || 'nations';
export const draftType = type => MODE_TO_TYPE[draftMode(type)];
export const modeLabel = type => DRAFT_MODES[draftMode(type)].label;
export const difficultyLabel = id => DIFFICULTY_LABELS[id] || DIFFICULTY_LABELS.pro;

/** Kits a player can choose in Versus (and the solo default, index 0). */
export const KIT_COLORS = [
  { id: 'volt', name: 'Volt', colors: ['#d9f580', '#16213a'] },
  { id: 'sky', name: 'Sky', colors: ['#5cc8ff', '#0b1a33'] },
  { id: 'coral', name: 'Coral', colors: ['#ff6f61', '#16213a'] },
  { id: 'gold', name: 'Gold', colors: ['#f5c84c', '#1a1000'] },
  { id: 'violet', name: 'Violet', colors: ['#baaff0', '#16213a'] },
  { id: 'white', name: 'White', colors: ['#f3f6fd', '#16213a'] },
];
const kitColors = id => (KIT_COLORS.find(k => k.id === id) || KIT_COLORS[0]).colors;

/** A presentation-side seed (crypto). Never used inside core — the session mixes it itself. */
export function randomSeed() {
  const buf = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(buf);
  else buf[0] = (Date.now() * 2654435761) >>> 0;
  return buf[0] >>> 0;
}

/** '123' → 123, 'abc' → FNV-1a of 'abc' (seedNumber), numbers as uint32; null when empty. */
export function parseSeed(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value >>> 0 : null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{1,10}$/.test(text)) return Number(text) >>> 0;
  return seedNumber(text);
}

/**
 * Fill defaults and validate a draft context:
 *   { kind: 'run'|'quick'|'versus'|'daily', type, difficulty, formation,
 *     options: { hideRatings, uniqueNations }, seed, schedule?, rerolls?, useDefaultRules?,
 *     names?: [p1, p2], kits?: [kitId, kitId], returnTo?, daily?, meta? (kept as is) }
 * `type` accepts the UI ids (nations · leagues · clubs · club-country) and the core mode ids.
 */
export function normalizeContext(context = {}) {
  const kind = DRAFT_KINDS.includes(context.kind) ? context.kind : 'quick';
  const mode = draftMode(context.type ?? context.mode);
  const seed = parseSeed(context.seed) ?? randomSeed();
  const names = [0, 1].map(i => {
    const name = String(context.names?.[i] ?? '').trim();
    return name.slice(0, 20) || (kind === 'versus' ? `Player ${i + 1}` : i === 0 ? 'Your XI' : '');
  });
  const kits = [0, 1].map(i => {
    const id = context.kits?.[i];
    return KIT_COLORS.some(k => k.id === id) ? id : KIT_COLORS[i === 0 ? 0 : 1].id;
  });
  return {
    kind,
    type: MODE_TO_TYPE[mode],
    mode,
    difficulty: DIFFICULTIES.includes(context.difficulty) ? context.difficulty : 'pro',
    formation: FORMATIONS[context.formation] ? context.formation : '433',
    options: {
      hideRatings: !!(context.options?.hideRatings ?? context.hideRatings),
      uniqueNations: !!(context.options?.uniqueNations ?? context.uniqueNations),
      // Budget mode (rating-band caps, core/draft/budget.js): World Cup Runs only.
      ...(kind === 'run' && context.options?.budget ? { budget: true } : {}),
    },
    seed,
    schedule: context.schedule || null,
    rerolls: Number.isInteger(context.rerolls) ? context.rerolls : null,
    useDefaultRules: !!context.useDefaultRules || kind === 'daily',
    names: kind === 'versus' ? names : [names[0]],
    kits: kind === 'versus' ? kits : [kits[0]],
    returnTo: typeof context.returnTo === 'string' ? context.returnTo : null,
    ...(context.daily != null ? { daily: context.daily } : {}),
    ...(context.meta && typeof context.meta === 'object' ? { meta: context.meta } : {}),
  };
}

/**
 * A World Cup Run's Nations draft: the one with the Legend spin and the Prime boosts (Quick
 * Match, Versus and the Daily draft as before).
 */
export const worldCupDraft = ctx => ctx?.kind === 'run' && ctx.mode === 'nations';

/** createDraftSession options for a normalised context. */
export function sessionOptions(ctx) {
  const sides = ctx.kind === 'versus' ? 2 : 1;
  return {
    mode: ctx.mode,
    seed: ctx.seed,
    sides,
    formation: ctx.formation,
    difficulty: ctx.difficulty,
    ...(ctx.rerolls != null ? { rerolls: ctx.rerolls } : {}),
    hideRatings: ctx.options.hideRatings,
    uniqueNations: ctx.options.uniqueNations,
    budget: !!ctx.options.budget,
    // World Cup drafts: the first spin is the Legend spin, and Prime boosts by difficulty.
    ...(worldCupDraft(ctx) ? { legendSpin: true, primes: true } : {}),
    ...(ctx.schedule ? { schedule: ctx.schedule } : {}),
    useDefaultRules: ctx.useDefaultRules,
    teams: Array.from({ length: sides }, (_, i) => {
      const [color, secondary] = kitColors(ctx.kits[i]);
      return { name: ctx.names[i], color, secondary };
    }),
  };
}

/** The draft rules a context plays with (DEFAULT_CONFIG for daily/challenge links). */
export const contextRules = ctx => (ctx?.useDefaultRules ? DEFAULT_CONFIG.draft : CONFIG.draft);

// ---------- observable state ----------

function observable(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set(next) {
      const value =
        typeof next === 'function'
          ? next(state)
          : next && typeof next === 'object' && state && typeof state === 'object'
            ? { ...state, ...next }
            : next;
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

const IDLE = {
  status: 'idle', // 'idle' | 'loading' | 'ready' | 'empty' | 'error'
  context: null,
  snap: null, // session.snapshot() (read-only)
  animate: null, // spin token the board should animate (null = show the landing)
  lastPick: null, // { ...pick result, name, tier, token } for the pick moment
  error: null,
  version: 0,
};

/**
 * Draft state for the screens: { status, context, snap, animate, lastPick, error, version }.
 * `useStore(draftStore, s => s.snap)` re-renders after every action.
 */
export const draftStore = observable({ ...IDLE });

let session = null;
let context = null;
let catalogRef = null;
let opponent = null;
let token = 0;
let loading = null;
// The catalog for a draft; with `legends`, the Legends and Prime versions are fetched too
// (services/legends.js — only then, so no other screen pays for that file).
const defaultLoader = ({ legends = false } = {}) =>
  legends
    ? loadWarmCatalog().then(() => import('../../services/legends.js').then(m => m.loadLegends()))
    : loadWarmCatalog();
let catalogLoader = defaultLoader;

/**
 * Tests: replace the catalog loader (Node has no fetch for the relative catalog URL). It is
 * called with { legends: true } when the draft needs catalog.legends.
 */
export function setCatalogLoader(fn) {
  catalogLoader = fn || defaultLoader;
}

function go(path) {
  const loc = globalThis.location;
  if (!loc) return;
  const target = path.startsWith('#') ? path : `#${path.startsWith('/') ? path : `/${path}`}`;
  if (loc.hash !== target) loc.hash = target;
}

function persist() {
  if (!session) return;
  writeJSON(DRAFT_KEY, {
    format: FORMAT,
    context,
    session: session.serialize(),
    savedAt: new Date().toISOString(),
  });
}

function publish(extra = {}) {
  draftStore.set(s => ({
    ...s,
    status: 'ready',
    context,
    snap: session.snapshot(),
    error: null,
    version: s.version + 1,
    ...extra,
  }));
}

/**
 * Create a session from the catalog, persist it and (by default) go to #/draft.
 *   spin: true makes the first spin right away (one tap from setup to a spinning reel);
 *   Versus starts on the coin-toss interstitial instead.
 */
export async function startDraft(input, { go: navigateTo = true, spin = true } = {}) {
  const ctx = normalizeContext(input);
  draftStore.set(s => ({ ...s, status: 'loading', error: null }));
  try {
    const catalog = await catalogLoader({ legends: worldCupDraft(ctx) });
    const next = createDraftSession(catalog, sessionOptions(ctx));
    catalogRef = catalog;
    session = next;
    context = ctx;
    opponent = null;
    let animate = null;
    if (spin && ctx.kind !== 'versus') {
      session.spin();
      animate = ++token;
    }
    persist();
    publish({ animate, lastPick: null });
    if (navigateTo) go('/draft');
    return session;
  } catch (error) {
    draftStore.set(s => ({ ...s, status: session ? 'ready' : 'error', error }));
    throw error;
  }
}

/**
 * The current draft, restoring the saved one after a reload: { session, context } | null.
 * Sets status 'empty' when nothing is saved and 'error' when the save no longer fits the
 * player database.
 */
export function loadDraft() {
  if (session) return Promise.resolve({ session, context });
  if (loading) return loading;
  const saved = readJSON(DRAFT_KEY, null);
  if (!saved || saved.format !== FORMAT) {
    draftStore.set({ ...IDLE, status: 'empty' });
    return Promise.resolve(null);
  }
  draftStore.set(s => ({ ...s, status: 'loading', error: null }));
  const options = saved.session?.options || {};
  loading = catalogLoader({ legends: !!(options.legendSpin || options.primes) })
    .then(catalog => {
      session = restoreDraftSession(catalog, saved.session);
      catalogRef = catalog;
      context = normalizeContext(saved.context);
      opponent = null;
      publish({ animate: null, lastPick: null });
      return { session, context };
    })
    .catch(error => {
      draftStore.set({ ...IDLE, status: 'error', error });
      return null;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** { session, context, catalog } of the draft in memory, or null. */
export const currentDraft = () => (session ? { session, context, catalog: catalogRef } : null);

/** { session, context } once every pick is made (in memory; see loadDraft after a reload). */
export function completedDraft() {
  return session?.complete ? { session, context } : null;
}

/** Forget the draft (memory + storage). */
export function clearDraft() {
  session = null;
  context = null;
  opponent = null;
  removeKey(DRAFT_KEY);
  draftStore.set({ ...IDLE, status: 'empty' });
}

// ---------- actions (the draft screen) ----------

/** Spin for the side to act. Returns the spin, or null when it is not the spin phase. */
export function spinDraft() {
  if (!session || session.phase !== 'spin') return null;
  const spin = session.spin();
  persist();
  publish({ animate: ++token });
  return spin;
}

/** Spend a re-roll. Returns the new spin, or null when not allowed. */
export function rerollDraft() {
  if (!session || session.rerollBlocked()) return null;
  const spin = session.reroll();
  persist();
  publish({ animate: ++token });
  return spin;
}

/** The board finished animating the current spin. */
export function markLanded() {
  if (draftStore.get().animate != null) draftStore.set({ animate: null });
}

function pickInfo(result) {
  const p = session.player(result.profileId);
  const summary = session.playerSummary(p);
  return { ...result, name: summary.name, tier: summary.tier, ovr: summary.ovr, token: ++token };
}

/** Draft a player of the current spin (slot null = Auto). Returns session.pick()'s result. */
export function pickPlayer(profileId, slot = null) {
  if (!session) return { ok: false, reason: 'No draft' };
  const result = session.pick(profileId, slot);
  if (result.ok) {
    persist();
    publish({ animate: null, lastPick: pickInfo(result) });
  }
  return result;
}

/**
 * Spend a Prime boost on the player in a slot of the side to act (session.prime): he becomes
 * his prime version. Returns the session's result ({ ok, … } | { ok: false, reason }).
 */
export function primeDrafted(slot) {
  if (!session) return { ok: false, reason: 'No draft' };
  const result = session.prime(slot, session.turn);
  if (result.ok) {
    opponent = null;
    persist();
    publish();
  }
  return result;
}

/** One press: spin if needed, then the session's suggested pick (positional best). */
export function autoPick({ silent = false } = {}) {
  if (!session || session.complete) return null;
  if (session.phase === 'spin') session.spin();
  const suggestion = session.suggestPick();
  if (!suggestion) return null;
  const result = session.pick(suggestion.profileId, suggestion.slot);
  if (result.ok && !silent) {
    persist();
    publish({ animate: null, lastPick: pickInfo(result) });
  }
  return result;
}

/** Auto-pick until the draft is complete (dev/test: #/draft?auto=1). */
export function autoComplete() {
  if (!session) return false;
  let guard = 0;
  while (!session.complete && guard++ < 50) if (!autoPick({ silent: true })?.ok) break;
  persist();
  publish({ animate: null, lastPick: null });
  return session.complete;
}

// ---------- completion ----------

/**
 * Quick match: the opponent from the difficulty ladder, built without the user's players
 * (deterministic for the draft seed). Cached until the draft changes.
 */
export function quickOpponent() {
  if (!session?.complete) return null;
  if (!opponent) {
    // A prime or legend version counts as the current player: the opponent never fields him.
    const exclude = session.picks
      .flat()
      .filter(Boolean)
      .map(id => baseProfileId(session.player(id)));
    opponent = pickOpponent(catalogRef, {
      mode: context.mode,
      level: context.difficulty,
      seed: context.seed,
      excludePlayers: exclude,
      rules: contextRules(context),
      ...(context.rerolls != null ? { rerolls: context.rerolls } : {}),
    });
  }
  return opponent;
}

const matchSeed = seed => Math.imul((seed >>> 0) ^ 0x5bd1e995, 0x9e3779b1) >>> 0 || 1;

/**
 * Broadcast code of a drafted side: 'YOU' alone, 'P1'/'P2' for the default Versus names,
 * else the team code ('Ann' → 'ANN'). Two equal codes get the side number ('AN1', 'AN2').
 */
export function draftedShorts(names, solo = false) {
  if (solo) return ['YOU'];
  const codes = names.map(n => {
    const m = /^player\s*(\d+)$/i.exec(String(n || '').trim());
    return m ? `P${m[1]}` : teamCode(n);
  });
  return codes[0] === codes[1] ? codes.map((c, i) => `${c.slice(0, 2)}${i + 1}`) : codes;
}

function draftedSide(i, kind) {
  const side = session.matchSide(i);
  const names = Array.from({ length: session.sides }, (_, j) => session.matchSide(j).name);
  return {
    name: side.name,
    short: draftedShorts(names, kind === 'user' && session.sides === 1)[i],
    colors: [side.color, side.secondary],
    kind,
    formation: side.formation,
    players: side.players,
    editable: true,
  };
}

/** openPrematch() payload for a finished quick or versus draft. */
export function prematchPayload() {
  if (!session?.complete) return null;
  const seed = matchSeed(context.seed);
  if (context.kind === 'versus')
    return {
      id: `versus:${seed.toString(36)}`,
      seed,
      sides: [draftedSide(0, 'user'), draftedSide(1, 'p2')],
      competition: { mode: 'pvp', difficulty: context.difficulty, knockout: false },
      meta: { context: 'versus', title: 'Versus', returnTo: '#/play/versus' },
      hideRatings: !!context.options?.hideRatings,
    };
  const opp = quickOpponent();
  return {
    id: `quick:${seed.toString(36)}`,
    seed,
    sides: [
      draftedSide(0, 'user'),
      {
        name: opp.name,
        short: nationTrigram(opp.code) || undefined,
        colors: sideColors(opp),
        flagCode: opp.code || null,
        kind: 'ai',
        formation: opp.formation,
        players: opp.players,
        editable: false,
      },
    ],
    competition: { mode: 'ai', difficulty: context.difficulty, knockout: false },
    hideRatings: !!context.options?.hideRatings,
    meta: {
      context: 'quick',
      title: `Quick Match · ${difficultyLabel(context.difficulty)}`,
      returnTo: '#/play/quick',
    },
  };
}

/**
 * Continue after the last pick: run/daily → returnTo (RUN-UI takes the XI from
 * completedDraft()); quick/versus → the pre-match screen (the draft is then cleared).
 */
export async function finishDraft({ go: navigateTo = true } = {}) {
  if (!session?.complete) return null;
  if (context.kind === 'run' || context.kind === 'daily') {
    const to = context.returnTo || (context.kind === 'daily' ? '/daily' : '/run');
    if (navigateTo) go(to);
    return { route: to };
  }
  const payload = prematchPayload();
  const { openPrematch } = await import('./prematch-store.js');
  const stored = openPrematch(payload, { go: navigateTo });
  clearDraft();
  return { route: '/prematch', prematch: stored };
}
