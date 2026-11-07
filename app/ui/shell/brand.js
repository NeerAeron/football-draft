// Brand mark + wordmark. The mark is a volt badge with a ball glyph; the wordmark sets
// "Football" in white and "Draft" in volt, condensed caps.
import { html, cx } from '../lib/html.js';

export function BrandMark({ size = 32, class: className }) {
  return html`<svg
    class=${cx('brand-mark', className)}
    width=${size}
    height=${size}
    viewBox="0 0 40 40"
    aria-hidden="true"
    focusable="false"
  >
    <rect x="1" y="1" width="38" height="38" rx="11" class="brand-mark__bg" />
    <circle cx="20" cy="20" r="11.5" class="brand-mark__ball" />
    <path d="M20 14.2l5.5 4-2.1 6.5h-6.8l-2.1-6.5z" class="brand-mark__patch" />
    <path
      d="M20 14.2V8.5M25.5 18.2l5.4-1.8M23.4 24.7l3.4 4.6M16.6 24.7l-3.4 4.6M14.5 18.2l-5.4-1.8"
      class="brand-mark__seams"
    />
  </svg>`;
}

export function Brand({ href = '#/', compact = false }) {
  return html`<a
    class=${cx('brand', compact && 'brand--compact')}
    href=${href}
    aria-label="Football Draft — home"
  >
    <${BrandMark} />
    <span class="brand__word" aria-hidden="true">Football<b>Draft</b></span>
  </a>`;
}
