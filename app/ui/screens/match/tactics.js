// Mentality buttons (Auto / Hold / Balanced / Push) and the tactics sheet. Edits go through
// the controller, which applies them with Match.setTactic and respects tacticAccess
// (coach.js). 'auto' is the default: the engine reads the game (pushes when behind late, holds
// a late lead); the control marks the mentality in effect, and picking one of the other three
// is a manual override until Auto is picked again.
import { useState } from 'preact/hooks';
import { html } from '../../lib/html.js';
import { Segmented, Sheet, Button } from '../../components/index.js';
import { FORMATIONS, formationLabel } from '../../../core/players/formations.js';
import { STYLES, TACTICS } from '../../../core/players/traits.js';
import { MENTALITIES } from '../../lib/prematch-store.js';

const MENTALITY_ICONS = {
  auto: 'wand-sparkles',
  hold: 'shield',
  balanced: 'circle-dot',
  push: 'trending-up',
};
/** Auto first, then the three manual choices from cautious to bold. */
export const MENTALITY_OPTIONS = ['auto', 'hold', 'balanced', 'push'].map(value => ({
  value,
  label: MENTALITIES.find(m => m.value === value)?.label ?? value,
  icon: MENTALITY_ICONS[value],
}));
const mentalityLabel = value => MENTALITY_OPTIONS.find(o => o.value === value)?.label;

/**
 * `value` is the side's choice ('auto' | 'hold' | 'balanced' | 'push'); `effective` the
 * mentality in effect (`match.mentality(team)`), marked on its segment while Auto is on.
 */
export function MentalityControl({
  team,
  name,
  value,
  effective,
  onChange,
  disabled,
  size = 'sm',
  block,
}) {
  const now = value === 'auto' && effective !== 'auto' ? mentalityLabel(effective) : null;
  return html`<${Segmented}
    class="mentality"
    label=${`${name} mentality${now ? ` (Auto: ${now} right now)` : ''}`}
    options=${MENTALITY_OPTIONS.map(o => ({
      ...o,
      disabled,
      label:
        now && o.value === effective
          ? html`<span class="mentality__now" title="In effect right now">${o.label}</span>`
          : o.label,
    }))}
    value=${value}
    onChange=${v => onChange(team, v)}
    size=${size}
    block=${block}
  />`;
}

const LEVELS = [1, 2, 3, 4, 5].map(v => ({ value: String(v), label: String(v) }));

function TeamTactics({ team, name, tactics, effective, access, onSet }) {
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
        effective=${effective}
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
      ${
        !access?.formation &&
        html`<span class="tactics__hint field__hint"
          >${access?.formationLocked ? 'Your draft formation is locked for the first match.' : 'Formation changes only at half-time.'}</span
        >`
      }
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
export function TacticsSheet({
  open,
  onClose,
  teams,
  tactics,
  effective = [],
  access,
  userSides,
  onSet,
}) {
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
      effective=${effective[team]}
      access=${access[team]}
      onSet=${onSet}
    />
  <//>`;
}
