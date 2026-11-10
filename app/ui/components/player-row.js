/**
 * PlayerRow — dense row for pool lists (draft pool, squads, reports).
 *
 * Props:
 *   player       PlayerView (lib/player-view.js)
 *   fit          FitTag fit { state, label?, from?, to? } shown at the end of the row
 *   stats        number of summary stats to show when the row is wide enough, the position's
 *                key stats first (default 3;
 *                the row hides them below ~460 px of its own width, container query)
 *   meta         override the second line (default "Club · League")
 *   selected     volt edge + aria-pressed;  disabled (dimmed, not clickable)
 *   hideRatings  hide OVR + stats
 *   rank         optional leading number (e.g. pool order)
 *   onClick      makes the row a <button>; otherwise a plain <div>
 *   trailing     node rendered after the fit tag (e.g. an IconButton) — only for non-button rows
 *
 * Put rows in <ul role="list" class="player-list"> … <li> for lists.
 */
import { html, cx } from '../lib/html.js';
import { resolveTier } from '../lib/tiers.js';
import { keyStatsFirst } from '../lib/player-view.js';
import { CaptainMark } from './captain-mark.js';
import { Flag } from './flag.js';
import { FitTag, fitText } from './fit-tag.js';

export function PlayerRow({
  player,
  fit,
  stats = 3,
  meta,
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
    selected && 'is-selected',
    disabled && 'is-disabled',
    onClick && 'prow--interactive',
    className,
  );
  const grid = html`<span class="prow__grid">
    ${rank != null && html`<span class="prow__rank num">${rank}</span>`}
    <${Flag} code=${p.nation?.code} name=${p.nation?.name} size=${30} decorative />
    <span class="prow__who">
      <span class="prow__name"
        >${p.name}${p.captain && html` <${CaptainMark} class="prow__captain" />`}</span
      >
      ${sub && html`<span class="prow__meta">${sub}</span>`}
    </span>
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
  </span>`;
  if (onClick) {
    const label = [
      p.fullName || p.name,
      p.position,
      hideRatings ? null : `${p.ovr} overall`,
      p.nation?.name,
      p.club?.name,
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
