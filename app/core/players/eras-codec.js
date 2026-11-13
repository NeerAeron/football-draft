// Eras file format v1 (app/data/eras.v1.json): per World Cup cycle and nation the pool of at
// most 26 players, each at his best version inside the era's years, columnar like the legends
// file (it shares that file's player table, legends-codec.js). Pure: no DOM, no fetch, no
// CONFIG. `encodeEras` writes the layout, `decodeEras` rebuilds the same objects;
// players/eras.js attaches them to a catalog.
//
// File layout:
//   format: 'football-draft-eras', version: 1
//   compilerVersion, sources, selection   provenance summary
//   catalog { players, ids, profileId: { prefix, suffix } }   the catalog build it belongs to
//   attributeKeys[K], tendencyKeys[T], dictionaries { positions[], badges[] }
//   precomputed { badges }                config stamp of the normalised badges
//   nations[]                             nation names (catalog spelling)
//   eras[]                                { id, label, short, from, to (years of the ratings),
//                                         keeperLevel (the rating a pool without a keeper is
//                                         given in goal for its strength) }
//   cards { count, sourceId[] (EA's player id: the person), edition[] (98, 99, 0–26), year[],
//           name[], fullName[], club[] (catalog team id, 0 = none), nation[], current[] (1 =
//           the person is in the catalog: `eraOf`), mark[] (1 = a GOAT card, 2 = a Captain
//           card, 0 = neither), position, secondary[], foot, weakFoot[],
//           sourceOverall[], attrs[K*N], tendencies[T*N], tags[], evidence[],
//           evidenceConfidence[] }       every card: pool members, and the best versions
//                                         kept for the Prime that are in no pool
//   pools[]                               one per era, in `eras` order: { era, nation[] (index
//                                         into nations, strongest first), strength[] (× 10),
//                                         members[] (per nation: card indexes; a negative
//                                         number = minus the EA id of a catalog player who is
//                                         in the pool as he is today) }
// profileId of a card = 'ea:<sourceId>:fc<edition>:era'.
import { encodeTable, decodeTableSteps } from './legends-codec.js';

export const ERAS_FORMAT = 'football-draft-eras';
export const ERAS_VERSION = 1;

/**
 * @param data { compilerVersion, sources, selection, catalog: { players, ids, profileId },
 *   attributeKeys, dictionaries: { positions, badges }, precomputed, eras: [{ id, label, from,
 *   to }], cards: [player], pools: [{ era, nation, strength, members: [profileId] }] } (as
 *   decodeEras returns it; a pool's members are card ids or catalog profile ids)
 */
export function encodeEras(data) {
  const keys = {
      attributeKeys: [...data.attributeKeys],
      tendencyKeys: Object.keys(data.cards[0]?.tendencies || {}),
      positions: data.dictionaries.positions,
      badges: data.dictionaries.badges,
    },
    nations = [...new Set(data.cards.map(p => p.source.nationality))]
      .concat(data.pools.map(p => p.nation))
      .filter((name, i, list) => list.indexOf(name) === i)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    nationIndex = new Map(nations.map((name, i) => [name, i])),
    { prefix, suffix } = data.catalog.profileId,
    cardIndex = new Map(data.cards.map((p, i) => [p.profileId, i]));
  const member = id => {
    if (cardIndex.has(id)) return cardIndex.get(id);
    if (!id.startsWith(prefix) || !id.endsWith(suffix)) throw Error(`Unknown pool member ${id}`);
    const source = Number(id.slice(prefix.length, id.length - suffix.length));
    if (!(source > 0)) throw Error(`Unknown pool member ${id}`);
    return -source;
  };
  return {
    format: ERAS_FORMAT,
    version: ERAS_VERSION,
    compilerVersion: data.compilerVersion,
    sources: data.sources,
    selection: data.selection,
    catalog: data.catalog,
    attributeKeys: keys.attributeKeys,
    tendencyKeys: keys.tendencyKeys,
    dictionaries: { positions: [...keys.positions], badges: [...keys.badges] },
    precomputed: { ...data.precomputed },
    nations,
    eras: data.eras.map(({ id, label, short, from, to, keeperLevel }) => ({
      id,
      label,
      short,
      from,
      to,
      keeperLevel,
    })),
    cards: encodeTable(data.cards, keys, 'era', {
      columns: () => ({ name: [], fullName: [], club: [], nation: [], current: [], mark: [] }),
      push(out, p) {
        if (p.goat && p.captain) throw Error(`${p.profileId}: a GOAT and a Captain`);
        out.mark.push(p.goat ? 1 : p.captain ? 2 : 0);
        out.name.push(p.name);
        out.fullName.push(p.fullName);
        out.club.push(p.source.clubId == null ? 0 : Number(p.source.clubId));
        out.nation.push(nationIndex.get(p.source.nationality));
        const id = prefix + out.sourceId[out.sourceId.length - 1] + suffix;
        if (p.eraOf != null && p.eraOf !== id)
          throw Error(`${p.profileId}: era card of ${p.eraOf}, not ${id}`);
        out.current.push(p.eraOf != null ? 1 : 0);
      },
    }),
    pools: data.eras.map(era => {
      const pools = data.pools.filter(p => p.era === era.id);
      return {
        era: era.id,
        nation: pools.map(p => nationIndex.get(p.nation)),
        strength: pools.map(p => Math.round(p.strength * 10)),
        members: pools.map(p => p.members.map(member)),
      };
    }),
  };
}

/**
 * The file → { ...summary, eras[], cards[], pools[] }. A card: { profileId, name, fullName,
 * primaryPosition, secondaryPositions, attrs, foot, weakFoot, tendencies, tags, sourceOverall,
 * edition, year, source: { clubId, nationality }, inference } (+ `eraOf`, the catalog player's
 * profileId, when the person is in the catalog). A pool: { era, nation, strength, members:
 * [profileId] } — a member is a card's id or a catalog player's.
 */
export function decodeEras(file) {
  const steps = decodeErasSteps(file);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}
/**
 * decodeEras as a step-wise generator (drive it with `stepped()` of services/catalog.js): the
 * 12,000 cards are decoded a couple of hundred at a time, so nothing blocks a tap on a phone.
 */
export function* decodeErasSteps(file) {
  if (file?.format !== ERAS_FORMAT || file.version !== ERAS_VERSION)
    throw Error('Unsupported eras format');
  const { prefix, suffix } = file.catalog.profileId,
    c = file.cards,
    mark = c.mark ?? [], // a file from before the marks: nobody is marked
    cards = yield* decodeTableSteps(file, c, 'era', i => ({
      name: c.name[i],
      fullName: c.fullName[i],
      source: {
        clubId: c.club[i] ? String(c.club[i]) : null,
        nationality: file.nations[c.nation[i]],
      },
      ...(c.current[i] ? { eraOf: prefix + c.sourceId[i] + suffix } : {}),
      ...(mark[i] === 1 ? { goat: true } : mark[i] === 2 ? { captain: true } : {}),
    }));
  return {
    compilerVersion: file.compilerVersion,
    sources: file.sources,
    selection: file.selection,
    catalog: file.catalog,
    attributeKeys: [...file.attributeKeys],
    dictionaries: {
      positions: [...file.dictionaries.positions],
      badges: [...file.dictionaries.badges],
    },
    precomputed: { ...file.precomputed },
    eras: file.eras.map(e => ({ ...e })),
    cards,
    pools: file.pools.flatMap(p =>
      p.nation.map((nation, i) => ({
        era: p.era,
        nation: file.nations[nation],
        strength: p.strength[i] / 10,
        members: p.members[i].map(ref =>
          ref >= 0 ? cards[ref].profileId : prefix + -ref + suffix,
        ),
      })),
    ),
  };
}
