// Draft and pre-match hand-off stores of the new UI (app/ui/lib/draft-store.js,
// app/ui/lib/prematch-store.js): contexts, persistence, auto-pick, completion by kind and
// the kick-off request.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeCatalog } from '../scripts/data/catalog-file.mjs';

// A Map-backed localStorage and a location stub, before the stores load.
const storage = new Map();
globalThis.localStorage = {
  getItem: k => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
  key: i => [...storage.keys()][i] ?? null,
  get length() {
    return storage.size;
  },
};
globalThis.location = { hash: '#/' };

const catalog = await loadRuntimeCatalog();
const draft = await import('../app/ui/lib/draft-store.js');
const prematch = await import('../app/ui/lib/prematch-store.js');
const { readMatchResult, currentRequest } = await import('../app/ui/lib/match-store.js');
draft.setCatalogLoader(async () => catalog);

const reset = () => {
  draft.clearDraft();
  prematch.clearPrematch();
  storage.clear();
  globalThis.location.hash = '#/';
};

test('normalizeContext maps UI types, fills defaults and parses seeds', () => {
  const ctx = draft.normalizeContext({ kind: 'run', type: 'club-country', seed: '42' });
  assert.equal(ctx.mode, 'clubAndCountry');
  assert.equal(ctx.type, 'club-country');
  assert.equal(ctx.seed, 42);
  assert.equal(ctx.difficulty, 'pro');
  assert.equal(ctx.formation, '433');
  assert.deepEqual(ctx.options, { hideRatings: false, uniqueNations: false });
  assert.equal(draft.normalizeContext({ type: 'clubAndCountry' }).mode, 'clubAndCountry');
  assert.equal(draft.normalizeContext({ type: 'nope' }).mode, 'nations');
  assert.equal(draft.parseSeed('abc'), draft.parseSeed('abc'));
  assert.equal(typeof draft.normalizeContext({}).seed, 'number');
  const versus = draft.normalizeContext({ kind: 'versus', names: [' Ann ', ''] });
  assert.deepEqual(versus.names, ['Ann', 'Player 2']);
  const options = draft.sessionOptions(versus);
  assert.equal(options.sides, 2);
  assert.equal(options.teams[1].name, 'Player 2');
  assert.equal(draft.normalizeContext({ kind: 'daily' }).useDefaultRules, true);
});

test('startDraft spins at once, persists, and restores identically after a reload', async () => {
  reset();
  const session = await draft.startDraft({ kind: 'run', type: 'nations', seed: 7 });
  assert.equal(globalThis.location.hash, '#/draft');
  assert.equal(session.phase, 'pick', 'the first spin is made by startDraft');
  const state = draft.draftStore.get();
  assert.equal(state.status, 'ready');
  assert.ok(state.animate, 'the board animates the first spin');
  const first = state.snap.pool[0].profileId;
  assert.ok(draft.pickPlayer(first).ok);
  assert.equal(draft.draftStore.get().lastPick.profileId, first);
  assert.ok(draft.spinDraft());
  const saved = draft.readSavedDraft();
  assert.equal(saved.picks, 1);
  assert.equal(saved.complete, false);
  const spinBefore = draft.draftStore.get().snap.spin.option.id;
  // Simulate a reload: forget memory, restore from storage.
  const raw = storage.get(draft.DRAFT_KEY);
  draft.clearDraft();
  storage.set(draft.DRAFT_KEY, raw);
  const restored = await draft.loadDraft();
  assert.ok(restored);
  assert.equal(draft.draftStore.get().snap.spin.option.id, spinBefore);
  assert.equal(draft.draftStore.get().animate, null, 'a restored spin is shown landed');
});

test('autoPick spins and picks in one press; auto-complete finishes run drafts to returnTo', async () => {
  reset();
  await draft.startDraft({ kind: 'run', type: 'leagues', seed: 3 }, { spin: false });
  assert.equal(draft.draftStore.get().snap.phase, 'spin');
  assert.ok(draft.autoPick().ok);
  assert.equal(draft.draftStore.get().snap.pickIndex, 1);
  assert.ok(draft.autoComplete());
  const done = draft.completedDraft();
  assert.ok(done);
  assert.equal(done.context.kind, 'run');
  const next = await draft.finishDraft();
  assert.equal(next.route, '/run');
  assert.equal(globalThis.location.hash, '#/run');
  assert.ok(draft.completedDraft(), 'RUN-UI reads the XI before clearing it');
});

test('quick drafts reveal a ladder opponent and open the pre-match; kick-off requests the match', async () => {
  reset();
  await draft.startDraft({ kind: 'quick', type: 'nations', difficulty: 'amateur', seed: 11 });
  draft.autoComplete();
  const opponent = draft.quickOpponent();
  assert.ok(opponent.name);
  const mine = new Set(draft.completedDraft().session.picks[0]);
  assert.ok(
    opponent.players.every(p => !mine.has(p.profileId)),
    'opponent excludes my XI',
  );
  const next = await draft.finishDraft();
  assert.equal(next.route, '/prematch');
  assert.equal(globalThis.location.hash, '#/prematch');
  assert.equal(draft.completedDraft(), null, 'the draft is handed over and cleared');
  const data = prematch.prematchStore.get();
  assert.equal(data.sides[0].kind, 'user');
  assert.equal(data.sides[1].kind, 'ai');
  assert.equal(data.sides[1].editable, false);
  assert.match(data.id, /^quick:/);
  assert.ok(storage.has(prematch.PREMATCH_KEY));

  // Edits: swap two outfield players, change formation, tactics, view.
  const before = data.sides[0].players.map(p => p.profileId);
  assert.ok(prematch.swapPlayers(0, 1, 2));
  const after = prematch.prematchStore.get().sides[0].players.map(p => p.profileId);
  assert.equal(after[1], before[2]);
  assert.equal(after[2], before[1]);
  assert.equal(prematch.swapPlayers(0, 0, 5), false, 'the GK slot takes keepers only');
  assert.ok(prematch.changeFormation(0, '442'));
  const side = prematch.prematchStore.get().sides[0];
  assert.equal(side.formation, '442');
  assert.equal(new Set(side.players.map(p => p.profileId)).size, 11);
  assert.equal(side.players[0].primaryPosition, 'GK');
  assert.ok(prematch.setSideTactic(0, 'mentality', 'push'));
  assert.ok(prematch.setMatchView('instant'));

  const request = prematch.kickOff();
  assert.equal(globalThis.location.hash, '#/match');
  assert.equal(request.id, data.id);
  assert.equal(request.view, 'instant');
  assert.deepEqual(request.meta.userSides, [0]);
  assert.equal(request.meta.context, 'quick');
  assert.equal(request.config.teams[0].tactics.mentality, 'push');
  assert.equal(request.config.teams[0].tactics.formation, '442');
  assert.equal(request.config.competition.mode, 'ai');
  assert.equal(request.config.competition.difficulty, 'veryeasy');
  assert.equal(currentRequest().id, data.id);
  assert.equal(readMatchResult(data.id), null);
});

test('versus drafts alternate turns and open the pre-match with both XIs editable', async () => {
  reset();
  await draft.startDraft({ kind: 'versus', type: 'clubs', seed: 5, names: ['Ann', 'Bo'] });
  const snap = draft.draftStore.get().snap;
  assert.equal(snap.phase, 'spin', 'versus waits for the coin-toss interstitial');
  const first = snap.turn;
  draft.autoPick();
  assert.equal(draft.draftStore.get().snap.turn, 1 - first);
  draft.autoComplete();
  await draft.finishDraft();
  const data = prematch.prematchStore.get();
  assert.deepEqual(
    data.sides.map(s => [s.name, s.kind, s.editable]),
    [
      ['Ann', 'user', true],
      ['Bo', 'p2', true],
    ],
  );
  assert.equal(prematch.engineCompetition(data).mode, 'pvp');
  assert.deepEqual(prematch.kickOff({ go: false }).meta.userSides, [0, 1]);
});

test('openPrematch keeps the fixture id and meta intact (RUN-UI contract)', async () => {
  reset();
  await draft.startDraft({ kind: 'run', seed: 9 }, { go: false });
  draft.autoComplete();
  const side = draft.completedDraft().session.matchSide(0);
  const data = prematch.openPrematch(
    {
      seed: 99,
      sides: [
        { ...side, colors: [side.color, side.secondary], kind: 'user' },
        { ...side, name: 'Mirror', kind: 'ai', editable: false },
      ],
      competition: { difficulty: 'pro', knockout: true },
      meta: { context: 'run', title: 'Quarter-final', returnTo: '#/run', fixture: 'run:x:qf' },
    },
    { go: false },
  );
  assert.equal(data.id, 'run:x:qf');
  assert.equal(data.meta.fixture, 'run:x:qf');
  const request = prematch.kickOff({ go: false });
  assert.equal(request.id, 'run:x:qf');
  assert.equal(request.meta.title, 'Quarter-final');
  assert.equal(request.meta.returnTo, '#/run');
  assert.equal(request.config.competition.knockout, true);
  assert.throws(() => prematch.normalizePrematch({ sides: [side] }));
});

test('reslot keeps eleven players, the keeper in goal and maximises slot ratings', () => {
  const xi = catalog.players.filter(p => p.source.clubId === catalog.teams[0].id).slice(0, 11);
  const ordered = prematch.reslot(xi, '433');
  assert.equal(ordered.length, 11);
  assert.equal(new Set(ordered.map(p => p.profileId)).size, 11);
  const fits = prematch.slotFits(ordered, '433');
  assert.equal(fits.length, 11);
  const strength = prematch.lineupStrength(ordered, '433');
  assert.ok(strength.rating > 60 && strength.rating < 99);
  assert.ok(strength.effective >= strength.rating);
});
