import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLegendCatalog, loadRuntimeCatalog } from '../scripts/data/catalog-file.mjs';
import { createDraftSession, restoreDraftSession } from '../app/core/draft/session.js';
import {
  catalogIndex,
  legendIndex,
  naturalRating,
  roleRating,
  isKeeper,
} from '../app/core/draft/pools.js';
import { bandIndex, bandUse, budgetBands } from '../app/core/draft/budget.js';
import { teamLinks } from '../app/core/draft/links.js';
import { createCupRun, restoreCupRun } from '../app/core/competition/cup.js';
import { primeVersion, baseProfileId } from '../app/core/players/legends.js';
import { FORMATIONS } from '../app/core/players/formations.js';
import { DEFAULT_CONFIG } from '../app/core/config/config.js';
import { Match } from '../app/core/sim/engine.js';
import { matchSetup, applyMatchSetup } from '../app/core/draft/session.js';

const catalog = loadLegendCatalog(),
  index = catalogIndex(catalog),
  legends = legendIndex(catalog),
  bands = budgetBands(DEFAULT_CONFIG.draft.budget);
const shown = p => Math.round(naturalRating(p));
const worldCup = (seed, extra = {}) =>
  createDraftSession(catalog, { seed, legendSpin: true, primes: true, ...extra });
const finish = s => {
  while (!s.complete) {
    if (!s.current) s.spin();
    const move = s.suggestPick();
    assert.equal(s.pick(move.profileId, move.slot).ok, true);
  }
  return s;
};
// Leaves the keeper for last: every outfield slot first.
const keeperLast = s => {
  const pool = s.snapshot().pool.filter(e => e.available),
    out = pool.find(e => e.position !== 'GK');
  return out ? s.pick(out.profileId) : { ok: false };
};

test('the Legend reel: nations with an 85+ legend, slightly weighted by their legends', () => {
  const rules = DEFAULT_CONFIG.draft.legends;
  assert.deepEqual(rules, {
    minimum: 85,
    reelStar: 85,
    shown: 10,
    weightPerLegend: 0.15,
    weightCap: 20,
  });
  // Every nation with a legend is on the reel, and a legend is 85+ as the game shows him: the
  // number on his card, never EA's.
  assert.ok(legends.reel.length >= 25, 'nations on the reel: ' + legends.reel.length);
  assert.equal(legends.reel.length, legends.nations.size);
  assert.equal(
    legends.reel.reduce((sum, n) => sum + n.count, 0),
    catalog.legends.players.filter(p => shown(p) >= rules.minimum).length,
  );
  for (const n of legends.reel) {
    assert.ok(n.players.every(p => shown(p) >= rules.minimum));
    assert.equal(n.best, shown(n.players[0]));
    assert.ok(n.best >= rules.reelStar, n.name);
    assert.equal(n.count, n.players.length);
    assert.equal(n.weight, Math.round((1 + 0.15 * Math.min(n.count, 20)) * 1000) / 1000);
    // Shown order: the rating on the card, then the name.
    for (let i = 1; i < n.players.length; i++)
      assert.ok(
        shown(n.players[i - 1]) > shown(n.players[i]) ||
          (shown(n.players[i - 1]) === shown(n.players[i]) &&
            n.players[i - 1].name.localeCompare(n.players[i].name) <= 0),
      );
  }
  const weights = legends.reel.map(n => n.weight);
  assert.equal(Math.min(...weights), 1.15);
  assert.equal(Math.max(...weights), 4); // capped at twenty legends
  assert.ok(Math.max(...weights) / Math.min(...weights) < 4, 'gentle: under 4× apart');
  // Some nations are on the reel for their one legend.
  assert.ok(legends.reel.filter(n => n.count === 1).length >= 8);
  // A raised minimum is applied to what is shown too, whatever the file holds.
  const strict = legendIndex(catalog, { legends: { ...rules, minimum: 88, reelStar: 88 } });
  assert.ok(strict.reel.length < legends.reel.length);
  for (const n of strict.reel) assert.ok(n.players.every(p => shown(p) >= 88));
  // The years the legends come from (the Legend spin's one line).
  const years = catalog.legends.players.map(p => p.year);
  assert.deepEqual(legends.years, [Math.min(...years), Math.max(...years)]);
  assert.deepEqual(legends.years, [1997, 2025]); // FIFA 98 … FC 26
  assert.deepEqual(worldCup(1).snapshot().legendYears, legends.years);
  assert.equal(createDraftSession(catalog, { seed: 1 }).snapshot().legendYears, null);
  for (const name of ['Brazil', 'Spain', 'Wales', 'Sweden', 'Uruguay'])
    assert.ok(
      legends.reel.some(n => n.name === name),
      name,
    );
  // Without the legends data there is no Legend spin and no Prime boost.
  assert.equal(legendIndex(loadRuntimeCatalog()), null);
  assert.throws(() => createDraftSession(loadRuntimeCatalog(), { seed: 1, legendSpin: true }));
  assert.throws(() => createDraftSession(loadRuntimeCatalog(), { seed: 1, primes: true }));
});

test('the first spin of a World Cup draft is the Legend spin: honest odds, ten legends, one pick', () => {
  const counts = new Map(),
    N = 3000;
  for (let seed = 1; seed <= N; seed++) {
    const s = worldCup(seed);
    assert.equal(s.snapshot().legendRound, true);
    const spin = s.spin(),
      reel = spin.reels[0];
    assert.equal(spin.legend, true);
    assert.equal(spin.category, 'nation');
    assert.equal(reel.options.length, legends.reel.length);
    assert.equal(reel.options[reel.landing].id, spin.option.id);
    const total = reel.options.reduce((sum, o) => sum + o.weight, 0);
    for (const o of reel.options) {
      assert.equal(o.weight, legends.nations.get(o.id).weight);
      assert.equal(o.probability, Math.round((o.weight / total) * 1000) / 1000);
    }
    counts.set(spin.option.id, (counts.get(spin.option.id) || 0) + 1);
    if (seed > 60) continue;
    // The pool: that nation's ten highest-rated legends, all of them available.
    const nation = legends.nations.get(spin.option.id),
      pool = s.snapshot().pool;
    assert.deepEqual(
      pool.map(e => e.profileId).sort(),
      nation.players
        .slice(0, 10)
        .map(p => p.profileId)
        .sort(),
    );
    assert.ok(pool.length >= 1 && pool.length <= 10);
    for (const e of pool) {
      assert.equal(e.legend, true);
      assert.equal(e.available, true);
      assert.ok(e.ovr >= 85, `${e.name} is offered at ${e.ovr}`);
      assert.ok(e.edition >= 98 || (e.edition >= 0 && e.edition <= 26)); // FIFA 98 … FC 26
      assert.equal(e.year, s.player(e.profileId).year); // the year of that version's ratings
      assert.ok(e.year >= legends.years[0] && e.year <= legends.years[1]);
      assert.equal(e.nation, spin.option.id);
      assert.equal(e.captain, false);
    }
    // One legend, then ten ordinary spins.
    const pick = s.pick(s.suggestPick().profileId);
    assert.equal(pick.ok, true);
    assert.equal(s.history[0].legend, true);
    assert.equal(s.snapshot().legendRound, false);
    const next = s.spin();
    assert.equal(next.legend, false);
    assert.equal(next.reels[0].options.length, index.spinField.length);
    assert.ok(s.snapshot().pool.every(e => !e.legend));
    finish(s);
    assert.equal(s.lineup(0).filter(p => p.legend).length, 1);
  }
  // Landing frequencies follow the shown odds (chi-square at p = 0.001; Wilson–Hilferty for
  // the reel's degrees of freedom: 36 -> 68).
  const total = legends.reel.reduce((sum, n) => sum + n.weight, 0),
    chi = legends.reel.reduce((sum, n) => {
      const expected = (N * n.weight) / total;
      return sum + ((counts.get(n.id) || 0) - expected) ** 2 / expected;
    }, 0),
    dof = legends.reel.length - 1,
    limit = dof * (1 - 2 / (9 * dof) + 3.09 * Math.sqrt(2 / (9 * dof))) ** 3;
  assert.ok(chi < limit, `legend reel chi-square ${chi.toFixed(1)} (limit ${limit.toFixed(1)})`);
  // Drafts without the option are what they were: no legend round, same spins.
  const plain = createDraftSession(catalog, { seed: 9 });
  assert.equal(plain.snapshot().legendRound, false);
  assert.equal(plain.snapshot().primes, null);
  assert.deepEqual(plain.spin(), createDraftSession(loadRuntimeCatalog(), { seed: 9 }).spin());
  assert.throws(() =>
    createDraftSession(catalog, { seed: 1, legendSpin: true, schedule: { rounds: [] } }),
  );
});

test('the Legend spin can be re-rolled, respects exclusions and Budget mode, and is never a dead end', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const s = worldCup(seed, { budget: seed % 2 === 0, difficulty: 'pro' });
    const first = s.spin();
    const again = s.reroll();
    assert.equal(again.legend, true);
    assert.notEqual(again.option.id, first.option.id);
    assert.equal(again.reels[0].options.find(o => o.id === first.option.id).weight, 0);
    assert.ok(s.snapshot().pool.some(e => e.available && e.legend));
    assert.equal(s.rerollsLeft[0], 1);
    finish(s);
    // A legend counts on the tier of his rating like anyone.
    if (s.bands) {
      bandUse(bands, s.lineup(0).map(shown)).forEach((n, i) => assert.ok(n <= bands[i].slots));
      const legend = s.lineup(0).find(p => p.legend),
        band = bandIndex(bands, shown(legend));
      if (band >= 0) assert.ok(s.snapshot().teams[0].budget[band].used >= 1);
    }
  }
  // An excluded nation is not on the reel; excluded legends are not offered.
  const brazil = legends.nations.get('Brazil'),
    top = brazil.players.slice(0, 10).map(p => p.profileId),
    rest = brazil.players.slice(10).map(p => p.profileId);
  assert.ok(rest.length >= 5, 'Brazil has more than ten legends');
  const s = worldCup(3, { excludeNations: ['Spain'], excludePlayers: top });
  const spin = s.spin();
  assert.equal(spin.reels[0].options.find(o => o.id === 'Spain').weight, 0);
  let found = false;
  // Force Brazil by walking seeds: its pool is then the legends that are left.
  for (let seed = 1; seed < 400; seed++) {
    const d = worldCup(seed, { excludePlayers: top });
    if (d.spin().option.id !== 'Brazil') continue;
    const pool = d.snapshot().pool.map(e => e.profileId);
    // …the best of them, as many as the reel shows.
    assert.deepEqual([...pool].sort(), rest.slice(0, DEFAULT_CONFIG.draft.legends.shown).sort());
    found = true;
    break;
  }
  assert.ok(found, 'Brazil never came up');
  // Never a dead end with the one-legend nations either: local Versus (the second side cannot
  // take the first side's legend), Budget mode, every re-roll spent, every formation.
  const formations = Object.keys(FORMATIONS);
  let single = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const d = worldCup(seed, {
      sides: 2,
      budget: seed % 2 === 0,
      rerolls: 5,
      formation: formations[seed % formations.length],
    });
    for (let turn = 0; turn < 2; turn++) {
      const side = d.turn;
      let spin = d.spin();
      for (let n = turn ? seed % 6 : 5; ; n--) {
        const open = d.snapshot().pool.filter(e => e.available && e.legend);
        assert.ok(open.length >= 1, `seed ${seed}: ${spin.option.id}`);
        if (legends.nations.get(spin.option.id).count === 1) single++;
        if (n <= 0 || d.rerollBlocked()) break;
        spin = d.reroll();
      }
      const move = d.suggestPick();
      assert.equal(d.pick(move.profileId, move.slot).ok, true);
      assert.equal(d.lineup(side)[move.slot].legend, true);
    }
    // A legend who was picked is gone for the other side: his nation drops off its reel.
    const [a, b] = [0, 1].map(side => d.lineup(side).find(p => p?.legend));
    assert.notEqual(a.profileId, b.profileId);
  }
  assert.ok(single > 50, 'one-legend nations landed: ' + single);
});

test('one player, one place in an XI: a legend version blocks his current version and back', () => {
  const past = catalog.legends.players.filter(p => p.legendOf);
  assert.ok(past.length >= 60);
  // Force a nation whose shown legends include a current player's version, by walking seeds.
  let checked = 0;
  for (let seed = 1; seed <= 400 && checked < 12; seed++) {
    const s = worldCup(seed, { difficulty: 'pro' });
    s.spin();
    const entry = s.snapshot().pool.find(e => e.available && s.player(e.profileId).legendOf);
    if (!entry) continue;
    checked++;
    const legend = s.player(entry.profileId),
      now = catalog.byId.get(legend.legendOf);
    assert.equal(entry.legend, true);
    assert.equal(entry.name, now.name);
    assert.ok(entry.ovr > shown(now));
    // A legend version already is his best: nothing says a boost is available.
    assert.equal(entry.primeVersion, null);
    assert.equal(s.available(now), true);
    assert.equal(s.pick(legend.profileId).ok, true);
    // His current version is gone: from availability, from his nation's pool, from placement.
    assert.equal(s.available(now), false);
    assert.equal(s.available(legend), false);
    for (let turn = 0; turn < 40 && !s.complete; turn++) {
      s.spin();
      const pool = s.snapshot().pool;
      assert.ok(!pool.some(e => baseProfileId(s.player(e.profileId)) === now.profileId));
      assert.ok(s.placementOptions(now.profileId).every(o => o.reason === 'Already drafted'));
      assert.equal(s.pick(now.profileId).ok, false);
      const move = s.suggestPick();
      assert.equal(s.pick(move.profileId, move.slot).ok, true);
    }
    const xi = s.lineup(0);
    assert.equal(new Set(xi.map(baseProfileId)).size, 11);
    // No Prime boost for the legend: his slot offers none, and the options never list him.
    const slot = xi.indexOf(legend);
    assert.equal(s.primeOption(slot, 0), null);
    assert.equal(s.snapshot().teams[0].slots[slot].prime, null);
    assert.ok(s.primeOptions(0).every(o => o.slot !== slot));
    assert.deepEqual(s.prime(slot, 0), { ok: false, reason: 'No prime version' });
    // Restored: still one of him.
    const copy = restoreDraftSession(catalog, JSON.parse(JSON.stringify(s.serialize())));
    assert.equal(copy.available(now), false);
    // Opponents of his run never field his current version either.
    if (checked <= 3) {
      const user = s.matchSide(0),
        run = createCupRun(catalog, { mode: 'nations', difficulty: 'pro', seed, user });
      for (const o of run.opponents)
        assert.ok(!o.players.includes(now.profileId), `${o.name} fields ${now.name}`);
    }
  }
  assert.equal(checked, 12);
  // The other direction: with his current version taken (the other side's pick, an excluded
  // player) his legend version is not offered — and a nation whose only legend he is leaves
  // the reel.
  const only = legends.reel.find(n => n.count === 1 && n.players[0].legendOf),
    many = legends.reel.find(n => n.count > 3 && n.players.slice(0, 10).some(p => p.legendOf)),
    star = many.players.find(p => p.legendOf);
  assert.ok(only && star);
  const blocked = worldCup(7, { excludePlayers: [only.players[0].legendOf, star.legendOf] });
  const spin = blocked.spin();
  assert.equal(spin.reels[0].options.find(o => o.id === only.id).weight, 0);
  assert.ok(spin.reels[0].options.find(o => o.id === many.id).weight > 0);
  for (let seed = 1; seed < 600; seed++) {
    const d = worldCup(seed, { excludePlayers: [star.legendOf] });
    if (d.spin().option.id !== many.id) continue;
    assert.ok(!d.snapshot().pool.some(e => e.profileId === star.profileId));
    assert.equal(d.pick(star.profileId).ok, false);
    break;
  }
  // Local Versus: the first side's legend version takes his current version from the second
  // side's pools too, and a Prime boost can never bring a second one of him.
  for (let seed = 1; seed <= 60; seed++) {
    const d = worldCup(seed, { sides: 2, rerolls: 0 });
    while (!d.complete) {
      d.spin();
      const move = d.suggestPick();
      assert.equal(d.pick(move.profileId, move.slot).ok, true);
    }
    for (const side of [0, 1]) for (const o of d.primeOptions(side)) d.prime(o.slot, side);
    const people = [...d.lineup(0), ...d.lineup(1)].map(baseProfileId);
    assert.equal(new Set(people).size, 22, `seed ${seed}: a player is drafted twice`);
  }
});

test('with only the goalkeeper slot left, a spin lands only where a keeper is available', () => {
  // Every nation of the reel, with re-rolls and in Budget mode. A nation's keepers are the
  // ones of its draft squad.
  const keepers = n => n.squad.filter(isKeeper);
  assert.ok(
    index.spinField.some(n => !keepers(n).length),
    'some reel nations have no keeper',
  );
  let checked = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const budget = seed % 3 === 0,
      s = worldCup(seed, { budget, rerolls: 3, formation: seed % 2 ? '433' : '442' });
    let stuck = false;
    while (s.round() < 10 && !stuck) {
      s.spin();
      stuck = !keeperLast(s).ok; // a Legend spin on a nation whose only legend is a keeper
    }
    if (stuck) continue;
    assert.deepEqual(s.openClasses(), { gk: true, out: false });
    const check = spin => {
      for (const o of spin.reels[0].options) {
        // A keeper the draft may offer (65+), not taken, and affordable in Budget mode.
        const nation = index.nations.get(o.id),
          able = keepers(nation).some(
            p => shown(p) >= s.pickMinimum && s.available(p) && s.affordable(p),
          );
        assert.equal(o.weight > 0, able && !s.seen.slice(0, -1).includes(o.id), o.id);
      }
      assert.ok(s.snapshot().pool.every(e => e.ovr >= 65));
      const pool = s.snapshot().pool;
      assert.ok(
        pool.some(e => e.available && e.position === 'GK'),
        spin.option.id,
      );
      assert.ok(pool.filter(e => e.available).every(e => e.position === 'GK'));
      checked++;
    };
    check(s.spin());
    while (s.rerollsLeft[0] > 0) check(s.reroll());
    assert.equal(s.pick(s.suggestPick().profileId).ok, true);
    assert.ok(s.complete);
    assert.ok(isKeeper(s.lineup(0)[0]));
  }
  assert.ok(checked >= 150, 'spins checked: ' + checked);
  // The Legend spin has the same guard: a side that somehow has only the keeper slot open is
  // shown keepers (the best legends that fit), and nations without a legend keeper drop out.
  const s = worldCup(5);
  const rows = FORMATIONS[s.formations[0]];
  const out = catalog.players.filter(p => !isKeeper(p)).slice(0, 10);
  // Not reachable in play (the Legend spin is the first pick); exercised through a restored
  // state with ten outfield players and no history.
  const state = JSON.parse(JSON.stringify(s.serialize()));
  state.state.picks[0] = rows.map((r, i) => (r[2] === 'GK' ? null : out[i - 1].profileId));
  state.options.legendSpin = true;
  const odd = restoreDraftSession(catalog, state);
  odd.legendRound = () => true;
  const spin = odd.spin();
  for (const o of spin.reels[0].options)
    assert.equal(o.weight > 0, legends.nations.get(o.id).goalkeepers > 0, o.id);
  assert.ok(odd.snapshot().pool.length >= 1);
  assert.ok(odd.snapshot().pool.some(e => e.available));
  assert.ok(odd.snapshot().pool.every(e => !e.available || e.position === 'GK'));
});

test('Prime boosts: by difficulty, a drafted player becomes his prime version', () => {
  assert.deepEqual(DEFAULT_CONFIG.draft.primes, { pro: 2, worldclass: 1, legendary: 1 });
  for (const [difficulty, n] of Object.entries(DEFAULT_CONFIG.draft.primes)) {
    const s = worldCup(1, { difficulty });
    assert.deepEqual(s.snapshot().primes, { perSide: n, left: [n] });
    assert.equal(s.snapshot().teams[0].primesLeft, n);
  }
  let boosted = 0,
    marked = 0;
  for (let seed = 1; seed <= 40 && boosted < 12; seed++) {
    const s = worldCup(seed, { difficulty: 'pro' });
    s.spin();
    // Pool rows and slots say who has a prime version.
    for (const e of s.snapshot().pool) assert.equal(e.primeVersion, null); // legends have none
    finish(s);
    const before = s.snapshot().teams[0];
    for (const slot of before.slots) {
      const p = s.player(slot.player.profileId),
        prime = primeVersion(catalog, p);
      if (!prime || shown(prime) <= shown(p)) {
        assert.equal(slot.prime, null);
        assert.equal(slot.player.primeVersion, null);
        continue;
      }
      marked++;
      assert.deepEqual(slot.player.primeVersion, {
        profileId: prime.profileId,
        ovr: shown(prime),
        edition: prime.edition,
        year: 1999 + prime.edition,
        position: prime.primaryPosition,
      });
      assert.deepEqual(slot.prime.from, { ovr: slot.player.ovr, rating: slot.rating });
      assert.equal(slot.prime.to.rating, Math.round(roleRating(prime, slot.role)));
      assert.equal(slot.prime.allowed, true);
    }
    const options = s.primeOptions(0);
    if (!options.length) continue;
    const o = options[0],
      base = s.player(o.profileId),
      mates = teamLinks(s.lineup(0), s.rules.links),
      result = s.prime(o.slot, 0);
    assert.deepEqual(result, {
      ok: true,
      side: 0,
      slot: o.slot,
      profileId: o.to.profileId,
      primeOf: o.profileId,
      rating: o.to.rating,
    });
    boosted++;
    const after = s.snapshot().teams[0],
      slot = after.slots[o.slot];
    assert.equal(after.primesLeft, 1);
    assert.equal(slot.rating, o.to.rating);
    assert.deepEqual(
      [slot.player.prime, slot.player.edition, slot.player.ovr, slot.player.name],
      [true, o.to.edition, o.to.ovr, base.name],
    );
    assert.equal(slot.prime, null); // already his prime version
    assert.equal(slot.player.primeVersion, null);
    // The same man for mates and the armband: nation, current club, Captain tag.
    const prime = s.lineup(0)[o.slot];
    assert.deepEqual(prime.source, base.source);
    assert.equal(prime.captain, base.captain);
    const now = teamLinks(s.lineup(0), s.rules.links);
    assert.deepEqual(
      now.players.map(e => e.chem),
      mates.players.map(e => e.chem),
    );
    // (The armband goes to the best-rated Captain: it may move to him, to nobody else.)
    assert.ok(now.captain === mates.captain || now.captain === o.slot);
    assert.equal(now.captainBoost, mates.captainBoost);
    // His current version stays taken; history follows him.
    assert.equal(s.available(base), false);
    assert.ok(s.history.some(h => h.profileId === o.to.profileId && h.primeOf === o.profileId));
    assert.equal(s.prime(o.slot, 0).ok, false);
    // Serialise / restore: identical, and the count runs out.
    const copy = restoreDraftSession(catalog, JSON.parse(JSON.stringify(s.serialize())));
    assert.deepEqual(copy.snapshot(), s.snapshot());
    assert.equal(copy.available(base), false);
    for (const next of copy.primeOptions(0).slice(0, 1))
      assert.equal(copy.prime(next.slot).ok, true);
    if (copy.primesLeft[0] === 0)
      for (const rest of copy.primeOptions(0)) {
        assert.deepEqual([rest.allowed, rest.reason], [false, 'No Prime boosts left']);
        assert.deepEqual(copy.prime(rest.slot), { ok: false, reason: 'No Prime boosts left' });
      }
    // The match plays the prime attributes.
    const side = s.matchSide(0),
      match = new Match(seed, 180);
    assert.deepEqual(side.players[o.slot].attrs, prime.attrs);
    assert.equal(side.players[o.slot].profileId, prime.profileId);
    match.importConfig(
      applyMatchSetup(match.exportConfig(), matchSetup(side, side), { mode: 'ai' }),
    );
    assert.equal(match.players[o.slot].attrs.pace, prime.attrs.pace);
  }
  assert.ok(boosted >= 12 && marked > boosted);
  // No Prime boosts outside drafts that ask for them.
  const plain = finish(createDraftSession(catalog, { seed: 3 }));
  assert.deepEqual(plain.primeOptions(0), []);
  assert.ok(plain.snapshot().teams[0].slots.every(x => x.prime === null));
  assert.deepEqual(plain.prime(0, 0), { ok: false, reason: 'No prime version' });
});

test('Budget mode: a Prime boost is free — he keeps the tier slot of the version drafted', () => {
  let moved = 0;
  for (let seed = 1; seed <= 150 && moved < 8; seed++) {
    const s = finish(worldCup(seed, { budget: true, difficulty: 'pro' })),
      before = s.snapshot().teams[0].budget.map(b => b.used);
    before.forEach((n, i) => assert.ok(n <= bands[i].slots));
    for (const o of s.primeOptions(0)) {
      if (s.primesLeft[0] === 0) break;
      // Never refused for the Budget, whatever tier the prime rating is.
      assert.deepEqual([o.allowed, o.reason], [true, '']);
      assert.equal(s.prime(o.slot).ok, true);
      if (bandIndex(bands, o.to.ovr) !== bandIndex(bands, o.from.ovr)) moved++;
      assert.deepEqual(
        s.snapshot().teams[0].budget.map(b => b.used),
        before,
      );
      // The card shows his prime tier; the Budget still counts the drafted one.
      assert.equal(s.snapshot().teams[0].slots[o.slot].player.tier, o.to.tier);
    }
  }
  assert.ok(moved >= 8, `primes that crossed a tier: ${moved}`);
});

test('a World Cup run keeps the legend and the primed player; opponents never field them', () => {
  for (const seed of [4, 8, 15]) {
    const s = finish(worldCup(seed, { difficulty: 'pro' }));
    for (const o of s.primeOptions(0).slice(0, 2)) s.prime(o.slot);
    const user = s.matchSide(0),
      special = user.players.filter(p => p.legend || p.prime);
    assert.ok(special.some(p => p.legend));
    const run = createCupRun(catalog, { mode: 'nations', difficulty: 'pro', seed, user });
    assert.deepEqual(
      run.user.players,
      user.players.map(p => p.profileId),
    );
    assert.equal(run.userSide().effective, user.effective);
    // Nobody plays for both sides — the current version of a primed player included.
    const taken = new Set(user.players.flatMap(p => [p.profileId, baseProfileId(p)]));
    for (const o of run.opponents)
      assert.ok(
        o.players.every(id => !taken.has(id)),
        o.name,
      );
    const copy = restoreCupRun(catalog, JSON.parse(JSON.stringify(run.serialize())));
    assert.deepEqual(copy.userSide().players, run.userSide().players);
    while (!copy.complete) copy.simulateNext();
    assert.ok(copy.snapshot().place);
    // A catalog without the legends data cannot restore it (the UI loads them first).
    assert.throws(() => restoreCupRun(loadRuntimeCatalog(), run.serialize()), /player database/);
  }
});
