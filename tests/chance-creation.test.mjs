import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../app/core/sim/engine.js';

// A defender (team 1) marks an attacker near his own goal while the ball is
// away on the far side: the situation where markers ball-watch.
// Lapses are an optional tuning knob (gameplay.markingLapses, off by default): these scenes
// switch it on unless told otherwise.
function markingScene({ awareness = 60, lapses = 1 } = {}) {
  const m = new Match(31, 300);
  m.mode = 'play';
  if (lapses !== null) m.tuning.gameplay.markingLapses = lapses;
  const d = m.players[11 + 2],
    a = m.players[9];
  d.attrs.awareness = awareness;
  d.attrs.composure = awareness;
  d.syncCache?.();
  Object.assign(a, { x: m.abs(96, 0), y: 30 });
  Object.assign(d, { x: m.abs(97.5, 0), y: 30.5 });
  Object.assign(m.ball, { x: m.abs(86, 0), y: 58, owner: null, kind: 'loose' });
  return { m, d, a, qr: m.rel(a.x, d.team) };
}
const lapseShare = scene => {
  const { m, d, a, qr } = scene;
  let n = 0;
  for (let i = 0; i < 600; i++) {
    m.elapsed = i * 0.1;
    if (m.markLapse(d, a, qr, 0)) n++;
  }
  return n / 600;
};

test('poor readers ball-watch and lose their runner; elite markers rarely do', () => {
  const poor = lapseShare(markingScene({ awareness: 58 })),
    good = lapseShare(markingScene({ awareness: 80 })),
    elite = lapseShare(markingScene({ awareness: 92 }));
  assert.ok(poor > 0.3 && poor <= 0.55, `poor ${poor}`);
  assert.ok(good < poor * 0.75, `good ${good}`);
  assert.ok(elite < good / 2, `elite ${elite}`);
  assert.equal(lapseShare(markingScene({ awareness: 99 })), 0);
  assert.equal(lapseShare(markingScene({ awareness: 58, lapses: 0 })), 0);
  // Deterministic and RNG-free: the same scene gives the same lapses, no draws.
  const scene = markingScene({ awareness: 58 }),
    rng = scene.m.rng;
  assert.equal(lapseShare(scene), poor);
  assert.equal(scene.m.rng, rng);
  // Never when his runner has the ball or the ball is close.
  const near = markingScene({ awareness: 58 });
  Object.assign(near.m.ball, { x: near.a.x + 2, y: near.a.y });
  assert.equal(lapseShare(near), 0);
});

test('by default nobody ball-watches, and a marker in his own box is touch-tight', () => {
  // The default tuning: no lapses at all, whatever the marker's reading of the game.
  assert.equal(lapseShare(markingScene({ awareness: 45, lapses: null })), 0);
  const { m, d, a } = markingScene({ awareness: 70, lapses: null });
  const c = { t: 1, tac: m.settings(1), br: m.rel(m.ball.x, 1), marks: new Map([[d.id, a]]) };
  c.coordination = 0;
  m.planDefender(d, c, 20, 30);
  assert.notEqual(d.action, 'Ball-watching');
  // His spot is goal-side of the attacker and within a stride and a half of him…
  const gap = m.rel(a.x, 1) - m.rel(d.tx, 1);
  assert.ok(gap > 0.4 && gap < 1.7, `goal-side gap ${gap}`);
  assert.ok(Math.abs(d.ty - a.y) < 1.5);
  // …while the same attacker 40 m from goal is given more room.
  const far = markingScene({ awareness: 70, lapses: null });
  Object.assign(far.a, { x: far.m.abs(65, 0), y: 30 });
  Object.assign(far.d, { x: far.m.abs(68, 0), y: 30.5 });
  const loose = far.m.markingPoint(1, far.a, far.d);
  assert.ok(far.m.rel(far.a.x, 1) - far.m.rel(loose.x, 1) > gap + 0.3);
});

test('a lapsing marker lets the runner go instead of staying goal-side', () => {
  const { m, d, a, qr } = markingScene({ awareness: 58 });
  m.elapsed = 0;
  for (let i = 0; i < 200 && !m.markLapse(d, a, qr, 0); i++) m.elapsed += 0.1;
  assert.ok(m.markLapse(d, a, qr, 0), 'a poor marker lapses within 20 s');
  const c = { t: 1, tac: m.settings(1), br: m.rel(m.ball.x, 1), marks: new Map([[d.id, a]]) };
  c.coordination = 0;
  m.planDefender(d, c, 20, 30);
  assert.equal(d.action, 'Ball-watching');
});

// Team 0 in possession around halfway, a striker level with the second-last defender.
function runScene(k = 1) {
  const m = new Match(47, 300);
  m.mode = 'play';
  m.tuning.gameplay.runsInBehind = k;
  for (const p of m.players)
    Object.assign(p, {
      x: m.abs(p.team ? 74 + (p.slot % 4) : 40 + p.slot, 0),
      y: 6 + p.slot * 5.5,
      vx: 0,
      vy: 0,
    });
  m.players[11].x = m.abs(101, 0);
  const carrier = m.players[6],
    striker = m.players[9];
  Object.assign(carrier, { x: m.abs(52, 0), y: 34 });
  Object.assign(striker, { x: m.abs(73.5, 0), y: 30 });
  m.own(carrier);
  carrier.think = 0.3;
  return { m, carrier, striker };
}

test('a forward level with the line times a run in behind and cues the passer', () => {
  const { m, carrier, striker } = runScene();
  const oppLine = m.activePlayers
    .filter(q => q.team === 1)
    .map(q => m.rel(q.x, 0))
    .sort((a, b) => b - a)[1];
  let started = null;
  for (let i = 0; i < 200 && !started; i++) {
    m.elapsed = 5 + i * 0.05;
    striker.rethinkAt = 0;
    m.plan();
    if (striker.action === 'Running in behind') started = m.elapsed;
  }
  assert.ok(started !== null, 'the run starts');
  assert.ok(m.rel(striker.x, 0) <= oppLine + 0.05, 'from an onside position');
  assert.ok(m.rel(striker.tx, 0) > oppLine + 5, 'into the space behind');
  assert.equal(striker.intent, 'run');
  assert.ok(carrier.think <= 0.06, 'the carrier looks up');
  // Without the setting nobody makes that run.
  const off = runScene(0);
  for (let i = 0; i < 200; i++) {
    off.m.elapsed = 5 + i * 0.05;
    off.striker.rethinkAt = 0;
    off.m.plan();
    assert.notEqual(off.striker.action, 'Running in behind');
  }
});

test('keeper rating matters: keeperRange widens the shot-stopping spread', () => {
  const m = new Match(3, 300),
    g = m.players[11];
  g.tags = [];
  const quality = (gk, range) => {
    m.tuning.gameplay.keeperRange = range;
    g.attrs.goalkeeping = gk;
    return m.keeperQuality(g);
  };
  assert.ok(quality(90, 1) > quality(75, 1) && quality(75, 1) > quality(62, 1));
  assert.ok(Math.abs(quality(80, 1) - quality(80, 1.6)) < 1e-9, 'an 80 keeper is the pivot');
  assert.ok(quality(90, 1.6) - quality(62, 1.6) > (quality(90, 1) - quality(62, 1)) * 1.4);
  assert.ok(quality(40, 2) >= 0.6 && quality(99, 2) <= 1);
});

test('a pressed defender stabs at a fast delivery in his box; the ball usually goes behind', () => {
  const m = new Match(9, 300);
  m.mode = 'play';
  const d = m.players[11 + 2],
    a = m.players[9];
  Object.assign(d, { x: m.abs(97, 0), y: 28 });
  Object.assign(a, { x: m.abs(96, 0), y: 29.5 });
  m.tuning.gameplay.deliveryDeflections = 1;
  const fast = m.deflectChance(d, 18),
    slow = m.deflectChance(d, 10);
  assert.ok(fast > slow && slow > 0);
  assert.equal(m.deflectChance(d, 6), 0, 'a slow ball is controlled');
  a.x = m.abs(80, 0);
  assert.equal(m.deflectChance(d, 18), 0, 'no attacker on him');
  a.x = m.abs(96, 0);
  m.tuning.gameplay.deliveryDeflections = 0;
  assert.equal(m.deflectChance(d, 18), 0);
  // Deflected balls head for the byline far more often than back into play.
  let behind = 0;
  for (let s = 1; s <= 60; s++) {
    const k = new Match(s, 300),
      q = k.players[11 + 2];
    k.mode = 'play';
    Object.assign(q, { x: k.abs(97, 0), y: 28 });
    Object.assign(k.ball, { x: q.x, y: q.y, z: 0.4, vx: 18, vy: 6, vz: 0, kind: 'pass' });
    k.blockCross(q, true);
    if (k.ball.vx * k.direction(q.team) < 0) behind++;
  }
  assert.ok(behind > 30, `behind ${behind}`);
});
