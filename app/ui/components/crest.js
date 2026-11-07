/**
 * Crest — club badge stand-in: a disc (or shield) in the club's colours with initials.
 * (We do not ship club badges.)
 *   name     club name (initials + accessible name)
 *   short    explicit initials (2–3 chars) instead of the derived ones
 *   colors   [primary, secondary] hex from catalog teams[].primary/secondary
 *   shape    'disc' (default) | 'shield'
 *   size     px (default 32)
 *   decorative  hide from assistive tech when the name is printed next to it
 *
 * LeagueLogo — league logo on a light tile (logos are dark-on-transparent PNGs).
 *   src      catalog leagues[].logo ('./assets/logos/league-4328.png')
 *   name     league name (alt + fallback initials)
 *   size     px (default 32);  tier  optional 'A'..'F' corner tag;  decorative
 */
import { useEffect, useState } from 'preact/hooks';
import { html, cx } from '../lib/html.js';
import { teamStyle } from '../lib/color.js';

const NOISE = new Set([
  'fc',
  'cf',
  'afc',
  'sc',
  'ac',
  'as',
  'ss',
  'ssc',
  'sv',
  'vfb',
  'vfl',
  'tsg',
  'rc',
  'rcd',
  'cd',
  'ud',
  'sd',
  'ca',
  'cr',
  'club',
  'de',
  'del',
  'la',
  'le',
  'the',
  'of',
  'and',
  '1.',
  'fk',
  'sk',
  'nk',
  'bk',
  'if',
  'ik',
  'calcio',
  'football',
  'futbol',
]);

/** 'Paris Saint-Germain' → 'PSG', 'Liverpool' → 'LIV', 'FC Bayern München' → 'BM'. */
export function clubInitials(name = '', max = 3) {
  const words = String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[\s-]+/)
    .filter(w => w && !NOISE.has(w.toLowerCase()) && !/^\d+$/.test(w));
  if (!words.length) return String(name).slice(0, max).toUpperCase() || '?';
  if (words.length === 1) return words[0].slice(0, max).toUpperCase();
  return words
    .slice(0, max)
    .map(w => w[0])
    .join('')
    .toUpperCase();
}

export function Crest({
  name = '',
  short,
  colors = [],
  shape = 'disc',
  size = 32,
  decorative = false,
  class: className,
  ...rest
}) {
  const text = short || clubInitials(name);
  const style = { ...teamStyle(colors), '--crest': `${size}px` };
  const a11y = decorative
    ? { 'aria-hidden': 'true' }
    : { role: 'img', 'aria-label': name || text, title: name || undefined };
  if (shape === 'shield')
    return html`<span
      class=${cx('crest', 'crest--shield', className)}
      style=${style}
      ...${a11y}
      ...${rest}
    >
      <svg viewBox="0 0 40 46" aria-hidden="true" focusable="false">
        <path
          class="crest__shield"
          d="M20 1.5 37.5 7v15.5c0 11.2-7.3 18.3-17.5 22-10.2-3.7-17.5-10.8-17.5-22V7z"
        />
        <path class="crest__band" d="M2.5 16h35v6h-35z" />
      </svg>
      <span class="crest__text" data-len=${text.length}>${text}</span>
    </span>`;
  return html`<span
    class=${cx('crest', 'crest--disc', className)}
    style=${style}
    ...${a11y}
    ...${rest}
  >
    <span class="crest__text" data-len=${text.length}>${text}</span>
  </span>`;
}

export function LeagueLogo({
  src,
  name = '',
  size = 32,
  tier,
  decorative = false,
  class: className,
  ...rest
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return html`<span
    class=${cx('league-logo', (!src || failed) && 'league-logo--fallback', className)}
    style=${`--logo:${size}px`}
    ...${rest}
  >
    ${
      src && !failed
        ? html`<img
            src=${src}
            alt=${decorative ? '' : name}
            loading="lazy"
            decoding="async"
            width=${size}
            height=${size}
            onError=${() => setFailed(true)}
          />`
        : html`<span
            class="league-logo__initials"
            role=${decorative ? undefined : 'img'}
            aria-label=${decorative ? undefined : name}
            >${clubInitials(name, 3)}</span
          >`
    }
    ${tier && html`<span class="league-logo__tier" aria-hidden="true">${tier}</span>`}
  </span>`;
}
