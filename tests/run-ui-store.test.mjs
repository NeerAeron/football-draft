// RUN-UI pure helpers: persistence + tolerant readers (lib/run-store.js, lib/saved.js), group
// stakes, challenge links, the daily record, and the share image layout math.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeCatalog } from '../scripts/data/catalog-file.mjs';
import {
  createDraftSession,
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  DRAFT_MODES,
} from '../app/core/draft/session.js';
import { decodeChallenge, ULTIMATE } from '../app/core/competition/share.js';
import { PLACES, PLACE_LABELS, MEDALS, restoreCupRun } from '../app/core/competition/cup.js';

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
const { runResultFor } = await import('../app/ui/lib/match-store.js');

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
    JSON.stringify({ stage: 'X9', record: { w: 'a' }, status: 'weird', rounds: 8, format: 3 }),
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
  const end = back.run.snapshot();
  assert.deepEqual(
    [done.placeLabel, done.medal, done.perfect, done.budget],
    [end.placeLabel, end.medal, end.perfect, false],
  );
  assert.equal('grade' in done, false);
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

test('trophy cabinet: medals and best finish per difficulty, every run counted once', () => {
  assert.deepEqual(
    records.LEVELS.map(l => l.id),
    DIFFICULTIES,
  );
  for (const level of records.LEVELS) assert.equal(level.label, DIFFICULTY_LABELS[level.id]);
  // The places, their labels and medals mirror the core's.
  assert.deepEqual(
    records.PLACES.map(p => p.id),
    PLACES,
  );
  for (const p of records.PLACES) {
    assert.equal(p.label, PLACE_LABELS[p.id]);
    assert.equal(p.medal, MEDALS[p.id]);
  }
  assert.equal(records.ULTIMATE.name, ULTIMATE.name);
  assert.equal(records.ULTIMATE.level, ULTIMATE.difficulty);

  const empty = records.readRecords();
  assert.equal(empty.runs, 0);
  assert.equal(empty.won, 0);
  assert.equal(empty.levels.length, 3);
  assert.deepEqual(
    [empty.levels[0].bestShort, empty.levels[0].medal, empty.levels[0].budget.runs],
    ['', null, 0],
  );
  assert.deepEqual([empty.ultimate.done, empty.ultimate.name], [false, 'Immortals']);
  assert.match(empty.ultimate.requirement, /Legendary.*Budget.*eight/);

  const out = (place, w, l, difficulty = 'pro') => ({
    complete: true,
    status: 'eliminated',
    difficulty,
    place,
    record: { w, d: 0, l },
  });
  const won = (difficulty, w = 7) => ({
    complete: true,
    status: 'champion',
    difficulty,
    place: 'champion',
    record: { w, d: 8 - w, l: 0 },
  });
  const level = (id, cabinet = records.readRecords()) => cabinet.levels.find(l => l.id === id);
  // Unfinished, unknown or id-less runs are not counted; nor is a removed difficulty.
  assert.equal(records.recordRun({ ...out('qf', 3, 1), complete: false }, 'a'), null);
  assert.equal(records.recordRun({ ...out('qf', 3, 1), difficulty: 'godlike' }, 'a'), null);
  assert.equal(records.recordRun(out('qf', 3, 1, 'amateur'), 'a'), null);
  assert.equal(records.recordRun(out('qf', 3, 1), undefined), null);
  assert.equal(records.readRecords().runs, 0);

  assert.deepEqual(records.recordRun(out('group', 1, 2), 'a'), [], 'a first run is no "best"');
  assert.equal(records.recordRun(out('group', 1, 2), 'a'), null, 'counted once');
  assert.deepEqual(records.recordRun(out('fourth', 5, 2), 'b'), ['best']);
  assert.deepEqual(records.recordRun(out('qf', 3, 1), 'c'), []);
  let pro = level('pro');
  assert.deepEqual(
    [pro.runs, pro.titles, pro.best, pro.bestShort, pro.bestLabel, pro.medal],
    [3, 0, 4, '4th', 'Fourth place', null],
  );
  assert.deepEqual(
    records.runNews('b'),
    { level: null, budget: false, news: [] },
    'only the last run has news',
  );
  // Bronze, then silver: each a new best, each a medal.
  assert.deepEqual(records.recordRun(out('third', 6, 1), 'c3'), ['best']);
  assert.deepEqual(records.recordRun(out('final', 7, 1), 'c2'), ['best']);
  assert.deepEqual(records.recordRun(out('third', 6, 1), 'c4'), []);
  pro = level('pro');
  assert.deepEqual(
    [pro.gold, pro.silver, pro.bronze, pro.bestLabel, pro.bestShort, pro.medal],
    [0, 1, 2, 'Runners-up', '2nd', 'silver'],
  );

  assert.deepEqual(records.recordRun(won('pro'), 'd'), ['title']);
  assert.deepEqual(records.recordRun(won('pro', 8), 'e'), ['perfect']);
  assert.deepEqual(records.recordRun(won('pro', 8), 'f'), []);
  assert.deepEqual(records.recordRun(out('final', 7, 1), 'g'), [], 'no best after a title');
  pro = level('pro');
  assert.deepEqual(
    [pro.runs, pro.titles, pro.gold, pro.silver, pro.bronze, pro.perfect, pro.bestShort, pro.medal],
    [10, 3, 3, 2, 2, 2, 'Won', 'gold'],
  );

  assert.deepEqual(records.recordRun(won('worldclass'), 'h'), ['title']);
  assert.deepEqual(records.recordRun(won('legendary', 8), 'last'), ['title', 'perfect', 'cabinet']);
  const full = records.readRecords();
  assert.deepEqual([full.runs, full.titles, full.perfect, full.won], [12, 5, 3, 3]);
  assert.deepEqual(full.medals, { gold: 5, silver: 2, bronze: 2 });
  assert.deepEqual(records.runNews('last'), {
    level: 'legendary',
    budget: false,
    news: ['title', 'perfect', 'cabinet'],
  });

  // Budget mode: a cabinet of its own. A perfect standard Legendary run is not the ultimate.
  assert.equal(full.ultimate.done, false);
  assert.equal(full.budgetRuns, 0);
  const budget = summary => ({ ...summary, budget: true });
  assert.deepEqual(records.recordRun(budget(out('third', 6, 1, 'legendary')), 'b1'), []);
  assert.deepEqual(records.recordRun(budget(won('legendary')), 'b2'), ['title']);
  assert.deepEqual(records.recordRun(budget(won('pro', 8)), 'b3'), ['title', 'perfect']);
  let cabinet = records.readRecords();
  assert.equal(cabinet.ultimate.done, false, 'needs Legendary, Budget and 8–0 together');
  assert.deepEqual(
    [level('legendary', cabinet).runs, level('legendary', cabinet).gold],
    [1, 1],
    'the standard cabinet is untouched',
  );
  const lb = level('legendary', cabinet).budget;
  assert.deepEqual([lb.runs, lb.gold, lb.bronze, lb.medal, lb.bestShort], [2, 1, 1, 'gold', 'Won']);
  assert.equal(cabinet.budgetRuns, 3);
  assert.equal(cabinet.won, 3, 'the count is of standard cups');
  assert.deepEqual(
    records.recordRun(budget(won('legendary', 8)), 'b4', { now: Date.UTC(2026, 10, 12) }),
    ['perfect', 'ultimate'],
  );
  assert.deepEqual(records.runNews('b4'), {
    level: 'legendary',
    budget: true,
    news: ['perfect', 'ultimate'],
  });
  assert.deepEqual(records.recordRun(budget(won('legendary', 8)), 'b5'), []);
  cabinet = records.readRecords();
  assert.deepEqual(
    [cabinet.ultimate.done, cabinet.ultimate.count, cabinet.ultimate.first],
    [true, 2, '2026-11-12T00:00:00.000Z'],
  );
  const stored = JSON.parse(store.get(records.RECORDS_KEY));
  assert.equal(stored.format, 3);
  assert.deepEqual(Object.keys(stored.levels), DIFFICULTIES);

  // Broken or foreign data reads as an empty cabinet; odd numbers are repaired.
  store.set(records.RECORDS_KEY, '{nope');
  assert.equal(records.readRecords().runs, 0);
  store.set(
    records.RECORDS_KEY,
    JSON.stringify({
      format: 3,
      levels: { pro: { runs: 'x', gold: 2, perfect: 9, best: 99 }, worldclass: { best: 42 } },
      budget: 7,
      ultimate: { count: 5 },
      seen: 'no',
      last: { id: 4 },
    }),
  );
  const fixed = records.readRecords();
  assert.deepEqual(
    fixed.levels.map(l => [l.runs, l.gold, l.perfect, l.best]),
    [
      [2, 2, 2, 7],
      [0, 0, 0, 6],
      [0, 0, 0, 0],
    ],
  );
  assert.equal(fixed.ultimate.done, false, 'no ultimate without a perfect Budget Legendary run');
  assert.equal(fixed.last, null);
  assert.deepEqual(records.recordRun(out('qf', 3, 1), 'z'), []);
});

test('trophy cabinet: one cut-off — an older format reads as an empty cabinet', () => {
  // Formats 1 and 2 (the furthest round as `best`, `titles`, five levels) are not converted.
  const old = {
    levels: {
      amateur: { runs: 9, titles: 4, perfect: 2, best: 8 },
      pro: { runs: 6, titles: 2, perfect: 1, best: 8 },
      worldclass: { runs: 4, titles: 0, perfect: 0, best: 7 },
      legendary: { runs: 5, titles: 0, perfect: 0, best: 6 },
    },
    seen: ['old'],
    last: { id: 'old', level: 'pro', news: ['title'] },
  };
  for (const format of [1, 2, undefined, '3', 4]) {
    store.set(records.RECORDS_KEY, JSON.stringify({ ...old, format }));
    const cabinet = records.readRecords();
    assert.deepEqual([cabinet.runs, cabinet.titles, cabinet.won], [0, 0, 0], String(format));
    assert.ok(cabinet.levels.every(l => l.runs === 0 && l.bestLabel === ''));
    assert.equal(cabinet.last, null);
    assert.deepEqual(records.runNews('old').news, []);
  }
  // The next finished run starts the cabinet in today's format; nothing of the old one stays.
  const run = { complete: true, status: 'eliminated', difficulty: 'pro', place: 'r32' };
  assert.deepEqual(records.recordRun(run, 'old'), [], 'old seen ids are gone too');
  const stored = JSON.parse(store.get(records.RECORDS_KEY));
  assert.equal(stored.format, 3);
  assert.deepEqual(Object.keys(stored.levels), ['pro', 'worldclass', 'legendary']);
  assert.deepEqual(
    records.readRecords().levels.map(l => [l.runs, l.bestLabel]),
    [
      [1, 'Round of 32'],
      [0, ''],
      [0, ''],
    ],
  );
  // Levels the game does not have are never read or counted.
  store.set(
    records.RECORDS_KEY,
    JSON.stringify({ format: 3, levels: { amateur: { runs: 4, gold: 4 }, pro: { runs: 1 } } }),
  );
  assert.equal(records.readRecords().runs, 1);
});

test('a run in progress is what a new World Cup draft would replace', () => {
  assert.equal(runStore.runInProgress(), false, 'nothing saved');
  const { run, meta } = runStore.createRunFromDraft(catalog, { session: draft, context: {} });
  runStore.saveRun(run, meta);
  assert.equal(runStore.runInProgress(), true, 'before the first match');
  run.recordResult({ goalsFor: 1, goalsAgainst: 0 });
  runStore.saveRun(run, meta);
  assert.equal(runStore.runInProgress(), true);
  // The summary alone (its state lost or unreadable) is nothing to lose: the hub shows no run.
  const state = store.get(runStore.RUN_STATE_KEY);
  store.set(runStore.RUN_STATE_KEY, '{broken');
  assert.equal(runStore.runInProgress(), false);
  store.delete(runStore.RUN_STATE_KEY);
  assert.equal(runStore.runInProgress(), false);
  store.set(runStore.RUN_STATE_KEY, state);
  store.delete(saved.RUN_KEY);
  assert.equal(runStore.runInProgress(), false);
  // A finished run is replaced without a question.
  while (!run.complete) run.recordResult({ goalsFor: 0, goalsAgainst: 2 });
  runStore.saveRun(run, meta);
  assert.equal(runStore.runInProgress(), false);
  runStore.clearRun();
  assert.equal(runStore.runInProgress(), false);
});

test('a corrupt or foreign saved run is ignored', () => {
  store.set(runStore.RUN_STATE_KEY, JSON.stringify({ format: 1, run: { type: 'cup-run' } }));
  assert.equal(runStore.loadRun(catalog), null);
  store.set(runStore.RUN_STATE_KEY, JSON.stringify({ format: 99 }));
  assert.equal(runStore.readRunState(), null);
});

test('one cut-off: anything saved in an older format reads as nothing saved', () => {
  const { run, meta } = runStore.createRunFromDraft(catalog, {
    session: draft,
    context: { kind: 'run', type: 'nations', difficulty: 'pro', seed: 42 },
  });
  runStore.saveRun(run, meta);
  const fresh = JSON.parse(store.get(runStore.RUN_STATE_KEY));
  const { format, ...summary } = JSON.parse(store.get(saved.RUN_KEY));
  assert.equal(format, saved.RUN_SUMMARY_FORMAT);
  assert.equal(summary.rounds, 8);
  assert.equal(runStore.runInProgress(), true);
  const none = what => {
    assert.equal(runStore.readRunState(), null, what);
    assert.equal(runStore.loadRun(catalog), null, what);
    assert.equal(runStore.runInProgress(), false, what);
  };
  // The run state: an older cup format, a removed difficulty or mode, rules of an older shape.
  for (const [what, patch] of [
    ['cup format 2', { format: 2 }],
    ['cup format 1', { format: 1 }],
    ['Amateur', { difficulty: 'amateur' }],
    ['Club & Country', { mode: 'clubAndCountry' }],
    ['no Captain in the rules', { rules: { ...fresh.run.rules, links: { nation: 1.5, club: 1 } } }],
  ]) {
    store.set(
      runStore.RUN_STATE_KEY,
      JSON.stringify({ ...fresh, run: { ...fresh.run, ...patch } }),
    );
    assert.equal(runStore.loadRun(catalog), null, what);
  }
  for (const old of [2, 1]) {
    store.set(
      runStore.RUN_STATE_KEY,
      JSON.stringify({ ...fresh, run: { ...fresh.run, format: old } }),
    );
    none(`cup format ${old}`);
  }
  // Home's summary: without today's format there is no run — in progress or finished (an old
  // one carried a stage label and a letter grade instead of a place).
  store.set(saved.RUN_KEY, JSON.stringify({ ...summary, stage: 'QF' }));
  assert.equal(saved.readSavedRun(), null);
  store.set(
    saved.RUN_KEY,
    JSON.stringify({
      ...summary,
      format: 2,
      stage: 'F',
      status: 'champion',
      complete: true,
      grade: 'S+',
      stageLabel: 'Champions',
    }),
  );
  assert.equal(saved.readSavedRun(), null);
  // Today's summary of a finished run reads by its place and medal, nothing else.
  store.set(
    saved.RUN_KEY,
    JSON.stringify({
      ...summary,
      format,
      status: 'champion',
      complete: true,
      stageLabel: 'Champions',
      grade: 'S+',
    }),
  );
  const last = saved.readSavedRun();
  assert.deepEqual(
    [last.complete, last.placeLabel, last.medal, 'grade' in last],
    [true, null, null, false],
  );
  // The draft slot: a draft saved in the older format is nothing to resume.
  const session = JSON.parse(JSON.stringify(draft.serialize()));
  store.set(saved.DRAFT_KEY, JSON.stringify({ format: 1, context: { kind: 'run' }, session }));
  assert.equal(saved.readSavedDraft(), null);
  store.set(
    saved.DRAFT_KEY,
    JSON.stringify({ format: saved.DRAFT_FORMAT, context: { kind: 'run' }, session }),
  );
  assert.equal(saved.readSavedDraft().complete, true);
  // The Daily: an entry from before the places has no place to show; an attempt that does
  // not restore is no attempt.
  const today = new Date('2026-11-09T12:00:00Z');
  store.set(
    saved.DAILY_KEY,
    JSON.stringify({
      lastPlayed: '2026-11-09',
      results: { '2026-11-09': { points: 500, stageLabel: 'Quarter-finals', grade: 'B' } },
      current: { id: '2026-11-09', run: { type: 'cup-run', format: 2 } },
    }),
  );
  assert.deepEqual(saved.readDailyStatus(today).todayResult, { points: 500, placeLabel: null });
  assert.throws(() => restoreCupRun(catalog, runStore.readDaily().current.run), /Not a saved run/);
});

test('tolerant readers: whatever is in storage, nothing throws and nothing is invented', () => {
  // Every key the game owns × a pile of junk and half-shapes: each reader answers "nothing".
  const junk = [
    '',
    '{',
    'null',
    'true',
    '7',
    '"text"',
    '[]',
    '[1,2,3]',
    '{}',
    '{"format":1}',
    '{"format":2}',
    '{"format":3}',
    '{"format":99,"run":{},"session":{},"levels":7}',
    '{"format":3,"run":"x","meta":4,"pending":5,"log":6}',
    '{"format":1,"run":{"type":"cup-run","format":3}}',
    '{"format":1,"run":{"type":"cup-run","format":3,"mode":"nations"}}',
    '{"format":2,"session":{"type":"draft-session"}}',
    '{"format":2,"context":7,"session":{"type":"draft-session","options":{"mode":"nations"}}}',
    '{"format":2,"session":{"type":"draft-session","options":{"mode":"nations"},"state":{"picks":7}}}',
    '{"format":3,"levels":{"pro":{"runs":"many","gold":-3,"best":99}},"seen":[1,null],"last":{"id":3}}',
    '{"format":3,"levels":[],"budget":"x","ultimate":{"count":5,"first":7}}',
    '{"streak":-4,"best":"x","lastPlayed":"tomorrow","results":[],"current":{"id":7},"draft":[]}',
    '{"results":{"2026-11-09":"x"},"streakState":{"current":"a","last":9},"current":{"run":1}}',
    '{"stage":{},"record":"x","status":7,"format":3,"medal":{},"placeLabel":4}',
    JSON.stringify({ a: 'x'.repeat(5000) }),
  ];
  const keys = [
    saved.RUN_KEY,
    runStore.RUN_STATE_KEY,
    saved.DAILY_KEY,
    saved.DRAFT_KEY,
    records.RECORDS_KEY,
  ];
  const now = new Date('2026-11-09T12:00:00Z');
  let reads = 0;
  for (const key of keys)
    for (const value of junk) {
      store.clear();
      store.set(key, value);
      const what = `${key} = ${value.slice(0, 50)}`;
      assert.doesNotThrow(() => {
        const run = saved.readSavedRun();
        assert.ok(run === null || (typeof run.stage === 'string' && run.record.w >= 0), what);
        assert.equal(saved.readSavedDraft(now), null, what);
        assert.equal(runStore.loadRun(catalog), null, what);
        assert.equal(runStore.runInProgress(), false, what);
        const status = saved.readDailyStatus(now);
        assert.ok(status.streak >= 0 && status.todayResult === null, what);
        assert.equal(status.inProgress, false, what);
        const daily = runStore.readDaily();
        assert.equal(daily.draft, null, what);
        assert.equal(runStore.lockedDailyDraft(daily, '2026-11-09'), null, what);
        assert.ok(daily.streakState.current >= 0 || daily.streakState.current < 0, what);
        runStore.displayStreak(daily, '2026-11-09');
        const cabinet = records.readRecords();
        assert.ok(cabinet.runs >= 0 && cabinet.levels.length === 3, what);
        assert.ok(
          cabinet.levels.every(l => l.gold >= 0 && l.best >= 0 && l.best <= 7),
          what,
        );
        records.runNews('x');
      }, what);
      reads++;
    }
  assert.equal(reads, keys.length * junk.length);
  // A result query: the record, optionally with a place — anything else is no result.
  for (const r of ['5-1-1.sp', '5-1-1.b', '5-1-1.zz', '5-1-1.', '5-1', '12-0-0', 'x', '5-1-1.th.x'])
    assert.equal(runStore.readChallengeQuery({ c: 'c1.c.n.433.p.0.1a', r }).score, null, r);
  assert.deepEqual(runStore.readChallengeQuery({ c: 'c1.c.n.433.p.0.1a', r: '5-1-1' }).score, {
    w: 5,
    d: 1,
    l: 1,
    place: null,
    placeLabel: null,
  });
  for (const query of [undefined, {}, { c: 7 }, { c: [], r: {} }, { c: 'c1.c.n.433.a.0.1a' }])
    assert.equal(runStore.readChallengeQuery(query).challenge, null);
});

test('the third-place play-off: the Home summary, the labels and the Budget flag', () => {
  const { run, meta } = runStore.createRunFromDraft(catalog, {
    session: draft,
    context: { kind: 'run', type: 'nations', difficulty: 'legendary', seed: 7, budget: true },
  });
  assert.equal(meta.budget, true);
  assert.equal(
    runStore.createRunFromDraft(catalog, { session: draft, context: { kind: 'run' } }).meta.budget,
    false,
    'a missing flag is no Budget run',
  );
  const win = { goalsFor: 1, goalsAgainst: 0 };
  for (let r = 0; r < 6; r++) run.recordResult(win);
  run.recordResult({ goalsFor: 0, goalsAgainst: 2 });
  runStore.saveRun(run, meta);
  const snap = run.snapshot();
  assert.equal(runStore.stageIdOf(snap), '3P');
  assert.deepEqual(
    [runStore.roundLabel(snap.rounds[7]), runStore.roundShort(snap.rounds[7])],
    ['Third-place play-off', '3rd'],
  );
  assert.deepEqual(
    [runStore.roundLabel(7), runStore.roundShort(7), runStore.roundName(0)],
    ['Final', 'Final', 'Matchday 1'],
  );
  let home = saved.readSavedRun();
  assert.deepEqual(
    [home.stage, home.stageLabel, home.complete, home.budget],
    ['F', 'Third-place play-off', false, true],
  );
  const back = runStore.loadRun(catalog);
  assert.equal(back.run.nextMatch().id, 'third');
  back.run.recordResult(win);
  runStore.saveRun(back.run, back.meta);
  home = saved.readSavedRun();
  assert.deepEqual(
    [home.complete, home.status, home.placeLabel, home.medal],
    [true, 'eliminated', 'Third place', 'bronze'],
  );
  // The bronze went into the Budget cabinet of Legendary, not the standard one.
  const legendary = records.readRecords().levels.find(l => l.id === 'legendary');
  assert.deepEqual(
    [legendary.runs, legendary.budget.bronze, legendary.budget.bestLabel],
    [0, 1, 'Third place'],
  );
});

test('the draft type is the core mode; a mode the game no longer has reads as nothing saved', () => {
  for (const mode of ['nations', 'leagues', 'clubs']) {
    assert.equal(runStore.modeOf(mode), mode);
    assert.equal(runStore.typeOf(mode), mode);
  }
  for (const gone of ['club-country', 'clubAndCountry', 'nope', undefined]) {
    assert.equal(runStore.modeOf(gone), 'nations');
    assert.equal(runStore.typeOf(gone), 'nations');
  }
  assert.deepEqual(saved.DRAFT_TYPES, Object.keys(DRAFT_MODES));
  // A run saved in Club & Country: no run to resume, nothing to replace, no crash.
  const { run, meta } = runStore.createRunFromDraft(catalog, { session: draft, context: {} });
  runStore.saveRun(run, meta);
  const state = JSON.parse(store.get(runStore.RUN_STATE_KEY));
  state.run.mode = 'clubAndCountry';
  store.set(runStore.RUN_STATE_KEY, JSON.stringify(state));
  assert.equal(runStore.readRunState(), null);
  assert.equal(runStore.loadRun(catalog), null);
  assert.equal(runStore.runInProgress(), false);
  assert.throws(() => restoreCupRun(catalog, state.run), /Not a saved run/);
  // A draft saved in it: Home offers nothing to resume.
  const session = JSON.parse(JSON.stringify(draft.serialize()));
  const slot = () =>
    JSON.stringify({ format: saved.DRAFT_FORMAT, context: { kind: 'quick' }, session });
  store.set(saved.DRAFT_KEY, slot());
  assert.equal(saved.readSavedDraft().picks, 11);
  session.options.mode = 'clubAndCountry';
  store.set(saved.DRAFT_KEY, slot());
  assert.equal(saved.readSavedDraft(), null);
  // A link in it is not a link.
  assert.equal(runStore.readChallengeQuery({ c: 'c1.c.x.433.p.0.1a' }).challenge, null);
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
  // You 0 pts, A 6, B 3, C 3: a win gives 3 pts — third at best, and a third needs 4.
  const third = snapshot([
    fx(1, 'user', 'a', [0, 1]),
    fx(1, 'b', 'c', [1, 0]),
    fx(2, 'user', 'b', [0, 1]),
    fx(2, 'c', 'a', [0, 1]),
    fx(3, 'user', 'c', null),
    fx(3, 'a', 'b', null),
  ]);
  const stakes = runStore.groupStakes(third);
  assert.deepEqual([stakes.W, stakes.D, stakes.L, stakes.third], ['out', 'out', 'out', false]);
  assert.equal(runStore.groupStakes(safe).third, false);
});

test('challenge links carry the draft and the friend result, on this page', () => {
  const link = runStore.challengeLink(
    {
      kind: 'cup',
      mode: 'leagues',
      seed: 123456,
      formation: '4231',
      difficulty: 'worldclass',
      hideRatings: true,
    },
    {
      record: { w: 5, d: 1, l: 1 },
      place: 'third',
      base: 'https://x.github.io/fd/index.html#/run',
    },
  );
  assert.match(
    link,
    /^https:\/\/x\.github\.io\/fd\/index\.html#\/challenge\?c=c1\.c\.l\.4231\.w\.h\./,
  );
  const query = Object.fromEntries(new URLSearchParams(link.split('?')[1]));
  const { challenge, score } = runStore.readChallengeQuery(query);
  assert.equal(challenge.seed, 123456);
  assert.equal(challenge.mode, 'leagues');
  assert.equal(challenge.hideRatings, true);
  assert.match(link, /&r=5-1-1\.th$/);
  assert.deepEqual(score, { w: 5, d: 1, l: 1, place: 'third', placeLabel: 'Third place' });
  assert.deepEqual(runStore.readChallengeQuery({ c: 'garbage', r: '9-9' }), {
    challenge: null,
    score: null,
  });
  for (const place of PLACES)
    assert.equal(runStore.placeFromToken(runStore.placeToken(place)), place);
  assert.equal(runStore.placeFromToken('zz'), null);
  // One cut-off: a letter grade where the place goes (links from before the places) is no
  // result, and a link on a removed difficulty is no link.
  for (const grade of ['sp', 's', 'ap', 'a', 'bp', 'b', 'cp', 'c', 'dp', 'd', 'f'])
    assert.equal(runStore.readChallengeQuery({ c: query.c, r: `5-1-1.${grade}` }).score, null);
  assert.equal(runStore.readChallengeQuery({ c: 'c1.c.n.433.a.0.1a' }).challenge, null);
  assert.ok(decodeChallenge(query.c));
  // A Budget run's link starts a Budget draft for the friend; any other run's does not.
  const meta = { mode: 'nations', seed: 77, formation: '442', difficulty: 'legendary' };
  assert.equal(runStore.runChallenge(meta, {}).budget, false);
  assert.equal(runStore.runChallenge({ ...meta, budget: 1 }, {}).budget, false);
  const budgetLink = runStore.challengeLink(runStore.runChallenge({ ...meta, budget: true }, {}), {
    base: 'https://x.io/',
  });
  assert.match(budgetLink, /#\/challenge\?c=c1\.c\.n\.442\.l\.b\./);
  const back = runStore.readChallengeQuery({ c: /c=([^&]+)/.exec(budgetLink)[1] }).challenge;
  assert.equal(back.budget, true);
  assert.equal(back.seed, 77);
  assert.equal(
    runStore.readChallengeQuery({
      c: /c=([^&]+)/.exec(runStore.challengeLink(runStore.runChallenge(meta, {})))[1],
    }).challenge.budget,
    false,
  );
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
    placeLabel: 'Round of 32',
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

test('the Daily is locked from the first pick: the draft is kept and can only be resumed', () => {
  const day = '2026-11-08',
    noon = new Date(day + 'T12:00:00Z'),
    partial = createDraftSession(catalog, { mode: 'nations', seed: 'daily:' + day });
  partial.spin();
  partial.pick(partial.suggestPick().profileId);
  const kept = {
    format: saved.DRAFT_FORMAT,
    context: { kind: 'daily', type: 'nations', daily: day },
    session: JSON.parse(JSON.stringify(partial.serialize())),
    savedAt: '2026-11-08T10:00:00.000Z',
  };
  // Nothing kept: a fresh day.
  assert.equal(runStore.lockedDailyDraft(runStore.readDaily(), day), null);
  assert.equal(saved.readDailyStatus(noon).inProgress, false);
  // Not a Daily draft, or a broken one: ignored.
  assert.equal(runStore.lockDailyDraft({ context: { kind: 'run' }, session: kept.session }), null);
  assert.equal(runStore.lockDailyDraft({ context: kept.context, session: { nope: 1 } }), null);
  assert.equal(runStore.lockDailyDraft(null), null);
  assert.equal(runStore.readDaily().draft, null);
  // Kept with the record: the day is under way, the streak is not touched yet.
  store.set(saved.DAILY_KEY, JSON.stringify({ streak: 3, best: 5, lastPlayed: '2026-11-07' }));
  assert.equal(runStore.lockDailyDraft(kept).id, day);
  let state = runStore.readDaily();
  assert.deepEqual(runStore.lockedDailyDraft(state, day).session, kept.session);
  assert.equal(state.lastPlayed, '2026-11-07');
  assert.equal(state.streak, 3);
  const status = saved.readDailyStatus(noon);
  assert.equal(status.inProgress, true);
  assert.equal(status.playedToday, false);
  assert.equal(status.streak, 3);
  // The next day it is over: nothing to resume.
  assert.equal(runStore.lockedDailyDraft(state, '2026-11-09'), null);
  assert.equal(saved.readDailyStatus(new Date('2026-11-09T12:00:00Z')).inProgress, false);
  assert.equal(runStore.dropDailyDraft(state).draft, null);
  assert.equal(runStore.readDaily().draft, null);
  // The XI is complete: the attempt begins, the kept draft goes, the streak counts.
  runStore.lockDailyDraft(kept);
  const { run } = runStore.createRunFromDraft(catalog, { session: draft, context: {} });
  state = runStore.beginDailyAttempt(runStore.readDaily(), {
    id: day,
    number: 8,
    run,
    rating: 82,
    perfect: 97,
    formation: '433',
  });
  assert.equal(state.draft, null);
  assert.equal(runStore.readDaily().draft, null);
  assert.equal(state.streak, 4);
  assert.equal(saved.readDailyStatus(noon).inProgress, true, 'being simulated');
  // From here on the day cannot be locked again (a stale draft store would try).
  assert.equal(runStore.lockDailyDraft(kept), null);
  state = runStore.finishDailyAttempt(state, {
    id: day,
    record: { w: 1, d: 0, l: 2, gf: 2, ga: 4 },
    points: 300,
  });
  assert.equal(runStore.lockDailyDraft(kept), null);
  const done = saved.readDailyStatus(noon);
  assert.equal(done.inProgress, false);
  assert.equal(done.playedToday, true);
  // Broken data in the record reads as nothing kept.
  for (const draftValue of [5, 'x', {}, { id: day }, { id: 7, session: kept.session }]) {
    store.set(saved.DAILY_KEY, JSON.stringify({ draft: draftValue }));
    assert.equal(runStore.readDaily().draft, null);
    assert.equal(saved.readDailyStatus(noon).playedToday, false);
  }
  // Home's "Draft in progress" card: a Daily draft of another day is over.
  store.set(saved.DRAFT_KEY, JSON.stringify(kept));
  assert.equal(saved.readSavedDraft(noon).picks, 1);
  assert.equal(saved.readSavedDraft(new Date('2026-11-09T00:00:01Z')), null);
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

test('what is set up before a run match is kept for the next ones', async () => {
  const prematch = await import('../app/ui/lib/prematch-store.js');
  const { run, meta } = runStore.createRunFromDraft(catalog, { session: draft, context: {} });
  const m = run.nextMatch(),
    id = runStore.fixtureId(meta, m.round);
  assert.equal(m.formationLocked, true);
  // The hub opens the pre-match from the run's line-up, the formation locked in the group.
  const open = fixture =>
    prematch.openPrematch(
      {
        id: runStore.fixtureId(meta, fixture.round),
        seed: fixture.seed,
        sides: [
          {
            ...runStore.matchSideFor(fixture.home, { kind: 'user', editable: true }),
            formationLocked: fixture.formationLocked,
          },
          runStore.matchSideFor(fixture.away),
        ],
        competition: { mode: 'ai', difficulty: 'pro', knockout: fixture.knockout },
        meta: { context: 'run', returnTo: '/run' },
      },
      { go: false },
    );
  open(m);
  assert.equal(prematch.prematchStore.get().sides[0].formationLocked, true);
  assert.equal(prematch.changeFormation(0, '442'), false, 'locked in the group stage');
  // Swap two outfield players and push.
  const rows = prematch.prematchStore.get().sides[0].players.map(p => p.role),
    [a, b] = rows.map((r, i) => i).filter(i => rows[i] !== 'GK');
  assert.equal(prematch.swapPlayers(0, a, b), true);
  prematch.setSideTactic(0, 'mentality', 'push');
  const edited = prematch.prematchStore.get();
  // Not this fixture's pre-match or request: nothing to keep.
  assert.equal(runStore.fixtureLineup('run:other:0', { prematch: edited }), null);
  assert.equal(runStore.fixtureLineup(id, {}), null);
  assert.equal(runStore.applyLineup(run, null), false);
  // The pre-match as it was left (also without a kick-off).
  const lineup = runStore.fixtureLineup(id, { prematch: edited });
  assert.equal(lineup.tactics.mentality, 'push');
  assert.equal(runStore.applyLineup(run, lineup), true);
  assert.equal(runStore.applyLineup(run, lineup), false, 'nothing new the second time');
  const order = edited.sides[0].players.map(p => p.profileId);
  assert.deepEqual(run.user.players, order);
  assert.notDeepEqual(
    order,
    m.home.players.map(p => p.profileId),
  );
  // The kick-off config says the same when the pre-match is gone.
  const request = prematch.kickOff({ go: false }),
    fromRequest = runStore.fixtureLineup(id, { request });
  assert.equal(fromRequest.formation, m.home.formation);
  assert.deepEqual(
    fromRequest.players.map(p => p.profileId),
    order,
  );
  assert.equal(fromRequest.tactics.mentality, 'push');
  assert.equal(runStore.applyLineup(run, fromRequest), false);
  // The next match — watched or simulated — starts from it; it survives a reload.
  run.recordResult({ goalsFor: 1, goalsAgainst: 0 });
  runStore.saveRun(run, meta);
  const again = runStore.loadRun(catalog).run,
    next = again.nextMatch();
  assert.deepEqual(
    next.home.players.map(p => p.profileId),
    order,
  );
  assert.equal(next.home.tactics.mentality, 'push');
  const side = runStore.matchSideFor(next.home, { kind: 'user' });
  assert.equal(side.tactics.mentality, 'push');
  open(next);
  const reopened = prematch.prematchStore.get().sides[0];
  assert.deepEqual(
    reopened.players.map(p => p.profileId),
    order,
  );
  assert.equal(reopened.tactics.mentality, 'push');
  assert.equal(reopened.formationLocked, true);
  // The auto-sim's config (what "Simulate this match" plays) carries the mentality.
  // …exactly the config the pre-match would kick off.
  const config = runStore.fixtureConfig(next, 'pro');
  assert.equal(config.teams[0].tactics.mentality, 'push');
  assert.deepEqual(
    config.players.slice(0, 11).map(p => p.profileId),
    order,
  );
  // (The pre-match does not carry the opponent's team id, which the engine never reads.)
  const sameMatch = c => ({ ...c, teams: c.teams.map(({ id: _, ...team }) => team) });
  assert.deepEqual(sameMatch(config), sameMatch(prematch.kickOff({ go: false }).config));
  // After the group stage the formation is free, and a new one is kept too.
  again.recordResult({ goalsFor: 1, goalsAgainst: 0 });
  again.recordResult({ goalsFor: 1, goalsAgainst: 0 });
  const r32 = again.nextMatch();
  assert.equal(r32.formationLocked, false);
  open(r32);
  const target = r32.home.formation === '442' ? '433' : '442';
  assert.equal(prematch.changeFormation(0, target), true);
  assert.equal(
    runStore.applyLineup(
      again,
      runStore.fixtureLineup(runStore.fixtureId(meta, 3), {
        prematch: prematch.prematchStore.get(),
      }),
    ),
    true,
  );
  assert.equal(again.user.formation, target);
  assert.equal(again.nextMatch().home.formation, target);
  assert.equal(again.user.tactics.mentality, 'push');
  prematch.clearPrematch();
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
  const expected = {
    goalsFor: 1,
    goalsAgainst: 1,
    extraTime: false,
    outcome: 'D',
    shootout: { winner: 'opponent', score: [4, 5] },
    players: [{ profileId: 'a', rating: 7.1, goals: 1, assists: 0 }],
  };
  assert.deepEqual(runSide(result), expected);
  // One rule: the auto-sim's conversion is the match screen's (lib/match-store.js).
  assert.deepEqual(runSide(result), runResultFor(result, 0));
  // A level match with a winner and no shootout (abandoned: a side fell below seven): the
  // winner is carried, from either side's point of view, so a knockout can be recorded.
  const abandoned = { score: [1, 1], shootout: null, winner: 0, players: result.players };
  for (const convert of [runSide, r => runResultFor(r, 0)])
    assert.deepEqual(convert(abandoned).shootout, { winner: 'user', score: null });
  assert.deepEqual(runResultFor(abandoned, 1).shootout, { winner: 'opponent', score: null });
  assert.deepEqual(runResultFor({ ...abandoned, winner: 1 }, 0).shootout, {
    winner: 'opponent',
    score: null,
  });
  // A draw without a winner, and a decided match, carry none.
  assert.equal(runSide({ ...abandoned, winner: null }).shootout, null);
  assert.equal(runSide({ ...abandoned, score: [2, 1] }).shootout, null);
  const { run } = runStore.createRunFromDraft(catalog, { session: draft, context: {} });
  for (let i = 0; i < 3; i++) run.recordResult({ goalsFor: 2, goalsAgainst: 0 });
  assert.equal(run.nextMatch().knockout, true);
  assert.doesNotThrow(() => run.recordResult(runResultFor(abandoned, 0)));
  assert.equal(run.complete, false, 'through on the carried winner');
});

test('the pre-match is forgotten once its match has a result', async () => {
  const prematch = await import('../app/ui/lib/prematch-store.js');
  const matches = await import('../app/ui/lib/match-store.js');
  const { run, meta } = runStore.createRunFromDraft(catalog, { session: draft, context: {} });
  const m = run.nextMatch(),
    id = runStore.fixtureId(meta, m.round);
  const open = (fixtureId = id) =>
    prematch.openPrematch(
      {
        id: fixtureId,
        seed: m.seed,
        sides: [runStore.matchSideFor(m.home, { kind: 'user' }), runStore.matchSideFor(m.away)],
        meta: { context: 'run', returnTo: '/run' },
      },
      { go: false },
    );
  open();
  assert.ok(store.has(prematch.PREMATCH_KEY));
  const request = prematch.kickOff({ go: false });
  matches.markMatchLive();
  assert.ok(store.has(prematch.PREMATCH_KEY), 'kept while the match is played');
  // Another match's result does not touch it.
  assert.equal(matches.saveMatchResult({ id: 'other', score: [0, 0], players: [] }), false);
  assert.ok(prematch.prematchStore.get());
  matches.saveMatchResult({ id: request.id, score: [1, 0], shootout: null, players: [] });
  assert.equal(prematch.prematchStore.get(), null);
  assert.equal(store.has(prematch.PREMATCH_KEY), false, 'the key is gone from storage');
  // The run still learns the line-up of that match: from the request's kick-off config.
  assert.ok(runStore.fixtureLineup(id, { prematch: null, request }));
  // A new pre-match (the next fixture) is not affected by the finished match in the store.
  open('run:next:1');
  assert.ok(prematch.prematchStore.get());
  matches.clearMatch();
  assert.ok(prematch.prematchStore.get());
  prematch.clearPrematch();
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
