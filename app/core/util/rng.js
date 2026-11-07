// Deterministic 32-bit linear congruential generator shared by the engine, the
// draft, random lineups, stoppage time and presentation-only shuffles.
// Each caller owns its own state; nothing here is global.

export const LCG_RANGE = 4294967296; // 2 ** 32

/** Advance an LCG state (uint32 in, uint32 out). */
export const lcgNext = state => (Math.imul(1664525, state) + 1013904223) >>> 0;

/** A random() closure over its own LCG state, returning [0, 1). */
export function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = lcgNext(state);
    return state / LCG_RANGE;
  };
}
