// Module Worker for auto-sims (see auto-sim.js): runs simulateHere() — the same deterministic
// engine loop the main thread would run — and forwards its live ticker updates.
import { simulateHere } from './auto-sim.js';

const cancelled = new Set();

self.onmessage = async ({ data }) => {
  if (data.cancel) {
    cancelled.add(data.cancel);
    return;
  }
  const { id, config, seed, matchId } = data;
  try {
    const result = await simulateHere(config, seed, {
      id: matchId,
      onProgress: (progress, live) => self.postMessage({ id, progress, live }),
      cancelled: () => cancelled.has(id),
    });
    if (!cancelled.has(id)) self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) });
  } finally {
    cancelled.delete(id);
  }
};
