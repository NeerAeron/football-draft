/**
 * Confetti — one-shot canvas burst over the whole viewport (pointer-events: none).
 *   fire      any value; each change to a truthy value fires a burst (e.g. a counter)
 *   count     particles (default 160);  duration ms (default 2600)
 *   origin    { x, y } in 0–1 viewport fractions (default top-centre { x: 0.5, y: 0.25 })
 *   colors    array of CSS colours (default volt/gold/white/holo)
 * Reduced motion: renders nothing. Uses Math.random — never simulation/draft RNG.
 */
import { useEffect, useRef } from 'preact/hooks';
import { html } from '../lib/html.js';
import { isReducedMotion } from '../lib/motion.js';

const DEFAULT_COLORS = ['#cdf545', '#f5c84c', '#ffffff', '#8fe3ff', '#c9b6ff', '#ff8fd0'];

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
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = (el.width = Math.round(innerWidth * dpr));
    const h = (el.height = Math.round(innerHeight * dpr));
    const parts = Array.from({ length: count }, () => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
      const speed = (7 + Math.random() * 10) * dpr;
      return {
        x: origin.x * w,
        y: origin.y * h,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: (5 + Math.random() * 6) * dpr,
        rot: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.3,
        color: colors[(Math.random() * colors.length) | 0],
        shape: Math.random() < 0.3 ? 'circle' : 'rect',
      };
    });
    const t0 = performance.now();
    let raf = 0;
    const frame = now => {
      const t = (now - t0) / duration;
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.vy += 0.32 * dpr;
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.spin;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - Math.max(0, t - 0.6) / 0.4);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2.4, 0, Math.PI * 2);
          ctx.fill();
        } else ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (t < 1) raf = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, w, h);
    };
  }, [fire]);
  return html`<canvas class="confetti" ref=${canvas} aria-hidden="true"></canvas>`;
}
