/**
 * Modal — native <dialog> opened with showModal(): focus trap, Esc, inert background and
 * top-layer stacking come from the browser. Focus returns to the opener on close.
 *
 * Props:
 *   open        boolean (controlled);  onClose()  called on Esc, backdrop tap, the close button
 *   title       heading text (required — the dialog is aria-labelledby it)
 *   eyebrow     small label above the title;  description  text under the title (aria-describedby)
 *   variant     'modal' (centred) | 'sheet' (bottom sheet on phones, centred card ≥ 720 px)
 *   size        'sm' (400) | 'md' (520) | 'lg' (720)                          default 'md'
 *   dismissible false = no Esc/backdrop/close button (force a choice)        default true
 *   footer      node rendered in a sticky action bar (put Buttons here)
 *   children    body
 *
 * Sheet = <Modal variant="sheet">.
 */
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { html, cx, nextId } from '../lib/html.js';
import { IconButton } from './button.js';

export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  description,
  variant = 'modal',
  size = 'md',
  dismissible = true,
  footer,
  class: className,
  children,
}) {
  const ref = useRef(null);
  const opener = useRef(null);
  const ids = useMemo(() => {
    const id = nextId('dialog');
    return { title: `${id}-title`, desc: `${id}-desc` };
  }, []);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      dialog.showModal();
    } else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    const onNativeClose = () => {
      const target = opener.current;
      opener.current = null;
      if (target?.isConnected) target.focus({ preventScroll: true });
      if (open) closeRef.current?.();
    };
    const onCancel = e => {
      if (!dismissible) e.preventDefault();
    };
    dialog.addEventListener('close', onNativeClose);
    dialog.addEventListener('cancel', onCancel);
    return () => {
      dialog.removeEventListener('close', onNativeClose);
      dialog.removeEventListener('cancel', onCancel);
    };
  }, [open, dismissible]);

  // Close if unmounted while open (restores focus too)
  useEffect(
    () => () => {
      if (ref.current?.open) ref.current.close();
    },
    [],
  );

  const onBackdrop = e => {
    if (dismissible && e.target === ref.current) ref.current.close();
  };

  return html`<dialog
    ref=${ref}
    class=${cx('modal', `modal--${variant}`, `modal--${size}`, className)}
    aria-labelledby=${ids.title}
    aria-describedby=${description ? ids.desc : undefined}
    onClick=${onBackdrop}
  >
    ${
      open &&
      html`<div class="modal__panel">
        ${variant === 'sheet' && html`<span class="modal__grip" aria-hidden="true"></span>`}
        <header class="modal__header">
          <div class="modal__titles">
            ${eyebrow && html`<p class="eyebrow">${eyebrow}</p>`}
            <h2 class="modal__title" id=${ids.title}>${title}</h2>
            ${description && html`<p class="modal__description" id=${ids.desc}>${description}</p>`}
          </div>
          ${
            dismissible &&
            html`<${IconButton}
              icon="x"
              label="Close"
              class="modal__close"
              onClick=${() => ref.current?.close()}
            />`
          }
        </header>
        ${children != null && children !== false && html`<div class="modal__body">${children}</div>`}
        ${footer && html`<footer class="modal__footer">${footer}</footer>`}
      </div>`
    }
  </dialog>`;
}

export const Sheet = props => html`<${Modal} variant="sheet" ...${props} />`;
