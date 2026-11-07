// Select-then-lock: the chosen player, where he fits (pitch highlights from
// placementOptions), the effect of the pick (team OVR, Links, who he links with) and the
// confirm button. Phones: inside a Sheet. Desktop: a dock under the pool (the big pitch on
// the left lights up instead).
import { html, cx } from '../../lib/html.js';
import { surname } from '../../lib/player-view.js';
import { PlayerCard, FitTag, Flag, Button, IconButton, Sheet } from '../../components/index.js';
import { TeamPitch } from './team-panel.js';

function Effects({ team, preview, hideRatings }) {
  if (!preview) return null;
  const delta = team.rating == null ? null : Math.round((preview.rating - team.rating) * 10) / 10;
  const linkGain = preview.links - team.links.score;
  const mates = preview.mates.slice(0, 3);
  return html`<ul class="pick-effects" role="list">
    ${
      !hideRatings &&
      html`<li class="pick-effects__item">
        <span class="pick-effects__label">Team OVR</span>
        <b class="num">${preview.rating.toFixed(1)}</b>
        ${
          delta != null &&
          html`<span class=${cx('delta', delta >= 0 ? 'is-up' : 'is-down')}
            >${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}</span
          >`
        }
      </li>`
    }
    <li class="pick-effects__item">
      <span class="pick-effects__label">Links</span>
      <b class="num">${preview.links}</b>
      ${linkGain > 0 && html`<span class="delta is-up">+${linkGain}</span>`}
      ${
        mates.length > 0 &&
        html`<span class="pick-effects__mates">
          ${'with '}${mates.map((m, i) => html`${i ? ', ' : ''}${m.name} <small>(${m.kind})</small>`)}${
            preview.mates.length > mates.length ? ` +${preview.mates.length - mates.length}` : ''
          }
        </span>`
      }
    </li>
  </ul>`;
}

function targetFit(highlights, target) {
  const fit = target != null ? highlights[target] : null;
  return fit && fit.state !== 'blocked' ? fit : null;
}

function confirmLabel(view, option) {
  return option ? `Draft ${surname(view.name)} · ${option.role}` : `Draft ${surname(view.name)}`;
}

/** Phones: bottom sheet with the PlayerCard, the pitch to choose a slot, and "Draft him". */
export function PickSheet({
  open,
  onClose,
  entry,
  view,
  team,
  teamPlayers,
  highlights,
  options,
  auto,
  target,
  onTarget,
  onConfirm,
  preview,
  hideRatings,
  eyebrow,
}) {
  if (!entry) return null;
  const option = target != null ? options[target] : null;
  const fit = targetFit(highlights, target);
  return html`<${Sheet}
    open=${open}
    onClose=${onClose}
    eyebrow=${eyebrow}
    title=${view.name}
    size="md"
    class="pick-sheet"
    footer=${html`
      <${Button}
        variant="ghost"
        icon="wand-sparkles"
        onClick=${() => auto && onTarget(auto.slot)}
        disabled=${!auto || target === auto.slot}
        data-testid="auto-slot"
        >Auto<//
      >
      <${Button}
        variant="primary"
        icon="check"
        class="pick-sheet__confirm"
        onClick=${onConfirm}
        disabled=${!option?.allowed}
        data-testid="confirm-pick"
        >${confirmLabel(view, option)}<//
      >
    `}
  >
    <div class="pick">
      <div class="pick__who">
        <${PlayerCard} player=${view} size="s" hideRatings=${hideRatings} showBadges=${false} />
        <div class="pick__info">
          <p class="pick__full">${view.fullName || view.name}</p>
          <p class="pick__pos">${(view.positions || [view.position]).join(' · ')}</p>
          ${
            (view.club || view.league) &&
            html`<p class="pick__club">
              ${[view.club?.name, view.league?.name].filter(Boolean).join(' · ')}
            </p>`
          }
          <p class="pick__slot">
            ${option ? html`At <b>${option.role}</b>` : 'Choose a slot'}
            ${fit && html`<${FitTag} fit=${fit} size="sm" hideRatings=${hideRatings} />`}
          </p>
          <${Effects} team=${team} preview=${preview} hideRatings=${hideRatings} />
        </div>
      </div>
      <p class="pick__hint">Tap a lit slot to play him there.</p>
      <${TeamPitch}
        team=${team}
        players=${teamPlayers}
        highlights=${highlights}
        selected=${target}
        onSelect=${onTarget}
        hideRatings=${hideRatings}
        label="Choose a slot"
        aspect="1 / 1.16"
        class="pick__pitch"
      />
    </div>
  <//>`;
}

/** Desktop: a dock with the selected player, his fit at the target slot and the confirm. */
export function PickDock({
  entry,
  view,
  team,
  highlights,
  options,
  auto,
  target,
  onTarget,
  onConfirm,
  onCancel,
  preview,
  hideRatings,
}) {
  if (!entry) return null;
  const option = target != null ? options[target] : null;
  const fit = targetFit(highlights, target);
  return html`<div class="dock" role="region" aria-label="Selected player">
    <${Flag} code=${view.nation?.code} name=${view.nation?.name} size=${36} decorative />
    <div class="dock__who">
      <span class="dock__name">${view.name}</span>
      <span class="dock__meta">
        ${option ? html`→ <b>${option.role}</b>` : 'Choose a slot'}
        ${fit && html`<${FitTag} fit=${fit} size="sm" hideRatings=${hideRatings} />`}
      </span>
    </div>
    <${Effects} team=${team} preview=${preview} hideRatings=${hideRatings} />
    <div class="dock__actions">
      <${Button}
        variant="ghost"
        size="sm"
        icon="wand-sparkles"
        onClick=${() => auto && onTarget(auto.slot)}
        disabled=${!auto || target === auto.slot}
        data-testid="auto-slot"
        >Auto<//
      >
      <${Button}
        variant="primary"
        icon="check"
        onClick=${onConfirm}
        disabled=${!option?.allowed}
        data-testid="confirm-pick"
        >${confirmLabel(view, option)}<//
      >
      <${IconButton} icon="x" label="Cancel selection" size="sm" onClick=${onCancel} />
    </div>
  </div>`;
}
