// The whistle at the end of a period (app/core/sim/whistle.js): an attack that is on when time
// runs out is played to its end, a corner that has been awarded is taken, and it all stays
// within the caps of tuning.periods.hold*.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../app/core/sim/engine.js';
import { simulateComplete, simulateHalf } from '../app/core/sim/replay.js';
import { DEFAULT_CONFIG, CONFIG_FIELDS } from '../app/core/config/config.js';

const STEP = 1 / 60;
// A match a moment before the end of the first half, in open play.
function nearTheWhistle(seed, before = 0.05) {
  const m = new Match(seed);
  m.pauseAtHalf = true;
  m.mode = 'play';
  m.elapsed = m.periodDeadline() - before;
  return m;
}
// Give the ball to a player at `rel` metres from his own goal line.
function carry(m, id, rel, y = 34) {
  const p = m.players[id];
  p.x = m.abs(rel, p.team);
  p.y = y;
  Object.assign(m.ball, { x: p.x, y: p.y, z: 0, vx: 0, vy: 0, vz: 0, owner: id, kind: 'dribble' });
  m.lastTeam = p.team;
  return p;
}
function playOut(m, limit = 60 * 40) {
  for (let i = 0; i < limit && m.mode !== 'halftime' && !m.finished; i++) m.step(STEP);
  return m;
}
// The longest a period can run over: nothing new is waited for after holdMaximum, a struck
// shot and the goal it scores get four more seconds (a penalty is always taken).
const HARD_CAP = DEFAULT_CONFIG.periods.holdMaximum + 4 + 0.1;

test('the whistle caps are tuning (periods.hold*), read from the match snapshot', () => {
  for (const key of ['holdRange', 'holdAttack', 'holdCorners', 'holdMaximum'])
    assert.ok(CONFIG_FIELDS.some(f => f.path === 'periods.' + key));
  const m = nearTheWhistle(5);
  assert.deepEqual(m.tuning.periods, DEFAULT_CONFIG.periods);
  // The match's own snapshot decides: with a range of 0 nobody is "attacking".
  m.tuning.periods.holdRange = 0;
  carry(m, 9, 90);
  playOut(m, 30);
  assert.equal(m.mode, 'halftime');
});

test('time up with nothing on: the whistle blows on the deadline, as it always did', () => {
  const m = nearTheWhistle(3);
  carry(m, 6, 50);
  const deadline = m.periodDeadline();
  playOut(m);
  assert.equal(m.mode, 'halftime');
  assert.ok(m.elapsed - deadline < 2 * STEP);
  assert.equal(m.heldTime[0], Math.max(0, m.elapsed - deadline));
  assert.ok(m.heldTime[0] < 2 * STEP);
});

test('a live attack at time-up delays the whistle, and it still blows within the cap', () => {
  let held = 0;
  for (let seed = 1; seed <= 16; seed++) {
    const m = nearTheWhistle(seed),
      deadline = m.periodDeadline();
    carry(m, 9, 88);
    for (let i = 0; i < 12; i++) m.step(STEP);
    // Time is up and the striker is on the ball at the edge of the box: play goes on.
    assert.ok(m.elapsed > deadline);
    assert.equal(m.half, 1);
    assert.notEqual(m.mode, 'halftime', `seed ${seed}: blown in the middle of the attack`);
    assert.equal(m.liveAttack() >= 0 || m.ball.kind === 'shot' || m.holdTeam === 0, true);
    playOut(m);
    assert.equal(m.mode, 'halftime', `seed ${seed}: the half never ended`);
    assert.ok(m.heldTime[0] > 10 * STEP);
    assert.ok(m.heldTime[0] <= HARD_CAP, `seed ${seed}: held ${m.heldTime[0].toFixed(2)} s`);
    // The clock ran on as added time; nothing else is shown for it.
    assert.ok(m.halftime.time > 2700);
    held += m.heldTime[0];
  }
  // A few seconds of play, not a second half of its own.
  assert.ok(held / 16 < 7, `mean ${(held / 16).toFixed(2)} s`);
});

test('the attack is over when the ball is lost: a defender on it, a keeper holding it', () => {
  // A defender wins it in his own third: blown within the half second it takes to be sure.
  const m = nearTheWhistle(7);
  carry(m, 9, 90);
  for (let i = 0; i < 8; i++) m.step(STEP);
  assert.equal(m.holdTeam, 0);
  const defender = carry(m, 13, 14);
  defender.cooldown = 0;
  const from = m.elapsed;
  playOut(m, 120);
  assert.equal(m.mode, 'halftime');
  assert.ok(m.elapsed - from < 0.5 + 3 * STEP);
  // The keeper has it in his hands: blown at once.
  const k = nearTheWhistle(7);
  carry(k, 9, 90);
  for (let i = 0; i < 8; i++) k.step(STEP);
  const keeper = k.keeper(1);
  carry(k, keeper.id, 5);
  k.ball.kind = 'held';
  k.step(STEP);
  assert.equal(k.mode, 'halftime');
});

test('a goal kick, a throw-in or a free kick to the defenders ends the half at once', () => {
  for (const [type, team, x, y] of [
    ['Goal kick', 1, 99.5, 34],
    ['Throw-in', 0, 92, 0.3],
    ['Throw-in', 1, 92, 0.3],
    ['Free kick', 1, 85, 30],
    ['Offside', 1, 88, 30],
  ]) {
    const m = nearTheWhistle(9);
    carry(m, 9, 90);
    for (let i = 0; i < 8; i++) m.step(STEP);
    assert.notEqual(m.mode, 'halftime');
    m.startRestart(type, team, x, y);
    m.step(STEP);
    assert.equal(m.mode, 'halftime', type);
  }
  // … and with one of them pending when time runs out there is nothing to wait for.
  const m = nearTheWhistle(9, 0.5);
  m.startRestart('Throw-in', 0, 95, 0.3);
  playOut(m, 60);
  assert.equal(m.mode, 'halftime');
  assert.ok(m.heldTime[0] < 2 * STEP);
});

test('a corner awarded before time is up is taken, and played out', () => {
  for (let seed = 21; seed <= 28; seed++) {
    const m = nearTheWhistle(seed, 0.4);
    m.startRestart('Corner', 0, 104.7, 0.3);
    const setUp = m.restart.timer;
    assert.ok(setUp > 2, 'the corner is still being set up when time runs out');
    let delivered = false;
    for (let i = 0; i < 60 * 40 && m.mode !== 'halftime'; i++) {
      m.step(STEP);
      if (m.half === 1 && m.mode === 'play' && m.ball.kind === 'pass') delivered = true;
    }
    assert.ok(delivered, `seed ${seed}: the corner was never delivered`);
    assert.equal(m.mode, 'halftime');
    assert.ok(m.heldTime[0] > setUp - 0.4, 'the half lasted beyond the delivery');
    assert.ok(m.heldTime[0] <= HARD_CAP, `seed ${seed}: held ${m.heldTime[0].toFixed(2)} s`);
  }
});

test('one more corner at most, an attacking free kick in range, nothing beyond the hard cap', () => {
  const holding = () => {
    const m = nearTheWhistle(31);
    carry(m, 9, 90);
    for (let i = 0; i < 8; i++) m.step(STEP);
    return m;
  };
  // A corner won in held time is taken …
  let m = holding();
  m.startRestart('Corner', 0, 104.7, 0.3);
  m.step(STEP);
  assert.equal(m.mode, 'restart');
  assert.equal(m.holdCorners, 1);
  while (m.mode === 'restart') m.step(STEP);
  assert.equal(m.half, 1, 'it was delivered');
  m.step(STEP);
  // … but a second one is not (periods.holdCorners).
  if (m.mode !== 'halftime') {
    m.startRestart('Corner', 0, 104.7, 67.7);
    m.step(STEP);
  }
  assert.equal(m.mode, 'halftime');
  m = holding();
  m.tuning.periods.holdCorners = 0;
  m.startRestart('Corner', 0, 104.7, 0.3);
  m.step(STEP);
  assert.equal(m.mode, 'halftime');
  // A free kick for the attackers within range is taken; one in their own half is not.
  m = holding();
  m.startRestart('Free kick', 0, 82, 30);
  m.step(STEP);
  assert.equal(m.mode, 'restart');
  m = holding();
  m.startRestart('Free kick', 0, 40, 30);
  m.step(STEP);
  assert.equal(m.mode, 'halftime');
  // Past the hard cap nothing new is waited for, not even a corner.
  m = holding();
  m.elapsed = m.periodDeadline() + m.tuning.periods.holdMaximum - 1;
  m.startRestart('Corner', 0, 104.7, 0.3);
  m.step(STEP);
  assert.equal(m.mode, 'halftime');
});

test('a penalty awarded at the death is taken and decided', () => {
  const m = nearTheWhistle(41, 0.3);
  m.startRestart('Penalty', 0, m.abs(94, 0), 34);
  let struck = false;
  for (let i = 0; i < 60 * 30 && m.mode !== 'halftime'; i++) {
    m.step(STEP);
    if (m.stats[0].penalties + m.stats[0].shots > 0 || m.ball.penaltyKick) struck = true;
  }
  assert.ok(struck, 'the penalty was struck');
  assert.equal(m.mode, 'halftime');
  assert.ok(m.heldTime[0] > 2);
});

test('held time is part of the match however it is played: complete, by halves, stepped', async () => {
  // Real squads are not needed: default sides, a few seeds, at least one held whistle.
  let held = 0;
  for (const seed of [11, 12, 13, 14]) {
    const source = new Match(seed),
      config = source.exportConfig();
    config.competition = { mode: 'ai', difficulty: 'hard' };
    const complete = (await simulateComplete(config, seed, true)).result;
    // Half by half (Key Moments)
    const kickoff = new Match(seed);
    kickoff.importConfig(config);
    kickoff.pauseAtHalf = true;
    const first = await simulateHalf(kickoff),
      second = await simulateHalf(first.result);
    // Stepped with a pause at half-time (Full)
    const live = new Match(seed);
    live.importConfig(config);
    live.pauseAtHalf = true;
    while (!live.finished) {
      live.step(STEP);
      if (live.mode === 'halftime') live.resumeHalf();
    }
    for (const m of [second.result, live]) {
      assert.deepEqual(m.score, complete.score);
      assert.equal(m.elapsed, complete.elapsed);
      assert.deepEqual(m.heldTime, complete.heldTime);
      assert.deepEqual(m.stats, complete.stats);
      assert.deepEqual(
        m.events.map(e => [e.id, e.type, e.elapsed]),
        complete.events.map(e => [e.id, e.type, e.elapsed]),
      );
    }
    held += complete.heldTime[0] + complete.heldTime[1];
    // A goal scored while the whistle was held is in the reel of its half.
    for (const [half, reel] of [first, second].entries()) {
      const end = half ? complete.elapsed : first.result.halftime.elapsed,
        deadline = end - complete.heldTime[half];
      for (const goal of complete.goalHistory.filter(g => g.half === half + 1))
        if (goal.elapsed > deadline)
          assert.ok(reel.clips.some(c => goal.elapsed >= c.start && goal.elapsed <= c.end));
    }
  }
  assert.ok(held > 0, 'none of these matches held the whistle: pick other seeds');
});

test('a goal in held time counts, is celebrated and is in the highlights', async () => {
  // The striker is through as time runs out; play the half out and look at what happened.
  let checked = 0;
  for (let seed = 50; seed < 90 && checked < 2; seed++) {
    const m = nearTheWhistle(seed);
    carry(m, 9, 93);
    const deadline = m.periodDeadline();
    const { result, clips } = await simulateHalf(m);
    assert.equal(result.mode, 'halftime');
    const goal = result.goalHistory.find(g => g.elapsed > deadline);
    if (!goal) continue;
    checked++;
    assert.equal(result.score[0] + result.score[1], 1);
    assert.equal(goal.half, 1);
    assert.ok(goal.time > 2700, 'the clock shows it as added time');
    assert.ok(clips.some(c => goal.elapsed >= c.start && goal.elapsed <= c.end));
    assert.ok(result.heldTime[0] <= HARD_CAP);
  }
  assert.equal(checked, 2, 'no seed scored in held time');
});
