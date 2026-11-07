/**
 * Confetti — one-shot canvas burst over the whole viewport (pointer-events: none).
 *   fire      any value; each change to a truthy value fires a burst (e.g. a counter)
 *   count     particles (default 160) on a large, fast screen; phones and low-end devices
 *             get fewer (see confettiBudget) — a burst must never cost a dropped second
 *   duration  ms (default 2600)
 *   origin    { x, y } in 0–1 viewport fractions (default top-centre { x: 0.5, y: 0.25 })
 *   colors    array of CSS colours (default volt/gold/white/holo)
 * Reduced motion: renders nothing. Uses Math.random — never simulation/draft RNG.
 *
 * Cheap by construction: the canvas is sized once per burst (no layout reads per frame),
 * drawn at 1× pixel density on phones, particles are flat rects batched by colour with
 * setTransform (no save/restore), only the area the particles covered is cleared, and the
 * loop stops as soon as everything has fallen out of view.
 */
import { useEffect, useRef } from 'preact/hooks';
import { html } from '../lib/html.js';
import { isReducedMotion } from '../lib/motion.js';

const DEFAULT_COLORS = ['#cdf545', '#f5c84c', '#ffffff', '#8fe3ff', '#c9b6ff', '#ff8fd0'];

/**
 * Particle count and pixel density for this device: full count on wide screens with ≥ 8
 * cores; ~45 % on phones (or ≤ 4 cores / ≤ 4 GB / Save-Data); density 1 below 700 px.
 */
export function confettiBudget(count, env = globalThis) {
  const nav = env.navigator || {};
  const width = env.innerWidth || 1024;
  const small = width < 700;
  const slow =
    (nav.hardwareConcurrency && nav.hardwareConcurrency <= 4) ||
    (nav.deviceMemory && nav.deviceMemory <= 4) ||
    nav.connection?.saveData;
  const scale = small && slow ? 0.35 : small || slow ? 0.45 : 1;
  return {
    count: Math.max(24, Math.round(count * scale)),
    dpr: small ? 1 : Math.min(1.5, env.devicePixelRatio || 1),
  };
}

export function Confetti({
  fire,
  count = 160,
  duration = 2600,
  origin = { x: 0.5, y: 0.25 },
  colors = DEFAULT_COLORS,
}) {
  const canvas = useRef(null);
  useEffect(() => {
    if (!fire || isReducedMotion() || !canvas.current) return;
    const el = canvas.current;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const budget = confettiBudget(count);
    const dpr = budget.dpr;
    const w = Math.round(innerWidth * dpr);
    const h = Math.round(innerHeight * dpr);
    if (el.width !== w) el.width = w;
    if (el.height !== h) el.height = h;
    // Particles grouped by colour: one fillStyle per group per frame.
    const groups = colors.map(color => ({ color, parts: [] }));
    for (let i = 0; i < budget.count; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
      const speed = (7 + Math.random() * 10) * dpr;
      const size = (5 + Math.random() * 6) * dpr;
      groups[(Math.random() * groups.length) | 0].parts.push({
        x: origin.x * w,
        y: origin.y * h,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        w: size,
        h: size * (Math.random() < 0.3 ? 1 : 0.5),
        rot: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.3,
      });
    }
    const gravity = 0.32 * dpr;
    const t0 = performance.now();
    let raf = 0;
    // Bounding box drawn last frame (cleared before the next one).
    let box = null;
    const clear = () => {
      if (box) ctx.clearRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
      box = null;
    };
    const frame = now => {
      const t = (now - t0) / duration;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      clear();
      if (t >= 1) return;
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, t - 0.6) / 0.4);
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity,
        visible = 0;
      for (const g of groups) {
        ctx.fillStyle = g.color;
        for (const p of g.parts) {
          p.vy += gravity;
          p.vx *= 0.985;
          p.vy *= 0.985;
          p.x += p.vx;
          p.y += p.vy;
          p.rot += p.spin;
          if (p.y - p.w > h) continue;
          visible++;
          const c = Math.cos(p.rot),
            s = Math.sin(p.rot);
          ctx.setTransform(c, s, -s, c, p.x, p.y);
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          if (p.x < x0) x0 = p.x;
          if (p.x > x1) x1 = p.x;
          if (p.y < y0) y0 = p.y;
          if (p.y > y1) y1 = p.y;
        }
      }
      if (!visible) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        return;
      }
      const pad = 12 * dpr;
      box = [
        Math.max(0, Math.floor(x0 - pad)),
        Math.max(0, Math.floor(y0 - pad)),
        Math.min(w, Math.ceil(x1 + pad)),
        Math.min(h, Math.ceil(y1 + pad)),
      ];
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
    };
  }, [fire]);
  return html`<canvas class="confetti" ref=${canvas} aria-hidden="true"></canvas>`;
}
