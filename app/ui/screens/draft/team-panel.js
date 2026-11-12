// Team side of the draft board: the live meters (team OVR, Boosts, projection), the Budget
// slots, the pitch with placed players, their boost chips and mates lines, the DEF/MID/ATT line meters and, in Versus, both XIs.
import { html, cx } from '../../lib/html.js';
import { teamStyle } from '../../lib/color.js';
import { PitchView, Meter, Icon, Flag, LeagueLogo, Crest } from '../../components/index.js';
import { linkLines } from './draft-model.js';
import { freeLabel } from '../../../core/draft/budget.js';
import { fmt1, signed1, boost as fmtBoost } from '../../lib/format.js';

const fmt = v => fmt1(v);

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
 * The meters strip: team OVR (with a preview delta), Boosts (the sum of the green chips on the
 * pitch) and the projection.
 * hideRatings hides OVR and the projection (they would reveal the ratings).
 */
export function TeamSummary({
  team,
  projection,
  hideRatings,
  preview,
  compact = false,
  showOvr = true,
  children,
}) {
  const delta =
    preview && team.rating != null && preview.rating != null
      ? Math.round((preview.rating - team.rating) * 10) / 10
      : null;
  const boostDelta = preview ? preview.gain : null;
  return html`<section
    class=${cx('tsummary', compact && 'is-compact', !showOvr && 'is-two')}
    aria-label="Team meters"
  >
    ${
      showOvr &&
      html`<${Stat}
        label="Team OVR"
        testid="team-ovr"
        value=${hideRatings ? '?' : fmt(team.rating)}
        sub=${
          !hideRatings && delta != null
            ? html`<span class=${cx('delta', delta >= 0 ? 'is-up' : 'is-down')}
                >${signed1(delta)}</span
              >`
            : null
        }
      />`
    }
    <${Stat}
      label="Boosts"
      testid="team-boosts"
      value=${fmtBoost(team.links.total)}
      tone="green"
      sub=${boostDelta > 0 ? html`<span class="delta is-up">${fmtBoost(boostDelta)}</span>` : null}
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

/**
 * Budget mode: the capped tiers as slots filling up ("Superstar ●", "Star ●○", "Starter
 * ●●○"). budget: team.budget ([{ id, label, range, slots, used, left }]); use: the tier id
 * the selected player would take (its next pip pulses).
 */
export function BudgetStrip({ budget, use = null, class: className }) {
  if (!budget) return null;
  return html`<div class=${cx('draft-budget', className)} role="group" aria-label="Budget">
    <span class="draft-budget__title">Budget</span>
    ${budget.map(
      b =>
        html`<span
          key=${b.id}
          class=${cx('draft-budget__band', `is-${b.id}`, b.left === 0 && 'is-full')}
          role="img"
          aria-label=${`${b.label} (rated ${b.range}): ${b.used} of ${b.slots} used`}
          title=${`${b.label}: rated ${b.range}`}
          data-band=${b.id}
        >
          <b class="num">${b.label}</b>
          <span class="draft-budget__pips">
            ${Array.from(
              { length: b.slots },
              (_, i) =>
                html`<i
                  key=${i}
                  class=${cx(i < b.used && 'is-on', use === b.id && i === b.used && 'is-next')}
                ></i>`,
            )}
          </span>
        </span>`,
    )}
    <span class="draft-budget__band is-free">${`${freeLabel(budget)} free`}</span>
  </div>`;
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
  aspect,
  names = true,
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
      aspect=${aspect}
      names=${names}
      class="draft-pitch"
    />
  </div>`;
}

/**
 * The side's picks so far, newest first: what the spin landed on → who was drafted, where.
 * entries: [{ key, round, category, from, media: { flag | logo | crest }, name, role, rating }]
 */
export function History({ entries, hideRatings }) {
  if (!entries.length) return null;
  return html`<section class="history" aria-labelledby="history-title">
    <h2 class="history__title" id="history-title">Your picks</h2>
    <ol class="history__list" role="list">
      ${entries.map(
        e =>
          html`<li key=${e.key} class="history__item">
            <span class="history__round num">${e.round}</span>
            <span class="history__media">
              ${
                e.media.flag
                  ? html`<${Flag} ...${e.media.flag} size=${22} decorative />`
                  : e.media.logo
                    ? html`<${LeagueLogo} ...${e.media.logo} size=${22} decorative />`
                    : html`<${Crest} ...${e.media.crest} size=${22} decorative />`
              }
            </span>
            <span class="history__from truncate">${e.from}</span>
            <${Icon} name="arrow-right" size=${14} class="history__arrow" />
            <span class="history__name truncate">${e.name}</span>
            <span class="history__role">${e.role}</span>
            <span class="history__ovr num">${hideRatings ? '' : e.rating}</span>
          </li>`,
      )}
    </ol>
  </section>`;
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
