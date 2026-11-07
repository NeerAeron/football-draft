// Pure helpers of the draft UI: pool filtering, fit tags, slot highlights, reel items, odds,
// projections (app/ui/screens/draft/draft-model.js) and the setup defaults/context
// (app/ui/screens/setup/setup-model.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeCatalog } from '../scripts/data/catalog-file.mjs';
import { createDraftSession } from '../app/core/draft/session.js';
import {
  filterPool,
  poolCounts,
  poolFilters,
  rowFit,
  rowStats,
  slotHighlights,
  linkLines,
  reelItems,
  oddsSummary,
  spinHeadline,
  estimateRating,
  draftProjection,
  pickPreview,
  POOR_FIT_DROP,
} from '../app/ui/screens/draft/draft-model.js';
import {
  setupDefaults,
  setupContext,
  difficultyLevels,
  spinsNations,
} from '../app/ui/screens/setup/setup-model.js';

const catalog = await loadRuntimeCatalog();
/** A leagues draft whose first spin landed on a big league (a long pool). */
const leagueDraft = () => {
  for (let seed = 1; ; seed++) {
    const d = createDraftSession(catalog, { mode: 'leagues', seed });
    d.spin();
    if (d.snapshot().pool.length > 300) return d;
  }
};

test('filterPool keeps the session order for Best fit, sorts Overall and filters lines', () => {
  const d = leagueDraft();
  const pool = d.snapshot().pool;
  assert.ok(pool.length > 100, 'a league pool is long');
  assert.equal(filterPool(pool), pool);
  const ovr = filterPool(pool, { filter: 'ovr' });
  for (let i = 1; i < ovr.length; i++)
    if (ovr[i].available === ovr[i - 1].available) assert.ok(ovr[i - 1].ovr >= ovr[i].ovr);
  const gk = filterPool(pool, { filter: 'GK' });
  assert.ok(gk.length > 0 && gk.every(e => e.position === 'GK'));
  const name = pool[3].name;
  const found = filterPool(pool, { query: name.toUpperCase() });
  assert.ok(found.some(e => e.name === name));
  assert.equal(poolCounts(pool).total, pool.length);
});

test('hidden ratings: no rating sort is offered and the order does not follow OVR', () => {
  const d = leagueDraft();
  const pool = d.snapshot().pool;
  assert.ok(!poolFilters(true).some(f => f.value === 'ovr'));
  const list = filterPool(pool, { hideRatings: true });
  assert.equal(list.length, pool.length);
  const lines = list.map(e => (e.position === 'GK' ? 0 : 1));
  assert.deepEqual(
    lines.slice(0, lines.indexOf(1)),
    lines.slice(0, lines.indexOf(1)).map(() => 0),
    'keepers come first (by line, then name)',
  );
});

test('rowFit and slotHighlights show natural fit, small drops, poor fits and closed slots', () => {
  const d = leagueDraft();
  const entry = d.snapshot().pool.find(e => e.available && e.position !== 'GK');
  const fit = rowFit(entry);
  assert.ok(['ok', 'penalty'].includes(fit.state));
  assert.deepEqual(rowFit({ ...entry, available: false, reason: 'Already drafted' }), {
    state: 'blocked',
    label: 'Taken',
  });
  const options = d.placementOptions(entry.profileId);
  const auto = d.autoSlot(entry.profileId);
  const hl = slotHighlights(options, auto);
  assert.equal(Object.keys(hl).length, 11);
  assert.equal(hl[0].state, 'blocked', 'an outfielder cannot play in goal');
  assert.ok(['best', 'penalty', 'neutral'].includes(hl[auto.slot].state));
  for (const o of options.filter(o => o.allowed && o.natural - o.rating > POOR_FIT_DROP))
    assert.equal(hl[o.slot].state, 'neutral');
  const hidden = slotHighlights(options, auto, { hideRatings: true });
  for (const h of Object.values(hidden))
    if (h.state === 'neutral') assert.equal(h.label, 'Poor', 'no rating leaks when hidden');
});

test('rowStats leads with the stats of the player line', () => {
  const stats = ['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY'].map((key, i) => ({ key, value: i }));
  assert.deepEqual(
    rowStats(stats, 'CB').map(s => s.key),
    ['DEF', 'PHY', 'PAC', 'SHO', 'PAS', 'DRI'],
  );
  assert.deepEqual(
    rowStats(stats, 'ST')
      .slice(0, 3)
      .map(s => s.key),
    ['SHO', 'PAC', 'DRI'],
  );
});

test('reelItems only list drawable options and point at the landing', () => {
  for (const mode of ['nations', 'leagues', 'clubs']) {
    const d = createDraftSession(catalog, { mode, seed: 5 });
    const spin = d.spin();
    spin.reels.forEach((reel, i) => {
      const { items, landIndex } = reelItems(reel, { league: i === 1 ? spin.league : null });
      assert.equal(items.length, reel.options.filter(o => o.weight > 0).length);
      assert.equal(items[landIndex].id, reel.options[reel.landing].id);
    });
    const head = spinHeadline(spin, 23);
    assert.equal(head.title, spin.option.name);
  }
});

test('oddsSummary reports uniform nation odds and tiered league odds honestly', () => {
  const nations = createDraftSession(catalog, { mode: 'nations', seed: 2 });
  const [n] = oddsSummary(nations.spin());
  assert.equal(n.uniform, true);
  assert.equal(n.eligible, 48);
  const clubs = createDraftSession(catalog, { mode: 'clubs', seed: 2 });
  const [league, club] = oddsSummary(clubs.spin());
  assert.equal(league.uniform, false);
  assert.deepEqual(
    league.groups.map(g => g.label),
    [...league.groups.map(g => g.label)].sort(),
    'tiers in order',
  );
  assert.ok(club.groups.length >= 1);
  const total = league.groups.reduce((s, g) => s + g.count * g.each, 0);
  assert.ok(Math.abs(total - 1) < 0.02, 'group odds add up to 1');
});

test('projection: typical before picks, run stage, quick and versus win chances', () => {
  const d = createDraftSession(catalog, { mode: 'nations', seed: 9 });
  const empty = d.snapshot().teams[0];
  assert.equal(
    draftProjection({ kind: 'run', mode: 'nations', difficulty: 'pro', teams: [empty] }),
    null,
  );
  for (let i = 0; i < 4; i++) {
    d.spin();
    const s = d.suggestPick();
    d.pick(s.profileId, s.slot);
  }
  const team = d.snapshot().teams[0];
  const est = estimateRating(team, 'nations');
  assert.ok(est > 70 && est < 95);
  const run = draftProjection({ kind: 'run', mode: 'nations', difficulty: 'pro', teams: [team] });
  assert.equal(run.kind, 'run');
  assert.ok(['group', 'r16', 'qf', 'sf', 'final', 'champion'].includes(run.stage));
  const quick = draftProjection({
    kind: 'quick',
    mode: 'nations',
    difficulty: 'amateur',
    teams: [team],
  });
  assert.match(quick.value, /^\d+%$/);
  const versus = draftProjection({ kind: 'versus', mode: 'nations', teams: [team, team], side: 0 });
  assert.match(versus.value, /^\d+%$/);
  assert.deepEqual(linkLines([{ a: 1, b: 2, kind: 'club' }]), [{ from: 1, to: 2, strength: 3 }]);
});

test('pickPreview matches the team rating after the pick', () => {
  const d = createDraftSession(catalog, { mode: 'nations', seed: 4 });
  d.spin();
  const entry = d.snapshot().pool.find(e => e.available);
  const auto = d.autoSlot(entry.profileId);
  const preview = pickPreview(d, 0, entry.profileId, auto.slot);
  d.pick(entry.profileId, auto.slot);
  const team = d.snapshot().teams[0];
  assert.equal(preview.rating, team.rating);
  assert.equal(preview.links, team.links.score);
  assert.equal(pickPreview(d, 0, entry.profileId, auto.slot), null, 'a filled slot has no preview');
});

test('setup defaults: query beats saved choices beats prefs; challenge seeds use default rules', () => {
  const plain = setupDefaults('run', { prefs: { draftType: 'clubs', hideRatings: true } });
  assert.equal(plain.type, 'clubs');
  assert.equal(plain.hideRatings, true);
  assert.equal(plain.difficulty, 'pro');
  assert.equal(plain.seed, null);
  const saved = setupDefaults('quick', { saved: { difficulty: 'legendary', formation: '442' } });
  assert.equal(saved.difficulty, 'legendary');
  assert.equal(saved.formation, '442');
  const q = setupDefaults('quick', {
    query: {
      type: 'club-country',
      difficulty: 'amateur',
      formation: '4231',
      seed: '77',
      hide: '1',
      unique: '1',
    },
    saved: { difficulty: 'legendary' },
  });
  assert.deepEqual(
    [q.type, q.difficulty, q.formation, q.seed, q.hideRatings, q.uniqueNations],
    ['club-country', 'amateur', '4231', 77, true, true],
  );
  const ctx = setupContext('quick', q);
  assert.equal(ctx.useDefaultRules, true);
  assert.equal(ctx.seed, 77);
  assert.equal(ctx.options.uniqueNations, true);
  assert.equal(setupContext('quick', { ...q, type: 'leagues' }).options.uniqueNations, false);
  assert.equal(setupContext('run', plain).returnTo, '/run');
  assert.ok(spinsNations('club-country') && !spinsNations('clubs'));
  const v = setupDefaults('versus', { saved: { kits: ['sky', 'sky'] } });
  assert.notEqual(v.kits[0], v.kits[1], 'two different kits');
});

test('difficulty levels explain opponents and re-rolls', () => {
  const levels = difficultyLevels('nations');
  assert.deepEqual(
    levels.map(l => l.id),
    ['amateur', 'semipro', 'pro', 'worldclass', 'legendary'],
  );
  for (let i = 1; i < levels.length; i++) assert.ok(levels[i].target > levels[i - 1].target);
  assert.equal(levels[4].rerolls, 0);
  assert.ok(levels[0].rerolls >= levels[2].rerolls);
});
