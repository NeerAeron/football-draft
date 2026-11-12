// Legends file format v1 (app/data/legends.v1.json): the Legends (players of past editions who
// are not in the catalog) and the Prime versions of catalog players, columnar like the catalog
// (catalog-codec.js). Pure: no DOM, no fetch, no CONFIG. `encodeLegends` writes the layout,
// `decodeLegends` rebuilds the same objects; players/legends.js attaches them to a catalog.
//
// File layout (arrays of a table are parallel, one entry per player):
//   format: 'football-draft-legends', version: 1
//   compilerVersion, source, selection     provenance summary
//   catalog { players, ids, profileId: { prefix, suffix } }   the catalog build it belongs to
//   attributeKeys[K], tendencyKeys[T], dictionaries { positions[], badges[] }
//   precomputed { badges }                 config stamp of the normalised badges
//   nations[]                              nation names (catalog spelling) legends.nation indexes
//   legends { count, sourceId[], edition[], name[], fullName[], club[] (catalog team id,
//             0 = none), nation[], position, secondary[], foot, weakFoot[], sourceOverall[],
//             attrs[K*N], tendencies[T*N], tags[], evidence[], evidenceConfidence[] }
//   primes  { count, sourceId[] (the catalog player's id), edition[], position, … } — the same
//             columns without name, club and nation (those are the catalog player's)
// profileId = 'ea:<sourceId>:fc<edition>:legend' | ':prime'; a prime's `primeOf` is the catalog
// player's profileId (prefix + sourceId + suffix).
import { CODE_ALPHABET, stamp } from './catalog-codec.js';

export const LEGENDS_FORMAT = 'football-draft-legends';
export const LEGENDS_VERSION = 1;
const CODE = new Map([...CODE_ALPHABET].map((c, i) => [c, i]));
const SCALE = 1000;
const ID = /^ea:(\d+):fc(\d+):(legend|prime)$/;

/** Stamp of a catalog's player ids: a legends file belongs to one catalog build. */
export const catalogIds = catalog => stamp(catalog.players.map(p => p.profileId));

function encodeTable(players, { attributeKeys, tendencyKeys, positions, badges }, kind, extra) {
  const index = (list, value, what) => {
    const i = list.indexOf(value);
    if (i < 0 || i >= CODE_ALPHABET.length) throw Error(`Cannot encode ${what} ${value}`);
    return CODE_ALPHABET[i];
  };
  const out = {
    count: players.length,
    sourceId: [],
    edition: [],
    ...extra.columns(),
    position: '',
    secondary: [],
    foot: '',
    weakFoot: [],
    sourceOverall: [],
    attrs: [],
    tendencies: [],
    tags: [],
    evidence: [],
    evidenceConfidence: [],
  };
  const attrs = attributeKeys.map(() => []),
    tendencies = tendencyKeys.map(() => []);
  for (const p of players) {
    const m = ID.exec(p.profileId);
    if (!m || m[3] !== kind || Number(m[2]) !== p.edition)
      throw Error(`Unsupported ${kind} id ${p.profileId}`);
    out.sourceId.push(Number(m[1]));
    out.edition.push(p.edition);
    extra.push(out, p);
    out.position += index(positions, p.primaryPosition, 'position');
    out.secondary.push(p.secondaryPositions.map(s => index(positions, s, 'position')).join(''));
    if (p.foot !== 'left' && p.foot !== 'right') throw Error(`${p.profileId}: invalid foot`);
    out.foot += p.foot === 'left' ? 'L' : 'R';
    out.weakFoot.push(p.weakFoot);
    out.sourceOverall.push(p.sourceOverall);
    if (Object.keys(p.attrs).join() !== attributeKeys.join())
      throw Error(`${p.profileId}: attribute keys differ`);
    attributeKeys.forEach((key, k) => {
      if (!Number.isInteger(p.attrs[key])) throw Error(`${p.profileId}: ${key} is not an integer`);
      attrs[k].push(p.attrs[key]);
    });
    if (Object.keys(p.tendencies).join() !== tendencyKeys.join())
      throw Error(`${p.profileId}: tendency keys differ`);
    tendencyKeys.forEach((key, k) => {
      const n = Math.round(p.tendencies[key] * SCALE);
      if (n / SCALE !== p.tendencies[key])
        throw Error(`${p.profileId}: ${key} does not round-trip`);
      tendencies[k].push(n);
    });
    out.tags.push(p.tags.map(t => index(badges, t, 'badge')).join(''));
    const explicit = p.inference?.badges || [];
    out.evidence.push(explicit.map(e => index(badges, e.tag, 'badge')).join(''));
    for (const e of explicit) out.evidenceConfidence.push(Math.round(e.confidence * SCALE));
  }
  out.attrs = attrs.flat();
  out.tendencies = tendencies.flat();
  return out;
}

/**
 * @param data { compilerVersion, source, selection, catalog: { players, ids, profileId },
 *   attributeKeys, dictionaries: { positions, badges }, precomputed, legends[], primes[] }
 *   (players as decodeLegends returns them)
 */
export function encodeLegends(data) {
  const sample = data.legends[0] || data.primes[0],
    keys = {
      attributeKeys: [...data.attributeKeys],
      tendencyKeys: Object.keys(sample?.tendencies || {}),
      positions: data.dictionaries.positions,
      badges: data.dictionaries.badges,
    };
  const nations = [...new Set(data.legends.map(p => p.source.nationality))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const { prefix, suffix } = data.catalog.profileId;
  return {
    format: LEGENDS_FORMAT,
    version: LEGENDS_VERSION,
    compilerVersion: data.compilerVersion,
    source: data.source,
    selection: data.selection,
    catalog: data.catalog,
    attributeKeys: keys.attributeKeys,
    tendencyKeys: keys.tendencyKeys,
    dictionaries: { positions: [...keys.positions], badges: [...keys.badges] },
    precomputed: { ...data.precomputed },
    nations,
    legends: encodeTable(data.legends, keys, 'legend', {
      columns: () => ({ name: [], fullName: [], club: [], nation: [] }),
      push(out, p) {
        out.name.push(p.name);
        out.fullName.push(p.fullName);
        out.club.push(p.source.clubId == null ? 0 : Number(p.source.clubId));
        out.nation.push(nations.indexOf(p.source.nationality));
      },
    }),
    primes: encodeTable(data.primes, keys, 'prime', {
      columns: () => ({}),
      push(out, p) {
        const id = prefix + out.sourceId[out.sourceId.length - 1] + suffix;
        if (p.primeOf !== id) throw Error(`${p.profileId}: prime of ${p.primeOf}, not ${id}`);
      },
    }),
  };
}

function decodeTable(file, table, kind, extra) {
  const n = table.count,
    K = file.attributeKeys.length,
    T = file.tendencyKeys.length,
    { positions, badges } = file.dictionaries;
  const codes = (text, dictionary) => [...text].map(ch => dictionary[CODE.get(ch)]);
  const players = new Array(n);
  let evidenceIndex = 0;
  for (let i = 0; i < n; i++) {
    const attrs = {},
      tendencies = {};
    for (let k = 0; k < K; k++) attrs[file.attributeKeys[k]] = table.attrs[k * n + i];
    for (let k = 0; k < T; k++)
      tendencies[file.tendencyKeys[k]] = table.tendencies[k * n + i] / SCALE;
    players[i] = {
      profileId: `ea:${table.sourceId[i]}:fc${table.edition[i]}:${kind}`,
      ...extra(i),
      primaryPosition: positions[CODE.get(table.position[i])],
      secondaryPositions: codes(table.secondary[i], positions),
      attrs,
      foot: table.foot[i] === 'L' ? 'left' : 'right',
      weakFoot: table.weakFoot[i],
      tendencies,
      tags: codes(table.tags[i], badges),
      sourceOverall: table.sourceOverall[i],
      edition: table.edition[i],
      inference: {
        badges: codes(table.evidence[i], badges).map(tag => ({
          tag,
          confidence: table.evidenceConfidence[evidenceIndex++] / SCALE,
        })),
      },
    };
  }
  return players;
}

/**
 * The file → { ...summary, legends[], primes[] }. A legend: { profileId, name, fullName,
 * primaryPosition, secondaryPositions, attrs, foot, weakFoot, tendencies, tags, sourceOverall,
 * edition, source: { clubId, nationality }, inference }; a prime has `primeOf` instead of the
 * name and source.
 */
export function decodeLegends(file) {
  if (file?.format !== LEGENDS_FORMAT || file.version !== LEGENDS_VERSION)
    throw Error('Unsupported legends format');
  const { prefix, suffix } = file.catalog.profileId,
    l = file.legends,
    p = file.primes;
  return {
    compilerVersion: file.compilerVersion,
    source: file.source,
    selection: file.selection,
    catalog: file.catalog,
    attributeKeys: [...file.attributeKeys],
    dictionaries: {
      positions: [...file.dictionaries.positions],
      badges: [...file.dictionaries.badges],
    },
    precomputed: { ...file.precomputed },
    legends: decodeTable(file, l, 'legend', i => ({
      name: l.name[i],
      fullName: l.fullName[i],
      source: {
        clubId: l.club[i] ? String(l.club[i]) : null,
        nationality: file.nations[l.nation[i]],
      },
    })),
    primes: decodeTable(file, p, 'prime', i => ({ primeOf: prefix + p.sourceId[i] + suffix })),
  };
}
