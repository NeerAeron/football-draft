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
      [2026, '2026', 2023, 2026],
    ],
  );
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
  assert.deepEqual(file.eras, ERAS);
  assert.deepEqual(
    file.sources.modern.map(m => [m.edition, m.sha256]),
    MODERN_SOURCES.map(m => [m.edition, m.sha256]),
  );
  assert.equal(JSON.stringify(encodeEras(data)) + '\n', text);
  // One lazily fetched file for all eras (a draft needs them all): about 2.4 MB, 0.7 MB on
  // the wire.
  assert.ok(text.length < 2_700_000, 'raw: ' + text.length);
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

test('every era has 20–70 nations that can field a pool, strongest first', () => {
  const list = eraList(catalog);
  assert.deepEqual(
    list.map(e => e.id),
    ERAS.map(e => e.id),
  );
  const counts = list.map(e => e.nations.length);
  // The early titles know fewer nations: France 98 is the thinnest, and stands on its own.
  assert.deepEqual(counts, [27, 52, 61, 65, 70, 70, 70, 70]);
  const codes = new Map(catalog.nations.map(n => [n.name, n.code]));
  for (const era of list) {
    assert.equal(eraNations(catalog, era.id), era.nations);
    for (let i = 1; i < era.nations.length; i++)
      assert.ok(era.nations[i - 1].strength >= era.nations[i].strength);
    for (const n of era.nations) {
      const players = pool(era.id, n.name);
      assert.equal(n.code, codes.get(n.name), n.name);
      assert.ok(n.flag.endsWith(`${n.code}.svg`));
      assert.equal(n.size, players.length);
      assert.equal(n.keepers, players.filter(p => p.primaryPosition === 'GK').length);
      // The spin rule: a team with a bench — a keeper, five defenders, five midfielders, two
      // forwards among at least 18 — and never more than a World Cup squad.
      assert.ok(n.size >= 18 && n.size <= ERA_SQUAD, `${era.label} ${n.name}: ${n.size}`);
      assert.ok(n.keepers >= 1 && n.keepers <= 3, `${era.label} ${n.name}`);
      const lines = { DEF: 0, MID: 0, ATT: 0, GK: 0 };
      for (const p of players) lines[LINE_OF[p.primaryPosition]]++;
      assert.ok(lines.DEF >= 4 && lines.MID >= 4 && lines.ATT >= 1, `${era.label} ${n.name}`);
      // Strength: the mean shown rating of the best XI (best keeper + ten best outfielders).
      const eleven = [
        players.find(p => p.primaryPosition === 'GK'),
        ...players.filter(p => p.primaryPosition !== 'GK').slice(0, 10),
      ];
      assert.equal(
        n.strength,
        Math.round((eleven.reduce((sum, p) => sum + shown(p), 0) / 11) * 10) / 10,
        `${era.label} ${n.name}`,
      );
      assert.ok(Object.isFrozen(players) && pool(era.id, n.name) === players);
    }
  }
  assert.deepEqual(eraNations(catalog, 1990), []);
  assert.deepEqual(pool(1998, 'Japan'), []); // not spinnable then
  assert.equal(list[0].nations[0].name, 'England');
  assert.equal(list[1].nations[0].name, 'Brazil');
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
        assert.equal(p.captain, false);
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
  assert.ok(Math.min(...pool(2010, 'New Zealand').map(shown)) < 62);
  // Era cards never join the catalog's pools.
  assert.ok(!catalog.players.some(p => p.era));
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
  assert.equal(top(2006, 'Brazil', 1)[0], 'Ronaldo');
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
  // "Brazil 2002 Ronaldinho" → the Ronaldinho of 2003 (FIFA 2004).
  const young = named(2002, 'Brazil', 'Ronaldinho'),
    prime = bestVersion(catalog, young);
  assert.equal(prime, named(2006, 'Brazil', 'Ronaldinho'));
  assert.ok(shown(prime) > shown(young));
  assert.equal(editionLabel(prime), '’03');
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
