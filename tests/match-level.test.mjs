// The level of the match (docs/calibration.md, Phase 9): shots scatter more and keepers hold
// more the better the two line-ups are, so the number of goals does not follow the ratings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, GOAL } from '../app/core/sim/engine.js';

const lift = (m, team, points) => {
  for (const p of m.players)
    if (p.team === team)
      for (const key of Object.keys(p.attrs)) p.attrs[key] = Math.min(99, p.attrs[key] + points);
};

test('the level is read at kick-off: mean overall above 78, plus the gap between the sides', () => {
  const base = new Match(5).kickoffLevel();
  const both = new Match(5);
  lift(both, 0, 8);
  lift(both, 1, 8);
  assert.ok(both.kickoffLevel() > base + 5, 'two better sides: a higher level');
  const one = new Match(5);
  lift(one, 0, 8);
  const mean = (base + both.kickoffLevel()) / 2;
  assert.ok(one.kickoffLevel() > mean + 2, 'a mismatch counts as a higher level still');
  one.tuning.gameplay.levelGap = 0;
  assert.ok(Math.abs(one.kickoffLevel() - mean) < 1, 'without levelGap: just the mean');
  // Set once, at the first step; never moved by what happens later.
  const m = new Match(5);
  assert.equal(m.level, null);
  m.step(1 / 60);
  const level = m.level;
  assert.equal(level, new Match(5).kickoffLevel());
  lift(m, 0, 10);
  for (let i = 0; i < 30; i++) m.step(1 / 60);
  assert.equal(m.level, level);
});

test('a higher level scatters the same shot more; levelScatter 0 switches it off', () => {
  const onTarget = (level, scatter = null) => {
    let n = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const m = new Match(7, 180),
        p = m.players[9];
      if (scatter !== null) m.tuning.gameplay.levelScatter = scatter;
      m.level = level;
      m.mode = 'play';
      for (const q of m.players)
        if (q !== p && q.role !== 'GK') Object.assign(q, { x: 20 + q.slot, y: 60 });
      Object.assign(p, { x: 83, y: 30, vx: 0, vy: 0, energy: 1 });
      Object.assign(m.ball, { x: 83, y: 30, owner: p.id, kind: 'dribble' });
      m.rng = seed * 7919;
      m.shoot(p);
      const y = m.ball.y + (m.ball.vy / m.ball.vx) * (105 - m.ball.x);
      if (Math.abs(y - 34) < GOAL / 2) n++;
    }
    return n;
  };
  const low = onTarget(-8),
    even = onTarget(0),
    high = onTarget(10);
  assert.ok(low > even && even > high, `on target ${low} / ${even} / ${high} of 400`);
  assert.equal(onTarget(10, 0), even);
});

test('a higher level makes the same save likelier, for both keepers alike', () => {
  const saves = level => {
    let n = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const m = new Match(9, 180),
        p = m.players[9],
        g = m.players[11];
      m.level = level;
      m.edge = [0, 0];
      m.mode = 'play';
      for (const q of m.players)
        if (q !== p && q.role !== 'GK') Object.assign(q, { x: 20 + q.slot, y: 60 });
      Object.assign(p, { x: 90, y: 34, vx: 0, vy: 0, energy: 1 });
      Object.assign(g, { x: 103.5, y: 34, vx: 0, vy: 0 });
      Object.assign(m.ball, { x: 90, y: 34, owner: p.id, kind: 'dribble' });
      m.rng = seed * 104729;
      m.shoot(p);
      const before = m.stats[1].saves;
      for (let i = 0; i < 90 && m.ball.kind === 'shot'; i++) m.moveBall(1 / 60);
      if (m.stats[1].saves > before) n++;
    }
    return n;
  };
  const low = saves(-10),
    high = saves(12);
  assert.ok(high > low, `saved ${low} at a low level, ${high} at a high one`);
});
