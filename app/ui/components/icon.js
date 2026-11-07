/**
 * Icon — inline SVG icon (Lucide subset + custom football glyphs), inherits currentColor.
 *
 * Props:
 *   name         icon name; see ICON_NAMES (Lucide names such as 'trophy', 'volume-2',
 *                plus custom 'ball', 'pitch', 'reel')
 *   size         px (default 20)
 *   strokeWidth  default 2
 *   title        accessible name; omit for decorative icons (then aria-hidden)
 *   class        extra classes
 *
 *   html`<${Icon} name="trophy" size=${18} />`
 */
import { h, html, cx } from '../lib/html.js';
import { LUCIDE } from '../vendor/lucide/icons.js';

// Custom glyphs drawn on Lucide's 24×24 grid with the same stroke style.
const CUSTOM = {
  ball: [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['path', { d: 'M12 7l4.76 3.46-1.82 5.59H9.06l-1.82-5.59z' }],
    [
      'path',
      {
        d: 'M12 7V2M16.76 10.46l4.75-1.55M14.94 16.05l2.94 4.04M9.06 16.05l-2.94 4.04M7.24 10.46 2.49 8.91',
      },
    ],
  ],
  pitch: [
    ['rect', { x: '2', y: '4', width: '20', height: '16', rx: '2' }],
    ['path', { d: 'M12 4v16' }],
    ['circle', { cx: '12', cy: '12', r: '3' }],
    ['path', { d: 'M2 9h3v6H2M22 9h-3v6h3' }],
  ],
  // A spinning reel: three stacked cells with a pointer
  reel: [
    ['rect', { x: '4', y: '3', width: '13', height: '18', rx: '2' }],
    ['path', { d: 'M4 9h13M4 15h13' }],
    ['path', { d: 'm21 12-3-2v4z' }],
  ],
};

const ICONS = { ...LUCIDE, ...CUSTOM };
export const ICON_NAMES = Object.keys(ICONS).sort();

export function Icon({ name, size = 20, strokeWidth = 2, title, class: className, ...rest }) {
  const nodes = ICONS[name] || [];
  return html`<svg
    class=${cx('icon', className)}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width=${size}
    height=${size}
    fill="none"
    stroke="currentColor"
    stroke-width=${strokeWidth}
    stroke-linecap="round"
    stroke-linejoin="round"
    focusable="false"
    aria-hidden=${title ? undefined : 'true'}
    role=${title ? 'img' : undefined}
    data-icon=${name}
    ...${rest}
  >
    ${title && html`<title>${title}</title>`} ${nodes.map(([tag, attrs]) => h(tag, attrs))}
  </svg>`;
}
