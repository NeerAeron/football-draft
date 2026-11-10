/**
 * Cup, Medal, Prize — the trophies of a World Cup Run (our own drawings, decorative SVG).
 *   <Cup metal="gold" size=${120} glow />      metal 'gold' | 'silver' | 'bronze' | 'holo';
 *                                              emblem 'star' (default) | 'coin' | 'crown';
 *                                              empty: an unlit outline (not won yet)
 *   <Medal metal="silver" size=${64} />        a medal on a ribbon with its rank (1, 2, 3)
 *   <Prize medal="bronze" size=${64} />        what a place wins: the gold cup, or the silver /
 *                                              bronze medal; no medal → the empty cup
 * `budget` marks a Budget-mode trophy: a green ribbon / base and a coin for an emblem.
 */
import { html, cx } from '../lib/html.js';
import { CUP_PATHS, METALS } from '../lib/cup-paths.js';

let uid = 0;
const RANK = { gold: '1', silver: '2', bronze: '3' };
const BUDGET_GREEN = ['#0f7a4b', '#3ddc84', '#0c6a40'];

function defs(id, metal, glow) {
  const { face, edge } = METALS[metal] || METALS.gold;
  return html`<defs>
    <linearGradient id=${`${id}-g`} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color=${face[0]} />
      <stop offset="0.3" stop-color=${face[1]} />
      <stop offset="0.55" stop-color=${face[2]} />
      <stop offset="0.78" stop-color=${face[3]} />
      <stop offset="1" stop-color=${face[0]} />
    </linearGradient>
    <linearGradient id=${`${id}-d`} x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color=${edge[0]} />
      <stop offset="0.5" stop-color=${edge[1]} />
      <stop offset="1" stop-color=${edge[2]} />
    </linearGradient>
    <linearGradient id=${`${id}-b`} x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color=${BUDGET_GREEN[0]} />
      <stop offset="0.5" stop-color=${BUDGET_GREEN[1]} />
      <stop offset="1" stop-color=${BUDGET_GREEN[2]} />
    </linearGradient>
    ${
      glow &&
      html`<radialGradient id=${`${id}-h`} cx="0.5" cy="0.45" r="0.5">
        <stop offset="0" stop-color=${face[1]} stop-opacity="0.6" />
        <stop offset="0.5" stop-color=${face[1]} stop-opacity="0.12" />
        <stop offset="1" stop-color=${face[1]} stop-opacity="0" />
      </radialGradient>`
    }
  </defs>`;
}

export function Cup({
  metal = 'gold',
  size = 120,
  glow = false,
  empty = false,
  budget = false,
  emblem = budget ? 'coin' : 'star',
  class: className,
}) {
  const id = `cup-${++uid}`;
  const box = { viewBox: '-10 -14 120 128', width: size, height: (size * 128) / 120 };
  if (empty)
    return html`<svg
      class=${cx('cup cup--empty', budget && 'cup--budget', className)}
      ...${box}
      aria-hidden="true"
      focusable="false"
    >
      <g fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round">
        <path d=${CUP_PATHS.handleLeft} stroke-linecap="round" />
        <path d=${CUP_PATHS.handleRight} stroke-linecap="round" />
        <path d=${CUP_PATHS.bowl} stroke-dasharray="5 5" />
        <path d=${CUP_PATHS.stem} />
        <path d=${CUP_PATHS.base} />
      </g>
    </svg>`;
  const g = `url(#${id}-g)`,
    d = `url(#${id}-d)`;
  return html`<svg
    class=${cx('cup', `cup--${metal}`, glow && 'cup--glow', budget && 'cup--budget', className)}
    ...${box}
    aria-hidden="true"
    focusable="false"
  >
    ${defs(id, metal, glow)}
    ${glow && html`<circle cx="50" cy="50" r="62" fill=${`url(#${id}-h)`} />`}
    <path
      d=${CUP_PATHS.handleLeft}
      fill="none"
      stroke=${d}
      stroke-width="5"
      stroke-linecap="round"
    />
    <path
      d=${CUP_PATHS.handleRight}
      fill="none"
      stroke=${d}
      stroke-width="5"
      stroke-linecap="round"
    />
    <path d=${CUP_PATHS.bowl} fill=${g} />
    <path d="M23 6h54v6H23z" fill="#ffffff" opacity="0.45" />
    <path d=${CUP_PATHS.stem} fill=${d} />
    <rect x="39" y="77" width="22" height="6" rx="3" fill=${g} />
    <path d=${CUP_PATHS.base} fill=${g} />
    <rect x="26" y="99" width="48" height="9" rx="2" fill=${budget ? `url(#${id}-b)` : d} />
    ${
      emblem === 'coin'
        ? html`<circle cx="50" cy="29" r="11" fill=${`url(#${id}-b)`} />
            <circle cx="50" cy="29" r="7" fill="none" stroke="#eafff3" stroke-width="2" />
            <path d="M50 25v8" stroke="#eafff3" stroke-width="2" stroke-linecap="round" />`
        : html`<path
            d=${emblem === 'crown' ? CUP_PATHS.crown : CUP_PATHS.star}
            fill="#ffffff"
            opacity="0.92"
          />`
    }
    <path d="M28 10c2 22 8 35 18 44" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.45" />
  </svg>`;
}

export function Medal({ metal = 'silver', size = 64, budget = false, class: className }) {
  const id = `medal-${++uid}`;
  const ribbon = budget ? ['#0f7a4b', '#3ddc84'] : ['#27407a', '#5c86e6'];
  return html`<svg
    class=${cx('medal', `medal--${metal}`, budget && 'medal--budget', className)}
    viewBox="0 0 100 120"
    width=${(size * 100) / 120}
    height=${size}
    aria-hidden="true"
    focusable="false"
  >
    ${defs(id, metal, false)}
    <path d="M24 0h20l14 46H40z" fill=${ribbon[0]} />
    <path d="M76 0H56L42 46h18z" fill=${ribbon[1]} />
    <circle cx="50" cy="78" r="38" fill=${`url(#${id}-d)`} />
    <circle cx="50" cy="78" r="31" fill=${`url(#${id}-g)`} />
    <circle cx="50" cy="78" r="24" fill="none" stroke="#ffffff" stroke-width="1.5" opacity="0.5" />
    <text
      x="50"
      y="92"
      text-anchor="middle"
      font-family="var(--font-display)"
      font-size="40"
      font-weight="800"
      fill="rgb(7 11 22 / 0.78)"
    >
      ${RANK[metal] || ''}
    </text>
  </svg>`;
}

/** The prize of a finish: gold cup, silver or bronze medal, or the unlit cup. */
export function Prize({ medal = null, size = 64, glow = false, budget = false, class: className }) {
  if (medal === 'gold' || medal === 'holo')
    return html`<${Cup}
      metal=${medal}
      size=${size}
      glow=${glow}
      budget=${budget}
      emblem=${medal === 'holo' ? 'crown' : undefined}
      class=${className}
    />`;
  if (medal === 'silver' || medal === 'bronze')
    return html`<${Medal} metal=${medal} size=${size} budget=${budget} class=${className} />`;
  return html`<${Cup} empty size=${size} budget=${budget} class=${className} />`;
}
