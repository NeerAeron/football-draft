// The gold cup (our own drawing, same shape as the Home hero's) for the champion moment and
// the bracket's last node. Decorative SVG; `glow` adds the floodlit halo.
import { html, cx } from '../../lib/html.js';
import { CUP_PATHS } from '../../lib/share-image.js';

export { CUP_PATHS };

let uid = 0;
export function Trophy({ size = 120, glow = false, class: className }) {
  const id = `cup-${++uid}`;
  return html`<svg
    class=${cx('trophy', glow && 'trophy--glow', className)}
    viewBox="-10 -14 120 128"
    width=${size}
    height=${(size * 128) / 120}
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id=${`${id}-g`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fff4cf" />
        <stop offset="0.3" stop-color="#f5c84c" />
        <stop offset="0.55" stop-color="#a8770f" />
        <stop offset="0.78" stop-color="#f7d774" />
        <stop offset="1" stop-color="#fff1c4" />
      </linearGradient>
      <linearGradient id=${`${id}-d`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#8a5d06" />
        <stop offset="0.5" stop-color="#f2c94c" />
        <stop offset="1" stop-color="#7a5205" />
      </linearGradient>
      <radialGradient id=${`${id}-h`} cx="0.5" cy="0.45" r="0.5">
        <stop offset="0" stop-color="#f5c84c" stop-opacity="0.6" />
        <stop offset="0.5" stop-color="#f5c84c" stop-opacity="0.12" />
        <stop offset="1" stop-color="#f5c84c" stop-opacity="0" />
      </radialGradient>
    </defs>
    ${glow && html`<circle cx="50" cy="50" r="62" fill=${`url(#${id}-h)`} />`}
    <path
      d=${CUP_PATHS.handleLeft}
      fill="none"
      stroke=${`url(#${id}-d)`}
      stroke-width="5"
      stroke-linecap="round"
    />
    <path
      d=${CUP_PATHS.handleRight}
      fill="none"
      stroke=${`url(#${id}-d)`}
      stroke-width="5"
      stroke-linecap="round"
    />
    <path d=${CUP_PATHS.bowl} fill=${`url(#${id}-g)`} />
    <path d="M23 6h54v6H23z" fill="#fff4cf" opacity="0.6" />
    <path d=${CUP_PATHS.stem} fill=${`url(#${id}-d)`} />
    <rect x="39" y="77" width="22" height="6" rx="3" fill=${`url(#${id}-g)`} />
    <path d=${CUP_PATHS.base} fill=${`url(#${id}-g)`} />
    <rect x="26" y="99" width="48" height="9" rx="2" fill=${`url(#${id}-d)`} />
    <path d=${CUP_PATHS.star} fill="#fff8de" opacity="0.92" />
    <path d="M28 10c2 22 8 35 18 44" fill="none" stroke="#fff8de" stroke-width="2" opacity="0.5" />
  </svg>`;
}
