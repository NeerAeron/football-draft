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
const { readLegends } = await import('../scripts/data/catalog-file.mjs');
const { attachLegends } = await import('../app/core/players/legends.js');
const draft = await import('../app/ui/lib/draft-store.js');
const prematch = await import('../app/ui/lib/prematch-store.js');
const { readMatchResult, currentRequest } = await import('../app/ui/lib/match-store.js');
// World Cup drafts ask for the legends data; nothing else does.
const loads = [];
draft.setCatalogLoader(async ({ legends = false } = {}) => {
  loads.push(legends);
  return legends ? attachLegends(catalog, readLegends()) : catalog;
});

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

test('a World Cup draft: Legend spin first, Prime boosts, legends data only for it', async () => {
  reset();
  loads.length = 0;
  for (const kind of ['quick', 'versus', 'daily']) {
    const ctx = draft.normalizeContext({ kind, type: 'nations', seed: 1 });
    assert.equal(draft.worldCupDraft(ctx), false);
    const options = draft.sessionOptions(ctx);
    assert.ok(!('legendSpin' in options) && !('primes' in options), kind);
  }
  await draft.startDraft({ kind: 'quick', type: 'nations', seed: 7 });
  assert.equal(draft.draftStore.get().snap.legendRound, false);
  assert.deepEqual(loads, [false]);
  reset();
  const session = await draft.startDraft({ kind: 'run', type: 'nations', seed: 7 });
  assert.deepEqual(loads, [false, true]);
  let snap = draft.draftStore.get().snap;
  assert.deepEqual([snap.legendSpin, snap.legendRound, snap.spin.legend], [true, true, true]);
  assert.deepEqual(snap.primes, { perSide: 2, left: [2] });
  assert.ok(snap.pool.length <= 10 && snap.pool.every(e => e.legend));
  assert.ok(draft.pickPlayer(snap.pool[0].profileId).ok);
  assert.ok(draft.autoComplete());
  // A reload in the middle restores the legend (the loader is asked for the legends again).
  const raw = storage.get(draft.DRAFT_KEY);
  draft.clearDraft();
  storage.set(draft.DRAFT_KEY, raw);
  assert.ok(await draft.loadDraft());
  assert.equal(loads.at(-1), true);
  snap = draft.draftStore.get().snap;
  assert.equal(snap.teams[0].slots.filter(x => x.player.legend).length, 1);
  // Prime boost through the store: persisted, the XI holds the prime version.
  const option = draft.currentDraft().session.primeOptions(0)[0];
  if (option) {
    const result = draft.primeDrafted(option.slot);
    assert.equal(result.ok, true);
    const after = draft.draftStore.get().snap.teams[0];
    assert.equal(after.primesLeft, 1);
    assert.equal(after.slots[option.slot].player.prime, true);
    assert.match(
      JSON.parse(storage.get(draft.DRAFT_KEY)).session.state.picks[0][option.slot],
      /:prime$/,
    );
  }
  assert.equal(draft.primeDrafted(99).ok, false);
  // The run takes the XI as it is.
  const { createRunFromDraft } = await import('../app/ui/lib/run-store.js');
  const done = draft.completedDraft();
  const { run } = createRunFromDraft(done.session.catalog, done);
  assert.deepEqual(
    run.user.players,
    done.session.lineup(0).map(p => p.profileId),
  );
  assert.ok(session);
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
  await draft.startDraft({ kind: 'quick', type: 'nations', difficulty: 'pro', seed: 11 });
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
  assert.equal(request.config.competition.difficulty, 'medium');
  assert.equal(currentRequest().id, data.id);
  assert.equal(readMatchResult(data.id), null);
});

test('a locked formation (the World Cup opener) cannot change, here or in the match', () => {
  reset();
  const side = (formation, extra = {}) => ({
    name: 'Side',
    formation,
    players: Array.from({ length: 11 }, (_, i) => ({
      profileId: `p${i}`,
      primaryPosition: i ? 'CM' : 'GK',
      attrs: {},
    })),
    ...extra,
  });
  prematch.openPrematch(
    {
      id: 'run:x:0',
      seed: 1,
      sides: [side('433', { kind: 'user', formationLocked: true }), side('442', { kind: 'ai' })],
      meta: { context: 'run' },
    },
    { go: false },
  );
  assert.equal(prematch.prematchStore.get().sides[0].formationLocked, true);
  assert.equal(prematch.changeFormation(0, '442'), false);
  assert.equal(prematch.prematchStore.get().sides[0].formation, '433');
  assert.ok(prematch.setSideTactic(0, 'mentality', 'push'), 'other tactics still change');
  assert.deepEqual(prematch.kickOff({ go: false }).meta.formationLocked, [0]);
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
  assert.deepEqual(
    data.sides.map(s => s.short),
    ['ANN', 'BO'],
  );
});

test('versus codes stay distinct; Ball Knower and nation kits reach the pre-match', async () => {
  assert.deepEqual(draft.draftedShorts(['Player 1', 'Player 2']), ['P1', 'P2']);
  assert.deepEqual(draft.draftedShorts(['Sam', 'Samir']), ['SA1', 'SA2']);
  assert.deepEqual(draft.draftedShorts(['Me'], true), ['YOU']);
  reset();
  await draft.startDraft({
    kind: 'quick',
    type: 'nations',
    difficulty: 'pro',
    seed: 21,
    options: { hideRatings: true },
  });
  draft.autoComplete();
  const opponent = draft.quickOpponent();
  await draft.finishDraft();
  const data = prematch.prematchStore.get();
  assert.equal(data.hideRatings, true);
  if (opponent.code) assert.notDeepEqual(data.sides[1].colors, ['#baaff0', '#16213a']);
  assert.equal(prematch.kickOff({ go: false }).meta.hideRatings, true);
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

test('a formation change fields the best lineup; the picker knows each formation’s team OVR', async () => {
  const { createDraftSession } = await import('../app/core/draft/session.js');
  const { FORMATIONS } = await import('../app/core/players/formations.js');
  const { roleRating, isKeeper } = await import('../app/core/draft/pools.js');
  const rand = (await import('../app/core/util/rng.js')).lcg(7);
  for (const seed of [5, 21]) {
    const s = createDraftSession(catalog, { mode: 'nations', seed });
    while (!s.complete) {
      s.spin();
      const move = s.suggestPick();
      s.pick(move.profileId, move.slot);
    }
    const xi = s.matchSide(0).players;
    const ratings = prematch.formationRatings(xi);
    assert.deepEqual(Object.keys(ratings), Object.keys(FORMATIONS));
    for (const formation of Object.keys(FORMATIONS)) {
      const best = prematch.reslot(xi, formation),
        rows = FORMATIONS[formation],
        gk = rows.findIndex(r => r[2] === 'GK'),
        outfield = rows.map((r, i) => i).filter(i => i !== gk),
        total = list => list.reduce((sum, p, i) => sum + roleRating(p, rows[i][2]), 0);
      // What the picker shows is the team OVR the change then gives.
      assert.equal(ratings[formation], prematch.lineupStrength(best, formation).rating);
      assert.ok(isKeeper(best[gk]));
      assert.deepEqual(
        best.map(p => [p.slot, p.role]),
        rows.map((r, i) => [i, r[2]]),
      );
      // No other lineup beats it: 300 random swaps (two or three players).
      const top = total(best),
        any = () => outfield[Math.floor(rand() * outfield.length)];
      for (let n = 0; n < 300; n++) {
        const other = [...best],
          a = any(),
          b = any(),
          c = any();
        [other[a], other[b]] = [other[b], other[a]];
        if (n % 2) [other[a], other[c]] = [other[c], other[a]];
        assert.ok(total(other) <= top + 1e-9, `${formation}: a better lineup exists`);
      }
    }
  }
});
