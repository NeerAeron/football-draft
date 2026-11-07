/**
 * Form controls (native inputs, styled).
 *
 * Switch — on/off setting row. <input type="checkbox" role="switch">.
 *   label (required), description, checked, onChange(bool), disabled, id
 *
 * Range — slider with a filled track and a value read-out.
 *   label (required), value, min (0), max (100), step (1), onInput(number), valueText
 *   (e.g. '45%'), disabled, id, hideLabel
 *
 * Field — label + control + hint wrapper for selects/text inputs.
 *   label, hint, id (of the control), children
 */
import { useMemo } from 'preact/hooks';
import { html, cx, nextId } from '../lib/html.js';

export function Switch({ label, description, checked, onChange, disabled, id, class: className }) {
  const inputId = useMemo(() => id || nextId('switch'), [id]);
  const descId = description ? `${inputId}-desc` : undefined;
  return html`<label class=${cx('switch-row', disabled && 'is-disabled', className)} for=${inputId}>
    <span class="switch-row__text">
      <span class="switch-row__label">${label}</span>
      ${description && html`<span class="switch-row__desc" id=${descId}>${description}</span>`}
    </span>
    <input
      id=${inputId}
      class="switch"
      type="checkbox"
      role="switch"
      checked=${!!checked}
      disabled=${disabled}
      aria-describedby=${descId}
      onChange=${e => onChange?.(e.currentTarget.checked)}
    />
  </label>`;
}

export function Range({
  label,
  value = 0,
  min = 0,
  max = 100,
  step = 1,
  onInput,
  valueText,
  disabled,
  id,
  hideLabel = false,
  class: className,
}) {
  const inputId = useMemo(() => id || nextId('range'), [id]);
  const fraction = (value - min) / (max - min || 1);
  return html`<div class=${cx('range', disabled && 'is-disabled', className)}>
    <div class=${cx('range__head', hideLabel && 'visually-hidden')}>
      <label class="range__label" for=${inputId}>${label}</label>
      <output class="range__value num" for=${inputId}>${valueText ?? value}</output>
    </div>
    <input
      id=${inputId}
      class="range__input"
      type="range"
      min=${min}
      max=${max}
      step=${step}
      value=${value}
      disabled=${disabled}
      style=${`--fraction:${fraction}`}
      aria-valuetext=${valueText}
      onInput=${e => onInput?.(Number(e.currentTarget.value))}
    />
  </div>`;
}

export function Field({ label, hint, id, class: className, children }) {
  return html`<div class=${cx('field', className)}>
    <label class="field__label" for=${id}>${label}</label>
    ${children} ${hint && html`<p class="field__hint">${hint}</p>`}
  </div>`;
}
