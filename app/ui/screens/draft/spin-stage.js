// Spin stage: the honest reel(s) while a spin animates, the reveal card once it lands, an
// idle "what the next spin draws" panel, and the odds dialog. The session has already
// decided the landing; reels only travel there (their own timing, never the draft RNG).
import { useEffect, useMemo, useState } from 'preact/hooks';
import { html, cx } from '../../lib/html.js';
import { playCue } from '../../lib/audio.js';
import {
  Reel,
  Flag,
  LeagueLogo,
  Crest,
  Chip,
  Icon,
  IconButton,
  Button,
  Modal,
} from '../../components/index.js';
import {
  CATEGORY_LABEL,
  CATEGORY_ICON,
  reelItems,
  spinHeadline,
  oddsSummary,
} from './draft-model.js';

const TIMING = {
  nation: [{ duration: 1300, cycles: 2 }],
  league: [{ duration: 1300, cycles: 2 }],
  club: [
    { duration: 800, cycles: 1 },
    { duration: 1150, cycles: 2 },
  ],
};

const IDLE_TEXT = {
  nation: 'Every nation in the field is equally likely.',
  league: 'Bigger leagues are likelier: tier A ×4, B ×2, C ×1, D ×½, F ×¼.',
  club: 'One spin lands a league, then a club. Stronger clubs come up more often.',
};

/**
 * Reel that starts away from the landing (the Reel idles on landIndex, which would show the
 * result for a frame): mount on a decoy item, then arm the spin on the next frame.
 */
function HonestReel({ items, landIndex, spinKey, ...rest }) {
  const [armed, setArmed] = useState(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => setArmed(spinKey));
    return () => cancelAnimationFrame(id);
  }, [spinKey]);
  const live = armed === spinKey;
  const decoy = (landIndex + Math.max(1, Math.floor(items.length / 2))) % items.length;
  return html`<${Reel}
    items=${items}
    landIndex=${live ? landIndex : decoy}
    spinKey=${live ? spinKey : null}
    ...${rest}
  />`;
}

function SpinningReels({ spin, spinKey, onLanded }) {
  const [leg, setLeg] = useState(0);
  const reels = spin.reels;
  const timing = TIMING[spin.category] || TIMING.nation;
  const legs = useMemo(
    () => reels.map((r, i) => reelItems(r, { league: i === 1 ? spin.league : null })),
    [spin],
  );
  useEffect(() => setLeg(0), [spinKey]);
  return html`<div class=${cx('stage-reels', reels.length > 1 && 'stage-reels--two')}>
    ${legs.map(
      (r, i) =>
        html`<div key=${i} class="stage-reels__reel">
          <span class="stage-reels__label">${CATEGORY_LABEL[reels[i].category]}</span>
          ${
            i > leg
              ? html`<div class="stage-reels__wait" aria-hidden="true">
                  <span>?</span>
                </div>`
              : html`<${HonestReel}
                  items=${r.items}
                  landIndex=${r.landIndex}
                  spinKey=${`${spinKey}:${i}`}
                  duration=${timing[i]?.duration || 1300}
                  cycles=${timing[i]?.cycles || 2}
                  size=${reels.length > 1 && i === 0 ? 'sm' : 'md'}
                  label=${`${CATEGORY_LABEL[reels[i].category]} reel`}
                  onTick=${() => playCue('tick')}
                  onLand=${() => {
                    if (i < legs.length - 1) setLeg(i + 1);
                    else onLanded();
                  }}
                />`
          }
        </div>`,
    )}
    <p class="stage-reels__hint" aria-hidden="true">Tap the reel to skip</p>
  </div>`;
}

function Media({ head, size = 64 }) {
  if (head.flag) return html`<${Flag} ...${head.flag} size=${size} decorative />`;
  if (head.logo) return html`<${LeagueLogo} ...${head.logo} size=${size} decorative />`;
  return html`<${Crest} ...${head.crest} size=${size} shape="shield" decorative />`;
}

function RevealCard({ spin, poolSize, onOdds, fresh, compact }) {
  const head = spinHeadline(spin, poolSize);
  return html`<div
    class=${cx('reveal', head.big && 'is-big', fresh && 'is-fresh')}
    data-testid="spin-result"
  >
    <span class="reveal__media"><${Media} head=${head} size=${compact ? 52 : 64} /></span>
    <span class="reveal__text">
      <span class="reveal__cat">
        ${CATEGORY_LABEL[spin.category]}${spin.reroll ? ` · re-roll ${spin.reroll}` : ''}
      </span>
      <span class="reveal__title">${head.title}</span>
      <span class="reveal__meta">
        ${head.league && html`<${LeagueLogo} ...${head.league} size=${16} decorative />`}
        <span>${head.meta}</span>
      </span>
    </span>
    ${head.badge && html`<${Chip} tone="gold" variant="solid" size="sm" class="reveal__badge">${head.badge}<//>`}
    <${IconButton}
      icon="info"
      label="Odds of this spin"
      size="sm"
      class="reveal__odds"
      onClick=${onOdds}
    />
  </div>`;
}

function IdlePanel({ category, complete, turnName }) {
  if (complete)
    return html`<div class="stage-idle is-complete">
      <span class="stage-idle__icon" aria-hidden="true"
        ><${Icon} name="circle-check" size=${26}
      /></span>
      <span class="stage-idle__text">
        <b>Draft complete</b>
        <span>Every slot is filled. Check your XI, then continue.</span>
      </span>
    </div>`;
  return html`<div class="stage-idle">
    <span class="stage-idle__window" aria-hidden="true">
      <span class="stage-idle__q">?</span>
    </span>
    <span class="stage-idle__text">
      <b
        >${`${turnName ? `${turnName}: spin` : 'Spin'} for a ${CATEGORY_LABEL[category]?.toLowerCase() || 'pick'}`}</b
      >
      <span>${IDLE_TEXT[category] || ''}</span>
    </span>
  </div>`;
}

export function OddsDialog({ open, onClose, spin }) {
  const reels = useMemo(() => oddsSummary(spin), [spin]);
  return html`<${Modal}
    open=${open}
    onClose=${onClose}
    title="Odds of this spin"
    eyebrow="Honest reels"
    description="The result is drawn first; the reel only shows it. Options that could not fill an open slot (or were already seen this round) are out."
    size="sm"
    footer=${html`<${Button} variant="secondary" block onClick=${onClose}>Close<//>`}
  >
    <div class="odds">
      ${reels.map(
        r =>
          html`<section key=${r.category} class="odds__reel">
            <h3 class="odds__title">${r.label}</h3>
            <p class="odds__landed">
              <b>${r.landed.name}</b>${` had a ${r.landed.chance} chance — `}${
                r.uniform
                  ? `every one of the ${r.eligible} eligible ${r.label.toLowerCase()}s is equally likely.`
                  : `${r.eligible} of ${r.total} could come up.`
              }
            </p>
            ${
              !r.uniform &&
              html`<ul class="odds__groups" role="list">
                ${r.groups.map(
                  g =>
                    html`<li key=${g.label}>
                      <span class="odds__group">${g.label}</span>
                      <span class="odds__count">${g.count}×</span>
                      <span class="odds__each num">${g.chance} each</span>
                    </li>`,
                )}
              </ul>`
            }
          </section>`,
      )}
    </div>
  <//>`;
}

/**
 * SpinStage props: snap (session snapshot), animate (token or null), onLanded(),
 * onAutoPick(), turnName (versus), actions (desktop: Spin / Re-roll buttons in the card).
 */
export function SpinStage({
  snap,
  animate,
  onLanded,
  onAutoPick,
  turnName,
  fresh,
  actions,
  compact,
}) {
  const [odds, setOdds] = useState(false);
  const spin = snap.spin;
  const category = snap.category;
  const animating = animate != null && spin;
  return html`<section class=${cx('stage', animating && 'is-spinning')} aria-label="Spin">
    <header class="stage__head">
      <span class="stage__cat">
        <${Icon} name=${CATEGORY_ICON[category] || 'reel'} size=${16} />
        ${snap.complete ? 'All picks made' : `${CATEGORY_LABEL[category] || ''} spin`}
      </span>
      ${
        !snap.complete &&
        html`<span class="stage__round num"
          >Pick ${snap.round + 1}<span class="stage__of">/11</span></span
        >`
      }
      ${
        !snap.complete &&
        html`<${Button}
          variant="ghost"
          size="sm"
          icon="wand-sparkles"
          class="stage__auto"
          onClick=${onAutoPick}
          disabled=${animating}
          data-testid="auto-pick"
          title="Spin and take the best positional pick"
          >Auto-pick<//
        >`
      }
    </header>
    ${
      animating
        ? html`<${SpinningReels} spin=${spin} spinKey=${animate} onLanded=${onLanded} />`
        : spin
          ? html`<${RevealCard}
              spin=${spin}
              poolSize=${snap.pool.length}
              onOdds=${() => setOdds(true)}
              fresh=${fresh}
              compact=${compact}
            />`
          : html`<${IdlePanel}
              category=${category}
              complete=${snap.complete}
              turnName=${turnName}
            />`
    }
    ${actions && html`<div class="stage__actions">${actions}</div>`}
    ${spin && html`<${OddsDialog} open=${odds} onClose=${() => setOdds(false)} spin=${spin} />`}
  </section>`;
}
