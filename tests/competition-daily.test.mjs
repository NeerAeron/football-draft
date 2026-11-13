import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeCatalog, loadEraCatalog } from '../scripts/data/catalog-file.mjs';
import { createDraftSession } from '../app/core/draft/session.js';
import { eraNations, eraPool, ERAS } from '../app/core/players/eras.js';
import { DEFAULT_CONFIG } from '../app/core/config/config.js';
import { reelWeights } from '../app/core/draft/reels.js';
import { lcg } from '../app/core/util/rng.js';
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
  isUltimate,
  ULTIMATE,
} from '../app/core/competition/share.js';

const catalog = loadEraCatalog();
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

test('same date, same spins, respin landings and opponents', () => {
  const a = dailyChallenge(catalog, '2026-11-07'),
    b = dailyChallenge(loadEraCatalog(), new Date('2026-11-07T15:00:00Z')),
    c = dailyChallenge(catalog, '2026-11-08');
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.schedule, c.schedule);
  assert.equal(a.schedule.rounds.length, 11);
  // It is a World Cup draft: it needs the era pools, and has the three tokens.
  assert.throws(() => dailyChallenge(loadRuntimeCatalog(), '2026-11-07'), /needs the era data/);
  assert.deepEqual(a.tokens, DEFAULT_CONFIG.draft.tokens);
  assert.deepEqual([a.draft.eras, a.draft.primes, a.draft.useDefaultRules], [true, true, true]);
  const has = (era, nation) => eraNations(catalog, era).some(n => n.name === nation);
  for (const r of a.schedule.rounds) {
    assert.ok(ERAS.some(e => e.id === r.era));
    // The spin and the nation respin's landing: two nations of the round's era.
    assert.ok(has(r.era, r.spin) && has(r.era, r.alternate));
    assert.notEqual(r.spin, r.alternate);
    // The era respin: another era; its nation is the round's when that era has it.
    assert.notEqual(r.eraAlternate.era, r.era);
    assert.ok(has(r.eraAlternate.era, r.eraAlternate.nation));
    if (has(r.eraAlternate.era, r.spin)) assert.equal(r.eraAlternate.nation, r.spin);
  }
  // The schedule is drawn with the draft's reel weights: over many days a deep squad comes
  // up more often than a thin one of the same era.
  const count = new Map();
  for (let d = 1; d <= 150; d++)
    for (const r of dailyChallenge(catalog, dailyIdFromNumber(d)).schedule.rounds)
      count.set(`${r.era}|${r.spin}`, (count.get(`${r.era}|${r.spin}`) || 0) + 1);
  const weights = reelWeights(catalog),
    share = pick => {
      let n = 0,
        hits = 0;
      for (const [era, w] of weights)
        for (const [nation, weight] of w.nations)
          if (pick(weight)) {
            n++;
            hits += count.get(`${era}|${nation}`) || 0;
          }
      return hits / n;
    };
  assert.ok(share(w => w >= 3) > 1.5 * share(w => w < 1.5), 'heavy squads come up more');

  assert.equal(new Set(a.opponents).size, 9);
  assert.ok(a.opponents.every(k => k.startsWith('nation:')));
  // The draft follows the schedule: spins land on it, and so do the respins.
  const s = createDraftSession(catalog, a.draft);
  for (let round = 0; round < 11; round++) {
    const r = a.schedule.rounds[round],
      spin = s.spin();
    if (spin.scheduled) assert.deepEqual([spin.era.id, spin.option.id], [r.era, r.spin]);
    else assert.ok(round > 0, 'the first spin is always the schedule');
    if (round === 2 && spin.scheduled) {
      const again = s.respin('nation');
      if (again.scheduled) assert.equal(again.option.id, r.alternate);
      assert.equal(again.era.id, r.era);
    }
    if (round === 4 && spin.scheduled) {
      const again = s.respin('era');
      if (again.scheduled) assert.equal(again.era.id, r.eraAlternate.era);
      if (again.scheduled && !again.kept) assert.equal(again.option.id, r.eraAlternate.nation);
    }
    s.pick(s.suggestPick().profileId);
  }
  assert.deepEqual([s.rerollsLeft[0], s.eraRespinsLeft[0], s.primesLeft[0]], [0, 0, 1]);
  // Most rounds land on the schedule whatever was drafted before (the guard moves a spin only
  // when its pool has no pick left for an open slot).
  const follow = createDraftSession(catalog, a.draft);
  let scheduled = 0;
  while (!follow.complete) {
    scheduled += follow.spin().scheduled ? 1 : 0;
    follow.pick(follow.suggestPick().profileId);
  }
  assert.ok(scheduled >= 9, `scheduled spins: ${scheduled}`);
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
  for (const date of ['2026-11-09', '2026-11-10', '2026-12-24']) {
    const day = dailyChallenge(catalog, date),
      optimum = perfectXI(catalog, day);
    assert.ok(optimum.alternates.length <= day.tokens.nation);
    assert.ok(optimum.eras.length <= day.tokens.era);
    // Without the tokens the optimum is the best XI of the eleven scheduled pools.
    const plain = perfectXI(catalog, { ...day, tokens: { nation: 0, era: 0, prime: 0 } });
    assert.ok(plain.rating <= optimum.rating && plain.rating > 80);
    assert.deepEqual([plain.alternates, plain.eras], [[], []]);
    const best = day.schedule.rounds.map(r =>
      Math.max(...eraPool(catalog, r.era, r.spin).map(p => p.sourceOverall ?? 0)),
    );
    assert.ok(best.every(v => v > 0));
    for (const policy of ['greedy', 'tokens']) {
      const s = createDraftSession(catalog, day.draft);
      let scheduled = true;
      while (!s.complete) {
        scheduled &&= s.spin().scheduled;
        if (policy === 'tokens' && s.suggestPick().rating < 83) {
          if (s.snapshot().tokens.nation.can) scheduled &&= s.respin('nation').scheduled;
          else if (s.snapshot().tokens.era.can) scheduled &&= s.respin('era').scheduled;
        }
        s.pick(s.suggestPick().profileId);
      }
      if (policy === 'tokens') {
        const o = s
          .primeOptions(0)
          .sort((x, y) => y.to.rating - y.from.rating - (x.to.rating - x.from.rating))[0];
        if (o && o.to.rating > o.from.rating) s.prime(o.slot, 0);
      }
      const rating = s.matchSide(0).rating;
      // Every landing was the schedule's: the optimum bounds the XI.
      if (scheduled)
        assert.ok(
          rating <= optimum.rating + 1e-9,
          `${date} ${policy}: ${rating} <= ${optimum.rating}`,
        );
      const pct = perfectPercent(rating, optimum);
      assert.ok(pct > 88 && pct <= 100, String(pct));
    }
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
  const url =
    'https://example.com/play#/challenge?c=' +
    encodeChallenge({ kind: 'daily', daily: day.number, formation: day.formation });
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
  assert.equal(lines[5], `https://example.com/play#/challenge?c=c1.d.n.${day.formation}.p.0.7`);
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
  for (const mode of ['nations', 'leagues', 'clubs'])
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
          budget: formation === '352',
          catalog: 'abc123',
        };
        const token = encodeChallenge(c);
        assert.match(token, /^[0-9a-z.-]+$/);
        assert.deepEqual(decodeChallenge(token), c);
        assert.equal(encodeURIComponent(token), token);
      }
  // Budget mode travels in the link (flag b) — a World Cup run's only.
  const budget = encodeChallenge({ seed: 9, budget: true, hideRatings: true });
  assert.equal(budget, 'c1.c.n.433.p.hb.9');
  assert.equal(decodeChallenge(budget).budget, true);
  assert.equal(decodeChallenge('c1.c.n.433.p.b.9').budget, true);
  assert.equal(decodeChallenge('c1.c.n.433.p.h.9').budget, false);
  assert.equal(decodeChallenge('c1.c.n.433.p.0.9').budget, false);
  assert.equal(decodeChallenge('c1.d.n.433.p.b.9'), null, 'no Budget Daily');
  assert.throws(() => encodeChallenge({ kind: 'daily', daily: 3, budget: true }), /Budget/);
  // Only the two links the game makes: a World Cup run and the Daily. Quick Match and Versus
  // links (kinds q, v) and the two-sides flag never had a way to be created.
  const daily = decodeChallenge(encodeChallenge({ kind: 'daily', daily: 12, formation: '442' }));
  assert.deepEqual(
    [daily.kind, daily.daily, daily.seed, daily.formation],
    ['daily', 12, null, '442'],
  );
  assert.equal('sides' in daily, false);
  for (const kind of ['quick', 'versus'])
    assert.throws(() => encodeChallenge({ kind, seed: 1 }), /Invalid challenge/);
  for (const bad of [
    '',
    'c2.c.n.433.p.0.1',
    'c1.c.n.999.p.0.1',
    'c1.z.n.433.p.0.1',
    'c1.c.n.433.p.x.1',
    'c1.c.n.433.p.0.zzzzzzzz',
    'c1.q.l.442.w.0.1a',
    'c1.v.c.433.p.2.1a',
    'c1.c.n.433.p.2.1a',
    'c1.c.n.433.p.hu2.1a',
    'c1.d.n.433.p.0.0',
    // Club & Country (mode x) is gone: such a link is not valid.
    'c1.c.x.433.p.0.1',
    null,
    42,
  ])
    assert.equal(decodeChallenge(bad), null, String(bad));
  // One cut-off: a link on a removed difficulty (a: Amateur, s: Semi-pro) is not a link.
  for (const old of ['a', 's']) assert.equal(decodeChallenge(`c1.c.n.433.${old}.0.1a`), null);
  // Whatever arrives, decoding never throws.
  const random = lcg(99),
    alphabet = 'c1.dnlpwhub0x29-_ ';
  for (let k = 0; k < 2000; k++) {
    const text = Array.from(
      { length: Math.floor(random() * 30) },
      () => alphabet[Math.floor(random() * alphabet.length)],
    ).join('');
    const c = decodeChallenge(text);
    assert.ok(c === null || ['cup', 'daily'].includes(c.kind), text);
  }
  for (const junk of [
    undefined,
    {},
    [],
    3.5,
    true,
    'c1',
    'c1.......',
    'c1.c.n.433.p.0.' + 'z'.repeat(200),
  ])
    assert.equal(decodeChallenge(junk), null);
  assert.throws(() => encodeChallenge({ difficulty: 'amateur', seed: 1 }), /Invalid challenge/);
  // A friend opening the link drafts with the very same spins.
  const original = createDraftSession(catalog, {
    mode: 'leagues',
    seed: 'friend',
    difficulty: 'worldclass',
    useDefaultRules: true,
  });
  const c = decodeChallenge(
    encodeChallenge({ kind: 'cup', mode: 'leagues', seed: 'friend', difficulty: 'worldclass' }),
  );
  const replay = createDraftSession(catalog, {
    mode: c.mode,
    seed: c.seed,
    formation: c.formation,
    difficulty: c.difficulty,
    useDefaultRules: true,
  });
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
