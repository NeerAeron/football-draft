// TEMP STUB — replaced by DRAFT-UI at merge.
// Minimal stand-in for DRAFT-UI's draft store so the RUN screens (#/run, #/daily, challenge
// links) work before the draft board exists: startDraft() drafts instantly with the core's
// suggested picks and returns to context.returnTo. Same exports as the real contract:
//   startDraft(context), draftStore, completedDraft() → { session, context } | null, clearDraft()
// context = { kind: 'run'|'quick'|'versus'|'daily', type, difficulty, formation,
//             options: { hideRatings, uniqueNations }, seed, schedule?, names?, returnTo? }
import { loadCatalog } from '../../services/catalog.js';
import { createDraftSession, restoreDraftSession } from '../../core/draft/session.js';
import { createStore } from './store.js';
import { readJSON, writeJSON, removeKey } from './storage.js';

const KEY = 'football-draft-draft-stub';
const MODES = {
  nations: 'nations',
  leagues: 'leagues',
  clubs: 'clubs',
  'club-country': 'clubAndCountry',
  clubAndCountry: 'clubAndCountry',
};

export const draftStore = createStore({ status: 'idle', context: null });

let catalog = null;
loadCatalog()
  .then(c => (catalog = c))
  .catch(() => {});

const randomSeed = () => {
  const buf = new Uint32Array(1);
  globalThis.crypto?.getRandomValues?.(buf);
  return buf[0] >>> 0 || 1;
};

export async function startDraft(context = {}) {
  const c = await loadCatalog();
  catalog = c;
  const seed = context.seed ?? randomSeed();
  const session = createDraftSession(c, {
    mode: MODES[context.type] || 'nations',
    seed,
    sides: context.kind === 'versus' ? 2 : 1,
    formation: context.formation || '433',
    difficulty: context.difficulty || 'pro',
    hideRatings: !!context.options?.hideRatings,
    uniqueNations: !!context.options?.uniqueNations,
    // Daily: `schedule` is dailyChallenge(…).draft (or just its { rounds } schedule).
    ...(context.schedule
      ? {
          schedule: context.schedule.schedule ?? context.schedule,
          rerolls: context.schedule.rerolls ?? context.rerolls ?? 2,
          formation: context.schedule.formation ?? context.formation ?? '433',
        }
      : {}),
    useDefaultRules: !!(context.useDefaultRules || context.schedule || context.challenge),
  });
  while (!session.complete) {
    session.spin();
    const pick = session.suggestPick();
    session.pick(pick?.profileId ?? pick);
  }
  const saved = { session: session.serialize(), context: { ...context, seed } };
  writeJSON(KEY, saved);
  draftStore.set({ status: 'complete', context: saved.context });
  const to = context.returnTo || '/';
  globalThis.location.hash = to.startsWith('#') ? to : `#${to}`;
}

export function completedDraft() {
  const saved = readJSON(KEY, null);
  if (!saved?.session || !catalog) return null;
  try {
    const session = restoreDraftSession(catalog, saved.session);
    return session.complete ? { session, context: saved.context || {} } : null;
  } catch {
    return null;
  }
}

export function clearDraft() {
  removeKey(KEY);
  draftStore.set({ status: 'idle', context: null });
}
