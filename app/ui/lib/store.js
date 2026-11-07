// Tiny observable store + Preact hook. One store per concern (prefs, route, a screen's
// session state…), created at module level and imported where needed.
//
//   export const counter = createStore({ count: 0 });
//   counter.set({ count: 1 });                       // shallow merge
//   counter.set(s => ({ ...s, count: s.count + 1 })); // updater returns the next state
//   const count = useStore(counter, s => s.count);   // re-renders only when count changes
//
// State is treated as immutable: always produce a new object, never mutate in place.
import { useEffect, useReducer, useRef } from 'preact/hooks';

export function createStore(initial) {
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

/** Shallow equality for selectors that return small objects/arrays. */
export function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && Object.is(a[k], b[k]));
}

const identity = s => s;

/**
 * Subscribe a component to a store slice. Re-renders when selector(state) changes
 * according to `equal` (Object.is by default; pass shallowEqual for object slices).
 */
export function useStore(store, selector = identity, equal = Object.is) {
  const [, force] = useReducer(n => n + 1, 0);
  const selected = selector(store.get());
  const ref = useRef({ selector, equal, selected });
  ref.current = { selector, equal, selected };
  useEffect(() => {
    const check = state => {
      const { selector: sel, equal: eq, selected: prev } = ref.current;
      if (!eq(sel(state), prev)) force();
    };
    const unsubscribe = store.subscribe(check);
    check(store.get()); // the store may have changed between render and subscribe
    return unsubscribe;
  }, [store]);
  return selected;
}
