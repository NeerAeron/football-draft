/**
 * Flag — national flag as a circular token or a 4:3 rectangle.
 *   code        flag-icons code from catalog.nations[].code ('br', 'gb-eng' …)
 *   name        nation name (alt text + initials fallback)
 *   shape       'circle' (default) | 'rect'
 *   size        px — circle diameter / rectangle height (default 24)
 *   src         explicit image URL (overrides the code lookup)
 *   decorative  true when the name is already printed next to it (alt="")
 *
 * Images load lazily from './assets/flags/<code>.svg' (resolved against the page, like the
 * catalog's logo paths). A missing file or code falls back to initials. Tests/the gallery can
 * swap the lookup with setFlagResolver(code => url | null).
 */
import { useEffect, useState } from 'preact/hooks';
import { html, cx } from '../lib/html.js';

let resolveFlag = code => `./assets/flags/${code}.svg`;

/** Replace how codes map to URLs (return null to force the initials fallback). */
export function setFlagResolver(fn) {
  resolveFlag = fn;
}

export const flagUrl = code => (code ? resolveFlag(String(code).toLowerCase()) : null);

const STOP = new Set(['and', 'of', 'the', 'de', 'du', 'des', 'la', 'le', 'da', 'do', 'di']);

/** 'Côte d'Ivoire' → 'CI'; 'Brazil' → 'BRA' (3 letters for single words when max ≥ 3). */
export function flagInitials(name = '', code = '', max = 3) {
  const words = String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[\s'’-]+/)
    .filter(w => w && !STOP.has(w.toLowerCase()));
  if (words.length > 1)
    return words
      .slice(0, max)
      .map(w => w[0])
      .join('')
      .toUpperCase();
  if (words.length === 1) return words[0].slice(0, max).toUpperCase();
  return String(code).split('-').pop().slice(0, max).toUpperCase() || '?';
}

export function Flag({
  code,
  name = '',
  shape = 'circle',
  size = 24,
  src,
  decorative = false,
  class: className,
  ...rest
}) {
  const url = src || flagUrl(code);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const width = shape === 'rect' ? Math.round((size * 4) / 3) : size;
  const style = `--flag-h:${size}px;--flag-w:${width}px`;
  const classes = cx('flag', `flag--${shape}`, className);
  if (!url || failed) {
    const text = flagInitials(name, code, size < 30 && shape === 'circle' ? 2 : 3);
    return html`<span
      class=${cx(classes, 'flag--fallback')}
      style=${style}
      role=${decorative ? undefined : 'img'}
      aria-label=${decorative ? undefined : name || code}
      aria-hidden=${decorative ? 'true' : undefined}
      ...${rest}
      ><span class="flag__initials">${text}</span></span
    >`;
  }
  return html`<span class=${classes} style=${style} ...${rest}>
    <img
      class="flag__img"
      src=${url}
      alt=${decorative ? '' : name}
      loading="lazy"
      decoding="async"
      width=${width}
      height=${size}
      onError=${() => setFailed(true)}
    />
  </span>`;
}
