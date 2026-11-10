// "Coming next" stand-in for screens the next build phase replaces (#/play/:mode, #/draft,
// #/match, #/run, #/daily, #/exhibition) and the not-found page. Shows the route params so
// links from Home can be checked end to end.
import { html } from '../../lib/html.js';
import { Card } from '../../components/card.js';
import { EmptyState } from '../../components/empty-state.js';
import { Button } from '../../components/button.js';
import { Chip } from '../../components/chip.js';

const COPY = {
  '/play/:mode': ['sliders-horizontal', 'Match setup', 'Pick difficulty and options, then spin.'],
  '/draft': ['reel', 'Draft', 'Spin, pick and place your XI with live fit and links.'],
  '/match': ['ball', 'Match', 'Key moments, live xG, mentality calls and the post-match report.'],
  '/run': ['trophy', 'World Cup Run', 'Group, knockouts, medals and share card.'],
  '/daily': ['calendar-days', 'Daily Challenge', "Today's seeded spins, auto-simmed, streaks."],
  '/exhibition': ['tv', 'Exhibition', 'Any two real teams, straight to kick-off.'],
};

export default function Placeholder({ route, params = {}, query = {} }) {
  const known = COPY[route?.path];
  const [icon, title, text] = known || [
    'map-pin',
    'Page not found',
    'This address is not part of the game.',
  ];
  const entries = [...Object.entries(params), ...Object.entries(query)];
  return html`<div class="screen container-narrow placeholder" data-screen="placeholder">
    <${Card} variant="raised" padding="lg">
      <${EmptyState}
        icon=${icon}
        tone=${known ? 'volt' : 'coral'}
        size="lg"
        level=${1}
        title=${title}
        message=${known ? html`${text}<br />This screen is being built next.` : text}
        action=${html`<${Button} variant=${known ? 'secondary' : 'primary'} icon="house" href="#/"
          >Back to home<//
        >`}
      >
        ${
          entries.length > 0 &&
          html`<dl class="placeholder__params" aria-label="Route parameters">
            ${entries.map(
              ([k, v]) =>
                html`<div key=${k}>
                  <dt>${k}</dt>
                  <dd><${Chip} tone="volt">${v}<//></dd>
                </div>`,
            )}
          </dl>`
        }
        ${known && html`<p class="placeholder__route"><code>#${route.path}</code></p>`}
      <//>
    <//>
  </div>`;
}
