// Number formatting for every screen: one style everywhere, independent of the device locale
// ('.' decimals, ',' thousands — the same as the share text from core/competition/share.js).
// Never use toLocaleString() for numbers in the UI: "82,2" on one screen and "82.2" on the
// next reads as a bug, and a German "1.234 pts" looks like a decimal.
//
//   fmt1(82.24)   '82.2'      fmt2(0.456)  '0.46'     int(1234.4) '1,234'
//   signed1(1.2)  '+1.2'      signed1(-1)  '−1.0'     pct(0.734)  '73%'
//   fmt1(null)    '–'         (pass a fallback as the 2nd argument)
//   boost(1.5)    '+1.5'      boost(1)     '+1'       boost(2.5)  '+2.5'   (mates boosts)

const DASH = '–';
const MINUS = '−';
const finite = v => v != null && v !== '' && Number.isFinite(Number(v));

/** One decimal: 82.2. */
export const fmt1 = (v, fallback = DASH) => (finite(v) ? Number(v).toFixed(1) : fallback);

/** Two decimals (xG): 0.46. */
export const fmt2 = (v, fallback = DASH) => (finite(v) ? Number(v).toFixed(2) : fallback);

/** Whole number with ',' thousands: 1,234. */
export function int(v, fallback = DASH) {
  if (!finite(v)) return fallback;
  const n = Math.round(Number(v));
  const s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return n < 0 ? MINUS + s : s;
}

/** Signed with one decimal and a real minus sign: +1.2 / −0.8 (0 → '+0.0'). */
export const signed1 = (v, fallback = DASH) =>
  finite(v) ? (Number(v) < 0 ? MINUS : '+') + Math.abs(Number(v)).toFixed(1) : fallback;

/** A mates boost or a sum of them: a decimal only when there is one (+1, +1.5, +14). */
export const boost = (v, fallback = DASH) =>
  finite(v)
    ? '+' + (Number.isInteger(Number(v)) ? String(Number(v)) : Number(v).toFixed(1))
    : fallback;

/** Share 0…1 → whole percent: 73%. */
export const pct = (p, fallback = DASH) =>
  finite(p) ? `${Math.round(Number(p) * 100)}%` : fallback;
