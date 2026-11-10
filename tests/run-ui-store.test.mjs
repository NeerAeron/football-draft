// RUN-UI pure helpers: persistence + tolerant readers (lib/run-store.js, lib/saved.js), group
// stakes, challenge links, the daily record, and the share image layout math.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeCatalog } from '../scripts/data/catalog-file.mjs';
import { createDraftSession, DIFFICULTIES, DIFFICULTY_LABELS } from '../app/core/draft/session.js';
import { decodeChallenge } from '../app/core/competition/share.js';

// A Map-backed localStorage for the browser-side helpers.
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  key: i => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};

const runStore = await import('../app/ui/lib/run-store.js');
const saved = await import('../app/ui/lib/saved.js');
const records = await import('../app/ui/lib/records.js');
const share = await import('../app/ui/lib/share-image.js');
const { runSide } = await import('../app/ui/screens/run/auto-sim.js');

let catalog, draft;
before(() => {
  catalog = loadRuntimeCatalog();
  draft = createDraftSession(catalog, { mode: 'nations', seed: 42, difficulty: 'pro' });
  while (!draft.complete) {
    draft.spin();
    const s = draft.suggestPick();
    draft.pick(s.profileId ?? s);
  }
});
beforeEach(() => store.clear());

test('saved.js readers tolerate missing and malformed data', () => {
  assert.equal(saved.readSavedRun(), null);
  store.set(saved.RUN_KEY, '{not json');
  assert.equal(saved.readSavedRun(), null);
  store.set(
    saved.RUN_KEY,
    JSON.stringify({ stage: 'X9', record: { w: 'a' }, status: 'weird', rounds: 8 }),
  );
  const run = saved.readSavedRun();
  assert.equal(run.stage, 'G1');
  assert.deepEqual(run.record, { w: 0, d: 0, l: 0 });
  assert.equal(run.status, 'playing');
  assert.equal(run.complete, false);

  store.set(saved.DAILY_KEY, JSON.stringify({ streak: 'x', lastPlayed: 12, results: 4 }));
  const d = saved.readDailyStatus();
  assert.equal(d.streak, 0);
  assert.equal(d.lastPlayed, null);
  assert.equal(d.todayResult, null);
});

test('the daily streak shows only while alive (UTC days)', () => {
  const now = new Date('2026-11-07T23:30:00Z');
  store.set(saved.DAILY_KEY, JSON.stringify({ streak: 4, best: 9, lastPlayed: '2026-11-06' }));
  assert.equal(saved.readDailyStatus(now).streak, 4);
  assert.equal(saved.readDailyStatus(now).playedToday, false);
  store.set(saved.DAILY_KEY, JSON.stringify({ streak: 4, best: 9, lastPlayed: '2026-11-04' }));
  assert.equal(saved.readDailyStatus(now).streak, 0);
  assert.equal(saved.readDailyStatus(now).best, 9);
});

test('a run from a draft persists, restores and feeds the Home summary', () => {
  const { run, meta } = runStore.createRunFromDraft(catalog, {
    session: draft,
    context: { kind: 'run', type: 'nations', difficulty: 'pro', seed: 42 },
  });
  assert.equal(meta.mode, 'nations');
  assert.equal(meta.type, 'nations');
  assert.equal(meta.formation, '433');
  runStore.saveRun(run, meta, { pending: { id: 'run:x:0', round: 0, seed: 1 }, log: [] });
  const summary = saved.readSavedRun();
  assert.equal(summary.stage, 'G1');
  assert.equal(summary.team, 'Your XI');
  assert.equal(summary.complete, false);

  const back = runStore.loadRun(catalog);
  assert.deepEqual(back.run.snapshot(), run.snapshot());
  assert.equal(back.pending.round, 0);
  // Play it out with the fast model; the summary follows every save.
  while (!back.run.complete) {
    back.run.simulateNext();
    runStore.saveRun(back.run, back.meta, { pending: null });
  }
  const done = saved.readSavedRun();
  assert.equal(done.complete, true);
  assert.ok(['champion', 'eliminated'].includes(done.status));
  assert.equal(done.grade, back.run.grade().grade);
  assert.equal(done.stage, runStore.stageIdOf(back.run.snapshot()));
  assert.equal(runStore.readRunState().pending, null);

  // The finished run is in the trophy cabinet, once, however often it is saved again.
  runStore.saveRun(back.run, back.meta, { pending: null });
  const cabinet = records.readRecords();
  assert.equal(cabinet.runs, 1);
  assert.equal(cabinet.titles, done.status === 'champion' ? 1 : 0);
  assert.equal(cabinet.levels.find(l => l.id === 'pro').runs, 1);
  assert.equal(records.runNews(back.meta.id).level, 'pro');

  runStore.clearRun();
  assert.equal(runStore.loadRun(catalog), null);
  assert.equal(saved.readSavedRun(), null);
  assert.equal(records.readRecords().runs, 1, 'clearing the run keeps the records');
});

test('trophy cabinet: one cup per difficulty, every run counted once', () => {
  assert.deepEqual(
    records.LEVELS.map(l => l.id),
    DIFFICULTIES,
  );
  for (const level of records.LEVELS) assert.equal(level.label, DIFFICULTY_LABELS[level.id]);

  const empty = records.readRecords();
  assert.equal(empty.runs, 0);
  assert.equal(empty.won, 0);
  assert.equal(empty.levels.length, 5);
  assert.equal(empty.levels[0].bestShort, '');

  const out = (stage, w, l) => ({
    complete: true,
    status: 'eliminated',
    difficulty: 'pro',
    stage,
    record: { w, d: 0, l },
  });
  const won = (difficulty, w = 7) => ({
    complete: true,
    status: 'champion',
    difficulty,
    stage: 'F',
    record: { w, d: 8 - w, l: 0 },
  });
  // Unfinished, unknown or id-less runs are not counted.
  assert.equal(records.recordRun({ ...out('QF', 3, 1), complete: false }, 'a'), null);
  assert.equal(records.recordRun({ ...out('QF', 3, 1), difficulty: 'godlike' }, 'a'), null);
  assert.equal(records.recordRun(out('QF', 3, 1), undefined), null);
  assert.equal(records.readRecords().runs, 0);

  assert.deepEqual(records.recordRun(out('G3', 1, 2), 'a'), [], 'a first run is no "best"');
  assert.equal(records.recordRun(out('G3', 1, 2), 'a'), null, 'counted once');
  assert.deepEqual(records.recordRun(out('SF', 5, 1), 'b'), ['best']);
  assert.deepEqual(records.recordRun(out('QF', 3, 1), 'c'), []);
  let pro = records.readRecords().levels.find(l => l.id === 'pro');
  assert.deepEqual(
    [pro.runs, pro.titles, pro.best, pro.bestShort, pro.bestLabel],
    [3, 0, 6, 'SF', 'Semi-final'],
  );
  assert.deepEqual(records.runNews('b'), { level: null, news: [] }, 'only the last run has news');

  assert.deepEqual(records.recordRun(won('pro'), 'd'), ['title']);
  assert.deepEqual(records.recordRun(won('pro', 8), 'e'), ['perfect']);
  assert.deepEqual(records.recordRun(won('pro', 8), 'f'), []);
  assert.deepEqual(records.recordRun(out('F', 7, 1), 'g'), [], 'a final is no best after a title');
  pro = records.readRecords().levels.find(l => l.id === 'pro');
  assert.deepEqual([pro.runs, pro.titles, pro.perfect, pro.bestShort], [7, 3, 2, 'Won']);

  for (const [i, level] of ['amateur', 'semipro', 'worldclass'].entries())
    assert.deepEqual(records.recordRun(won(level), `h${i}`), ['title']);
  assert.deepEqual(records.recordRun(won('legendary', 8), 'last'), ['title', 'perfect', 'cabinet']);
  const full = records.readRecords();
  assert.deepEqual([full.runs, full.titles, full.perfect, full.won], [11, 7, 3, 5]);
  assert.deepEqual(records.runNews('last'), {
    level: 'legendary',
    news: ['title', 'perfect', 'cabinet'],
  });

  // Broken or foreign data reads as an empty cabinet; odd numbers are repaired.
  store.set(records.RECORDS_KEY, '{nope');
  assert.equal(records.readRecords().runs, 0);
  store.set(
    records.RECORDS_KEY,
    JSON.stringify({
      format: 2,
      levels: { pro: { runs: 'x', titles: 2, perfect: 9, best: 99 }, amateur: { best: 42 } },
      seen: 'no',
      last: { id: 4 },
    }),
  );
  const fixed = records.readRecords();
  assert.deepEqual(
    fixed.levels.map(l => [l.runs, l.titles, l.perfect, l.best]),
    [
      [0, 0, 0, 7],
      [0, 0, 0, 0],
      [2, 2, 2, 8],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
  );
  assert.equal(fixed.last, null);
  assert.deepEqual(records.recordRun(out('QF', 3, 1), 'z'), []);

  // A format-1 cabinet (seven rounds, no Round of 32) keeps its rounds: best 3 (R16) and up
  // move by one, group stages stay, titles stay titles; the next write stores format 2.
  store.set(
    records.RECORDS_KEY,
    JSON.stringify({
      format: 1,
      levels: {
        amateur: { runs: 2, titles: 1, perfect: 1, best: 7 },
        pro: { runs: 3, best: 3 },
        legendary: { runs: 1, best: 2 },
      },
      seen: ['old'],
    }),
  );
  const migrated = records.readRecords().levels;
  assert.deepEqual(
    migrated.map(l => [l.best, l.bestShort]),
    [
      [8, 'Won'],
      [0, ''],
      [4, 'R16'],
      [0, ''],
      [2, 'Group'],
    ],
  );
  assert.equal(records.recordRun(out('R32', 3, 1), 'old'), null, 'seen ids carry over');
  assert.deepEqual(records.recordRun(out('R32', 3, 1), 'new'), []);
  assert.equal(JSON.parse(store.get(records.RECORDS_KEY)).format, 2);
  assert.equal(records.readRecords().levels.find(l => l.id === 'pro').bestLabel, 'Round of 16');
});

test('a corrupt or foreign saved run is ignored', () => {
  store.set(runStore.RUN_STATE_KEY, JSON.stringify({ format: 1, run: { type: 'cup-run' } }));
  assert.equal(runStore.loadRun(catalog), null);
  store.set(runStore.RUN_STATE_KEY, JSON.stringify({ format: 99 }));
  assert.equal(runStore.readRunState(), null);
});

test('a run saved in the seven-match format reads as no run; a finished one stays on Home', () => {
  const { run, meta } = runStore.createRunFromDraft(catalog, {
    session: draft,
    context: { kind: 'run', type: 'nations', difficulty: 'pro', seed: 42 },
  });
  runStore.saveRun(run, meta);
  // What an older version stored: cup format 1 and a Home summary without `rounds`.
  const state = JSON.parse(store.get(runStore.RUN_STATE_KEY));
  state.run.format = 1;
  store.set(runStore.RUN_STATE_KEY, JSON.stringify(state));
  const { rounds, ...summary } = JSON.parse(store.get(saved.RUN_KEY));
  assert.equal(rounds, 8);
  store.set(saved.RUN_KEY, JSON.stringify({ ...summary, stage: 'QF' }));
  assert.equal(runStore.readRunState(), null);
  assert.equal(runStore.loadRun(catalog), null);
  assert.equal(saved.readSavedRun(), null, 'an old run in progress cannot be continued');
  store.set(
    saved.RUN_KEY,
    JSON.stringify({ ...summary, stage: 'F', status: 'champion', complete: true, grade: 'S+' }),
  );
  assert.equal(saved.readSavedRun().grade, 'S+', 'a finished old run still shows as the last run');
});

test('draft types map to core modes and back', () => {
  assert.equal(runStore.modeOf('club-country'), 'clubAndCountry');
  assert.equal(runStore.modeOf('nope'), 'nations');
  assert.equal(runStore.typeOf('clubAndCountry'), 'club-country');
  assert.equal(runStore.typeOf('club-country'), 'club-country');
});

test('stage ids follow the next match, then the last one', () => {
  const rounds = n =>
    Array.from({ length: 8 }, (_, i) => ({ result: i < n ? { outcome: 'W' } : null }));
  assert.equal(runStore.stageIdOf({ rounds: rounds(0), complete: false }), 'G1');
  assert.equal(runStore.stageIdOf({ rounds: rounds(3), complete: false }), 'R32');
  assert.equal(runStore.stageIdOf({ rounds: rounds(4), complete: false }), 'R16');
  assert.equal(runStore.stageIdOf({ rounds: rounds(4), complete: true }), 'R32');
  assert.equal(runStore.stageIdOf({ rounds: rounds(8), complete: true }), 'F');
  assert.deepEqual([3, 4, 7].map(runStore.roundShort), ['R32', 'R16', 'Final']);
});

test('group stakes on the last matchday read the points honestly', () => {
  const teams = [
    { key: 'user', name: 'You' },
    { key: 'a', name: 'A' },
    { key: 'b', name: 'B' },
    { key: 'c', name: 'C' },
  ];
  const fx = (md, home, away, score) => ({ md, home, away, score });
  const snapshot = fixtures => ({ complete: false, round: 2, group: { teams, fixtures } });
  // You 1 pt, A 4, B 3, C 3: a win (4 pts) is enough even in third place; a draw or a
  // loss is out.
  const tight = snapshot([
    fx(1, 'user', 'a', [1, 1]),
    fx(1, 'b', 'c', [0, 2]),
    fx(2, 'user', 'b', [0, 1]),
    fx(2, 'c', 'a', [0, 1]),
    fx(3, 'user', 'c', null),
    fx(3, 'a', 'b', null),
  ]);
  assert.deepEqual(
    { W: runStore.groupStakes(tight).W, D: runStore.groupStakes(tight).D },
    { W: 'through', D: 'out' },
  );
  assert.equal(runStore.groupStakes(tight).L, 'out');
  assert.equal(runStore.groupStakes(tight).third, true);
  assert.deepEqual(runStore.groupStakes(tight).other, { home: 'A', away: 'B' });
  // You 6 pts after two wins: through whatever happens.
  const safe = snapshot([
    fx(1, 'user', 'a', [2, 0]),
    fx(1, 'b', 'c', [0, 0]),
    fx(2, 'user', 'b', [1, 0]),
    fx(2, 'c', 'a', [0, 0]),
    fx(3, 'user', 'c', null),
    fx(3, 'a', 'b', null),
  ]);
  assert.equal(runStore.groupStakes(safe).W, 'through');
  assert.equal(runStore.groupStakes(safe).L, 'through', 'six points: third at worst');
  assert.equal(runStore.groupStakes({ ...safe, round: 1 }), null);
  // You 0 pts, A 6, B 3, C 3: a win gives 3 pts — top two or a third on goal difference.
  const third = snapshot([
    fx(1, 'user', 'a', [0, 1]),
    fx(1, 'b', 'c', [1, 0]),
    fx(2, 'user', 'b', [0, 1]),
    fx(2, 'c', 'a', [0, 1]),
    fx(3, 'user', 'c', null),
    fx(3, 'a', 'b', null),
  ]);
  const stakes = runStore.groupStakes(third);
  assert.deepEqual([stakes.W, stakes.D, stakes.L, stakes.third], ['depends', 'out', 'out', true]);
  assert.equal(runStore.groupStakes(safe).third, false);
});

test('challenge links carry the draft and the friend result, on this page', () => {
  const link = runStore.challengeLink(
    {
      kind: 'cup',
      mode: 'clubAndCountry',
      seed: 123456,
      formation: '4231',
      difficulty: 'worldclass',
      hideRatings: true,
    },
    { record: { w: 5, d: 1, l: 1 }, grade: 'B+', base: 'https://x.github.io/fd/index.html#/run' },
  );
  assert.match(
    link,
    /^https:\/\/x\.github\.io\/fd\/index\.html#\/challenge\?c=c1\.c\.x\.4231\.w\.h\./,
  );
  const query = Object.fromEntries(new URLSearchParams(link.split('?')[1]));
  const { challenge, score } = runStore.readChallengeQuery(query);
  assert.equal(challenge.seed, 123456);
  assert.equal(challenge.mode, 'clubAndCountry');
  assert.equal(challenge.hideRatings, true);
  assert.deepEqual(score, { w: 5, d: 1, l: 1, grade: 'B+' });
  assert.deepEqual(runStore.readChallengeQuery({ c: 'garbage', r: '9-9' }), {
    challenge: null,
    score: null,
  });
  assert.equal(runStore.gradeFromToken(runStore.gradeToken('S+')), 'S+');
  assert.equal(runStore.gradeFromToken('zz'), null);
  assert.ok(decodeChallenge(query.c));
});

test('the daily record locks an attempt, keeps the streak and trims old replays', () => {
  const { run } = runStore.createRunFromDraft(catalog, { session: draft, context: {} });
  let state = runStore.readDaily();
  assert.equal(state.current, null);
  state = runStore.beginDailyAttempt(state, {
    id: '2026-11-06',
    number: 6,
    run,
    rating: 82,
    perfect: 97.5,
    formation: '433',
  });
  assert.equal(saved.readDailyStatus(new Date('2026-11-06T10:00:00Z')).playedToday, true);
  state = runStore.finishDailyAttempt(state, {
    id: '2026-11-06',
    record: { w: 3, d: 0, l: 1, gf: 5, ga: 3 },
    points: 640,
    grade: 'D',
    run: run.serialize(),
  });
  state = runStore.beginDailyAttempt(state, {
    id: '2026-11-07',
    number: 7,
    run,
    rating: 82,
    perfect: 97.5,
    formation: '433',
  });
  assert.equal(state.streak, 2);
  assert.equal(state.streakState.current, 2);
  const back = runStore.readDaily();
  assert.equal(back.current.id, '2026-11-07');
  assert.equal(back.lastResult, '3-0-1');
  assert.equal(back.results['2026-11-06'].points, 640);
  assert.equal(
    saved.readDailyStatus(new Date('2026-11-07T12:00:00Z')).todayResult,
    null,
    'no result until the attempt finishes',
  );
  // Only the latest week keeps full run states.
  for (let d = 1; d <= 12; d++)
    state = runStore.finishDailyAttempt(state, {
      id: `2026-10-${String(d).padStart(2, '0')}`,
      record: { w: 0, d: 0, l: 3 },
      points: 0,
      run: { big: true },
    });
  const results = runStore.readDaily().results;
  const withRun = Object.keys(results).filter(id => results[id].run);
  assert.equal(withRun.length, 7);
  assert.ok(withRun.includes('2026-11-06'));
});

test('countdown to the next UTC day', () => {
  assert.equal(runStore.msUntilNextDaily(Date.parse('2026-11-07T23:59:30Z')), 30000);
  assert.equal(runStore.countdownText(3723000), '01:02:03');
});

test('kits: national teams get stable colours, clubs keep theirs', () => {
  assert.deepEqual(runStore.nationKit('br'), ['#f9d616', '#1d4f9c']);
  assert.deepEqual(runStore.nationKit('zz'), runStore.nationKit('zz'));
  assert.deepEqual(runStore.sideColors({ color: '#C8102E', secondary: '#FFFFFF' }), [
    '#C8102E',
    '#FFFFFF',
  ]);
  assert.deepEqual(runStore.sideColors({ color: null, code: 'fr' }), ['#1b2a5c', '#ffffff']);
});

test('auto-sim results convert to CupRun input for the user side', () => {
  const result = {
    score: [1, 1],
    shootout: { score: [4, 5], winner: 1 },
    players: [
      { profileId: 'a', team: 0, rating: 7.1, goals: 1, assists: 0 },
      { profileId: 'b', team: 1, rating: 6, goals: 1, assists: 0 },
    ],
  };
  assert.deepEqual(runSide(result), {
    goalsFor: 1,
    goalsAgainst: 1,
    shootout: { winner: 'opponent', score: [4, 5] },
    players: [{ profileId: 'a', rating: 7.1, goals: 1, assists: 0 }],
  });
});

test('share image layout: tokens inside the pitch, keeper at the bottom, no overlaps', () => {
  const box = { x: 72, y: 482, w: 936, h: 700 };
  for (const formation of ['433', '442', '4231', '352', '5212', '41212']) {
    const tokens = share.pitchTokenLayout(formation, box);
    assert.equal(tokens.length, 11);
    for (const t of tokens) {
      assert.ok(t.x > box.x && t.x < box.x + box.w, `${formation} x`);
      assert.ok(t.y > box.y && t.y < box.y + box.h, `${formation} y`);
    }
    const gk = tokens.find(t => t.role === 'GK');
    assert.equal(Math.max(...tokens.map(t => t.y)), gk.y);
    for (const a of tokens)
      for (const b of tokens)
        if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 80, `${formation} overlap`);
  }
  const squares = share.resultSquares(8, { x: 0, y: 0, size: 60, gap: 10, groupGap: 30 });
  assert.equal(squares[1].x - squares[0].x, 70);
  assert.equal(squares[3].x - squares[2].x, 90);
  assert.ok(squares.at(-1).x + 60 <= share.SHARE_W - 72 * 2);
  assert.equal(
    share.fitText('Valverde', 100, s => s.length * 10),
    'Valverde',
  );
  assert.equal(
    share.fitText('Alexander-Arnold', 100, s => s.length * 10),
    'Alexander…',
  );
});
