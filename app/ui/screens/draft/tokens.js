// The tokens of a World Cup draft: three small buttons with what is left of each — Nation
// (spin the nation again, the era stays), Era (spin the era again; the nation stays when the
// new era has it) and Prime (a drafted player becomes his best version: opens the Prime
// sheet). A button is disabled when its token is spent or there is nothing to spend it on.
// Data: draft-model.js tokenButtons(snapshot).
import { html, cx } from '../../lib/html.js';
import { Icon } from '../../components/index.js';
import { tokenButtons } from './draft-model.js';

/**
 * TokenBar props: snap (session snapshot), onToken(kind) — 'nation' | 'era' | 'prime' —,
 * only (optional list of kinds to show, e.g. ['prime'] beside the Spin button), busy
 * (a spin is animating: nothing can be spent).
 */
export function TokenBar({ snap, onToken, only = null, busy = false, class: className }) {
  const tokens = tokenButtons(snap).filter(t => !only || only.includes(t.kind));
  if (!tokens.length) return null;
  return html`<div
    class=${cx('draft-tokens', tokens.length === 1 && 'draft-tokens--one', className)}
    role="group"
    aria-label="Tokens"
  >
    ${tokens.map(
      t =>
        html`<button
          key=${t.kind}
          type="button"
          class=${cx('draft-token', `draft-token--${t.kind}`, t.left === 0 && 'is-spent')}
          disabled=${busy || t.disabled}
          onClick=${() => onToken(t.kind)}
          aria-label=${t.name}
          data-testid=${`token-${t.kind}`}
          data-left=${t.left}
        >
          <${Icon} name=${t.icon} size=${16} />
          <span class="draft-token__label">${t.label}</span>
          <b class="draft-token__count num">${t.left}</b>
        </button>`,
    )}
  </div>`;
}
