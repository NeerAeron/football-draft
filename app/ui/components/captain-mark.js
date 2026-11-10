// CaptainMark — the armband "C" on a captain's card, row and pitch token. The Captain tag gives
// every player of his XI a boost (core/draft/links.js, CONFIG.draft.links.captain).
//   size   'sm' (rows, tokens) | 'md' (cards)                                default 'sm'
import { html, cx } from '../lib/html.js';

export const CAPTAIN_TEXT = 'Captain: every player in his XI gets a boost.';

export function CaptainMark({ size = 'sm', class: className }) {
  return html`<span
    class=${cx('captain-mark', `captain-mark--${size}`, className)}
    title=${CAPTAIN_TEXT}
    role="img"
    aria-label="Captain"
    >C</span
  >`;
}
