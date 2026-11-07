/**
 * Skeleton — loading placeholder with a soft shimmer (static under reduced motion).
 *   variant  'text' (default) | 'rect' | 'circle' | 'card' (PlayerCard M) | 'row' (PlayerRow)
 *   width, height  CSS lengths (numbers = px);  radius  CSS length
 *   lines    for 'text': number of lines (last one shorter)
 *   label    accessible text (default 'Loading')
 */
import { html, cx } from '../lib/html.js';

const px = v => (typeof v === 'number' ? `${v}px` : v);

export function Skeleton({
  variant = 'text',
  width,
  height,
  radius,
  lines = 1,
  label = 'Loading',
  class: className,
}) {
  const style = [
    width != null && `width:${px(width)}`,
    height != null && `height:${px(height)}`,
    radius != null && `border-radius:${px(radius)}`,
  ]
    .filter(Boolean)
    .join(';');
  if (variant === 'text' && lines > 1)
    return html`<span class=${cx('skeleton-lines', className)} role="status" aria-label=${label}>
      ${Array.from(
        { length: lines },
        (_, i) =>
          html`<span
            class="skeleton skeleton--text"
            style=${i === lines - 1 ? 'width:62%' : style}
            aria-hidden="true"
          ></span>`,
      )}
    </span>`;
  return html`<span
    class=${cx('skeleton', `skeleton--${variant}`, className)}
    style=${style}
    role="status"
    aria-label=${label}
  ></span>`;
}
