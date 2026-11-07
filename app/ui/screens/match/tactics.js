// Mentality buttons (Push / Balanced / Hold) and the tactics sheet. Edits go through the
// controller, which applies them with Match.setTactic and respects tacticAccess (coach.js).
import { useState } from 'preact/hooks';
import { html } from '../../lib/html.js';
import { Segmented, Sheet, Button } from '../../components/index.js';
import { FORMATIONS, formationLabel } from '../../../core/players/formations.js';
import { STYLES, TACTICS } from '../../../core/players/traits.js';

export const MENTALITY_OPTIONS = [
  { value: 'hold', label: 'Hold', icon: 'shield' },
  { value: 'balanced', label: 'Balanced', icon: 'circle-dot' },
  { value: 'push', label: 'Push', icon: 'trending-up' },
];

export function MentalityControl({ team, name, value, onChange, disabled, size = 'sm', block }) {
  return html`<${Segmented}
    class="mentality"
    label=${`${name} mentality`}
    options=${MENTALITY_OPTIONS.map(o => ({ ...o, disabled }))}
    value=${value}
    onChange=${v => onChange(team, v)}
    size=${size}
    block=${block}
  />`;
}

const LEVELS = [1, 2, 3, 4, 5].map(v => ({ value: String(v), label: String(v) }));

function TeamTactics({ team, name, tactics, access, onSet }) {
  const locked = !access?.tactics;
  return html`<div class="tactics" data-testid=${`tactics-${team}`}>
    ${
      locked &&
      html`<p class="tactics__note">
        ${name}'s tactics can't be changed right
        now${access?.mentality ? ' — mentality still can' : ''}.
      </p>`
    }
    <div class="tactics__field field">
      <span class="tactics__label field__label" id=${`mentality-${team}`}>Mentality</span>
      <${MentalityControl}
        team=${team}
        name=${name}
        value=${tactics.mentality}
        onChange=${(t, v) => onSet(t, 'mentality', v)}
        disabled=${!access?.mentality}
        size="md"
        block
      />
    </div>
    <label class="tactics__field field">
      <span class="tactics__label field__label">Formation</span>
      <select
        class="tactics__select"
        value=${tactics.formation}
        disabled=${!access?.formation}
        onChange=${e => onSet(team, 'formation', e.currentTarget.value)}
      >
        ${Object.keys(FORMATIONS).map(f => html`<option value=${f}>${formationLabel(f)}</option>`)}
      </select>
      ${!access?.formation && html`<span class="tactics__hint field__hint">Formation changes only at half-time.</span>`}
    </label>
    <label class="tactics__field field">
      <span class="tactics__label field__label">Style</span>
      <select
        class="tactics__select"
        value=${tactics.style}
        disabled=${locked}
        onChange=${e => onSet(team, 'style', e.currentTarget.value)}
      >
        ${Object.entries(STYLES).map(([k, s]) => html`<option value=${k}>${s.label}</option>`)}
      </select>
      <span class="tactics__hint field__hint">${STYLES[tactics.style]?.description}</span>
    </label>
    ${['tempo', 'width', 'press'].map(
      key =>
        html`<div class="tactics__field field" key=${key}>
          <span class="tactics__label field__label"
            >${TACTICS[key].label}
            <span class="tactics__level">${TACTICS[key].levels[tactics[key] - 1]}</span></span
          >
          <${Segmented}
            label=${`${name} ${TACTICS[key].label}`}
            options=${LEVELS.map(o => ({ ...o, disabled: locked }))}
            value=${String(tactics[key])}
            onChange=${v => onSet(team, key, Number(v))}
            size="sm"
            block
          />
        </div>`,
    )}
  </div>`;
}

/** Bottom sheet with each user side's tactics (two tabs-like sections in Versus). */
export function TacticsSheet({ open, onClose, teams, tactics, access, userSides, onSet }) {
  const editable = userSides.length ? userSides : [0];
  const [side, setSide] = useState(editable[0]);
  const team = editable.includes(side) ? side : editable[0];
  return html`<${Sheet}
    open=${open}
    onClose=${onClose}
    title="Tactics"
    eyebrow=${teams[team]?.name}
    footer=${html`<${Button} variant="primary" block onClick=${onClose}>Done<//>`}
  >
    ${
      editable.length > 1 &&
      html`<${Segmented}
        label="Team"
        options=${editable.map(t => ({ value: String(t), label: teams[t]?.name }))}
        value=${String(team)}
        onChange=${v => setSide(Number(v))}
        block
      />`
    }
    <${TeamTactics}
      team=${team}
      name=${teams[team]?.name}
      tactics=${tactics[team]}
      access=${access[team]}
      onSet=${onSet}
    />
  <//>`;
}
