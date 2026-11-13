// World Cup drafts: an era and a nation per spin (two reels), era pools of ≤ 26 with no rating
// minimum, one person once across eras and versions, the three tokens (nation respin, era
// respin, Prime) and the dead-end guard — brute force over seeds, policies and Budget mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEraCatalog, loadRuntimeCatalog } from '../scripts/data/catalog-file.mjs';
import {
  createDraftSession,
  restoreDraftSession,
  SESSION_FORMAT,
  TOKENS,
  DIFFICULTIES,
} from '../app/core/draft/session.js';
import { DEFAULT_CONFIG } from '../app/core/config/config.js';
import { FORMATIONS } from '../app/core/players/formations.js';
import { overallRating } from '../app/core/players/ratings.js';
import {
  ERAS,
  ERA_SQUAD,
  eraList,
  eraNations,
  eraPool,
  personId,
  bestVersion,
} from '../app/core/players/eras.js';
import { reelWeights, nationWeight, eraWeight } from '../app/core/draft/reels.js';
import { pickOpponent } from '../app/core/draft/opponents.js';
import { baseProfileId } from '../app/core/players/legends.js';

const catalog = loadEraCatalog(),
  bare = loadRuntimeCatalog();
const shown = p => overallRating(p, true, p.primaryPosition);
const isKeeper = p => p.primaryPosition === 'GK';
const eraDraft = (options = {}) =>
  createDraftSession(catalog, { seed: 1, eras: true, primes: true, ...options });

// ---- policies ---------------------------------------------------------------------------
const positional = s => s.suggestPick();
/** The worst player the pool allows, in his first allowed slot. */
const worst = s => {
  const e = s
    .snapshot()
    .pool.filter(e => e.available)
    .at(-1);
  return { profileId: e.profileId, slot: e.best.slot };
};
/** Outfield players while any can be placed: the keeper slot is the last one left. */
const keeperLast = s => {
  const pool = s.snapshot().pool.filter(e => e.available),
    e = pool.find(e => e.position !== 'GK') ?? pool[0];
  return { profileId: e.profileId, slot: e.best.slot };
};
/** The keeper as soon as one comes up. */
const keeperFirst = s => {
  const pool = s.snapshot().pool.filter(e => e.available),
    e = pool.find(e => e.position === 'GK') ?? pool[0];
  return { profileId: e.profileId, slot: e.best.slot };
};
/** The most expensive player: fills the Budget tiers as fast as they can be filled. */
const dearest = s => {
  const pool = s.snapshot().pool.filter(e => e.available),
    e = pool.reduce((a, b) => (b.ovr > a.ovr ? b : a));
  return { profileId: e.profileId, slot: e.best.slot };
};

test('a World Cup draft spins an era, then a nation of that era: two reels, no odds to weigh', () => {
  const s = eraDraft({ seed: 5 });
  assert.equal(s.snapshot().eras, true);
  assert.equal(s.snapshot().category, 'nation');
  const spin = s.spin();
  assert.deepEqual(
    spin.reels.map(r => r.category),
    ['era', 'nation'],
  );
  const [eras, nations] = spin.reels;
  // Every era is on the reel, all equally likely.
  assert.deepEqual(
    eras.options.map(o => o.id),
    ERAS.map(e => e.id),
  );
  // Every era is on the reel with its weight (draft/reels.js): close to one in eight each.
  const weights = reelWeights(catalog);
  for (const o of eras.options) {
    assert.equal(o.weight, weights.get(o.id).weight);
    assert.ok(o.probability > 0.1 && o.probability < 0.14, `${o.name} ${o.probability}`);
  }
  assert.equal(spin.era.id, eras.options[eras.landing].id);
  // The labels are the data's (ERAS): the full one, and the short one for tight spots.
  const cycle = ERAS.find(e => e.id === spin.era.id);
  assert.deepEqual([spin.era.name, spin.era.short], [cycle.label, cycle.short]);
  assert.equal(ERAS.length, 8);
  // The nation reel is the era's nations, equally likely.
  assert.deepEqual(
    nations.options.map(o => o.id),
    eraNations(catalog, spin.era.id).map(n => n.name),
  );
  for (const o of nations.options)
    assert.ok(o.weight === 0 || o.weight === weights.get(spin.era.id).nations.get(o.id), o.id);
  assert.ok(nations.options.filter(o => o.weight > 0).length >= nations.options.length / 2);
  assert.equal(spin.option.id, nations.options[nations.landing].id);
  assert.ok(spin.option.code && spin.option.name);
  // The pool is that nation's squad of that era, as the data has it.
  const pool = eraPool(catalog, spin.era.id, spin.option.id);
  assert.deepEqual(
    s
      .snapshot()
      .pool.map(e => e.profileId)
      .sort(),
    pool.map(p => p.profileId).sort(),
  );
  assert.ok(pool.length <= ERA_SQUAD && pool.length >= 18);
  // Every row has the year of that version and its era.
  for (const e of s.snapshot().pool) {
    const era = ERAS.find(x => x.id === e.era);
    assert.equal(e.era, spin.era.id);
    assert.ok(e.year >= era.from && e.year <= era.to, `${e.name} ${e.year}`);
  }
  // History names both.
  const pick = s.suggestPick();
  assert.ok(s.pick(pick.profileId, pick.slot).ok);
  const h = s.history[0];
  assert.deepEqual(
    [h.category, h.optionId, h.era, h.eraName],
    ['nation', spin.option.id, spin.era.id, spin.era.name],
  );
  // Only Nations drafts spin eras, and they need the era data.
  assert.throws(() => eraDraft({ mode: 'leagues' }), /Only a Nations draft/);
  assert.throws(() => createDraftSession(bare, { seed: 1, eras: true }), /needs the era data/);
  assert.throws(() => createDraftSession(bare, { seed: 1, primes: true }), /needs the era data/);
});

test('eras and nations come up evenly; same seed, same spins', () => {
  const eras = new Map(),
    nations = new Map();
  const spins = seed => {
    const s = eraDraft({ seed }),
      out = [];
    while (!s.complete) {
      const spin = s.spin();
      out.push(`${spin.era.id}|${spin.option.id}`);
      const pick = s.suggestPick();
      s.pick(pick.profileId, pick.slot);
    }
    return out;
  };
  for (let seed = 1; seed <= 150; seed++)
    for (const key of spins(seed)) {
      const [era] = key.split('|');
      eras.set(era, (eras.get(era) || 0) + 1);
      nations.set(key, (nations.get(key) || 0) + 1);
    }
  // 1,650 spins over eight eras: 206 each, give or take.
  assert.equal(eras.size, 8);
  for (const [era, n] of eras) assert.ok(n > 150 && n < 265, `${era}: ${n}`);
  // No pool dominates (the largest era has 70 nations, the smallest 27).
  assert.ok(Math.max(...nations.values()) <= 20);
  assert.deepEqual(spins(77), spins(77));
  assert.notDeepEqual(spins(77), spins(78));
});

test('no rating minimum in an era pool; the other drafts keep theirs', () => {
  assert.equal(DEFAULT_CONFIG.draft.pickMinimum, 65);
  // Era pools hold players shown under 65, and a landing lists them.
  const low = [];
  for (const era of eraList(catalog))
    for (const n of era.nations) {
      const under = eraPool(catalog, era.id, n.name).filter(p => shown(p) < 65);
      if (under.length) low.push({ era: era.id, nation: n.name, under });
    }
  assert.ok(low.length > 0, 'the data has era pools with players under 65');
  const { era, nation, under } = low[0];
  const s = createDraftSession(catalog, {
    seed: 1,
    eras: true,
    schedule: { rounds: Array.from({ length: 11 }, () => ({ era, spin: nation })) },
  });
  const spin = s.spin();
  assert.deepEqual([spin.era.id, spin.option.id, spin.scheduled], [era, nation, true]);
  const pool = s.snapshot().pool;
  for (const p of under) {
    const e = pool.find(x => x.profileId === p.profileId);
    assert.ok(e && e.ovr < 65 && e.available, p.name);
  }
  assert.equal(s.pickMinimum, 0);
  // A draft of today's players is as before: nobody under 65, a nation's best 30.
  const classic = createDraftSession(catalog, { seed: 1 });
  assert.equal(classic.pickMinimum, 65);
  for (let k = 0; k < 11; k++) {
    classic.spin();
    const rows = classic.snapshot().pool;
    assert.ok(rows.length <= 30 && rows.every(e => e.ovr >= 65 && e.year === null));
    classic.pick(classic.suggestPick().profileId);
  }
});

test('one person once: across eras, versions and the Prime; excluded players stay out', () => {
  // A man who is in two era pools of his nation.
  let found = null;
  for (const era of eraList(catalog)) {
    for (const n of era.nations) {
      for (const p of eraPool(catalog, era.id, n.name)) {
        const other = eraList(catalog).find(
          e =>
            e.id !== era.id &&
            eraPool(catalog, e.id, n.name).some(q => q !== p && personId(q) === personId(p)),
        );
        if (other) {
          found = { p, era: era.id, nation: n.name, other: other.id };
          break;
        }
      }
      if (found) break;
    }
    if (found) break;
  }
  assert.ok(found);
  const twin = eraPool(catalog, found.other, found.nation).find(
    q => personId(q) === personId(found.p),
  );
  assert.notEqual(twin.profileId, found.p.profileId);
  const rounds = [
    { era: found.era, spin: found.nation },
    ...Array.from({ length: 10 }, () => ({ era: found.other, spin: found.nation })),
  ];
  const s = createDraftSession(catalog, {
    seed: 3,
    eras: true,
    primes: true,
    schedule: { rounds },
  });
  s.spin();
  assert.ok(s.pick(found.p.profileId).ok);
  s.spin();
  // His other version is not in the pool of the other era, and cannot be picked.
  assert.equal(
    s.snapshot().pool.some(e => e.profileId === twin.profileId),
    false,
  );
  assert.equal(s.available(twin), false);
  assert.equal(s.pick(twin.profileId).ok, false);
  assert.equal(s.placementOptions(twin.profileId)[0].reason, 'Already drafted');
  // The Prime does not free him either.
  const option = s.primeOptions(0)[0];
  if (option) {
    assert.ok(s.prime(option.slot, 0).ok);
    assert.equal(s.available(twin), false);
    assert.equal(s.available(found.p), false);
  }
  // Excluded by any of his ids: every version of him is out.
  for (const id of [found.p.profileId, twin.profileId, baseProfileId(twin)]) {
    const x = createDraftSession(catalog, {
      seed: 3,
      eras: true,
      schedule: { rounds },
      excludePlayers: [id],
    });
    assert.equal(x.available(found.p), false, id);
    assert.equal(x.available(twin), false, id);
  }
  // A whole draft: eleven different people, whatever is spun.
  for (let seed = 1; seed <= 40; seed++) {
    const d = eraDraft({ seed });
    while (!d.complete) {
      d.spin();
      const pick = d.suggestPick();
      d.pick(pick.profileId, pick.slot);
    }
    const xi = d.lineup(0);
    assert.equal(new Set(xi.map(personId)).size, 11);
    // The opponent never fields one of them: the run excludes their catalog ids.
    if (seed <= 5) {
      const taken = xi.map(baseProfileId),
        opponent = pickOpponent(catalog, {
          mode: 'nations',
          level: 'pro',
          seed,
          excludePlayers: taken,
        }),
        mine = new Set(xi.map(personId));
      assert.ok(opponent.players.every(p => !mine.has(personId(p))));
    }
  }
});

test('tokens: one nation respin, one era respin, one Prime on every difficulty', () => {
  assert.deepEqual(TOKENS, ['nation', 'era', 'prime']);
  assert.deepEqual(DEFAULT_CONFIG.draft.tokens, { nation: 1, era: 1, prime: 1 });
  for (const difficulty of DIFFICULTIES) {
    const s = eraDraft({ seed: 9, difficulty });
    const t = s.snapshot().tokens;
    assert.deepEqual(
      [t.nation.left, t.era.left, t.prime.left, t.nation.perSide, t.era.perSide, t.prime.perSide],
      [1, 1, 1, 1, 1, 1],
      difficulty,
    );
    // Nothing to spend before a spin (and nobody to prime before a pick).
    assert.deepEqual([t.nation.can, t.era.can, t.prime.can], [false, false, false]);
    assert.equal(s.respinBlocked('nation'), 'Spin first');
    assert.equal(s.respinBlocked('era'), 'Spin first');
    assert.throws(() => s.respin('era'), /Spin first/);
  }
});

test('nation respin: the era stays, another nation, the nation reel alone moves', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const s = eraDraft({ seed });
    const first = s.spin();
    assert.equal(s.snapshot().tokens.nation.can, true);
    const again = s.respin('nation');
    assert.equal(again.era.id, first.era.id);
    assert.notEqual(again.option.id, first.option.id);
    assert.deepEqual([again.respin, again.spun, again.reroll], ['nation', [false, true], 1]);
    // The era reel is the one that was spun; the seen nation has weight 0 on the new reel.
    assert.deepEqual(again.reels[0], first.reels[0]);
    assert.equal(again.reels[1].options.find(o => o.id === first.option.id).weight, 0);
    const t = s.snapshot().tokens;
    assert.deepEqual([t.nation.left, t.nation.can, t.era.left], [0, false, 1]);
    assert.equal(s.respinBlocked('nation'), 'No nation respin left');
    assert.throws(() => s.reroll(), /No nation respin left/);
    // The token does not come back with the next pick.
    const pick = s.suggestPick();
    s.pick(pick.profileId, pick.slot);
    s.spin();
    assert.equal(s.snapshot().tokens.nation.can, false);
    assert.equal(s.snapshot().teams[0].rerollsLeft, 0);
  }
});

test('era respin: another era; the nation stays when that era has it, else it is spun too', () => {
  let kept = 0,
    moved = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const s = eraDraft({ seed });
    const first = s.spin();
    const again = s.respin('era');
    assert.notEqual(again.era.id, first.era.id);
    assert.equal(again.reels[0].options.find(o => o.id === first.era.id).weight, 0);
    const there = eraNations(catalog, again.era.id).some(n => n.name === first.option.id);
    // The nation stays when it is on the new era's reel (there, and it can be landed on).
    const on = again.reels[1].options.find(o => o.id === first.option.id)?.weight > 0;
    assert.equal(again.kept, !!on, `${first.option.id} in ${again.era.name}`);
    if (again.kept) assert.ok(there);
    assert.deepEqual(again.spun, [true, !again.kept]);
    assert.equal(again.respin, 'era');
    if (again.kept) {
      assert.equal(again.option.id, first.option.id);
      kept++;
    } else moved++;
    assert.deepEqual(
      s
        .snapshot()
        .pool.map(e => e.profileId)
        .sort(),
      eraPool(catalog, again.era.id, again.option.id)
        .map(p => p.profileId)
        .sort(),
    );
    const t = s.snapshot().tokens;
    assert.deepEqual([t.era.left, t.era.can, t.nation.left, t.nation.can], [0, false, 1, true]);
    assert.equal(s.respinBlocked('era'), 'No era respin left');
    // Both tokens in one round: the nation respin now works in the new era.
    const third = s.respin('nation');
    assert.equal(third.era.id, again.era.id);
    assert.notEqual(third.option.id, again.option.id);
    assert.equal(third.reroll, 2);
  }
  assert.ok(kept > 20 && moved > 3, `kept ${kept}, moved ${moved}`);
  // Versus: each side has its own tokens.
  const pvp = eraDraft({ seed: 4, sides: 2 });
  const side = pvp.turn;
  pvp.spin();
  pvp.respin('era');
  pvp.respin('nation');
  pvp.pick(pvp.suggestPick().profileId);
  assert.deepEqual([pvp.eraRespinsLeft[side], pvp.eraRespinsLeft[1 - side]], [0, 1]);
  assert.deepEqual([pvp.rerollsLeft[side], pvp.rerollsLeft[1 - side]], [0, 1]);
  pvp.spin();
  assert.equal(pvp.snapshot().tokens.era.can, true);
});

test('the Prime: a drafted player becomes his best version across all titles, once', () => {
  let used = 0,
    gains = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const s = eraDraft({ seed });
    while (!s.complete) {
      s.spin();
      const pick = s.suggestPick();
      s.pick(pick.profileId, pick.slot);
    }
    const before = s.lineup(0),
      options = s.primeOptions(0);
    // Exactly the players a better version exists for, and it is bestVersion's card.
    assert.deepEqual(
      options.map(o => o.slot),
      before.flatMap((p, i) => (bestVersion(catalog, p) ? [i] : [])),
    );
    assert.equal(s.snapshot().tokens.prime.can, options.length > 0);
    if (!options.length) continue;
    const o = options.reduce((a, b) => (b.to.ovr - b.from.ovr > a.to.ovr - a.from.ovr ? b : a)),
      best = bestVersion(catalog, before[o.slot]);
    assert.equal(o.to.profileId, best.profileId);
    assert.equal(o.to.ovr, shown(best));
    assert.ok(o.to.ovr > o.from.ovr, 'any gain, never less');
    assert.equal(o.to.year, best.year ?? 2026);
    // The marks are the card's own (the sheet says when a Captain would give up the armband).
    assert.deepEqual([o.to.goat, o.to.captain], [!!best.goat, !!best.captain]);
    assert.equal(o.allowed, true);
    const result = s.prime(o.slot, 0);
    assert.deepEqual(
      [result.ok, result.profileId, result.primeOf],
      [true, best.profileId, before[o.slot].profileId],
    );
    used++;
    gains += o.to.ovr - o.from.ovr;
    const after = s.lineup(0);
    assert.equal(after[o.slot], best);
    assert.equal(personId(after[o.slot]), personId(before[o.slot]));
    assert.equal(new Set(after.map(personId)).size, 11);
    const slot = s.snapshot().teams[0].slots[o.slot];
    assert.equal(slot.player.prime, true);
    assert.equal(slot.prime, null, 'his best version has no better one');
    assert.equal(s.history.find(h => h.profileId === best.profileId).primeOf, o.profileId);
    // One use: every other option is closed, and prime() refuses.
    const t = s.snapshot().tokens.prime;
    assert.deepEqual([t.left, t.can], [0, false]);
    for (const rest of s.primeOptions(0))
      assert.deepEqual([rest.allowed, rest.reason], [false, 'No Prime left']);
    const other = s.primeOptions(0)[0];
    if (other) assert.equal(s.prime(other.slot, 0).ok, false);
    assert.equal(s.prime(o.slot, 0).reason, 'No better version');
    // It survives a reload and goes into the match side as that card.
    const again = restoreDraftSession(catalog, JSON.parse(JSON.stringify(s.serialize())));
    assert.deepEqual(again.snapshot(), s.snapshot());
    assert.equal(again.matchSide(0).players[o.slot].profileId, best.profileId);
  }
  assert.ok(used >= 35, `the Prime was usable in ${used} of 40 drafts`);
  assert.ok(gains / used >= 2, `mean gain ${gains / used}`);
  // A draft without the Prime offers none.
  const plain = createDraftSession(catalog, { seed: 2, eras: true });
  plain.spin();
  plain.pick(plain.suggestPick().profileId);
  assert.equal(plain.snapshot().tokens.prime, null);
  assert.deepEqual(plain.primeOptions(0), []);
  assert.equal(plain.snapshot().pool.length, 0);
});

const keeperThere = (s, era, nation, side) =>
  eraPool(catalog, era, nation).some(p => isKeeper(p) && s.available(p) && s.affordable(p, side));
// Keepers of most pools, to leave many nations without one (a pool may have no keeper at all).
const keeperless = share => {
  const ids = [];
  let k = 0;
  for (const era of eraList(catalog))
    for (const n of era.nations)
      if (k++ % 100 < share * 100)
        for (const p of eraPool(catalog, era.id, n.name)) if (isKeeper(p)) ids.push(p.profileId);
  return ids;
};
const BARE = keeperless(0.7);
// Every era + nation the reels could land on has a pick: somebody available, affordable, for an
// open slot class. Checked against the pools themselves, not the session's own guard.
function assertHonest(s, spin, label) {
  const side = spin.side,
    open = s.openClasses(side),
    fills = (era, nation) =>
      eraPool(catalog, era, nation).some(
        p => (isKeeper(p) ? open.gk : open.out) && s.available(p) && s.affordable(p, side),
      );
  const [eras, nations] = spin.reels,
    live = nations.options.filter(o => o.weight > 0);
  for (const o of live) assert.ok(fills(spin.era.id, o.id), `${label}: ${o.id} ${spin.era.name}`);
  // The keeper slot is open: at least half of the nations on the reel have a keeper to pick
  // (only the keeper slot left: all of them, by the line above).
  if (open.gk) {
    const withKeeper = live.filter(o => keeperThere(s, spin.era.id, o.id, side)).length;
    assert.ok(withKeeper * 2 >= live.length, `${label}: ${withKeeper} of ${live.length} keepers`);
    if (!open.out) assert.equal(withKeeper, live.length, label);
  }
  if (spin.spun?.[0] === false) return;
  for (const e of eras.options) {
    const any = eraNations(catalog, e.id).some(n => fills(e.id, n.name));
    if (e.weight > 0) assert.ok(any, `${label}: ${e.name} has no pick`);
  }
}

test('never a dead end: every landing has a pick, whatever was drafted (brute force)', () => {
  const policies = { positional, worst, keeperLast, keeperFirst, dearest };
  let spins = 0,
    keeperOnly = 0,
    closed = 0;
  for (const budget of [false, true])
    for (const [name, policy] of Object.entries(policies))
      for (let seed = 1; seed <= 30; seed++) {
        const formation = Object.keys(FORMATIONS)[seed % Object.keys(FORMATIONS).length],
          s = eraDraft({
            seed: seed * 7 + (budget ? 1000 : 0),
            budget,
            formation,
            uniqueNations: seed % 5 === 0,
            difficulty: DIFFICULTIES[seed % 3],
            // Every third draft: seven pools in ten have no keeper.
            excludePlayers: seed % 3 === 0 ? BARE : [],
          }),
          label = `${name} ${budget ? 'budget ' : ''}seed ${seed}`;
        let round = 0;
        while (!s.complete) {
          let spin = s.spin();
          spins++;
          if (seed % 4 === 0 || seed % 3 === 0) assertHonest(s, spin, label);
          // Tokens at awkward moments: late in the draft, when little is open.
          if (round === 6 + (seed % 5) && s.snapshot().tokens.era.can) {
            spin = s.respin('era');
            assertHonest(s, spin, label + ' era respin');
          }
          if (round === 9 && s.snapshot().tokens.nation.can) {
            spin = s.respin('nation');
            assertHonest(s, spin, label + ' nation respin');
          }
          const snap = s.snapshot(),
            open = s.openClasses(),
            can = snap.pool.filter(e => e.available);
          assert.ok(can.length > 0, `${label}: nothing to pick in ${spin.option.id}`);
          assert.ok(snap.pool.length <= ERA_SQUAD);
          if (!open.out) {
            keeperOnly++;
            assert.ok(can.every(e => e.position === 'GK'));
          }
          if (snap.pool.some(e => !e.available)) closed++;
          const pick = policy(s);
          const result = s.pick(pick.profileId, pick.slot);
          assert.ok(result.ok, `${label}: ${result.reason}`);
          round++;
        }
        assert.equal(new Set(s.lineup(0).map(personId)).size, 11, label);
        if (budget)
          for (const band of s.snapshot().teams[0].budget)
            assert.ok(band.used <= band.slots, `${label}: ${band.label}`);
      }
  assert.equal(spins, 2 * 5 * 30 * 11);
  assert.ok(keeperOnly >= 30, `keeper-only rounds: ${keeperOnly}`);
  assert.ok(closed > 100, `spins with a closed row: ${closed}`);
});

test('Budget mode in an era draft: tiers by the shown rating of the era card, the Prime is free', () => {
  const tiers = DEFAULT_CONFIG.draft.budget;
  for (let seed = 1; seed <= 25; seed++) {
    const s = eraDraft({ seed, budget: true });
    while (!s.complete) {
      s.spin();
      for (const e of s.snapshot().pool) {
        const band =
          e.ovr >= tiers.Superstar.minimum
            ? 'superstar'
            : e.ovr >= tiers.Star.minimum
              ? 'star'
              : e.ovr >= tiers.Starter.minimum
                ? 'starter'
                : null;
        assert.equal(e.band, band, `${e.name} ${e.ovr}`);
      }
      const pick = dearest(s);
      assert.ok(s.pick(pick.profileId, pick.slot).ok);
    }
    const used = () => s.snapshot().teams[0].budget.map(b => b.used);
    const before = used(),
      option = s
        .primeOptions(0)
        .find(o => o.to.tier !== s.snapshot().teams[0].slots[o.slot].player.tier);
    if (!option) continue;
    // A Prime that lifts him a tier is allowed, and he keeps the slot he was drafted on.
    assert.equal(option.allowed, true);
    assert.ok(s.prime(option.slot, 0).ok);
    assert.deepEqual(used(), before);
    const again = restoreDraftSession(catalog, JSON.parse(JSON.stringify(s.serialize())));
    assert.deepEqual(
      again.snapshot().teams[0].budget.map(b => b.used),
      before,
    );
  }
});

test('serialize/restore: mid-spin, after respins, with era cards; one format', () => {
  assert.equal(SESSION_FORMAT, 3);
  for (let seed = 1; seed <= 6; seed++) {
    const a = eraDraft({ seed, budget: seed % 2 === 0 });
    for (let k = 0; k < 4; k++) {
      a.spin();
      a.pick(a.suggestPick().profileId);
    }
    a.spin();
    a.respin('era');
    const saved = JSON.parse(JSON.stringify(a.serialize()));
    assert.equal(saved.format, 3);
    assert.equal(saved.options.eras, true);
    assert.ok(saved.state.picks[0].some(id => /^ea:\d+:fc\d+:era$/.test(id)) || seed > 0);
    const b = restoreDraftSession(catalog, saved);
    assert.deepEqual(b.snapshot(), a.snapshot());
    for (const s of [a, b]) {
      s.respin('nation');
      while (!s.complete) {
        if (!s.current) s.spin();
        const pick = s.suggestPick();
        s.pick(pick.profileId, pick.slot);
      }
    }
    assert.deepEqual(b.serialize(), a.serialize());
    // Without the era data the save cannot be read.
    assert.throws(() => restoreDraftSession(bare, saved), /needs the era data/);
  }
  // A draft of the format before (the Legend spin, re-rolls by difficulty) is not a saved draft.
  const current = eraDraft({ seed: 1 }).serialize();
  for (const format of [2, 1, undefined])
    assert.throws(() => restoreDraftSession(catalog, { ...current, format }), /Not a saved draft/);
  const broken = eraDraft({ seed: 1 }).serialize();
  broken.state.picks[0][3] = 'ea:1:fc19:legend';
  assert.throws(() => restoreDraftSession(catalog, broken), /does not match/);
});

test('a schedule fixes the spins and what the respins land on (the Daily)', () => {
  const eras = eraList(catalog),
    a = eras[2],
    b = eras[5],
    shared = a.nations.find(n => b.nations.some(x => x.name === n.name)).name,
    onlyA = a.nations.find(n => !b.nations.some(x => x.name === n.name)).name,
    other = a.nations.find(n => n.name !== shared && n.name !== onlyA).name,
    inB = b.nations.find(n => n.name !== shared).name;
  const rounds = Array.from({ length: 11 }, (_, i) => ({
    era: a.id,
    spin: i % 2 ? onlyA : shared,
    alternate: other,
    eraAlternate: { era: b.id, nation: i % 2 ? inB : shared },
  }));
  const draft = seed => createDraftSession(catalog, { seed, eras: true, schedule: { rounds } });
  for (const seed of [1, 2, 99]) {
    // Round 1: the scheduled spin, then the nation respin lands on the alternate.
    const s = draft(seed);
    let spin = s.spin();
    assert.deepEqual([spin.era.id, spin.option.id, spin.scheduled], [a.id, shared, true]);
    spin = s.respin('nation');
    assert.deepEqual([spin.era.id, spin.option.id, spin.scheduled], [a.id, other, true]);
    s.pick(s.suggestPick().profileId);
    // Round 2: a nation the other era does not have: the era respin lands on the scheduled pair.
    spin = s.spin();
    assert.deepEqual([spin.era.id, spin.option.id], [a.id, onlyA]);
    spin = s.respin('era');
    assert.deepEqual(
      [spin.era.id, spin.option.id, spin.kept, spin.scheduled],
      [b.id, inB, false, true],
    );
    // An era respin that keeps the nation.
    const t = draft(seed);
    t.spin();
    spin = t.respin('era');
    assert.deepEqual([spin.era.id, spin.option.id, spin.kept], [b.id, shared, true]);
  }
  // Whatever the seed, the spins are the schedule's: the same for everyone.
  const x = draft(5),
    y = draft(6);
  for (let k = 0; k < 11; k++) {
    assert.deepEqual(x.spin().option, y.spin().option);
    x.pick(x.suggestPick().profileId);
    y.pick(y.suggestPick().profileId);
  }
});

test('keepers: pools without one are fine, but half the reel has a keeper while yours is open', () => {
  // Seven pools in ten without a keeper: the reel drops keeper-less nations until half of what
  // is left has one — the strongest keeper-less nations stay (the reel's order).
  const s = eraDraft({ seed: 11, excludePlayers: BARE });
  let restricted = 0;
  while (!s.complete) {
    const spin = s.spin(),
      side = spin.side,
      open = s.openClasses(side),
      options = spin.reels[1].options,
      live = options.filter(o => o.weight > 0),
      has = o => keeperThere(s, spin.era.id, o.id, side);
    if (open.gk && open.out) {
      const keepers = options.filter(has),
        bare = options.filter(o => !has(o));
      // Every nation with a keeper is on the reel, and exactly as many keeper-less ones as
      // that allows: the first of them.
      assert.ok(keepers.every(o => o.weight > 0));
      assert.deepEqual(
        live.filter(o => !has(o)).map(o => o.id),
        bare.slice(0, keepers.length).map(o => o.id),
      );
      if (bare.length > keepers.length) restricted++;
      // Outfield players first: the keeper slot stays open as long as it can.
      const e = s.snapshot().pool.find(e => e.available && e.position !== 'GK');
      assert.ok(s.pick(e.profileId, e.best.slot).ok);
    } else {
      // Only the keeper slot left: every nation on the reel has a keeper, and so has the era.
      assert.ok(open.gk && !open.out);
      assert.ok(live.length > 0 && live.every(has));
      const e = s.snapshot().pool.find(e => e.available);
      assert.equal(e.position, 'GK');
      assert.ok(s.pick(e.profileId, e.best.slot).ok);
    }
  }
  assert.ok(restricted >= 8, `restricted reels: ${restricted}`);
  // With the keeper drafted the rule is off: keeper-less nations are all back.
  const t = eraDraft({ seed: 12, excludePlayers: BARE });
  for (;;) {
    t.spin();
    const e = t.snapshot().pool.find(e => e.available && e.position === 'GK');
    if (e) {
      t.pick(e.profileId, e.best.slot);
      break;
    }
    t.pick(t.suggestPick().profileId);
  }
  const spin = t.spin();
  assert.ok(spin.reels[1].options.every(o => o.weight >= 1));
  // Both respins keep to it.
  for (let seed = 1; seed <= 20; seed++) {
    const d = eraDraft({ seed, excludePlayers: BARE });
    d.spin();
    assertHonest(d, d.respin('era'), `respin ${seed}`);
    assertHonest(d, d.respin('nation'), `respin ${seed}`);
  }
});

test('reel weights: deep, famous squads come up more, nobody is shut out, all-timers stay rare', () => {
  const rules = DEFAULT_CONFIG.draft.reels,
    weights = reelWeights(catalog),
    ratings = (era, nation) =>
      eraPool(catalog, era, nation)
        .map(shown)
        .sort((a, b) => b - a);
  let total = 0,
    allTimer = 0,
    ninety = 0;
  for (const era of eraList(catalog)) {
    const w = weights.get(era.id);
    // An era: a slight bump, never more than a few points of share.
    assert.ok(w.weight >= 1 && w.weight <= 1 + rules.era.nations + rules.era.top);
    assert.equal(w.nations.size, era.nations.length);
    const sum = [...w.nations.values()].reduce((a, b) => a + b, 0);
    for (const n of era.nations) {
      const weight = w.nations.get(n.name),
        r = ratings(era.id, n.name);
      // Every spinnable nation can come up; the best squad is a few times likelier, not more.
      assert.ok(weight >= 1 && weight <= 1 + rules.nation.lift, `${n.name} ${weight}`);
      assert.equal(
        weight,
        nationWeight(
          r,
          rules,
          eraPool(catalog, era.id, n.name).some(p => p.goat),
        ),
      );
      const p = (w.weight / 1) * (weight / sum);
      total += p;
      if (r[0] >= 93) allTimer += p;
      if (r[0] >= 90) ninety += p;
    }
    const list = [...w.nations.values()];
    assert.ok(Math.max(...list) / Math.min(...list) < 6, String(era.id));
  }
  // The owner's rough targets, per draft of eleven spins: an all-timer's squad about once every
  // 5–10 drafts, a 90+ player on offer in one to three spins.
  const perSpin = allTimer / total,
    drafts = 1 / (1 - (1 - perSpin) ** 11);
  assert.ok(drafts >= 5 && drafts <= 10, `an all-timer every ${drafts} drafts`);
  const spins = (11 * ninety) / total;
  assert.ok(spins >= 1 && spins <= 3, `90+ in ${spins} spins`);
  // The formula: depth counts more than one star; size counts; an all-timer costs most of the lift.
  const squad = (top, rest, n = 26) => [...top, ...Array(n - top.length).fill(rest)];
  const deep = nationWeight(squad([88, 88, 87, 86], 80)),
    oneStar = nationWeight(squad([92, 78, 77, 76], 72)),
    nobody = nationWeight(squad([74, 73, 72, 72], 68)),
    small = nationWeight(squad([88, 88, 87, 86], 80, 18)),
    goat = nationWeight(squad([94, 88, 87, 86], 80));
  assert.ok(deep > oneStar && oneStar > nobody && nobody >= 1);
  assert.ok(small < deep && goat < deep && goat > nobody);
  // A squad with a GOAT card is an all-timer's squad whatever he shows that year.
  const marked = nationWeight(squad([92, 88, 87, 86], 80), rules, true);
  assert.equal(marked, goat);
  assert.ok(marked < nationWeight(squad([92, 88, 87, 86], 80)));
  assert.ok(eraWeight(70, 85) > eraWeight(27, 80) && eraWeight(0, 0) === 1);
  // The session draws by them — respins too — and the guards only ever zero a weight.
  const s = eraDraft({ seed: 31 });
  for (const spin of [s.spin(), s.respin('era'), s.respin('nation')]) {
    const w = weights.get(spin.era.id);
    for (const o of spin.reels[1].options)
      assert.ok(o.weight === 0 || o.weight === w.nations.get(o.id));
    for (const o of spin.reels[0].options)
      assert.ok(o.weight === 0 || o.weight === weights.get(o.id).weight);
  }
  // A session saved with other weights keeps them (rules are snapshotted).
  assert.deepEqual(s.rules.reels, rules);
});
