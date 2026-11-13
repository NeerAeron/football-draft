import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, Player } from '../app/core/sim/engine.js';
import {
  snapshot,
  applyReplayFrame,
  simulateHalf,
  selectHighlights,
} from '../app/core/sim/replay.js';
import { offsideSnapshot } from '../app/core/sim/rules.js';
import { cardRisk } from '../app/core/sim/discipline.js';

function playing(seed = 86) {
  const m = new Match(seed, 180);
  m.mode = 'play';
  m.elapsed = 10;
  return m;
}

test('yellow, second yellow, straight red and reset preserve IDs and restore 22 players', () => {
  const m = playing(),
    p = m.players[2],
    ids = m.players.map(p => p.id);
  m.issueCard(p, 'yellow');
  assert.equal(p.sentOff, false);
  assert.equal(p.yellowCards, 1);
  assert.equal(m.activePlayers.length, 22);
  m.issueCard(p, 'yellow');
  assert.equal(p.sentOff, true);
  assert.equal(p.yellowCards, 2);
  assert.equal(m.stats[0].redCards, 1);
  assert.equal(m.stats[0].yellowCards, 2);
  assert.equal(m.activePlayers.length, 21);
  assert.equal(m.events.find(e => e.type === 'red').secondYellow, true);
  m.issueCard(p, 'red');
  assert.equal(m.stats[0].redCards, 1);
  m.issueCard(m.players[12], 'red');
  assert.equal(m.players[12].yellowCards, 0);
  assert.equal(m.stats[1].redCards, 1);
  m.reset();
  assert.deepEqual(
    m.players.map(p => p.id),
    ids,
  );
  assert.equal(m.activePlayers.length, 22);
  assert.ok(m.players.every(p => !p.sentOff && !p.yellowCards && !p.emergencyKeeper));
});

test('dismissed goalkeeper gets active stand-in that survives halftime and formation changes; reset restores roles', () => {
  const m = playing(),
    roles = m.players.map(p => p.role);
  m.issueCard(m.players[0], 'red');
  const g = m.keeper(0);
  assert.ok(g && g.id !== 0 && g.emergencyKeeper);
  assert.equal(m.activePlayers.filter(p => p.team === 0 && p.role === 'GK').length, 1);
  m.startRestart('Goal kick', 0, 5.5, 34);
  assert.equal(m.restart.taker, g.id);
  m.stepRestart(10);
  assert.ok(m.ball.owner === g.id || m.ball.kicker === g.id, 'the stand-in takes the goal kick');
  m.finishPeriod();
  assert.equal(m.mode, 'halftime');
  m.setTactic(0, 'formation', '442');
  assert.equal(g.role, 'GK');
  assert.equal(m.resumeHalf(), true);
  assert.equal(m.keeper(0), g);
  assert.ok(g.emergencyKeeper);
  assert.equal(m.activePlayers.length, 21);
  m.reset();
  assert.deepEqual(
    m.players.map(p => p.role),
    roles.map((r, i) =>
      i < 11 ? ['GK', 'LB', 'CB', 'CB', 'RB', 'LM', 'CM', 'CM', 'RM', 'ST', 'ST'][i] : r,
    ),
  );
  assert.equal(m.keeper(0).id, 0);
});

test('dismissal excludes offside candidates, receivers, pressure, collection and movement', () => {
  const m = playing(),
    p = m.players[20],
    owner = m.players[9];
  owner.x = 80;
  owner.y = 34;
  m.own(owner);
  p.x = 80.5;
  p.y = 34;
  const pressureBefore = m.pressure(owner);
  assert.ok(pressureBefore > 0);
  m.issueCard(p, 'red');
  assert.ok(m.pressure(owner) < pressureBefore);
  assert.equal(m.canCollect(p), false);
  assert.equal(m.own(p), false);
  assert.equal(m.duel(owner, p), false);
  const pos = { x: p.x, y: p.y };
  m.step(1 / 60);
  assert.equal(p.x, pos.x);
  assert.equal(p.y, pos.y);
  assert.ok(!m.options(m.players[19]).some(o => o.r.id === p.id));
  const snap = offsideSnapshot(m, m.players[19]);
  assert.ok(!snap.candidates.includes(p.id));
});

test('dismissed striker is never a subsequent kickoff or penalty taker', () => {
  const m = playing();
  m.issueCard(m.players[9], 'red');
  m.startRestart('Goal', 0, 52.5, 34);
  assert.notEqual(m.restart.taker, 9);
  m.stepRestart(10);
  assert.notEqual(m.ball.owner, 9);
  m.startRestart('Penalty', 0, 94, 34);
  assert.ok(!m.players[m.restart.taker].sentOff);
});

test('fifth dismissal abandons, stops simulation, and reset removes abandoned state', () => {
  const m = playing();
  for (const id of [2, 3, 5, 6, 7]) m.issueCard(m.players[id], 'red');
  assert.equal(m.activePlayers.filter(p => p.team === 0).length, 6);
  assert.equal(m.finished, true);
  assert.equal(m.abandonedTeam, 0);
  const time = m.elapsed;
  m.step(1 / 60);
  assert.equal(m.elapsed, time);
  m.reset();
  assert.equal(m.abandonedTeam, null);
  assert.equal(m.finished, false);
});

test('replay follows yellow, dismissal, stand-in and active player counts in chronological order', () => {
  const m = playing(),
    first = snapshot(m);
  m.elapsed = 11;
  m.issueCard(m.players[0], 'yellow');
  const second = snapshot(m);
  m.elapsed = 12;
  m.issueCard(m.players[0], 'yellow');
  const third = snapshot(m);
  const g = m.keeper(0);
  const recording = {
      result: m,
      frames: [first, second, third],
      clips: [{ start: 10, end: 12, offset: 0 }],
    },
    view = new Match(86, 180);
  applyReplayFrame(view, recording, 1.5);
  assert.equal(view.players[0].yellowCards, 1);
  assert.equal(view.activePlayers.length, 22);
  assert.equal(view.keeper(0).id, 0);
  applyReplayFrame(view, recording, 2);
  assert.equal(view.players[0].sentOff, true);
  assert.equal(view.activePlayers.length, 21);
  assert.equal(view.keeper(0).id, g.id);
  assert.equal(view.stats[0].redCards, 1);
  applyReplayFrame(view, recording, 0);
  assert.equal(view.activePlayers.length, 22);
  assert.equal(view.players[0].sentOff, false);
  assert.equal(view.keeper(0).id, 0);
});

test('half recorder clones active players onto Player prototypes without mutating source', async () => {
  const m = playing();
  m.issueCard(m.players[0], 'red');
  m.elapsed = m.periodDeadline() - 0.03;
  const result = await simulateHalf(m);
  assert.equal(m.mode, 'play');
  assert.equal(result.result.mode, 'halftime');
  assert.equal(result.result.activePlayers.length, 21);
  assert.ok(
    result.result.activePlayers.every(
      p => p instanceof Player && result.result.players[p.id] === p,
    ),
  );
});

test('dismissed player cannot shoot through direct engine method', () => {
  const m = playing(),
    p = m.players[9];
  m.issueCard(p, 'red');
  const shots = m.stats[0].shots;
  m.shoot(p);
  assert.equal(m.stats[0].shots, shots);
});

test('replay includes abandonment state', () => {
  const m = playing();
  for (const id of [2, 3, 5, 6, 7]) m.issueCard(m.players[id], 'red');
  const frame = snapshot(m),
    view = new Match(86, 180);
  applyReplayFrame(
    view,
    { result: m, frames: [frame], clips: [{ start: m.elapsed, end: m.elapsed + 0.1, offset: 0 }] },
    0,
  );
  assert.equal(view.abandonedTeam, 0);
});

test('card risk follows contact force, angle, discipline and fatigue', () => {
  const m = playing(),
    p = m.players[2],
    victim = m.players[20];
  m.ball.owner = null;
  p.tendencies.discipline = 0.95;
  p.tendencies.aggression = 0.15;
  p.energy = 1;
  const safe = cardRisk(m, p, victim, { bearing: 1, closing: 2 });
  p.tendencies.discipline = 0.15;
  p.tendencies.aggression = 0.9;
  p.energy = 0.15;
  const reckless = cardRisk(m, p, victim, { bearing: -1, closing: 11 });
  assert.ok(reckless.yellow > safe.yellow);
  assert.ok(reckless.red > safe.red);
});

test('denying a clear goal chance is red outside the box, with the ball-challenge penalty exception', () => {
  const m = playing(),
    victim = m.players[9],
    p = m.players[13];
  for (const q of m.players) {
    q.x = q.team ? 20 : 5;
    q.y = 5;
  }
  Object.assign(victim, { x: 85, y: 34, facing: 0, vx: 2 });
  Object.assign(p, { x: 84, y: 34 });
  m.players[11].x = 103;
  m.players[11].y = 34;
  m.own(victim);
  const model = { bearing: -1, closing: 2 };
  assert.equal(cardRisk(m, p, victim, model, false).red, 1);
  victim.x = 94;
  const penalty = cardRisk(m, p, victim, model, true);
  assert.equal(penalty.yellow, 1);
  assert.equal(penalty.red, 0);
  Object.assign(m.players[14], { x: 100, y: 34 });
  assert.equal(cardRisk(m, p, victim, model, true).dogso, false);
});

test('a booked player has lower foul risk and avoids a risky challenge', () => {
  const m = playing(),
    victim = m.players[9],
    p = m.players[13];
  Object.assign(victim, { x: 60, y: 34, facing: 0, vx: 0, vy: 0 });
  Object.assign(p, { x: 59.5, y: 34, vx: 8, vy: 0, cooldown: 0 });
  m.own(victim);
  const before = m.challengeModel(victim, p).foul;
  m.issueCard(p, 'yellow');
  const after = m.challengeModel(victim, p).foul;
  assert.ok(after < before * 0.3);
  m.rand = () => 0;
  assert.equal(m.duel(victim, p), false);
  assert.equal(p.action, 'Staying on feet after booking');
  assert.equal(p.stats.fouls, 0);
});

test('ten men reshape: a lost centre-back is covered from midfield and a forward drops in', () => {
  const m = playing(); // 4-3-3: GK LB CB CB RB DM CM CM LW ST RW
  m.issueCard(m.players[2], 'red');
  const roles = m.activePlayers.filter(p => p.team === 0).map(p => p.role);
  const count = r => roles.filter(x => x === r).length;
  assert.equal(count('CB'), 2, 'the back line is whole');
  assert.equal(count('DM') + count('CM'), 3, 'so is the midfield');
  assert.equal(count('ST'), 1, 'the striker stays up');
  assert.equal(count('LW') + count('RW'), 1, 'a winger was given up');
  const e = m.events.find(x => x.type === 'reshape');
  assert.ok(e && e.team === 0 && e.playerIds.length === 2);
  // Slots stay unique, so a later formation change keeps a sensible shape.
  const slots = m.players.filter(p => p.team === 0).map(p => p.slot);
  assert.equal(new Set(slots).size, 11);
  m.setTactic(0, 'formation', '442');
  assert.equal(m.activePlayers.filter(p => p.team === 0 && p.role === 'CB').length, 2);
  // The other side is untouched, and a reset puts everyone back.
  assert.ok(!m.events.some(x => x.type === 'reshape' && x.team === 1));
  m.reset();
  assert.deepEqual(
    m.players.slice(0, 11).map(p => p.slot),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
});

test('ten men reshape: a midfielder off costs a winger, the lone striker off is replaced', () => {
  const a = playing();
  a.issueCard(a.players[6], 'red');
  const roles = a.activePlayers.filter(p => p.team === 0).map(p => p.role);
  assert.equal(roles.filter(r => r === 'CM' || r === 'DM').length, 3);
  assert.equal(roles.filter(r => r === 'ST').length, 1);
  const b = playing();
  b.issueCard(b.players[9], 'red');
  assert.equal(b.activePlayers.filter(p => p.team === 0 && p.role === 'ST').length, 1);
  // With two strikers, losing one changes nothing.
  const c = playing();
  c.setTactic(0, 'formation', '442');
  c.issueCard(c.players[9], 'red');
  assert.ok(!c.events.some(x => x.type === 'reshape'));
  assert.equal(c.activePlayers.filter(p => p.team === 0 && p.role === 'ST').length, 1);
});

test('a red card is always one of the highlights, even in a half full of goals', () => {
  const events = [
    ...[20, 35, 50, 62, 75, 81].map(elapsed => ({ type: 'goal', elapsed })),
    { type: 'red', elapsed: 10 },
  ];
  const clips = selectHighlights(events, 90, 30);
  assert.ok(
    clips.some(c => c.start <= 10 && c.end >= 10),
    'the red card is shown',
  );
  for (const g of events.filter(e => e.type === 'goal'))
    assert.ok(clips.some(c => c.start <= g.elapsed && c.end >= g.elapsed));
  assert.ok(clips.reduce((s, c) => s + c.end - c.start, 0) <= 30 + 1e-6);
});
