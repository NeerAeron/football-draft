// Prime boost: one sheet to choose who gets it. Every drafted player is listed; those with a
// prime version show the bump in their slot ("85 → 94 +9 · ’19") and can be selected, the
// others are dimmed. Select, then confirm — a boost cannot be taken back. The sheet stays open
// and shows the boost that was made (its button then says Done). Data: session.snapshot() team
// slots (`slot.prime`, core/draft/session.js primeOption).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { html, cx } from '../../lib/html.js';
import { surname } from '../../lib/player-view.js';
import { editionLabel } from '../../../core/players/legends.js';
import { Sheet, Button, Flag, Icon } from '../../components/index.js';

/** "’19" for a prime option's version. */
const era = prime => editionLabel(prime.to);
/** Signed slot gain of a boost: '+4', '−1', '±0'. */
const gainText = d => (d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '±0');
/** Taps on the sheet's button are ignored this long after a boost (an impatient second tap). */
const SETTLE_MS = 450;

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
 * ({ ok } | { ok: false, reason }). After a boost the sheet stays open and shows it: the row
 * keeps its place with the bump and a tick, and the button says Done (or boosts the next
 * choice) — closing at once left nothing to see and put the next tap on the button underneath.
 */
export function PrimeSheet({ open, onClose, team, hideRatings, onPrime }) {
  const [slot, setSlot] = useState(null);
  // Boosts made while the sheet is open: slot → the option that was spent.
  const [done, setDone] = useState({});
  const settle = useRef(0);
  useEffect(() => {
    setSlot(null);
    setDone({});
  }, [open]);
  // Eligible first (biggest bump first), then the rest in pitch order — decided when the sheet
  // opens, so a boosted player does not jump down the list.
  const order = useMemo(() => {
    const gain = s => (s.prime ? s.prime.to.rating - s.prime.from.rating : -99);
    return team.slots
      .filter(s => s.player)
      .sort((a, b) => !!b.prime - !!a.prime || gain(b) - gain(a) || a.slot - b.slot)
      .map(s => s.slot);
  }, [open]);
  const rows = order.map(i => team.slots[i]).filter(s => s?.player);
  const picked = slot == null ? null : team.slots[slot];
  const chosen = picked?.prime?.allowed ? picked : null;
  const left = team.primesLeft;
  const boosted = Object.keys(done).length > 0;
  const act = () => {
    if (performance.now() < settle.current) return;
    if (!chosen) {
      if (boosted) onClose();
      return;
    }
    const option = chosen.prime;
    if (!onPrime(chosen.slot)?.ok) return;
    settle.current = performance.now() + SETTLE_MS;
    setDone(d => ({ ...d, [option.slot]: option }));
    setSlot(null);
  };
  return html`<${Sheet}
    open=${open}
    onClose=${onClose}
    eyebrow=${`${left} left`}
    title="Prime boost"
    size="md"
    class="draft-prime"
    footer=${html`<${Button}
      variant="primary"
      icon=${chosen || !boosted ? 'sparkles' : 'check'}
      block
      disabled=${!chosen && !boosted}
      onClick=${act}
      data-testid="prime-confirm"
      >${
        chosen
          ? `Boost ${surname(chosen.player.name)} · Prime ${era(chosen.prime)}`
          : boosted
            ? 'Done'
            : 'Choose a player'
      }<//
    >`}
  >
    <p class="draft-prime__lead">A drafted player becomes his best past version.</p>
    ${
      rows.length === 0
        ? html`<p class="draft-prime__empty">Draft a player first.</p>`
        : html`<ul class="draft-prime__list" role="list">
            ${rows.map(s => {
              const p = s.player,
                spent = done[s.slot],
                prime = s.prime || spent,
                on = !spent && !!s.prime?.allowed,
                gain = prime ? prime.to.rating - prime.from.rating : 0;
              return html`<li key=${s.slot}>
                <button
                  type="button"
                  class=${cx(
                    'draft-prime__row',
                    on && 'is-on',
                    spent && 'is-done',
                    slot === s.slot && 'is-selected',
                  )}
                  disabled=${!on}
                  aria-pressed=${String(slot === s.slot)}
                  onClick=${() => setSlot(s.slot)}
                  data-testid=${on ? 'prime-option' : spent ? 'prime-done' : undefined}
                  data-slot=${s.slot}
                >
                  <${Flag} code=${p.nationCode} name=${p.nation} size=${26} decorative />
                  <span class="draft-prime__who">
                    <span class="draft-prime__name truncate">${p.name}</span>
                    <span class="draft-prime__meta"
                      >${s.role}${
                        prime
                          ? ` · Prime ${era(prime)}${spent ? ' ✓' : ''}${
                              // Better elsewhere than in this slot: say where his prime plays.
                              !hideRatings && prime.to.rating < prime.to.ovr
                                ? ` · ${prime.to.position} ${prime.to.ovr}`
                                : ''
                            }`
                          : p.prime
                            ? ` · Prime ${editionLabel(p)} ✓`
                            : p.legend
                              ? ` · Legend ${editionLabel(p)}`
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
                          <i class=${cx(gain <= 0 && 'is-flat')}>${gainText(gain)}</i>
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
