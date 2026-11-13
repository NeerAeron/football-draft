/**
 * PitchView — portrait pitch with a formation's slots, player tokens, fit highlights and
 * link lines. Token size follows the pitch width (container query), so the same component
 * works as the draft board, a mini result pitch, or a desktop side pane.
 *
 * Props:
 *   formation   key of FORMATIONS in core/players/formations.js ('433', '4231-wide', …)
 *   rows        explicit [[x, y, role], …] rows instead of a formation key (same format)
 *   players     array aligned with the slots: PlayerView | null per slot
 *   highlights  { [slotIndex]: fit } — FitTag fit objects ({ state: 'best'|'ok'|'penalty'|
 *               'swap'|'blocked', label?, from?, to? }); 'blocked' slots cannot be selected.
 *               A fit with `rating` (and `role`) on an open slot writes that number into the
 *               slot — the overall the selected player would have there — and its tag says
 *               the role ("★ DM", "✓ LB"), so positions compare at a glance
 *   links       [{ from, to, strength: 1 | 2 | 3 }] slot-index pairs (3 = nation mates: gold,
 *               thickest; 2 = club mates: volt; 1 = a faint dashed line for other uses)
 *               → lines under tokens
 *   linkMode    'quiet' (default): thin, faint lines; hovering/focusing a player (or the
 *               selected slot) lights his links and fades the rest. 'focus': only the active
 *               player's links (used automatically when there are more than 14, e.g. a club
 *               XI where everyone links). 'all': the full-strength style everywhere.
 *   selected    selected slot index (volt ring)
 *   onSelect    (index, slot) => void. Without it the pitch is display-only (no buttons).
 *   boosts      the green "+1.5" chips on the tokens: mates (nation mate +1.5, club mate +1,
 *               both +2.5). Default: worked out from the players (their `source`,
 *               lib/player-view.js mateBoosts); pass an array aligned with the slots to
 *               override, or false for no chips. The OVR badge stays the plain rating.
 *   hideRatings hide OVR badges;  names (default true) show surname labels under tokens
 *   label       accessible name of the slot group (default 'Formation')
 *   aspect      CSS aspect-ratio of the pitch (default '4 / 5')
 *   class
 *
 * Keyboard: Tab enters the pitch on the selected (or first) slot; arrow keys move to the
 * nearest slot in that direction; Enter/Space select.
 */
import { useMemo, useRef, useState } from 'preact/hooks';
import { html, cx } from '../lib/html.js';
import { FORMATIONS } from '../../core/players/formations.js';
import { resolveTier } from '../lib/tiers.js';
import { surname, mateBoosts, captainSlot } from '../lib/player-view.js';
import { CaptainMark, GoatMark } from './captain-mark.js';
import { boost as fmtBoost } from '../lib/format.js';
import { Flag } from './flag.js';
import { Crest } from './crest.js';
import { FitTag, fitText } from './fit-tag.js';

const LINE_GAP = 5; // metres between formation lines before they are drawn as separate rows
const TOP_BOTTOM = [89, 11]; // % top of the GK line and of the most advanced line

/**
 * Lay out formation rows ([x length 0–105, y width 0–68, role]) on a portrait pitch.
 * Lines (clusters of similar x) are spaced evenly so tokens never collide; small x offsets
 * within a line are kept so wing-backs still sit a little higher than centre-backs.
 */
export function layoutSlots(rows = [], [bottom, top] = TOP_BOTTOM) {
  const order = rows.map((r, i) => i).sort((a, b) => rows[a][0] - rows[b][0]);
  const lines = [];
  for (const i of order) {
    const last = lines[lines.length - 1];
    if (last && rows[i][0] - rows[last[last.length - 1]][0] <= LINE_GAP) last.push(i);
    else lines.push([i]);
  }
  const step = lines.length > 1 ? (bottom - top) / (lines.length - 1) : 0;
  const out = [];
  lines.forEach((line, li) => {
    const mean = line.reduce((s, i) => s + rows[i][0], 0) / line.length;
    for (const i of line) {
      const [x, y, role] = rows[i];
      out[i] = {
        index: i,
        role,
        left: 9 + (y / 68) * 82,
        top: bottom - li * step - (x - mean) * 0.6,
      };
    }
  });
  return out;
}

const KEYS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

function nearest(slots, from, [dx, dy], usable) {
  let best = null;
  let bestScore = Infinity;
  for (const s of slots) {
    if (s.index === from.index || !usable(s.index)) continue;
    const vx = s.left - from.left;
    const vy = (s.top - from.top) * 1.25; // pitch is taller than wide
    const along = vx * dx + vy * dy;
    if (along <= 0.5) continue;
    const across = Math.abs(vx * dy) + Math.abs(vy * dx);
    const score = along + across * 2.2;
    if (score < bestScore) [best, bestScore] = [s, score];
  }
  return best;
}

function PitchMarkings() {
  return html`<svg
    class="pitch__lines"
    viewBox="0 0 100 125"
    preserveAspectRatio="none"
    aria-hidden="true"
    focusable="false"
  >
    <rect x="3" y="3" width="94" height="119" rx="1.5" />
    <path d="M3 62.5h94" />
    <circle cx="50" cy="62.5" r="11" />
    <circle class="pitch__spot" cx="50" cy="62.5" r="0.8" />
    <path d="M22 3v18h56V3M36 3v6h28V3M40 21a10 10 0 0 0 20 0" />
    <path d="M22 122v-18h56v18M36 122v-6h28v6M40 104a10 10 0 0 1 20 0" />
    <circle class="pitch__spot" cx="50" cy="15" r="0.6" />
    <circle class="pitch__spot" cx="50" cy="110" r="0.6" />
  </svg>`;
}

function SlotToken({ player, hideRatings, boost, captain }) {
  if (!player) return html`<span class="pitch-slot__token pitch-slot__token--empty"></span>`;
  const t = resolveTier(player.tier, player.ovr);
  const face = player.nation
    ? html`<${Flag} code=${player.nation.code} name=${player.nation.name} size=${44} decorative />`
    : html`<${Crest}
        name=${player.club?.name || player.name}
        colors=${player.club?.colors}
        size=${44}
        decorative
      />`;
  return html`<span
    class=${cx(
      'pitch-slot__token',
      `pitch-slot__token--${hideRatings ? 'hidden' : t.id}`,
      player.goat && 'pitch-slot__token--goat',
    )}
  >
    <span class="pitch-slot__face">${face}</span>
    ${!hideRatings && html`<span class="pitch-slot__ovr num">${player.ovr}</span>`}
    ${boost > 0 && html`<span class="pitch-slot__boost num">${fmtBoost(boost)}</span>`}
    ${captain && html`<${CaptainMark} class="pitch-slot__captain" />`}
    ${player.goat && html`<${GoatMark} class="pitch-slot__goat" />`}
    ${player.era && html`<span class="pitch-slot__era num">${player.era}</span>`}
    ${
      player.primeNote &&
      html`<span class="pitch-slot__prime" title=${player.primeNote} aria-hidden="true"></span>`
    }
  </span>`;
}

/** Links busier than this switch the default 'quiet' mode to 'focus'. */
export const LINK_FOCUS_THRESHOLD = 14;

export function PitchView({
  formation = '433',
  rows,
  players = [],
  highlights = {},
  links = [],
  linkMode = 'quiet',
  selected = null,
  onSelect,
  hideRatings = false,
  boosts,
  names = true,
  label = 'Formation',
  aspect = '4 / 5',
  class: className,
}) {
  const source = rows || FORMATIONS[formation] || FORMATIONS['433'];
  // Squatter pitches than 4:5 (sheets, pre-match previews) lift the keeper's row so his
  // name label stays inside the pitch.
  const [aw, ah] = String(aspect).split('/').map(Number);
  const squat = aw > 0 && ah > 0 && aw / ah > 0.82;
  const slots = useMemo(() => layoutSlots(source, squat ? [86, 11] : TOP_BOTTOM), [source, squat]);
  const captainAt = useMemo(() => captainSlot(players), [players]);
  const boostAt = useMemo(
    () => (boosts === false ? [] : Array.isArray(boosts) ? boosts : mateBoosts(players)),
    [boosts, players],
  );
  const refs = useRef([]);
  const interactive = typeof onSelect === 'function';
  const usable = i => highlights[i]?.state !== 'blocked';
  const firstUsable = slots.find(s => usable(s.index))?.index ?? 0;
  const [focusIndex, setFocusIndex] = useState(null);
  const [hover, setHover] = useState(null);
  const [keyFocus, setKeyFocus] = useState(null);
  const tabStop = focusIndex ?? (selected != null && usable(selected) ? selected : firstUsable);
  const mode = linkMode === 'quiet' && links.length > LINK_FOCUS_THRESHOLD ? 'focus' : linkMode;
  const active = hover ?? keyFocus ?? (players[selected] ? selected : null);
  const shownLinks =
    mode === 'focus' ? links.filter(l => l.from === active || l.to === active) : links;
  const linkEvents = links.length > 0 && mode !== 'all';

  const onKeyDown = e => {
    const dir = KEYS[e.key];
    if (!dir) return;
    const from = slots[Number(e.target.closest('[data-slot]')?.dataset.slot)];
    if (!from) return;
    const next = nearest(slots, from, dir, usable);
    e.preventDefault();
    if (next) {
      setFocusIndex(next.index);
      refs.current[next.index]?.focus();
    }
  };

  const filledCount = players.filter(Boolean).length;
  return html`<div
    class=${cx(
      'pitch',
      interactive && 'pitch--interactive',
      links.length > 0 && `pitch--links-${mode}`,
      linkEvents && active != null && 'has-link-focus',
      className,
    )}
    style=${`--pitch-aspect:${aspect}`}
  >
    <${PitchMarkings} />
    ${
      shownLinks.length > 0 &&
      html`<svg
        class="pitch__links"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        ${shownLinks.map(l => {
          const a = slots[l.from];
          const b = slots[l.to];
          if (!a || !b) return null;
          const on = active != null && (l.from === active || l.to === active);
          // A link is a soft glow, a solid core and a travelling pulse along it.
          const ends = { x1: a.left, y1: a.top, x2: b.left, y2: b.top };
          return html`<g
            key=${`${l.from}-${l.to}`}
            class=${cx('pitch__link', `pitch__link--${l.strength || 1}`, on && 'is-on')}
          >
            <line class="pitch__link-glow" ...${ends} />
            <line class="pitch__link-core" ...${ends} />
            <line class="pitch__link-flow" pathLength="100" ...${ends} />
          </g>`;
        })}
      </svg>`
    }
    <div
      class="pitch__slots"
      role=${interactive ? 'group' : 'list'}
      aria-label=${`${label}, ${filledCount} of ${slots.length} filled`}
      onKeyDown=${interactive ? onKeyDown : undefined}
    >
      ${slots.map(slot => {
        const player = players[slot.index] || null;
        const fit = highlights[slot.index];
        const blocked = fit?.state === 'blocked';
        // The selected player's overall in this open slot, in the slot itself.
        const rated = !player && !blocked && !hideRatings && fit?.rating != null;
        const tag = rated ? { state: fit.state, label: fit.role || slot.role } : fit;
        const classes = cx(
          'pitch-slot',
          player ? 'is-filled' : 'is-empty',
          fit && `is-fit-${fit.state}`,
          selected === slot.index && 'is-selected',
        );
        const description = [
          slot.role,
          player
            ? `${player.fullName || player.name}${hideRatings ? '' : `, ${player.ovr}`}${
                boostAt[slot.index] > 0 ? `, boost ${fmtBoost(boostAt[slot.index])}` : ''
              }`
            : 'empty',
          rated ? `rating ${fit.rating}` : '',
          fitText(fit, hideRatings),
        ]
          .filter(Boolean)
          .join(', ');
        const inner = html`${
            fit &&
            html`<span class="pitch-slot__fit"
              ><${FitTag} fit=${tag} size="sm" hideRatings=${hideRatings}
            /></span>`
          }
          <span class="pitch-slot__ring">
            <${SlotToken}
              player=${player}
              hideRatings=${hideRatings}
              boost=${player ? boostAt[slot.index] : 0}
              captain=${slot.index === captainAt}
            />
            ${
              !player &&
              (rated
                ? html`<span class="pitch-slot__role pitch-slot__rating num">${fit.rating}</span>`
                : html`<span class="pitch-slot__role">${slot.role}</span>`)
            }
          </span>
          ${
            names && player && html`<span class="pitch-slot__name">${surname(player.name)}</span>`
          }`;
        const style = `left:${slot.left}%;top:${slot.top}%`;
        const pointer = linkEvents &&
          player && {
            onPointerEnter: e => e.pointerType === 'mouse' && setHover(slot.index),
            onPointerLeave: e =>
              e.pointerType === 'mouse' && setHover(h => (h === slot.index ? null : h)),
            // Display-only pitch on touch: a tap shows that player's links (tap again: all).
            ...(!interactive && {
              onPointerUp: e =>
                e.pointerType !== 'mouse' && setHover(h => (h === slot.index ? null : slot.index)),
            }),
          };
        return interactive
          ? html`<button
              key=${slot.index}
              ref=${el => (refs.current[slot.index] = el)}
              type="button"
              class=${classes}
              style=${style}
              data-slot=${slot.index}
              tabindex=${slot.index === tabStop ? 0 : -1}
              aria-label=${description}
              aria-pressed=${String(selected === slot.index)}
              aria-disabled=${blocked ? 'true' : undefined}
              onFocus=${e => {
                setFocusIndex(slot.index);
                if (linkEvents && e.target.matches(':focus-visible')) setKeyFocus(slot.index);
              }}
              onBlur=${() => setKeyFocus(null)}
              onClick=${() => !blocked && onSelect(slot.index, slot)}
              ...${pointer || {}}
            >
              ${inner}
            </button>`
          : html`<div
              key=${slot.index}
              class=${classes}
              style=${style}
              role="listitem"
              aria-label=${description}
              ...${pointer || {}}
            >
              ${inner}
            </div>`;
      })}
    </div>
  </div>`;
}
