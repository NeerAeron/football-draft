import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { POSITIONS } from '../app/core/players/ratings.js';
import {
  loadLegacyTitles,
  decodeLegacyTitles,
  isRepresentative,
  SKILL_FIELDS,
} from '../scripts/data/legacy-titles.mjs';
import {
  calibrateTitles,
  cardFields,
  fieldRating,
  shiftFields,
  secondStrikerRoles,
  FULL_TRUST,
  POOL_YEARS,
} from '../scripts/legends-calibration.mjs';
import { PATHS, LEGACY_TITLES } from '../scripts/data/paths.mjs';

const older = await loadLegacyTitles(PATHS.legacyTitles, LEGACY_TITLES.sha256),
  title = edition => older.titles.find(t => t.edition === edition),
  named = (edition, name) =>
    title(edition).players.find(p => p.name === name || p.fullName === name);
const calibration = calibrateTitles(older.titles);

test('data/legacy-titles.json is the pinned copy of the workbook: 17 titles of 1,000 players', () => {
  assert.equal(older.sha256, LEGACY_TITLES.sha256);
  assert.equal(older.source.sha256, LEGACY_TITLES.workbookSha256);
  assert.equal(older.source.archive, LEGACY_TITLES.archive);
  assert.ok(older.source.references.length >= 10); // the ReadMe's source links
  assert.deepEqual(
    older.titles.map(t => [t.title, t.edition, t.year]),
    [
      ['FIFA 98', 98, 1997],
      ['FIFA 99', 99, 1998],
      ['FIFA 2000', 0, 1999],
      ['FIFA 2001', 1, 2000],
      ['FIFA 2002', 2, 2001],
      ['FIFA 2003', 3, 2002],
      ['FIFA 2004', 4, 2003],
      ['FIFA 2005', 5, 2004],
      ['FIFA 06', 6, 2005],
      ['FIFA 07', 7, 2006],
      ['FIFA 08', 8, 2007],
      ['FIFA 09', 9, 2008],
      ['FIFA 10', 10, 2009],
      ['FIFA 11', 11, 2010],
      ['FIFA 12', 12, 2011],
      ['FIFA 13', 13, 2012],
      ['FIFA 14', 14, 2013],
    ],
  );
  for (const t of older.titles) {
    assert.equal(t.players.length, 1000, t.title);
    assert.ok(t.sourceFile && t.scale && t.pool >= 5000, t.title);
    // Only FIFA 09–14 print an overall.
    assert.equal(t.players[0].overall != null, t.edition >= 9 && t.edition <= 14, t.title);
    assert.equal(
      t.ranking,
      t.edition >= 9 && t.edition <= 14 ? 'Stored overall' : 'Estimated by position',
    );
    for (const p of t.players) {
      assert.ok(p.positions.length && p.positions.every(x => POSITIONS.includes(x)), p.name);
      assert.equal(new Set(p.positions).size, p.positions.length);
      for (const f of SKILL_FIELDS) assert.ok(Number.isFinite(p.native[f]), `${t.title} ${f}`);
      assert.ok(Number.isFinite(p.keeping));
      assert.ok(p.foot === null || p.foot === 'left' || p.foot === 'right');
      assert.ok(p.weakFoot === null || (p.weakFoot >= 1 && p.weakFoot <= 5));
    }
    // Keepers are rated from FIFA 2005 on: at least three keeper skills.
    assert.equal(t.keeperRated, t.edition >= 5 && t.edition < 90, t.title);
  }
  // A re-read of the raw JSON decodes to the same thing (no hidden state).
  const again = decodeLegacyTitles(JSON.parse(readFileSync(PATHS.legacyTitles, 'utf8')));
  assert.deepEqual(again.titles[16].players[0].native, title(14).players[0].native);
});

test('the titles are decoded as they are: positions, feet, what stands for a missing skill', () => {
  const messi = named(14, 'Lionel Messi') ?? title(14).players[0];
  assert.equal(title(14).players[0].id, 158023); // EA's id, the one FIFA 15–23 and FC 27 use
  assert.deepEqual(
    [messi.overall, messi.foot, messi.weakFoot, messi.born],
    [94, 'left', 3, '1987-06-24'],
  );
  // EA's centre forward (the false nine of 2011–14) is a No. 10 or a striker, whichever the
  // game rates higher with his skills; Cristiano Ronaldo's wing midfielder of 2007 is a winger.
  assert.equal(messi.label, 'CF');
  assert.deepEqual(messi.positions.slice(0, 2), ['AM', 'ST']);
  assert.deepEqual(secondStrikerRoles(messi.native), ['AM', 'ST']);
  assert.equal(named(8, 'Cristiano Ronaldo').positions[0], 'RW');
  // FIFA 11–14 have every modern skill but composure (his reactions until the compiler finds
  // his nearest version that has one); FIFA 2002 has eight skills for everything.
  assert.deepEqual(title(14).fields.mentality_vision, ['vision']);
  assert.deepEqual(title(14).fields.mentality_composure, ['reactions']);
  assert.deepEqual(title(9).fields.mentality_composure, ['playercomposure']);
  assert.deepEqual(title(9).fields.mentality_vision, ['shortpassing', 'longpassing']);
  assert.deepEqual(title(2).fields.skill_dribbling, ['ball_control']);
  assert.deepEqual(title(2).fields.mentality_aggression, null); // nothing near: neutral
  assert.equal(title(2).players[0].native.mentality_aggression, 60);
  // Classic, all-star and stand-in squads are not clubs; a player who is only there is nobody.
  assert.ok(isRepresentative('Classic XI', 11) && isRepresentative('Brazil 1970', 0));
  assert.ok(!isRepresentative('FC Schalke 04', 12) && !isRepresentative('Brazil', 0));
  const beckenbauer = named(11, 'Franz Beckenbauer');
  assert.equal(beckenbauer.representativeOnly, true);
  assert.equal(beckenbauer.person, null);
  const zidane = named(6, 'Z. Zidane');
  assert.deepEqual(zidane.clubs, ['Real Madrid C.F.', 'France']); // without the World XI
  // An unlicensed stand-in name, and an invented one under an id of its own (Adrian Mutu).
  assert.equal(named(2, 'No 9').standIn, true);
  const murgu = title(9).players.find(p => p.fullName === 'Andrei Murgu');
  assert.deepEqual([murgu.id, murgu.standIn], [21195, true]);
});

test('one person across the titles: EA ids, two ids of one man, stand-ins, FIFA 98/99 by name', () => {
  const { persons, dropped, merged } = calibration;
  assert.ok(persons.size > 6000 && persons.size < 6400, 'persons: ' + persons.size);
  // Zidane is one person from FIFA 98 (its own id space) to FIFA 06.
  const zidane = named(6, 'Z. Zidane').person;
  assert.equal(zidane.id, 1397);
  assert.deepEqual(
    zidane.rows.map(p => p.edition),
    [98, 99, 0, 1, 2, 3, 4, 5, 6],
  );
  // Raúl and Bergkamp change id between FIFA 2003 and 2004: one man each.
  const raul = named(9, 'Raúl').person;
  assert.equal(
    raul,
    named(1, 'González Raúl')?.person ?? title(1).players.find(p => /Raúl/.test(p.name)).person,
  );
  assert.ok(merged.some(m => m.startsWith('Raúl:')) && merged.some(m => /Bergkamp/.test(m)));
  // Ronaldo is "No. 9" in FIFA 2000–02 (no licence): the same id and the Brazil team make him
  // one person, and the stand-in name is never his.
  const ronaldo = named(4, 'Ronaldo').person;
  assert.ok(ronaldo.rows.some(p => p.standIn) && ronaldo.rows.some(p => p.edition === 10));
  // A row that fits nobody of its id is dropped and listed; a FIFA 98/99 player nobody later
  // has is a person of his own (and will get no card).
  assert.ok(dropped.length > 5 && dropped.every(line => /not the .+ of that id/.test(line)));
  const klinsmann = named(98, 'Klinsmann').person;
  assert.equal(klinsmann.ea, false);
  assert.ok(klinsmann.rows.every(p => p.given === null));
});

test('FIFA 09–14 keep the overall EA printed; FIFA 98–08 are chain-linked to it', () => {
  for (const edition of [9, 10, 11, 12, 13, 14])
    for (const p of title(edition).players)
      if (p.person) assert.equal(p.given, p.overall, `${p.name} (${edition})`);
  const { yardstick, links, pool } = calibration;
  // A year on, the players two official titles share lose a little and keep their spread.
  assert.ok(yardstick.outfield.drift < 0 && yardstick.outfield.drift > -0.5);
  assert.ok(Math.abs(yardstick.outfield.spread - 1) < 0.05);
  assert.ok(yardstick.outfield.correlation > 0.7);
  assert.deepEqual(
    links.map(l => l.title),
    [
      'FIFA 08',
      'FIFA 07',
      'FIFA 06',
      'FIFA 2005',
      'FIFA 2004',
      'FIFA 2003',
      'FIFA 2002',
      'FIFA 2001',
      'FIFA 2000',
      'FIFA 99',
      'FIFA 98',
    ],
  );
  for (const l of links) {
    assert.ok(l.shared >= 150, `${l.title}: ${l.shared} shared players`);
    assert.ok(l.outfield.slope > 0.3 && l.outfield.slope < 1.2, l.title);
    // The shared players keep their level: around 80–83, a title's top is not forced anywhere.
    assert.ok(l.outfield.to > 79 && l.outfield.to < 84, l.title);
    assert.equal('skills' in l, !/FIFA (0[678]|2004|2005)/.test(l.title), l.title); // coarse scales
  }
  // Keepers: from FIFA 2005 on.
  assert.ok(links.slice(0, 4).every(l => l.keepers.shared >= 20 && l.keepers.slope > 0));
  assert.ok(links.slice(4).every(l => l.keepers.cards === false));
  assert.ok(title(4).players.every(p => p.positions[0] !== 'GK' || p.given === null));
  // The coarse titles are trusted about three parts in ten, a full one nine in ten; a coarse
  // row no other data generation backs within three years gets no overall at all.
  assert.ok(pool.trust > 0.2 && pool.trust < 0.4, 'trust: ' + pool.trust);
  assert.deepEqual([FULL_TRUST, POOL_YEARS], [0.9, 3]);
  assert.ok(pool.cards > 1500 && pool.unbacked > 2000);
  // What comes out reads like football: the best of 2003 is Ronaldo, of 2005 Ronaldinho, of
  // 2007 Buffon — and a year's best is not the same number every year.
  const best = edition =>
    title(edition)
      .players.filter(p => p.given != null)
      .sort((a, b) => b.given - a.given)[0];
  assert.deepEqual([best(4).name, Math.round(best(4).given)], ['Ronaldo', 92]);
  assert.deepEqual([best(8).name, Math.round(best(8).given)], ['G. Buffon', 92]);
  assert.equal(
    title(6)
      .players.filter(p => p.given != null && p.positions[0] !== 'GK')
      .sort((a, b) => b.given - a.given)[0].name,
    'Ronaldinho',
  );
  // FIFA 98's raw ranking has Hierro first, every skill at 99: on the scale he is a good
  // 84–85, well under his fully described later self — and under Zidane.
  const hierro = named(98, 'Hierro');
  assert.equal(title(98).players[0], hierro);
  assert.ok(hierro.given < 86 && hierro.given < named(99, 'Zidane').given);
  assert.ok(Math.max(...title(98).players.map(p => p.given ?? 0)) < 88);
});

test('a card: the skills of its year, moved together until the game shows the overall', () => {
  const xavi = named(12, 'Xavi'),
    position = xavi.positions[0];
  assert.deepEqual([xavi.overall, position], [92, 'CM']);
  // The game's model, fitted on FC data, reads his FIFA 12 skills as 88.
  const plain = shiftFields(xavi.skills);
  for (const f of SKILL_FIELDS) assert.equal(plain[f], xavi.native[f]); // no shift: unchanged
  assert.equal(Math.round(fieldRating(plain, position)), 88);
  const { fields, shift } = cardFields(xavi.skills, position, 92);
  assert.equal(Math.round(fieldRating(fields, position)), 92);
  assert.ok(Math.abs(fieldRating(fields, position) - 92) < 0.1);
  assert.ok(shift > 3 && shift < 5);
  // Every skill moved by the same amount, to the point.
  for (const f of SKILL_FIELDS)
    assert.ok(
      [Math.floor(shift), Math.ceil(shift)].includes(fields[f] - xavi.native[f]) ||
        fields[f] === 99,
      f,
    );
  // A keeper's rating is his one goalkeeping number: his skills stay.
  assert.deepEqual(cardFields(xavi.skills, 'GK', 80), { fields: plain, shift: 0 });
});
