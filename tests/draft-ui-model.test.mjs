// Pure helpers of the draft UI: pool filtering, fit tags, slot highlights, reel items, odds,
// projections (app/ui/screens/draft/draft-model.js) and the setup defaults/context
// (app/ui/screens/setup/setup-model.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeCatalog } from '../scripts/data/catalog-file.mjs';
import { createDraftSession, NATURAL_FIT } from '../app/core/draft/session.js';
import {
  filterPool,
  poolCounts,
  poolFilters,
  rowFit,
  rowCost,
  rowBoost,
  mateLines,
  rowStats,
  primeNote,
  primeLine,
  legendYearsLine,
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
  budgetCopy,
  VERSUS_REROLLS,
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
  // A row says only what it does not show already: nothing at his own position and rating,
  // "81 at CM" at another one (amber when he loses rating there).
  const base = { ...entry, position: 'CM', ovr: 84 },
    at = (role, rating, familiarity = 0.99) => ({
      ...base,
      best: { slot: 3, role, rating, familiarity, delta: rating - 84 },
    });
  assert.equal(rowFit(at('CM', 84, 1)), null);
  assert.deepEqual(rowFit(at('DM', 81)), { state: 'penalty', at: 'DM', from: 84, to: 81 });
  assert.deepEqual(rowFit(at('AM', 84)), { state: 'neutral', at: 'AM', from: 84, to: 84 });
  assert.equal(rowFit(at('DM', 81), null, true).state, 'neutral', 'no hint of the numbers');
  assert.equal(rowFit(at('CB', 70, 0.9), null, true).state, 'penalty');
  for (const e of d.snapshot().pool.filter(e => e.available)) {
    const fit = rowFit(e);
    assert.equal(fit === null, e.best.role === e.position && e.best.rating >= e.ovr);
    if (fit) assert.deepEqual([fit.at, fit.to], [e.best.role, e.best.rating]);
  }
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
  // (A slot he is natural in stays 'ok' even when the role's weights cost him more.)
  for (const o of options.filter(
    o => o.allowed && o.familiarity < NATURAL_FIT && o.natural - o.rating > POOR_FIT_DROP,
  ))
    assert.equal(hl[o.slot].state, 'neutral');
  // Every open slot carries his overall there (the number the pitch writes into the slot),
  // closed slots none.
  for (const o of options) {
    const h = hl[o.slot];
    if (o.allowed) assert.deepEqual([h.role, h.rating], [o.role, o.rating]);
    else assert.deepEqual([h.state, h.rating], ['blocked', undefined]);
  }
  assert.ok(
    options.some(o => o.allowed && o.rating !== auto.rating),
    'numbers to compare',
  );
  const hidden = slotHighlights(options, auto, { hideRatings: true });
  for (const h of Object.values(hidden)) {
    if (h.state === 'neutral') assert.equal(h.label, 'Poor', 'no rating leaks when hidden');
    assert.equal(h.rating, undefined, 'no rating leaks when hidden');
  }
});

test('the Prime tag of a row says the bump; the Legend spin says its years in one line', () => {
  const version = { profileId: 'ea:1:fc20:prime', ovr: 94, edition: 20, year: 2019 };
  assert.equal(primeNote(version, 86), 'Prime 94 +8');
  assert.equal(primeNote(version), 'Prime 94');
  assert.equal(primeNote(null, 86), '');
  assert.deepEqual(primeLine(version, 86), { era: '’19', ovr: 94, gain: 8 });
  // The year is the stored one (the snapshot's), not worked out from the edition.
  assert.equal(primeLine({ ...version, year: 2020 }, 86).era, '’20');
  assert.equal(primeLine(null, 86), null);
  assert.equal(legendYearsLine([2014, 2022]), 'Best versions, 2014–2022');
  assert.equal(legendYearsLine([2019, 2019]), 'Best versions, 2019');
  assert.equal(legendYearsLine(null), '');
});

test('pool rows say the boost a player would get in the XI', () => {
  const d = createDraftSession(catalog, { mode: 'nations', seed: 4 });
  d.spin();
  const [first] = d.snapshot().pool.filter(e => e.available && e.position !== 'GK');
  assert.ok(
    d.snapshot().pool.every(e => e.boost === null && rowBoost(e) === null),
    'nobody in the XI yet',
  );
  d.pick(first.profileId);
  // Give the XI a second look at the same nation: every compatriot is a nation mate (+1.5),
  // a club mate of the first pick among them gets both (+2.5).
  const session = createDraftSession(catalog, { mode: 'leagues', seed: 3 });
  const seen = { nation: 0, club: 0, both: 0 };
  while (!session.complete) {
    session.spin();
    const xi = session.lineup(0).filter(Boolean);
    for (const e of session.snapshot().pool) {
      const p = session.player(e.profileId),
        nation = xi.some(q => q.source.nationality === p.source.nationality),
        club = xi.some(q => q.source.clubId === p.source.clubId),
        value = (nation ? 1.5 : 0) + (club ? 1 : 0);
      assert.equal(e.boost?.value ?? 0, value);
      const row = rowBoost(e);
      if (!e.available || !value) assert.equal(row, null);
      else {
        assert.equal(row.label, value === 2.5 ? '+2.5' : value === 1.5 ? '+1.5' : '+1');
        assert.equal(
          row.text,
          nation && club ? 'nation + club mate' : nation ? 'nation mate' : 'club mate',
        );
        seen[nation && club ? 'both' : nation ? 'nation' : 'club']++;
      }
    }
    const move = session.suggestPick();
    session.pick(move.profileId, move.slot);
  }
  assert.ok(seen.nation && seen.club && seen.both, JSON.stringify(seen));
});

test('rows show the three stats that matter for the position', () => {
  const stats = ['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY'].map((key, i) => ({ key, value: i }));
  assert.deepEqual(
    rowStats(stats, 'CB').map(s => s.key),
    ['DEF', 'PHY', 'PAC', 'SHO', 'PAS', 'DRI'],
  );
  assert.deepEqual(
    rowStats(stats, 'ST')
      .slice(0, 3)
      .map(s => s.key),
    ['SHO', 'PAC', 'PHY'],
  );
  const three = position =>
    rowStats(stats, position)
      .slice(0, 3)
      .map(s => s.key)
      .join();
  assert.equal(three('LB'), 'PAC,DEF,PAS', 'full-backs: pace first');
  assert.equal(three('DM'), 'DEF,PAS,PHY');
  assert.equal(three('AM'), 'PAS,DRI,SHO');
  assert.equal(three('RW'), 'PAC,DRI,SHO');
  assert.notEqual(three('CB'), three('ST'));
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
  assert.equal(n.eligible, n.total); // every nation of the reel, each as likely as the next
  assert.ok(n.eligible >= 56);
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
  assert.ok(['group', 'r32', 'r16', 'qf', 'sf', 'final', 'champion'].includes(run.stage));
  const quick = draftProjection({
    kind: 'quick',
    mode: 'nations',
    difficulty: 'worldclass',
    teams: [team],
  });
  assert.match(quick.value, /^\d+%$/);
  const versus = draftProjection({ kind: 'versus', mode: 'nations', teams: [team, team], side: 0 });
  assert.match(versus.value, /^\d+%$/);
  // Nation mates: the gold, thickest line; club mates: volt.
  assert.deepEqual(
    linkLines([
      { a: 1, b: 2, kind: 'nation' },
      { a: 1, b: 3, kind: 'club' },
    ]),
    [
      { from: 1, to: 2, strength: 3 },
      { from: 1, to: 3, strength: 2 },
    ],
  );
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
  assert.equal(preview.boosts, team.links.total);
  assert.equal(preview.budget, null);
  assert.deepEqual(mateLines(preview)[0], { tone: 'none', text: 'No mates in your XI yet' });
  assert.equal(pickPreview(d, 0, entry.profileId, auto.slot), null, 'a filled slot has no preview');
});

test('pickPreview says who the mates are and what everyone gets', () => {
  // A second player of the same nation: "Nation mate of X: both +3".
  const d = createDraftSession(catalog, { mode: 'nations', seed: 4 });
  d.spin();
  const [first, second] = d.snapshot().pool.filter(e => e.available && e.position !== 'GK');
  d.pick(first.profileId);
  d.spin();
  // Put the compatriot in the XI by hand (the next spin is another nation).
  const slot = d.picks[0].findIndex(
    (id, i) => !id && d.placementOptions(second.profileId)[i].role !== 'GK',
  );
  const preview = pickPreview(d, 0, second.profileId, slot);
  const nation = preview.mates.find(m => m.kind === 'nation');
  assert.deepEqual([nation.boost, nation.shared, nation.names.length], [1.5, true, 1]);
  assert.equal(
    preview.boost,
    preview.mates.reduce((sum, m) => sum + m.boost, 0),
  );
  assert.equal(preview.gain, 2 * preview.boost);
  assert.equal(preview.captain, null); // no Captain in this pick
  assert.deepEqual(preview.lifts, []);
  const lines = mateLines(preview);
  assert.match(lines[0].text, /^Nation mate of .+: \+1\.5 each$/);
  // Wording for the other cases.
  const text = p =>
    mateLines(p)
      .map(l => l.text)
      .join(' | ');
  assert.equal(
    text({
      boost: 2.5,
      mates: [
        { kind: 'nation', names: ['Mbappé'], boost: 1.5, shared: true },
        { kind: 'club', names: ['Hakimi', 'Dembélé', 'Vitinha'], boost: 1, shared: false },
      ],
      lifts: [{ name: 'Vitinha', to: 2.5 }],
    }),
    'Nation mate of Mbappé: +1.5 each | Club mate of Hakimi, Dembélé +1: +1 | Both: +2.5 | Also lifts Vitinha to +2.5',
  );
  assert.equal(
    text({
      boost: 1,
      mates: [{ kind: 'club', names: ['Rice', 'Saka'], boost: 1, shared: false }],
      lifts: [],
    }),
    'Club mate of Rice and Saka: +1',
  );
});

test('Budget mode: rows show their tier, closed rows say which tier is full, the preview what it uses', () => {
  let checked = 0,
    d;
  for (const seed of [11, 12, 13, 14, 15, 16]) {
    d = createDraftSession(catalog, { mode: 'nations', seed, budget: true, rerolls: 0 });
    checked += budgetRows(d);
  }
  assert.ok(checked > 0);
  assert.equal(rowCost(d.snapshot().pool[0] || { band: null }, null), null);
});
function budgetRows(d) {
  let checked = 0;
  while (!d.complete) {
    d.spin();
    const snap = d.snapshot(),
      budget = snap.teams[0].budget;
    for (const e of snap.pool) {
      const cost = rowCost(e, budget);
      if (e.band) assert.match(cost.label, /^(Superstar|Star|Starter)$/);
      if (e.band)
        assert.deepEqual(
          [cost.label, cost.tone],
          [budget.find(b => b.id === e.band).label, e.band],
        );
      else assert.deepEqual([cost.label, cost.tone], ['Free', 'free']);
      if (/slot left$/.test(e.reason)) {
        assert.equal(rowFit(e, budget).label, `${cost.label} full`);
        checked++;
      }
    }
    // The most expensive affordable outfield player (keeper when none).
    const open = snap.pool.filter(e => e.available),
      e = open.reduce((a, b) => (b.ovr > a.ovr ? b : a)),
      auto = d.autoSlot(e.profileId),
      preview = pickPreview(d, 0, e.profileId, auto.slot),
      band = budget.find(b => b.id === e.band);
    if (band)
      assert.deepEqual(preview.budget, {
        id: band.id,
        label: band.label,
        slots: band.slots,
        left: band.left - 1,
      });
    else assert.deepEqual(preview.budget, { free: true, label: 'Under 80' });
    d.pick(e.profileId, auto.slot);
  }
  return checked;
}

test('Budget mode travels from the setup to the session and the run, World Cup only', async () => {
  const { normalizeContext, sessionOptions } = await import('../app/ui/lib/draft-store.js');
  // Chosen on Home (its own button → ?budget=1); never remembered.
  const run = setupDefaults('run', { query: { budget: '1' } });
  assert.equal(run.budget, true);
  assert.equal(setupDefaults('run', {}).budget, false);
  assert.equal(setupDefaults('run', { saved: { budget: true } }).budget, false);
  assert.equal(setupDefaults('quick', { query: { budget: '1' } }).budget, false);
  const ctx = setupContext('run', run);
  assert.equal(ctx.options.budget, true);
  assert.ok(!('budget' in setupContext('run', { ...run, budget: false }).options));
  assert.ok(!('budget' in setupContext('quick', { ...run, budget: true }).options));
  const normal = normalizeContext(ctx);
  assert.equal(normal.options.budget, true);
  assert.equal(sessionOptions(normal).budget, true);
  assert.ok(!('budget' in normalizeContext({ ...ctx, kind: 'quick' }).options));
  assert.equal(sessionOptions(normalizeContext({ kind: 'daily' })).budget, false);
  assert.match(
    budgetCopy(),
    /^Harder: your XI may hold only 2 Superstars \(88\+\), 2 Stars \(84–87\) and 3 Starters \(80–83\)\. Everyone else must be under 80\.$/,
  );
});

test('setup defaults: query beats saved choices beats prefs; challenge seeds use default rules', () => {
  const plain = setupDefaults('run', { prefs: { draftType: 'clubs', hideRatings: true } });
  assert.equal(plain.type, 'nations', 'the World Cup is always a Nations draft');
  assert.equal(setupDefaults('quick', { prefs: { draftType: 'clubs' } }).type, 'clubs');
  assert.equal(plain.hideRatings, true);
  assert.equal(plain.difficulty, 'pro');
  assert.equal(plain.seed, null);
  const saved = setupDefaults('quick', { saved: { difficulty: 'legendary', formation: '442' } });
  assert.equal(saved.difficulty, 'legendary');
  assert.equal(saved.formation, '442');
  const q = setupDefaults('quick', {
    query: {
      type: 'nations',
      difficulty: 'worldclass',
      formation: '4231',
      seed: '77',
      hide: '1',
      unique: '1',
    },
    saved: { difficulty: 'legendary' },
  });
  assert.deepEqual(
    [q.type, q.difficulty, q.formation, q.seed, q.hideRatings, q.uniqueNations],
    ['nations', 'worldclass', '4231', 77, true, true],
  );
  const ctx = setupContext('quick', q);
  assert.equal(ctx.useDefaultRules, true);
  assert.equal(ctx.seed, 77);
  assert.equal(ctx.options.uniqueNations, true);
  assert.equal(setupContext('quick', { ...q, type: 'leagues' }).options.uniqueNations, false);
  assert.equal(setupContext('run', plain).returnTo, '/run');
  assert.ok(spinsNations('nations') && !spinsNations('clubs'));
  // The World Cup is a Nations draft whatever is asked; Club & Country is gone everywhere.
  assert.equal(setupDefaults('run', { query: { type: 'clubs' } }).type, 'nations');
  assert.equal(setupDefaults('run', { prefs: { draftType: 'leagues' } }).type, 'nations');
  assert.equal(setupDefaults('quick', { query: { type: 'club-country' } }).type, 'nations');
  assert.equal(setupDefaults('quick', { query: { type: 'clubs' } }).type, 'clubs');
  const v = setupDefaults('versus', { saved: { kits: ['sky', 'sky'] } });
  assert.notEqual(v.kits[0], v.kits[1], 'two different kits');
});

test('difficulty levels explain opponents and re-rolls', () => {
  const levels = difficultyLevels('nations');
  assert.deepEqual(
    levels.map(l => l.id),
    ['pro', 'worldclass', 'legendary'],
  );
  for (let i = 1; i < levels.length; i++) assert.ok(levels[i].target > levels[i - 1].target);
  // Every difficulty gets a re-roll: Pro 2, World Class 1, Legendary 1.
  assert.deepEqual(
    levels.map(l => l.rerolls),
    [2, 1, 1],
  );
  assert.ok(levels.every(l => l.text.length > 20));
  // A removed level in a link or a saved choice falls back to Pro.
  assert.equal(setupDefaults('run', { query: { difficulty: 'amateur' } }).difficulty, 'pro');
  assert.equal(setupDefaults('run', { saved: { difficulty: 'semipro' } }).difficulty, 'pro');
  // Versus picks its re-rolls itself (None / One / Two), whatever the levels give.
  assert.deepEqual(
    VERSUS_REROLLS.map(
      o => setupContext('versus', { ...setupDefaults('versus'), difficulty: o.value }).rerolls,
    ),
    [0, 1, 2],
  );
  assert.equal(setupContext('run', setupDefaults('run')).rerolls, undefined);
});

test('the boost chips on the pitch follow the core rule; the Captain wears the armband', async () => {
  const view = await import('../app/ui/lib/player-view.js');
  const { mateBoosts, playerView } = view;
  const raw = (nationality, clubId, leagueId, captain = false) => ({
    profileId: nationality + clubId,
    name: 'X',
    primaryPosition: 'CM',
    captain,
    source: { nationality, clubId, leagueId },
  });
  const views = [
    raw('A', 1, 1),
    null,
    raw('A', 2, 2),
    raw('B', 2, 2),
    raw('C', 3, 2),
    raw('D', 9, 9),
  ].map(p => p && playerView(p));
  assert.deepEqual(mateBoosts(views), [1.5, 0, 2.5, 1, 0, 0]);
  // A Captain gives every player +1 on top and wears the armband.
  views[5] = playerView(raw('D', 9, 9, true));
  assert.deepEqual(mateBoosts(views), [2.5, 0, 3.5, 2, 1, 1]);
  assert.equal(views[5].captain, true);
  assert.equal(view.captainSlot(views), 5);
  assert.equal(view.captainSlot(views.slice(0, 5)), null);
  // A legend or a prime version carries the year of that version (FIFA 19 → ’18).
  assert.equal(views[0].era, '');
  const legend = playerView({ ...raw('E', 1, 1), legend: true, edition: 19 });
  assert.deepEqual([legend.legend, legend.prime, legend.era], [true, false, '’18']);
  assert.deepEqual(mateBoosts([{ name: 'no source' }, null]), [0, 0]);
  const { boost } = await import('../app/ui/lib/format.js');
  assert.deepEqual(
    [1, 1.5, 2.5, 14, 5.5, null].map(v => boost(v)),
    ['+1', '+1.5', '+2.5', '+14', '+5.5', '–'],
  );
});
