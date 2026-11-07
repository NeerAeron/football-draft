import { CONFIG } from '../core/config/config.js';
// The draw is resolved by Draft; this renderer never changes its RNG or result.
export function createDraftReel(container, renderItem) {
  let animation = null,
    animationWidth = 0,
    track = null,
    index = 1,
    lastKey = '',
    visualSeed = 0x9e3779b9;
  function presentationOrder(items) {
    const order = [...items];
    // Separate animation state: neither the chosen result nor Draft RNG affects
    // the ordinary mix of clubs/leagues moving through the reel.
    for (let i = order.length - 1; i > 0; i--) {
      visualSeed = (Math.imul(1664525, visualSeed) + 1013904223) >>> 0;
      const j = Math.floor((visualSeed / 4294967296) * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  }
  const geometry = () => {
    const width = container.clientWidth || 400,
      cell = Math.min(212, Math.max(112, width * 0.43));
    container.style.setProperty('--reel-cell', `${cell}px`);
    return { width, cell, step: cell + 12 };
  };
  const offset = (i, g) => g.width / 2 - g.cell / 2 - i * g.step;
  function build(items, selected) {
    index = selected;
    container.classList.remove('settled');
    container.innerHTML = `<div class="reel-track">${items.map((item, i) => `<div class="reel-item${i === selected ? ' chosen' : ''}">${renderItem(item)}</div>`).join('')}</div><div class="reel-marker"></div>`;
    track = container.firstElementChild;
    const g = geometry();
    track.style.transform = `translate3d(${offset(index, g)}px,0,0)`;
    return g;
  }
  function show(items, result) {
    const key = items.map(o => o.id).join(',') + ':' + (result?.id || '');
    if (animation || key === lastKey) return;
    lastKey = key;
    if (!items.length) {
      container.replaceChildren();
      track = null;
      return;
    }
    const at = Math.max(
      0,
      items.findIndex(o => o.id === result?.id),
    );
    build(
      [-1, 0, 1].map(n => items[(at + n + items.length) % items.length]),
      1,
    );
    container.classList.toggle('settled', !!result);
  }
  async function spin(items, result, { reducedMotion = false, onTick = null } = {}) {
    cancel();
    if (reducedMotion || items.length < 2 || typeof container.animate !== 'function') {
      show(items, result);
      return true;
    }
    const at = items.findIndex(o => o.id === result.id),
      landing = 19,
      order = presentationOrder(items);
    const strip = Array.from({ length: landing + 2 }, (_, i) => order[i % order.length]);
    for (const delta of [-1, 0, 1])
      strip[landing + delta] = items[(at + delta + items.length) % items.length];
    const g = build(strip, landing),
      from = offset(1, g),
      to = offset(landing, g);
    const run = track.animate(
      [{ transform: `translate3d(${from}px,0,0)` }, { transform: `translate3d(${to}px,0,0)` }],
      {
        duration: CONFIG.display.spinnerDuration,
        easing: 'cubic-bezier(.12,.72,.15,1)',
        fill: 'forwards',
      },
    );
    animation = run;
    animationWidth = g.width;
    let soundFrame = null,
      lastCell = 1;
    const tick = () => {
      if (animation !== run) return;
      const progress = run.effect?.getComputedTiming().progress;
      if (progress != null) {
        const cell = Math.round(1 + (landing - 1) * progress);
        if (cell > lastCell) {
          lastCell = cell;
          onTick();
        }
      }
      soundFrame = requestAnimationFrame(tick);
    };
    if (onTick && typeof requestAnimationFrame === 'function')
      soundFrame = requestAnimationFrame(tick);
    try {
      await run.finished;
    } catch {
      return false;
    } finally {
      if (soundFrame !== null) cancelAnimationFrame(soundFrame);
      if (animation === run) animation = null;
    }
    run.cancel();
    show(items, result);
    return true;
  }
  function cancel() {
    if (animation) {
      const run = animation;
      animation = null;
      run.cancel();
    }
    lastKey = '';
  }
  new ResizeObserver(() => {
    if (animation) {
      if (Math.abs(container.clientWidth - animationWidth) > 1) animation.finish();
      return;
    }
    if (track) {
      const g = geometry();
      track.style.transform = `translate3d(${offset(index, g)}px,0,0)`;
    }
  }).observe(container);
  return { show, spin, cancel };
}
