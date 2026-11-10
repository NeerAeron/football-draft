import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeCatalog } from '../scripts/data/catalog-file.mjs';
import { createDraftSession } from '../app/core/draft/session.js';
import { catalogIndex } from '../app/core/draft/pools.js';
import { createCupRun } from '../app/core/competition/cup.js';
import {
  dailyId,
  dailyNumber,
  dailyIdFromNumber,
  previousDay,
  nextDay,
  dailyChallenge,
  perfectXI,
  perfectPercent,
  dailyScore,
  canPlayDaily,
  updateStreak,
  currentStreak,
  DAILY_EPOCH,
} from '../app/core/competition/daily.js';
import {
  shareText,
  resultEmoji,
  encodeChallenge,
  decodeChallenge,
  challengeUrl,
  parseChallengeUrl,
  challengeDraftOptions,
  isUltimate,
  ULTIMATE,
} from '../app/core/competition/share.js';

const catalog = loadRuntimeCatalog();
const greedy = s => {
  while (!s.complete) {
    s.spin();
    const m = s.suggestPick();
    s.pick(m.profileId, m.slot);
  }
  return s;
};

test('UTC day ids, numbers and neighbours', () => {
  assert.equal(dailyId(new Date('2026-11-07T23:30:00-05:00')), '2026-11-08');
  assert.equal(dailyId(Date.UTC(2026, 10, 7, 0, 0, 1)), '2026-11-07');
  assert.equal(dailyId('2026-11-07'), '2026-11-07');
  assert.throws(() => dailyId('2026-02-30'));
  assert.throws(() => dailyId('yesterday'));
  assert.equal(dailyNumber(DAILY_EPOCH), 1);
  assert.equal(dailyNumber('2026-11-07'), 7);
  assert.equal(dailyIdFromNumber(7), '2026-11-07');
  assert.equal(previousDay('2027-01-01'), '2026-12-31');
  assert.equal(nextDay('2028-02-28'), '2028-02-29');
});

test('same date, same spins, alternates and opponents', () => {
  const a = dailyChallenge(catalog, '2026-11-07'),
    b = dailyChallenge(loadRuntimeCatalog(), new Date('2026-11-07T15:00:00Z')),
    c = dailyChallenge(catalog, '2026-11-08');
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.schedule, c.schedule);
  assert.equal(a.schedule.rounds.length, 11);
  const field = new Set(catalogIndex(catalog).field.map(n => n.id));
  for (const r of a.schedule.rounds) {
    assert.ok(field.has(r.spin) && field.has(r.alternate));
    assert.notEqual(r.spin, r.alternate);
  }
  // Group ×3, five knockouts and the third-place play-off opponent: real nations only.
  assert.equal(new Set(a.opponents).size, 9);
  assert.ok(a.opponents.every(k => k.startsWith('nation:')));
  // The draft follows the schedule: spins land on it, a re-roll lands on the alternate.
  const s = createDraftSession(catalog, a.draft);
  for (let round = 0; round < 11; round++) {
    const spin = s.spin();
    assert.equal(spin.option.id, a.schedule.rounds[round].spin);
    assert.ok(spin.scheduled);
    if (round === 2) {
      assert.equal(s.reroll().option.id, a.schedule.rounds[round].alternate);
      assert.equal(s.rerollBlocked(), 'One alternate per round');
    }
    s.pick(s.suggestPick().profileId);
  }
  assert.equal(s.rerollsLeft[0], a.rerolls - 1);
  // Two players drafting the same way get the same XI and the same opponents.
  const t = greedy(createDraftSession(catalog, a.draft)),
    u = greedy(createDraftSession(catalog, a.draft));
  assert.deepEqual(t.picks, u.picks);
  const run = createCupRun(catalog, { ...a.cup, user: t.matchSide(0) });
  assert.deepEqual(
    run.opponents.map(o => o.key),
    a.opponents,
  );
});

test('the perfect XI bounds every draft and scores the daily', () => {
  const day = dailyChallenge(catalog, '2026-11-09'),
    optimum = perfectXI(catalog, day);
  assert.ok(optimum.alternates.length <= day.rerolls);
  for (const policy of ['greedy', 'reroll']) {
    const s = createDraftSession(catalog, day.draft);
    while (!s.complete) {
      s.spin();
      if (policy === 'reroll' && s.rerollsLeft[0] && s.suggestPick().rating < 83) s.reroll();
      s.pick(s.suggestPick().profileId);
    }
    const rating = s.matchSide(0).rating;
    assert.ok(rating <= optimum.rating + 1e-9, `${rating} <= ${optimum.rating}`);
    const pct = perfectPercent(rating, optimum);
    assert.ok(pct > 90 && pct <= 100, String(pct));
  }
  assert.equal(perfectPercent(90, { rating: 85 }), 100);
  // Score: matches + stage + OVR + perfection.
  const snapshot = {
    stage: 'qf',
    rounds: [
      { result: { outcome: 'W' } },
      { result: { outcome: 'W' } },
      { result: { outcome: 'D' } },
      { result: { outcome: 'D', shootout: { winner: 'user' } } },
      { result: { outcome: 'L' } },
      { result: null },
      { result: null },
    ],
  };
  assert.deepEqual(dailyScore(snapshot, { rating: 82.5, perfect: 97.5 }), {
    total: 300 + 40 + 125 + 175,
    matches: 300,
    stage: 40,
    ovr: 125,
    perfection: 175,
  });
  // The place decides the bonus: the play-off is worth winning.
  const bonus = place => dailyScore({ ...snapshot, place }, { rating: 70, perfect: 80 }).stage;
  assert.deepEqual(
    ['group', 'r32', 'r16', 'qf', 'fourth', 'third', 'final', 'champion'].map(bonus),
    [0, 10, 20, 40, 80, 100, 120, 200],
  );
});

test('share text: emoji row, record, place, numbers, mode flags and link', () => {
  const day = dailyChallenge(catalog, '2026-11-07'),
    s = greedy(createDraftSession(catalog, day.draft)),
    side = s.matchSide(0),
    run = createCupRun(catalog, { ...day.cup, user: side });
  for (const r of [
    [2, 0],
    [1, 1],
    [3, 1],
    [0, 0, 'user'],
    [1, 0],
    [1, 2],
  ])
    run.recordResult({ goalsFor: r[0], goalsAgainst: r[1], shootout: r[2] && { winner: r[2] } });
  const snap = run.snapshot();
  assert.equal(resultEmoji(snap), '🟩🟨🟩 🟨🟩🟥');
  const url = challengeUrl('https://example.com/play?x=1#old', {
    kind: 'daily',
    daily: day.number,
    formation: day.formation,
  });
  const text = shareText(snap, {
    daily: day,
    rating: side.rating,
    perfectPct: 98.4,
    points: 1104,
    hideRatings: true,
    url,
  });
  const lines = text.split('\n');
  assert.equal(lines[0], '⚽ World Cup Draft · Daily #7');
  assert.equal(lines[1], '🟩🟨🟩 🟨🟩🟥');
  assert.equal(lines[2], '3-2-1 · Quarter-finals');
  assert.ok(!/\b[SABCDF][+]? /.test(lines[2]), 'no letter grade');
  assert.equal(lines[3], `XI ${side.rating.toFixed(1)} · 98.4% of perfect · 1,104 pts`);
  assert.equal(lines[4], 'Nations · Pro · 🙈 Ratings hidden');
  assert.equal(lines[5], `https://example.com/play?x=1#c=c1.d.n.${day.formation}.p.0.7`);
  // The summary line: where the run finished (or the stage of a run in progress).
  const base = {
    record: { w: 6, d: 1, l: 1 },
    results: ['W', 'D', 'W', 'W', 'W', 'W', 'L', 'W'],
    status: 'eliminated',
    mode: 'nations',
    difficulty: 'legendary',
  };
  const third = { ...base, stageLabel: 'Third place', placeLabel: 'Third place', medal: 'bronze' };
  assert.equal(shareText(third).split('\n')[2], '6-1-1 · Third place');
  assert.equal(resultEmoji(third), '🟩🟨🟩 🟩🟩🟩🟥🟩 🥉');
  assert.equal(resultEmoji({ ...third, medal: 'silver' }).slice(-2), '🥈');
  assert.equal(
    shareText({ ...base, stageLabel: 'Semi-finals', placeLabel: null }).split('\n')[2],
    '6-1-1 · Semi-finals',
  );
  // Budget mode is named; the ultimate achievement gets its own line.
  assert.match(shareText(third, { budget: true }), /Nations · Legendary · 💰 Budget/);
  const perfect = {
    ...base,
    record: { w: 8, d: 0, l: 0 },
    results: Array(8).fill('W'),
    status: 'champion',
    stageLabel: 'Champions',
    placeLabel: 'Champions',
    medal: 'gold',
    perfect: true,
  };
  assert.equal(isUltimate(perfect, true), true);
  assert.equal(isUltimate(perfect, false), false);
  assert.equal(isUltimate({ ...perfect, difficulty: 'worldclass' }, true), false);
  assert.equal(isUltimate({ ...perfect, perfect: false }, true), false);
  assert.equal(
    shareText(perfect, { budget: true }).split('\n')[3],
    `👑 ${ULTIMATE.name}: Legendary · Budget · 8-0-0`,
  );
  assert.ok(!shareText(perfect).includes('👑'));
  // A champion row ends with a trophy.
  assert.equal(
    resultEmoji({ results: ['W', 'W', 'W', 'W', 'W', 'D', 'W'], status: 'champion' }),
    '🟩🟩🟩 🟩🟩🟨🟩 🏆',
  );
});

test('challenge links round-trip and replay the same spins', () => {
  for (const mode of ['nations', 'leagues', 'clubs', 'clubAndCountry'])
    for (const difficulty of ['pro', 'worldclass', 'legendary'])
      for (const formation of ['433', '4231-wide', '352']) {
        const c = {
          kind: 'cup',
          mode,
          seed: 4294967295,
          formation,
          difficulty,
          hideRatings: difficulty === 'pro',
          uniqueNations: mode === 'nations',
          sides: 1,
          catalog: 'abc123',
        };
        const token = encodeChallenge(c);
        assert.match(token, /^[0-9a-z.-]+$/);
        assert.deepEqual(decodeChallenge(token), c);
        assert.equal(encodeURIComponent(token), token);
      }
  const versus = decodeChallenge(
    encodeChallenge({ kind: 'versus', mode: 'clubs', seed: 'pizza', sides: 2 }),
  );
  assert.equal(versus.sides, 2);
  for (const bad of [
    '',
    'c2.c.n.433.p.0.1',
    'c1.c.n.999.p.0.1',
    'c1.z.n.433.p.0.1',
    'c1.c.n.433.p.x.1',
    'c1.c.n.433.p.0.zzzzzzzz',
    null,
    42,
  ])
    assert.equal(decodeChallenge(bad), null, String(bad));
  assert.deepEqual(parseChallengeUrl('https://x.io/?c=C1.Q.L.442.W.0.1A'), {
    ...decodeChallenge('c1.q.l.442.w.0.1a'),
  });
  // Old links on the removed difficulties (a: Amateur, s: Semi-pro) play as Pro.
  for (const old of ['a', 's']) {
    const c = decodeChallenge(`c1.c.n.433.${old}.0.1a`);
    assert.equal(c.difficulty, 'pro');
    assert.equal(challengeDraftOptions(c).difficulty, 'pro');
  }
  assert.throws(() => encodeChallenge({ difficulty: 'amateur', seed: 1 }), /Invalid challenge/);
  assert.equal(parseChallengeUrl('https://x.io/#nothing'), null);
  // A friend opening the link drafts with the very same spins.
  const original = createDraftSession(catalog, {
    mode: 'clubAndCountry',
    seed: 'friend',
    difficulty: 'worldclass',
    useDefaultRules: true,
  });
  const link = challengeUrl('https://x.io/', {
    kind: 'cup',
    mode: 'clubAndCountry',
    seed: 'friend',
    difficulty: 'worldclass',
  });
  const replay = createDraftSession(catalog, challengeDraftOptions(parseChallengeUrl(link)));
  for (let k = 0; k < 5; k++) {
    assert.equal(replay.spin().option.id, original.spin().option.id);
    const m = original.suggestPick();
    original.pick(m.profileId, m.slot);
    replay.pick(m.profileId, m.slot);
  }
});

test('one attempt per day and streaks', () => {
  assert.equal(canPlayDaily(null, '2026-11-07'), true);
  assert.equal(canPlayDaily('2026-11-07', '2026-11-07'), false);
  assert.equal(canPlayDaily('2026-11-06', new Date('2026-11-07T12:00:00Z')), true);
  let s = updateStreak(undefined, '2026-11-05');
  assert.deepEqual(s, { current: 1, best: 1, last: '2026-11-05' });
  s = updateStreak(s, '2026-11-06');
  s = updateStreak(s, '2026-11-07');
  assert.deepEqual(s, { current: 3, best: 3, last: '2026-11-07' });
  assert.deepEqual(updateStreak(s, '2026-11-07'), s, 'replaying the same day changes nothing');
  assert.equal(currentStreak(s, '2026-11-08'), 3, 'alive until the day is missed');
  assert.equal(currentStreak(s, '2026-11-09'), 0);
  s = updateStreak(s, '2026-11-10');
  assert.deepEqual(s, { current: 1, best: 3, last: '2026-11-10' });
});
