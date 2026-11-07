import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeCatalog } from '../scripts/data/catalog-file.mjs';
import { createDraftSession } from '../app/core/draft/session.js';
import {
  createCupRun,
  restoreCupRun,
  standings,
  cupGrade,
  projectRun,
  CUP_ROUNDS,
  cupOffsets,
} from '../app/core/competition/cup.js';
import {
  outcomeProbabilities,
  simulateResult,
  simulateShootout,
} from '../app/core/competition/model.js';
import { ladderTarget, MODE_BASELINES } from '../app/core/draft/opponents.js';
import { DEFAULT_CONFIG } from '../app/core/config/config.js';
import { lcg } from '../app/core/util/rng.js';

const catalog = loadRuntimeCatalog();
const drafted = seed => {
  const s = createDraftSession(catalog, { seed, mode: 'nations' });
  while (!s.complete) {
    s.spin();
    s.pick(s.suggestPick().profileId);
  }
  return s.matchSide(0);
};
const user = drafted(21);
const win = { goalsFor: 2, goalsAgainst: 0 };

test('group table: points, goal difference, goals, head-to-head, then lots', () => {
  const f = (home, away, a, b) => ({ home, away, score: [a, b] });
  // A and B level on 6 pts, GD +1, GF 4: A beat B -> A first on head-to-head.
  const fixtures = [
    f('A', 'B', 1, 0),
    f('C', 'D', 0, 0),
    f('A', 'C', 0, 2),
    f('B', 'D', 2, 1),
    f('A', 'D', 3, 1),
    f('B', 'C', 2, 1),
  ];
  const table = standings(['B', 'A', 'C', 'D'], fixtures);
  assert.deepEqual(
    table.map(r => [r.key, r.points, r.gd, r.gf]),
    [
      ['A', 6, 1, 4],
      ['B', 6, 1, 4],
      ['C', 4, 1, 3],
      ['D', 1, -3, 2],
    ],
  );
  assert.deepEqual(
    table.map(r => r.decidedBy),
    ['headToHead', 'points', 'points', null],
  );
  assert.deepEqual(table[0], {
    key: 'A',
    played: 3,
    won: 2,
    drawn: 0,
    lost: 1,
    gf: 4,
    ga: 3,
    gd: 1,
    points: 6,
    position: 1,
    decidedBy: 'headToHead',
  });
  // Everyone on 4 points: goal difference, then goals scored (before head-to-head).
  const gd = standings(
    ['A', 'B', 'C', 'D'],
    [
      f('A', 'B', 2, 2),
      f('C', 'D', 1, 1),
      f('A', 'C', 2, 0),
      f('B', 'D', 1, 0),
      f('A', 'D', 0, 1),
      f('B', 'C', 0, 1),
    ],
  );
  assert.deepEqual(
    gd.map(r => [r.key, r.points, r.gd, r.gf, r.decidedBy]),
    [
      ['A', 4, 1, 4, 'goalDifference'],
      ['B', 4, 0, 3, 'goalsFor'],
      ['D', 4, 0, 2, 'goalDifference'],
      ['C', 4, -1, 2, null],
    ],
  );
  // All goalless: the drawing of lots decides.
  const lots = ['C', 'A', 'D', 'B'],
    even = standings(
      ['A', 'B', 'C', 'D'],
      [
        f('A', 'B', 0, 0),
        f('C', 'D', 0, 0),
        f('A', 'C', 0, 0),
        f('B', 'D', 0, 0),
        f('A', 'D', 0, 0),
        f('B', 'C', 0, 0),
      ],
      lots,
    );
  assert.deepEqual(
    even.map(r => r.key),
    lots,
  );
  assert.deepEqual(
    even.map(r => r.decidedBy),
    ['lots', 'lots', 'lots', null],
  );
});

test('a run draws a weaker group, escalating knockouts and never repeats an opponent', () => {
  const run = createCupRun(catalog, { mode: 'nations', difficulty: 'pro', seed: 5, user });
  const keys = run.opponents.map(o => o.key);
  assert.equal(new Set(keys).size, 7);
  const offsets = cupOffsets('pro');
  run.opponents.forEach((o, i) => {
    assert.equal(o.target, ladderTarget('nations', 'pro', { offset: offsets[i] }));
    assert.ok(Math.abs(o.nominal - o.target) <= 1.5, o.name);
  });
  const group = run.opponents.slice(0, 3).map(o => o.effective),
    knockout = run.opponents.slice(3).map(o => o.effective);
  assert.deepEqual(
    group,
    [...group].sort((a, b) => a - b),
    'weakest group opponent first',
  );
  assert.ok(Math.max(...group) < Math.max(...knockout));
  const snap = run.snapshot();
  assert.deepEqual(
    snap.rounds.slice(0, 3).map(r => r.opponent.pot),
    [4, 3, 2],
  );
  // Nobody plays for both sides.
  const mine = new Set(user.players.map(p => p.profileId));
  for (let r = 0; r < 7; r++)
    assert.ok(run.opponentSide(r).players.every(p => !mine.has(p.profileId)));
  const next = run.nextMatch();
  assert.equal(next.knockout, false);
  assert.equal(next.home.players.length, 11);
  assert.equal(next.seed, run.matchSeed(0));
});

test('seven wins make a perfect run: S+ and the champion status', () => {
  const run = createCupRun(catalog, { mode: 'nations', difficulty: 'semipro', seed: 8, user });
  for (let r = 0; r < 7; r++) {
    assert.equal(run.nextMatch().id, CUP_ROUNDS[r].id);
    assert.equal(run.nextMatch().knockout, r >= 3);
    run.recordResult(win);
  }
  const snap = run.snapshot();
  assert.equal(snap.status, 'champion');
  assert.deepEqual(snap.record, { w: 7, d: 0, l: 0, gf: 14, ga: 0, played: 7 });
  assert.deepEqual(
    [snap.grade.grade, snap.grade.verdict, snap.stageLabel],
    ['S+', 'Perfect Seven', 'Champions'],
  );
  assert.equal(snap.group.table[0].user, true);
  assert.equal(run.nextMatch(), null);
  assert.throws(() => run.recordResult(win), /over/);
});

test('group elimination, knockout shootouts and draws in the record', () => {
  const out = createCupRun(catalog, { mode: 'nations', difficulty: 'pro', seed: 3, user });
  for (let r = 0; r < 3; r++) out.recordResult({ goalsFor: 0, goalsAgainst: 1 });
  assert.equal(out.status, 'eliminated');
  assert.equal(out.stage(), 'group');
  assert.deepEqual(out.grade(), cupGrade({ stage: 'group', record: { w: 0, d: 0, l: 3 } }));
  assert.equal(out.grade().verdict, 'Early Flight Home');
  const run = createCupRun(catalog, { mode: 'nations', difficulty: 'pro', seed: 3, user });
  for (let r = 0; r < 3; r++) run.recordResult(win);
  assert.throws(() => run.recordResult({ goalsFor: 1, goalsAgainst: 1 }), /shootout/);
  run.recordResult({ goalsFor: 1, goalsAgainst: 1, shootout: { winner: 'user', score: [4, 3] } });
  assert.equal(run.status, 'playing');
  run.recordResult({ goalsFor: 0, goalsAgainst: 0, shootout: { winner: 'opponent' } });
  const snap = run.snapshot();
  assert.equal(snap.stage, 'qf');
  assert.deepEqual(snap.results, ['W', 'W', 'W', 'D', 'D']);
  assert.deepEqual([snap.grade.grade, snap.grade.verdict], ['C', 'Quarter-finalists']);
  assert.deepEqual(snap.rounds[3].result.shootout, { winner: 'user', score: [4, 3] });
});

test('grades: S+ to F with named verdicts', () => {
  const g = (stage, w, d, l, pens) =>
    cupGrade({ stage, record: { w, d, l }, lostOnPenalties: pens });
  assert.deepEqual(
    [
      g('champion', 7, 0, 0),
      g('champion', 6, 1, 0),
      g('champion', 6, 0, 1),
      g('final', 6, 0, 1),
      g('final', 5, 1, 0, true),
      g('sf', 5, 0, 1),
      g('sf', 4, 1, 1),
      g('qf', 4, 0, 1),
      g('qf', 2, 2, 1),
      g('r16', 2, 0, 2),
      g('r16', 2, 1, 1, true),
      g('group', 1, 0, 2),
    ].map(x => `${x.grade} ${x.verdict}`),
    [
      'S+ Perfect Seven',
      'S Invincibles',
      'A+ World Champions',
      'A Final Heartbreak',
      'A Heartbreak on Penalties',
      'B+ Semi-final Heartbreak',
      'B Semi-finalists',
      'C+ Quarter-final Heartbreak',
      'C Quarter-finalists',
      'D Round of 16 Exit',
      'D Out on Penalties',
      'F Group Stage Exit',
    ],
  );
});

test('AI-vs-AI group results come from the seed, not from the user’s results', () => {
  const a = createCupRun(catalog, { mode: 'nations', difficulty: 'pro', seed: 44, user }),
    b = createCupRun(catalog, { mode: 'nations', difficulty: 'pro', seed: 44, user });
  for (let r = 0; r < 3; r++) {
    a.recordResult(win);
    b.recordResult({ goalsFor: 0, goalsAgainst: 3 });
  }
  const ai = run =>
    run.group.fixtures.filter(f => f.home !== 'user' && f.away !== 'user').map(f => f.score);
  assert.deepEqual(ai(a), ai(b));
  assert.ok(ai(a).every(s => s.every(Number.isInteger)));
  const c = createCupRun(catalog, { mode: 'nations', difficulty: 'pro', seed: 44, user });
  assert.deepEqual(
    c.opponents.map(o => o.key),
    a.opponents.map(o => o.key),
  );
});

test('Player of the Tournament and Held you back from match ratings', () => {
  const run = createCupRun(catalog, { mode: 'nations', difficulty: 'pro', seed: 12, user });
  const ids = user.players.map(p => p.profileId);
  assert.ok(run.heldYouBack(1)[0].reason, 'works before any rated match');
  for (let r = 0; r < 3; r++)
    run.recordResult({
      ...win,
      players: ids.map((profileId, i) => ({
        profileId,
        rating: i === 9 ? 8.5 : i === 4 ? 5.1 : 6.5,
        goals: i === 9 ? 2 : 0,
      })),
    });
  const potm = run.playerOfTheTournament();
  assert.equal(potm.profileId, ids[9]);
  assert.equal(potm.average, 8.5);
  assert.equal(potm.goals, 6);
  const held = run.heldYouBack(2);
  assert.equal(held[0].profileId, ids[4]);
  assert.equal(held[0].average, 5.1);
  assert.ok(typeof held[0].reason === 'string' && held[0].reason.length > 5);
  assert.equal(held.length, 2);
  // A "weakest link" is measured against the Team OVR the screens show, with one decimal.
  for (const h of run.heldYouBack(11).filter(h => h.reason.startsWith('Weakest link')))
    assert.equal(
      h.reason,
      `Weakest link: ${h.slotRating} OVR vs Team OVR ${run.user.rating.toFixed(1)}`,
    );
});

test('serialize/restore round-trips a run mid-tournament', () => {
  const run = createCupRun(catalog, {
    mode: 'clubs',
    difficulty: 'worldclass',
    seed: 2,
    user: drafted(9),
  });
  run.simulateNext();
  run.simulateNext();
  const copy = restoreCupRun(catalog, JSON.parse(JSON.stringify(run.serialize())));
  assert.deepEqual(copy.snapshot(), run.snapshot());
  while (!run.complete) run.simulateNext();
  while (!copy.complete) copy.simulateNext();
  assert.deepEqual(copy.serialize(), run.serialize());
  assert.throws(() => restoreCupRun(catalog, { type: 'cup-run', format: 99 }), /Not a saved run/);
  assert.ok(JSON.stringify(run.serialize()).length < 20000, 'small enough for localStorage');
});

test('rating model: probabilities, determinism, shootouts and projections', () => {
  const even = outcomeProbabilities(80, 80);
  assert.ok(Math.abs(even.win - even.loss) < 1e-9);
  assert.ok(Math.abs(even.win + even.draw + even.loss - 1) < 1e-9);
  assert.ok(outcomeProbabilities(87, 80).win > 0.5);
  assert.ok(outcomeProbabilities(92, 80).win > 0.75);
  const r1 = simulateResult(84, 80, lcg(7), { knockout: true }),
    r2 = simulateResult(84, 80, lcg(7), { knockout: true });
  assert.deepEqual(r1, r2);
  let draws = 0;
  for (let s = 1; s <= 200; s++) {
    const r = simulateResult(80, 80, lcg(s), { knockout: true });
    if (r.goals[0] === r.goals[1]) {
      draws++;
      assert.ok(r.shootout && r.shootout.score[0] !== r.shootout.score[1]);
      assert.equal(r.shootout.winner, r.shootout.score[0] > r.shootout.score[1] ? 0 : 1);
    } else assert.equal(r.shootout, null);
  }
  assert.ok(draws > 20);
  const pens = simulateShootout(80, 80, lcg(3));
  assert.ok(pens.score.every(n => n >= 0 && n <= 30));
  const weak = projectRun({ rating: 78, mode: 'nations', difficulty: 'pro' }),
    strong = projectRun({ rating: 88, mode: 'nations', difficulty: 'pro' });
  assert.ok(strong.probabilities.champion > weak.probabilities.champion);
  assert.ok(Math.abs(Object.values(weak.probabilities).reduce((a, b) => a + b, 0) - 1) < 0.02);
  assert.match(weak.label, /^Projected: /);
  assert.deepEqual(
    projectRun({ rating: 82, mode: 'nations' }),
    projectRun({ rating: 82, mode: 'nations' }),
  );
});

// Difficulty: what a typical drafted XI (the mode baseline) can expect, by the fitted model.
// Targets (docs/competition-api.md): Amateur 55–65% champions, Semi-pro ~35%, Pro ~20% with
// at most ~20% group exits, World Class 8–10%, Legendary 3–5%. Wide windows: projectRun is a
// Monte-Carlo against the exact round targets.
test('difficulty ladder: title odds fall level by level and finals are top sides', () => {
  const windows = {
    amateur: [0.5, 0.72],
    semipro: [0.27, 0.45],
    pro: [0.14, 0.27],
    worldclass: [0.05, 0.14],
    legendary: [0.015, 0.08],
  };
  let previous = 1;
  for (const [difficulty, [lo, hi]] of Object.entries(windows)) {
    const rerolls = DEFAULT_CONFIG.draft.rerolls[difficulty],
      rating = MODE_BASELINES.nations.effective[Math.min(2, rerolls)];
    const p = projectRun({ rating, mode: 'nations', difficulty, runs: 3000 }).probabilities;
    assert.ok(p.champion >= lo && p.champion <= hi, `${difficulty} champion ${p.champion}`);
    assert.ok(p.champion < previous, difficulty);
    previous = p.champion;
    if (difficulty === 'pro') assert.ok(p.group <= 0.22, `pro group exit ${p.group}`);
  }
  // The final is the strongest opponent of a run, and a recognisable side for the level.
  const finalFloor = { amateur: 78.5, semipro: 80.5, pro: 85, worldclass: 86, legendary: 87.5 };
  for (const [difficulty, floor] of Object.entries(finalFloor))
    for (const seed of [3, 4]) {
      const run = createCupRun(catalog, { mode: 'nations', difficulty, seed, user });
      const final = run.opponents[6].effective;
      assert.ok(final >= floor, `${difficulty} final ${run.opponents[6].name} ${final}`);
      assert.ok(
        run.opponents.slice(0, 6).every(o => o.effective <= final + 1.5),
        difficulty,
      );
    }
});
