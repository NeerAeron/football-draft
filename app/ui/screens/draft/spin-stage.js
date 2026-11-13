// Spin stage: the honest reel(s) while a spin animates, the reveal card once it lands, an
// idle "what the next spin draws" panel, and the odds dialog (not in a World Cup draft, whose
// two reels — era, then nation — show no odds). The session has already
// decided the landing; reels only travel there (their own timing, never the draft RNG).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { html, cx } from '../../lib/html.js';
import { playCue } from '../../lib/audio.js';
import { isReducedMotion } from '../../lib/motion.js';
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

// Long enough to build a beat of suspense, short enough for eleven of them in a row.
const TIMING = {
  nation: [{ duration: 1050, cycles: 2 }],
  league: [{ duration: 1050, cycles: 2 }],
  club: [
    { duration: 700, cycles: 1 },
    { duration: 950, cycles: 2 },
  ],
  // A World Cup draft: the era lands first, then the nation.
  era: [
    { duration: 800, cycles: 2 },
    { duration: 950, cycles: 2 },
  ],
};

// A beat to read each result: after the era lands, before the nation reel starts, and after
// the last reel lands, before the pool takes over. UI timing only (the spin is long made);
// none with reduced motion, and a tap skips it like it skips a reel.
const PAUSE = { between: 650, landed: 750 };

/**
 * Bring the reel card into view when it is cut off or off screen (under the top bar, behind
 * the phone's action bar): a spin is always watched. Jumps with reduced motion, and when
 * `smooth` is false.
 */
function showStage(el, smooth = true) {
  if (!el?.getBoundingClientRect || !globalThis.scrollBy) return;
  const doc = globalThis.document,
    box = el.getBoundingClientRect(),
    top =
      (parseFloat(getComputedStyle(doc.documentElement).getPropertyValue('--topbar-h')) || 60) + 8,
    bar = doc.querySelector('.draft__bar')?.getBoundingClientRect(),
    // The phone's action bar sits on the bottom edge; on desktop it is in the flow.
    bottom = bar && bar.top > top && bar.bottom >= innerHeight - 1 ? bar.top - 8 : innerHeight - 8;
  let by = 0;
  if (box.top < top || box.height > bottom - top) by = box.top - top;
  else if (box.bottom > bottom) by = box.bottom - bottom;
  if (Math.abs(by) < 2) return;
  globalThis.scrollBy({ top: by, behavior: smooth && !isReducedMotion() ? 'smooth' : 'auto' });
}

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
  const reels = spin.reels;
  // A respin moves only the reels it draws again (`spin.spun`): the other one stays landed.
  const spun = i => spin.spun?.[i] !== false;
  const nextLeg = from => {
    for (let i = from; i < reels.length; i++) if (spun(i)) return i;
    return reels.length;
  };
  const [leg, setLeg] = useState(() => nextLeg(0));
  // The pause after a landing: { timer, then } while one is running (a tap ends it at once).
  const pause = useRef(null);
  const after = (ms, then) => {
    if (isReducedMotion() || ms <= 0) return then();
    const timer = setTimeout(() => {
      pause.current = null;
      then();
    }, ms);
    pause.current = { timer, then };
  };
  const skipPause = () => {
    const p = pause.current;
    if (!p) return;
    clearTimeout(p.timer);
    pause.current = null;
    p.then();
  };
  useEffect(
    () => () => {
      if (pause.current) clearTimeout(pause.current.timer);
      pause.current = null;
    },
    [spinKey],
  );
  const timing = TIMING[spin.era ? 'era' : spin.category] || TIMING.nation;
  const legs = useMemo(
    () => reels.map((r, i) => reelItems(r, { league: i === 1 ? spin.league : null })),
    [spin],
  );
  useEffect(() => setLeg(nextLeg(0)), [spinKey]);
  return html`<div
    class=${cx('stage-reels', reels.length > 1 && 'stage-reels--two')}
    onClick=${skipPause}
  >
    ${legs.map(
      (r, i) =>
        html`<div key=${i} class=${cx('stage-reels__reel', !spun(i) && 'is-kept')}>
          <span class="stage-reels__label">${CATEGORY_LABEL[reels[i].category]}</span>
          ${
            !spun(i)
              ? html`<${Reel}
                  items=${r.items}
                  landIndex=${r.landIndex}
                  spinKey=${null}
                  size=${reels.length > 1 && i === 0 ? 'sm' : 'md'}
                  label=${`${CATEGORY_LABEL[reels[i].category]} reel`}
                />`
              : i > leg
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
                      const next = nextLeg(i + 1);
                      if (next < legs.length) after(PAUSE.between, () => setLeg(next));
                      else after(PAUSE.landed, onLanded);
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
      <span class="reveal__cat" data-testid=${head.era ? 'spin-era' : undefined}>
        ${
          head.era ??
          `${CATEGORY_LABEL[spin.category]}${spin.reroll ? ` · re-roll ${spin.reroll}` : ''}`
        }
      </span>
      <span class="reveal__title">${head.title}</span>
      <span class="reveal__meta">
        ${head.league && html`<${LeagueLogo} ...${head.league} size=${16} decorative />`}
        <span>${head.meta}</span>
      </span>
    </span>
    ${head.badge && html`<${Chip} tone="gold" variant="solid" size="sm" class="reveal__badge">${head.badge}<//>`}
    ${
      // A World Cup draft shows no odds.
      !spin.era &&
      html`<${IconButton}
        icon="info"
        label="Odds of this spin"
        size="sm"
        class="reveal__odds"
        onClick=${onOdds}
      />`
    }
  </div>`;
}

function IdlePanel({ category, complete, turnName, eras }) {
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
  if (eras)
    return html`<div class="stage-idle">
      <span class="stage-idle__window" aria-hidden="true">
        <span class="stage-idle__q">?</span>
      </span>
      <span class="stage-idle__text">
        <b>Spin an era and a nation</b>
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
    <div class="spin-odds">
      ${reels.map(
        r =>
          html`<section key=${r.category} class="spin-odds__reel">
            <h3 class="spin-odds__title">${r.label}</h3>
            <p class="spin-odds__landed">
              <b>${r.landed.name}</b>${` had a ${r.landed.chance} chance — `}${
                r.uniform
                  ? `every one of the ${r.eligible} eligible ${r.label.toLowerCase()}s is equally likely.`
                  : `${r.eligible} of ${r.total} could come up.`
              }
            </p>
            ${
              !r.uniform &&
              html`<ul class="spin-odds__groups" role="list">
                ${r.groups.map(
                  g =>
                    html`<li key=${g.label}>
                      <span class="spin-odds__group">${g.label}</span>
                      <span class="spin-odds__count">${g.count}×</span>
                      <span class="spin-odds__each num">${g.chance} each</span>
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
  const eras = !!snap.eras;
  // The reel card is in view when a draft opens on its first spin, whenever a spin starts,
  // and still when the result has landed (the page below it changes height on the way).
  const card = useRef(null);
  const watch = snap.complete ? 'done' : animating ? `spin ${animate}` : spin ? 'landed' : 'idle';
  useEffect(() => {
    if (watch === 'done') return undefined;
    showStage(card.current);
    // Once more when the layout has settled (the pool leaves, the pitch comes back) — and
    // while the reels run, until the result has landed: a closing sheet or a pick moment
    // holds the page for a moment, and the first try can come too early.
    // (Those later tries jump: a smooth scroll does not always get going while a reel runs.)
    const settle = setTimeout(() => showStage(card.current, false), 350);
    const keep = animating ? setInterval(() => showStage(card.current, false), 350) : null;
    return () => {
      clearTimeout(settle);
      if (keep) clearInterval(keep);
    };
  }, [watch]);
  return html`<section
    ref=${card}
    class=${cx('stage', animating && 'is-spinning', eras && 'is-eras')}
    aria-label="Spin"
    data-eras=${eras ? 'true' : undefined}
  >
    <header class="stage__head">
      <span class="stage__cat">
        <${Icon} name=${eras ? 'reel' : CATEGORY_ICON[category] || 'reel'} size=${16} />
        ${
          snap.complete
            ? 'All picks made'
            : eras
              ? 'Era · Nation'
              : `${CATEGORY_LABEL[category] || ''} spin`
        }
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
              eras=${eras}
            />`
    }
    ${actions && html`<div class="stage__actions">${actions}</div>`}
    ${
      spin &&
      !spin.era &&
      html`<${OddsDialog} open=${odds} onClose=${() => setOdds(false)} spin=${spin} />`
    }
  </section>`;
}
