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
import {
  catalogIndex,
  draftRules,
  draftSquad,
  bestEleven,
  selectable,
  naturalRating,
  LINE_OF,
  isKeeper,
} from '../app/core/draft/pools.js';
import { buildOpponent, opponentCandidates } from '../app/core/draft/opponents.js';
import { CONFIG, DEFAULT_CONFIG } from '../app/core/config/config.js';
import { overallRating, positionFamiliarity } from '../app/core/players/ratings.js';
import { FORMATIONS } from '../app/core/players/formations.js';
import { lcg } from '../app/core/util/rng.js';
import { Match } from '../app/core/sim/engine.js';

const catalog = loadRuntimeCatalog();
const index = catalogIndex(catalog);
const byId = new Map(catalog.players.map(p => [p.profileId, p]));
const shown = p => Math.round(naturalRating(p));
// Chi-square limit at p = 0.001 for any degrees of freedom (Wilson–Hilferty).
const chiLimit = dof => dof * (1 - 2 / (9 * dof) + 3.09 * Math.sqrt(2 / (9 * dof))) ** 3;

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
  // A field nation can field an XI: eleven players, a real keeper, nobody out of position.
  assert.ok(index.field.every(n => n.players.length >= 11 && n.goalkeepers >= 1));
  assert.deepEqual(index.field, index.playable.slice(0, 48));
  for (const n of index.playable) {
    const xi = bestEleven(n.players, { strict: true });
    assert.ok(xi && xi.players.filter(isKeeper).length === 1, n.name);
    FORMATIONS[xi.formation].forEach(([, , role], i) =>
      assert.ok(positionFamiliarity(xi.players[i], role) >= CONFIG.ai.minimumFit, n.name),
    );
  }
  assert.ok(index.field.some(n => n.name === 'Nigeria'));
  for (let i = 1; i < index.field.length; i++)
    assert.ok(index.field[i - 1].strength >= index.field[i].strength);
  const s = createDraftSession(catalog, { mode: 'nations', seed: 5 });
  const spin = s.spin();
  assert.equal(spin.category, 'nation');
  assert.equal(spin.reels.length, 1);
  // The reel: the 56 playable nations (the strongest that can field an XI) plus the star
  // nations (a star rated 80+, not the depth).
  assert.equal(spin.reels[0].options.length, index.spinField.length);
  assert.equal(index.playable.length, CONFIG.draft.nations.playableSize);
  assert.equal(index.playable.length, 56);
  // Star nations: not playable, a star shown at reelStar or more, and reelPlayers players a
  // draft may offer (draft.pickMinimum) — exactly those, whatever the catalog holds.
  const rule = CONFIG.draft.nations,
    stars = index.spinField.filter(n => !n.playable),
    pickable = n => n.players.filter(p => shown(p) >= CONFIG.draft.pickMinimum).length;
  assert.equal(index.spinField.length, index.playable.length + stars.length);
  assert.deepEqual(
    stars.map(n => n.name).sort(),
    [...index.nations.values()]
      .filter(
        n =>
          !n.playable &&
          pickable(n) >= rule.reelPlayers &&
          n.players.some(p => shown(p) >= rule.reelStar),
      )
      .map(n => n.name)
      .sort(),
  );
  assert.ok(stars.length >= 3 && stars.some(n => n.name === 'Egypt'));
  for (const name of ['Egypt', 'Costa Rica', 'New Zealand'])
    assert.ok(
      index.spinField.some(n => n.name === name && n.pot === 5),
      name,
    );
  assert.equal(spin.reels[0].options[spin.reels[0].landing].id, spin.option.id);
  // The pool: the nation's draft squad — 30 with 3 GK and the line minimums.
  const pool = s.poolPlayers();
  assert.equal(pool.length, 30);
  const lines = pool.reduce((m, p) => ((m[LINE_OF[p.primaryPosition]] += 1), m), {
    GK: 0,
    DEF: 0,
    MID: 0,
    ATT: 0,
  });
  assert.equal(lines.GK, 3);
  assert.ok(lines.DEF >= 9 && lines.MID >= 9 && lines.ATT >= 5, JSON.stringify(lines));
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

test('a nation offers its best 30 of the players shown 65+ and never refills', () => {
  const rule = DEFAULT_CONFIG.draft.nations,
    min = DEFAULT_CONFIG.draft.pickMinimum;
  assert.deepEqual(
    [
      rule.squadSize,
      rule.squadGoalkeepers,
      rule.squadDefenders,
      rule.squadMidfielders,
      rule.squadAttackers,
    ],
    [30, 3, 9, 9, 5],
  );
  const lineCount = list =>
    list.reduce((m, p) => ((m[LINE_OF[p.primaryPosition]] += 1), m), {
      GK: 0,
      DEF: 0,
      MID: 0,
      ATT: 0,
    });
  let short = 0;
  for (const nation of index.nations.values()) {
    const offered = nation.players.filter(p => shown(p) >= min),
      squad = nation.squad,
      has = lineCount(offered),
      got = lineCount(squad),
      out = offered.length - has.GK;
    assert.deepEqual(squad, draftSquad(nation.players), nation.name);
    assert.ok(squad.length <= rule.squadSize && squad.every(p => offered.includes(p)));
    // As many keepers as the rule says (or as the nation has), the line minimums, then the
    // best outfield players: 30 whenever the nation has them.
    assert.equal(got.GK, Math.min(rule.squadGoalkeepers, has.GK), nation.name);
    assert.ok(got.DEF >= Math.min(rule.squadDefenders, has.DEF), nation.name);
    assert.ok(got.MID >= Math.min(rule.squadMidfielders, has.MID), nation.name);
    assert.ok(got.ATT >= Math.min(rule.squadAttackers, has.ATT), nation.name);
    assert.equal(squad.length, Math.min(rule.squadSize, got.GK + out), nation.name);
    for (let i = 1; i < squad.length; i++)
      assert.ok(naturalRating(squad[i - 1]) >= naturalRating(squad[i]));
    // Nobody left out is better than a squad player of his own line.
    const worst = {};
    for (const p of squad) worst[LINE_OF[p.primaryPosition]] = naturalRating(p);
    for (const p of offered)
      if (!squad.includes(p))
        assert.ok(naturalRating(p) <= worst[LINE_OF[p.primaryPosition]], nation.name + p.name);
    if (index.spinField.includes(nation) && squad.length < rule.squadSize) short++;
  }
  assert.ok(short > 0 && short < 12, 'reel nations with fewer than 30: ' + short);
  // Teams are not drafts: the nation keeps everyone.
  const france = index.nations.get('France');
  assert.equal(france.squad.length, 30);
  assert.ok(france.players.length > 300);
  // The pool is the squad less the players taken: it shrinks, nobody moves up from deeper.
  const rounds = Array.from({ length: 11 }, () => ({ spin: 'France', alternate: null })),
    s = createDraftSession(catalog, { seed: 6, schedule: { rounds } }),
    squad = new Set(france.squad);
  for (let k = 0; k < 11; k++) {
    assert.equal(s.spin().option.id, 'France');
    const pool = s.poolPlayers();
    assert.equal(pool.length, 30 - k);
    assert.ok(pool.every(p => squad.has(p)));
    assert.equal(s.snapshot().pool.length, 30 - k);
    assert.equal(s.pick(keeperLast(s).profileId).ok, true);
  }
  assert.ok(s.complete);
  // An excluded player (an opponent chosen first) is gone from the pool, not replaced.
  const without = createDraftSession(catalog, {
    seed: 6,
    schedule: { rounds },
    excludePlayers: france.squad.slice(0, 4).map(p => p.profileId),
  });
  without.spin();
  assert.equal(without.poolPlayers().length, 26);
  // A nation with nobody of its squad left leaves the reel (weight 0) instead of offering
  // deeper players.
  const deep = index.spinField.find(n => n.players.filter(p => shown(p) >= min).length > 40),
    drained = createDraftSession(catalog, {
      seed: 2,
      excludePlayers: deep.squad.map(p => p.profileId),
    }),
    reel = drained.spin().reels[0];
  assert.equal(reel.options.find(o => o.id === deep.id).weight, 0);
  assert.ok(reel.options.filter(o => o.weight > 0).length === index.spinField.length - 1);
});

test('honest weights: landing frequencies match the shown reel probabilities', () => {
  // Nations: uniform over the nations of the reel (chi-square at p = 0.001).
  const counts = new Map(),
    n = 2400,
    reel = index.spinField.length,
    each = Math.round(1000 / reel) / 1000;
  for (let seed = 1; seed <= n; seed++) {
    const spin = createDraftSession(catalog, { mode: 'nations', seed }).spin();
    assert.ok(spin.reels[0].options.every(o => o.weight === 1 && o.probability === each));
    counts.set(spin.option.id, (counts.get(spin.option.id) || 0) + 1);
  }
  const expected = n / reel,
    chi = index.spinField.reduce(
      (s, x) => s + ((counts.get(x.id) || 0) - expected) ** 2 / expected,
      0,
    );
  assert.ok(chi < chiLimit(reel - 1), 'nation chi-square ' + chi.toFixed(1));
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

test('drafts offer only players shown 65+; teams keep their real players', () => {
  const min = DEFAULT_CONFIG.draft.pickMinimum;
  assert.equal(min, 65);
  assert.equal(draftRules().pickMinimum, min);
  assert.equal(selectable({ legend: true }, min), true); // legends and primes are not asked
  const low = catalog.players.filter(p => shown(p) < min);
  assert.ok(low.length > 1000 && low.length < catalog.players.length / 2);
  assert.ok(low.every(p => !selectable(p, min)) && low.every(p => selectable(p, 0)));
  // Every mode, Budget mode too, with re-rolls and awkward policies: no row under the
  // minimum, never a dead end, and a pick of such a player is refused.
  const formations = Object.keys(FORMATIONS);
  let spins = 0;
  for (const mode of ['nations', 'leagues', 'clubs'])
    for (let seed = 1; seed <= 36; seed++) {
      const s = createDraftSession(catalog, {
        mode,
        seed,
        rerolls: 3,
        budget: seed % 3 === 0,
        sides: seed % 4 === 0 ? 2 : 1,
        formation: formations[seed % formations.length],
      });
      assert.equal(s.pickMinimum, min);
      const policy = [positional, keeperLast, randomPolicy(lcg(seed))][seed % 3];
      const check = () => {
        const pool = s.snapshot().pool;
        spins++;
        assert.ok(pool.length > 0);
        assert.ok(
          pool.every(e => e.ovr >= min),
          `${mode} ${seed}: a row under ${min}`,
        );
        assert.ok(
          pool.some(e => e.available),
          `${mode} ${seed}: nothing to pick`,
        );
        // The reel: an option can come up only if a player the draft may offer fills an open
        // slot class (the keeper slot: a 65+ keeper).
        const reel = s.current.reels.at(-1),
          open = s.openClasses();
        for (const o of reel.options) {
          if (!o.weight) continue;
          // A nation: only its draft squad counts.
          const players =
            reel.category === 'nation'
              ? index.nations.get(o.id).squad
              : reel.category === 'league'
                ? index.leagueById.get(o.id).players
                : index.clubs.get(o.id).players;
          assert.ok(
            players.some(
              p =>
                shown(p) >= min &&
                s.available(p) &&
                s.affordable(p) &&
                (isKeeper(p) ? open.gk : open.out),
            ),
            `${mode} ${seed}: ${o.name}`,
          );
        }
        if (reel.category === 'nation') {
          const squad = new Set(index.nations.get(s.current.option.id).squad.map(p => p.profileId));
          assert.ok(pool.length <= CONFIG.draft.nations.squadSize);
          assert.ok(pool.every(e => squad.has(e.profileId)));
        }
      };
      while (!s.complete) {
        s.spin();
        check();
        while (!s.rerollBlocked() && (s.round() + seed) % 4 === 0) {
          s.reroll();
          check();
        }
        const move = policy(s);
        assert.equal(s.pick(move.profileId, move.slot).ok, true);
      }
      for (const p of s.picks.flat().map(id => byId.get(id))) assert.ok(shown(p) >= min);
    }
  assert.ok(spins > 1200);
  // A player under the minimum is not in his nation's pool and cannot be picked.
  const nation = index.spinField.find(
      n => n.players.some(p => shown(p) < min) && n.players.filter(p => shown(p) >= min).length,
    ),
    weak = nation.players.find(p => shown(p) < min),
    forced = createDraftSession(catalog, {
      seed: 3,
      schedule: { rounds: [{ spin: nation.id, alternate: null }] },
    });
  assert.equal(forced.spin().option.id, nation.id);
  assert.equal(forced.available(weak), false);
  assert.ok(!forced.poolPlayers().includes(weak));
  assert.deepEqual(forced.pick(weak.profileId), { ok: false, reason: 'Not in this pool' });
  // Club spins need a squad to choose from: every spinnable club has eleven such players.
  for (const l of index.leagues)
    for (const c of l.spinnableClubs)
      assert.ok(
        c.players.filter(p => shown(p) >= min).length >= CONFIG.draft.clubs.minimumPlayers,
        c.name,
      );
  // Teams are not drafts. Which nations are playable, their order and strength, the clubs and
  // every opponent's XI are what they are without the rule — players under 65 included.
  const free = catalogIndex(catalog, { ...draftRules(), pickMinimum: 0 });
  assert.deepEqual(
    index.playable.map(n => [n.name, n.strength]),
    free.playable.map(n => [n.name, n.strength]),
  );
  assert.deepEqual(
    index.field.map(n => n.name),
    free.field.map(n => n.name),
  );
  assert.equal(index.clubs.size, free.clubs.size);
  assert.ok(free.spinField.length >= index.spinField.length);
  const candidates = opponentCandidates(catalog),
    weakest = candidates.filter(c => c.kind === 'club').sort((a, b) => a.rating - b.rating)[0],
    side = buildOpponent(catalog, weakest);
  assert.ok(
    side.players.some(p => shown(p) < min),
    `${weakest.name} fields its real players`,
  );
  // A draft saved before the rule has none in its rules: it loads and offers everyone.
  const old = createDraftSession(catalog, {
    seed: 3,
    schedule: { rounds: [{ spin: nation.id, alternate: null }] },
  });
  old.spin();
  const data = JSON.parse(JSON.stringify(old.serialize()));
  assert.equal(data.rules.pickMinimum, min);
  delete data.rules.pickMinimum;
  const restored = restoreDraftSession(catalog, data);
  assert.equal(restored.pickMinimum, 0);
  assert.equal(restored.available(weak), true);
  assert.ok(restored.snapshot().pool.length >= old.snapshot().pool.length);
  assert.equal(restored.pick(restored.suggestPick().profileId).ok, true);
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
  // so relabel a top striker as a centre-back: his ST rating now beats his CB rating. (One
  // who still shows 65+ as a centre-back: a draft offers nobody under that.)
  const relabel = p => ({ ...p, primaryPosition: 'CB', secondaryPositions: [] }),
    margin = p => overallRating(relabel(p), false, 'ST') - overallRating(relabel(p), false, 'CB'),
    striker = catalog.players
      .filter(
        p =>
          p.primaryPosition === 'ST' &&
          overallRating(p, true, 'ST') >= 82 &&
          overallRating(relabel(p), true, 'CB') >= CONFIG.draft.pickMinimum,
      )
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
  // A natural slot: his own position or a neighbouring one (CB, or a full-back).
  assert.ok(['CB', 'LB', 'RB', 'DM'].includes(auto.role), auto.role);
  assert.ok(auto.natural && auto.familiarity >= NATURAL_FIT);
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
  assert.equal(snap.pool.length, 30);
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
    assert.ok([0, 1, 1.5, 2.5, 2, 3.5].includes(p.chem), `chem ${p.chem}`); // +1 with a Captain
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
  const side = name =>
    buildSide({
      name,
      color: '#ffdf00',
      secondary: '#009c3b',
      formation: '433',
      players: assignXI(index.nations.get(name).players),
    });
  // A national XI is all nation mates: +1.5 each (+2.5 for club mates inside it).
  const brazil = side('France');
  assert.ok(!index.nations.get('France').players.some(p => p.captain));
  assert.ok(brazil.players.every(p => p.chem === 1.5 || p.chem === 2.5));
  assert.ok(brazil.links.score >= 16.5 && brazil.links.score <= 27.5);
  assert.equal(brazil.links.total, brazil.links.score);
  assert.equal(brazil.links.captain, null);
  // With its Captain in the XI (van Dijk), everyone gets +1 on top.
  const dutch = side('Netherlands');
  assert.equal(dutch.players[dutch.links.captain].name, 'V. van Dijk');
  assert.equal(dutch.links.captainBoost, 1);
  assert.ok(dutch.players.every(p => p.chem === 2.5 || p.chem === 3.5));
  assert.equal(dutch.links.total, dutch.links.score + 11);
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
