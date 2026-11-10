import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeCatalog } from '../scripts/data/catalog-file.mjs';
import { Match, GOAL } from '../app/core/sim/engine.js';
import { MENTALITIES, SHOT_SITUATIONS, geometricXg } from '../app/core/sim/insights.js';
import { selectHighlights, highlightScore } from '../app/core/sim/replay.js';
import { randomLineups } from '../app/core/players/lineups.js';

const SAVE_TYPES = ['catch', 'parry', 'parry into danger', 'tip over'];
const OUTCOMES = ['goal', 'saved', 'blocked', 'post', 'off target'];

// Shoot from p, then carry the ball over the goal line between the posts.
function score(m, p, time = null) {
  m.mode = 'play';
  if (time !== null) {
    m.time = time;
    m.half = time < 2700 ? 1 : 2;
  }
  const right = m.direction(p.team) > 0;
  p.x = right ? 95 : 10;
  p.y = 34;
  m.shoot(p);
  m.ball.previous = { x: right ? 104.6 : 0.4, y: 34, z: 0.5 };
  m.ball.x = right ? 105.4 : -0.4;
  m.ball.y = 34;
  m.ball.z = 0.5;
  m.checkBounds();
  return m.goalHistory.at(-1);
}

test('event contract over a full match: shots, saves, goals and momentum carry their fields', () => {
  const catalog = loadRuntimeCatalog();
  const m = new Match(13, 180),
    config = m.exportConfig();
  config.players = randomLineups(m.players, catalog.players, 13);
  m.importConfig(config);
  while (!m.finished) m.step(1 / 60);
  const shots = m.events.filter(e => e.type === 'shot');
  assert.ok(shots.length > 0);
  for (const e of shots) {
    assert.ok(e.xg > 0 && e.xg < 1, `xg ${e.xg}`);
    assert.equal(typeof e.bigChance, 'boolean');
    assert.equal(typeof e.oneOnOne, 'boolean');
    assert.ok(SHOT_SITUATIONS.includes(e.situation), e.situation);
    assert.ok(OUTCOMES.includes(e.outcome), e.outcome);
    assert.ok(e.distance > 0);
  }
  for (const t of [0, 1]) {
    const sum = shots.filter(e => e.team === t).reduce((s, e) => s + e.xg, 0);
    assert.ok(Math.abs(m.stats[t].xg - sum) < 1e-9);
  }
  for (const e of m.events.filter(e => e.type === 'save')) {
    assert.ok(SAVE_TYPES.includes(e.saveType), e.saveType);
    assert.ok(e.difficulty >= 0 && e.difficulty <= 1);
    assert.equal(m.events.find(s => s.id === e.shotEventId)?.type, 'shot');
  }
  for (const g of m.goalHistory) {
    assert.ok(Array.isArray(g.story));
    assert.equal(g.scoreAfter.length, 2);
    assert.ok(SHOT_SITUATIONS.includes(g.situation));
  }
  const { samples, step } = m.momentum;
  assert.equal(step, 60);
  assert.ok(samples.length >= 90 && samples.length <= 100, `${samples.length}`);
  // One sample per match minute; first-half stoppage minutes precede the second half.
  for (let i = 1; i < samples.length; i++)
    assert.ok(
      samples[i].half > samples[i - 1].half || samples[i].time > samples[i - 1].time,
      `${samples[i - 1].half}/${samples[i - 1].time} -> ${samples[i].half}/${samples[i].time}`,
    );
  assert.ok(samples.every(s => s.values.every(v => v >= 0 && v <= 1)));
  assert.ok(samples.some(s => s.values[0] > 0) && samples.some(s => s.values[1] > 0));
});

test('xG is geometric: closer, more central and less crowded shots are better chances', () => {
  assert.ok(geometricXg(3, 1.77) > 0.7);
  assert.ok(geometricXg(11, 0.64) > 0.12 && geometricXg(11, 0.64) < 0.25);
  assert.ok(geometricXg(25, 0.29) < 0.06);
  const m = new Match(5),
    s = m.players[9];
  for (const p of m.players) {
    p.x = 30;
    p.y = p.team ? 60 : 8;
  }
  m.players[11].x = 104.5;
  m.players[11].y = 34;
  s.x = 96;
  s.y = 34;
  const alone = m.shotQuality(s);
  assert.equal(alone.oneOnOne, true);
  assert.equal(alone.bigChance, true);
  assert.ok(alone.xg > 0.3);
  assert.ok(m.shotQuality(s, true).xg < alone.xg);
  for (const [i, y] of [32.5, 34, 35.5].entries()) {
    m.players[13 + i].x = 99;
    m.players[13 + i].y = y;
  }
  const crowded = m.shotQuality(s);
  assert.equal(crowded.oneOnOne, false);
  assert.ok(crowded.xg < alone.xg * 0.6);
  assert.equal(m.shotQuality(s, false, true).xg, 0.76);
});

test('shot situations follow how the attack began', () => {
  const m = new Match(6),
    p = m.players[9];
  m.elapsed = 50;
  m.startChain(0, m.abs(104, 0), 'Corner');
  assert.deepEqual(m.situation(0), { situation: 'set piece', setPiece: 'corner' });
  assert.equal(m.situation(1).situation, 'open play');
  m.elapsed = 70;
  assert.equal(m.situation(0).situation, 'open play');
  m.startChain(0, m.abs(30, 0), null, true);
  m.elapsed = 78;
  assert.equal(m.situation(0).situation, 'counter');
  m.startChain(0, m.abs(75, 0), null, true);
  assert.equal(m.situation(0).situation, 'regain');
  assert.equal(m.situation(0, true).situation, 'penalty');
  m.startChain(0, m.abs(80, 0), 'Free kick');
  p.x = m.abs(80, 0);
  p.y = 34;
  m.mode = 'play';
  m.shoot(p, { restart: true });
  const shot = m.events[0];
  assert.equal(shot.type, 'shot');
  assert.equal(shot.situation, 'set piece');
  assert.equal(shot.setPiece, 'free kick');
  assert.equal(shot.direct, true);
});

test('goal story tags: opener, equaliser, go-ahead, comeback, brace, hat-trick, late winner', () => {
  const m = new Match(7),
    home = m.players[9],
    away = m.players[20];
  assert.deepEqual(score(m, home, 600).story, ['opener', 'go-ahead']);
  assert.deepEqual(score(m, away, 1200).story, ['equaliser']);
  assert.deepEqual(score(m, away, 2000).story, ['go-ahead', 'comeback', 'brace']);
  assert.deepEqual(score(m, home, 85 * 60).story, ['equaliser', 'brace', 'late']);
  const last = score(m, home, 88 * 60);
  assert.deepEqual(last.story, ['go-ahead', 'comeback', 'hat-trick', 'late']);
  assert.deepEqual(last.scoreAfter, [3, 2]);
  assert.equal(last.situation, 'open play');
  m.finalizeStory();
  assert.deepEqual(last.story.slice(-2), ['winner', 'late winner']);
  assert.ok(!m.goalHistory[0].story.includes('winner'));
});

test('near misses: just wide or over the bar, not a clear miss', () => {
  for (const [y, z, expected] of [
    [34 + GOAL / 2 + 0.35, 0.5, 'wide'],
    [34, 2.44 + 0.3, 'over'],
    [34 + GOAL / 2 + 1.2, 0.5, null],
  ]) {
    const m = new Match(8),
      p = m.players[9];
    p.x = 90;
    p.y = 34;
    m.mode = 'play';
    m.shoot(p);
    m.ball.previous = { x: 104.6, y, z };
    m.ball.x = 105.4;
    m.ball.y = y;
    m.ball.z = z;
    m.checkBounds();
    const miss = m.events.find(e => e.type === 'near-miss');
    assert.equal(miss?.miss ?? null, expected);
    if (miss) {
      assert.ok(miss.by > 0 && miss.by < 0.6);
      assert.equal(miss.shotEventId, m.events.find(e => e.type === 'shot').id);
    }
  }
});

test('a parry is dangerous only when an attacker reaches the rebound first', () => {
  const m = new Match(9),
    g = m.players[11];
  for (const p of m.players) {
    p.x = 50;
    p.y = 10;
  }
  g.x = m.abs(1, 1);
  g.y = 34;
  Object.assign(m.ball, { x: g.x, y: 34, vx: 0, vy: 8 });
  const striker = m.players[9];
  striker.x = m.abs(4, 1);
  striker.y = 37.6;
  assert.equal(m.reboundDanger(g), true);
  const cb = m.players[13];
  cb.x = m.abs(3.5, 1);
  cb.y = 37.6;
  striker.x = m.abs(12, 1);
  assert.equal(m.reboundDanger(g), false);
});

test('mentality is a validated, exported tactic that defaults to balanced', () => {
  const m = new Match(10);
  assert.deepEqual(MENTALITIES, ['auto', 'push', 'balanced', 'hold']);
  assert.equal(m.teams[0].tactics.mentality, 'balanced');
  assert.equal(m.setTactic(0, 'mentality', 'push'), true);
  assert.equal(m.setTactic(1, 'mentality', 'all-out'), undefined);
  assert.equal(m.teams[1].tactics.mentality, 'balanced');
  const config = m.exportConfig();
  assert.equal(config.teams[0].tactics.mentality, 'push');
  const copy = new Match(10);
  copy.importConfig(config);
  assert.equal(copy.teams[0].tactics.mentality, 'push');
  config.teams[1].tactics.mentality = 'bogus';
  delete config.teams[0].tactics.mentality;
  copy.importConfig(config);
  assert.deepEqual(
    copy.teams.map(t => t.tactics.mentality),
    ['balanced', 'balanced'],
  );
});

test("an 'auto' mentality follows the game state without changing the chosen tactic", () => {
  const m = new Match(12);
  assert.equal(m.setTactic(0, 'mentality', 'auto'), true);
  assert.equal(m.mentality(0), 'balanced');
  m.score = [0, 1];
  m.time = 60 * 60;
  assert.equal(m.mentality(0), 'balanced', 'not yet late');
  m.time = 72 * 60;
  assert.equal(m.mentality(0), 'push', 'behind after 70 minutes');
  assert.equal(m.settings(0).lean, 1);
  m.score = [2, 1];
  assert.equal(m.mentality(0), 'balanced', 'ahead, but not yet 75');
  m.time = 80 * 60;
  assert.equal(m.mentality(0), 'hold');
  assert.equal(m.settings(0).lean, -1);
  assert.equal(m.teams[0].tactics.mentality, 'auto', 'the setting itself is kept');
  assert.equal(m.exportConfig().teams[0].tactics.mentality, 'auto');
  // A manual choice is not overridden.
  m.setTactic(0, 'mentality', 'push');
  assert.equal(m.mentality(0), 'push');
  assert.equal(m.mentality(1), 'balanced');
});

test('links chemistry is bounded, exported and added to every skill', () => {
  const m = new Match(11),
    config = m.exportConfig();
  assert.equal(config.players[9].chem, 0);
  const plain = new Match(11);
  plain.importConfig(structuredClone(config));
  Object.assign(config.players[9], { chem: 1.5 });
  Object.assign(config.players[1], { chem: 7 });
  Object.assign(config.players[2], { chem: -3 });
  Object.assign(config.players[3], { chem: 'lots' });
  config.players[4].attrs = { ...config.players[4].attrs, pace: 99 };
  config.players[4].chem = 2;
  m.importConfig(config);
  assert.deepEqual(
    [9, 1, 2, 3].map(i => m.players[i].chem),
    [1.5, 2, 0, 0],
  );
  for (const key of ['pace', 'shooting', 'composure'])
    assert.ok(Math.abs(m.players[9].skill(key) - plain.players[9].skill(key) - 1.5) < 1e-9);
  assert.ok(m.players[4].skill('pace') <= 99);
  assert.equal(m.exportConfig().players[9].chem, 1.5);
  assert.equal(m.playerProfile(m.players[1]).chem, 2);
});

test('highlights rank chances by xG and drama, and still keep every goal', () => {
  const events = [
    { type: 'goal', elapsed: 100 },
    { type: 'shot', elapsed: 30, xg: 0.03, outcome: 'off target' },
    { type: 'shot', elapsed: 60, xg: 0.45, bigChance: true, outcome: 'saved' },
    { type: 'tackle', elapsed: 200, strength: 0.4 },
  ];
  const clips = selectHighlights(events, 300, 14);
  const covered = t => clips.some(c => t >= c.start && t <= c.end);
  assert.ok(covered(100));
  assert.ok(covered(60));
  assert.ok(!covered(30));
  assert.ok(
    highlightScore({ type: 'save', difficulty: 0.9, xg: 0.3 }) >
      highlightScore({ type: 'save', difficulty: 0.1, xg: 0.03 }),
  );
  assert.ok(highlightScore({ type: 'red' }) > highlightScore({ type: 'yellow' }));
  assert.equal(highlightScore({ type: 'restart' }), 0);
});
