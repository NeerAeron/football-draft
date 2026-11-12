// The player's side as favourite (tuning.userEdge): a slight save-balance edge for team 0
// against the AI when its XI has the higher overall — and in no other case.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../app/core/sim/engine.js';
import { overallRating } from '../app/core/players/ratings.js';
import { simulateHalf } from '../app/core/sim/replay.js';
import { DEFAULT_CONFIG } from '../app/core/config/config.js';

/** A match whose team `better` has every attribute `points` higher (the default XIs are equal). */
function match({ better = 0, points = 6, competition = { mode: 'ai' }, seed = 5, tuning } = {}) {
  const m = new Match(seed, 180),
    c = m.exportConfig();
  c.competition = competition;
  if (tuning) Object.assign(c.tuning.userEdge, tuning);
  c.players.forEach((p, i) => {
    if (Math.floor(i / 11) !== better) return;
    for (const key of Object.keys(p.attrs)) p.attrs[key] = Math.min(99, p.attrs[key] + points);
  });
  m.importConfig(c);
  return m;
}
const overall = (m, team) =>
  m.players.filter(p => p.team === team).reduce((s, p) => s + overallRating(p, false), 0) / 11;

test('the edge is the lead in overall × perPoint, for the player’s side only', () => {
  const m = match();
  assert.equal(m.edge, null, 'not worked out before kick-off');
  const lead = overall(m, 0) - overall(m, 1);
  assert.ok(lead > 3 && lead < 9, `lead ${lead}`);
  m.step(1 / 60);
  assert.ok(Math.abs(m.edge[0] - lead * DEFAULT_CONFIG.userEdge.perPoint) < 1e-12);
  assert.equal(m.edge[1], 0);
  // Slight: a 5-point favourite gets 3%
  assert.ok(Math.abs(5 * DEFAULT_CONFIG.userEdge.perPoint - 0.03) < 1e-12);
  assert.ok(m.edge[0] < 0.06);
});

test('no edge for the weaker player, between equals, in Versus, a sandbox or an exhibition', () => {
  const none = [
    match({ better: 1 }), // the AI's side is the stronger one: it gets nothing either
    match({ points: 0 }),
    match({ competition: { mode: 'pvp' } }),
    match({ competition: { mode: 'sandbox' } }),
    match({ competition: { mode: 'ai', edge: false } }),
    match({ tuning: { perPoint: 0 } }),
  ];
  for (const m of none) {
    m.step(1 / 60);
    assert.deepEqual(m.edge, [0, 0]);
  }
});

test('the edge is capped, read once at kick-off and carried through a simulated half', async () => {
  const capped = match({ points: 30 });
  capped.step(1 / 60);
  assert.equal(capped.edge[0], DEFAULT_CONFIG.userEdge.cap);

  const m = match();
  m.step(1 / 60);
  const [edge] = m.edge;
  // The line-ups change after kick-off: the edge does not
  for (const p of m.players) if (p.team === 0) p.attrs.shooting = 20;
  for (let i = 0; i < 30; i++) m.step(1 / 60);
  assert.equal(m.edge[0], edge);
  m.pauseAtHalf = true;
  const { result } = await simulateHalf(m);
  assert.equal(result.edge[0], edge);
  // … and the same match again gives the same result (no extra draw from the match RNG)
  const again = match();
  again.step(1 / 60);
  for (const p of again.players) if (p.team === 0) p.attrs.shooting = 20;
  for (let i = 0; i < 30; i++) again.step(1 / 60);
  again.pauseAtHalf = true;
  const second = (await simulateHalf(again)).result;
  assert.deepEqual(second.score, result.score);
  assert.equal(second.rng, result.rng);
});

/** How many of `n` identical shots a keeper of `team` keeps out, with match.edge as given. */
function saves(team, edge, n = 400) {
  let kept = 0;
  for (let seed = 1; seed <= n; seed++) {
    const m = new Match(5, 180),
      g = m.players[team * 11],
      shooter = m.players[(1 - team) * 11 + 9],
      // team 0's keeper stands on x = 0, team 1's on x = 105 (first half)
      dir = team === 0 ? -1 : 1,
      line = team === 0 ? 0 : 105;
    m.mode = 'play';
    m.edge = edge;
    Object.assign(g, { x: line - dir * 0.8, y: 34, vx: 0, vy: 0 });
    Object.assign(m.ball, {
      x: line - dir * 1.8,
      y: 34.75,
      z: 0.6,
      vx: dir * 24,
      vy: 0,
      vz: 0,
      owner: null,
      kind: 'shot',
      age: 0.5,
      shotTeam: 1 - team,
      kicker: shooter.id,
      saver: null,
      shotType: 'Driven shot',
      shotOrigin: { x: line - dir * 14, y: 34, attackX: 91, box: true, zone: 'deep_central' },
      shotRecord: { team: 1 - team, player: shooter.id, eventId: 1, xg: 0.3, status: 'in flight' },
    });
    m.rng = seed * 48271;
    if (m.keeperSave(g)) kept++;
  }
  return kept;
}

test('a favourite’s keeper saves a little more, the keeper facing it a little less', () => {
  const edge = [0.05, 0];
  const plain = [saves(0, [0, 0]), saves(1, [0, 0])],
    tilted = [saves(0, edge), saves(1, edge)];
  assert.ok(plain[0] > 80 && plain[0] < 380, `a save that can go either way: ${plain[0]}/400`);
  assert.ok(tilted[0] > plain[0], `own keeper ${plain[0]} → ${tilted[0]}`);
  assert.ok(tilted[1] < plain[1], `opposing keeper ${plain[1]} → ${tilted[1]}`);
  // Slight: within a few saves in a hundred
  assert.ok(tilted[0] - plain[0] < 40 && plain[1] - tilted[1] < 40);
  // Without an edge (or before kick-off) nothing changes
  assert.equal(saves(0, null), plain[0]);
});
