// Simulation jobs off the main thread: Instant results (simulateComplete) and Key Moments
// halves (simulateHalf) from core/sim/replay.js. Loaded as a module Worker by sim-client.js,
// which also imports runSimJob() for its main-thread fallback; Node tests import it directly
// (the worker hook below only installs inside a WorkerGlobalScope).
//
// Protocol (postMessage, structured clone):
//   → { id, job }            job = { type: 'complete', config, seed, record? }
//                                 | { type: 'half', match }   (a Match, cloned as plain data)
//   → { cancel: id }
//   ← { id, progress }       0–1
//   ← { id, out }            out = { result (plain Match data), frames, clips, viewDuration?,
//                                    viewOffset? } or null when cancelled
//   ← { id, error }          message string
import { Match, Player } from '../core/sim/engine.js';
import { simulateComplete, simulateHalf } from '../core/sim/replay.js';
import { normalizeAttributes } from '../core/players/ratings.js';

/**
 * A structured-cloned Match (postMessage / structuredClone) → a working Match again, the way
 * simulateHalf restores its own copy: prototypes, normalised attributes, active list.
 */
export function hydrateMatch(data) {
  if (data instanceof Match) return data;
  const m = Object.assign(Object.create(Match.prototype), data);
  m.players = m.players.map(p =>
    p instanceof Player
      ? p
      : Object.assign(Object.create(Player.prototype), p, { attrs: normalizeAttributes(p.attrs) }),
  );
  m.rebuildActive();
  return m;
}

/**
 * Keep only the recorded frames a highlight reel can show: those inside a clip (plus a short
 * margin for interpolation and the ball trail), and the first and last frame. applyReplayFrame
 * gives the same picture with the trimmed list for any view time.
 */
export function trimFrames(frames, clips, before = 0.6, after = 0.4) {
  if (!frames?.length || !clips?.length) return frames || [];
  const windows = clips.map(c => [c.start - before, c.end + after]);
  const last = frames.length - 1;
  return frames.filter(
    (f, i) => i === 0 || i === last || windows.some(([a, b]) => f.elapsed >= a && f.elapsed <= b),
  );
}

/**
 * Run one job; resolves to { result: Match, frames, clips, viewDuration?, viewOffset? } or
 * null when cancelled. Pure apart from the timer yields inside replay.js.
 */
export async function runSimJob(job, { onProgress = () => {}, cancelled = () => false } = {}) {
  if (job?.type === 'complete') {
    const out = await simulateComplete(job.config, job.seed, !!job.record, onProgress, cancelled);
    if (!out) return null;
    return { result: out.result, frames: trimFrames(out.frames, out.clips), clips: out.clips };
  }
  if (job?.type === 'half') {
    const out = await simulateHalf(hydrateMatch(job.match), onProgress, cancelled);
    if (!out) return null;
    return { ...out, frames: trimFrames(out.frames, out.clips) };
  }
  throw new TypeError(`Unknown simulation job: ${job?.type}`);
}

/** Typed-array buffers of a job output, to transfer instead of copy. */
export function transferables(out) {
  return out?.frames ? out.frames.map(f => f.positions?.buffer).filter(Boolean) : [];
}

/* global WorkerGlobalScope */
if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  const stopped = new Set();
  globalThis.onmessage = async ({ data }) => {
    if (data?.cancel != null) {
      stopped.add(data.cancel);
      return;
    }
    const { id, job } = data || {};
    let last = -1;
    try {
      const out = await runSimJob(job, {
        onProgress: p => {
          // ~20 updates per job are plenty for a progress bar
          if (p - last >= 0.04 || p >= 1) {
            last = p;
            globalThis.postMessage({ id, progress: p });
          }
        },
        cancelled: () => stopped.has(id),
      });
      globalThis.postMessage({ id, out }, transferables(out));
    } catch (error) {
      globalThis.postMessage({ id, error: String(error?.stack || error?.message || error) });
    } finally {
      stopped.delete(id);
    }
  };
}
