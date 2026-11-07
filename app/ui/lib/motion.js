// Reduced motion = the OS setting unless the player overrides it in Settings.
// CSS: tokens.css collapses every --dur-* token and base.css stops keyframes when
// html[data-motion="reduce"] or the OS asks for it (and html[data-motion="full"] is unset).
// JS animations (reels, confetti, counters) must check isReducedMotion() / useReducedMotion().
import { createStore, useStore } from './store.js';
import { prefs } from './prefs.js';

const media = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');

const compute = () => {
  const mode = prefs.get().motion;
  return mode === 'reduce' || (mode === 'system' && !!media?.matches);
};

export const motionStore = createStore(compute());

function apply() {
  const mode = prefs.get().motion;
  const root = globalThis.document?.documentElement;
  if (root) {
    if (mode === 'system') delete root.dataset.motion;
    else root.dataset.motion = mode;
  }
  motionStore.set(compute());
}

prefs.subscribe(apply);
media?.addEventListener?.('change', apply);
apply();

export const isReducedMotion = () => motionStore.get();
export const useReducedMotion = () => useStore(motionStore);
