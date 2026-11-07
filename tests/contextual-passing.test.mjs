import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../app/engine.js';
import { DEFAULT_CONFIG, loadConfig, normalizeConfig, saveConfig } from '../app/config.js';

function scene() {
  const m = new Match(27, 300);
  m.mode = 'play';
  m.elapsed = 10;
  for (const p of m.players)
    Object.assign(p, { x: p.team ? 100 : 3, y: 5, vx: 0, vy: 0, stun: 0, cooldown: 0, tags: [] });
  const p = m.players[6],
    r = m.players[7];
  Object.assign(p, { x: 35, y: 34, facing: 0, energy: 1 });
  Object.assign(r, { x: 45, y: 34, energy: 1 });
  r.attrs.control = 75;
  return { m, p, r };
}
test('straight passes to feet are reliable, with errors concentrated in pressure and difficult deliveries', () => {
  const { m, r } = scene();
  Object.assign(m.ball, { kind: 'pass', deliveryDemand: 0 });
  const clean = m.firstTouchChance(r, 0, 17, 0, true),
    pressed = m.firstTouchChance(r, 0, 17, 0.9, true);
  assert.ok(clean > 0.97);
  assert.ok(1 - pressed > (1 - clean) * 5);
  m.ball.deliveryDemand = m.deliveryDemand({ d: 40, delivery: 'through', loft: true });
  const ambitious = m.firstTouchChance(r, 0.4, 22, 0.2, true);
  assert.ok(1 - ambitious > (1 - clean) * 8);
  r.energy = 0.2;
  const tired = m.firstTouchChance(r, 0.4, 22, 0.2, true);
  assert.ok(tired < ambitious);
  r.attrs.control = 95;
  assert.ok(m.firstTouchChance(r, 0.4, 22, 0.2, true) > tired);
  m.ball.deliveryDemand = 0;
  assert.ok(
    m.firstTouchChance(r, 0, 17, 0, true) > 0.96,
    'fatigue does not routinely spoil easy ground receipts',
  );
});

test('a stretching touch is harder than a centered touch, and a small intended-receiver reach does not buff interceptions', () => {
  const { m, p, r } = scene();
  Object.assign(m.ball, { kind: 'pass', kicker: p.id, target: r.id, z: 0, deliveryDemand: 0 });
  assert.ok(
    m.firstTouchChance(r, 0, 17, 0.3, true, 1.1) < m.firstTouchChance(r, 0, 17, 0.3, true, 0),
  );
  r.y = 35.08;
  Object.assign(m.ball, { x: 44.7, y: 34, vx: 16, vy: 0, vz: 0, age: 0.7, owner: null });
  m.rand = () => 0;
  assert.ok(m.collectionReach(r) > 1.08);
  assert.equal(m.collectionReach(m.players[18]), 0.85);
  m.moveBall(1 / 60);
  assert.equal(m.ball.owner, r.id);
});

test('a pass travelling directly toward a player is not a stretching touch at the reach boundary', () => {
  const { m, p, r } = scene();
  Object.assign(m.ball, {
    kind: 'pass',
    kicker: p.id,
    target: r.id,
    x: r.x - 1.25,
    y: r.y,
    z: 0,
    vx: 17,
    vy: 0,
    vz: 0,
    age: 0.7,
    owner: null,
    deliveryDemand: 0,
  });
  const original = m.firstTouchChance;
  let offset;
  m.firstTouchChance = function (...args) {
    offset = args[5];
    return original.apply(this, args);
  };
  m.rand = () => 0;
  m.moveBall(1 / 60);
  assert.equal(m.ball.owner, r.id);
  assert.equal(offset, 0);
});

test('pass scatter responds more strongly to pressure and ambition while retaining player skill', () => {
  const release = ({
    pressure = 0,
    distance = 10,
    delivery = 'pass',
    skill = 75,
    loft = false,
  } = {}) => {
    const { m, p, r } = scene();
    p.attrs.shortPassing = p.attrs.longPassing = p.attrs.crossing = skill;
    m.executionPressure = () => pressure;
    m.noise = () => 1;
    r.x = p.x + distance;
    const aim = { x: r.x, y: r.y };
    m.pass(p, { r, aim, d: distance, delivery, loft });
    return Math.hypot(m.ball.destination.x - aim.x, m.ball.destination.y - aim.y);
  };
  const simple = release(),
    pressed = release({ pressure: 0.9 }),
    through = release({ delivery: 'through' }),
    long = release({ distance: 40, loft: true });
  assert.ok(pressed > simple * 2.5);
  assert.ok(through > simple * 1.5);
  assert.ok(long > simple * 3);
  assert.ok(release({ pressure: 0.9, skill: 90 }) < release({ pressure: 0.9, skill: 60 }));
});

test('an implicitly lofted cross has the same demand and flight as an explicit one', () => {
  const launch = loft => {
    const { m, p, r } = scene();
    m.noise = () => 0;
    m.pass(p, { r, aim: r, d: 10, delivery: 'cross', ...(loft ? { loft: true } : {}) });
    return { demand: m.ball.deliveryDemand, vz: m.ball.vz };
  };
  assert.deepEqual(launch(false), launch(true));
});

test('a fresh receiver can release a safe early pass instead of waiting for another dribble cycle', () => {
  const { m, p, r } = scene();
  m.own(p);
  p.hold = 0.13;
  p.lastReceipt = { at: m.elapsed };
  p.receivedAt = m.elapsed;
  m.openCarry = () => null;
  m.options = () => [
    { r, aim: r, d: 10, delivery: 'pass', chance: 0.9, risk: 0.1, margin: 0.5, score: 3 },
  ];
  m.rand = () => 0;
  m.decide(p);
  assert.equal(m.ball.kind, 'pass');
  assert.equal(m.ball.target, r.id);
});

test('one-touch specialists release earlier than ordinary receivers during normal decision timing', () => {
  const releaseTime = badge => {
    const { m, p, r } = scene();
    p.tags = badge ? ['onetouch'] : [];
    Object.assign(m.ball, { kind: 'pass', kicker: 5, target: p.id });
    m.own(p);
    m.openCarry = () => null;
    m.options = () => [
      { r, aim: r, d: 10, delivery: 'pass', chance: 0.9, risk: 0.1, margin: 0.5, score: 3 },
    ];
    m.rand = () => 0;
    for (let i = 1; i <= 60; i++) {
      p.hold += 1 / 60;
      p.think -= 1 / 60;
      m.elapsed += 1 / 60;
      if (p.think <= 0) m.decide(p);
      if (m.ball.kind === 'pass') return i / 60;
    }
    assert.fail('Receiver failed to release a safe pass');
  };
  assert.ok(releaseTime(true) < releaseTime(false));
  assert.ok(releaseTime(true) < 0.12);
});

test('team character strengthens preferences without changing players abilities or guaranteeing success', () => {
  const { m, p, r } = scene();
  m.own(p);
  m.noise = () => 0;
  const score = (style, identity) => {
    m.teams[0].tactics.style = style;
    m.tuning.gameplay.teamCharacter = identity;
    return m.options(p).find(o => o.r.id === r.id && !o.loft).score;
  };
  const balanced = score('balanced', 1),
    possession = score('possession', 1),
    stronger = score('possession', 1.15);
  assert.ok(stronger > possession);
  assert.equal(score('balanced', 1.15), balanced);
  const skill = p.skill('shortPassing');
  m.tuning.gameplay.teamCharacter = 2;
  assert.equal(p.skill('shortPassing'), skill);
});

test('unchanged reception defaults upgrade once; custom values and explicit replay settings survive', () => {
  const old = structuredClone(DEFAULT_CONFIG);
  old._settingsVersion = 6;
  old.gameplay.receptionError = 0.75;
  old.gameplay.difficultReceptionError = 1.05;
  const prior = globalThis.localStorage;
  let stored = JSON.stringify(old);
  globalThis.localStorage = {
    getItem: () => stored,
    setItem: (k, v) => {
      stored = v;
    },
  };
  try {
    assert.equal(loadConfig().gameplay.receptionError, DEFAULT_CONFIG.gameplay.receptionError);
    assert.equal(
      loadConfig().gameplay.difficultReceptionError,
      DEFAULT_CONFIG.gameplay.difficultReceptionError,
    );
    assert.equal(normalizeConfig(old).gameplay.receptionError, 0.75);
    old.gameplay.receptionError = 0.4;
    old.gameplay.difficultReceptionError = 0.8;
    stored = JSON.stringify(old);
    assert.equal(loadConfig().gameplay.receptionError, 0.4);
    assert.equal(loadConfig().gameplay.difficultReceptionError, 0.8);
    const current = structuredClone(DEFAULT_CONFIG);
    current.gameplay.receptionError = 0.75;
    saveConfig(current);
    assert.equal(loadConfig().gameplay.receptionError, 0.75);
  } finally {
    globalThis.localStorage = prior;
  }
});
