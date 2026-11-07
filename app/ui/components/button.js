/**
 * Button — every clickable action that is not an icon-only control.
 *
 * Props:
 *   variant   'primary' (volt, one per view) | 'secondary' | 'ghost' | 'danger'   default 'secondary'
 *   size      'sm' 36px (44px on touch) | 'md' 44px | 'lg' 52px | 'xl' 64px (hero CTA)  default 'md'
 *             lg/xl use the condensed display face in capitals.
 *   icon      leading icon name;  iconEnd  trailing icon name
 *   loading   shows a spinner, sets aria-busy and blocks clicks (keeps width)
 *   block     full width
 *   href      render an <a> (navigation, e.g. href('/settings')); otherwise a <button>
 *   type      button type (default 'button'); disabled; onClick; class; any aria-/data- attribute
 *   children  label
 *
 * IconButton — square icon-only button with a required accessible label.
 *   icon (required), label (required, used for aria-label + tooltip), variant 'ghost' (default) |
 *   'secondary' | 'primary', size 'sm' | 'md' (44) | 'lg', pressed (toggle → aria-pressed),
 *   badge (number/string shown as a corner dot), href, onClick, disabled, class.
 */
import { html, cx } from '../lib/html.js';
import { Icon } from './icon.js';

const ICON_SIZE = { sm: 16, md: 18, lg: 20, xl: 24 };

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconEnd,
  loading = false,
  block = false,
  href,
  type = 'button',
  disabled,
  onClick,
  class: className,
  children,
  ...rest
}) {
  const classes = cx(
    'btn',
    `btn--${variant}`,
    `btn--${size}`,
    block && 'btn--block',
    loading && 'is-loading',
    className,
  );
  const iconSize = ICON_SIZE[size] || 18;
  const lead = loading
    ? html`<span class="btn__spinner" aria-hidden="true"></span>`
    : icon && html`<${Icon} name=${icon} size=${iconSize} class="btn__icon" />`;
  const trail = iconEnd && html`<${Icon} name=${iconEnd} size=${iconSize} class="btn__icon" />`;
  const guard = loading ? e => e.preventDefault() : onClick;
  if (href && !disabled) {
    return html`<a
      class=${classes}
      href=${href}
      onClick=${guard}
      aria-busy=${loading ? 'true' : undefined}
      ...${rest}
      >${lead}<span class="btn__label">${children}</span>${trail}</a
    >`;
  }
  return html`<button
    class=${classes}
    type=${type}
    disabled=${disabled}
    aria-busy=${loading ? 'true' : undefined}
    onClick=${guard}
    ...${rest}
  >
    ${lead}<span class="btn__label">${children}</span>${trail}
  </button>`;
}

export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  pressed,
  badge,
  href,
  onClick,
  disabled,
  class: className,
  iconSize,
  ...rest
}) {
  const classes = cx(
    'icon-btn',
    `icon-btn--${variant}`,
    `icon-btn--${size}`,
    pressed && 'is-pressed',
    className,
  );
  const dot =
    badge != null && badge !== false
      ? html`<span class="icon-btn__badge" aria-hidden="true">${badge === true ? '' : badge}</span>`
      : null;
  const glyph = html`<${Icon} name=${icon} size=${iconSize || (size === 'lg' ? 22 : 20)} />${dot}`;
  if (href && !disabled)
    return html`<a class=${classes} href=${href} aria-label=${label} title=${label} ...${rest}
      >${glyph}</a
    >`;
  return html`<button
    type="button"
    class=${classes}
    aria-label=${label}
    title=${label}
    aria-pressed=${pressed == null ? undefined : String(!!pressed)}
    disabled=${disabled}
    onClick=${onClick}
    ...${rest}
  >
    ${glyph}
  </button>`;
}
