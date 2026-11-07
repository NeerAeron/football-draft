// Team side of the draft board: the live meters (team OVR, Links, projection), the pitch with
// placed players and link lines, the DEF/MID/ATT line meters and, in Versus, both XIs.
import { html, cx } from '../../lib/html.js';
import { teamStyle } from '../../lib/color.js';
import { PitchView, Meter, Icon } from '../../components/index.js';
import { linkLines } from './draft-model.js';

const fmt = v => (v == null ? '–' : v.toFixed(1));

/** Pick progress: one pip per slot, filled as players arrive. */
export function Progress({ filled, total = 11, label }) {
  return html`<span
    class="progress-pips"
    role="img"
    aria-label=${label || `${filled} of ${total} picked`}
  >
    ${Array.from(
      { length: total },
      (_, i) =>
        html`<span key=${i} class=${cx('progress-pips__pip', i < filled && 'is-on')}></span>`,
    )}
  </span>`;
}

function Stat({ label, value, sub, tone, testid }) {
  return html`<div class=${cx('tstat', tone && `tstat--${tone}`)} data-testid=${testid}>
    <span class="tstat__label">${label}</span>
    <span class="tstat__value num">${value}</span>
    ${sub && html`<span class="tstat__sub">${sub}</span>`}
  </div>`;
}

/**
 * The meters strip: team OVR (with a preview delta), Links (n / 33) and the projection.
 * hideRatings hides OVR and the projection (they would reveal the ratings).
 */
export function TeamSummary({ team, projection, hideRatings, preview, compact = false, children }) {
  const delta =
    preview && team.rating != null && preview.rating != null
      ? Math.round((preview.rating - team.rating) * 10) / 10
      : null;
  const linkDelta = preview ? preview.links - team.links.score : null;
  return html`<section class=${cx('tsummary', compact && 'is-compact')} aria-label="Team meters">
    <${Stat}
      label="Team OVR"
      testid="team-ovr"
      value=${hideRatings ? '?' : fmt(team.rating)}
      sub=${!hideRatings && delta != null ? html`<span class=${cx('delta', delta >= 0 ? 'is-up' : 'is-down')}>${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}</span>` : null}
    />
    <${Stat}
      label="Links"
      testid="team-links"
      value=${html`${team.links.score}<small>/${team.links.maxScore}</small>`}
      tone="gold"
      sub=${linkDelta ? html`<span class="delta is-up">+${linkDelta}</span>` : null}
    />
    ${
      projection
        ? html`<${Stat}
            label=${projection.label}
            value=${hideRatings ? '?' : projection.value}
            tone="volt"
            testid="projection"
          />`
        : html`<${Stat} label="Projected" value="–" tone="volt" testid="projection" />`
    }
    ${children}
  </section>`;
}

/** DEF / MID / ATT line meters (hidden with ratings). */
export function LineMeters({ team, hideRatings }) {
  if (hideRatings) return null;
  const lines = [
    ['ATT', 'Attack'],
    ['MID', 'Midfield'],
    ['DEF', 'Defence'],
  ];
  return html`<div class="line-meters">
    ${lines.map(
      ([k, label]) =>
        html`<${Meter}
          key=${k}
          label=${label}
          value=${team.lines[k] ?? 0}
          min=${55}
          max=${95}
          tone=${team.lines[k] == null ? 'sky' : 'auto'}
          size="sm"
          valueText=${fmt(team.lines[k])}
        />`,
    )}
  </div>`;
}

/**
 * The XI on the pitch. players: PlayerView | null per slot (OVR = in-slot rating).
 * highlights/selected/onSelect light up slots while a player is being placed.
 */
export function TeamPitch({
  team,
  players,
  highlights,
  selected,
  onSelect,
  hideRatings,
  label,
  class: className,
}) {
  return html`<div class=${cx('team-pitch', highlights && 'is-placing', className)}>
    <${PitchView}
      formation=${team.formation}
      players=${players}
      highlights=${highlights || {}}
      links=${linkLines(team.links.pairs)}
      selected=${selected}
      onSelect=${onSelect}
      hideRatings=${hideRatings}
      label=${label || `${team.name} XI`}
      class="draft-pitch"
    />
  </div>`;
}

/** Versus: both drafters, the side to pick, and which XI is shown. */
export function VersusStrip({ teams, turn, shown, onShow, complete, hideRatings }) {
  return html`<div class="vstrip" role="group" aria-label="Drafters">
    ${teams.map(
      t =>
        html`<button
          key=${t.side}
          type="button"
          class=${cx('vstrip__side', t.side === turn && !complete && 'is-turn', t.side === shown && 'is-shown')}
          style=${teamStyle([t.color, t.secondary])}
          aria-pressed=${String(t.side === shown)}
          onClick=${() => onShow(t.side)}
        >
          <span class="vstrip__kit" aria-hidden="true"></span>
          <span class="vstrip__name">${t.name}</span>
          <span class="vstrip__meta">
            ${t.side === turn && !complete ? html`<b class="vstrip__turn"><${Icon} name="reel" size=${12} /> To pick</b>` : `${t.filled}/11`}
          </span>
          <span class="vstrip__ovr num">${hideRatings ? '?' : fmt(t.rating)}</span>
        </button>`,
    )}
  </div>`;
}
