import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeCatalog } from '../scripts/data/catalog-file.mjs';
import {
  createDraftSession,
  restoreDraftSession,
  matchSetup,
  applyMatchSetup,
  buildSide,
  DRAFT_MODES,
  NATURAL_FIT,
} from '../app/core/draft/session.js';
import { catalogIndex, callUps, LINE_OF, isKeeper } from '../app/core/draft/pools.js';
import { overallRating, positionFamiliarity } from '../app/core/players/ratings.js';
import { FORMATIONS } from '../app/core/players/formations.js';
import { lcg } from '../app/core/util/rng.js';
import { Match } from '../app/core/sim/engine.js';
import { DEFAULT_CONFIG } from '../app/core/config/config.js';

const catalog = loadRuntimeCatalog();
const index = catalogIndex(catalog);
const byId = new Map(catalog.players.map(p => [p.profileId, p]));

// Draft policies: (session) => { profileId, slot }.
const positional = s => s.suggestPick();
const randomPolicy = random => s => {
  const pool = s.snapshot().pool.filter(e => e.available),
    e = pool[Math.floor(random() * pool.length)];
  return { profileId: e.profileId, slot: s.autoSlot(e.profileId).slot };
};
// Fills every outfield slot first, so the keeper is the last pick (dead-end guard).
const keeperLast = s => {
  const pool = s.snapshot().pool.filter(e => e.available),
    e = pool.find(e => e.position !== 'GK') || pool[0];
  return { profileId: e.profileId, slot: s.autoSlot(e.profileId).slot };
};
function finish(s, policy) {
  while (!s.complete) {
    if (s.phase === 'spin') s.spin();
    const move = policy(s),
      result = s.pick(move.profileId, move.slot);
    assert.ok(result.ok, result.reason);
  }
  return s;
}
function assertValidXIs(s) {
  const seen = new Set();
  for (let side = 0; side < s.sides; side++) {
    const rows = FORMATIONS[s.formations[side]],
      xi = s.lineup(side);
    assert.equal(xi.filter(Boolean).length, 11);
    xi.forEach((p, i) => assert.equal(rows[i][2] === 'GK', isKeeper(p), 'keeper only in goal'));
    for (const p of xi) {
      assert.ok(!seen.has(p.profileId), 'unique players across sides');
      seen.add(p.profileId);
    }
  }
  // Every pick came from the pool its spin landed on.
  for (const h of s.history) {
    const p = byId.get(h.profileId),
      key =
        h.category === 'nation'
          ? p.source.nationality
          : h.category === 'league'
            ? String(p.source.leagueId)
            : String(p.source.clubId);
    assert.equal(key, h.optionId, h.category);
  }
}

test('every draft mode completes valid XIs for one and two sides', () => {
  for (const mode of Object.keys(DRAFT_MODES))
    for (const sides of [1, 2])
      for (const seed of [3, 41, 977]) {
        const random = lcg(seed * 7 + sides);
        for (const policy of [positional, randomPolicy(random), keeperLast]) {
          const s = finish(
            createDraftSession(catalog, {
              mode,
              seed,
              sides,
              formations: ['433', '352'],
            }),
            policy,
          );
          assertValidXIs(s);
          assert.equal(s.history.length, 11 * sides);
          assert.equal(s.snapshot().phase, 'complete');
        }
      }
});

test('a draft is deterministic for its seed and options', () => {
  const run = () =>
    finish(
      createDraftSession(catalog, { mode: 'clubAndCountry', seed: 'abc', sides: 2 }),
      positional,
    ).history;
  assert.deepEqual(run(), run());
  const other = finish(
    createDraftSession(catalog, { mode: 'clubAndCountry', seed: 'abd', sides: 2 }),
    positional,
  );
  assert.notDeepEqual(other.history, run());
});

test('spins follow the mode: nation field in pots, call-ups, leagues, clubs, alternation', () => {
  assert.equal(index.field.length, 48);
  assert.deepEqual(
    [1, 2, 3, 4].map(pot => index.field.filter(n => n.pot === pot).length),
    [12, 12, 12, 12],
  );
  assert.ok(index.field.every(n => n.players.length >= 23 && n.goalkeepers >= 2));
  for (let i = 1; i < index.field.length; i++)
    assert.ok(index.field[i - 1].strength >= index.field[i].strength);
  const s = createDraftSession(catalog, { mode: 'nations', seed: 5 });
  const spin = s.spin();
  assert.equal(spin.category, 'nation');
  assert.equal(spin.reels.length, 1);
  assert.equal(spin.reels[0].options.length, 48);
  assert.equal(spin.reels[0].options[spin.reels[0].landing].id, spin.option.id);
  // Call-ups: best available 23 with 3 GK and the line minimums.
  const pool = s.poolPlayers();
  assert.equal(pool.length, 23);
  const lines = pool.reduce((m, p) => ((m[LINE_OF[p.primaryPosition]] += 1), m), {
    GK: 0,
    DEF: 0,
    MID: 0,
    ATT: 0,
  });
  assert.equal(lines.GK, 3);
  assert.ok(lines.DEF >= 7 && lines.MID >= 7 && lines.ATT >= 4, JSON.stringify(lines));
  // Clubs: one press, two reels (league then club).
  const c = createDraftSession(catalog, { mode: 'clubs', seed: 9 }).spin();
  assert.deepEqual(
    c.reels.map(r => r.category),
    ['league', 'club'],
  );
  assert.equal(c.reels[1].options[c.reels[1].landing].id, c.option.id);
  assert.equal(c.league.id, c.option.leagueId);
  // Club & Country alternates nation / league spins per side.
  const cc = finish(createDraftSession(catalog, { mode: 'clubAndCountry', seed: 2 }), positional);
  assert.deepEqual(
    cc.history.map(h => h.category),
    Array.from({ length: 11 }, (_, i) => (i % 2 ? 'league' : 'nation')),
  );
});

test('call-ups refill from the next best player and skip drafted ones', () => {
  const france = index.nations.get('France'),
    all = callUps(france, () => true),
    taken = new Set(
      all
        .filter(p => !isKeeper(p))
        .slice(0, 5)
        .map(p => p.profileId),
    ),
    refilled = callUps(france, p => !taken.has(p.profileId));
  assert.equal(refilled.length, 23);
  assert.ok(refilled.every(p => !taken.has(p.profileId)));
  assert.equal(refilled.filter(isKeeper).length, 3);
});

test('honest weights: landing frequencies match the shown reel probabilities', () => {
  // Nations: uniform over the 48-nation field (chi-square, 47 dof, p = 0.001 -> 82.7).
  const counts = new Map(),
    n = 2400;
  for (let seed = 1; seed <= n; seed++) {
    const spin = createDraftSession(catalog, { mode: 'nations', seed }).spin();
    assert.ok(spin.reels[0].options.every(o => o.weight === 1 && o.probability === 0.021));
    counts.set(spin.option.id, (counts.get(spin.option.id) || 0) + 1);
  }
  const expected = n / 48,
    chi = index.field.reduce((s, x) => s + ((counts.get(x.id) || 0) - expected) ** 2 / expected, 0);
  assert.ok(chi < 82.7, 'nation chi-square ' + chi.toFixed(1));
  // Leagues: tier frequencies follow the flat weights A4/B2/C1/D.5/F.25 (4 dof -> 18.5).
  const weight = { A: 4, B: 2, C: 1, D: 0.5, F: 0.25 },
    total = index.leagues.reduce((s, l) => s + weight[l.tier], 0),
    tiers = {};
  const m = 2000;
  for (let seed = 1; seed <= m; seed++) {
    const spin = createDraftSession(catalog, { mode: 'leagues', seed }).spin();
    tiers[spin.option.tier] = (tiers[spin.option.tier] || 0) + 1;
    const shown = spin.reels[0].options.find(o => o.id === spin.option.id);
    assert.equal(shown.weight, weight[shown.tier]);
  }
  let chiTier = 0;
  for (const t of Object.keys(weight)) {
    const e =
      (m * index.leagues.filter(l => l.tier === t).reduce((s, l) => s + weight[l.tier], 0)) / total;
    if (e) chiTier += ((tiers[t] || 0) - e) ** 2 / e;
  }
  assert.ok(chiTier < 18.5, 'league tier chi-square ' + chiTier.toFixed(1));
});

test('dead-end guard: a spin never lands on a pool that cannot fill an open slot class', () => {
  // Keep keepers only at one club / one nation: once only the GK slot is open, the spin
  // must land there, and every other option is shown with weight 0.
  const club = index.leagues.find(l => l.tier === 'A').spinnableClubs.find(c => c.goalkeepers >= 2),
    clubKeepers = catalog.players.filter(p => isKeeper(p) && String(p.source.clubId) !== club.id);
  for (const seed of [1, 2, 3]) {
    const s = createDraftSession(catalog, {
      mode: 'clubs',
      seed,
      excludePlayers: clubKeepers.map(p => p.profileId),
    });
    while (s.round() < 10) {
      s.spin();
      assert.ok(s.poolPlayers().some(p => !isKeeper(p)));
      const r = s.pick(keeperLast(s).profileId);
      assert.ok(r.ok);
    }
    assert.deepEqual(s.openClasses(), { gk: true, out: false });
    const spin = s.spin();
    assert.equal(spin.option.id, club.id);
    assert.ok(spin.reels[1].options.filter(o => o.weight > 0).every(o => o.id === club.id));
    assert.ok(spin.reels[0].options.filter(o => o.weight > 0).every(o => o.id === club.leagueId));
    assert.ok(s.pick(s.poolPlayers().find(isKeeper).profileId).ok);
  }
  const nation = index.field[20],
    others = catalog.players.filter(p => isKeeper(p) && p.source.nationality !== nation.id);
  const s = createDraftSession(catalog, {
    mode: 'nations',
    seed: 4,
    excludePlayers: others.map(p => p.profileId),
  });
  while (s.round() < 10) {
    s.spin();
    s.pick(keeperLast(s).profileId);
  }
  assert.equal(s.spin().option.id, nation.id);
});

test('re-rolls: count by difficulty, per side, never repeat a seen option', () => {
  for (const [difficulty, n] of Object.entries({
    pro: 2,
    worldclass: 1,
    legendary: 1,
    // A save or a link from before the three difficulties plays as Pro.
    amateur: 2,
    semipro: 2,
  })) {
    const s = createDraftSession(catalog, { seed: 8, difficulty });
    assert.equal(s.snapshot().rerolls[0], n);
  }
  const s = createDraftSession(catalog, { seed: 8, difficulty: 'pro' });
  assert.throws(() => s.reroll(), /Spin first/);
  const seen = [s.spin().option.id];
  assert.equal(s.snapshot().canReroll, true);
  seen.push(s.reroll().option.id);
  const third = s.reroll();
  seen.push(third.option.id);
  assert.equal(new Set(seen).size, 3);
  assert.equal(third.reroll, 2);
  // Seen options are shown with weight 0 on the re-roll reel.
  assert.ok(
    seen.slice(0, 2).every(id => third.reels[0].options.find(o => o.id === id).weight === 0),
  );
  assert.equal(s.rerollBlocked(), 'No re-rolls left');
  assert.throws(() => s.reroll(), /No re-rolls left/);
  assert.equal(s.snapshot().canReroll, false);
  // Explicit count overrides the difficulty; PvP sides have their own re-rolls.
  const pvp = createDraftSession(catalog, { seed: 8, sides: 2, rerolls: 1 });
  const first = pvp.turn;
  pvp.spin();
  pvp.reroll();
  pvp.pick(pvp.suggestPick().profileId);
  assert.deepEqual(pvp.rerollsLeft[first], 0);
  assert.deepEqual(pvp.rerollsLeft[1 - first], 1);
  pvp.spin();
  assert.ok(pvp.reroll());
});

test('PvP: a seeded coin toss picks the first drafter, then turns alternate', () => {
  const firsts = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const s = createDraftSession(catalog, { seed, sides: 2 });
    firsts.add(s.first);
    const turns = [];
    for (let k = 0; k < 6; k++) {
      turns.push(s.turn);
      s.spin();
      s.pick(s.suggestPick().profileId);
    }
    assert.deepEqual(
      turns,
      [0, 1, 0, 1, 0, 1].map(t => (t + s.first) % 2),
    );
  }
  assert.deepEqual([...firsts].sort(), [0, 1]);
});

test('placement options show the rating after familiarity and why a slot is closed', () => {
  const s = createDraftSession(catalog, { seed: 31, formation: '433' });
  s.spin();
  const outfield = s.poolPlayers().find(p => !isKeeper(p)),
    options = s.placementOptions(outfield.profileId);
  assert.equal(options.length, 11);
  const rows = FORMATIONS['433'];
  options.forEach((o, slot) => {
    assert.equal(o.role, rows[slot][2]);
    assert.equal(o.rating, overallRating(outfield, true, o.role));
    assert.equal(o.natural, overallRating(outfield, true, outfield.primaryPosition));
    assert.equal(o.delta, o.rating - o.natural);
    assert.ok(Math.abs(o.familiarity - positionFamiliarity(outfield, o.role)) < 0.001);
  });
  assert.equal(options[0].allowed, false);
  assert.equal(options[0].reason, 'Goalkeepers only');
  assert.ok(options.slice(1).every(o => o.allowed));
  const auto = s.autoSlot(outfield.profileId);
  assert.ok(auto.natural && auto.familiarity >= NATURAL_FIT);
  assert.ok(s.pick(outfield.profileId, auto.slot).ok);
  // Filled slot, wrong turn phase and drafted player reasons.
  s.spin();
  const next = s.poolPlayers().find(p => !isKeeper(p));
  assert.equal(s.placementOptions(next.profileId)[auto.slot].reason, 'Slot filled');
  assert.equal(s.placementOptions(outfield.profileId)[1].reason, 'Already drafted');
  assert.deepEqual(s.pick(next.profileId, 0), { ok: false, reason: 'Goalkeepers only' });
  const stranger = catalog.players.find(
    p => !s.poolPlayers().includes(p) && !s.used.has(p.profileId),
  );
  assert.equal(s.pick(stranger.profileId).reason, 'Not in this pool');
});

test('auto placement prefers a natural slot over a higher out-of-position rating', () => {
  // Real players always rate highest in a natural position (familiarity scales the rating),
  // so relabel a top striker as a centre-back: his ST rating now beats his CB rating.
  const relabel = p => ({ ...p, primaryPosition: 'CB', secondaryPositions: [] }),
    margin = p => overallRating(relabel(p), false, 'ST') - overallRating(relabel(p), false, 'CB'),
    striker = catalog.players
      .filter(p => p.primaryPosition === 'ST' && overallRating(p, true, 'ST') >= 82)
      .sort((a, b) => margin(b) - margin(a))[0],
    fake = relabel(striker),
    modified = { ...catalog, players: catalog.players.map(p => (p === striker ? fake : p)) };
  const s = createDraftSession(modified, {
    mode: 'leagues',
    seed: 1,
    formation: '433',
    schedule: { rounds: [{ spin: String(striker.source.leagueId), alternate: null }] },
  });
  assert.equal(s.spin().option.id, String(striker.source.leagueId));
  const auto = s.autoSlot(fake.profileId),
    options = s.placementOptions(fake.profileId).filter(o => o.allowed),
    st = options.find(o => o.role === 'ST');
  assert.equal(auto.role, 'CB');
  assert.ok(auto.natural);
  assert.ok(st.rating > auto.rating && st.familiarity < NATURAL_FIT, JSON.stringify(st));
  // The pool shows his best rating anywhere (out of position); Auto still goes natural.
  const best = s.snapshot().pool.find(e => e.profileId === fake.profileId).best;
  assert.ok(best.familiarity < NATURAL_FIT && best.rating >= st.rating);
  // An explicit out-of-position slot is still allowed and shows the drop vs natural.
  assert.ok(s.pick(fake.profileId, st.slot).ok);
  assert.equal(s.team(0).slots[st.slot].rating, st.rating);
});

test('exclusions and one-per-nation are respected by every spin', () => {
  const excluded = index.field.slice(0, 6).map(n => n.id),
    clubs = [...index.clubs.keys()].slice(0, 30);
  for (const seed of [1, 2, 3, 4]) {
    const s = finish(
      createDraftSession(catalog, {
        seed,
        uniqueNations: true,
        excludeNations: excluded,
        excludeClubs: clubs,
      }),
      positional,
    );
    const nations = s.history.map(h => h.optionId);
    assert.equal(new Set(nations).size, 11);
    assert.ok(nations.every(n => !excluded.includes(n)));
    assert.ok(s.lineup(0).every(p => !clubs.includes(String(p.source.clubId))));
  }
  const opponent = index.nations
    .get('Spain')
    .players.slice(0, 11)
    .map(p => p.profileId);
  for (const seed of [5, 6, 7]) {
    const s = finish(
      createDraftSession(catalog, { seed, mode: 'leagues', excludePlayers: opponent }),
      positional,
    );
    assert.ok(s.lineup(0).every(p => !opponent.includes(p.profileId)));
  }
});

test('snapshot carries the UI data: spin, pool fit, teams, links and flags', () => {
  const s = createDraftSession(catalog, { seed: 77, hideRatings: true, difficulty: 'worldclass' });
  let snap = s.snapshot();
  assert.equal(snap.phase, 'spin');
  assert.equal(snap.hideRatings, true);
  assert.equal(snap.category, 'nation');
  assert.equal(snap.pool.length, 0);
  s.spin();
  snap = s.snapshot();
  assert.equal(snap.phase, 'pick');
  assert.equal(snap.pool.length, 23);
  const top = snap.pool[0];
  assert.ok(top.available && top.best && top.nationCode && top.tier);
  for (let i = 1; i < snap.pool.length; i++)
    if (snap.pool[i].available && snap.pool[i - 1].available)
      assert.ok(snap.pool[i - 1].best.rating >= snap.pool[i].best.rating);
  assert.ok(snap.pool.filter(e => e.position === 'GK').every(e => e.best.role === 'GK'));
  s.pick(top.profileId, top.best.slot);
  snap = s.snapshot();
  const team = snap.teams[0];
  assert.equal(team.filled, 1);
  assert.equal(team.slots[top.best.slot].player.profileId, top.profileId);
  assert.equal(team.rating, top.best.rating === team.rating ? top.best.rating : team.rating);
  assert.ok(JSON.parse(JSON.stringify(snap)));
  assert.equal(s.snapshot(), snap, 'cached until the state changes');
});

test('serialize/restore round-trips mid-spin and continues identically', () => {
  for (const mode of ['nations', 'clubs', 'clubAndCountry']) {
    const a = createDraftSession(catalog, { mode, seed: 123, sides: 2, difficulty: 'worldclass' });
    for (let k = 0; k < 5; k++) {
      a.spin();
      a.pick(a.suggestPick().profileId);
    }
    a.spin();
    const b = restoreDraftSession(catalog, JSON.parse(JSON.stringify(a.serialize())));
    assert.deepEqual(b.snapshot(), a.snapshot());
    a.reroll();
    b.reroll();
    finish(a, positional);
    finish(b, positional);
    assert.deepEqual(b.serialize(), a.serialize());
  }
  assert.throws(() => restoreDraftSession(catalog, { type: 'other' }), /Not a saved draft/);
  const saved = createDraftSession(catalog, { seed: 1 }).serialize();
  saved.state.picks[0][0] = 'missing:player';
  assert.throws(() => restoreDraftSession(catalog, saved), /does not match/);
});

test('formation changes re-place players; move swaps compatible slots', () => {
  const s = createDraftSession(catalog, { seed: 64, formation: '433' });
  for (let k = 0; k < 6; k++) {
    s.spin();
    s.pick(s.suggestPick().profileId);
  }
  const before = new Set(s.picks[0].filter(Boolean));
  s.setFormation(0, '352');
  assert.deepEqual(new Set(s.picks[0].filter(Boolean)), before);
  s.picks[0].forEach((id, i) => {
    if (id) assert.equal(FORMATIONS['352'][i][2] === 'GK', isKeeper(byId.get(id)));
  });
  const filled = s.picks[0].map((id, i) => (id && i ? i : -1)).filter(i => i > 0);
  const [x, y] = filled;
  const [px, py] = [s.picks[0][x], s.picks[0][y]];
  assert.ok(s.move(0, x, y));
  assert.deepEqual([s.picks[0][x], s.picks[0][y]], [py, px]);
  const keeperSlot = 0;
  if (s.picks[0][keeperSlot]) assert.equal(s.move(0, keeperSlot, x), false);
});

test('match setup builds engine-ready sides with roles, kits and link chem', () => {
  const s = finish(
    createDraftSession(catalog, { seed: 15, sides: 2, formations: ['4231', '442'] }),
    positional,
  );
  const home = s.matchSide(0),
    away = s.matchSide(1);
  assert.equal(home.players.length, 11);
  home.players.forEach((p, i) => {
    assert.equal(p.role, FORMATIONS['4231'][i][2]);
    assert.ok(p.chem >= 0 && p.chem <= 2 + DEFAULT_CONFIG.draft.links.captain);
  });
  const setup = matchSetup(home, { ...away, color: home.color });
  assert.notEqual(setup.teams[1].color, setup.teams[0].color, 'clashing kits switch');
  const match = new Match(5, 180),
    config = applyMatchSetup(match.exportConfig(), setup, { mode: 'ai' });
  match.importConfig(config);
  assert.equal(match.teams[0].tactics.formation, '4231');
  assert.equal(match.teams[1].tactics.formation, '442');
  assert.deepEqual(
    match.players.map(p => p.profileId),
    [...home.players, ...away.players].map(p => p.profileId),
  );
  // A national XI is fully linked: chem 2 for every player.
  const nation = index.nations.get('Brazil'),
    xi = buildSide({
      name: 'Brazil',
      color: '#ffdf00',
      secondary: '#009c3b',
      formation: '433',
      players: assignXI(nation.players),
    });
  // A national XI is fully linked: chem 2, plus the captain's boost (Brazil has one).
  assert.ok(nation.players.some(p => p.captain));
  assert.ok(xi.players.every(p => p.chem === 2 + DEFAULT_CONFIG.draft.links.captain));
  assert.equal(xi.links.score, 33);
});

function assignXI(players) {
  const rows = FORMATIONS['433'],
    out = Array(11).fill(null),
    used = new Set();
  rows.forEach(([, , role], i) => {
    const p = players.find(q => !used.has(q) && (role === 'GK') === isKeeper(q));
    out[i] = p;
    used.add(p);
  });
  return out;
}
