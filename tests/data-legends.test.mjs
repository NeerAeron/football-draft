import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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
import { PATHS, LEGACY_SOURCE } from '../scripts/data/paths.mjs';

const text = readFileSync(PATHS.legends, 'utf8'),
  file = JSON.parse(text),
  data = readLegends(),
  catalog = attachLegends(loadRuntimeCatalog(), readLegends()),
  { players: legends, primes, byId } = catalog.legends;
const shown = p => overallRating(p, true, p.primaryPosition);

test('the legends file is the pinned source compiled for this catalog, and round-trips', () => {
  assert.equal(file.format, LEGENDS_FORMAT);
  assert.equal(file.version, 1);
  assert.equal(file.source.sha256, LEGACY_SOURCE.sha256);
  assert.equal(file.source.revision, LEGACY_SOURCE.revision);
  assert.equal(file.source.license, 'MIT');
  assert.ok(LEGACY_SOURCE.url.includes(LEGACY_SOURCE.revision));
  // Built against this catalog build, with today's configuration.
  assert.equal(file.catalog.players, catalog.players.length);
  assert.equal(file.catalog.ids, catalogIds(catalog));
  assert.equal(file.compilerVersion, catalog.compilerVersion);
  assert.deepEqual(file.precomputed, { badges: badgeStamp() });
  assert.deepEqual(file.attributeKeys, catalog.attributeKeys);
  // encode(decode(file)) is the file, byte for byte.
  assert.equal(JSON.stringify(encodeLegends(data)) + '\n', text);
  assert.ok(text.length < 400_000, 'a lazily fetched file stays small: ' + text.length);
});

test('legends are players outside the catalog: valid, best version 85+, catalog nations', () => {
  assert.equal(legends.length, data.legends.length);
  assert.equal(file.selection.legendMinimum, 85);
  assert.equal(legends.length, 90);
  const current = new Set(catalog.players.map(p => p.profileId.split(':')[1])),
    badges = new Set(BADGES.map(b => b.id)),
    nations = new Set(catalog.nations.map(n => n.name)),
    teams = new Map(catalog.teams.map(t => [t.id, t]));
  assert.equal(new Set(legends.map(p => p.profileId)).size, legends.length);
  for (const p of legends) {
    assert.match(p.profileId, /^ea:\d+:fc(1[5-9]|2[0-3]):legend$/);
    assert.ok(!current.has(p.profileId.split(':')[1]), p.name + ' is in the catalog');
    assert.equal(p.legend, true);
    assert.equal(p.captain, false);
    assert.equal(p.edition, Number(p.profileId.split(':')[2].slice(2)));
    assert.ok(p.sourceOverall >= file.selection.legendMinimum && p.sourceOverall <= 99);
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
  }
  // Best first; names everyone knows, at the edition of their best version.
  for (let i = 1; i < legends.length; i++)
    assert.ok(legends[i - 1].sourceOverall >= legends[i].sourceOverall);
  const neymar = legends.find(p => p.name === 'Neymar Jr');
  assert.deepEqual(
    [neymar.sourceOverall, neymar.edition, neymar.primaryPosition, neymar.source.nationality],
    [92, 20, 'LW', 'Brazil'],
  );
  assert.equal(neymar.source.club, 'Paris Saint-Germain');
  assert.ok(legends.filter(p => p.source.clubId != null).length > legends.length * 0.7);
  // Legends never join the catalog's pools.
  assert.ok(!catalog.players.some(p => p.legend || p.prime));
  assert.ok(!catalog.byId.has(neymar.profileId));
});

test('prime versions: a catalog player at his best past edition, +3 or 88+, identity kept', () => {
  assert.equal(primes.size, data.primes.length);
  assert.ok(primes.size > 1500);
  const { primeGap, primeMinimum } = file.selection;
  for (const [id, p] of primes) {
    const base = catalog.byId.get(id);
    assert.ok(base, id);
    assert.equal(p.primeOf, id);
    assert.equal(baseProfileId(p), id);
    assert.equal(baseProfileId(base), id);
    assert.match(p.profileId, /^ea:\d+:fc(1[5-9]|2[0-3]):prime$/);
    assert.equal(p.profileId.split(':')[1], id.split(':')[1]);
    assert.equal(p.prime, true);
    assert.ok(
      p.sourceOverall >= base.sourceOverall + primeGap ||
        (p.sourceOverall >= primeMinimum && p.sourceOverall > base.sourceOverall),
      base.name,
    );
    assert.ok(shown(p) > shown(base), `${base.name}: the shown rating rises`);
    // He is the same person: name, nation, current club and the Captain tag.
    assert.deepEqual([p.name, p.fullName, p.captain], [base.name, base.fullName, base.captain]);
    assert.deepEqual(p.source, base.source);
    assert.deepEqual(normalizeBadges(p, p.tags), p.tags, p.profileId);
    assert.equal(primeVersion(catalog, base), p);
    assert.equal(primeVersion(catalog, p), null);
    assert.equal(byId.get(p.profileId), p);
  }
  const messi = catalog.players.find(p => p.name === 'L. Messi'),
    prime = primeVersion(catalog, messi);
  assert.deepEqual([messi.sourceOverall, prime.sourceOverall, prime.edition], [86, 94, 20]);
  assert.equal(prime.captain, true); // the armband goes with him
  assert.equal(editionLabel(prime.edition), '’19'); // FIFA 20 came out in 2019
  assert.equal(editionYear(prime.edition), 2019);
  assert.equal(editionLabel(null), '');
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
  'the build is deterministic: the pinned CSVs give this exact file',
  { skip: !existsSync(PATHS.legacyCsv) || !existsSync(PATHS.csv) },
  async () => {
    const { compileSource, compileLegendsFile } = await import('../scripts/data/build.mjs');
    const { toRuntimeCatalog } = await import('../scripts/data/runtime-catalog.mjs');
    const { codes } = JSON.parse(readFileSync(PATHS.nationCodes, 'utf8'));
    const { compiled, rows } = await compileSource(),
      built = await compileLegendsFile(compiled, toRuntimeCatalog(compiled, codes), rows);
    assert.equal(built.text, text);
  },
);
