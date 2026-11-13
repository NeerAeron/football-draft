import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeCatalog } from '../scripts/data/catalog-file.mjs';
import { createDraftSession } from '../app/core/draft/session.js';
import { createCupRun, restoreCupRun, worldCupDraw } from '../app/core/competition/cup.js';
import { matchPerformances } from '../app/core/competition/scorers.js';
import { BALL_MATCHES } from '../app/core/competition/awards.js';
import { FORMATIONS } from '../app/core/players/formations.js';
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
const ids = user.players.map(p => p.profileId);
const finished = options => {
  const run = createCupRun(catalog, { mode: 'nations', difficulty: 'pro', user, ...options });
  while (!run.complete) run.simulateNext();
  return run;
};

test('modelled player lines: every goal has a scorer, by role and finishing, seeded', () => {
  const xi = user.players,
    totals = new Map(xi.map(p => [p.role, { goals: 0, assists: 0, n: 0 }]));
  let goals = 0,
    scored = 0,
    assists = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const goalsFor = seed % 5,
      lines = matchPerformances(xi, { goalsFor, goalsAgainst: seed % 3, random: lcg(seed) });
    assert.deepEqual(
      lines.map(l => l.profileId),
      ids,
    );
    goals += goalsFor;
    for (const [i, l] of lines.entries()) {
      assert.ok(l.rating >= 3 && l.rating <= 10 && Math.round(l.rating * 10) === l.rating * 10);
      const t = totals.get(xi[i].role);
      t.goals += l.goals;
      t.assists += l.assists;
      scored += l.goals;
      assists += l.assists;
    }
    assert.ok(lines.reduce((s, l) => s + l.goals, 0) <= goalsFor);
    assert.ok(lines.reduce((s, l) => s + l.assists, 0) <= lines.reduce((s, l) => s + l.goals, 0));
  }
  // A few own goals; most goals are assisted; the keeper never scores, strikers the most.
  assert.ok(scored / goals > 0.93 && scored < goals, `${scored} of ${goals}`);
  assert.ok(assists / scored > 0.75 && assists / scored < 0.95);
  assert.equal(totals.get('GK').goals, 0);
  assert.ok(totals.get('ST').goals > 8 * (totals.get('CB')?.goals ?? 0));
  // Same seed, same lines; a clean sheet is worth more to the keeper than three conceded.
  const again = seed => matchPerformances(xi, { goalsFor: 2, goalsAgainst: 0, random: lcg(seed) });
  assert.deepEqual(again(7), again(7));
  assert.notDeepEqual(again(7), again(8));
});

test("the squad's stats exist however the matches were played", () => {
  // Fast model: lines from the match's seed, stored with the run.
  const run = createCupRun(catalog, { mode: 'nations', difficulty: 'pro', seed: 3, user });
  assert.ok(run.squadStats().every(r => r.matches === 0 && r.average === null));
  run.simulateNext();
  // A result reported without lines gets them too; the engine's are kept as they are.
  run.recordResult({ goalsFor: 3, goalsAgainst: 0 });
  run.recordResult({
    goalsFor: 1,
    goalsAgainst: 1,
    players: ids.map((profileId, i) => ({ profileId, rating: 7, goals: i === 10 ? 1 : 0 })),
    opponents: run
      .opponentSide(2)
      .players.map((p, i) => ({ profileId: p.profileId, rating: 6, goals: i === 9 ? 1 : 0 })),
  });
  const rows = run.squadStats(),
    rounds = run.snapshot().rounds;
  assert.deepEqual(
    rows.map(r => r.profileId),
    run.user.players,
  );
  assert.ok(rows.every(r => r.matches === 3 && r.average >= 3 && r.average <= 10));
  const scored = rows.reduce((s, r) => s + r.goals, 0),
    goals = rounds.reduce((s, r) => s + (r.result?.goalsFor ?? 0), 0);
  assert.ok(scored <= goals && scored >= goals - 1, `${scored} of ${goals}`);
  assert.equal(rows[10].goals >= 1, true);
  const keeper = rows.find(r => r.role === 'GK');
  assert.equal(keeper.cleanSheets, rounds.filter(r => r.result?.goalsAgainst === 0).length);
  assert.equal(run.matches[2].against.length, 11);
  assert.equal(run.matches[1].against, undefined);
  // Deterministic, and it survives a save.
  const twin = createCupRun(catalog, { mode: 'nations', difficulty: 'pro', seed: 3, user });
  twin.simulateNext();
  assert.deepEqual(twin.matches[0].players, run.matches[0].players);
  const copy = restoreCupRun(catalog, JSON.parse(JSON.stringify(run.serialize())));
  assert.deepEqual(copy.squadStats(), rows);
  assert.equal(run.awards(), null, 'no awards while the run is being played');
});

test('awards of a whole World Cup, also when the run ended in the group or the Round of 32', () => {
  // What the user did not play is played by the fast model: the finalists have eight matches,
  // and the winners are players of sides that went deep, with a whole tournament's numbers.
  const ended = (difficulty, seed, out) => {
    const run = createCupRun(catalog, { mode: 'nations', difficulty, seed, user });
    while (!run.complete) {
      const m = run.nextMatch();
      if (out === 'group' && m.round < 3) run.recordResult({ goalsFor: 0, goalsAgainst: 2 });
      else if (out === 'r32')
        run.recordResult(
          m.round < 3 ? { goalsFor: 2, goalsAgainst: 0 } : { goalsFor: 0, goalsAgainst: 1 },
        );
      else run.simulateNext();
    }
    return run;
  };
  const boots = [];
  for (const difficulty of ['pro', 'legendary'])
    for (const out of ['group', 'r32'])
      for (const seed of [1, 2, 3, 4]) {
        const run = ended(difficulty, seed, out),
          label = `${difficulty} ${out} seed ${seed}`,
          { boot, ball, glove, teams } = run.awards();
        assert.equal(run.snapshot().place, out, label);
        assert.equal(teams, difficulty === 'legendary' ? 48 : 10, label);
        // Nobody of an XI that went out early wins anything.
        for (const a of [ball, glove]) assert.equal(a.user, false, label);
        // The Boot: a whole tournament's goals, from more than a group stage.
        assert.ok(boot.goals >= 4 && boot.goals <= 13, `${label}: Boot ${boot.goals}`);
        assert.ok(boot.matches >= 4, `${label}: Boot in ${boot.matches} matches`);
        // The Ball and the Glove: players of quarter-finalists (six matches or more).
        assert.ok(ball.matches >= 6, `${label}: Ball in ${ball.matches} matches`);
        assert.ok(glove.matches >= 6 && glove.cleanSheets >= 2, `${label}: Glove`);
        assert.deepEqual(ended(difficulty, seed, out).awards(), run.awards(), label);
        boots.push(boot.goals);
      }
  const mean = boots.reduce((a, b) => a + b, 0) / boots.length;
  assert.ok(mean >= 5.5 && mean <= 8.5, `Golden Boot ${mean} goals on average (${boots})`);
});

test('awards: the same run gives the same awards, on the ladder and in the real field', () => {
  for (const difficulty of ['pro', 'worldclass', 'legendary'])
    for (const seed of [1, 2, 3]) {
      const run = finished({ difficulty, seed }),
        awards = run.awards();
      assert.equal(awards.teams, difficulty === 'legendary' ? 48 : 10, `${difficulty} teams`);
      for (const a of [awards.boot, awards.ball, awards.glove]) {
        assert.ok(a.name && a.team.name && a.matches >= 1 && a.matches <= 8, JSON.stringify(a));
        assert.equal(a.user, a.team.key === 'user');
        assert.ok(a.average >= 3 && a.average <= 10);
      }
      assert.equal(awards.glove.role, 'GK');
      assert.ok(awards.glove.matches >= 6, 'a keeper of a quarter-finalist');
      assert.ok(awards.ball.matches >= BALL_MATCHES);
      assert.ok(awards.boot.goals >= 3);
      assert.equal(run.awards(), awards, 'computed once');
      // Same seed → same awards; a restored run too; the generator is the same work.
      assert.deepEqual(finished({ difficulty, seed }).awards(), awards);
      const copy = restoreCupRun(catalog, JSON.parse(JSON.stringify(run.serialize())));
      const steps = copy.awardsSteps();
      let step = steps.next(),
        count = 1;
      while (!step.done) ((step = steps.next()), count++);
      assert.deepEqual(step.value, awards);
      if (difficulty === 'legendary') assert.ok(count > 30, 'one squad per step');
    }
});

test("awards: nobody outscores the Golden Boot, and the user's players are in the count", () => {
  let mine = 0,
    others = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const run = finished({ seed }),
      { boot, ball, glove } = run.awards(),
      rows = run.squadStats();
    for (const r of rows) assert.ok(r.goals <= boot.goals, `seed ${seed}`);
    for (const a of [boot, ball, glove]) {
      if (!a.user) {
        others++;
        assert.ok(run.opponents.some(o => o.key === a.team.key));
        continue;
      }
      mine++;
      const row = rows.find(r => r.profileId === a.profileId);
      assert.deepEqual(
        [row.goals, row.assists, row.matches, row.average, row.cleanSheets],
        [a.goals, a.assists, a.matches, a.average, a.cleanSheets],
      );
    }
  }
  assert.ok(mine > 5 && others > 5, `user ${mine}, others ${others}`);
});

test('awards: engine lines count as recorded, for both sides', () => {
  // The opponent's striker scores five in the first match: nobody catches him.
  const run = createCupRun(catalog, { mode: 'nations', difficulty: 'pro', seed: 9, user });
  const side = run.opponentSide(0),
    striker = side.players.findLast(p => p.role !== 'GK');
  run.recordResult({
    goalsFor: 0,
    goalsAgainst: 9,
    players: ids.map(profileId => ({ profileId, rating: 5 })),
    opponents: side.players.map(p => ({
      profileId: p.profileId,
      rating: p === striker ? 10 : 6,
      goals: p === striker ? 9 : 0,
    })),
  });
  while (!run.complete) run.recordResult({ goalsFor: 0, goalsAgainst: 0 });
  assert.equal(run.place(), 'group');
  const { boot } = run.awards();
  assert.equal(boot.profileId, striker.profileId);
  assert.equal(boot.team.key, side.key);
  assert.ok(boot.goals >= 9);
  assert.equal(boot.user, false);
  // And a user's player who scores in every match wins it.
  const star = createCupRun(catalog, { mode: 'nations', difficulty: 'pro', seed: 9, user });
  while (!star.complete)
    star.recordResult({
      goalsFor: 4,
      goalsAgainst: 0,
      players: ids.map((profileId, i) => ({
        profileId,
        rating: i === 10 ? 9.8 : 6.5,
        goals: i === 10 ? 4 : 0,
      })),
    });
  const won = star.awards();
  assert.equal(won.boot.profileId, ids[10]);
  assert.equal(won.boot.goals, 32);
  assert.equal(won.boot.user, true);
  assert.equal(won.ball.profileId, ids[10]);
  assert.equal(won.glove.profileId, ids[FORMATIONS[user.formation].findIndex(r => r[2] === 'GK')]);
  assert.equal(won.glove.cleanSheets, 8);
});

test('awards: a run saved without the field or without player lines still has them', () => {
  const run = finished({ difficulty: 'legendary', seed: 5 }),
    data = JSON.parse(JSON.stringify(run.serialize()));
  assert.ok(data.field.matches.length > 80);
  delete data.field;
  for (const m of data.matches) m.players = [];
  const old = restoreCupRun(catalog, data),
    awards = old.awards();
  assert.equal(awards.teams, 10);
  assert.ok(awards.boot && awards.ball && awards.glove);
  assert.ok(old.squadStats().every(r => r.matches === 0));
  // Junk in the field is skipped, not a crash.
  const junk = restoreCupRun(catalog, {
    ...JSON.parse(JSON.stringify(run.serialize())),
    field: {
      matches: [null, ['qf'], ['nope', 1, 2], ['group', 'nation:zz', 'nation:yy', -1, 'x']],
    },
  });
  assert.ok(junk.awards().boot);
});

test("the World Cup draw reports every tie it played, and the field's teams all have players", () => {
  const draw = worldCupDraw(catalog, { random: lcg(11) });
  const stages = s => draw.matches.filter(m => m[0] === s).length;
  // Eleven groups of six matches; the bracket without the user's five ties.
  assert.equal(stages('group'), 66);
  assert.deepEqual(['r32', 'r16', 'qf', 'sf', 'final'].map(stages), [15, 7, 3, 1, 0]);
  assert.ok(draw.matches.every(m => m[1].startsWith('nation:') && m[2].startsWith('nation:')));
  assert.ok(draw.matches.filter(m => m[0] !== 'group').every(m => m[5] === 0 || m[5] === 1));
});
