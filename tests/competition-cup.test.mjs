import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeCatalog } from '../scripts/data/catalog-file.mjs';
import { createDraftSession } from '../app/core/draft/session.js';
import {
  createCupRun,
  restoreCupRun,
  standings,
  worldCupDraw,
  PLACES,
  THIRD_ROUND,
  FIELD_TYPICAL,
  projectRun,
  CUP_ROUNDS,
  cupOffsets,
  thirdQualifies,
  BEST_THIRD,
} from '../app/core/competition/cup.js';
import {
  outcomeProbabilities,
  simulateResult,
  MATCH_MODEL,
  simulateShootout,
} from '../app/core/competition/model.js';
import { ladderTarget, MODE_BASELINES, opponentCandidates } from '../app/core/draft/opponents.js';
import { catalogIndex } from '../app/core/draft/pools.js';
import { DEFAULT_CONFIG } from '../app/core/config/config.js';
import { lcg } from '../app/core/util/rng.js';
import { FORMATIONS } from '../app/core/players/formations.js';

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
  // Group ×3, five knockouts and the third-place play-off opponent; real nations only.
  assert.equal(new Set(keys).size, 9);
  assert.ok(run.opponents.every(o => o.kind === 'nation'));
  assert.deepEqual(
    CUP_ROUNDS.map(r => r.id),
    ['group1', 'group2', 'group3', 'r32', 'r16', 'qf', 'sf', 'final'],
  );
  const offsets = cupOffsets('pro');
  // (The group plays weakest first by what the XI is worth, which need not be target order.)
  const targets = offsets.map(offset => ladderTarget('nations', 'pro', { offset }));
  assert.deepEqual(
    run.opponents
      .slice(0, 3)
      .map(o => o.target)
      .sort(),
    targets.slice(0, 3).sort(),
  );
  // Each opponent is within 1.5 of its target — or, for a target under the weakest of the 56
  // playable nations (Pro's first group match), within 1.5 of that floor.
  const floor = Math.min(
    ...opponentCandidates(catalog)
      .filter(c => c.kind === 'nation')
      .map(c => c.effective),
  );
  // (Pro's first group target sits under that floor: the match is against the weakest nation.)
  assert.ok(Math.min(...targets) > floor - 3, 'the weakest target is near the weakest nation');
  run.opponents.forEach((o, i) => {
    if (i >= 3) assert.equal(o.target, targets[i]);
    assert.ok(Math.abs(o.nominal - Math.max(o.target, floor)) <= 1.5, o.name);
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
  for (let r = 0; r < CUP_ROUNDS.length; r++)
    assert.ok(run.opponentSide(r).players.every(p => !mine.has(p.profileId)));
  const next = run.nextMatch();
  assert.equal(next.knockout, false);
  assert.equal(next.home.players.length, 11);
  assert.equal(next.seed, run.matchSeed(0));
});

test('eight wins make a perfect run: champions, gold', () => {
  const run = createCupRun(catalog, { mode: 'nations', difficulty: 'worldclass', seed: 8, user });
  for (let r = 0; r < 8; r++) {
    assert.equal(run.nextMatch().id, CUP_ROUNDS[r].id);
    assert.equal(run.nextMatch().knockout, r >= 3);
    run.recordResult(win);
  }
  const snap = run.snapshot();
  assert.equal(snap.status, 'champion');
  assert.deepEqual(snap.record, { w: 8, d: 0, l: 0, gf: 16, ga: 0, played: 8 });
  assert.deepEqual(
    [snap.place, snap.placeLabel, snap.stageLabel, snap.medal, snap.perfect],
    ['champion', 'Champions', 'Champions', 'gold', true],
  );
  assert.equal('grade' in snap, false);
  assert.equal(snap.group.table[0].user, true);
  assert.equal(run.nextMatch(), null);
  assert.throws(() => run.recordResult(win), /over/);
});

test('group elimination, knockout shootouts and draws in the record', () => {
  const out = createCupRun(catalog, { mode: 'nations', difficulty: 'pro', seed: 3, user });
  for (let r = 0; r < 3; r++) out.recordResult({ goalsFor: 0, goalsAgainst: 1 });
  assert.equal(out.status, 'eliminated');
  assert.equal(out.stage(), 'group');
  assert.deepEqual(
    [out.place(), out.snapshot().placeLabel, out.snapshot().medal],
    ['group', 'Group stage', null],
  );
  const run = createCupRun(catalog, { mode: 'nations', difficulty: 'pro', seed: 3, user });
  for (let r = 0; r < 3; r++) run.recordResult(win);
  assert.throws(() => run.recordResult({ goalsFor: 1, goalsAgainst: 1 }), /shootout/);
  assert.equal(run.nextMatch().id, 'r32');
  run.recordResult({
    goalsFor: 1,
    goalsAgainst: 1,
    extraTime: true,
    shootout: { winner: 'user', score: [4, 3] },
  });
  assert.equal(run.status, 'playing');
  run.recordResult(win);
  run.recordResult({ goalsFor: 0, goalsAgainst: 0, shootout: { winner: 'opponent' } });
  const snap = run.snapshot();
  assert.equal(snap.stage, 'qf');
  assert.deepEqual(snap.results, ['W', 'W', 'W', 'D', 'W', 'D']);
  assert.deepEqual([snap.place, snap.placeLabel, snap.medal], ['qf', 'Quarter-finals', null]);
  assert.deepEqual(snap.rounds[3].result.shootout, { winner: 'user', score: [4, 3] });
  assert.deepEqual(
    snap.rounds.slice(0, 6).map(r => r.result.extraTime),
    [false, false, false, true, false, false],
  );
});

test('a knockout tie settled in extra time is a win or a defeat, not a draw', () => {
  const run = createCupRun(catalog, { mode: 'nations', difficulty: 'pro', seed: 3, user });
  // A group match has no extra time, whatever the caller says.
  run.recordResult({ ...win, extraTime: true });
  assert.equal(run.snapshot().rounds[0].result.extraTime, false);
  run.recordResult(win);
  run.recordResult(win);
  // Round of 32: 2–1 after extra time. The score is the final one; the run goes on.
  run.recordResult({ goalsFor: 2, goalsAgainst: 1, extraTime: true });
  let snap = run.snapshot();
  assert.equal(run.status, 'playing');
  assert.deepEqual(snap.rounds[3].result, {
    goalsFor: 2,
    goalsAgainst: 1,
    outcome: 'W',
    extraTime: true,
    shootout: null,
  });
  assert.deepEqual(snap.record, { w: 4, d: 0, l: 0, gf: 8, ga: 1, played: 4 });
  // Round of 16: beaten in extra time. Out, with a defeat in the record.
  run.recordResult({ goalsFor: 1, goalsAgainst: 2, extraTime: true });
  snap = run.snapshot();
  assert.equal(run.status, 'eliminated');
  assert.equal(snap.place, 'r16');
  assert.deepEqual(snap.results, ['W', 'W', 'W', 'W', 'L']);
  assert.equal(snap.rounds[4].result.extraTime, true);
  // It survives a save, and the fast model reports its own extra time the same way.
  const copy = restoreCupRun(catalog, JSON.parse(JSON.stringify(run.serialize())));
  assert.deepEqual(copy.snapshot(), snap);
  let seen = 0;
  for (let seed = 1; seed <= 60 && !seen; seed++) {
    const sim = createCupRun(catalog, { mode: 'nations', difficulty: 'pro', seed, user });
    while (!sim.complete) sim.simulateNext();
    for (const r of sim.snapshot().rounds) {
      if (!r.result?.extraTime) continue;
      seen++;
      assert.equal(r.knockout, true);
      if (r.result.shootout) assert.equal(r.result.outcome, 'D');
      else assert.notEqual(r.result.outcome, 'D');
    }
  }
  assert.ok(seen > 0, 'no simulated run went to extra time');
});

test('places: the semi-final loser plays for third; runners-up, third and fourth', () => {
  assert.deepEqual(PLACES, ['group', 'r32', 'r16', 'qf', 'fourth', 'third', 'final', 'champion']);
  const loss = { goalsFor: 0, goalsAgainst: 1 };
  const upTo = (n, seed = 6) => {
    const run = createCupRun(catalog, { mode: 'nations', difficulty: 'pro', seed, user });
    for (let r = 0; r < n; r++) run.recordResult(win);
    return run;
  };
  // Lost final: runners-up, silver.
  const second = upTo(7);
  assert.equal(second.snapshot().rounds[7].id, 'final');
  second.recordResult(loss);
  let snap = second.snapshot();
  assert.deepEqual(
    [snap.status, snap.place, snap.placeLabel, snap.medal],
    ['eliminated', 'final', 'Runners-up', 'silver'],
  );
  // Lost semi-final: the run goes on to the play-off against the other semi-final's loser.
  for (const [result, place, label, medal, record] of [
    [win, 'third', 'Third place', 'bronze', { w: 7, d: 0, l: 1 }],
    [loss, 'fourth', 'Fourth place', null, { w: 6, d: 0, l: 2 }],
    [
      { goalsFor: 1, goalsAgainst: 1, shootout: { winner: 'user', score: [5, 4] } },
      'third',
      'Third place',
      'bronze',
      { w: 6, d: 1, l: 1 },
    ],
  ]) {
    const run = upTo(6);
    const finalist = run.snapshot().rounds[7].opponent.key;
    run.recordResult(loss);
    assert.equal(run.status, 'playing');
    snap = run.snapshot();
    assert.deepEqual([snap.round, snap.stage, snap.stageLabel], [7, 'third', THIRD_ROUND.label]);
    assert.equal(snap.rounds.length, 8);
    assert.deepEqual(
      [snap.rounds[7].id, snap.rounds[7].label, snap.rounds[7].knockout],
      ['third', 'Third-place play-off', true],
    );
    const next = run.nextMatch();
    assert.equal(next.id, 'third');
    assert.equal(next.away.key, run.opponents[8].key);
    assert.notEqual(next.away.key, finalist);
    assert.equal(run.opponentSide(7).key, run.opponents[8].key);
    // Survives a save in between.
    const copy = restoreCupRun(catalog, JSON.parse(JSON.stringify(run.serialize())));
    assert.equal(copy.nextMatch().id, 'third');
    run.recordResult(result);
    snap = run.snapshot();
    assert.deepEqual(
      [snap.status, snap.complete, snap.place, snap.stage, snap.placeLabel, snap.medal],
      ['eliminated', true, place, place, label, medal],
    );
    assert.equal(snap.results.length, 8);
    const { w, d, l } = snap.record;
    assert.deepEqual({ w, d, l }, record);
    assert.equal(snap.perfect, false);
    assert.equal(run.nextMatch(), null);
  }
  // Out before the semi-final: no play-off.
  const quarter = upTo(5);
  quarter.recordResult(loss);
  assert.deepEqual([quarter.status, quarter.place()], ['eliminated', 'qf']);
});

test('Legendary plays the real field: a drawn and simulated 48-nation World Cup', () => {
  // Every run qualifies its own 48 of the playable nations: the strongest 30 always, the rest
  // drawn with odds falling with the rating.
  const index = catalogIndex(catalog),
    playable = new Set(index.playable.map(n => 'nation:' + n.id)),
    core = index.playable.slice(0, 30).map(n => 'nation:' + n.id),
    weakest = 'nation:' + index.playable[11].id;
  const make = seed =>
    createCupRun(catalog, { mode: 'nations', difficulty: 'legendary', seed, user });
  const run = make(31);
  assert.equal(run.opponents.length, 9);
  assert.equal(new Set(run.opponents.map(o => o.key)).size, 9);
  // The group: one nation from each of pots 2, 3 and 4 (you have the pot-1 seat).
  assert.deepEqual(
    run
      .snapshot()
      .rounds.slice(0, 3)
      .map(r => r.opponent.pot)
      .sort(),
    [2, 3, 4],
  );
  assert.ok(
    run.opponents.every(o => o.kind === 'nation' && playable.has(o.key) && o.target === null),
  );
  // Deterministic for the seed, different for another.
  assert.deepEqual(
    make(31).opponents.map(o => o.key),
    run.opponents.map(o => o.key),
  );
  assert.notDeepEqual(
    make(32).opponents.map(o => o.key),
    run.opponents.map(o => o.key),
  );
  const mine = new Set(user.players.map(p => p.profileId));
  for (const o of run.opponents) assert.ok(o.players.every(id => !mine.has(id)));
  // Serialisable, and playable to the end.
  const copy = restoreCupRun(catalog, JSON.parse(JSON.stringify(run.serialize())));
  while (!run.complete) run.simulateNext();
  while (!copy.complete) copy.simulateNext();
  assert.deepEqual(copy.serialize(), run.serialize());

  // The draw itself, over many seeds: the weakest pot-1 nation stays at home, the user's group
  // mates never come back, and the bracket gets harder round by round.
  const rating = new Map(opponentCandidates(catalog).map(c => [c.key, c.effective]));
  const sums = Array(9).fill(0),
    qualified = new Map(),
    N = 300;
  for (let seed = 1; seed <= N; seed++) {
    const draw = worldCupDraw(catalog, { random: lcg(seed) }),
      pot = draw.pots;
    assert.equal(new Set(draw.keys).size, 9);
    assert.ok(!draw.keys.includes(weakest));
    assert.deepEqual(draw.group.map(k => pot.get(k)).sort(), [2, 3, 4]);
    // 48 qualifiers in four pots of twelve by strength, the core among them.
    assert.equal(pot.size, 48);
    assert.ok(core.every(k => pot.has(k)));
    assert.ok([...pot.keys()].every(k => playable.has(k)));
    assert.deepEqual(
      [1, 2, 3, 4].map(n => [...pot.values()].filter(v => v === n).length),
      [12, 12, 12, 12],
    );
    assert.ok(
      [...pot].every(([k, v], i, all) => !i || (rating.get(k) !== undefined && v >= all[i - 1][1])),
    );
    for (const k of pot.keys()) qualified.set(k, (qualified.get(k) || 0) + 1);
    assert.deepEqual(draw.keys, [...draw.group, ...draw.knockouts, draw.third]);
    draw.keys.forEach((k, i) => (sums[i] += rating.get(k)));
  }
  const mean = sums.map(x => x / N),
    [r32, r16, qf, sf, final, third] = mean.slice(3);
  assert.ok(r32 < r16 && r16 < qf && qf < sf && sf < final, mean.map(x => x.toFixed(1)).join(' '));
  assert.ok(final > 85 && final < 88, `final ${final}`);
  assert.ok(Math.abs(third - sf) < 1.5, `play-off ${third} vs semi-final ${sf}`);
  // projectRun's targets for the level are these typical ratings (weakened XIs: a bit lower).
  FIELD_TYPICAL.slice(3).forEach((t, i) =>
    assert.ok(Math.abs(t - mean[3 + i]) < 1.5, `round ${3 + i}: ${t} vs ${mean[3 + i]}`),
  );
  // Outside a Nations draft there is no field: Legendary uses its ladder row.
  const clubs = createCupRun(catalog, {
    mode: 'clubs',
    difficulty: 'legendary',
    seed: 3,
    user: drafted(9),
  });
  assert.ok(clubs.opponents.every(o => o.kind === 'club' && o.target !== null));
});

test('third place goes through on BEST_THIRD: 4 points or more, nothing less', () => {
  const row = (points, gd) => ({ points, gd });
  assert.deepEqual(BEST_THIRD, { points: 4 });
  assert.equal(thirdQualifies(row(4, -6)), true);
  assert.equal(thirdQualifies(row(3, 5)), false);
  assert.equal(thirdQualifies(row(2, 0)), false);
  // Play W 1-0, D 1-1, L 0-1 (4 pts) and W 1-0, L 0-1, L 0-1 (3 pts) on seeds where you finish
  // third: the first goes through to the Round of 32, the second goes home.
  const thirdOn = (results, seeds) => {
    for (const seed of seeds) {
      const run = createCupRun(catalog, { mode: 'nations', difficulty: 'pro', seed, user });
      for (const [goalsFor, goalsAgainst] of results) run.recordResult({ goalsFor, goalsAgainst });
      const snap = run.snapshot();
      if (snap.group.table[2].user) return { run, snap };
    }
    return null;
  };
  const seeds = Array.from({ length: 300 }, (_, i) => i + 1);
  const through = thirdOn(
    [
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    seeds,
  );
  assert.ok(through, 'some seed puts you third');
  assert.equal(through.snap.status, 'playing');
  assert.equal(through.snap.group.table[2].qualifies, true);
  assert.equal(through.snap.group.table[3].qualifies, false);
  assert.equal(through.run.nextMatch().id, 'r32');
  const out = thirdOn(
    [
      [1, 0],
      [0, 1],
      [0, 1],
    ],
    seeds,
  );
  assert.ok(out, 'some seed puts you third');
  assert.equal(out.snap.status, 'eliminated');
  assert.equal(out.snap.group.table[2].qualifies, false);
  assert.equal(out.snap.stage, 'group');
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
  // One cut-off: an older format, a removed difficulty or mode, rules of an older shape (no
  // Captain, link thresholds) — not a saved run. Nothing is converted.
  const data = () => JSON.parse(JSON.stringify(run.serialize()));
  for (const old of [
    { format: 2 },
    { format: 1 },
    { format: undefined },
    { difficulty: 'amateur' },
    { difficulty: 'semipro' },
    { mode: 'clubAndCountry' },
    { opponents: data().opponents.slice(0, 8) },
    { rules: { ...data().rules, links: { nation: 1.5, club: 1 } } },
    { rules: { ...data().rules, links: { nation: { level1: 2 }, club: { level1: 2 } } } },
    { rules: null },
    { type: 'cup' },
  ])
    assert.throws(
      () => restoreCupRun(catalog, { ...data(), ...old }),
      /Not a saved run/,
      JSON.stringify(old).slice(0, 60),
    );
  for (const junk of [null, undefined, 'x', 3, [], {}])
    assert.throws(() => restoreCupRun(catalog, junk), /Not a saved run/);
  assert.ok(JSON.stringify(run.serialize()).length < 20000, 'small enough for localStorage');
});

test('the line-up is kept for the run; the draft formation stays for the group stage', () => {
  const side = drafted(21),
    run = createCupRun(catalog, { mode: 'nations', difficulty: 'pro', seed: 7, user: side }),
    ids = side.players.map(p => p.profileId),
    other = Object.keys(FORMATIONS).find(f => f !== side.formation && f.startsWith('4')),
    swapped = () => {
      // Two outfield players change places.
      const next = [...run.user.players],
        rows = FORMATIONS[run.user.formation],
        [a, b] = rows.map((r, i) => i).filter(i => rows[i][2] !== 'GK');
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    };
  assert.equal(run.formationLocked, true);
  assert.equal(run.nextMatch().formationLocked, true);
  assert.equal(run.snapshot().user.formation, side.formation);
  // Group stage: positions and tactics may change, the formation may not.
  const before = JSON.stringify(run.user);
  assert.equal(run.setLineup({ formation: other }), false);
  assert.equal(JSON.stringify(run.user), before, 'a refused line-up changes nothing');
  const order = swapped();
  assert.equal(run.setLineup({ players: order, tactics: { mentality: 'push', tempo: 4 } }), true);
  assert.deepEqual(run.user.players, order);
  assert.deepEqual(run.user.tactics, { mentality: 'push', tempo: 4 });
  const home = run.nextMatch().home;
  assert.deepEqual(
    home.players.map(p => p.profileId),
    order,
  );
  assert.deepEqual(home.tactics, { mentality: 'push', tempo: 4 });
  assert.equal(run.user.rating, home.rating);
  assert.equal(run.snapshot().user.rating, home.rating);
  assert.ok(Math.abs(home.effective - home.rating - (side.effective - side.rating)) < 0.011);
  // Players as objects are taken too; tactics are kept when none are given.
  assert.equal(run.setLineup({ players: home.players }), true);
  assert.deepEqual(run.user.tactics, { mentality: 'push', tempo: 4 });
  // Not this XI, a keeper out of goal, an unknown formation, junk: refused, nothing changes.
  const stranger = catalog.players.find(p => !ids.includes(p.profileId)).profileId,
    kept = JSON.stringify(run.user),
    gk = FORMATIONS[run.user.formation].findIndex(r => r[2] === 'GK'),
    keeperOut = [...order];
  [keeperOut[gk], keeperOut[(gk + 1) % 11]] = [keeperOut[(gk + 1) % 11], keeperOut[gk]];
  for (const bad of [
    { players: [stranger, ...order.slice(1)] },
    { players: order.slice(0, 10) },
    { players: [order[1], ...order.slice(1)] },
    { players: keeperOut },
    { players: 'x' },
    { formation: 'nope' },
  ])
    assert.equal(run.setLineup(bad), false, JSON.stringify(bad).slice(0, 60));
  assert.equal(JSON.stringify(run.user), kept);
  // Tactics are plain data: short strings and numbers.
  run.setLineup({ tactics: { mentality: 'hold', bad: { a: 1 }, long: 'x'.repeat(40), n: NaN } });
  assert.deepEqual(run.user.tactics, { mentality: 'hold' });
  // The second and the third group match are still locked; the Round of 32 is not.
  run.recordResult(win);
  assert.equal(run.setLineup({ formation: other }), false);
  run.recordResult(win);
  assert.equal(run.nextMatch().formationLocked, true);
  run.recordResult(win);
  assert.equal(run.formationLocked, false);
  assert.equal(run.nextMatch().formationLocked, false);
  // A new formation: the players in the order given; ratings follow the new slots.
  const keeper = run.user.players[gk],
    rows = FORMATIONS[other],
    outfield = run.user.players.filter(id => id !== keeper),
    lineup = rows.map(r => (r[2] === 'GK' ? keeper : outfield.shift()));
  assert.equal(run.setLineup({ formation: other, players: lineup }), true);
  assert.equal(run.user.formation, other);
  assert.equal(run.snapshot().user.formation, other);
  assert.deepEqual(run.user.tactics, { mentality: 'hold' });
  const next = run.nextMatch();
  assert.equal(next.home.formation, other);
  assert.deepEqual(
    next.home.players.map(p => [p.profileId, p.role]),
    lineup.map((id, i) => [id, rows[i][2]]),
  );
  // It survives a save, and the fast model plays the line-up's rating.
  const copy = restoreCupRun(catalog, JSON.parse(JSON.stringify(run.serialize())));
  assert.deepEqual(copy.user, run.user);
  assert.deepEqual(copy.nextMatch().home, next.home);
  run.simulateNext();
  copy.simulateNext();
  assert.deepEqual(copy.snapshot(), run.snapshot());
  // The awards read the players in their slots of the line-up.
  assert.ok(run.heldYouBack(11).every(r => r.role === rows[lineup.indexOf(r.profileId)][2]));
  // A finished run takes no line-up.
  while (!run.complete) run.recordResult({ goalsFor: 0, goalsAgainst: 3 });
  assert.equal(run.formationLocked, false);
  assert.equal(run.setLineup({ tactics: { mentality: 'push' } }), false);
  // A run saved before line-ups were kept has no tactics: its side has none either.
  const plain = createCupRun(catalog, { mode: 'nations', difficulty: 'pro', seed: 7, user: side });
  assert.equal('tactics' in plain.userSide(), false);
  assert.deepEqual(plain.userSide(), side);
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
    const r = simulateResult(80, 80, lcg(s), { knockout: true, extraTime: false });
    assert.equal(r.extraTime, false);
    if (r.goals[0] === r.goals[1]) {
      draws++;
      assert.ok(r.shootout && r.shootout.score[0] !== r.shootout.score[1]);
      assert.equal(r.shootout.winner, r.shootout.score[0] > r.shootout.score[1] ? 0 : 1);
    } else assert.equal(r.shootout, null);
  }
  assert.ok(draws > 20);
  // A knockout tie that is level after 90 minutes plays extra time before penalties: the same
  // 90 minutes (the same draws from the seed), then a third of the match at a lower rate.
  let extra = 0,
    decided = 0,
    extraGoals = 0;
  for (let s = 1; s <= 2000; s++) {
    const ninety = simulateResult(80, 80, lcg(s)),
      r = simulateResult(80, 80, lcg(s), { knockout: true });
    assert.equal(r.extraTime, ninety.goals[0] === ninety.goals[1]);
    if (!r.extraTime) {
      assert.deepEqual(r.goals, ninety.goals);
      assert.equal(r.shootout, null);
      continue;
    }
    extra++;
    extraGoals += r.goals[0] + r.goals[1] - ninety.goals[0] - ninety.goals[1];
    assert.ok(r.goals[0] >= ninety.goals[0] && r.goals[1] >= ninety.goals[1]);
    if (r.goals[0] !== r.goals[1]) {
      decided++;
      assert.equal(r.shootout, null);
    } else assert.ok([0, 1].includes(r.shootout.winner));
  }
  assert.ok(extra > 300);
  // Goals in extra time: MATCH_MODEL.extraTime of the ninety minutes' (two sides).
  const rate = extraGoals / extra / (2 * MATCH_MODEL.goals);
  assert.ok(Math.abs(rate - MATCH_MODEL.extraTime) < 0.04, `extra-time rate ${rate}`);
  assert.ok(MATCH_MODEL.extraTime > 0.15 && MATCH_MODEL.extraTime < 1 / 3);
  assert.ok(decided / extra > 0.3 && decided / extra < 0.6, `decided ${decided / extra}`);
  // Extra time is a longer look at the two sides than five kicks each: the stronger side goes
  // through more often with it than straight to penalties.
  const through = options => {
    let won = 0;
    for (let s = 1; s <= 3000; s++) {
      const r = simulateResult(86, 80, lcg(s), { knockout: true, ...options });
      if (r.goals[0] > r.goals[1] || r.shootout?.winner === 0) won++;
    }
    return won / 3000;
  };
  assert.ok(through({}) > through({ extraTime: false }));
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
// Targets (docs/competition-api.md): Pro ~20% champions with at most ~20% group exits, World
// Class ~10%, Legendary (the real field) a few percent. Wide windows: projectRun is a
// Monte-Carlo against the exact round targets.
test('difficulty ladder: title odds fall level by level and finals are top sides', () => {
  const windows = {
    pro: [0.14, 0.27],
    // 6% at this baseline rating (80,000 runs, with or without extra time in the model): the
    // window leaves room for the 3,000 runs here to read 5%.
    worldclass: [0.04, 0.15],
    legendary: [0.015, 0.08],
  };
  let previous = 1;
  for (const [difficulty, [lo, hi]] of Object.entries(windows)) {
    const rerolls = DEFAULT_CONFIG.draft.rerolls[difficulty],
      rating = MODE_BASELINES.nations.effective[Math.min(2, rerolls)];
    const p = projectRun({ rating, mode: 'nations', difficulty, runs: 3000 }).probabilities;
    assert.ok(p.champion >= lo && p.champion <= hi, `${difficulty} champion ${p.champion}`);
    assert.ok(p.champion <= previous, difficulty);
    previous = p.champion;
    if (difficulty === 'pro') assert.ok(p.group <= 0.22, `pro group exit ${p.group}`);
  }
  // The final is the strongest opponent of a run, and a recognisable side for the level.
  // (Floors follow the drafted-XI baseline: 82 effective on the 93-nation reel.)
  const finalFloor = { pro: 83, worldclass: 84 };
  for (const [difficulty, floor] of Object.entries(finalFloor))
    for (const seed of [3, 4]) {
      const run = createCupRun(catalog, { mode: 'nations', difficulty, seed, user });
      const final = run.opponents[7].effective;
      assert.ok(final >= floor, `${difficulty} final ${run.opponents[7].name} ${final}`);
      assert.ok(
        run.opponents.every(o => o.effective <= final + 1.5),
        difficulty,
      );
    }
});

test('third place goes through on four points or more, never on fewer', async () => {
  const { thirdQualifies } = await import('../app/core/competition/cup.js');
  assert.ok(thirdQualifies({ points: 4, gd: -5 }));
  assert.ok(!thirdQualifies({ points: 3, gd: 6 }));
});
