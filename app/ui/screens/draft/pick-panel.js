// Select-then-lock: the chosen player's card (with his six stats), where he fits (pitch
// highlights from placementOptions: his overall in every open slot), the effect of the pick
// (team OVR, his mates boost, the Captain, a Prime boost on offer, Budget slot) and the confirm
// button. Everything a pool row says — and what it had no room for — is here. Phones: inside a Sheet. Desktop: a dock under the pool (the
// big pitch on the left lights up instead).
import { html, cx } from '../../lib/html.js';
import { surname } from '../../lib/player-view.js';
import { resolveTier } from '../../lib/tiers.js';
import {
  PlayerCard,
  FitTag,
  Button,
  IconButton,
  Sheet,
  CaptainMark,
  GoatMark,
} from '../../components/index.js';
import { TeamPitch } from './team-panel.js';
import { mateLines } from './draft-model.js';
import { fmt1, signed1, boost as fmtBoost } from '../../lib/format.js';

function Effects({ team, preview, hideRatings, prime }) {
  if (!preview) return null;
  const delta = team.rating == null ? null : Math.round((preview.rating - team.rating) * 10) / 10;
  const lines = mateLines(preview);
  const budget = preview.budget;
  return html`<ul class="pick-effects" role="list">
    ${
      !hideRatings &&
      html`<li class="pick-effects__item">
        <span class="pick-effects__label">Team OVR</span>
        <b class="num">${fmt1(preview.rating)}</b>
        ${
          delta != null &&
          html`<span class=${cx('delta', delta >= 0 ? 'is-up' : 'is-down')}
            >${signed1(delta)}</span
          >`
        }
      </li>`
    }
    <li class="pick-effects__item pick-effects__mates" data-testid="mates-effect">
      ${lines.map(
        (l, i) =>
          html`<span key=${i} class=${cx('pick-effects__mate', `is-${l.tone}`)}>${l.text}</span>`,
      )}
    </li>
    ${
      preview.goat &&
      html`<li class="pick-effects__item pick-effects__goat" data-testid="goat-effect">
        <${GoatMark} />
        <span><b class="delta is-up">${fmtBoost(preview.goat.boost)}</b> to every player</span>
      </li>`
    }
    ${
      preview.captain &&
      html`<li class="pick-effects__item pick-effects__captain" data-testid="captain-effect">
        <${CaptainMark} />
        <span>Captain: <b class="delta is-up">+${preview.captain.boost}</b> to every player</span>
      </li>`
    }
    ${
      prime &&
      !hideRatings &&
      html`<li class="pick-effects__item pick-effects__prime" data-testid="prime-effect">
        <span>Prime ${prime.era}</span>
        <b class="num">${prime.ovr}</b>
        ${prime.gain != null && html`<span class="delta is-up">+${prime.gain}</span>`}
      </li>`
    }
    ${
      budget &&
      html`<li class="pick-effects__item pick-effects__budget" data-testid="budget-effect">
        <span class="pick-effects__label">Budget</span>
        <span
          >${
            budget.free
              ? `free pick (${budget.label.toLowerCase()})`
              : `uses ${budget.slots === 1 ? 'your' : 'a'} ${budget.label} slot · ${
                  budget.left === 0 ? 'none left' : `${budget.left} left`
                }`
          }</span
        >
      </li>`
    }
  </ul>`;
}

// The card shows the six stats in the usual card order (rows lead with the position's own).
const CARD_ORDER = ['GK', 'PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY'];
const cardView = view => ({
  ...view,
  stats: [...(view.stats || [])].sort(
    (a, b) => CARD_ORDER.indexOf(a.key) - CARD_ORDER.indexOf(b.key),
  ),
});
/** The selected player's card: tier frame, rating, flag, kit and the six stats. */
function PickCard({ view, hideRatings }) {
  return html`<${PlayerCard}
    player=${cardView(view)}
    size="m"
    hideRatings=${hideRatings}
    showBadges=${false}
    class="pick-card"
    data-testid="pick-card"
  />`;
}

function targetFit(highlights, target) {
  const fit = target != null ? highlights[target] : null;
  return fit && fit.state !== 'blocked' ? fit : null;
}

/**
 * "At DM 79 ★ Best": the slot he is headed for, his overall there, and a tag only when it adds
 * something — Best, or the drop out of position ("82 → 79", which carries the number itself).
 */
function SlotLine({ option, fit, hideRatings, arrow }) {
  if (!option) return 'Choose a slot';
  const drop = fit?.state === 'penalty' && fit.to != null;
  return html`${arrow ? '→ ' : 'At '}<b>${option.role}</b>
    ${!hideRatings && !drop && html`<b class="num pick__rating">${option.rating}</b>`}
    ${
      fit &&
      (hideRatings || drop || fit.state === 'best') &&
      html`<${FitTag} fit=${fit} size="sm" hideRatings=${hideRatings} />`
    }`;
}

/** His tier by name and, in a World Cup draft, the year of that version: "Star · ’18". */
function Standing({ view, hideRatings }) {
  const tier = !hideRatings && resolveTier(view.tier, view.ovr);
  const year = view.era || '';
  if (!tier && !year) return null;
  return html`<span class="pick__standing" data-testid="pick-standing">
    ${tier && html`<span class=${`tier-text-${tier.id}`}>${tier.label}</span>`}
    ${tier && year && ' · '}${year && html`<span class="pick__year num">${year}</span>`}
  </span>`;
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
        <${PickCard} view=${view} hideRatings=${hideRatings} />
        <div class="pick__info">
          <p class="pick__full">${view.fullName || view.name}</p>
          <p class="pick__pos">
            <span>${(view.positions || [view.position]).join(' · ')}</span>
            <${Standing} view=${view} hideRatings=${hideRatings} />
          </p>
          ${
            (view.club || view.league) &&
            html`<p class="pick__club">
              ${[view.club?.name, view.league?.name].filter(Boolean).join(' · ')}
            </p>`
          }
          <p class="pick__slot" data-testid="pick-slot">
            <${SlotLine} option=${option} fit=${fit} hideRatings=${hideRatings} />
          </p>
          <${Effects}
            team=${team}
            preview=${preview}
            hideRatings=${hideRatings}
            prime=${view.primeLine}
          />
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
    <${PickCard} view=${view} hideRatings=${hideRatings} />
    <div class="dock__who">
      <span class="dock__name">${view.name}</span>
      <${Standing} view=${view} hideRatings=${hideRatings} />
      <span class="dock__meta" data-testid="pick-slot">
        <${SlotLine} option=${option} fit=${fit} hideRatings=${hideRatings} arrow />
      </span>
    </div>
    <${Effects}
      team=${team}
      preview=${preview}
      hideRatings=${hideRatings}
      prime=${view.primeLine}
    />
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
