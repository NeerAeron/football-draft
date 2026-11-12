// Settings: sound, motion, gameplay defaults, local data, credits.
import { useEffect, useState } from 'preact/hooks';
import { html } from '../../lib/html.js';
import { useStore } from '../../lib/store.js';
import { prefs, setPref, reloadPrefs } from '../../lib/prefs.js';
import { soundStore, setSoundOn, setVolume, playCue, resetSound } from '../../lib/audio.js';
import { useReducedMotion } from '../../lib/motion.js';
import { ownKeys, clearOwnKeys } from '../../lib/storage.js';
import { Panel } from '../../components/card.js';
import { Button } from '../../components/button.js';
import { Segmented } from '../../components/segmented.js';
import { Switch, Range } from '../../components/form.js';
import { Modal } from '../../components/modal.js';
import { Icon } from '../../components/icon.js';
import { toast } from '../../components/toast.js';
import { openHowTo } from '../../shell/how-to-play.js';

const SECTIONS = [
  ['sound', 'Sound'],
  ['display', 'Motion'],
  ['gameplay', 'Gameplay'],
  ['data', 'Your data'],
  ['credits', 'Credits & licences'],
];

// Every key the app writes (CLAUDE.md lists them); keys that hold the same thing share a label
// and are listed once.
const KEY_LABELS = {
  'football-draft-sound': 'Sound settings',
  'football-draft-ui': 'Interface preferences',
  'football-draft-setup': 'Last game setup',
  'football-draft-draft': 'Draft in progress',
  'football-draft-prematch': 'Pre-match choices',
  'football-draft-match-view': 'Pre-match choices',
  'football-draft-match': 'Current match',
  'football-draft-match-camera': 'Match camera',
  'football-draft-run': 'Saved run',
  'football-draft-run-state': 'Saved run',
  'football-draft-daily': 'Daily streak and results',
  'football-draft-records': 'Trophy cabinet',
  'football-draft-exhibition': 'Last exhibition teams',
  'football-draft-dev': 'Developer test options',
};
const keyLabels = keys => [...new Set(keys.map(k => KEY_LABELS[k] || k))];

// Prose with links is built from arrays (not multi-line templates): htm drops whitespace at
// line breaks, which would glue words to the links once Prettier rewraps the template.
const a = (href, text) => html`<a href=${href} rel="noopener">${text}</a>`;

const CREDITS = [
  {
    title: 'Player data',
    body: [
      '"FC 26 (FIFA 26) player data" by rovnez on ',
      a('https://www.kaggle.com/datasets/rovnez/fc-26-fifa-26-player-data', 'Kaggle'),
      ', licensed ',
      a('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0'),
      '. Upstream data from SoFIFA / EA SPORTS FC. Ratings are converted by the catalog compiler, never invented.',
    ],
  },
  {
    title: 'Legends & prime versions',
    body: [
      'Past versions of players (FIFA 15–23, career mode) from the ',
      a('https://huggingface.co/datasets/jsulz/FIFA23', 'FIFA23 dataset'),
      ' by jsulz on Hugging Face, MIT licence. Upstream data from SoFIFA / EA SPORTS FIFA; compiled like the current players.',
    ],
  },
  {
    title: 'Club & league strength',
    body: [
      'A September 2026 snapshot of the ',
      a('https://dataviz.theanalyst.com/opta-power-rankings/', 'Opta Power Rankings'),
      '.',
    ],
  },
  {
    title: 'League logos',
    body: [
      'Provided via ',
      a('https://www.thesportsdb.com/', 'TheSportsDB'),
      ' and the Brack.Alltron official media kit. League names and logos belong to their respective owners.',
    ],
  },
  {
    title: 'Research baselines',
    body: [
      a('https://github.com/hudl/open-data', 'StatsBomb Open Data'),
      ' (2022 World Cup and Euro 2024), summarised for calibration; no raw event data is bundled.',
    ],
  },
  {
    title: 'Flags',
    body: [
      a('https://github.com/lipis/flag-icons', 'flag-icons'),
      ' by Panayiotis Lipiridis, MIT licence.',
    ],
  },
  {
    title: 'Fonts',
    body: [
      'Barlow Condensed (The Barlow Project Authors) and Inter (The Inter Project Authors), both under the ',
      a('./assets/fonts/OFL-inter.txt', 'SIL Open Font License 1.1'),
      '.',
    ],
  },
  {
    title: 'Code libraries',
    body: [
      a('https://preactjs.com/', 'Preact'),
      ' (MIT), ',
      a('https://github.com/developit/htm', 'htm'),
      ' (Apache 2.0) and ',
      a('https://lucide.dev/', 'Lucide'),
      ' icons (ISC).',
    ],
  },
];

function SoundPanel() {
  const sound = useStore(soundStore);
  return html`<${Panel} id="sound" title="Sound" description="Crowd, whistles and pick fanfares.">
    <div class="settings__rows">
      <${Switch}
        label="Sound effects"
        description=${sound.available ? null : 'Audio is not available in this browser.'}
        checked=${sound.on}
        disabled=${!sound.available}
        onChange=${setSoundOn}
      />
      <${Range}
        label="Volume"
        value=${Math.round(sound.volume * 100)}
        valueText=${`${Math.round(sound.volume * 100)}%`}
        disabled=${!sound.available}
        onInput=${v => setVolume(v / 100)}
      />
      <div>
        <${Button}
          size="sm"
          icon="volume-2"
          disabled=${!sound.on}
          onClick=${() => playCue('pick-star')}
          >Test sound<//
        >
      </div>
    </div>
  <//>`;
}

function MotionPanel() {
  const motion = useStore(prefs, p => p.motion);
  const reduced = useReducedMotion();
  return html`<${Panel}
    id="display"
    title="Motion"
    description="Reels, confetti, transitions and card shimmer."
  >
    <${Segmented}
      label="Motion"
      block
      value=${motion}
      onChange=${v => setPref('motion', v)}
      options=${[
        { value: 'system', label: 'System' },
        { value: 'reduce', label: 'Reduced' },
        { value: 'full', label: 'Full' },
      ]}
    />
    <p class="settings__note">
      ${
        reduced
          ? 'Reduced: reels land instantly, no confetti or shimmer.'
          : 'Full: reels spin, goals celebrate, foil cards shimmer.'
      }
      ${motion === 'system' && ' Following your device setting.'}
    </p>
  <//>`;
}

function GameplayPanel() {
  const hide = useStore(prefs, p => p.hideRatings);
  return html`<${Panel} id="gameplay" title="Gameplay">
    <div class="settings__rows">
      <${Switch}
        label="Hide ratings by default"
        description="Ball Knower mode: no OVRs or stats while you draft. Your share card says so."
        checked=${hide}
        onChange=${v => setPref('hideRatings', v)}
      />
      <div class="settings__inline">
        <${Button} size="sm" icon="circle-question-mark" onClick=${openHowTo}>How to play<//>
        <${Button} size="sm" variant="ghost" onClick=${() => setPref('onboarded', false)}
          >Show tips on Home again<//
        >
      </div>
    </div>
  <//>`;
}

function DataPanel() {
  const [keys, setKeys] = useState(ownKeys);
  const [confirm, setConfirm] = useState(false);
  const reset = () => {
    clearOwnKeys();
    reloadPrefs();
    resetSound();
    setKeys(ownKeys());
    setConfirm(false);
    toast({
      title: 'Local data cleared',
      message: 'Settings are back to their defaults.',
      tone: 'success',
    });
  };
  return html`<${Panel}
    id="data"
    title="Your data"
    description="Everything is stored in this browser only. Nothing is uploaded."
  >
    <ul class="settings__keys" role="list">
      ${
        keys.length
          ? keyLabels(keys).map(
              label => html`<li key=${label}><${Icon} name="check" size=${14} />${label}</li>`,
            )
          : html`<li class="settings__empty">Nothing saved yet.</li>`
      }
    </ul>
    <${Button} variant="danger" icon="trash" onClick=${() => setConfirm(true)}>Reset local data<//>
    <${Modal}
      open=${confirm}
      onClose=${() => setConfirm(false)}
      size="sm"
      title="Reset local data?"
      description="This clears your sound and display settings, saved run, trophy cabinet and daily streak on this device. It cannot be undone."
      footer=${html`<${Button} variant="ghost" onClick=${() => setConfirm(false)}>Cancel<//>
        <${Button} variant="danger" icon="trash" onClick=${reset} data-testid="confirm-reset"
          >Reset<//
        >`}
    />
  <//>`;
}

function CreditsPanel() {
  return html`<${Panel} id="credits" title="Credits & licences">
    <dl class="credits">
      ${CREDITS.map(
        c =>
          html`<div class="credits__item" key=${c.title}>
            <dt>${c.title}</dt>
            <dd>${c.body}</dd>
          </div>`,
      )}
    </dl>
    <p class="settings__note">
      EA SPORTS FC, club, league and competition names are trademarks of their respective owners.
      World Cup Draft is an unofficial fan project.
    </p>
  <//>`;
}

export default function Settings({ query = {} }) {
  useEffect(() => {
    if (query.section) document.getElementById(query.section)?.scrollIntoView({ block: 'start' });
  }, [query.section]);
  return html`<div class="screen settings" data-screen="settings">
    <div class="container settings__layout">
      <aside class="settings__aside">
        <h1 class="settings__title sr-only-mobile">Settings</h1>
        <nav class="settings__nav" aria-label="Settings sections">
          ${SECTIONS.map(([id, label]) => html`<a key=${id} href=${`#/settings?section=${id}`}>${label}</a>`)}
        </nav>
      </aside>
      <div class="settings__panels">
        <${SoundPanel} />
        <${MotionPanel} />
        <${GameplayPanel} />
        <${DataPanel} />
        <${CreditsPanel} />
      </div>
    </div>
  </div>`;
}
