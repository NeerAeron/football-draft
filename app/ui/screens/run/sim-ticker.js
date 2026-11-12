// useSimTicker(): drives a results ticker while a CupRun is simulated (World Cup Run "Simulate
// this match" — limit: 1 — and "Simulate the whole cup", Daily Challenge). Live clock + score per match as the engine runs,
// the other group match's result after each matchday, Skip (no pauses, no live repaint) and
// Stop (after the current match).
//
//   const ticker = useSimTicker();
//   await ticker.start(run, { configFor, idFor, onDone: async (m, result, snapshot) => persist() });
//   milestones: true — the screen shows state.milestone as a pop-up and calls ticker.proceed();
//   without it (the Daily) a cleared stage is only a short breath.
//   ticker.state → { items, progress, skip, stop, finished, announce } | null
import { useEffect, useRef, useState } from 'preact/hooks';
import { isReducedMotion } from '../../lib/motion.js';
import { playCue } from '../../lib/audio.js';
import { roundShort } from '../../lib/run-store.js';
import { simulateRemaining, fastSimEnabled } from './auto-sim.js';
import { scoreText, elsewhereOf } from './run-parts.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const shortName = name => String(name || '').replace(/^(?:\p{L}\.\s*)+/u, '');
/** "Kane 23', Saka 67'" for one side of a result. */
export const scorersOf = (result, side = 0) =>
  (result?.goals || [])
    .filter(g => g.team === side)
    .map(g => `${g.ownGoal ? 'OG' : shortName(g.player || g.name)} ${g.minute || ''}`.trim())
    .join(', ');

export function useSimTicker() {
  const [state, setState] = useState(null);
  const flags = useRef({ skip: false, stop: false, abort: false });
  const proceed = useRef(null);
  useEffect(
    () => () => {
      flags.current.stop = true;
      flags.current.abort = true;
      proceed.current?.();
    },
    [],
  );

  async function start(
    run,
    { configFor, idFor, onDone, pace = 900, limit = Infinity, milestones = false },
  ) {
    flags.current = { skip: isReducedMotion(), stop: false, abort: false };
    const pause = ms => sleep(flags.current.skip ? 0 : ms);
    let current = {
      items: run
        .snapshot()
        .rounds.map((r, round) => ({
          round,
          short: roundShort(r),
          opponent: r.opponent,
          status: 'queued',
          r,
        }))
        .filter(x => !x.r.result)
        .slice(0, limit)
        .map(({ r, ...x }) => x),
      progress: 0,
      milestone: null,
      finished: false,
      announce: '',
    };
    const total = current.items.length || 1;
    let done = 0,
      lastPaint = 0;
    const push = patch => {
      current = { ...current, ...patch, skip: flags.current.skip, stop: flags.current.stop };
      setState(current);
    };
    const setItem = (round, patch) =>
      push({ items: current.items.map(it => (it.round === round ? { ...it, ...patch } : it)) });
    push({});
    const fast = fastSimEnabled();
    await simulateRemaining(run, {
      configFor,
      idFor,
      flags: flags.current,
      limit,
      onStart: async m => {
        // The eighth match is only known now: the final, or the third-place play-off.
        setItem(m.round, {
          status: 'live',
          short: roundShort(m),
          opponent: m.opponent,
          live: { minute: "0'", score: [0, 0] },
        });
        if (fast) await pause(450);
      },
      onLive: (m, f, live) => {
        const now = performance.now();
        if (flags.current.skip || (now - lastPaint < 120 && f < 1)) return;
        lastPaint = now;
        push({
          progress: (done + f) / total,
          items: current.items.map(it => (it.round === m.round ? { ...it, live } : it)),
        });
      },
      onDone: async (m, result) => {
        done++;
        const snapshot = run.snapshot();
        const res = snapshot.rounds[m.round].result;
        const other = m.round < 3 ? elsewhereOf(snapshot, m.round + 1) : null;
        setItem(m.round, {
          status: 'done',
          result: res,
          scorers: result ? scorersOf(result, 0) : '',
          elsewhere: other ? { home: other.home, away: other.away, score: other.score } : null,
        });
        push({
          progress: done / total,
          announce: `${m.label}: ${
            res.outcome === 'W' ? 'won' : res.outcome === 'D' ? 'drew' : 'lost'
          } ${scoreText(res)} against ${m.away.name}.`,
        });
        await onDone?.(m, result, snapshot);
        if (!flags.current.skip) playCue(res.outcome === 'W' ? 'goal' : 'tick');
        await pause(pace);
        // Simulating the whole cup: a breath after the group and after every knockout round,
        // with a word when a stage is cleared (out of the group, into the semis, into the final).
        if (limit > 1 && !flags.current.stop) {
          const won = res.outcome === 'W' || res.shootout?.winner === 'user',
            id = snapshot.rounds[m.round].id,
            milestone =
              m.round === 2 && snapshot.status === 'playing'
                ? 'Made it out of the group'
                : id === 'qf' && won
                  ? 'Into the semi-finals'
                  : id === 'sf' && won
                    ? 'Into the final'
                    : null;
          // A stage cleared: the sim waits on a pop-up until the player taps on (keep simming)
          // or stops. Skipping (or reduced motion) passes straight through.
          if (milestones && milestone && !flags.current.skip) {
            push({ milestone, announce: `${milestone}.` });
            playCue('pick-star');
            await new Promise(resolve => (proceed.current = resolve));
            proceed.current = null;
            push({ milestone: null });
          } else if (m.round >= 3 && snapshot.status === 'playing') await pause(600);
        }
      },
    });
    push({
      finished: true,
      progress: 1,
      items: current.items.filter(it => it.status !== 'queued'),
    });
    await pause(limit === 1 ? 500 : 1100);
    return !flags.current.abort;
  }

  return {
    state,
    start,
    skip() {
      flags.current.skip = true;
      setState(s => s && { ...s, skip: true });
      proceed.current?.();
    },
    stop() {
      flags.current.stop = true;
      setState(s => s && { ...s, stop: true });
      proceed.current?.();
    },
    /** Close a stage pop-up and carry on simulating. */
    proceed() {
      proceed.current?.();
    },
    clear: () => setState(null),
  };
}
