/**
 * Chip — small static label (status, badge, tag).
 *   tone     'neutral' | 'volt' | 'gold' | 'coral' | 'green' | 'sky' | 'amber' | 'holo'  default 'neutral'
 *   variant  'soft' (tinted, default) | 'solid' | 'outline'
 *   size     'sm' (20px) | 'md' (26px)                                               default 'md'
 *   icon     leading icon name;  title (tooltip);  class;  children
 *
 * ToggleChip — a pressable chip (filters, options). aria-pressed reflects `pressed`.
 *   pressed, onChange(nextPressed), icon, count (trailing number), disabled, size, children
 *
 * ChipGroup — row of ToggleChips acting as a filter group.
 *   label     accessible group name (required)
 *   options   [{ value, label, icon?, count?, disabled? }]
 *   value     selected value (single) — or an array when `multiple`
 *   multiple  allow several (value is an array);  allowEmpty (single: tap again to clear)
 *   onChange(nextValue);  size;  scroll (one scrollable row instead of wrapping)
 */
import { html, cx } from '../lib/html.js';
import { Icon } from './icon.js';

export function Chip({
  tone = 'neutral',
  variant = 'soft',
  size = 'md',
  icon,
  class: className,
  children,
  ...rest
}) {
  return html`<span
    class=${cx('chip', `chip--${tone}`, `chip--${variant}`, `chip--${size}`, className)}
    ...${rest}
    >${icon && html`<${Icon} name=${icon} size=${size === 'sm' ? 12 : 14} />`}${children}</span
  >`;
}

export function ToggleChip({
  pressed = false,
  onChange,
  icon,
  count,
  disabled,
  size = 'md',
  class: className,
  children,
  ...rest
}) {
  return html`<button
    type="button"
    class=${cx('toggle-chip', `toggle-chip--${size}`, pressed && 'is-pressed', className)}
    aria-pressed=${String(!!pressed)}
    disabled=${disabled}
    onClick=${() => onChange?.(!pressed)}
    ...${rest}
  >
    ${icon && html`<${Icon} name=${icon} size=${14} />`}<span>${children}</span>${
      count != null && html`<span class="toggle-chip__count">${count}</span>`
    }
  </button>`;
}

export function ChipGroup({
  label,
  options = [],
  value,
  multiple = false,
  allowEmpty = false,
  onChange,
  size = 'md',
  scroll = false,
  class: className,
}) {
  const selected = multiple ? new Set(value || []) : null;
  const isOn = v => (multiple ? selected.has(v) : value === v);
  const toggle = v => {
    if (multiple) {
      const next = new Set(selected);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      onChange?.(options.map(o => o.value).filter(x => next.has(x)));
    } else if (value === v) {
      if (allowEmpty) onChange?.(null);
    } else onChange?.(v);
  };
  return html`<div
    class=${cx('chip-group', scroll && 'chip-group--scroll', className)}
    role="group"
    aria-label=${label}
  >
    ${options.map(
      o =>
        html`<${ToggleChip}
          key=${o.value}
          size=${size}
          icon=${o.icon}
          count=${o.count}
          disabled=${o.disabled}
          pressed=${isOn(o.value)}
          onChange=${() => toggle(o.value)}
          >${o.label}<//
        >`,
    )}
  </div>`;
}
