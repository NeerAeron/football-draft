// htm bound to Preact's h(): write components as tagged templates, no build step.
//   import { html, cx } from '../lib/html.js';
//   return html`<button class=${cx('btn', primary && 'btn--primary')}>${label}</button>`;
import { h, Fragment, render, Component, createContext } from 'preact';
import htm from 'htm';

export const html = htm.bind(h);
export { h, Fragment, render, Component, createContext };

/** Join truthy class names: cx('a', cond && 'b', ['c', null]) → 'a b c'. */
export function cx(...parts) {
  let out = '';
  for (const part of parts) {
    if (!part) continue;
    const value = Array.isArray(part) ? cx(...part) : String(part);
    if (value) out = out ? `${out} ${value}` : value;
  }
  return out;
}

let idCounter = 0;
/** Unique, stable-per-call DOM id with a readable prefix (pair with useMemo/useRef). */
export const nextId = (prefix = 'ui') => `${prefix}-${++idCounter}`;
