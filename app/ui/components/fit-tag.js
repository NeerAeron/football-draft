/**
 * FitTag — how well a player fits a slot, shown before the pick is locked.
 *   fit  { state, label?, from?, to? }
 *        state 'best'    volt   "Best"            (auto-place target)
 *              'ok'      green  check + label     (natural position, e.g. "LW")
 *              'penalty' amber  "79 → 75"         (from/to = OVR before/after familiarity)
 *              'swap'    sky    "Swap"            (slot is filled; picking swaps)
 *              'blocked' coral  ban + "Blocked"   (cannot go there)
 *              'neutral' muted  label only        (e.g. "CM · DM" list of fitting positions)
 *   size 'sm' | 'md' (default 'md');  hideRatings: hides the numbers in 'penalty'
 */
import { html, cx } from '../lib/html.js';
import { Icon } from './icon.js';

const DEFAULT_LABEL = { best: 'Best', ok: 'Fits', swap: 'Swap', blocked: 'Blocked' };

/** Plain-text description, for aria-labels. */
export function fitText(fit, hideRatings = false) {
  if (!fit) return '';
  if (fit.state === 'penalty')
    return hideRatings || fit.from == null
      ? `out of position${fit.label ? `, ${fit.label}` : ''}`
      : `out of position, rating ${fit.from} to ${fit.to}`;
  return fit.label || DEFAULT_LABEL[fit.state] || '';
}

export function FitTag({ fit, size = 'md', hideRatings = false, class: className }) {
  if (!fit) return null;
  const state = fit.state || 'neutral';
  const iconSize = size === 'sm' ? 11 : 13;
  let content;
  if (state === 'penalty' && !hideRatings && fit.from != null) {
    content = html`<span class="num">${fit.from}</span
      ><${Icon} name="arrow-right" size=${iconSize} strokeWidth=${2.5} /><span class="num"
        >${fit.to}</span
      >`;
  } else {
    const icon = {
      best: 'star',
      ok: 'check',
      swap: 'arrow-up-down',
      blocked: 'ban',
      penalty: 'triangle-alert',
    }[state];
    content = html`${icon && html`<${Icon} name=${icon} size=${iconSize} strokeWidth=${2.5} />`}<span
        >${fit.label ?? DEFAULT_LABEL[state] ?? ''}</span
      >`;
  }
  return html`<span
    class=${cx('fit-tag', `fit-tag--${state}`, `fit-tag--${size}`, className)}
    title=${fitText(fit, hideRatings)}
    >${content}</span
  >`;
}
