// Client for sim-worker.js: Instant results and Key Moments halves without freezing the page.
// Uses a module Worker when the browser has one and falls back to running the same job on the
// main thread (replay.js yields between chunks) if the worker cannot start or crashes.
//
//   const sim = createSimClient();
//   const job = sim.complete(config, seed, { onProgress });   // or sim.half(match, { onProgress })
//   const out = await job.promise;   // { result: Match, frames, clips, … } | null (cancelled)
//   job.cancel();
//   sim.dispose();
//
// Results equal the in-thread simulateComplete / simulateHalf: the worker runs the same code on
// a structured clone, and hydrateMatch() restores the Match/Player prototypes on the way back.
import { runSimJob, hydrateMatch } from './sim-worker.js';

export function createSimClient({ useWorker = true } = {}) {
  let worker = null,
    broken = !useWorker || typeof Worker === 'undefined',
    nextId = 1;
  const pending = new Map(); // id → { job, resolve, reject, onProgress, local }

  function runLocal(id, entry) {
    entry.local = true;
    runSimJob(entry.job, {
      onProgress: p => entry.onProgress?.(p),
      cancelled: () => entry.cancelled,
    })
      .then(out => {
        pending.delete(id);
        entry.resolve(entry.cancelled ? null : out);
      })
      .catch(error => {
        pending.delete(id);
        entry.reject(error);
      });
  }

  function fallBack(reason) {
    if (worker) worker.terminate();
    worker = null;
    broken = true;
    if (reason) console.warn('[sim] worker unavailable, simulating on the main thread:', reason);
    for (const [id, entry] of pending) if (!entry.local) runLocal(id, entry);
  }

  function onMessage({ data }) {
    const entry = pending.get(data?.id);
    if (!entry || entry.local) return;
    if (data.progress != null) {
      entry.onProgress?.(data.progress);
      return;
    }
    pending.delete(data.id);
    if (data.error) entry.reject(new Error(data.error));
    else if (entry.cancelled || !data.out) entry.resolve(null);
    else entry.resolve({ ...data.out, result: hydrateMatch(data.out.result) });
  }

  function ensureWorker() {
    if (worker || broken) return worker;
    try {
      worker = new Worker(new URL('./sim-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = onMessage;
      worker.onerror = event => {
        event.preventDefault?.();
        fallBack(event.message || 'worker error');
      };
      worker.onmessageerror = () => fallBack('message could not be cloned');
    } catch (error) {
      fallBack(error?.message || 'worker failed to start');
    }
    return worker;
  }

  function run(job, { onProgress } = {}) {
    const id = nextId++;
    let entry;
    const promise = new Promise((resolve, reject) => {
      entry = { job, resolve, reject, onProgress, local: false, cancelled: false };
    });
    pending.set(id, entry);
    const w = ensureWorker();
    if (w) {
      try {
        w.postMessage({ id, job });
      } catch (error) {
        fallBack(error?.message || 'postMessage failed'); // e.g. DataCloneError
        if (!entry.local) runLocal(id, entry);
      }
    } else runLocal(id, entry);
    return {
      id,
      promise,
      cancel() {
        if (entry.cancelled) return;
        entry.cancelled = true;
        if (!entry.local && worker) {
          worker.postMessage({ cancel: id });
          pending.delete(id);
          entry.resolve(null);
        }
      },
    };
  }

  return {
    /** Whole match (300 s profile) → Instant result; `record` also returns frames/clips. */
    complete: (config, seed, { record = false, onProgress } = {}) =>
      run({ type: 'complete', config, seed, record }, { onProgress }),
    /** One half of `match` (kickoff → half-time, or half-time → the end) with highlight clips. */
    half: (match, { onProgress } = {}) => run({ type: 'half', match }, { onProgress }),
    get usingWorker() {
      return !!worker && !broken;
    },
    dispose() {
      for (const entry of pending.values()) {
        entry.cancelled = true;
        entry.resolve(null);
      }
      pending.clear();
      worker?.terminate();
      worker = null;
    },
  };
}
