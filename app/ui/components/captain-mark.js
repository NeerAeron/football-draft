// CaptainMark — the armband mark on a Leader's card, row and pitch token (the game says
// "Leader"; the code and the data say captain). The tag gives
// every player of his XI +1 (core/draft/links.js, CONFIG.draft.links.captain).
//   size   'sm' (rows, tokens) | 'md' (cards)                                default 'sm'
import { html, cx } from '../lib/html.js';

export const CAPTAIN_TEXT = 'Leader: +1 to every player';

export function CaptainMark({ size = 'sm', class: className }) {
  return html`<span
    class=${cx('captain-mark', `captain-mark--${size}`, className)}
    title=${CAPTAIN_TEXT}
    role="img"
    aria-label="Leader"
    >L</span
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
