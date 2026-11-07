import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../app/engine.js';
import {
  DEFAULT_CONFIG,
  CONFIG_FIELDS,
  normalizeConfig,
  loadConfig,
  saveConfig,
} from '../app/config.js';

function scene() {
  const m = new Match(721, 300);
  m.mode = 'play';
  for (const p of m.players) {
    p.x = p.team ? 98 : 5;
    p.y = 5;
    p.vx = p.vy = 0;
    p.cooldown = 0;
    p.tags = [];
  }
  const p = m.players[6],
    r = m.players[7];
  Object.assign(p, { x: 35, y: 34 });
  Object.assign(r, { x: 45, y: 34 });
  r.attrs.control = 80;
  return { m, p, r };
}

test('routine teammate reception improves while quality, fatigue and difficult balls still matter', () => {
  const { m, r } = scene();
  r.attrs.control = 70;
  const fresh = m.firstTouchChance(r, 0, 16, 0, true);
  assert.ok(fresh > 0.85 && fresh < 0.99);
  r.energy = 0.15;
  const tired = m.firstTouchChance(r, 0, 16, 0, true);
  assert.ok(tired > m.firstTouchChance(r, 0, 16, 0, false) && tired < fresh);
  r.attrs.control = 90;
  assert.ok(m.firstTouchChance(r, 0, 16, 0, true) > tired);
  assert.ok(m.firstTouchChance(r, 0, 16, 1.2, true) < m.firstTouchChance(r, 0, 16, 0, true));
  assert.ok(m.firstTouchChance(r, 1.7, 25, 1, true) < m.firstTouchChance(r, 0, 16, 0, true) - 0.2);
  r.energy = 1;
  r.attrs.control = 70;
  const amplified = m.firstTouchChance(r, 0, 16, 0, false);
  m.tuning.gameplay.controlQuality = 0;
  assert.ok(
    Math.abs(m.firstTouchChance(r, 0, 16, 0, false) - (0.66 + r.skill('control') * 0.0031)) < 1e-9,
    'zero added stat influence retains the original loose-ball formula',
  );
  assert.ok(
    amplified < m.firstTouchChance(r, 0, 16, 0, false),
    'below-reference control now has a greater effect on loose touches',
  );
});

test('a low pass near the intended receiver is collectable without enlarging defensive reach', () => {
  const { m, p, r } = scene(),
    q = m.players[18];
  r.y = 34.98;
  q.x = r.x;
  q.y = 50;
  m.rand = () => 0;
  Object.assign(m.ball, {
    x: 44.7,
    y: 34,
    z: 0,
    vx: 16,
    vy: 0,
    vz: 0,
    kind: 'pass',
    owner: null,
    kicker: p.id,
    target: r.id,
    lastTouch: 0,
    age: 0.7,
    offsideState: null,
    restartTaker: null,
  });
  assert.ok(m.collectionReach(r) > 0.98);
  assert.equal(m.collectionReach(q), 0.85);
  m.moveBall(1 / 60);
  assert.equal(m.ball.owner, r.id);
  assert.equal(m.stats[0].completed, 1);
  Object.assign(m.ball, { kind: 'loose', owner: null, vx: 0, vy: 0 });
  assert.equal(m.collectionReach(r), 0.95);
  m.ball.vx = 16;
  assert.equal(m.collectionReach(r), 0.85, 'fast loose balls retain the usual collection radius');
});

test('receivers leave stale runs immediately and keep following a pass despite rethink delay', () => {
  const { m, p, r } = scene();
  m.noise = () => 0;
  r.aim(80, 64, 'run', 'Running');
  r.rethinkAt = 100;
  m.pass(p, { r, aim: { x: 46, y: 33 }, d: 11 });
  assert.equal(r.intent, 'receive');
  assert.equal(r.tx, 46);
  assert.equal(r.ty, 33);
  assert.equal(r.rethinkAt, 0);
  r.rethinkAt = 100;
  r.aim(80, 64, 'run', 'Running');
  m.plan();
  assert.equal(r.intent, 'receive');
  assert.ok(r.tx < 50);
});

test('a failed reception gives opponents a recovery window, while control and pressure affect its length', () => {
  const miss = (control, pressed = false, teammate = true) => {
    const { m, p, r } = scene();
    r.attrs.control = control;
    m.rand = () => 0.999999;
    if (pressed) {
      const q = m.players[18];
      q.x = r.x + 2;
      q.y = r.y;
    }
    Object.assign(m.ball, {
      x: 44.7,
      y: 34,
      z: 0,
      vx: 16,
      vy: 0,
      vz: 0,
      kind: teammate ? 'pass' : 'loose',
      owner: null,
      kicker: p.id,
      target: r.id,
      lastTouch: 0,
      age: 0.7,
      offsideState: null,
      restartTaker: null,
    });
    m.moveBall(1 / 60);
    assert.equal(m.ball.owner, null);
    assert.equal(r.stats.miscontrols, 1);
    assert.equal(r.stun, 0, 'A failed touch must not freeze movement');
    if (teammate) assert.equal(r.animation.type, 'stumble');
    return r.cooldown;
  };
  assert.ok(miss(50) > miss(90));
  assert.ok(miss(70, true) > miss(70));
  assert.equal(miss(70, false, false), 0.2);
});

test('better technical passing is harder to read, without granting automatic completion', () => {
  const { m, p, r } = scene();
  m.noise = () => 0;
  p.attrs.shortPassing = 55;
  p.attrs.vision = 55;
  m.pass(p, { r, aim: r, d: 10 });
  const ordinary = m.ball.passCraft;
  p.attrs.shortPassing = 90;
  p.attrs.vision = 90;
  m.pass(p, { r, aim: r, d: 10 });
  assert.ok(m.ball.passCraft > ordinary + 30);
  assert.equal(m.ball.owner, null);
  assert.equal(m.stats[0].completed, 0);
});

test('composed first touches help shield possession, with strong defenders still more effective', () => {
  const { m, p } = scene(),
    q = m.players[18];
  q.x = p.x + 1;
  q.y = p.y;
  p.facing = 0;
  m.ball.x = p.x + 0.4;
  m.ball.y = p.y;
  p.attrs.control = p.attrs.composure = 65;
  const unsteady = m.challengeModel(p, q).win;
  p.attrs.control = p.attrs.composure = 90;
  const composed = m.challengeModel(p, q).win;
  assert.ok(composed < unsteady);
  q.attrs.defending = 99;
  assert.ok(m.challengeModel(p, q).win > composed);
});

test('reception settings roundtrip below .5 and saved defaults upgrade without changing custom values', () => {
  assert.deepEqual(normalizeConfig(DEFAULT_CONFIG), DEFAULT_CONFIG);
  for (const key of ['receptionError', 'difficultReceptionError']) {
    const f = CONFIG_FIELDS.find(f => f.path === 'gameplay.' + key);
    assert.ok(f.min <= DEFAULT_CONFIG.gameplay[key]);
  }
  const { m } = scene();
  assert.doesNotThrow(() => m.importConfig(m.exportConfig()));
  const saved = structuredClone(DEFAULT_CONFIG);
  saved._settingsVersion = 3;
  saved.gameplay.tackleSuccess = 1;
  saved.formats[180].saveBoost = -0.6;
  saved.formats[300].saveBoost = -0.37;
  const previous = globalThis.localStorage;
  let stored = JSON.stringify(saved);
  globalThis.localStorage = { getItem: () => stored, setItem: (k, v) => (stored = v) };
  try {
    assert.equal(loadConfig().gameplay.tackleSuccess, DEFAULT_CONFIG.gameplay.tackleSuccess);
    assert.equal(normalizeConfig(saved).gameplay.tackleSuccess, 1);
    assert.equal(loadConfig().formats[180].saveBoost, DEFAULT_CONFIG.formats[180].saveBoost);
    assert.equal(loadConfig().formats[300].saveBoost, DEFAULT_CONFIG.formats[300].saveBoost);
    assert.equal(normalizeConfig(saved).formats[180].saveBoost, -0.6);
    saved.gameplay.tackleSuccess = 1.15;
    stored = JSON.stringify(saved);
    assert.equal(loadConfig().gameplay.tackleSuccess, 1.15);
    saved.gameplay.receptionError = 0.2;
    saveConfig(saved);
    assert.equal(loadConfig().gameplay.receptionError, 0.2);
    saved._settingsVersion = 4;
    saved.gameplay.receptionError = 0.18;
    saved.gameplay.difficultReceptionError = 0.55;
    saved.gameplay.tackleSuccess = 0.94;
    saved.gameplay.shotFrequency = 1.24;
    saved.formats[180].saveBoost = -0.5;
    saved.formats[300].saveBoost = -0.27;
    stored = JSON.stringify(saved);
    for (const key of [
      'receptionError',
      'difficultReceptionError',
      'tackleSuccess',
      'shotFrequency',
    ])
      assert.equal(loadConfig().gameplay[key], DEFAULT_CONFIG.gameplay[key]);
    for (const duration of [180, 300])
      assert.equal(
        loadConfig().formats[duration].saveBoost,
        DEFAULT_CONFIG.formats[duration].saveBoost,
      );
    assert.equal(
      normalizeConfig(saved).gameplay.receptionError,
      0.18,
      'Explicit replay settings remain reproducible',
    );
    saved.gameplay.receptionError = 0.4;
    saved.gameplay.difficultReceptionError = 0.8;
    saved.gameplay.tackleSuccess = 1.15;
    stored = JSON.stringify(saved);
    assert.equal(loadConfig().gameplay.receptionError, 0.4);
    assert.equal(loadConfig().gameplay.difficultReceptionError, 0.8);
    assert.equal(loadConfig().gameplay.tackleSuccess, 1.15);
  } finally {
    globalThis.localStorage = previous;
  }
});
