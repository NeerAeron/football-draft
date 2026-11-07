import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../app/core/sim/engine.js';
import { coachAI, gameStateMentality } from '../app/core/sim/coach.js';

// Team 0 in possession around the halfway line, everyone else in shape.
function possession(mentality) {
  const m = new Match(41, 300);
  m.setTactic(0, 'mentality', mentality);
  m.mode = 'play';
  const carrier = m.players[6];
  Object.assign(carrier, { x: 60, y: 34 });
  m.own(carrier);
  m.plan();
  return m;
}
const meanTargetX = (m, team) => {
  const players = m.players.filter(
    p => p.team === team && p.role !== 'GK' && p.id !== m.ball.owner,
  );
  return players.reduce((s, p) => s + m.rel(p.tx, team), 0) / players.length;
};

test('mentality leans the side: push higher, hold deeper', () => {
  const push = possession('push'),
    balanced = possession('balanced'),
    hold = possession('hold');
  assert.ok(push.settings(0).line > balanced.settings(0).line);
  assert.ok(hold.settings(0).line < balanced.settings(0).line);
  assert.ok(meanTargetX(push, 0) > meanTargetX(balanced, 0));
  assert.ok(meanTargetX(hold, 0) < meanTargetX(balanced, 0));
  // A side protecting a lead takes longer over its restarts.
  hold.startRestart('Throw-in', 0, 50, 0.2);
  balanced.startRestart('Throw-in', 0, 50, 0.2);
  assert.ok(hold.restart.timer > balanced.restart.timer);
});

test('game-state mentality: trailing sides push after 70, leaders hold from 75', () => {
  const m = new Match(42, 300);
  m.half = 2;
  m.score = [0, 1];
  m.time = 60 * 60;
  assert.equal(gameStateMentality(m, 0), 'balanced');
  m.time = 72 * 60;
  assert.equal(gameStateMentality(m, 0), 'push');
  assert.equal(gameStateMentality(m, 1), 'balanced');
  m.time = 80 * 60;
  assert.equal(gameStateMentality(m, 1), 'hold');
  m.score = [1, 1];
  assert.equal(gameStateMentality(m, 0), 'balanced');
  // The AI coach applies it to its own side.
  m.competition = { mode: 'ai', difficulty: 'hard' };
  m.score = [2, 1];
  coachAI(m);
  assert.equal(m.teams[1].tactics.mentality, 'push');
});

test('pressing and tempo cost stamina; low settings save it', () => {
  const run = (key, value, inPossession) => {
    const m = new Match(43, 300),
      p = m.players[7];
    m.setTactic(0, key, value);
    m.lastTeam = inPossession ? 0 : 1;
    m.ball.owner = inPossession ? m.players[5].id : m.players[16].id;
    for (let i = 0; i < 3000; i++) {
      Object.assign(p, { x: 50, y: 20, vx: 5, vy: 0 });
      p.aim(70, 20, 'press', 'Pressing');
      m.move(p, 1 / 60);
    }
    return 1 - p.energy;
  };
  const press = [1, 3, 5].map(v => run('press', v, false));
  assert.ok(press[2] > press[1] * 1.12 && press[1] > press[0] * 1.12, press.join(' '));
  const tempo = [1, 5].map(v => run('tempo', v, true));
  assert.ok(tempo[1] > tempo[0] * 1.15, tempo.join(' '));
  // Pressing costs nothing extra while your own side has the ball.
  assert.ok(Math.abs(run('press', 5, true) - run('press', 1, true)) < 1e-9);
});
