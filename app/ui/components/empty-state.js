/**
 * EmptyState — "nothing here yet" / error / coming-soon block.
 *   icon     icon name (default 'sparkles');  tone 'default' | 'volt' | 'gold' | 'coral'
 *   title    heading;  message  supporting text (node ok)
 *   action   node (usually a Button) under the text
 *   size     'sm' | 'md' (default) | 'lg';  level  heading level (default 2)
 *   children extra content under the action
 */
import { html, cx } from '../lib/html.js';
import { Icon } from './icon.js';

export function EmptyState({
  icon = 'sparkles',
  tone = 'default',
  title,
  message,
  action,
  size = 'md',
  level = 2,
  class: className,
  children,
}) {
  const Heading = `h${level}`;
  return html`<div class=${cx('empty', `empty--${size}`, `empty--${tone}`, className)}>
    <span class="empty__icon" aria-hidden="true"
      ><${Icon} name=${icon} size=${size === 'lg' ? 34 : size === 'sm' ? 20 : 26}
    /></span>
    ${title && html`<${Heading} class="empty__title">${title}<//>`}
    ${message && html`<p class="empty__message">${message}</p>`}
    ${action && html`<div class="empty__action">${action}</div>`} ${children}
  </div>`;
}
