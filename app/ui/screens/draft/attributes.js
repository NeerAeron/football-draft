// Every attribute of a player, grouped like the summary stats (Pace, Shooting, Passing, …), as
// a disclosure in the pick sheet (phones) and the pick dock (desktop). Hidden in Ball Knower.
import { html } from '../../lib/html.js';
import { ATTRS, RATING_GROUPS, categoryRating } from '../../../core/players/ratings.js';
import { StatBar, Icon } from '../../components/index.js';

/** Groups to show: keepers lead with goalkeeping; outfielders do not list it. */
export function attributeGroups(attrs, position) {
  if (!attrs) return [];
  const groups = RATING_GROUPS.filter(g => (position === 'GK') === (g.id === 'goalkeeping')).concat(
    position === 'GK' ? RATING_GROUPS.filter(g => g.id !== 'goalkeeping') : [],
  );
  return groups.map(g => ({
    id: g.id,
    label: g.label,
    value: categoryRating({ attrs }, g),
    items: Object.keys(g.weights).map(key => ({
      key,
      label: ATTRS[key] || key,
      value: Math.round(attrs[key] ?? 0),
    })),
  }));
}

export function AttributeDetails({ view, hideRatings, open = false }) {
  if (hideRatings || !view?.attrs) return null;
  const groups = attributeGroups(view.attrs, view.position);
  return html`<details class="attrs" open=${open} data-testid="player-attributes">
    <summary class="attrs__summary">
      <${Icon} name="chart-column" size=${16} />
      <span>All attributes</span>
      <${Icon} name="chevron-down" size=${16} class="attrs__chevron" />
    </summary>
    <div class="attrs__grid">
      ${groups.map(
        g =>
          html`<section class="attrs__group" key=${g.id} aria-label=${g.label}>
            <h4 class="attrs__head">
              <span>${g.label}</span>
              <b class="num">${g.value}</b>
            </h4>
            ${g.items.map(i => html`<${StatBar} key=${i.key} label=${i.label} value=${i.value} />`)}
          </section>`,
      )}
    </div>
  </details>`;
}
