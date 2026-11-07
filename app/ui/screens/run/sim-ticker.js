// useSimTicker(): drives a results ticker while the rest of a CupRun is simulated (World Cup
// Run "Sim rest of run", Daily Challenge). Live clock + score per match as the engine runs,
// the other group match's result after each matchday, Skip (no pauses, no live repaint) and
// Stop (after the current match).
//
//   const ticker = useSimTicker();
//   await ticker.start(run, { configFor, idFor, onDone: async (m, result, snapshot) => persist() });
//   ticker.state → { items, progress, skip, stop, finished, announce } | null
import { useEffect, useRef, useState } from 'preact/hooks';
import { isReducedMotion } from '../../lib/motion.js';
import { playCue } from '../../lib/audio.js';
import { roundLabel } from '../../lib/run-store.js';
import { simulateRemaining, fastSimEnabled } from './auto-sim.js';
import { scoreText } from './run-parts.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const elsewhereOf = (snapshot, md) =>
  snapshot.group.fixtures.find(f => f.md === md && f.home !== 'user' && f.away !== 'user');
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
  useEffect(
    () => () => {
      flags.current.stop = true;
      flags.current.abort = true;
    },
    [],
  );

  async function start(run, { configFor, idFor, onDone, pace = 900 }) {
    flags.current = { skip: isReducedMotion(), stop: false, abort: false };
    const pause = ms => sleep(flags.current.skip ? 0 : ms);
    let current = {
      items: run
        .snapshot()
        .rounds.map((r, round) => ({ round, opponent: r.opponent, status: 'queued', r }))
        .filter(x => !x.r.result)
        .map(({ r, ...x }) => x),
      progress: 0,
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
      onStart: async m => {
        setItem(m.round, { status: 'live', live: { minute: "0'", score: [0, 0] } });
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
          announce: `${roundLabel(m.round)}: ${
            res.outcome === 'W' ? 'won' : res.outcome === 'D' ? 'drew' : 'lost'
          } ${scoreText(res)} against ${m.away.name}.`,
        });
        await onDone?.(m, result, snapshot);
        if (!flags.current.skip) playCue(res.outcome === 'W' ? 'goal' : 'tick');
        await pause(pace);
      },
    });
    push({
      finished: true,
      progress: 1,
      items: current.items.filter(it => it.status !== 'queued'),
    });
    await pause(1100);
    return !flags.current.abort;
  }

  return {
    state,
    start,
    skip() {
      flags.current.skip = true;
      setState(s => s && { ...s, skip: true });
    },
    stop() {
      flags.current.stop = true;
      setState(s => s && { ...s, stop: true });
    },
    clear: () => setState(null),
  };
}
