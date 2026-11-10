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

// Push raises the chance of a goal at both ends, Hold lowers it at both ends: the room a
// shooter gets is his own side's `chances` plus the defending side's `exposure`.
test('mentality opens or closes the game at both ends', () => {
  const room = (own, other, score = [0, 0]) => {
    const m = new Match(44, 180);
    m.setTactic(0, 'mentality', own);
    m.setTactic(1, 'mentality', other);
    m.score = score;
    return m.shootingRoom(0);
  };
  assert.equal(room('balanced', 'balanced'), 0);
  // The pushing side's own shots, and the shots it concedes.
  assert.ok(room('push', 'balanced') > 0.2);
  assert.ok(room('balanced', 'push') > 0.2);
  assert.ok(room('push', 'push') > room('push', 'balanced'));
  // The holding side's own shots, and the shots it concedes.
  assert.ok(room('hold', 'balanced') < -0.15);
  assert.ok(room('balanced', 'hold') < -0.15);
  assert.ok(room('hold', 'hold') < room('hold', 'balanced'));
  // The tuning snapshot decides, not live CONFIG; Balanced is the zero point.
  const m = new Match(44, 180);
  m.setTactic(0, 'mentality', 'push');
  m.tuning.mentality.push.chances = 0;
  assert.equal(m.shootingRoom(0), 0);
  assert.equal(m.mentalityShift(1).chances, 0);
});

test('well-timed choices are rewarded: pushing while behind, holding a lead', () => {
  const m = new Match(45, 180),
    rules = m.tuning.mentality;
  assert.ok(rules.chase > 0 && rules.chase <= 0.2 && rules.protect > 0 && rules.protect <= 0.2);
  m.setTactic(0, 'mentality', 'push');
  const level = m.shootingRoom(0);
  m.score = [0, 1];
  assert.ok(Math.abs(m.shootingRoom(0) - (level + rules.chase)) < 1e-12, 'behind and pushing');
  m.score = [1, 0];
  assert.equal(m.shootingRoom(0), level, 'no bonus for pushing while ahead');
  // Holding a lead takes a little off the opponent's chances; holding a draw does not.
  m.setTactic(0, 'mentality', 'hold');
  m.score = [0, 0];
  const against = m.shootingRoom(1);
  m.score = [1, 0];
  assert.ok(Math.abs(m.shootingRoom(1) - (against - rules.protect)) < 1e-12, 'ahead and holding');
  m.score = [0, 1];
  assert.equal(m.shootingRoom(1), against, 'no bonus for holding while behind');
  // A balanced side gets neither.
  m.setTactic(0, 'mentality', 'balanced');
  assert.equal(m.shootingRoom(0), 0);
  assert.equal(m.shootingRoom(1), 0);
  // Auto earns the same rewards when the game state makes it push or hold.
  m.setTactic(0, 'mentality', 'auto');
  m.half = 2;
  m.time = 80 * 60;
  m.score = [0, 1];
  assert.equal(m.mentality(0), 'push');
  assert.ok(Math.abs(m.shootingRoom(0) - (rules.push.chances + rules.chase)) < 1e-12);
  m.score = [1, 0];
  assert.equal(m.mentality(0), 'hold');
  assert.ok(Math.abs(m.shootingRoom(1) - (rules.hold.exposure - rules.protect)) < 1e-12);
  m.time = 30 * 60;
  assert.equal(m.shootingRoom(1), 0, 'auto is balanced before the late game');
});

test('room to shoot tightens the shot: same strike, less scatter for the pushing side', () => {
  const strike = mentality => {
    const m = new Match(46, 180);
    m.setTactic(0, 'mentality', mentality);
    m.mode = 'play';
    const p = m.players.find(q => q.team === 0 && q.role === 'ST');
    Object.assign(p, { x: m.abs(88, 0), y: 30, vx: 0, vy: 0 });
    for (const q of m.players) if (q.team === 1 && q.role !== 'GK') q.x = m.abs(40, 0);
    m.own(p);
    m.rng = 4242;
    m.shoot(p);
    return m.ball.vy / m.ball.vx;
  };
  const push = strike('push'),
    balanced = strike('balanced'),
    hold = strike('hold');
  // The same random draws: only the scatter around the same aim point differs.
  assert.notEqual(push, hold);
  assert.ok((balanced - push) * (hold - balanced) > 0, [push, balanced, hold].join(' '));
  assert.ok(Math.abs(hold - balanced) > 0 && Math.abs(balanced - push) > 0);
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
