// The observable store itself, without the Preact hook (lib/store.js adds useStore and
// re-exports this): framework-free, so the hand-off stores (draft, pre-match, match) can use
// it and Node tests can import them.
//
//   const counter = createStore({ count: 0 });
//   counter.set({ count: 1 });                        // shallow merge
//   counter.set(s => ({ ...s, count: s.count + 1 })); // updater returns the next state
//   const unsubscribe = counter.subscribe(state => …);
//
//   const pending = createStore(null, { merge: false }); // state replaced whole (may be null)
//
// State is treated as immutable: always produce a new object, never mutate in place.
export function createStore(initial, { merge = true } = {}) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set(next) {
      const value =
        typeof next === 'function'
          ? next(state)
          : merge && next && typeof next === 'object' && state && typeof state === 'object'
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
