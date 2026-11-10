// Home hero illustration, as on the link-preview card: a tilted pitch with an XI of national
// flags joined by gold link lines, under floodlight beams. Decorative (no names, no ratings).
import { html, cx } from '../../lib/html.js';
import { Flag } from '../../components/flag.js';

const FLAGS = ['br', 'ar', 'fr', 'es', 'gb-eng', 'nl', 'pt', 'de', 'ma', 'jp', 'it'];
const NAMES = [
  'Brazil',
  'Argentina',
  'France',
  'Spain',
  'England',
  'Netherlands',
  'Portugal',
  'Germany',
  'Morocco',
  'Japan',
  'Italy',
];
// 4-3-3, keeper at the bottom: [left %, top %]
const SLOTS = [
  [50, 89],
  [16, 70],
  [38, 74],
  [62, 74],
  [84, 70],
  [28, 47],
  [50, 53],
  [72, 47],
  [18, 22],
  [50, 15],
  [82, 22],
];
const HOLO = new Set([1, 6, 9, 10]);
const LINKS = [
  [9, 10],
  [6, 9],
  [5, 6],
  [2, 3],
  [3, 7],
];

export function HeroPitch() {
  return html`<div class="hero-pitch" aria-hidden="true">
    <svg class="hero-pitch__lines" viewBox="0 0 400 526" preserveAspectRatio="none">
      <rect x="14" y="14" width="372" height="498" rx="6" />
      <path d="M14 263h372" />
      <circle cx="200" cy="263" r="48" />
      <path d="M100 14v76h200V14M152 14v26h96V14" />
      <path d="M100 512v-76h200v76M152 512v-26h96v26" />
      ${LINKS.map(
        ([a, b]) =>
          html`<line
            key=${`${a}-${b}`}
            class="hero-pitch__link"
            x1=${SLOTS[a][0] * 4}
            y1=${SLOTS[a][1] * 5.26}
            x2=${SLOTS[b][0] * 4}
            y2=${SLOTS[b][1] * 5.26}
          />`,
      )}
    </svg>
    ${SLOTS.map(
      ([x, y], i) =>
        html`<span
          key=${i}
          class=${cx('hero-pitch__tok', HOLO.has(i) && 'is-holo')}
          style=${`left:${x}%;top:${y}%`}
          ><${Flag} code=${FLAGS[i]} name=${NAMES[i]} size=${64} decorative
        /></span>`,
    )}
  </div>`;
}
