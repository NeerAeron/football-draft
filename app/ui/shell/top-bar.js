// Top bar: back (off Home), brand, screen title (phones), help, sound, settings.
import { html, cx } from '../lib/html.js';
import { useStore } from '../lib/store.js';
import { back } from '../lib/router.js';
import { soundStore, toggleSound, getAudio } from '../lib/audio.js';
import { IconButton } from '../components/button.js';
import { Brand } from './brand.js';
import { openHowTo } from './how-to-play.js';

export function TopBar({ route }) {
  getAudio(); // create the audio service (installs the unlock listeners)
  const sound = useStore(soundStore);
  const home = route.path === '/';
  const settings = route.path === '/settings';
  return html`<header class=${cx('topbar', home && 'topbar--home')}>
    <div class="topbar__inner container">
      ${
        !home &&
        html`<${IconButton}
          icon="arrow-left"
          label="Back"
          class="topbar__back"
          onClick=${() => back(route.route?.back || '/')}
        />`
      }
      <${Brand} compact=${!home} />
      ${
        !home &&
        route.route?.title &&
        html`<span class="topbar__title" aria-hidden="true">${route.route.title}</span>`
      }
      <nav class="topbar__actions" aria-label="App">
        <${IconButton} icon="circle-question-mark" label="How to play" onClick=${openHowTo} />
        <${IconButton}
          icon=${sound.on ? 'volume-2' : 'volume-x'}
          label=${sound.available ? (sound.on ? 'Mute sound' : 'Turn sound on') : 'Sound unavailable'}
          pressed=${sound.on}
          disabled=${!sound.available}
          onClick=${toggleSound}
        />
        <${IconButton}
          icon="settings"
          label="Settings"
          href="#/settings"
          class=${cx(settings && 'is-current')}
          aria-current=${settings ? 'page' : undefined}
        />
      </nav>
    </div>
  </header>`;
}
