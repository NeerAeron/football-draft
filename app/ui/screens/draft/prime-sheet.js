// Prime boost: one sheet to choose who gets it. Every drafted player is listed; those with a
// prime version show the bump ("85 → 94 +9 · ’19") and can be selected, the others are dimmed.
// Select, then confirm — a boost cannot be taken back. Data: session.snapshot() team slots
// (`slot.prime`, core/draft/session.js primeOption).
import { useEffect, useState } from 'preact/hooks';
import { html, cx } from '../../lib/html.js';
import { surname } from '../../lib/player-view.js';
import { editionLabel } from '../../../core/players/legends.js';
import { Sheet, Button, Flag, Icon } from '../../components/index.js';

/** "’19" for a prime option's edition. */
const era = prime => editionLabel(prime.to.edition);

/** The board's Prime boost button: "Prime boost · 2" (nothing when the draft has none). */
export function PrimeButton({ team, primes, onOpen, class: className }) {
  if (!primes) return null;
  const left = team.primesLeft;
  const ready = team.slots.some(s => s.prime?.allowed);
  return html`<button
    type="button"
    class=${cx('draft-prime-btn', ready && 'is-ready', left === 0 && 'is-spent', className)}
    onClick=${onOpen}
    data-testid="prime-open"
    aria-label=${`Prime boost: ${left} left`}
  >
    <${Icon} name="sparkles" size=${16} />
    <span>Prime boost</span>
    <b class="num">${left}</b>
  </button>`;
}

/**
 * PrimeSheet props: open, onClose, team (snapshot team), hideRatings, onPrime(slot) → result
 * ({ ok } | { ok: false, reason }).
 */
export function PrimeSheet({ open, onClose, team, hideRatings, onPrime }) {
  const [slot, setSlot] = useState(null);
  useEffect(() => setSlot(null), [open, team.primesLeft]);
  const rows = team.slots.filter(s => s.player);
  // Eligible first (biggest bump first), then the rest in pitch order.
  const gain = s => (s.prime ? s.prime.to.rating - s.prime.from.rating : -1);
  const ordered = [...rows].sort((a, b) => gain(b) - gain(a) || a.slot - b.slot);
  const picked = slot == null ? null : team.slots[slot];
  const chosen = picked?.prime ? picked : null;
  const left = team.primesLeft;
  return html`<${Sheet}
    open=${open}
    onClose=${onClose}
    eyebrow=${`${left} left`}
    title="Prime boost"
    size="md"
    class="draft-prime"
    footer=${html`<${Button}
      variant="primary"
      icon="sparkles"
      block
      disabled=${!chosen?.prime.allowed}
      onClick=${() => chosen && onPrime(chosen.slot)}
      data-testid="prime-confirm"
      >${chosen ? `Boost ${surname(chosen.player.name)} · Prime ${era(chosen.prime)}` : 'Choose a player'}<//
    >`}
  >
    <p class="draft-prime__lead">A drafted player becomes his best past version.</p>
    ${
      rows.length === 0
        ? html`<p class="draft-prime__empty">Draft a player first.</p>`
        : html`<ul class="draft-prime__list" role="list">
            ${ordered.map(s => {
              const p = s.player,
                prime = s.prime,
                on = prime?.allowed;
              return html`<li key=${s.slot}>
                <button
                  type="button"
                  class=${cx('draft-prime__row', on && 'is-on', slot === s.slot && 'is-selected')}
                  disabled=${!on}
                  aria-pressed=${String(slot === s.slot)}
                  onClick=${() => setSlot(s.slot)}
                  data-testid=${on ? 'prime-option' : undefined}
                  data-slot=${s.slot}
                >
                  <${Flag} code=${p.nationCode} name=${p.nation} size=${26} decorative />
                  <span class="draft-prime__who">
                    <span class="draft-prime__name truncate">${p.name}</span>
                    <span class="draft-prime__meta"
                      >${s.role}${
                        prime
                          ? ` · Prime ${era(prime)}`
                          : p.prime
                            ? ` · Prime ${editionLabel(p.edition)} ✓`
                            : p.legend
                              ? ` · Legend ${editionLabel(p.edition)}`
                              : ''
                      }</span
                    >
                  </span>
                  ${
                    prime && !hideRatings
                      ? html`<span class="draft-prime__bump num">
                          <span class="draft-prime__from">${prime.from.rating}</span>
                          <${Icon} name="arrow-right" size=${14} />
                          <b>${prime.to.rating}</b>
                          <i>+${prime.to.rating - prime.from.rating}</i>
                        </span>`
                      : html`<span class="draft-prime__bump num"
                          >${hideRatings ? (prime ? 'Prime' : '') : s.rating}</span
                        >`
                  }
                </button>
              </li>`;
            })}
          </ul>`
    }
  <//>`;
}
