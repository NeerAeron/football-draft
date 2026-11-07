/**
 * Segmented — one-of-N choice (draft type, difficulty, speed). Native radio inputs, so
 * arrow keys move the selection and screen readers announce "radio, 2 of 4".
 *
 * Props:
 *   label     accessible group name (required)
 *   options   [{ value, label, icon?, hint?, disabled? }]  (hint = small second line)
 *   value     selected value;  onChange(value)
 *   size      'sm' | 'md' (44px) | 'lg'                                   default 'md'
 *   block     stretch to full width with equal segments
 *   tone      'volt' (default) | 'gold' — colour of the selected thumb
 *   name      radio group name (auto)
 */
import { useMemo } from 'preact/hooks';
import { html, cx, nextId } from '../lib/html.js';
import { Icon } from './icon.js';

export function Segmented({
  label,
  options = [],
  value,
  onChange,
  size = 'md',
  block = false,
  tone = 'volt',
  name,
  class: className,
}) {
  const group = useMemo(() => name || nextId('seg'), [name]);
  return html`<div
    class=${cx('segmented', `segmented--${size}`, `segmented--${tone}`, block && 'segmented--block', className)}
    role="radiogroup"
    aria-label=${label}
  >
    ${options.map(
      o =>
        html`<label
          key=${o.value}
          class=${cx('segmented__item', value === o.value && 'is-selected', o.disabled && 'is-disabled')}
        >
          <input
            class="segmented__input"
            type="radio"
            name=${group}
            value=${o.value}
            checked=${value === o.value}
            disabled=${o.disabled}
            onChange=${() => onChange?.(o.value)}
          />
          <span class="segmented__face">
            ${o.icon && html`<${Icon} name=${o.icon} size=${size === 'lg' ? 20 : 16} />`}
            <span class="segmented__text">
              <span class="segmented__label">${o.label}</span>
              ${o.hint && html`<span class="segmented__hint">${o.hint}</span>`}
            </span>
          </span>
        </label>`,
    )}
  </div>`;
}
