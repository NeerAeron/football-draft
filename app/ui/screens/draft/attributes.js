// The six card stats of a player (Pace, Shooting, Passing, Dribbling, Defending, Physical; GK
// first for keepers) as bars, in a disclosure in the pick sheet (phones) and the pick dock
// (desktop). Hidden in Ball Knower.
import { html } from '../../lib/html.js';
import { StatBar, Icon } from '../../components/index.js';

const ORDER = ['GK', 'PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY'];
const NAME = {
  GK: 'Goalkeeping',
  PAC: 'Pace',
  SHO: 'Shooting',
  PAS: 'Passing',
  DRI: 'Dribbling',
  DEF: 'Defending',
  PHY: 'Physical',
};

export function AttributeDetails({ view, hideRatings, open = false }) {
  // Card order (rows may lead with the position's key stats).
  const stats = [...(view?.stats || [])].sort(
    (a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key),
  );
  if (hideRatings || !stats.length) return null;
  return html`<details class="attrs" open=${open} data-testid="player-attributes">
    <summary class="attrs__summary">
      <${Icon} name="chart-column" size=${16} />
      <span>Stats</span>
      <${Icon} name="chevron-down" size=${16} class="attrs__chevron" />
    </summary>
    <div class="attrs__grid">
      ${stats.map(s => html`<${StatBar} key=${s.key} label=${NAME[s.key] || s.label} value=${s.value} />`)}
    </div>
  </details>`;
}
