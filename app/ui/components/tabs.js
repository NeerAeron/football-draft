/**
 * Tabs — ARIA tablist with roving focus (←/→/Home/End) and one panel.
 *   label     accessible name of the tablist (required)
 *   tabs      [{ id, label, icon?, badge? }]
 *   value     active tab id;  onChange(id)
 *   variant   'underline' (default) | 'pill'
 *   block     tabs share the full width
 *   children  content of the active panel (or a function (id) => node)
 *   idPrefix  stable id prefix (auto)
 */
import { useMemo, useRef } from 'preact/hooks';
import { html, cx, nextId } from '../lib/html.js';
import { Icon } from './icon.js';

export function Tabs({
  label,
  tabs = [],
  value,
  onChange,
  variant = 'underline',
  block = false,
  idPrefix,
  class: className,
  children,
}) {
  const prefix = useMemo(() => idPrefix || nextId('tabs'), [idPrefix]);
  const refs = useRef({});
  const active = tabs.some(t => t.id === value) ? value : tabs[0]?.id;
  const onKeyDown = e => {
    const i = tabs.findIndex(t => t.id === active);
    const next =
      e.key === 'ArrowRight'
        ? (i + 1) % tabs.length
        : e.key === 'ArrowLeft'
          ? (i - 1 + tabs.length) % tabs.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? tabs.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange?.(tabs[next].id);
    refs.current[tabs[next].id]?.focus();
  };
  return html`<div class=${cx('tabs', `tabs--${variant}`, block && 'tabs--block', className)}>
    <div class="tabs__list" role="tablist" aria-label=${label} onKeyDown=${onKeyDown}>
      ${tabs.map(
        t =>
          html`<button
            key=${t.id}
            ref=${el => (refs.current[t.id] = el)}
            type="button"
            role="tab"
            id=${`${prefix}-tab-${t.id}`}
            class=${cx('tabs__tab', t.id === active && 'is-active')}
            aria-selected=${String(t.id === active)}
            aria-controls=${`${prefix}-panel`}
            tabindex=${t.id === active ? 0 : -1}
            onClick=${() => onChange?.(t.id)}
          >
            ${t.icon && html`<${Icon} name=${t.icon} size=${16} />`}<span>${t.label}</span>${
              t.badge != null && html`<span class="tabs__badge">${t.badge}</span>`
            }
          </button>`,
      )}
    </div>
    <div
      class="tabs__panel"
      role="tabpanel"
      id=${`${prefix}-panel`}
      aria-labelledby=${`${prefix}-tab-${active}`}
      tabindex="0"
    >
      ${typeof children === 'function' ? children(active) : children}
    </div>
  </div>`;
}
