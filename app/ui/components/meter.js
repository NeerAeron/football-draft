/**
 * Meter — labelled horizontal bar (team OVR, ATT/MID/DEF, links, stamina, xG share…).
 *   label, value, min (0), max (100)
 *   tone      'volt' | 'gold' | 'coral' | 'sky' | 'green' | 'amber' | 'auto' (by value band:
 *             ≥85 green, ≥75 volt, ≥65 amber, else coral)                   default 'volt'
 *   size      'sm' (4px bar) | 'md' (8px) | 'lg' (12px)                       default 'md'
 *   valueText override the number shown on the right ('82', '7/11', '64%');  showValue (true)
 *   delta     signed number shown as +2 / −3 next to the value (green/coral)
 *   compare   ghost marker at another value (e.g. opponent, before-pick)
 *   hint      small caption under the bar
 *
 * StatBar — compact stat line for player detail: "PAC ▮▮▮▮▮▯ 89". Props: label, value,
 *   max (99), compare, tone ('auto').
 *
 * StatTile — big condensed number with a caption (record, goals, projection).
 *   label, value, tone ('default' | 'volt' | 'gold' | 'coral' | 'green' | 'muted'), delta, icon,
 *   size ('md' | 'lg')
 */
import { html, cx } from '../lib/html.js';
import { Icon } from './icon.js';

export const statTone = v => (v >= 85 ? 'green' : v >= 75 ? 'volt' : v >= 65 ? 'amber' : 'coral');

const pct = (v, min, max) => Math.max(0, Math.min(100, ((v - min) / (max - min || 1)) * 100));

function Delta({ delta }) {
  if (delta == null || delta === 0) return null;
  const up = delta > 0;
  return html`<span class=${cx('meter-delta', up ? 'is-up' : 'is-down')}
    >${up ? '+' : '−'}${Math.abs(delta)}</span
  >`;
}

export function Meter({
  label,
  value = 0,
  min = 0,
  max = 100,
  tone = 'volt',
  size = 'md',
  valueText,
  showValue = true,
  delta,
  compare,
  hint,
  class: className,
}) {
  const t = tone === 'auto' ? statTone(value) : tone;
  return html`<div class=${cx('meter', `meter--${size}`, `meter--${t}`, className)}>
    <div class="meter__head">
      <span class="meter__label">${label}</span>
      ${
        showValue &&
        html`<span class="meter__value num">${valueText ?? value}<${Delta} delta=${delta} /></span>`
      }
    </div>
    <div
      class="meter__track"
      role="meter"
      aria-label=${label}
      aria-valuemin=${min}
      aria-valuemax=${max}
      aria-valuenow=${value}
      aria-valuetext=${valueText ?? String(value)}
    >
      <span class="meter__fill" style=${`width:${pct(value, min, max)}%`}></span>
      ${
        compare != null &&
        html`<span class="meter__compare" style=${`left:${pct(compare, min, max)}%`}></span>`
      }
    </div>
    ${hint && html`<p class="meter__hint">${hint}</p>`}
  </div>`;
}

export function StatBar({ label, value = 0, max = 99, compare, tone = 'auto', class: className }) {
  const t = tone === 'auto' ? statTone(value) : tone;
  return html`<div class=${cx('statbar', `meter--${t}`, className)}>
    <span class="statbar__label">${label}</span>
    <span class="statbar__track" aria-hidden="true">
      <span class="meter__fill" style=${`width:${pct(value, 0, max)}%`}></span>
      ${
        compare != null &&
        html`<span class="meter__compare" style=${`left:${pct(compare, 0, max)}%`}></span>`
      }
    </span>
    <span class="statbar__value num">${value}</span>
  </div>`;
}

export function StatTile({
  label,
  value,
  tone = 'default',
  delta,
  icon,
  size = 'md',
  class: className,
}) {
  return html`<div class=${cx('stat-tile', `stat-tile--${tone}`, `stat-tile--${size}`, className)}>
    <span class="stat-tile__value num"
      >${icon && html`<${Icon} name=${icon} size=${18} />`}${value}<${Delta} delta=${delta}
    /></span>
    <span class="stat-tile__label">${label}</span>
  </div>`;
}
