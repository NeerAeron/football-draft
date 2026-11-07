import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../app/core/sim/engine.js';
import { FORMATIONS, formationLabel } from '../app/core/players/formations.js';
import { tacticAccess } from '../app/core/sim/coach.js';
import { playerTier, POSITIONS } from '../app/core/players/ratings.js';
import { preference } from '../app/core/sim/player-model.js';
import { TAGS } from '../app/core/players/traits.js';
import { loadRuntimeCatalog } from '../scripts/data/catalog-file.mjs';
const profiles = loadRuntimeCatalog().players;
// In-match AI coach levels (competition.difficulty), as the pre-match screen maps them.
const COACH_LEVELS = ['veryeasy', 'easy', 'medium', 'hard', 'impossible'];
test('all formation variations have eleven usable roles and run without invalid motion', () => {
  assert.equal(Object.keys(FORMATIONS).length, 21);
  assert.equal(new Set(Object.keys(FORMATIONS).map(formationLabel)).size, 21);
  assert.equal(new Set(Object.values(FORMATIONS).map(rows => JSON.stringify(rows))).size, 21);
  for (const [id, rows] of Object.entries(FORMATIONS)) {
    assert.equal(rows.length, 11);
    assert.equal(rows[0][2], 'GK');
    assert.equal(rows[9][2], 'ST');
    assert.ok(
      rows.every(([x, y, role]) => x > 0 && x < 105 && y > 0 && y < 68 && POSITIONS.includes(role)),
    );
    const m = new Match(16, 180);
    m.setTactic(0, 'formation', id);
    m.setTactic(1, 'formation', id);
    m.reset();
    for (let i = 0; i < 600; i++) m.step(1 / 60);
    for (const p of m.players) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  }
});
test('tier boundaries use natural overall and enforce the same tag cap in source and runtime', () => {
  for (const [rating, name, capacity] of [
    [67, 'Bench', 2],
    [68, 'Normal', 2],
    [73, 'Normal', 2],
    [74, 'Starter', 3],
    [79, 'Starter', 3],
    [80, 'Star', 5],
    [82, 'Star', 5],
    [83, 'Star', 5],
    [84, 'Star', 5],
    [85, 'Superstar', 7],
    [99, 'Superstar', 7],
  ]) {
    const m = new Match(),
      p = m.players[0];
    p.attrs.goalkeeping = rating;
    p.primaryPosition = 'GK';
    assert.equal(playerTier(p).name, name);
    assert.equal(playerTier(p).capacity, capacity);
    p.role = 'ST';
    p.energy = 0.01;
    assert.equal(playerTier(p).capacity, capacity);
    assert.equal(
      m.setTags(
        0,
        TAGS.map(t => t.id),
      ).length,
      capacity,
    );
  }
  for (const p of profiles) assert.ok(p.tags.length <= playerTier(p).capacity);
  assert.ok(profiles.some(p => p.tags.length > 5));
});
test('PvP tactics remain locked during a manual pause and unlock only at halftime; AI control stays separate', () => {
  for (const team of [0, 1]) {
    assert.ok(tacticAccess('pvp', team));
    assert.equal(tacticAccess('pvp', team, { started: true }), false);
    assert.ok(tacticAccess('pvp', team, { started: true, halftime: true }));
  }
  assert.ok(tacticAccess('ai', 0, { started: true }));
  assert.equal(tacticAccess('ai', 1, { halftime: true }), false);
  assert.ok(tacticAccess('sandbox', 1, { started: true }));
  assert.equal(tacticAccess('sandbox', 0, { finished: true }), false);
});
test('halftime position swaps preserve identity, stats and energy without changing the goalkeeper anchor', () => {
  const m = new Match(17);
  m.mode = 'halftime';
  m.elapsed = 160;
  const a = m.players[2],
    b = m.players[9];
  a.stats.goals = 2;
  a.energy = 0.61;
  const id = a.id,
    slot = a.slot;
  assert.ok(m.swapLineup(a.id, b.id));
  assert.equal(a.id, id);
  assert.equal(a.stats.goals, 2);
  assert.equal(a.energy, 0.61);
  assert.equal(b.slot, slot);
  assert.equal(a.role, 'ST');
  assert.equal(m.swapLineup(0, 2), false);
  m.mode = 'play';
  assert.equal(m.swapLineup(2, 9), false);
});
test('draft positions and formations stay locked outside halftime', () => {
  for (const mode of ['ai', 'pvp'])
    for (const phase of ['restart', 'play', 'fulltime']) {
      const m = new Match(17);
      m.competition = { mode, difficulty: 'hard' };
      m.mode = phase;
      m.elapsed = phase === 'restart' ? 0 : 90;
      const before = m.exportConfig(),
        positions = m.players.map(p => [p.id, p.slot, p.role]);
      for (const team of [0, 1]) {
        assert.equal(m.swapLineup(team * 11 + 2, team * 11 + 9), false);
        assert.equal(
          m.swapLineup(team * 11 + 2, team * 11 + 3),
          false,
          'same-role slots cannot be exchanged either',
        );
        assert.equal(m.setTactic(team, 'formation', '442'), false);
        assert.equal(m.setPlayerProfile(team * 11 + 6, profiles[0]), false);
      }
      assert.deepEqual(m.exportConfig(), before);
      assert.deepEqual(
        m.players.map(p => [p.id, p.slot, p.role]),
        positions,
      );
      const replay = new Match(17, 300);
      replay.importConfig(before);
      assert.ok(replay.lineupFixed());
      assert.equal(replay.swapLineup(2, 9), false);
      replay.reset();
      assert.ok(replay.lineupFixed());
      assert.deepEqual(
        replay.players.map(p => [p.id, p.slot, p.role]),
        positions,
      );
      m.setTactic(0, 'tempo', 5);
      m.setTactic(0, 'style', 'counter');
      assert.equal(m.teams[0].tactics.tempo, 5);
      assert.equal(m.teams[0].tactics.style, 'counter');
    }
  const sandbox = new Match(17);
  assert.equal(sandbox.lineupFixed(), false);
  assert.ok(sandbox.swapLineup(2, 9));
  sandbox.setTactic(0, 'formation', '442');
  assert.equal(sandbox.teams[0].tactics.formation, '442');
});
test('drafted lineups unlock at halftime and relock when the second half starts', () => {
  for (const mode of ['ai', 'pvp']) {
    const m = new Match(17, 300);
    m.competition = { mode, difficulty: 'hard' };
    m.mode = 'halftime';
    m.elapsed = 160;
    const a = m.players[6],
      b = m.players[9];
    a.stats.goals = 2;
    a.energy = 0.61;
    const identities = m.players.map(p => p.name),
      resources = m.players.map(p => [p.energy, { ...p.stats }]);
    assert.equal(m.lineupFixed(), false);
    assert.ok(m.swapLineup(a.id, b.id));
    m.setTactic(0, 'formation', '442');
    assert.equal(m.teams[0].tactics.formation, '442');
    assert.equal(a.slot, 9);
    assert.equal(a.role, 'ST');
    assert.equal(b.slot, 6);
    assert.equal(b.role, FORMATIONS['442'][6][2]);
    assert.equal(m.setPlayerProfile(6, profiles[0]), false);
    assert.equal(m.swapLineup(0, 2), false);
    const positions = m.players.map(p => [p.slot, p.role]);
    assert.deepEqual(
      m.players.map(p => p.name),
      identities,
    );
    assert.deepEqual(
      m.players.map(p => [p.energy, { ...p.stats }]),
      resources,
    );
    assert.ok(m.resumeHalf());
    assert.ok(m.lineupFixed());
    assert.equal(m.swapLineup(6, 9), false);
    assert.equal(m.setTactic(0, 'formation', '433'), false);
    assert.deepEqual(
      m.players.map(p => [p.slot, p.role]),
      positions,
    );
    assert.deepEqual(
      m.players.map(p => [p.energy, { ...p.stats }]),
      resources,
    );
  }
});
test('tags and attributes independently change decisions, and slow CBs leave more recovery space', () => {
  const m = new Match(18),
    p = m.players[2];
  p.tags = [];
  p.tendencies.carry = 0.5;
  p.attrs.dribbling = 30;
  const low = preference(p, 'carry');
  p.attrs.dribbling = 95;
  const skilled = preference(p, 'carry');
  p.tags = ['dribbler'];
  assert.ok(skilled > low);
  assert.ok(preference(p, 'carry') > skilled);
  const targets = [];
  for (const speed of [35, 90]) {
    const game = new Match(18),
      cb = game.players[2],
      owner = game.players[6];
    game.mode = 'play';
    owner.x = 75;
    owner.y = 34;
    game.own(owner);
    cb.attrs.pace = cb.attrs.acceleration = speed;
    game.plan();
    targets.push(cb.tx);
  }
  assert.ok(targets[0] < targets[1] - 1, JSON.stringify(targets));
});
test('difficulty has no execution, aiming, pace, power or reaction modifiers', () => {
  const m = new Match(57),
    config = m.exportConfig(),
    baseline = m.players.map(p =>
      Object.fromEntries(Object.keys(p.attrs).map(k => [k, p.skill(k)])),
    );
  for (const mode of ['sandbox', 'pvp', 'ai'])
    for (const difficulty of COACH_LEVELS) {
      config.competition = { mode, difficulty };
      m.importConfig(config);
      assert.deepEqual(
        m.players.map(p => Object.fromEntries(Object.keys(p.attrs).map(k => [k, p.skill(k)]))),
        baseline,
      );
      assert.ok(m.players.every(p => p.simulation === undefined));
    }
});
