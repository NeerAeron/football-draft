/**
 * PlayerCard — collectible-style player card with a tier foil frame.
 *
 * Props:
 *   player       PlayerView (see lib/player-view.js): name, position, ovr, nation, club, league,
 *                stats (six), badges. Top-right marks: nation flag + league logo (club Crest
 *                when there is no league logo); the kit shows the club colours.
 *   size         's' (112px: rating, flag, kit, name) | 'm' (168px: + six stats, 1 badge)
 *                | 'l' (232px: + club · league line, 3 badges)                    default 'm'
 *   tier         override the tier ('Superstar' | 'Star' | 'Starter' | 'Normal' | 'Bench');
 *                default from ovr: 88+ holo, 84–87 gold, 80–83 silver, 74–79 bronze, else slate
 *                (lib/tiers.js); a Superstar's or Star's card has a thin outline in its colour
 *   selected     volt ring + check (aria-pressed when interactive)
 *   disabled     dimmed, not clickable (e.g. no open slot)
 *   hideRatings  "Ball Knower": hides OVR, stats and the tier frame (shows '?')
 *   onClick      makes the card a <button>;  href makes it a link
 *   showBadges   default true
 *   children     optional footer content inside the card (e.g. a fit chip)
 * An era card shows the year of that version under the position ("’18"); a
 * Captain wears the "C".
 */
import { html, cx } from '../lib/html.js';
import { resolveTier } from '../lib/tiers.js';
import { teamStyle } from '../lib/color.js';
import { surname } from '../lib/player-view.js';
import { Flag } from './flag.js';
import { Crest, LeagueLogo } from './crest.js';
import { Chip } from './chip.js';
import { Icon } from './icon.js';
import { CaptainMark, GoatMark } from './captain-mark.js';

const MARK = { s: 18, m: 22, l: 28 };
const BADGE_COUNT = { s: 0, m: 1, l: 3 };

/** Club-coloured shirt used as the card art (we ship no player photos). */
export function KitShirt({ colors = [], class: className }) {
  return html`<svg
    class=${cx('kit-shirt', className)}
    style=${teamStyle(colors)}
    viewBox="0 0 100 90"
    aria-hidden="true"
    focusable="false"
  >
    <path
      class="kit-shirt__body"
      d="M35 6 20 11 4 26l10 16 10-6v50h52V36l10 6 10-16-16-15-15-5c-3 7-9 11-15 11S38 13 35 6Z"
    />
    <path class="kit-shirt__shade" d="M50 17c6 0 12-4 15-11l15 5 16 15-10 16-10-6v50H50Z" />
    <path class="kit-shirt__trim" d="M35 6c3 7 9 11 15 11s12-4 15-11M4 26l10 16M96 26 86 42" />
  </svg>`;
}

export function PlayerCard({
  player,
  size = 'm',
  tier,
  selected = false,
  disabled = false,
  hideRatings = false,
  onClick,
  href,
  showBadges = true,
  class: className,
  children,
  ...rest
}) {
  const p = player || {};
  const t = resolveTier(tier || p.tier, p.ovr);
  const frame = hideRatings ? 'hidden' : t.id;
  const badges = showBadges ? (p.badges || []).slice(0, BADGE_COUNT[size] ?? 2) : [];
  const extra = showBadges ? Math.max(0, (p.badges || []).length - badges.length) : 0;
  const label = [
    p.fullName || p.name,
    p.position,
    hideRatings ? null : `${p.ovr} overall`,
    hideRatings ? null : t.label,
    p.nation?.name,
    p.club?.name,
    p.era ? `${p.prime ? 'prime version, ' : ''}${p.era} version` : null,
    p.captain ? 'Leader' : null,
    p.goat ? 'GOAT' : null,
  ]
    .filter(Boolean)
    .join(', ');
  const classes = cx(
    'pcard',
    p.prime && 'pcard--prime',
    p.goat && 'pcard--goat is-goat-edge',
    `pcard--${size}`,
    `pcard--tier-${frame}`,
    selected && 'is-selected',
    disabled && 'is-disabled',
    (onClick || href) && 'pcard--interactive',
    className,
  );
  const mark = MARK[size] || 22;
  const body = html`<span class="pcard__body">
      <span class="pcard__top">
        <span class="pcard__rating">
          <span class="pcard__ovr num">${hideRatings ? '?' : p.ovr}</span>
          <span class="pcard__pos">${p.position}</span>
          ${p.era && html`<span class="pcard__era num">${p.era}</span>`}
          ${p.captain && html`<${CaptainMark} size=${size === 's' ? 'sm' : 'md'} />`}
          ${p.goat && html`<${GoatMark} size=${size === 's' ? 'sm' : 'md'} />`}
        </span>
        <span class="pcard__art"><${KitShirt} colors=${p.club?.colors} /></span>
        <span class="pcard__marks">
          ${
            p.nation &&
            html`<${Flag} code=${p.nation.code} name=${p.nation.name} size=${mark} decorative />`
          }
          ${
            p.league?.logo
              ? html`<${LeagueLogo}
                  src=${p.league.logo}
                  name=${p.league.name}
                  size=${mark}
                  decorative
                />`
              : p.club &&
                html`<${Crest}
                  name=${p.club.name}
                  short=${p.club.short}
                  colors=${p.club.colors}
                  size=${mark}
                  decorative
                />`
          }
        </span>
      </span>
      <span class="pcard__name" title=${p.fullName || p.name}
        >${size === 's' ? surname(p.name) : p.name}</span
      >
      ${
        size === 'l' &&
        (p.club || p.league) &&
        html`<span class="pcard__club truncate"
          >${[p.club?.name, p.league?.name].filter(Boolean).join(' · ')}</span
        >`
      }
      ${
        size !== 's' &&
        p.stats?.length > 0 &&
        html`<span class="pcard__stats" aria-hidden=${hideRatings ? 'true' : undefined}>
          ${p.stats
            .slice(0, 6)
            .map(
              s =>
                html`<span class="pcard__stat" key=${s.key} title=${s.label}
                  ><b class="num">${hideRatings ? '–' : s.value}</b><i>${s.key}</i></span
                >`,
            )}
        </span>`
      }
      ${
        badges.length > 0 &&
        html`<span class="pcard__badges">
          ${badges.map(
            b => html`<${Chip} key=${b.id} size="sm" tone="gold" title=${b.label}>${b.label}<//>`,
          )}
          ${extra > 0 && html`<${Chip} size="sm" tone="neutral">+${extra}<//>`}
        </span>`
      }
      ${children && html`<span class="pcard__footer">${children}</span>`}
    </span>
    ${
      selected &&
      html`<span class="pcard__check" aria-hidden="true"
        ><${Icon} name="check" size=${size === 's' ? 12 : 14} strokeWidth=${3}
      /></span>`
    }`;
  if (href && !disabled)
    return html`<a class=${classes} href=${href} aria-label=${label} ...${rest}>${body}</a>`;
  if (onClick)
    return html`<button
      type="button"
      class=${classes}
      onClick=${onClick}
      disabled=${disabled}
      aria-pressed=${String(!!selected)}
      aria-label=${label}
      ...${rest}
    >
      ${body}
    </button>`;
  return html`<article
    class=${classes}
    aria-label=${label}
    aria-disabled=${disabled ? 'true' : undefined}
    ...${rest}
  >
    ${body}
  </article>`;
}
