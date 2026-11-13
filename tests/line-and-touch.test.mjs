import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../app/core/sim/engine.js';

// First touch: a high or long ball is hard with a man on you and routine with nobody near.
test('first touch: an unpressed receiver takes a high, long ball down far more often', () => {
  const m = new Match(4),
    p = m.players[9];
  const pressed = m.firstTouchChance(p, 1.4, 24, 0.8, true, 0, 0.75),
    free = m.firstTouchChance(p, 1.4, 24, 0, true, 0, 0.75);
  assert.ok(pressed < 0.72, `pressed ${pressed}`);
  assert.ok(free > pressed + 0.2, `free ${free}`);
  // An opponent's ball (an interception) gets no relief, and the key switches it off.
  assert.equal(
    m.firstTouchChance(p, 1.4, 24, 0, false, 0, 0.75),
    (() => {
      m.tuning.gameplay.freeTouch = 0;
      return m.firstTouchChance(p, 1.4, 24, 0, false, 0, 0.75);
    })(),
  );
  const off = m.firstTouchChance(p, 1.4, 24, 0, true, 0, 0.75);
  assert.ok(off < free - 0.2, `without the relief ${off}`);
  // A ball along the ground to feet was routine before and is unchanged.
  m.tuning.gameplay.freeTouch = 0.7;
  const ground = m.firstTouchChance(p, 0.1, 14, 0, true, 0, 0);
  m.tuning.gameplay.freeTouch = 0;
  assert.equal(m.firstTouchChance(p, 0.1, 14, 0, true, 0, 0), ground);
});

function attacking(seed, ballX) {
  const m = new Match(seed);
  for (let i = 0; i < 90; i++) m.step(1 / 60);
  m.teams[0].tactics.mentality = m.teams[1].tactics.mentality = 'balanced';
  m.mode = 'play';
  const carrier = m.activePlayers.find(p => p.team === 0 && p.role === 'CM');
  carrier.x = m.abs(ballX, 0);
  carrier.y = 34;
  m.ball.x = carrier.x;
  m.ball.y = carrier.y;
  m.own(carrier);
  return { m, carrier };
}

test('in possession the back line steps up with play as one line; nobody stays back alone', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const { m, carrier } = attacking(seed, 58);
    // An opponent left up the pitch, in an offside position, and nobody else near.
    for (const q of m.activePlayers)
      if (q.team === 1 && q.role !== 'GK') q.x = m.abs(70 + (q.id % 5) * 3, 0);
    const lurker = m.activePlayers.find(q => q.team === 1 && q.role === 'ST');
    lurker.x = m.abs(14, 0);
    for (const p of m.activePlayers) p.rethinkAt = 0;
    m.plan();
    const backs = m.activePlayers.filter(p => p.team === 0 && p.role === 'CB'),
      lines = backs.map(p => m.rel(p.tx, 0));
    assert.ok(backs.length >= 2);
    assert.ok(Math.max(...lines) - Math.min(...lines) < 1.5, `one line: ${lines}`);
    assert.ok(Math.min(...lines) > 28, `stepped up behind the ball at 58 m: ${lines}`);
    assert.ok(Math.max(...lines) < m.rel(carrier.x, 0) - 10);
    assert.ok(Math.max(...lines) <= 48.5, 'not beyond halfway by this rule');
    const keeper = m.keeper(0);
    assert.ok(m.rel(keeper.tx, 0) > 6 && m.rel(keeper.tx, 0) <= 13, 'the keeper covers behind it');
  }
});

test('hold the line or go with the runner: a judgement on the carrier, the run and the reader', () => {
  const m = new Match(7);
  m.mode = 'play';
  const p = m.activePlayers.find(q => q.team === 0 && q.role === 'CB'),
    q = m.activePlayers.find(r => r.team === 1 && r.role === 'ST'),
    owner = m.activePlayers.find(r => r.team === 1 && r.role === 'CM'),
    dir = m.direction(0),
    c = { t: 0, dir, owner, line: 30, br: 50, hold: 0 };
  // A sound reader, fresh: no lapses.
  for (const key of Object.keys(p.attrs)) p.attrs[key] = 88;
  p.energy = 1;
  const runs = speed => {
    q.vx = -dir * speed; // towards team 0's goal
  };
  // Standing beyond the line (25 m from goal, the line at 30): leave him, he is offside.
  runs(0);
  assert.equal(m.holdsLine(p, q, 25, c), true);
  // Sprinting in behind with the carrier free: go with him.
  runs(7);
  assert.equal(m.holdsLine(p, q, 25, c), false);
  // The same run with the carrier pressed and turned away: step up.
  c.hold = 1.2;
  assert.equal(m.holdsLine(p, q, 25, c), true);
  // Never when he is in front of the line, has the ball, is in the other half, or the
  // line is on the edge of the box.
  assert.equal(m.holdsLine(p, q, 31, c), false);
  assert.equal(m.holdsLine(p, q, 25, { ...c, owner: q }), false);
  assert.equal(m.holdsLine(p, q, 25, { ...c, line: 12 }), false);
  assert.equal(m.holdsLine(p, q, 55, { ...c, line: 60, br: 80 }), false);
  // A poor reader asks for more before he steps, and switched off nobody holds.
  for (const key of Object.keys(p.attrs)) p.attrs[key] = 55;
  c.hold = 0.5;
  let held = 0;
  for (let i = 0; i < 40; i++) {
    m.elapsed += 0.37;
    if (m.holdsLine(p, q, 25, c)) held++;
  }
  assert.equal(held, 0, 'a poor reader drops with the runner at a half chance');
  runs(0);
  held = 0;
  for (let i = 0; i < 200; i++) {
    m.elapsed += 0.37;
    if (m.holdsLine(p, q, 25, c)) held++;
  }
  assert.ok(held > 140 && held < 200, `he mostly leaves a standing man, with lapses (${held}/200)`);
  m.tuning.gameplay.lineAwareness = 0;
  assert.equal(m.holdsLine(p, q, 25, c), false);
});

test('a defender whose man stands offside behind the line stays in the line', () => {
  let holding = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const m = new Match(seed);
    for (let i = 0; i < 90; i++) m.step(1 / 60);
    m.mode = 'play';
    // Team 1 has the ball at 55 m from team 0's goal; one of its forwards stands at 22 m.
    const carrier = m.activePlayers.find(p => p.team === 1 && p.role === 'CM');
    carrier.x = m.abs(55, 0);
    carrier.y = 30;
    m.ball.x = carrier.x;
    m.ball.y = carrier.y;
    m.own(carrier);
    const lurker = m.activePlayers.find(p => p.team === 1 && p.role === 'ST');
    lurker.x = m.abs(16, 0);
    lurker.y = 34;
    lurker.vx = lurker.vy = 0;
    for (const p of m.activePlayers) {
      if (p.team === 0) for (const key of Object.keys(p.attrs)) p.attrs[key] = 88;
      p.rethinkAt = 0;
    }
    m.plan();
    const marker = m.activePlayers.find(p => p.team === 0 && p.markId === lurker.id);
    if (!marker || m.formation(marker)[0] >= 30) continue;
    if (marker.action === 'Holding the line') {
      holding++;
      assert.ok(m.rel(marker.tx, 0) > 20, 'he stays up with the line');
    }
  }
  assert.ok(holding >= 3, `${holding} of 6 hold`);
});
