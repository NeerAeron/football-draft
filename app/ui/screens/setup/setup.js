// Setup (#/play/:mode, mode = run | quick | versus): draft type, difficulty (what it means:
// opponents and re-rolls), formation, options; Versus names + kits. Everything is preselected
// (query → last choices → prefs), so one tap starts the draft — and startDraft() makes the
// first spin, so Home → Start → the reel is already spinning.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { html, cx } from '../../lib/html.js';
import { navigate } from '../../lib/router.js';
import { prefs, setPref } from '../../lib/prefs.js';
import { readJSON, writeJSON } from '../../lib/storage.js';
import { preloadRoutes } from '../../lib/screen-loader.js';
import { loadWarmCatalog } from '../../lib/catalog-warm.js';
import { ladderPreview } from '../../../core/draft/opponents.js';
import { projectRun } from '../../../core/competition/cup.js';
import { MODE_BASELINES } from '../../../core/draft/opponents.js';
import { formationLabel } from '../../../core/players/formations.js';
import {
  startDraft,
  readSavedDraft,
  draftMode,
  modeLabel,
  difficultyLabel,
  KIT_COLORS,
} from '../../lib/draft-store.js';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Icon,
  Segmented,
  Switch,
  toast,
} from '../../components/index.js';
import { FormationMini } from './formation-mini.js';
import { useMedia } from '../draft/use-media.js';
import {
  SETUP_KEY,
  SETUP_MODES,
  TYPE_INFO,
  MAIN_FORMATIONS,
  ALL_FORMATIONS,
  VERSUS_REROLLS,
  difficultyLevels,
  setupDefaults,
  savedChoices,
  setupContext,
  spinsNations,
  typicalOvr,
} from './setup-model.js';

const idle = fn => (globalThis.requestIdleCallback || (f => setTimeout(f, 60)))(fn);

function ChoiceGroup({ legend, hint, children, class: className }) {
  return html`<fieldset class=${cx('setup-group', className)}>
    <legend class="setup-group__legend">${legend}</legend>
    ${hint && html`<p class="setup-group__hint">${hint}</p>`} ${children}
  </fieldset>`;
}

function TypePicker({ value, onChange }) {
  return html`<${ChoiceGroup} legend="Draft from">
    <div class="type-grid">
      ${TYPE_INFO.map(
        t =>
          html`<label
            key=${t.value}
            class=${cx('choice type-card', value === t.value && 'is-selected')}
          >
            <input
              class="choice__input"
              type="radio"
              name="setup-type"
              value=${t.value}
              checked=${value === t.value}
              onChange=${() => onChange(t.value)}
            />
            <span class="type-card__head">
              <span class="type-card__icon" aria-hidden="true"
                ><${Icon} name=${t.icon} size=${18}
              /></span>
              <span class="type-card__title">${t.label}</span>
              ${value === t.value && html`<${Icon} name="circle-check" size=${18} class="choice__tick" />`}
            </span>
            <span class="type-card__text">${t.text}</span>
            <span class="type-card__meta"
              >Typical XI <b class="num">${typicalOvr(t.value)}</b></span
            >
          </label>`,
      )}
    </div>
  <//>`;
}

function Pips({ count, max = 2, label }) {
  return html`<span class="pips" role="img" aria-label=${label}>
    ${Array.from(
      { length: max },
      (_, i) => html`<span key=${i} class=${cx('pips__pip', i < count && 'is-on')}></span>`,
    )}
  </span>`;
}

function DifficultyPicker({ mode, type, value, onChange, levels, preview, catalogReady }) {
  const rerollText = n => (n === 0 ? 'No re-rolls' : n === 1 ? '1 re-roll' : `${n} re-rolls`);
  const selected = levels.find(l => l.id === value) || levels[2];
  const examples = preview?.find(p => p.id === value)?.examples || [];
  const typical = useMemo(() => {
    if (mode !== 'run') return null;
    const base = MODE_BASELINES[draftMode(type)];
    const rating = base.effective[Math.min(2, selected.rerolls)];
    return projectRun({ rating, mode: draftMode(type), difficulty: value }).label.replace(
      'Projected: ',
      '',
    );
  }, [mode, type, value, selected.rerolls]);
  return html`<${ChoiceGroup}
    legend="Difficulty"
    hint="Sets how strong your opponents are and how many re-rolls you get."
  >
    <div class="ladder">
      ${levels.map(
        l =>
          html`<label
            key=${l.id}
            class=${cx('choice ladder__row', value === l.id && 'is-selected')}
          >
            <input
              class="choice__input"
              type="radio"
              name="setup-difficulty"
              value=${l.id}
              checked=${value === l.id}
              onChange=${() => onChange(l.id)}
            />
            <span class="ladder__name">${l.label}</span>
            <span class="ladder__text">${l.text}</span>
            <${Pips} count=${l.rerolls} label=${rerollText(l.rerolls)} />
            <span class="ladder__target" title="Opponent strength (team rating + links)">
              <span class="visually-hidden">Opponents rated about</span>
              <b class="num">${l.target}</b>
            </span>
          </label>`,
      )}
    </div>
    <div class="ladder__detail" aria-live="polite">
      <p>
        <b>${selected.label}:</b>
        ${' '}${rerollText(selected.rerolls)} per draft · opponents rated about${' '}
        <b class="num">${selected.target}</b>${' '}(team rating + links).
      </p>
      ${
        examples.length > 0
          ? html`<p class="ladder__examples">
              ${'Teams like '}${examples
                .slice(0, 4)
                .map(e => e.name)
                .join(', ')}.
            </p>`
          : !catalogReady && html`<p class="ladder__examples is-muted">Loading opponents…</p>`
      }
      ${
        typical &&
        html`<p class="ladder__typical">
          <${Icon} name="trophy" size=${14} />
          <span>${'A typical draft reaches the '}<b>${typical}</b>${'.'}</span>
        </p>`
      }
    </div>
  <//>`;
}

function FormationPicker({ value, onChange }) {
  const [all, setAll] = useState(!MAIN_FORMATIONS.includes(value));
  const list = all ? ALL_FORMATIONS : MAIN_FORMATIONS;
  return html`<${ChoiceGroup} legend="Formation" hint="You can still change it before kick-off.">
    <div class="formation-grid">
      ${list.map(
        f =>
          html`<label key=${f} class=${cx('choice formation-card', value === f && 'is-selected')}>
            <input
              class="choice__input"
              type="radio"
              name="setup-formation"
              value=${f}
              checked=${value === f}
              onChange=${() => onChange(f)}
            />
            <${FormationMini} formation=${f} />
            <span class="formation-card__label">${formationLabel(f).split(' · ')[0]}</span>
            <span class="formation-card__variant">${formationLabel(f).split(' · ')[1] || ' '}</span>
          </label>`,
      )}
    </div>
    <${Button}
      variant="ghost"
      size="sm"
      iconEnd=${all ? 'chevron-up' : 'chevron-down'}
      onClick=${() => setAll(!all)}
      aria-expanded=${String(all)}
      class="formation-more"
      >${all ? 'Fewer formations' : `All ${ALL_FORMATIONS.length} formations`}<//
    >
  <//>`;
}

function KitPicker({ value, other, onChange, name }) {
  return html`<div class="kits" role="radiogroup" aria-label=${`${name} kit colour`}>
    ${KIT_COLORS.map(
      k =>
        html`<label
          key=${k.id}
          class=${cx('kit', value === k.id && 'is-selected', other === k.id && 'is-taken')}
          style=${`--kit:${k.colors[0]}`}
          title=${other === k.id ? `${k.name} (taken)` : k.name}
        >
          <input
            class="choice__input"
            type="radio"
            name=${`kit-${name}`}
            value=${k.id}
            checked=${value === k.id}
            disabled=${other === k.id}
            onChange=${() => onChange(k.id)}
          />
          <span class="visually-hidden">${k.name}</span>
        </label>`,
    )}
  </div>`;
}

function VersusPlayers({ state, update }) {
  const setName = (i, v) => update({ names: state.names.map((n, j) => (j === i ? v : n)) });
  const setKit = (i, v) => update({ kits: state.kits.map((k, j) => (j === i ? v : k)) });
  return html`<${ChoiceGroup} legend="Players">
    <div class="players">
      ${[0, 1].map(
        i =>
          html`<div
            key=${i}
            class="player-entry"
            style=${`--kit:${KIT_COLORS.find(k => k.id === state.kits[i]).colors[0]}`}
          >
            <label class="player-entry__label" for=${`player-${i}`}>Player ${i + 1}</label>
            <input
              id=${`player-${i}`}
              class="player-entry__input"
              type="text"
              maxlength="20"
              autocomplete="off"
              placeholder=${`Player ${i + 1}`}
              value=${state.names[i]}
              onInput=${e => setName(i, e.currentTarget.value)}
            />
            <${KitPicker}
              name=${`Player ${i + 1}`}
              value=${state.kits[i]}
              other=${state.kits[1 - i]}
              onChange=${v => setKit(i, v)}
            />
          </div>`,
      )}
    </div>
  <//>`;
}

function Summary({ mode, state, levels }) {
  const level = levels.find(l => l.id === state.difficulty);
  const rows = [
    ['Draft', modeLabel(state.type)],
    mode === 'versus'
      ? ['Re-rolls', `${level.rerolls} each`]
      : [
          'Difficulty',
          `${difficultyLabel(state.difficulty)} · ${level.rerolls} re-roll${level.rerolls === 1 ? '' : 's'}`,
        ],
    ['Formation', formationLabel(state.formation)],
    state.hideRatings && ['Ratings', 'Hidden (Ball Knower)'],
    spinsNations(state.type) && state.uniqueNations && ['Nations', 'One player each'],
  ].filter(Boolean);
  return html`<dl class="summary">
    ${rows.map(
      ([k, v]) =>
        html`<div key=${k} class="summary__row">
          <dt>${k}</dt>
          <dd>${v}</dd>
        </div>`,
    )}
  </dl>`;
}

export default function SetupScreen({ params = {}, query = {} }) {
  const mode = params.mode;
  useEffect(() => {
    if (mode === 'daily') navigate('/daily', { replace: true });
  }, [mode]);
  if (!SETUP_MODES[mode])
    return html`<div class="screen container-narrow" data-screen="setup">
      <${Card} variant="raised" padding="lg">
        <${EmptyState}
          icon="map-pin"
          tone="coral"
          level=${1}
          title="Unknown game mode"
          message="Pick a mode from the home screen."
          action=${html`<${Button} variant="primary" icon="house" href="#/">Home<//>`}
        />
      <//>
    </div>`;
  return html`<${Setup}
    key=${`${mode}?${new URLSearchParams(query)}`}
    mode=${mode}
    query=${query}
  />`;
}

function Setup({ mode, query }) {
  const copy = SETUP_MODES[mode];
  const [state, setState] = useState(() =>
    setupDefaults(mode, {
      query,
      saved: readJSON(SETUP_KEY, {})?.[mode] || {},
      prefs: prefs.get(),
    }),
  );
  const [busy, setBusy] = useState(false);
  const wide = useMedia();
  const [catalog, setCatalog] = useState(null);
  const [preview, setPreview] = useState(null);
  const saved = useMemo(() => {
    const s = readSavedDraft();
    const kind = s?.context?.kind;
    return s && !s.complete && (kind === mode || (mode === 'run' && kind === 'daily')) ? s : null;
  }, [mode]);
  const update = patch => setState(s => ({ ...s, ...patch }));
  const levels = useMemo(
    () => difficultyLevels(state.type, { useDefaultRules: state.seed != null }),
    [state.type, state.seed],
  );

  useEffect(() => {
    let live = true;
    loadWarmCatalog()
      .then(c => live && setCatalog(c))
      .catch(() => {});
    idle(() => preloadRoutes(['/draft']));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!catalog || mode === 'versus') return;
    let live = true;
    idle(() => {
      if (!live) return;
      try {
        setPreview(ladderPreview(catalog, draftMode(state.type)));
      } catch {
        setPreview([]);
      }
    });
    return () => {
      live = false;
    };
  }, [catalog, state.type, mode]);

  const setType = type => {
    update({ type });
    setPref('draftType', type);
  };

  const start = async () => {
    if (busy) return;
    setBusy(true);
    const all = readJSON(SETUP_KEY, {}) || {};
    writeJSON(SETUP_KEY, { ...all, [mode]: savedChoices(state) });
    try {
      await startDraft(setupContext(mode, state));
    } catch (error) {
      console.warn('[setup] could not start the draft', error);
      toast({
        title: 'Could not start the draft',
        message: String(error.message || error),
        tone: 'danger',
      });
      setBusy(false);
    }
  };

  const cta = html`<${Button}
    variant="primary"
    size="xl"
    block
    icon=${mode === 'versus' ? 'dices' : 'reel'}
    loading=${busy}
    onClick=${start}
    data-testid="start-draft"
    >${copy.cta}<//
  >`;

  return html`<div class="screen setup" data-screen="setup" data-mode=${mode}>
    <div class="container setup__layout">
      <header class="setup__head">
        <p class="eyebrow">${copy.eyebrow}</p>
        <h1 class="setup__title">${copy.title}</h1>
        <p class="setup__lead">${copy.lead}</p>
      </header>

      <div class="setup__main">
        ${
          saved &&
          html`<${Card}
            variant="volt"
            padding="sm"
            class="setup-resume"
            as="section"
            aria-label="Draft in progress"
          >
            <span class="setup-resume__icon" aria-hidden="true"
              ><${Icon} name="reel" size=${20}
            /></span>
            <span class="setup-resume__text">
              <b>Draft in progress</b>
              <span
                >${modeLabel(saved.context?.type)} · pick ${saved.picks + 1} of ${saved.total}</span
              >
            </span>
            <${Button} size="sm" variant="secondary" iconEnd="arrow-right" href="#/draft">Resume<//>
          <//>`
        }
        ${
          state.seed != null &&
          html`<${Card}
            variant="gold"
            padding="sm"
            class="setup-challenge"
            as="section"
            aria-label="Challenge"
          >
            <span class="setup-challenge__icon" aria-hidden="true"
              ><${Icon} name="swords" size=${20}
            /></span>
            <span class="setup-challenge__text">
              <b>Challenge seed</b>
              <span>Same spins as your friend, standard rules.</span>
            </span>
            <${Button} size="sm" variant="ghost" onClick=${() => update({ seed: null })}
              >Fresh seed<//
            >
          <//>`
        }
        ${mode === 'versus' && html`<${VersusPlayers} state=${state} update=${update} />`}
        <${TypePicker} value=${state.type} onChange=${setType} />
        ${
          mode === 'versus'
            ? html`<${ChoiceGroup}
                legend="Re-rolls"
                hint="Spin again instead of picking — per player, per draft."
              >
                <${Segmented}
                  label="Re-rolls per player"
                  options=${VERSUS_REROLLS}
                  value=${VERSUS_REROLLS.some(o => o.value === state.difficulty) ? state.difficulty : 'pro'}
                  onChange=${v => update({ difficulty: v })}
                  block
                />
              <//>`
            : html`<${DifficultyPicker}
                mode=${mode}
                type=${state.type}
                value=${state.difficulty}
                onChange=${v => update({ difficulty: v })}
                levels=${levels}
                preview=${preview}
                catalogReady=${!!catalog}
              />`
        }
        <${FormationPicker} value=${state.formation} onChange=${v => update({ formation: v })} />
        <${ChoiceGroup} legend="Options" class="setup-options">
          <${Switch}
            label="Hide ratings"
            description="Ball Knower: no numbers during the draft. Trust your football knowledge."
            checked=${state.hideRatings}
            onChange=${v => update({ hideRatings: v })}
          />
          ${
            spinsNations(state.type) &&
            html`<${Switch}
              label="One player per nation"
              description="Each nation can appear in your XI only once."
              checked=${state.uniqueNations}
              onChange=${v => update({ uniqueNations: v })}
            />`
          }
        <//>
      </div>

      ${
        wide &&
        html`<aside class="setup__side" aria-label="Summary">
          <${Card} variant="raised" padding="md" class="setup-summary">
            <p class="eyebrow">Ready</p>
            <h2 class="setup-summary__title">${copy.title}</h2>
            <${Summary} mode=${mode} state=${state} levels=${levels} />
            ${state.seed != null && html`<${Chip} tone="gold" icon="swords" size="sm">Challenge seed<//>`}
            <div class="setup-summary__cta">${cta}</div>
            <p class="setup-summary__note">
              ${mode === 'versus' ? 'Then pass the device after every pick.' : 'The first spin starts right away.'}
            </p>
          <//>
        </aside>`
      }
      ${!wide && html`<div class="action-bar setup__bar">${cta}</div>`}
    </div>
  </div>`;
}
