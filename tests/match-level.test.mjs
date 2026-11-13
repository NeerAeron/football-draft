// The level of the match (docs/calibration.md, Phase 9): shots scatter more and keepers hold
// more the better the two line-ups are, so the number of goals does not follow the ratings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, GOAL } from '../app/core/sim/engine.js';
import { unitLevels, unitLean } from '../app/core/players/unit-levels.js';
import { expectedGoals, outcomeProbabilities } from '../app/core/competition/model.js';

const lift = (m, team, points) => {
  for (const p of m.players)
    if (p.team === team)
      for (const key of Object.keys(p.attrs)) p.attrs[key] = Math.min(99, p.attrs[key] + points);
};

const ATTACK = new Set(['ST', 'LW', 'RW', 'AM']),
  DEFENCE = new Set(['GK', 'CB', 'LB', 'RB']);
const liftLine = (m, team, line, points) => {
  for (const p of m.players)
    if (p.team === team && line.has(p.role))
      for (const key of Object.keys(p.attrs)) p.attrs[key] = Math.min(99, p.attrs[key] + points);
};

test('the level is read at kick-off: the match (overall, gap) for both sides alike', () => {
  const off = m => ((m.tuning.gameplay.levelUnits = 0), m);
  const base = off(new Match(5)).kickoffLevel();
  assert.equal(base[0], base[1], 'overall only: one level for the match');
  const both = off(new Match(5));
  lift(both, 0, 8);
  lift(both, 1, 8);
  assert.ok(both.kickoffLevel()[0] > base[0] + 5, 'two better sides: a higher level');
  const one = off(new Match(5));
  lift(one, 0, 8);
  const mean = (base[0] + both.kickoffLevel()[0]) / 2;
  assert.ok(one.kickoffLevel()[0] > mean + 2, 'a mismatch counts as a higher level still');
  assert.equal(one.kickoffLevel()[0], one.kickoffLevel()[1]);
  one.tuning.gameplay.levelGap = 0;
  assert.ok(Math.abs(one.kickoffLevel()[0] - mean) < 1, 'without levelGap: just the mean');
  // Set once, at the first step; never moved by what happens later.
  const m = new Match(5);
  assert.equal(m.level, null);
  m.step(1 / 60);
  const level = [...m.level];
  assert.deepEqual(level, new Match(5).kickoffLevel());
  lift(m, 0, 10);
  for (let i = 0; i < 30; i++) m.step(1 / 60);
  assert.deepEqual(m.level, level);
});

test('the units: a side attacks at a higher level against a defence better than its side', () => {
  // What the unit terms add to each side's level, on top of the match's (overall, gap).
  const units = change => {
    const on = new Match(5),
      off = new Match(5);
    change(on);
    change(off);
    off.tuning.gameplay.levelUnits = 0;
    const a = on.kickoffLevel(),
      b = off.kickoffLevel();
    assert.equal(b[0], b[1]);
    return [a[0] - b[0], a[1] - b[1]];
  };
  const plain = units(() => {});
  // Team 1's keeper and back line are far better than the rest of it: team 0 finds it
  // harder to score than team 1's overall says, and team 1's attack — now below its own
  // overall — is not helped.
  const wall = units(m => liftLine(m, 1, DEFENCE, 6));
  assert.ok(wall[0] > plain[0] + 0.5, `against the wall ${wall[0]} (plain ${plain[0]})`);
  assert.ok(wall[1] > plain[1]);
  // A star attack in front of an ordinary defence: it scores more easily than its overall
  // says, and whoever attacks that side's back line — below its overall now — does too.
  const open = units(m => liftLine(m, 0, ATTACK, 6));
  assert.ok(open[0] < plain[0] - 0.5, `the star attack ${open[0]} (plain ${plain[0]})`);
  assert.ok(open[1] < plain[1]);
});

test('a higher level scatters the same shot more; levelScatter 0 switches it off', () => {
  const onTarget = (level, scatter = null) => {
    let n = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const m = new Match(7, 180),
        p = m.players[9];
      if (scatter !== null) m.tuning.gameplay.levelScatter = scatter;
      m.level = [level, 0];
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
      m.level = [level, 0];
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

test('the fast model can read the units: the same ratings, fewer goals against a better defence', () => {
  const m = new Match(5),
    side = t => m.players.filter(p => p.team === t);
  const plain = [unitLevels(side(0)), unitLevels(side(1))];
  liftLine(m, 1, DEFENCE, 6);
  const wall = [unitLevels(side(0)), unitLevels(side(1))];
  assert.ok(wall[1].defence > plain[1].defence + 4 && wall[1].attack === plain[1].attack);
  assert.ok(unitLean(wall[0], wall[1]) > unitLean(plain[0], plain[1]) + 1.5);
  // Same two ratings: without units nothing changes, with them side A scores less.
  assert.deepEqual(expectedGoals(82, 80), expectedGoals(82, 80, undefined, null));
  const [a, b] = expectedGoals(82, 80, undefined, wall),
    [a0, b0] = expectedGoals(82, 80, undefined, plain);
  assert.ok(a < a0 * 0.95, `against the wall ${a} (plain ${a0})`);
  assert.ok(b < b0, 'and the attack in front of the wall is less than that rating says');
  assert.ok(
    outcomeProbabilities(82, 80, undefined, wall).win <
      outcomeProbabilities(82, 80, undefined, plain).win,
  );
});
