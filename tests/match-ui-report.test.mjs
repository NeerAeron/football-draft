import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../app/core/sim/engine.js';
import { loadRuntimeCatalog } from '../scripts/data/catalog-file.mjs';
import { commentary, commentaryLines, minuteLabel } from '../app/ui/screens/match/commentary.js';
import {
  summarizeMatch,
  analysisChips,
  shareLine,
  isSignificant,
} from '../app/ui/screens/match/report.js';
import { buildDemoRequest, forceShootout } from '../app/ui/screens/match/demo.js';
import { createMatchRequest, runResultFor } from '../app/ui/lib/match-store.js';

const ctx = new Match(1, 180);

test('minute labels follow football convention, incl. stoppage and extra time', () => {
  assert.equal(minuteLabel(0, 1), "1'");
  assert.equal(minuteLabel(59, 1), "1'");
  assert.equal(minuteLabel(60 * 66 + 5, 2), "67'");
  assert.equal(minuteLabel(2700 + 90, 1), "45+2'");
  assert.equal(minuteLabel(5400 + 30, 2), "90+1'");
  assert.equal(minuteLabel(6300 + 61, 3), "105+2'");
});

test('commentary: goals with story tags, saves by type, misses, cards, shootout', () => {
  const p = ctx.players[9],
    a = ctx.players[7];
  const goal = (id, story, extra = {}) =>
    commentary(
      {
        id,
        type: 'goal',
        team: 0,
        time: 85 * 60,
        half: 2,
        playerId: 9,
        assistId: 7,
        story,
        shotType: 'Curler',
        ...extra,
      },
      ctx,
    );
  const late = goal(41, ['go-ahead', 'late', 'late winner']);
  assert.equal(late.level, 3);
  assert.equal(late.tone, 'goal');
  assert.equal(late.minute, "86'");
  assert.match(late.text, /^GOAL! /);
  assert.match(late.text, /Late winner!/);
  assert.ok(late.text.includes(a.name.split(' ').pop()), 'assist named');
  assert.match(goal(42, ['brace', 'hat-trick']).text, /Hat-trick for/);
  assert.match(goal(43, ['equaliser']).text, /are level/);
  assert.match(goal(44, ['equaliser', 'late']).text, /Late equaliser/);
  assert.match(goal(45, [], { ownGoal: true, playerId: 14 }).text, /^Own goal!/);
  // Deterministic wording per event id
  assert.equal(goal(41, ['opener']).text, goal(41, ['opener']).text);
  const variants = new Set([1, 2, 3, 4, 5, 6].map(id => goal(id, []).text));
  assert.ok(variants.size > 1, 'varied templates');

  const save = (saveType, difficulty, extra = {}) =>
    commentary(
      {
        id: 7,
        type: 'save',
        team: 1,
        time: 600,
        half: 1,
        playerId: 11,
        shooterId: 9,
        saveType,
        difficulty,
        ...extra,
      },
      ctx,
    );
  assert.match(save('tip over', 0.5).text, /over/);
  assert.match(save('parry into danger', 0.5).text, /danger|palm/);
  assert.match(save('catch', 0.9).text, /save|stop/i);
  assert.equal(save('catch', 0.1).level, 1);
  assert.equal(save('parry', 0.6, { bigChance: true }).level, 2);

  const near = commentary(
    { id: 3, type: 'near-miss', team: 0, time: 0, half: 1, playerId: 9, miss: 'wide' },
    ctx,
  );
  assert.match(near.text, /wide|post/i);
  assert.equal(near.level, 2);
  assert.match(
    commentary({ id: 4, type: 'post', team: 0, time: 0, half: 1, playerId: 9, frame: 'bar' }, ctx)
      .text,
    /bar/i,
  );
  assert.equal(
    commentary({ id: 5, type: 'shot', team: 0, outcome: 'in flight', playerId: 9 }, ctx),
    null,
  );
  assert.match(
    commentary(
      {
        id: 5,
        type: 'shot',
        team: 0,
        outcome: 'off target',
        bigChance: true,
        playerId: 9,
        time: 0,
        half: 1,
      },
      ctx,
    ).text,
    /Big chance|missed/,
  );
  assert.match(
    commentary(
      { id: 8, type: 'red', team: 1, playerId: 15, secondYellow: true, time: 0, half: 1 },
      ctx,
    ).text,
    /Second yellow/,
  );
  const kick = commentary(
    {
      id: 9,
      type: 'shootout',
      team: 0,
      playerId: 9,
      keeperId: 11,
      outcome: 'goal',
      shootoutScore: [5, 4],
      decisive: true,
      time: 5400,
      half: 2,
    },
    ctx,
  );
  assert.equal(kick.level, 3);
  assert.equal(kick.minute, 'PEN');
  assert.match(kick.text, /win it!/);
  assert.equal(commentary({ id: 10, type: 'restart' }, ctx), null);
  assert.ok(p);
});

test('commentaryLines turns the engine feed (newest first) into a chronological list', () => {
  const events = [
    { id: 3, type: 'yellow', team: 1, playerId: 14, time: 120, half: 1 },
    { id: 2, type: 'restart', team: 0, time: 90, half: 1 },
    { id: 1, type: 'kickoff', team: 0, time: 0, half: 1 },
  ];
  assert.deepEqual(
    commentaryLines(events, ctx).map(l => l.id),
    [1, 3],
  );
  assert.deepEqual(
    commentaryLines(events, ctx, 2).map(l => l.id),
    [3],
  );
});

// A finished match without simulating 90 minutes: a few events and stats on a fresh Match.
function craftedMatch() {
  const m = new Match(5, 180);
  const config = m.exportConfig();
  config.players.forEach((p, i) => (p.profileId = `p${i}`));
  m.importConfig(config);
  for (let i = 0; i < 120; i++) m.step(1 / 60);
  const goal = (team, playerId, minute, scoreAfter, story = []) => {
    m.time = minute * 60;
    m.half = minute >= 45 ? 2 : 1;
    m.score = [...scoreAfter];
    m.players[playerId].stats.goals++;
    const e = m.addEvent('Goal', team, 'goal', {
      playerId,
      assistId: team * 11 + 7,
      scoreAfter,
      story,
      xg: 0.3,
    });
    m.goalHistory.push(e);
  };
  goal(0, 9, 12, [1, 0], ['opener']);
  goal(1, 20, 40, [1, 1], ['equaliser']);
  goal(0, 9, 88, [2, 1], ['go-ahead', 'brace', 'late', 'winner', 'late winner']);
  m.addEvent('Save', 1, 'save', { playerId: 11, saveType: 'parry', difficulty: 0.8, xg: 0.4 });
  m.addEvent('Corner', 0, 'restart');
  m.stats[0].possession = 61;
  m.stats[1].possession = 39;
  m.stats[0].xg = 0.7;
  m.stats[1].xg = 1.9;
  m.stats[0].shots = 5;
  m.stats[1].shots = 12;
  m.players[11].stats.saves = 5;
  m.players[4].stats.turnovers = 9;
  m.players[4].stats.fouls = 3;
  m.finished = true;
  m.mode = 'fulltime';
  return m;
}

test('summarizeMatch produces the documented result', () => {
  const m = craftedMatch();
  const request = {
    id: 'quick:1',
    seed: 5,
    view: 'full',
    meta: {
      context: 'quick',
      title: 'Quick match',
      userSides: [0],
      sides: [{ kind: 'user' }, { kind: 'ai' }],
    },
  };
  const r = summarizeMatch(m, request, { finishedAt: '2026-11-07T00:00:00.000Z' });
  assert.equal(r.id, 'quick:1');
  assert.equal(r.durationMode, 'full');
  assert.deepEqual(r.score, [2, 1]);
  assert.equal(r.winner, 0);
  assert.deepEqual(r.outcomes, ['W', 'L']);
  assert.equal(r.shootout, null);
  assert.equal(r.goals.length, 3);
  assert.deepEqual(
    r.goals.map(g => g.minute),
    ["13'", "41'", "89'"],
  );
  assert.ok(r.events.some(e => e.type === 'save' && e.saveType === 'parry'));
  assert.ok(r.events.every(isSignificant));
  assert.equal(r.stats[0].possession + r.stats[1].possession, 100);
  assert.equal(r.stats[0].corners, 1);
  assert.equal(r.players.length, 22);
  assert.equal(r.players[9].goals, 2);
  assert.equal(r.players[0].profileId, 'p0');
  assert.equal(r.motm.id, 9);
  assert.match(r.motm.line, /2 goals/);
  assert.equal(r.heldYouBack.team, 0);
  assert.ok(r.heldYouBack.reason);
  assert.equal(r.heldBack[1], null, 'AI side has no "held you back"');
  assert.ok(r.analysis.length >= 2 && r.analysis.length <= 3);
  assert.ok(
    r.analysis.some(c => c.id === 'late'),
    'late winner chip',
  );
  assert.match(r.share, /^⚽ .+ 2–1 .+ · .+ 13' 89'/);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r, 'plain JSON');
  const run = runResultFor(r, 0);
  assert.equal(run.outcome, 'W');
  assert.equal(run.players.length, 11);
  assert.ok(run.players.every(p => p.profileId && Number.isFinite(p.rating)));
});

test('analysis chips explain a heavy defeat from the loser’s side', () => {
  const m = craftedMatch();
  const r = summarizeMatch(m, { id: 'x', seed: 1, view: 'key', meta: { userSides: [1] } });
  const chips = analysisChips(r, 1);
  assert.ok(chips.length >= 2);
  assert.ok(
    chips.every(c => ['positive', 'negative', 'neutral'].includes(c.tone) && c.label && c.detail),
  );
  assert.ok(chips.some(c => c.id === 'late-loss'));
  assert.match(shareLine(r), /Football Draft$/);
});

test('a forced shootout finishes deterministically and is summarised', () => {
  const play = () => {
    const m = new Match(9, 180);
    const c = m.exportConfig();
    c.competition = { mode: 'ai', knockout: true };
    m.importConfig(c);
    forceShootout(m);
    for (let i = 0; i < 60 * 150 && !m.finished; i++) m.step(1 / 60);
    return m;
  };
  const m = play();
  assert.equal(m.finished, true);
  const r = summarizeMatch(m, { id: 'pens', seed: 9, view: 'full', meta: { userSides: [0] } });
  assert.deepEqual(r.outcomes, ['D', 'D']);
  assert.ok([0, 1].includes(r.shootout.winner));
  assert.equal(r.winner, r.shootout.winner);
  assert.equal(r.shootout.kicks.length, m.shootout.kicks.length);
  assert.ok(r.events.some(e => e.type === 'shootout' && e.decisive));
  assert.ok(r.analysis.some(c => c.id === 'pens'));
  assert.deepEqual(
    summarizeMatch(play(), { id: 'pens', seed: 9, view: 'full', meta: { userSides: [0] } })
      .shootout,
    r.shootout,
  );
  assert.equal(runResultFor(r, 0).shootout.winner, r.shootout.winner === 0 ? 'user' : 'opponent');
});

test('the demo request uses two real club XIs and is deterministic per seed', async () => {
  const catalog = await loadRuntimeCatalog();
  const a = buildDemoRequest(catalog, { view: 'full', seed: '12' });
  const b = buildDemoRequest(catalog, { view: 'full', seed: '12' });
  assert.deepEqual(a, b);
  assert.equal(a.view, 'full');
  assert.equal(a.duration, 180);
  assert.equal(a.meta.context, 'demo');
  assert.notEqual(a.config.teams[0].name, a.config.teams[1].name);
  assert.ok(a.config.players.every(p => p.profileId && p.sourceOverall));
  assert.deepEqual(createMatchRequest(a), a, 'already normalised');
  const pens = buildDemoRequest(catalog, { pens: '1' });
  assert.equal(pens.config.competition.knockout, true);
  assert.equal(pens.meta.forceShootout, true);
  assert.equal(pens.view, 'key');
});
