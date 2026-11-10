// "How it works" — four short steps. Shown inline on Home for first-time players
// (dismissible) and as a sheet from the top bar's help button or Settings.
//   openHowTo() / closeHowTo();  <HowToSteps />;  <HowToPlaySheet /> (mounted by the shell)
import { html, cx } from '../lib/html.js';
import { createStore, useStore } from '../lib/store.js';
import { Icon } from '../components/icon.js';
import { FitTag } from '../components/fit-tag.js';
import { Sheet } from '../components/modal.js';
import { Button } from '../components/button.js';

export const howToStore = createStore({ open: false });
export const openHowTo = () => howToStore.set({ open: true });
export const closeHowTo = () => howToStore.set({ open: false });

export const HOW_TO_STEPS = [
  {
    icon: 'reel',
    title: 'Spin',
    text: 'One tap spins the reel. Where it lands is decided before it moves — no fake near-misses.',
  },
  {
    icon: 'pitch',
    title: 'Pick & place',
    text: 'Choose a player and the pitch lights up with the fit before you lock it in.',
    demo: true,
  },
  {
    icon: 'whistle',
    title: 'Play the run',
    text: 'Three group games, then five knockouts from the Round of 32. Watch key moments or sim straight to the result.',
  },
  {
    icon: 'trophy',
    title: 'Go 8–0',
    text: 'Win all eight for a perfect run. Earn a grade, share your XI, challenge a friend.',
  },
];

export function HowToSteps({ compact = false, class: className }) {
  return html`<ol class=${cx('howto', compact && 'howto--compact', className)} role="list">
    ${HOW_TO_STEPS.map(
      (step, i) =>
        html`<li class="howto__step" key=${step.title}>
          <span class="howto__icon" aria-hidden="true"
            ><${Icon} name=${step.icon} size=${22}
          /></span>
          <span class="howto__text">
            <span class="howto__step-no" aria-hidden="true">Step ${i + 1}</span>
            <strong class="howto__title">${step.title}</strong>
            <span class="howto__body">${step.text}</span>
            ${
              step.demo &&
              html`<span class="howto__demo" aria-hidden="true">
                <${FitTag} fit=${{ state: 'ok', label: 'LW' }} size="sm" />
                <${FitTag} fit=${{ state: 'penalty', from: 79, to: 75 }} size="sm" />
                <${FitTag} fit=${{ state: 'blocked' }} size="sm" />
              </span>`
            }
          </span>
        </li>`,
    )}
  </ol>`;
}

export function HowToPlaySheet() {
  const { open } = useStore(howToStore);
  return html`<${Sheet}
    open=${open}
    onClose=${closeHowTo}
    eyebrow="World Cup Draft"
    title="How it works"
    footer=${html`<${Button} variant="primary" size="lg" block onClick=${closeHowTo}>Got it<//>`}
  >
    <${HowToSteps} />
  <//>`;
}
