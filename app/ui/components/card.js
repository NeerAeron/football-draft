/**
 * Card — a surface. Becomes a link (href) or button (onClick) when interactive.
 *   variant  'default' | 'raised' | 'outline' | 'glass' | 'hero' (floodlit) | 'gold' (foil edge)
 *            | 'volt' (accent edge)                                            default 'default'
 *   padding  'none' | 'sm' | 'md' | 'lg'                                        default 'md'
 *   href / onClick  make the whole card interactive (hover lift, focus ring)
 *   as       element for static cards ('div' default, 'section', 'article', 'li')
 *   class, style, children, any aria-/data- attribute
 *
 * Panel — a titled card section.
 *   title, eyebrow, description, actions (node, right of the title), level (heading level, 2),
 *   variant, padding, id (also used for aria-labelledby), children
 */
import { useMemo } from 'preact/hooks';
import { h, html, cx, nextId } from '../lib/html.js';

export function Card({
  variant = 'default',
  padding = 'md',
  href,
  onClick,
  as = 'div',
  class: className,
  children,
  ...rest
}) {
  const interactive = !!(href || onClick);
  const classes = cx(
    'card',
    `card--${variant}`,
    `card--pad-${padding}`,
    interactive && 'card--interactive',
    className,
  );
  if (href)
    return html`<a class=${classes} href=${href} onClick=${onClick} ...${rest}>${children}</a>`;
  if (onClick)
    return html`<button type="button" class=${classes} onClick=${onClick} ...${rest}>
      ${children}
    </button>`;
  return h(as, { class: classes, ...rest }, children);
}

export function Panel({
  title,
  eyebrow,
  description,
  actions,
  level = 2,
  variant = 'default',
  padding = 'md',
  id,
  class: className,
  children,
  ...rest
}) {
  const headingId = useMemo(() => (id ? `${id}-title` : nextId('panel')), [id]);
  const Heading = `h${level}`;
  return html`<${Card}
    as="section"
    variant=${variant}
    padding=${padding}
    class=${cx('panel', className)}
    id=${id}
    aria-labelledby=${title ? headingId : undefined}
    ...${rest}
  >
    ${
      (title || actions) &&
      html`<header class="panel__header">
        <div class="panel__titles">
          ${eyebrow && html`<p class="eyebrow">${eyebrow}</p>`}
          ${title && html`<${Heading} class="panel__title" id=${headingId}>${title}<//>`}
          ${description && html`<p class="panel__description">${description}</p>`}
        </div>
        ${actions && html`<div class="panel__actions">${actions}</div>`}
      </header>`
    }
    ${children}
  <//>`;
}
