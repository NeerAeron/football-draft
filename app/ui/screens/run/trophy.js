// The gold cup for the champion moment and the bracket's last node: the shared Cup component
// (components/cup.js) in gold. Decorative SVG; `glow` adds the floodlit halo.
import { html, cx } from '../../lib/html.js';
import { Cup } from '../../components/cup.js';
import { CUP_PATHS } from '../../lib/cup-paths.js';

export { CUP_PATHS };

export function Trophy({ size = 120, glow = false, class: className }) {
  return html`<${Cup} metal="gold" size=${size} glow=${glow} class=${cx('trophy', className)} />`;
}
