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
 *               'swap'|'blocked', label?, from?, to? }); 'blocked' slots cannot be selected
 *   links       [{ from, to, strength: 1 | 2 | 3 }] slot-index pairs (1 = same league,
 *               2 = same nation, 3 = club teammates — the screen decides) → lines under tokens
 *   selected    selected slot index (volt ring)
 *   onSelect    (index, slot) => void. Without it the pitch is display-only (no buttons).
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
import { surname } from '../lib/player-view.js';
import { Flag } from './flag.js';
import { Crest } from './crest.js';
import { FitTag, fitText } from './fit-tag.js';

const LINE_GAP = 5; // metres between formation lines before they are drawn as separate rows
const TOP_BOTTOM = [90, 11]; // % top of the GK line and of the most advanced line

/**
 * Lay out formation rows ([x length 0–105, y width 0–68, role]) on a portrait pitch.
 * Lines (clusters of similar x) are spaced evenly so tokens never collide; small x offsets
 * within a line are kept so wing-backs still sit a little higher than centre-backs.
 */
export function layoutSlots(rows = []) {
  const order = rows.map((r, i) => i).sort((a, b) => rows[a][0] - rows[b][0]);
  const lines = [];
  for (const i of order) {
    const last = lines[lines.length - 1];
    if (last && rows[i][0] - rows[last[last.length - 1]][0] <= LINE_GAP) last.push(i);
    else lines.push([i]);
  }
  const [bottom, top] = TOP_BOTTOM;
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

function SlotToken({ player, hideRatings }) {
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
    class=${cx('pitch-slot__token', `pitch-slot__token--${hideRatings ? 'hidden' : t.id}`)}
  >
    <span class="pitch-slot__face">${face}</span>
    ${!hideRatings && html`<span class="pitch-slot__ovr num">${player.ovr}</span>`}
  </span>`;
}

export function PitchView({
  formation = '433',
  rows,
  players = [],
  highlights = {},
  links = [],
  selected = null,
  onSelect,
  hideRatings = false,
  names = true,
  label = 'Formation',
  aspect = '4 / 5',
  class: className,
}) {
  const source = rows || FORMATIONS[formation] || FORMATIONS['433'];
  const slots = useMemo(() => layoutSlots(source), [source]);
  const refs = useRef([]);
  const interactive = typeof onSelect === 'function';
  const usable = i => highlights[i]?.state !== 'blocked';
  const firstUsable = slots.find(s => usable(s.index))?.index ?? 0;
  const [focusIndex, setFocusIndex] = useState(null);
  const tabStop = focusIndex ?? (selected != null && usable(selected) ? selected : firstUsable);

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
    class=${cx('pitch', interactive && 'pitch--interactive', className)}
    style=${`--pitch-aspect:${aspect}`}
  >
    <${PitchMarkings} />
    ${
      links.length > 0 &&
      html`<svg
        class="pitch__links"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        ${links.map(l => {
          const a = slots[l.from];
          const b = slots[l.to];
          if (!a || !b) return null;
          return html`<line
            key=${`${l.from}-${l.to}`}
            class=${`pitch__link pitch__link--${l.strength || 1}`}
            x1=${a.left}
            y1=${a.top}
            x2=${b.left}
            y2=${b.top}
          />`;
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
        const classes = cx(
          'pitch-slot',
          player ? 'is-filled' : 'is-empty',
          fit && `is-fit-${fit.state}`,
          selected === slot.index && 'is-selected',
        );
        const description = [
          slot.role,
          player
            ? `${player.fullName || player.name}${hideRatings ? '' : `, ${player.ovr}`}`
            : 'empty',
          fitText(fit, hideRatings),
        ]
          .filter(Boolean)
          .join(', ');
        const inner = html`${
            fit &&
            html`<span class="pitch-slot__fit"
              ><${FitTag} fit=${fit} size="sm" hideRatings=${hideRatings}
            /></span>`
          }
          <span class="pitch-slot__ring">
            <${SlotToken} player=${player} hideRatings=${hideRatings} />
            ${!player && html`<span class="pitch-slot__role">${slot.role}</span>`}
          </span>
          ${
            names && player && html`<span class="pitch-slot__name">${surname(player.name)}</span>`
          }`;
        const style = `left:${slot.left}%;top:${slot.top}%`;
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
              onFocus=${() => setFocusIndex(slot.index)}
              onClick=${() => !blocked && onSelect(slot.index, slot)}
            >
              ${inner}
            </button>`
          : html`<div
              key=${slot.index}
              class=${classes}
              style=${style}
              role="listitem"
              aria-label=${description}
            >
              ${inner}
            </div>`;
      })}
    </div>
  </div>`;
}
