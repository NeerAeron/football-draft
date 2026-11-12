import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { POSITIONS, overallRating } from '../app/core/players/ratings.js';
import { BADGES } from '../app/core/players/traits.js';
import { normalizeBadges } from '../app/core/players/badges.js';
import { badgeStamp } from '../app/core/players/catalog-derived.js';
import { encodeLegends, catalogIds, LEGENDS_FORMAT } from '../app/core/players/legends-codec.js';
import {
  attachLegends,
  legendPlayer,
  primeVersion,
  baseProfileId,
  editionLabel,
  editionYear,
} from '../app/core/players/legends.js';
import { loadRuntimeCatalog, readLegends } from '../scripts/data/catalog-file.mjs';
import { PATHS, LEGACY_SOURCE, LEGACY_TITLES } from '../scripts/data/paths.mjs';

const text = readFileSync(PATHS.legends, 'utf8'),
  file = JSON.parse(text),
  data = readLegends(),
  catalog = attachLegends(loadRuntimeCatalog(), readLegends()),
  { players: legends, primes, byId } = catalog.legends;
const shown = p => overallRating(p, true, p.primaryPosition);
// A title comes out the autumn before its number: FIFA 98 in 1997, FIFA 2000 (0) in 1999.
const releaseYear = edition => (edition >= 90 ? 1899 : 1999) + edition;
const EDITION = /^ea:\d+:fc(9[89]|\d|1\d|2[0-3]):(legend|prime)$/;

test('the legends file is the pinned sources compiled for this catalog, and round-trips', () => {
  assert.equal(file.format, LEGENDS_FORMAT);
  assert.equal(file.version, 1);
  assert.equal(file.source.sha256, LEGACY_SOURCE.sha256);
  assert.equal(file.source.revision, LEGACY_SOURCE.revision);
  assert.equal(file.source.license, 'MIT');
  assert.ok(LEGACY_SOURCE.url.includes(LEGACY_SOURCE.revision));
  // The second past source: FIFA 98–14, the pinned file made from the pinned workbook.
  assert.equal(file.source.older.sha256, LEGACY_TITLES.sha256);
  assert.equal(file.source.older.workbookSha256, LEGACY_TITLES.workbookSha256);
  assert.equal(file.source.older.titles, 17);
  assert.equal(file.selection.olderRows, 17_000);
  // Built against this catalog build, with today's configuration.
  assert.equal(file.catalog.players, catalog.players.length);
  assert.equal(file.catalog.ids, catalogIds(catalog));
  assert.equal(file.compilerVersion, catalog.compilerVersion);
  assert.deepEqual(file.precomputed, { badges: badgeStamp() });
  assert.deepEqual(file.attributeKeys, catalog.attributeKeys);
  // encode(decode(file)) is the file, byte for byte.
  assert.equal(JSON.stringify(encodeLegends(data)) + '\n', text);
  // A lazily fetched file stays small: 26 titles of legends and every gain as a prime version
  // are about 500 KB, 150 KB on the wire (it was 390 / 120 KB with FIFA 15–23 alone).
  assert.ok(text.length < 560_000, 'raw: ' + text.length);
  const gzip = gzipSync(Buffer.from(text), { level: 9 }).length;
  assert.ok(gzip < 175_000, 'gzip: ' + gzip);
});

test('legends are best past versions shown 85+: valid, catalog nations, the year of the ratings', () => {
  assert.equal(legends.length, data.legends.length);
  assert.equal(file.selection.legendMinimum, 85);
  const current = new Map(catalog.players.map(p => [p.profileId.split(':')[1], p])),
    badges = new Set(BADGES.map(b => b.id)),
    nations = new Set(catalog.nations.map(n => n.name)),
    teams = new Map(catalog.teams.map(t => [t.id, t]));
  assert.equal(new Set(legends.map(p => p.profileId)).size, legends.length);
  let pure = 0,
    past = 0;
  for (const p of legends) {
    assert.match(p.profileId, EDITION);
    assert.ok(p.profileId.endsWith(':legend'));
    assert.equal(p.legend, true);
    assert.equal(p.captain, false);
    assert.equal(p.edition, Number(p.profileId.split(':')[2].slice(2)));
    // Nobody under 85 as the game shows him — the number on the card, not EA's.
    assert.ok(shown(p) >= file.selection.legendMinimum, `${p.name} shows ${shown(p)}`);
    // His card shows the overall of that version: EA's printed one (FIFA 09–23), or the one the
    // chain of shared players gives a title that printed none.
    assert.equal(shown(p), p.sourceOverall, p.name);
    // The year is the year of that version's ratings: these are all release ratings, the
    // autumn before the title's number.
    assert.equal(p.year, releaseYear(p.edition));
    assert.equal(editionYear(p), p.year);
    assert.equal(editionYear(p.edition), p.year);
    assert.doesNotMatch(p.name, /^no\.?\s*\d+$/i); // never an unlicensed stand-in
    assert.ok(POSITIONS.includes(p.primaryPosition));
    assert.ok(p.secondaryPositions.every(s => POSITIONS.includes(s) && s !== p.primaryPosition));
    assert.ok(p.tags.every(t => badges.has(t)));
    assert.deepEqual(normalizeBadges(p, p.tags), p.tags, p.profileId);
    assert.ok(p.name && typeof p.fullName === 'string');
    assert.ok(nations.has(p.source.nationality), p.source.nationality);
    assert.deepEqual(Object.keys(p.attrs), catalog.attributeKeys);
    for (const v of Object.values(p.attrs)) assert.ok(Number.isInteger(v) && v >= 1 && v <= 99);
    // His club of that edition when the catalog has it (then he is a club mate), else none.
    if (p.source.clubId == null) assert.deepEqual([p.source.club, p.source.leagueId], [null, null]);
    else {
      const t = teams.get(p.source.clubId);
      assert.deepEqual([p.source.club, p.source.leagueId], [t.name, t.leagueId]);
    }
    assert.equal(legendPlayer(catalog, p.profileId), p);
    const now = current.get(p.profileId.split(':')[1]);
    if (!now) {
      // A player of the past: nobody else's version.
      pure++;
      assert.equal(p.legendOf, undefined);
      assert.equal(baseProfileId(p), p.profileId);
      continue;
    }
    // A current player's best past version: the same person, better than his card today —
    // however far apart the two are — and rated higher by EA then than now.
    past++;
    assert.equal(p.legendOf, now.profileId);
    assert.equal(baseProfileId(p), now.profileId);
    assert.ok(shown(p) > shown(now), `${p.name}: ${shown(p)} vs ${shown(now)} today`);
    assert.ok(p.sourceOverall > now.sourceOverall, p.name);
    assert.deepEqual(
      [p.name, p.fullName, p.source.nationality],
      [now.name, now.fullName, now.source.nationality],
    );
    assert.equal(primeVersion(catalog, p), null); // a legend is his best already: no boost
    // When he also has a prime version it is that same version.
    const prime = primeVersion(catalog, now);
    if (prime) assert.deepEqual([prime.edition, prime.attrs], [p.edition, p.attrs]);
  }
  assert.ok(pure >= 250 && past >= 60, `${pure} past players, ${past} current ones`);
  // One person once: no two legends of one nation share a name, whatever their ids.
  assert.equal(
    new Set(legends.map(p => `${p.source.nationality}|${p.fullName}`)).size,
    legends.length,
  );
  assert.equal(new Set(legends.map(p => p.profileId.split(':')[1])).size, legends.length);
  // Best first, as shown; names everyone knows, at their best version.
  for (let i = 1; i < legends.length; i++) assert.ok(shown(legends[i - 1]) >= shown(legends[i]));
  // From 1997 (FIFA 98) to 2022 (FIFA 23).
  const years = legends.map(p => p.year);
  assert.deepEqual([Math.min(...years), Math.max(...years)], [1997, 2022]);
  // The great ones are the top cards of the game, above today's best: EA's own numbers for
  // Messi and Cristiano Ronaldo, the chain's for the years before FIFA 09.
  const card = (name, nation) =>
    legends.find(p => p.name === name && p.source.nationality === nation);
  const facts = p => [shown(p), p.year, p.edition, p.primaryPosition, p.source.club];
  assert.equal(legends[0].name, 'L. Messi');
  assert.deepEqual(facts(legends[0]), [94, 2019, 20, 'RW', 'FC Barcelona']);
  assert.deepEqual(facts(card('Cristiano Ronaldo', 'Portugal')), [94, 2018, 19, 'ST', 'Juventus']);
  assert.deepEqual(facts(card('Ronaldo', 'Brazil')), [92, 2003, 4, 'ST', 'Real Madrid']);
  assert.deepEqual(facts(card('Xavi', 'Spain')), [92, 2011, 12, 'CM', 'FC Barcelona']);
  assert.deepEqual(facts(card('Ronaldinho', 'Brazil')), [91, 2005, 6, 'AM', 'FC Barcelona']);
  assert.deepEqual(facts(card('Z. Zidane', 'France')), [91, 2003, 4, 'AM', 'Real Madrid']);
  assert.deepEqual(facts(card('T. Henry', 'France')), [91, 2004, 5, 'ST', 'Arsenal']);
  assert.deepEqual(facts(card('G. Buffon', 'Italy')).slice(0, 4), [92, 2007, 8, 'GK']);
  assert.ok(shown(card('P. Maldini', 'Italy')) >= 87);
  // Today's best card shows 92: Messi and Cristiano Ronaldo stand above it, Ronaldo, Xavi and
  // Buffon beside it.
  const best = Math.max(...catalog.players.map(shown));
  assert.ok(shown(legends[1]) > best && shown(legends[8]) >= best, `today's best: ${best}`);
  // A man with two EA ids (Raúl changes id between FIFA 2003 and 2004) is one legend; an
  // invented name ("Andrei Murgu" for Adrian Mutu) is never shown.
  assert.equal(legends.filter(p => p.name === 'Raúl').length, 1);
  assert.ok(card('A. Mutu', 'Romania'));
  assert.ok(!legends.some(p => /Murgu|Teodor/.test(p.fullName)));
  // Nobody who is only in a classic or all-star squad (the Classic XI's Beckenbauer, Pelé).
  assert.ok(!legends.some(p => /Beckenbauer|Pelé|Cruyff|Maradona/.test(p.fullName)));
  const neymar = legends.find(p => p.name === 'Neymar Jr');
  assert.deepEqual(
    [neymar.sourceOverall, neymar.edition, neymar.year, neymar.primaryPosition],
    [92, 20, 2019, 'LW'],
  );
  assert.deepEqual(
    [neymar.source.nationality, neymar.source.club],
    ['Brazil', 'Paris Saint-Germain'],
  );
  const messi = legends.find(p => p.name === 'L. Messi');
  assert.equal(messi.legendOf, catalog.players.find(p => p.name === 'L. Messi').profileId);
  assert.ok(shown(messi) >= 93);
  assert.ok(legends.filter(p => p.source.clubId != null).length > legends.length * 0.7);
  // Legends never join the catalog's pools.
  assert.ok(!catalog.players.some(p => p.legend || p.prime));
  assert.ok(!catalog.byId.has(neymar.profileId));
  assert.ok(!catalog.byId.has(messi.profileId));
});

test('prime versions: a catalog player at his best past version, any gain, identity kept', () => {
  assert.equal(primes.size, data.primes.length);
  assert.ok(primes.size > 2500);
  // No threshold beyond "more than today": the old +2 / 88+ rule is gone.
  assert.deepEqual([file.selection.primeGap, file.selection.primeMinimum], [undefined, undefined]);
  let byOne = 0;
  for (const [id, p] of primes) {
    const base = catalog.byId.get(id);
    assert.ok(base, id);
    assert.equal(p.primeOf, id);
    assert.equal(baseProfileId(p), id);
    assert.equal(baseProfileId(base), id);
    assert.match(p.profileId, EDITION);
    assert.ok(p.profileId.endsWith(':prime'));
    assert.equal(p.profileId.split(':')[1], id.split(':')[1]);
    assert.equal(p.prime, true);
    assert.equal(p.year, releaseYear(p.edition));
    // The rule is in the rating the game shows — what the player sees on the two cards: any
    // gain — and EA itself rated him higher then (a card is never just read more kindly).
    assert.equal(shown(p), p.sourceOverall, base.name);
    assert.ok(shown(p) > shown(base), `${base.name}: ${shown(base)} → ${shown(p)}`);
    assert.ok(p.sourceOverall > base.sourceOverall, base.name);
    if (shown(p) === shown(base) + 1) byOne++;
    // He is the same person: name, nation, current club and the Captain tag.
    assert.deepEqual([p.name, p.fullName, p.captain], [base.name, base.fullName, base.captain]);
    assert.deepEqual(p.source, base.source);
    assert.deepEqual(normalizeBadges(p, p.tags), p.tags, p.profileId);
    assert.equal(primeVersion(catalog, base), p);
    assert.equal(primeVersion(catalog, p), null);
    assert.equal(byId.get(p.profileId), p);
  }
  assert.ok(byOne > 300, 'a gain of one point is a prime version too: ' + byOne);
  const messi = catalog.players.find(p => p.name === 'L. Messi'),
    prime = primeVersion(catalog, messi);
  assert.deepEqual([messi.sourceOverall, prime.sourceOverall, prime.edition], [89, 94, 20]);
  assert.equal(prime.captain, true); // the armband goes with him
  assert.equal(editionLabel(prime), '’19'); // FIFA 20's release ratings: 2019
  assert.equal(editionYear(prime), 2019);
  // The year is the stored one; an edition alone reads as its release year.
  assert.equal(editionYear({ edition: 23, year: 2023 }), 2023);
  assert.equal(editionLabel({ edition: 23, year: 2023 }), '’23');
  assert.equal(editionLabel(20), '’19');
  assert.equal(editionLabel(null), '');
  // The older titles: FIFA 98 is 1997, FIFA 99 1998, FIFA 2000 (edition 0) 1999, FIFA 14 2013.
  assert.deepEqual([98, 99, 0, 1, 9, 14].map(editionYear), [1997, 1998, 1999, 2000, 2008, 2013]);
  assert.deepEqual([98, 99, 0, 5].map(editionLabel), ['’97', '’98', '’99', '’04']);
  assert.equal(editionLabel({ edition: 0, year: 1999 }), '’99');
  // Two digits tell every year of the data apart.
  const labels = [];
  for (let year = 1997; year <= 2022; year++) labels.push(editionLabel({ year }));
  assert.equal(new Set(labels).size, 26);
  // A player at his best today has none.
  assert.equal(
    primeVersion(
      catalog,
      catalog.players.find(p => p.name === 'L. Yamal'),
    ),
    null,
  );
});

test(
  'the build is deterministic: the pinned sources give this exact file',
  { skip: !existsSync(PATHS.legacyCsv) || !existsSync(PATHS.csv) },
  async () => {
    const { compileSource, compileLegendsFile } = await import('../scripts/data/build.mjs');
    const { toRuntimeCatalog } = await import('../scripts/data/runtime-catalog.mjs');
    const { codes } = JSON.parse(readFileSync(PATHS.nationCodes, 'utf8'));
    const { compiled } = await compileSource(),
      built = await compileLegendsFile(compiled, toRuntimeCatalog(compiled, codes));
    assert.equal(built.text, text);
  },
);
