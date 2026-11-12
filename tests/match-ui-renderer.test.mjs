import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../app/core/sim/engine.js';
import {
  WORLD,
  makeTransform,
  fullView,
  toWorld,
  sx,
  sy,
} from '../app/ui/screens/match/renderer/geometry.js';
import { ActionCamera, CAMERA_ZOOM } from '../app/ui/screens/match/renderer/camera.js';
import {
  draw,
  tokenRadius,
  ballRadius,
  createRenderState,
  resetRenderState,
} from '../app/ui/screens/match/renderer/draw.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const PHONE = [780, 1174, 'portrait'];
const DESKTOP = [942, 650, 'landscape'];

test('transforms letterbox the pitch, rotate it in portrait and reuse the out object', () => {
  const out = {};
  const t = makeTransform({ width: 1138, height: 756 }, out);
  assert.equal(t, out);
  assert.ok(near(t.s, 10));
  assert.ok(near(sx(t, WORLD.x0, WORLD.y0), 0) && near(sy(t, WORLD.x0, WORLD.y0), 0));
  assert.ok(near(sx(t, WORLD.x1, WORLD.y1), 1138, 1e-3));
  const p = makeTransform({ width: 756, height: 1138, orientation: 'portrait' }, out);
  assert.equal(p, out);
  // x = 105 is at the top, the left wing (y = 0) on screen-left
  assert.ok(sy(p, 105, 34) < sy(p, 0, 34));
  assert.ok(sx(p, 50, 0) < sx(p, 50, 68));
  const w = toWorld(p, sx(p, 30, 20), sy(p, 30, 20));
  assert.ok(near(w.x, 30, 1e-6) && near(w.y, 20, 1e-6));
});

test('fullView is the world grown to the canvas aspect', () => {
  for (const [width, height, orientation] of [PHONE, DESKTOP, [1688, 516, 'landscape']]) {
    const v = fullView(width, height, orientation);
    const ex = v.x1 - v.x0,
      ey = v.y1 - v.y0;
    assert.ok(v.x0 <= WORLD.x0 + 1e-9 && v.x1 >= WORLD.x1 - 1e-9);
    assert.ok(v.y0 <= WORLD.y0 + 1e-9 && v.y1 >= WORLD.y1 - 1e-9);
    const aspect = orientation === 'portrait' ? ey / ex : ex / ey;
    assert.ok(near(aspect, width / height, 1e-9), `${orientation} aspect`);
    // The same transform as the letterboxed world
    const a = makeTransform({ width, height, orientation, camera: v }),
      b = makeTransform({ width, height, orientation });
    for (const k of ['s', 'a', 'b', 'c', 'd', 'e', 'f']) assert.ok(near(a[k], b[k], 1e-6), k);
  }
});

test('the camera shows the whole pitch in wide mode and after reset', () => {
  const m = new Match(7, 180);
  const cam = new ActionCamera();
  cam.resize(...DESKTOP);
  for (let i = 0; i < 30; i++) cam.update(1 / 60, m, 'wide');
  assert.equal(cam.zoomed, false);
  assert.equal(cam.zoom, 1);
  assert.ok(cam.settled);
  const full = fullView(...DESKTOP);
  for (const k of ['x0', 'x1', 'y0', 'y1']) assert.ok(near(cam.rect[k], full[k], 1e-9));
});

test('the follow camera keeps the ball in frame, inside the pitch, at a moderate zoom', () => {
  for (const size of [PHONE, DESKTOP]) {
    const m = new Match(11, 180);
    const cam = new ActionCamera();
    cam.resize(...size);
    let zoomed = 0,
      last = null;
    for (let i = 0; i < 4200; i++) {
      m.step(1 / 60);
      const b = m.ball;
      // A restart that places the ball elsewhere is a cut (the controller snaps the camera)
      if (last && Math.hypot(b.x - last.x, b.y - last.y) > 4) cam.snap();
      last = { x: b.x, y: b.y };
      const r = cam.update(1 / 60, m, 'follow', CAMERA_ZOOM.follow);
      assert.ok(cam.zoom >= 1 && cam.zoom <= CAMERA_ZOOM.follow * 1.45 + 1e-9, `zoom ${cam.zoom}`);
      if (!cam.zoomed) continue;
      zoomed++;
      assert.ok(
        b.x >= r.x0 && b.x <= r.x1 && b.y >= r.y0 && b.y <= r.y1,
        `ball (${b.x.toFixed(1)}, ${b.y.toFixed(1)}) left the frame at step ${i}`,
      );
      assert.ok(r.x0 >= WORLD.x0 - 1e-6 && r.x1 <= WORLD.x1 + 1e-6, 'view inside the surround');
    }
    assert.ok(zoomed > 2500, `zoomed for ${zoomed} of 4200 steps`);
  }
});

test('the camera is presentation only: the match plays out the same with it', () => {
  const a = new Match(5, 180),
    b = new Match(5, 180);
  const cam = new ActionCamera();
  cam.resize(...PHONE);
  for (let i = 0; i < 1500; i++) {
    a.step(1 / 60);
    b.step(1 / 60);
    cam.update(1 / 60, b, 'follow', CAMERA_ZOOM.replay);
  }
  assert.deepEqual(
    b.players.map(p => [p.x, p.y]),
    a.players.map(p => [p.x, p.y]),
  );
  assert.deepEqual({ ...b.ball }, { ...a.ball });
  assert.equal(b.eventId, a.eventId);
});

test('snap jumps to the target; a penalty is framed with the spot, the taker and the goal', () => {
  const m = new Match(3, 180);
  m.mode = 'restart';
  m.restart = { type: 'Penalty', team: 0, x: 94, y: 34, timer: 2, taker: 9 };
  for (const size of [PHONE, DESKTOP]) {
    const cam = new ActionCamera();
    cam.resize(...size);
    cam.update(1 / 60, m, 'wide');
    cam.snap();
    const r = cam.update(1 / 60, m, 'follow');
    assert.ok(cam.zoomed && cam.settled);
    assert.ok(r.x0 < 94 - 4 && r.x1 >= 105 + 2, 'the run-up, the spot and the net');
    assert.ok(r.y0 < 34 - 3.66 && r.y1 > 34 + 3.66, 'both posts');
    // Eased, not cut, without a snap
    const before = cam.zoom;
    cam.update(1 / 60, m, 'wide');
    assert.ok(cam.zoom < before && cam.zoom > 1);
  }
});

/** A 2D context stand-in that records text and lets everything else through. */
function stubContext() {
  const texts = [];
  const ctx = new Proxy(
    { texts },
    {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'fillText') return text => texts.push(text);
        if (key === 'measureText') return text => ({ width: String(text).length * 6 });
        return () => {};
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    },
  );
  return ctx;
}

test('the renderer labels only the players who matter and shrinks tokens in a crowd', () => {
  const m = new Match(7, 180);
  for (let i = 0; i < 240; i++) m.step(1 / 60);
  const [width, height, orientation] = PHONE;
  const view = { width, height, dpr: 2, orientation, pitch: false };
  const state = { match: m, kits: [], fx: createRenderState() };
  const ctx = stubContext();
  const t = draw(ctx, view, state);
  const names = new Set(m.players.map(p => p.name));
  const labelled = ctx.texts.filter(text => names.has(text));
  assert.ok(labelled.length <= 2, `labels: ${labelled.join(', ')}`);
  const base = tokenRadius(t, 2);
  assert.ok(ballRadius(t, 2) >= 4 * 2, 'the ball has a minimum size');
  // Pack ten players into the six-yard box: they shrink, never below the floor
  const before = m.players.map(p => [p.x, p.y]);
  m.players.slice(1, 11).forEach((p, i) => {
    p.x = 3 + (i % 5) * 0.9;
    p.y = 32 + Math.floor(i / 5) * 0.9;
  });
  ctx.texts.length = 0;
  draw(ctx, view, state);
  for (let id = 1; id < 11; id++) {
    assert.ok(state.fx.rad[id] < base * 0.8, `token ${id} shrinks`);
    assert.ok(state.fx.rad[id] >= base * 0.66 - 1e-3);
  }
  assert.ok(state.fx.rad[15] > base * 0.9 || m.players[15].sentOff, 'others keep their size');
  // Reading state only
  m.players.slice(1, 11).forEach((p, i) => {
    assert.ok(near(p.x, 3 + (i % 5) * 0.9));
    [p.x, p.y] = before[i + 1];
  });
  // After a goal the scorer is labelled, not the kick-off taker
  m.mode = 'restart';
  m.restart = { type: 'Goal', team: 1, x: 52.5, y: 34, timer: 2, taker: 12 };
  m.ball.owner = null;
  m.ball.kind = 'loose';
  ctx.texts.length = 0;
  draw(ctx, view, { ...state, scorerId: 9 });
  const after = ctx.texts.filter(text => names.has(text));
  assert.deepEqual(after, [m.players[9].name]);
  resetRenderState(state.fx);
  assert.equal(state.fx.trail.count, 0);
});

test('camera preferences: per view, tolerant of broken data', async () => {
  const data = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: k => data.delete(k),
  };
  try {
    const { readCameraPrefs, saveCameraPref, CAMERA_KEY } =
      await import('../app/ui/screens/match/camera-prefs.js');
    assert.deepEqual(readCameraPrefs(), { key: 'action', full: 'wide' });
    assert.deepEqual(saveCameraPref('full', 'action'), { key: 'action', full: 'action' });
    assert.deepEqual(JSON.parse(data.get(CAMERA_KEY)), { key: 'action', full: 'action' });
    assert.deepEqual(saveCameraPref('instant', 'action'), { key: 'action', full: 'action' });
    assert.deepEqual(saveCameraPref('key', 'sideways'), { key: 'action', full: 'action' });
    data.set(CAMERA_KEY, '{"key":"wide","full":7,"other":"action"}');
    assert.deepEqual(readCameraPrefs(), { key: 'wide', full: 'wide' });
    data.set(CAMERA_KEY, 'not json');
    assert.deepEqual(readCameraPrefs(), { key: 'action', full: 'wide' });
  } finally {
    globalThis.localStorage = previous;
  }
});
