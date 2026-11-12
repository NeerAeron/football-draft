// UI-side randomness: seeds for new drafts and matches, ids for runs. Presentation only —
// core never asks for randomness (a draft, a match and a run are deterministic for the seed
// they are given), and nothing here is ever used inside a simulation.
const words = n => {
  const buf = new Uint32Array(n);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(buf);
  else buf[0] = (Date.now() * 2654435761) >>> 0;
  return buf;
};

/** A fresh uint32 seed (crypto; the clock where there is none). */
export const randomSeed = () => words(1)[0] >>> 0;

/** A short id for something saved (a run): base-36 text of about nine characters. */
export function randomId() {
  const buf = words(2);
  return buf[0].toString(36) + buf[1].toString(36).slice(0, 3);
}
