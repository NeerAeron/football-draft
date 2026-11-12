/**
 * PlayerRow — dense row for pool lists (draft pool, squads, reports).
 *
 * Props:
 *   player       PlayerView (lib/player-view.js)
 *   fit          FitTag fit { state, label?, from?, to? } shown at the end of the row
 *   stats        number of summary stats to show when the row is wide enough, the position's
 *                key stats first (default 3;
 *                the row hides them below ~460 px of its own width, container query)
 *   meta         override the club text of the second line (default "Club · League")
 *   cost         { label, tone? } a small tag on the second line: what the player costs
 *                (Budget mode: 'Star' with tone 'superstar' | 'star' | 'starter', or 'Free')
 *   boost        { label, text } the mates boost he would get, green, on the second line
 *                ('+1.5' 'nation mate')
 *
 * A Captain's name carries the "C", an era card's the year of that version ("’18"); `player.primeNote`
 * ("Prime 94 +8": the Prime is available, and what it adds) is a gold tag on the second
 * line. The second line spans the whole row under the name: cost, boost and Prime are never
 * cut (they wrap when the row is narrow); the club text takes what is left.
 * A Superstar's or a Star's row has a thin outline in the tier's colour (not with hideRatings).
 *   selected     volt edge + aria-pressed;  disabled (dimmed, not clickable)
 *   hideRatings  hide OVR + stats
 *   rank         optional leading number (e.g. pool order)
 *   onClick      makes the row a <button>; otherwise a plain <div>
 *   trailing     node rendered after the fit tag (e.g. an IconButton) — only for non-button rows
 *
 * Put rows in <ul role="list" class="player-list"> … <li> for lists.
 */
import { html, cx } from '../lib/html.js';
import { resolveTier, isTopTier } from '../lib/tiers.js';
import { keyStatsFirst } from '../lib/player-view.js';
import { Flag } from './flag.js';
import { FitTag, fitText } from './fit-tag.js';
import { CaptainMark } from './captain-mark.js';

export function PlayerRow({
  player,
  fit,
  stats = 3,
  meta,
  cost,
  boost,
  selected = false,
  disabled = false,
  hideRatings = false,
  rank,
  onClick,
  trailing,
  class: className,
  ...rest
}) {
  const p = player || {};
  const t = resolveTier(p.tier, p.ovr);
  const sub = meta ?? [p.club?.name, p.league?.name].filter(Boolean).join(' · ');
  // The stats that matter for the player's position (lib/player-view.js KEY_STATS).
  const shown = hideRatings ? [] : keyStatsFirst(p.stats, p.position).slice(0, stats);
  const classes = cx(
    'prow',
    !hideRatings && isTopTier(t) && `prow--tier-${t.id}`,
    selected && 'is-selected',
    disabled && 'is-disabled',
    onClick && 'prow--interactive',
    className,
  );
  // Two lines. The first: flag, name, position, rating, stats, fit. The second spans the row
  // under the name: the tags (cost, boost, Prime) are never cut — they wrap — and the club
  // line takes what is left, shortened with an ellipsis.
  const prime = !hideRatings && p.primeNote;
  const grid = html`<span class="prow__grid">
    ${rank != null && html`<span class="prow__rank num">${rank}</span>`}
    <span class="prow__flag"
      ><${Flag} code=${p.nation?.code} name=${p.nation?.name} size=${30} decorative
    /></span>
    <span class="prow__name"
      >${p.name}${p.era && html` <span class="prow__era num">${p.era}</span>`}${
        p.captain && html` <${CaptainMark} class="prow__captain" />`
      }</span
    >
    <span class="prow__pos">${p.position}</span>
    <span class=${cx('prow__ovr num', !hideRatings && `tier-text-${t.id}`)}
      >${hideRatings ? '?' : p.ovr}</span
    >
    ${
      shown.length > 0 &&
      html`<span class="prow__stats">
        ${shown.map(
          s =>
            html`<span class="prow__stat" key=${s.key}
              ><b class="num">${s.value}</b><i>${s.key}</i></span
            >`,
        )}
      </span>`
    }
    <span class="prow__fit"
      >${fit && html`<${FitTag} fit=${fit} hideRatings=${hideRatings} />`}</span
    >
    ${
      (sub || cost || boost || prime) &&
      html`<span class="prow__meta"
        >${
          cost &&
          html`<b class=${cx('prow__cost num', cost.tone && `prow__cost--${cost.tone}`)}
            >${cost.label}</b
          >`
        }${
          boost &&
          html`<span class="prow__boost"
            ><b class="num">${boost.label}</b>${` ${boost.text}`}</span
          >`
        }${prime && html`<span class="prow__prime num">${prime}</span>`}${
          sub && html`<span class="prow__sub">${sub}</span>`
        }</span
      >`
    }
  </span>`;
  if (onClick) {
    const label = [
      p.fullName || p.name,
      p.position,
      hideRatings ? null : `${p.ovr} overall`,
      p.nation?.name,
      p.club?.name,
      p.captain && 'captain',
      p.era && `${p.era} version`,
      cost && (cost.text || cost.label),
      boost && `${boost.label} ${boost.text}`,
      prime,
      fitText(fit, hideRatings),
    ]
      .filter(Boolean)
      .join(', ');
    return html`<button
      type="button"
      class=${classes}
      onClick=${onClick}
      disabled=${disabled}
      aria-pressed=${String(!!selected)}
      aria-label=${label}
      ...${rest}
    >
      ${grid}
    </button>`;
  }
  return html`<div class=${classes} ...${rest}>${grid}${trailing}</div>`;
}
