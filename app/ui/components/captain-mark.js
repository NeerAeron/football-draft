// CaptainMark — the armband "C" on a captain's card, row and pitch token. The Captain tag gives
// every player of his XI +1 (core/draft/links.js, CONFIG.draft.links.captain).
//   size   'sm' (rows, tokens) | 'md' (cards)                                default 'sm'
import { html, cx } from '../lib/html.js';

export const CAPTAIN_TEXT = 'Captain: +1 to every player';

export function CaptainMark({ size = 'sm', class: className }) {
  return html`<span
    class=${cx('captain-mark', `captain-mark--${size}`, className)}
    title=${CAPTAIN_TEXT}
    role="img"
    aria-label="Captain"
    >C</span
  >`;
}

export const GOAT_TEXT = 'GOAT';

/** GoatMark — the small holographic "GOAT" tag on the card, row and pitch token of a GOAT. */
export function GoatMark({ size = 'sm', class: className }) {
  return html`<span
    class=${cx('goat-mark', `goat-mark--${size}`, className)}
    role="img"
    aria-label="GOAT"
    >GOAT</span
  >`;
}
