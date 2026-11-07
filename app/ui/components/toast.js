/**
 * Toasts — transient notifications. Mount <Toaster /> once (the app shell does); call the
 * functions from anywhere.
 *
 *   toast({ title, message?, tone?: 'info'|'success'|'warning'|'danger'|'neutral', icon?,
 *           duration?: ms (default 4000, 0 = sticky), action?: { label, onClick } }) → id
 *   achievement({ title, description, icon?: 'trophy', duration?: 6000 }) → id   (gold foil)
 *   dismissToast(id)
 *
 * Toasts pause while hovered/focused and are announced politely (aria-live).
 */
import { useEffect, useRef } from 'preact/hooks';
import { html, cx } from '../lib/html.js';
import { createStore, useStore } from '../lib/store.js';
import { Icon } from './icon.js';
import { IconButton } from './button.js';

export const toastStore = createStore([]);
let counter = 0;

const TONE_ICON = {
  info: 'info',
  success: 'circle-check',
  warning: 'triangle-alert',
  danger: 'circle-x',
  neutral: 'bell',
};

export function toast({ duration = 4000, tone = 'info', ...rest } = {}) {
  const id = ++counter;
  toastStore.set(list => [...list.slice(-3), { id, kind: 'toast', tone, duration, ...rest }]);
  return id;
}

export function achievement({ duration = 6000, icon = 'trophy', ...rest } = {}) {
  const id = ++counter;
  toastStore.set(list => [...list.slice(-3), { id, kind: 'achievement', icon, duration, ...rest }]);
  return id;
}

export function dismissToast(id) {
  toastStore.set(list => list.filter(t => t.id !== id));
}

function ToastItem({ item }) {
  const timer = useRef(null);
  const remaining = useRef(item.duration);
  const started = useRef(0);
  const start = () => {
    if (!remaining.current) return;
    started.current = performance.now();
    timer.current = setTimeout(() => dismissToast(item.id), remaining.current);
  };
  const pause = () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    remaining.current = Math.max(800, remaining.current - (performance.now() - started.current));
  };
  useEffect(() => {
    start();
    return pause;
  }, []);
  const achievementKind = item.kind === 'achievement';
  return html`<div
    class=${cx('toast', achievementKind ? 'toast--achievement' : `toast--${item.tone}`)}
    role=${item.tone === 'danger' ? 'alert' : 'status'}
    onMouseEnter=${pause}
    onMouseLeave=${start}
    onFocusIn=${pause}
    onFocusOut=${start}
  >
    <span class="toast__icon" aria-hidden="true"
      ><${Icon}
        name=${item.icon || TONE_ICON[item.tone] || 'info'}
        size=${achievementKind ? 22 : 18}
    /></span>
    <div class="toast__text">
      ${achievementKind && html`<p class="toast__eyebrow">Achievement unlocked</p>`}
      <p class="toast__title">${item.title}</p>
      ${
        (item.message || item.description) &&
        html`<p class="toast__message">${item.message || item.description}</p>`
      }
      ${
        item.action &&
        html`<button
          type="button"
          class="toast__action"
          onClick=${() => {
            item.action.onClick?.();
            dismissToast(item.id);
          }}
        >
          ${item.action.label}
        </button>`
      }
    </div>
    <${IconButton}
      icon="x"
      size="sm"
      label="Dismiss"
      class="toast__close"
      onClick=${() => dismissToast(item.id)}
    />
  </div>`;
}

export function Toaster() {
  const items = useStore(toastStore);
  return html`<section class="toaster" aria-label="Notifications" aria-live="polite">
    ${items.map(item => html`<${ToastItem} key=${item.id} item=${item} />`)}
  </section>`;
}
