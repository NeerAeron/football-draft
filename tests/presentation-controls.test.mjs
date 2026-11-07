import test from 'node:test';
import assert from 'node:assert/strict';
import { bindPitchFullscreen } from '../app/services/fullscreen.js';
import { createDraftReel } from '../app/legacy/draft-reel.js';

const classes = () => {
  const set = new Set();
  return {
    toggle(k, on) {
      if (on) set.add(k);
      else set.delete(k);
    },
    remove(k) {
      set.delete(k);
    },
    contains: k => set.has(k),
  };
};
function fullscreenFixture() {
  const doc = new EventTarget();
  doc.body = { classList: classes() };
  doc.fullscreenElement = null;
  const target = { classList: classes() },
    button = new EventTarget(),
    label = { textContent: '' },
    attrs = {};
  button.querySelector = () => label;
  button.setAttribute = (k, v) => (attrs[k] = v);
  let resized = 0;
  const controller = bindPitchFullscreen({
    target,
    button,
    document: doc,
    onResize: () => resized++,
  });
  return {
    doc,
    target,
    button,
    label,
    attrs,
    controller,
    get resized() {
      return resized;
    },
  };
}
test('fullscreen enters and exits natively, updating controls on browser Escape', async () => {
  const f = fullscreenFixture();
  f.target.requestFullscreen = async () => {
    f.doc.fullscreenElement = f.target;
    f.doc.dispatchEvent(new Event('fullscreenchange'));
  };
  f.doc.exitFullscreen = async () => {
    f.doc.fullscreenElement = null;
    f.doc.dispatchEvent(new Event('fullscreenchange'));
  };
  await f.controller.toggle();
  assert.ok(f.controller.active);
  assert.equal(f.attrs['aria-pressed'], 'true');
  assert.ok(f.target.classList.contains('pitch-expanded'));
  await f.doc.exitFullscreen();
  assert.equal(f.controller.active, false);
  assert.equal(f.attrs['aria-pressed'], 'false');
  await f.controller.toggle();
  await f.controller.toggle();
  assert.equal(f.doc.fullscreenElement, null);
  assert.ok(f.resized >= 5);
});
test('blocked fullscreen fills the viewport and Escape restores it', async () => {
  const f = fullscreenFixture();
  f.target.requestFullscreen = async () => {
    throw Error('Not allowed in embed');
  };
  await f.controller.toggle();
  assert.ok(f.controller.active);
  assert.ok(f.doc.body.classList.contains('field-fullscreen'));
  assert.ok(f.doc.body.classList.contains('tv-mode'));
  const escape = new Event('keydown', { cancelable: true });
  escape.key = 'Escape';
  f.doc.dispatchEvent(escape);
  assert.ok(escape.defaultPrevented);
  assert.equal(f.controller.active, false);
  assert.equal(f.label.textContent, 'TV mode');
});
test('rapid fullscreen clicks cannot launch overlapping requests', async () => {
  const f = fullscreenFixture();
  let resolve,
    calls = 0;
  f.target.requestFullscreen = () => {
    calls++;
    return new Promise(
      done =>
        (resolve = () => {
          f.doc.fullscreenElement = f.target;
          done();
        }),
    );
  };
  const entering = f.controller.toggle();
  await f.controller.toggle();
  assert.equal(calls, 1);
  resolve();
  await entering;
  assert.ok(f.controller.active);
});
function reelFixture(t) {
  const previous = globalThis.ResizeObserver;
  let resize;
  globalThis.ResizeObserver = class {
    constructor(fn) {
      resize = fn;
    }
    observe() {}
  };
  t.after(() => {
    globalThis.ResizeObserver = previous;
  });
  let html = '',
    track,
    animation;
  const container = {
    clientWidth: 420,
    classList: classes(),
    style: { setProperty() {} },
    animate() {},
    replaceChildren() {
      html = '';
      track = null;
    },
    get innerHTML() {
      return html;
    },
    set innerHTML(v) {
      html = v;
      track = {
        style: {},
        animate(frames, options) {
          let resolve, reject;
          const finished = new Promise((a, b) => {
            resolve = a;
            reject = b;
          });
          animation = {
            frames,
            options,
            finished,
            finishCalls: 0,
            finish() {
              this.finishCalls++;
              resolve();
            },
            cancel() {
              reject(Error('cancelled'));
            },
          };
          return animation;
        },
      };
    },
    get firstElementChild() {
      return track;
    },
  };
  const reel = createDraftReel(container, item => item.id);
  return {
    container,
    reel,
    resize: () => resize(),
    get animation() {
      return animation;
    },
  };
}
const options = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
test('spinner ticks follow visible cell changes and stop on cancel or reduced motion', async t => {
  const priorRAF = globalThis.requestAnimationFrame,
    priorCancel = globalThis.cancelAnimationFrame,
    frames = new Map();
  let next = 0,
    ticks = 0,
    progress = 0;
  globalThis.requestAnimationFrame = fn => {
    frames.set(++next, fn);
    return next;
  };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  t.after(() => {
    globalThis.requestAnimationFrame = priorRAF;
    globalThis.cancelAnimationFrame = priorCancel;
  });
  const f = reelFixture(t),
    done = f.reel.spin(options, options[2], { onTick: () => ticks++ });
  f.animation.effect = { getComputedTiming: () => ({ progress }) };
  const frame = () => {
    const [id, fn] = frames.entries().next().value;
    frames.delete(id);
    fn();
  };
  frame();
  assert.equal(ticks, 0);
  progress = 0.06;
  frame();
  assert.equal(ticks, 1);
  frame();
  assert.equal(ticks, 1);
  progress = 0.8;
  frame();
  assert.equal(ticks, 2, 'skipped cells do not cause an audio burst');
  f.reel.cancel();
  assert.equal(await done, false);
  assert.equal(frames.size, 0);
  await f.reel.spin(options, options[0], { reducedMotion: true, onTick: () => ticks++ });
  assert.equal(frames.size, 0);
  assert.equal(ticks, 2);
});
test('reel lands on the preselected result; initial layout notification does not skip animation', async t => {
  const f = reelFixture(t),
    done = f.reel.spin(options, options[2]);
  f.resize();
  assert.equal(f.animation.finishCalls, 0);
  f.animation.finish();
  assert.equal(await done, true);
  assert.match(f.container.innerHTML, /class="reel-item chosen">c<\/div>/);
  assert.ok(f.container.classList.contains('settled'));
});
test('leaving a reel cancels the old result; reduced motion displays the new result immediately', async t => {
  const f = reelFixture(t),
    done = f.reel.spin(options, options[2]);
  f.reel.cancel();
  assert.equal(await done, false);
  assert.equal(await f.reel.spin(options, options[0], { reducedMotion: true }), true);
  assert.match(f.container.innerHTML, /class="reel-item chosen">a<\/div>/);
});
test('resizing mid-spin settles at the correct result in the new layout', async t => {
  const f = reelFixture(t),
    done = f.reel.spin(options, options[3]);
  f.container.clientWidth = 300;
  f.resize();
  assert.equal(await done, true);
  assert.equal(f.animation.finishCalls, 1);
  assert.match(f.container.innerHTML, /class="reel-item chosen">d<\/div>/);
});
test('a single allowed landing still animates a varied ordinary reel without revealing its restriction', async t => {
  const f = reelFixture(t),
    pool = Array.from({ length: 12 }, (_, i) => ({ id: 'club-' + i })),
    allowed = [pool[5]],
    before = JSON.stringify(pool);
  const done = f.reel.spin(pool, allowed[0]);
  assert.ok(f.animation, 'one actual outcome must not shorten the animation');
  for (const item of pool)
    assert.ok(f.container.innerHTML.includes('>' + item.id + '</div>'), item.id);
  assert.equal(JSON.stringify(pool), before);
  f.animation.finish();
  assert.equal(await done, true);
  assert.match(f.container.innerHTML, /class="reel-item chosen">club-5<\/div>/);
});
test('the passing reel mix does not depend on which result was chosen', async t => {
  const prior = globalThis.ResizeObserver,
    a = reelFixture(t),
    b = reelFixture(t);
  t.after(() => {
    globalThis.ResizeObserver = prior;
  });
  const pool = Array.from({ length: 24 }, (_, i) => ({ id: 'league-' + i }));
  const first = a.reel.spin(pool, pool[0]),
    second = b.reel.spin(pool, pool[20]);
  const visibleMix = f =>
    [...f.container.innerHTML.matchAll(/>(league-\d+)<\/div>/g)].map(m => m[1]).slice(0, 18);
  assert.deepEqual(visibleMix(a), visibleMix(b));
  a.animation.finish();
  b.animation.finish();
  assert.equal(await first, true);
  assert.equal(await second, true);
});
