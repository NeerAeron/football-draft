// UI preferences, persisted in localStorage ('football-draft-ui'). Sound lives in
// services/sound.js (its own key) and is mirrored by lib/audio.js.
//
//   const hide = useStore(prefs, p => p.hideRatings);
//   setPref('hideRatings', true);
import { createStore } from './store.js';
import { readJSON, writeJSON, removeKey } from './storage.js';

export const PREFS_KEY = 'football-draft-ui';

const DEFAULTS = {
  motion: 'system', // 'system' | 'reduce' | 'full'
  hideRatings: false, // default for the "Hide ratings" (Ball Knower) toggle in draft setup
  onboarded: false, // first-run "How it works" dismissed
  draftType: 'nations', // last draft type picked on Home: nations | leagues | clubs | club-country
  autoSpin: true, // after a pick the next reel starts by itself (not in Versus)
};

export const DRAFT_TYPES = ['nations', 'leagues', 'clubs', 'club-country'];

function load() {
  const saved = readJSON(PREFS_KEY, {});
  const out = { ...DEFAULTS };
  if (['system', 'reduce', 'full'].includes(saved?.motion)) out.motion = saved.motion;
  if (typeof saved?.hideRatings === 'boolean') out.hideRatings = saved.hideRatings;
  if (typeof saved?.onboarded === 'boolean') out.onboarded = saved.onboarded;
  if (DRAFT_TYPES.includes(saved?.draftType)) out.draftType = saved.draftType;
  if (typeof saved?.autoSpin === 'boolean') out.autoSpin = saved.autoSpin;
  return out;
}

export const prefs = createStore(load());
prefs.subscribe(state => {
  const isDefault = Object.keys(DEFAULTS).every(k => state[k] === DEFAULTS[k]);
  if (isDefault) removeKey(PREFS_KEY);
  else writeJSON(PREFS_KEY, state);
});

export function setPref(key, value) {
  prefs.set({ [key]: value });
}

/** Re-read from storage (after "Reset local data"). */
export function reloadPrefs() {
  prefs.set(load());
}
