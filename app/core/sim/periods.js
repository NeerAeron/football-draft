import { CONFIG } from '../config/config.js';
import { lcgNext, LCG_RANGE } from '../util/rng.js';
export function stoppageMinutes(seed, tuning = CONFIG.periods) {
  let state = (seed ^ 0x81ab27d5) >>> 0;
  const random = () => {
    state = lcgNext(state);
    return (state + 0.5) / LCG_RANGE;
  };
  const normal = () => Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
  return [
    Math.max(
      tuning.minimum,
      Math.min(
        tuning.firstHalfMaximum,
        Math.round(tuning.firstHalfMean + normal() * tuning.firstHalfSpread),
      ),
    ),
    Math.max(
      tuning.minimum,
      Math.min(
        tuning.secondHalfMaximum,
        Math.round(tuning.secondHalfMean + normal() * tuning.secondHalfSpread),
      ),
    ),
  ];
}
// Match-clock start/end (seconds) of each period: two halves, then the two
// optional 15-minute halves of extra time.
export const PERIOD_START = [0, 2700, 5400, 6300];
export const PERIOD_END = [2700, 5400, 6300, 7200];
// Real-time share of the match length that each period lasts.
export const PERIOD_SHARE = [0.5, 0.5, 1 / 6, 1 / 6];
export function matchClock(time, half) {
  const format = n =>
    `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
  const end = PERIOD_END[half - 1] ?? 5400;
  return time >= end ? `${end / 60}+${format(time - end)}` : format(time);
}
