/**
 * Reel — honest slot reel. The outcome is decided by the draft BEFORE the animation starts;
 * the reel only travels there (whole cycles + the remaining offset, no near-miss staging) and
 * never touches draft RNG.
 *
 * Props:
 *   items       [{ id, label, sub?, flag?: { code, name, src? }, logo?: { src, name },
 *                  crest?: { name, colors } }]
 *   landIndex   index in `items` the spin must land on (already decided)
 *   spinKey     change it (e.g. a counter or the pick number) to start a spin to landIndex;
 *               null/undefined = idle, showing landIndex
 *   duration    ms (default 2200);  cycles  whole loops before landing (default 3)
 *   onLand(item, index)  called once per spin (also when skipped or with reduced motion)
 *   onTick()    called each time an item passes the centre (hook a 'tick' sound here)
 *   skip        set true to land immediately (e.g. a "Skip" button); clicking the reel also skips
 *   renderItem(item) custom item content;  size 'sm' | 'md' | 'lg';  label (accessible name)
 *
 * Reduced motion: lands instantly (onLand fires on the next effect).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { html, cx } from '../lib/html.js';
import { useReducedMotion } from '../lib/motion.js';
import { Flag } from './flag.js';
import { Crest, LeagueLogo } from './crest.js';

const mod = (i, n) => ((Math.round(i) % n) + n) % n;
const easeOut = k => 1 - Math.pow(1 - k, 4);

function DefaultItem({ item }) {
  const media = item.flag
    ? html`<${Flag} ...${item.flag} size=${40} decorative />`
    : item.logo
      ? html`<${LeagueLogo} ...${item.logo} size=${40} decorative />`
      : item.crest
        ? html`<${Crest} ...${item.crest} size=${40} decorative />`
        : null;
  return html`${media && html`<span class="reel-item__media">${media}</span>`}
    <span class="reel-item__text">
      <span class="reel-item__label">${item.label}</span>
      ${item.sub && html`<span class="reel-item__sub">${item.sub}</span>`}
    </span>`;
}

export function Reel({
  items = [],
  landIndex = 0,
  spinKey,
  duration = 2200,
  cycles = 3,
  onLand,
  onTick,
  skip = false,
  renderItem,
  size = 'md',
  label = 'Reel',
  class: className,
}) {
  const reduced = useReducedMotion();
  const n = items.length;
  const [pos, setPos] = useState(landIndex || 0);
  const [blur, setBlur] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [landed, setLanded] = useState(null);
  const posRef = useRef(landIndex || 0);
  const anim = useRef(null);
  const cb = useRef({});
  cb.current = { onLand, onTick, items };

  const land = index => {
    const item = cb.current.items[index];
    posRef.current = index;
    setPos(index);
    setBlur(0);
    setSpinning(false);
    setLanded(item?.label ?? '');
    cb.current.onLand?.(item, index);
  };

  const finish = () => {
    const a = anim.current;
    if (!a) return;
    cancelAnimationFrame(a.raf);
    anim.current = null;
    land(a.landIndex);
  };

  useEffect(() => {
    if (spinKey == null || !n || landIndex == null) return;
    const start = mod(posRef.current, n);
    if (reduced) {
      land(landIndex);
      return;
    }
    const target = start + cycles * n + mod(landIndex - start, n);
    const t0 = performance.now();
    let last = start;
    const a = { raf: 0, landIndex };
    anim.current = a;
    setSpinning(true);
    setLanded(null);
    const step = now => {
      const k = Math.min(1, (now - t0) / duration);
      const p = start + (target - start) * easeOut(k);
      posRef.current = p;
      setPos(p);
      setBlur(Math.pow(1 - k, 3) * 2.4);
      const whole = Math.round(p);
      if (whole !== last) {
        last = whole;
        cb.current.onTick?.();
      }
      if (k < 1) a.raf = requestAnimationFrame(step);
      else finish();
    };
    a.raf = requestAnimationFrame(step);
    return () => {
      if (anim.current === a) {
        cancelAnimationFrame(a.raf);
        anim.current = null;
      }
    };
  }, [spinKey]);

  useEffect(() => {
    if (skip) finish();
  }, [skip]);

  const base = Math.floor(pos);
  const visible = [];
  if (n) for (let k = base - 2; k <= base + 3; k++) visible.push(k);

  return html`<div
    class=${cx('reel', `reel--${size}`, spinning && 'is-spinning', className)}
    role="group"
    aria-roledescription="reel"
    aria-label=${label}
    onClick=${spinning ? finish : undefined}
    title=${spinning ? 'Tap to skip' : undefined}
  >
    <div class="reel__window" aria-hidden="true">
      ${visible.map(k => {
        const item = items[mod(k, n)];
        const offset = k - pos;
        const centre = Math.abs(offset) < 0.5;
        return html`<div
          key=${k}
          class=${cx('reel-item', centre && 'is-centre')}
          style=${`--o:${offset.toFixed(4)};--blur:${blur.toFixed(2)}px`}
        >
          ${renderItem ? renderItem(item) : html`<${DefaultItem} item=${item} />`}
        </div>`;
      })}
      <span class="reel__frame"></span>
    </div>
    <span class="visually-hidden" aria-live="polite"
      >${spinning ? 'Spinning…' : landed ? `Landed on ${landed}` : ''}</span
    >
  </div>`;
}
