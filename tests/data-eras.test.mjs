import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { loadRuntimeCatalog } from '../scripts/data/catalog-file.mjs';
import { PATHS, MODERN_SOURCES } from '../scripts/data/paths.mjs';
import { decodeEras, encodeEras, ERAS_FORMAT } from '../app/core/players/eras-codec.js';
import {
  ERAS,
  ERA_SQUAD,
  CURRENT_ERA,
  eraById,
  eraOfYear,
  attachEras,
  eraList,
  eraNations,
  eraPool,
  eraPlayer,
  eraOf,
  eraMarks,
  personId,
  personVersions,
  bestVersion,
} from '../app/core/players/eras.js';
import {
  attachLegends,
  baseProfileId,
  editionLabel,
  primeVersion,
} from '../app/core/players/legends.js';
import { decodeLegends, catalogIds } from '../app/core/players/legends-codec.js';
import { overallRating, POSITIONS } from '../app/core/players/ratings.js';
import { normalizeBadges } from '../app/core/players/badges.js';
import { badgeStamp } from '../app/core/players/catalog-derived.js';
import { LINE_OF } from '../app/core/draft/pools.js';

const text = readFileSync(PATHS.eras, 'utf8'),
  file = JSON.parse(text),
  data = decodeEras(file),
  catalog = attachEras(await loadRuntimeCatalog(), decodeEras(file)),
  shown = p => overallRating(p, true, p.primaryPosition),
  pool = (era, nation) => eraPool(catalog, era, nation),
  named = (era, nation, name) => pool(era, nation).find(p => p.name === name);

test('eras are World Cup cycles: eight of them, 1997–2026, static', () => {
  assert.deepEqual(
    ERAS.map(e => [e.id, e.label, e.from, e.to]),
    [
      [1998, 'France 98', 1997, 1998],
      [2002, 'Korea/Japan 02', 1999, 2002],
      [2006, 'Germany 06', 2003, 2006],
      [2010, 'South Africa 10', 2007, 2010],
      [2014, 'Brazil 14', 2011, 2014],
      [2018, 'Russia 18', 2015, 2018],
      [2022, 'Qatar 22', 2019, 2022],
      [2026, 'USA/Canada/Mexico 26', 2023, 2026],
    ],
  );
  // Every era is named by its hosts; the short label (reels, chips) abbreviates only 2026's
  // and never runs past 15 characters.
  for (const e of ERAS) {
    assert.ok(e.short.length <= 15, e.short);
    assert.equal(e.short === e.label, e.id !== 2026, e.label);
  }
  assert.equal(eraById(2026).short, 'USA/CAN/MEX 26');
  assert.equal(CURRENT_ERA, 2026);
  assert.equal(ERA_SQUAD, 26);
  for (let year = 1997; year <= 2026; year++) assert.ok(eraOfYear(year), String(year));
  assert.equal(eraOfYear(1996), null);
  assert.equal(eraOfYear(2002).id, 2002);
  assert.equal(eraOfYear(2003).id, 2006);
  assert.equal(eraById('2010').label, 'South Africa 10');
  assert.equal(eraById(2000), null);
});

test('the eras file is built for this catalog, round-trips and stays small', () => {
  assert.equal(file.format, ERAS_FORMAT);
  assert.equal(file.version, 1);
  assert.equal(file.catalog.ids, catalogIds(catalog));
  assert.deepEqual(file.precomputed, { badges: badgeStamp() });
  assert.deepEqual(
    file.eras.map(({ keeperLevel, ...era }) => era),
    ERAS,
  );
  assert.deepEqual(
    file.sources.modern.map(m => [m.edition, m.sha256]),
    MODERN_SOURCES.map(m => [m.edition, m.sha256]),
  );
  assert.equal(JSON.stringify(encodeEras(data)) + '\n', text);
  // One lazily fetched file for all eras (a draft needs them all): about 2.4 MB, 0.7 MB on
  // the wire.
  assert.ok(text.length < 2_750_000, 'raw: ' + text.length);
  const gzip = gzipSync(Buffer.from(text), { level: 9 }).length;
  assert.ok(gzip < 780_000, 'gzip: ' + gzip);
  // Without eras attached every accessor answers "nothing".
  const bare = { players: [] };
  assert.deepEqual(eraList(bare), []);
  assert.deepEqual(eraPool(bare, 2002, 'Brazil'), []);
  assert.equal(eraPlayer(bare, 'x'), null);
  assert.equal(bestVersion(bare, catalog.players[0]), null);
  assert.equal(attachEras(catalog, data), catalog); // idempotent
});

test('every era has 20–70 nations that can field a pool — with or without a keeper — strongest first', () => {
  const list = eraList(catalog);
  assert.deepEqual(
    list.map(e => e.id),
    ERAS.map(e => e.id),
  );
  const counts = list.map(e => e.nations.length);
  // The early titles know fewer nations: France 98 is the thinnest, and stands on its own.
  assert.deepEqual(counts, [51, 65, 65, 70, 70, 70, 70, 70]);
  // A side a follower would look for is there: Chile, Paraguay and Colombia in 1998, the hosts
  // of 2002.
  for (const [era, nation] of [
    [1998, 'Chile'],
    [1998, 'Paraguay'],
    [1998, 'Colombia'],
    [2002, 'Japan'],
    [2002, 'Korea Republic'],
  ])
    assert.ok(
      eraNations(catalog, era).some(n => n.name === nation),
      `${era} ${nation}`,
    );
  // A goalkeeper is not required: seventeen pools have none, and `keepers` says so.
  assert.deepEqual(
    list.map(e => e.nations.filter(n => n.keepers === 0).map(n => n.name)),
    [
      ['Ghana', 'Uruguay'],
      ['Georgia', 'Ghana', 'Guinea'],
      ['Guinea', 'Burkina Faso'],
      ['Mali', 'Peru', 'Guinea', 'Algeria', 'Honduras', 'Burkina Faso', 'Congo DR'],
      ['Honduras'],
      [],
      ['Gabon'],
      ['Egypt'],
    ],
  );
  const codes = new Map(catalog.nations.map(n => [n.name, n.code]));
  for (const era of list) {
    assert.equal(eraNations(catalog, era.id), era.nations);
    // What a pool without a keeper is rated with in goal: the weakest first-choice keeper of
    // the era's pools.
    const firsts = era.nations
      .filter(n => n.keepers)
      .map(n => shown(pool(era.id, n.name).find(p => p.primaryPosition === 'GK')));
    assert.ok(era.keeperLevel <= Math.min(...firsts) && era.keeperLevel >= 50, era.label);
    for (let i = 1; i < era.nations.length; i++)
      assert.ok(era.nations[i - 1].strength >= era.nations[i].strength);
    for (const n of era.nations) {
      const players = pool(era.id, n.name);
      assert.equal(n.code, codes.get(n.name), n.name);
      assert.ok(n.flag.endsWith(`${n.code}.svg`));
      assert.equal(n.size, players.length);
      assert.equal(n.keepers, players.filter(p => p.primaryPosition === 'GK').length);
      // The spin rule: a team with a bench — four defenders, five midfielders (a forward
      // beyond the first four counts as one), two forwards among at least 18 — and never more
      // than a World Cup squad. No keeper needed.
      assert.ok(n.size >= 18 && n.size <= ERA_SQUAD, `${era.label} ${n.name}: ${n.size}`);
      assert.ok(n.keepers >= 0 && n.keepers <= 3, `${era.label} ${n.name}`);
      const lines = { DEF: 0, MID: 0, ATT: 0, GK: 0 };
      for (const p of players) lines[LINE_OF[p.primaryPosition]]++;
      assert.ok(
        lines.DEF >= 4 && lines.MID + Math.max(0, lines.ATT - 4) >= 4 && lines.ATT >= 1,
        `${era.label} ${n.name}`,
      );
      // Strength: the mean shown rating of the best XI (best keeper + ten best outfielders;
      // without a keeper, the era's keeper level in goal).
      const keeper = players.find(p => p.primaryPosition === 'GK'),
        ten = players.filter(p => p.primaryPosition !== 'GK').slice(0, 10),
        sum = (keeper ? shown(keeper) : era.keeperLevel) + ten.reduce((s, p) => s + shown(p), 0);
      assert.equal(n.strength, Math.round((sum / 11) * 10) / 10, `${era.label} ${n.name}`);
      assert.ok(Object.isFrozen(players) && pool(era.id, n.name) === players);
    }
  }
  assert.deepEqual(eraNations(catalog, 1990), []);
  assert.deepEqual(pool(1998, 'Japan'), []); // not spinnable then
  assert.ok(['England', 'Italy', 'France'].includes(list[0].nations[0].name));
  assert.ok(list[1].nations.slice(0, 3).some(n => n.name === 'Brazil'));
  assert.equal(list.at(-1).nations[0].name, 'France');
  for (const name of ['Brazil', 'Italy', 'Germany', 'Argentina', 'France', 'Netherlands'])
    for (const era of list) assert.ok(pool(era.id, name).length === ERA_SQUAD, name);
});

test('a pool: the nation’s best 26 of the era, each at his best version inside it', () => {
  const badges = new Set(file.dictionaries.badges),
    teams = new Map(catalog.teams.map(t => [t.id, t])),
    ids = new Set();
  let cards = 0,
    today = 0;
  for (const era of eraList(catalog))
    for (const n of era.nations) {
      const players = pool(era.id, n.name),
        people = new Set(players.map(personId));
      assert.equal(people.size, players.length, `${era.label} ${n.name}: one man once`);
      for (let i = 1; i < players.length; i++)
        assert.ok(shown(players[i - 1]) >= shown(players[i]), `${era.label} ${n.name}`);
      for (const p of players) {
        assert.equal(p.source.nationality, n.name);
        assert.equal(eraOf(p), era.id);
        assert.match(personId(p), /^ea:\d+$/);
        if (!p.era) {
          // Today's catalog player, as he is: only in the 2026 era.
          today++;
          assert.equal(era.id, CURRENT_ERA);
          assert.equal(catalog.byId.get(p.profileId), p);
          assert.equal(baseProfileId(p), p.profileId);
          continue;
        }
        cards++;
        assert.ok(!ids.has(p.profileId) || era.id !== p.era);
        ids.add(p.profileId);
        assert.match(p.profileId, /^ea:\d+:fc(9[89]|\d|1\d|2[0-6]):era$/);
        assert.equal(eraPlayer(catalog, p.profileId), p);
        assert.equal(p.era, era.id);
        assert.ok(p.year >= era.from && p.year <= era.to, `${p.name} ’${p.year}`);
        assert.equal(p.person, `ea:${p.profileId.split(':')[1]}`);
        assert.ok(typeof p.captain === 'boolean' && typeof p.goat === 'boolean');
        assert.ok(!(p.captain && p.goat), `${p.name}: a GOAT or a Captain, never both`);
        // The card shows the overall of that version on the common scale.
        assert.equal(shown(p), p.sourceOverall, p.profileId);
        assert.doesNotMatch(p.name, /^no\.?\s*\d+$/i);
        assert.ok(POSITIONS.includes(p.primaryPosition));
        assert.ok(p.tags.every(t => badges.has(t)));
        assert.deepEqual(Object.keys(p.attrs), catalog.attributeKeys);
        if (p.source.clubId == null) assert.equal(p.source.club, null);
        else assert.equal(p.source.club, teams.get(p.source.clubId).name);
        if (p.eraOf) {
          // A man who is in the catalog: his name, and one identity with today's card.
          const now = catalog.byId.get(p.eraOf);
          assert.deepEqual([p.name, p.fullName], [now.name, now.fullName]);
          assert.equal(baseProfileId(p), now.profileId);
          assert.equal(personId(p), personId(now));
          assert.equal(p.source.nationality, now.source.nationality);
        } else assert.equal(baseProfileId(p), p.profileId);
      }
    }
  assert.ok(cards > 9000 && today > 700, `${cards} cards, ${today} of today`);
  // Badges are normalised for today's configuration (spot check: the whole file is 12,000).
  for (const p of data.cards.slice(0, 400))
    assert.deepEqual(normalizeBadges(p, p.tags), p.tags, p.profileId);
  // No minimum rating: a small nation's pool goes down to the 50s and 60s.
  assert.ok(Math.min(...pool(2010, 'Burkina Faso').map(shown)) < 62);
  // Era cards never join the catalog's pools.
  assert.ok(!catalog.players.some(p => p.era));
});

test('GOATs and Captains: the reviewed lists, player + era, are the marks on the pools’ cards', () => {
  const goats = JSON.parse(readFileSync(PATHS.goats, 'utf8')),
    captains = JSON.parse(readFileSync(PATHS.captains, 'utf8')),
    marks = eraMarks(catalog),
    keys = list => list.map(m => `${m.era} ${m.nation} ${personId(m.player)}`).sort(),
    want = players =>
      players.flatMap(p => p.eras.map(era => `${era} ${p.nation} ea:${p.sofifaId}`)).sort();
  // 3–10 GOATs; every listed player + era is a marked card, and nobody else is.
  assert.ok(goats.players.length >= 3 && goats.players.length <= 10);
  assert.deepEqual(keys(marks.goats), want(goats.players));
  assert.ok(captains.size >= 20 && captains.size <= captains.players.length);
  assert.deepEqual(keys(marks.captains), want(captains.players.slice(0, captains.size)));
  assert.equal(eraMarks(catalog), marks);
  // One list per player, whatever the cut; each entry says why.
  const goatIds = new Set(goats.players.map(p => p.sofifaId));
  for (const [i, p] of captains.players.entries()) {
    assert.equal(p.rank, i + 1);
    assert.ok(!goatIds.has(p.sofifaId), `${p.name} is a GOAT`);
  }
  for (const p of [...goats.players, ...captains.players]) {
    assert.ok(p.reason.length > 15 && p.eras.every(eraById), p.name);
    assert.deepEqual(
      p.eras,
      [...p.eras].sort((a, b) => a - b),
    );
  }
  // The marks are on the cards the pools hold (and a GOAT only in the listed eras).
  const card = (era, nation, name) => pool(era, nation).find(p => p.name === name);
  assert.equal(card(2014, 'Argentina', 'L. Messi').goat, true);
  assert.equal(card(2006, 'Argentina', 'L. Messi').goat, false);
  assert.ok(!card(2026, 'Argentina', 'L. Messi').goat);
  assert.equal(card(1998, 'Brazil', 'Ronaldo').goat, true);
  assert.equal(card(2006, 'Brazil', 'Ronaldinho').goat, true);
  assert.equal(card(2002, 'Brazil', 'Ronaldinho').goat, false);
  assert.equal(card(1998, 'Italy', 'P. Maldini').captain, true);
  assert.equal(card(1998, 'Italy', 'P. Maldini').goat, false);
  assert.equal(card(2010, 'Italy', 'P. Maldini')?.captain ?? false, false);
  // Today's Captains are the list's players who lead in 2026: no other catalog player is one.
  const today = captains.players
    .slice(0, captains.size)
    .filter(p => p.eras.includes(CURRENT_ERA))
    .map(p => p.sofifaId)
    .sort((a, b) => a - b);
  assert.deepEqual(
    catalog.players
      .filter(p => p.captain)
      .map(p => Number(personId(p).split(':')[1]))
      .sort((a, b) => a - b),
    today,
  );
  assert.ok(today.length >= 3);
  assert.ok(catalog.players.every(p => !p.goat));
  // Every era has Captains to meet; GOATs are rare.
  for (const era of ERAS.slice(0, -1))
    assert.ok(marks.captains.filter(m => m.era === era.id).length >= 5, era.label);
  assert.ok(marks.goats.length >= 5 && marks.goats.length <= 30);
  // A file from before the marks still decodes: nobody is marked.
  const { mark, ...rest } = file.cards;
  assert.equal(mark.length, file.cards.count);
  assert.ok(decodeEras({ ...file, cards: rest }).cards.every(p => !p.goat && !p.captain));
});

test('the pools read like football', () => {
  const top = (era, nation, n = 3) =>
    pool(era, nation)
      .slice(0, n)
      .map(p => p.name);
  assert.ok(top(2002, 'Brazil', 6).includes('Ronaldo'));
  assert.ok(top(2002, 'Brazil', 6).includes('Rivaldo'));
  assert.ok(top(2002, 'France', 3).includes('Z. Zidane'));
  assert.ok(top(1998, 'France', 5).includes('Z. Zidane'));
  assert.equal(top(2006, 'Brazil', 1)[0], 'Ronaldinho');
  assert.equal(top(2014, 'Argentina', 1)[0], 'L. Messi');
  assert.equal(top(2018, 'Portugal', 1)[0], 'Cristiano Ronaldo');
  assert.equal(top(2010, 'Spain', 1)[0], 'Casillas');
  // One man, a card per era he played in — the same person everywhere.
  const eras = [2002, 2006, 2010].map(era => named(era, 'Brazil', 'Ronaldinho'));
  assert.ok(eras.every(Boolean));
  assert.equal(new Set(eras.map(personId)).size, 1);
  assert.deepEqual(
    eras.map(p => p.era),
    [2002, 2006, 2010],
  );
  assert.deepEqual(
    personVersions(catalog, eras[0]).map(p => p.era),
    [2002, 2006, 2010, 2014], // and the Ronaldinho of Atlético Mineiro
  );
  // Keepers of the early years are there too (FIFA 98/99 have no keeper skills: they are
  // rated with the titles around them).
  assert.equal(pool(1998, 'Denmark').find(p => p.primaryPosition === 'GK').name, 'P. Schmeichel');
  // Messi is in six Argentina pools, from the boy of 2005 on; his 2026 card is FC 24's (it
  // shows more than today's), one person with the catalog player.
  const messi = ERAS.map(e => pool(e.id, 'Argentina').find(p => p.name === 'L. Messi')).filter(
      Boolean,
    ),
    now = catalog.players.find(p => p.name === 'L. Messi');
  assert.deepEqual(
    messi.map(p => p.era),
    [2006, 2010, 2014, 2018, 2022, 2026],
  );
  assert.deepEqual([messi.at(-1).edition, messi.at(-1).eraOf], [24, now.profileId]);
  assert.ok(shown(messi.at(-1)) > shown(now));
  assert.equal(personVersions(catalog, now).length, 6); // his 2026 card is not today's
  // Someone at his best today is the catalog object itself in the 2026 pool.
  const yamal = catalog.players.find(p => p.name === 'Lamine Yamal');
  assert.ok(pool(2026, 'Spain').includes(yamal));
  assert.equal(personVersions(catalog, yamal).at(-1), yamal);
});

test('the Prime: a drafted player’s best version across all titles, any gain', () => {
  // "Brazil 2002 Ronaldinho" → the Ronaldinho of 2006 (FIFA 07).
  const young = named(2002, 'Brazil', 'Ronaldinho'),
    prime = bestVersion(catalog, young);
  assert.equal(prime, named(2006, 'Brazil', 'Ronaldinho'));
  assert.ok(shown(prime) > shown(young));
  assert.equal(editionLabel(prime), '’06');
  assert.equal(bestVersion(catalog, prime), null); // already his best
  // Every pool member: the best version is the same person, shows more, and is the most any
  // of his cards shows; a card that is his best has none.
  let gains = 0,
    outside = 0;
  const pooled = new Set();
  for (const era of eraList(catalog))
    for (const n of era.nations) for (const p of pool(era.id, n.name)) pooled.add(p);
  for (const p of pooled) {
    const best = bestVersion(catalog, p),
      versions = personVersions(catalog, p);
    assert.ok(versions.includes(p), p.profileId);
    const most = Math.max(...versions.map(shown));
    if (!best) {
      assert.equal(shown(p), most, p.profileId);
      continue;
    }
    gains++;
    if (!pooled.has(best)) outside++;
    assert.equal(personId(best), personId(p));
    assert.ok(shown(best) > shown(p));
    assert.equal(shown(best), most);
    assert.notEqual(best, p);
  }
  assert.ok(gains > 4000, 'cards with a better version: ' + gains);
  // Some best versions are in no pool (his nation cannot be spun then, or he is not among its
  // 26 of that era): the file keeps them for this.
  assert.ok(outside > 300, 'best versions outside the pools: ' + outside);
  // A catalog player: his best past card — the same version the legends file calls his prime.
  const withLegends = attachLegends(
    catalog,
    decodeLegends(JSON.parse(readFileSync(PATHS.legends, 'utf8'))),
  );
  const messi = catalog.players.find(p => p.name === 'L. Messi'),
    best = bestVersion(catalog, messi),
    old = primeVersion(withLegends, messi);
  assert.deepEqual([shown(best), best.year, best.eraOf], [95, old.year, messi.profileId]);
  assert.deepEqual(best.attrs, old.attrs);
  assert.equal(baseProfileId(best), messi.profileId);
  // A player at his best today has none.
  assert.equal(
    bestVersion(
      catalog,
      catalog.players.find(p => p.name === 'Lamine Yamal'),
    ),
    null,
  );
});
