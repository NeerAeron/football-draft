// Catalog runtime format v3: a columnar JSON encoding of the player catalog.
//
// Pure (no DOM, no fetch, no CONFIG): `encodeCatalog` turns a decoded catalog into the file
// layout written to app/data/catalog.v3.json, and `decodeCatalog` rebuilds exactly the same
// objects. `indexCatalog` adds lookup Maps. Derived values and their configuration stamps
// are computed in catalog-derived.js; scripts/data/build.mjs writes the file.
//
// File layout (all arrays in `players` are parallel, one entry per player, catalog order):
//   format: 'football-draft-catalog', version: 3
//   compilerVersion, source, selection     provenance summary (as in the compiler output)
//   attributeKeys[K], tendencyKeys[T]      key order of attrs / tendencies
//   dictionaries.positions[], .badges[]    code chars index these (CODE_ALPHABET, one char each)
//   formations[]                           formation ids, order of teams[].lineups strings
//   precomputed { badges, clubRatings, lineups }   config stamps the derived values were made with
//   leagues[]                              league objects (decoded as-is)
//   teams[]  { ...team, lineups: [string per formation], bestFormation: index | -1 }
//            a lineup string has 11 code chars (index into the club's players, catalog order),
//            '' when the club has no compatible XI in that formation
//   nations[] { name, code, flag, players, goalkeepers }
//   players {
//     count, profileIdPrefix, profileIdSuffix, sourceId[]    profileId = prefix + id + suffix
//     name[], fullName[], position (string, 1 code char each), secondary[] (code strings),
//     foot (string of 'L'/'R'), weakFoot[], sourceOverall[], club[] (team index, -1 = none),
//     nation[] (nation index), attrs[K*N] (integers, attribute-major: attrs[k * count + i]),
//     tendencies[T*N] (attribute-major, integers = value * 1000), tags[] (badge code strings,
//     normalised for the stamped configuration),
//     evidence[] (badge code strings), evidenceConfidence[] (flat, confidence * 1000)
//   }
export const CATALOG_FORMAT = 'football-draft-catalog';
export const CATALOG_VERSION = 3;
export const CODE_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CODE = new Map([...CODE_ALPHABET].map((c, i) => [c, i]));
const SCALE = 1000;

function code(index, what) {
  if (!Number.isInteger(index) || index < 0 || index >= CODE_ALPHABET.length)
    throw Error(`Cannot encode ${what} index ${index}`);
  return CODE_ALPHABET[index];
}
function lookup(list, what) {
  const map = new Map(list.map((v, i) => [v, i]));
  return value => {
    const i = map.get(value);
    if (i === undefined) throw Error(`Unknown ${what}: ${value}`);
    return i;
  };
}
function scaled(value, what) {
  const n = Math.round(value * SCALE);
  if (n / SCALE !== value) throw Error(`${what} ${value} does not round-trip at 1/${SCALE}`);
  return n;
}
function sameKeys(object, keys, what) {
  const own = Object.keys(object);
  if (own.length !== keys.length || own.some((k, i) => k !== keys[i]))
    throw Error(`${what} keys differ from the catalog key order`);
}

// FNV-1a (32-bit) of a JSON value: a short stamp of the configuration that derived values
// (badges, club ratings, club lineups) were computed with.
export function stamp(value) {
  const text = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function encodeCatalog(catalog) {
  const players = catalog.players,
    teams = catalog.teams || [],
    nations = catalog.nations || [],
    formations = catalog.formations || [];
  const attributeKeys = [...catalog.attributeKeys],
    tendencyKeys = Object.keys(players[0]?.tendencies || {});
  const positions = catalog.dictionaries?.positions,
    badges = catalog.dictionaries?.badges;
  if (!positions || !badges) throw Error('Catalog dictionaries (positions, badges) are required');
  const position = lookup(positions, 'position'),
    badge = lookup(badges, 'badge'),
    nation = lookup(
      nations.map(n => n.name),
      'nationality',
    ),
    team = lookup(
      teams.map(t => String(t.id)),
      'club',
    );
  const [prefix, suffix] = profileIdParts(players);
  const out = {
    count: players.length,
    profileIdPrefix: prefix,
    profileIdSuffix: suffix,
    sourceId: [],
    name: [],
    fullName: [],
    position: '',
    secondary: [],
    foot: '',
    weakFoot: [],
    sourceOverall: [],
    club: [],
    nation: [],
    attrs: [],
    tendencies: [],
    tags: [],
    evidence: [],
    evidenceConfidence: [],
  };
  const positionCodes = [],
    feet = [],
    attrs = attributeKeys.map(() => []),
    tendencies = tendencyKeys.map(() => []);
  for (const p of players) {
    out.sourceId.push(Number(p.profileId.slice(prefix.length, p.profileId.length - suffix.length)));
    out.name.push(p.name);
    out.fullName.push(p.fullName);
    positionCodes.push(code(position(p.primaryPosition), 'position'));
    out.secondary.push(p.secondaryPositions.map(s => code(position(s), 'position')).join(''));
    if (p.foot !== 'left' && p.foot !== 'right') throw Error(`${p.profileId}: invalid foot`);
    feet.push(p.foot === 'left' ? 'L' : 'R');
    if (!Number.isInteger(p.weakFoot)) throw Error(`${p.profileId}: invalid weak foot`);
    out.weakFoot.push(p.weakFoot);
    if (!Number.isInteger(p.sourceOverall)) throw Error(`${p.profileId}: invalid source overall`);
    out.sourceOverall.push(p.sourceOverall);
    const s = p.source;
    if (s.clubId == null) {
      if (s.club != null || s.leagueId != null) throw Error(`${p.profileId}: club without id`);
      out.club.push(-1);
    } else {
      const t = teams[team(String(s.clubId))];
      if (t.name !== s.club || String(t.leagueId) !== String(s.leagueId) || t.id !== s.clubId)
        throw Error(`${p.profileId}: club fields differ from team ${t.id}`);
      out.club.push(team(String(s.clubId)));
    }
    out.nation.push(nation(s.nationality));
    sameKeys(p.attrs, attributeKeys, `${p.profileId} attrs`);
    attributeKeys.forEach((key, k) => {
      if (!Number.isInteger(p.attrs[key]))
        throw Error(`${p.profileId}: attribute ${key} is not an integer`);
      attrs[k].push(p.attrs[key]);
    });
    sameKeys(p.tendencies, tendencyKeys, `${p.profileId} tendencies`);
    tendencyKeys.forEach((key, k) =>
      tendencies[k].push(scaled(p.tendencies[key], `${key} tendency`)),
    );
    out.tags.push(p.tags.map(t => code(badge(t), 'badge')).join(''));
    const explicit = p.inference?.badges || [];
    out.evidence.push(explicit.map(e => code(badge(e.tag), 'badge')).join(''));
    for (const e of explicit) out.evidenceConfidence.push(scaled(e.confidence, 'confidence'));
  }
  out.position = positionCodes.join('');
  out.foot = feet.join('');
  out.attrs = attrs.flat();
  out.tendencies = tendencies.flat();
  const encodedTeams = teams.map(t => {
    const { lineups, bestFormation, ...rest } = t;
    if (!lineups) return rest;
    const members = new Map(
      players.filter(p => String(p.source.clubId) === String(t.id)).map((p, i) => [p, i]),
    );
    return {
      ...rest,
      lineups: formations.map(f =>
        (lineups[f] || [])
          .map(p => {
            if (!members.has(p)) throw Error(`${t.name}: lineup player is not a club member`);
            return code(members.get(p), 'club member');
          })
          .join(''),
      ),
      bestFormation: bestFormation == null ? -1 : formations.indexOf(bestFormation),
    };
  });
  return {
    format: CATALOG_FORMAT,
    version: CATALOG_VERSION,
    compilerVersion: catalog.compilerVersion,
    source: catalog.source,
    selection: catalog.selection,
    attributeKeys,
    tendencyKeys,
    dictionaries: { positions: [...positions], badges: [...badges] },
    formations: [...formations],
    precomputed: { ...catalog.precomputed },
    leagues: catalog.leagues,
    teams: encodedTeams,
    nations,
    players: out,
  };
}
function profileIdParts(players) {
  const match = players[0]?.profileId.match(/^(\D*)\d+(\D.*)$/);
  if (!match) throw Error('Unsupported profile id format');
  const [, prefix, suffix] = match;
  for (const p of players)
    if (!new RegExp(`^${escape(prefix)}\\d+${escape(suffix)}$`).test(p.profileId))
      throw Error(`Profile id ${p.profileId} does not match ${prefix}<id>${suffix}`);
  return [prefix, suffix];
}
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function decodeCatalog(file) {
  const steps = decodeCatalogSteps(file);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}
/**
 * The same decode in steps (500 players per step) so a browser can spread it over frames:
 * call next() until done; the last result's value is the catalog.
 */
export function* decodeCatalogSteps(file) {
  if (file?.format !== CATALOG_FORMAT || file.version !== CATALOG_VERSION)
    throw Error('Unsupported catalog format');
  const c = file.players,
    n = c.count,
    K = file.attributeKeys.length,
    T = file.tendencyKeys.length,
    positions = file.dictionaries.positions,
    badges = file.dictionaries.badges;
  const decodeCodes = (text, dictionary) => {
    const out = new Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = dictionary[CODE.get(text[i])];
    return out;
  };
  const teams = file.teams.map(t => {
    const { lineups, bestFormation, ...rest } = t;
    return rest;
  });
  const players = new Array(n);
  let evidenceIndex = 0;
  for (let i = 0; i < n; i++) {
    const attrs = {},
      tendencies = {};
    for (let k = 0; k < K; k++) attrs[file.attributeKeys[k]] = c.attrs[k * n + i];
    for (let k = 0; k < T; k++) tendencies[file.tendencyKeys[k]] = c.tendencies[k * n + i] / SCALE;
    const club = c.club[i] >= 0 ? teams[c.club[i]] : null;
    const evidence = decodeCodes(c.evidence[i], badges).map(tag => ({
      tag,
      confidence: c.evidenceConfidence[evidenceIndex++] / SCALE,
    }));
    players[i] = {
      profileId: c.profileIdPrefix + c.sourceId[i] + c.profileIdSuffix,
      name: c.name[i],
      fullName: c.fullName[i],
      primaryPosition: positions[CODE.get(c.position[i])],
      secondaryPositions: decodeCodes(c.secondary[i], positions),
      attrs,
      foot: c.foot[i] === 'L' ? 'left' : 'right',
      weakFoot: c.weakFoot[i],
      tendencies,
      tags: decodeCodes(c.tags[i], badges),
      sourceOverall: c.sourceOverall[i],
      source: {
        club: club ? club.name : null,
        clubId: club ? club.id : null,
        leagueId: club ? club.leagueId : null,
        nationality: file.nations[c.nation[i]].name,
      },
      inference: { badges: evidence },
    };
    if (i % 500 === 499) yield;
  }
  // Club lineups refer to the club's players in catalog order.
  const members = teams.map(() => []);
  for (let i = 0; i < n; i++) if (c.club[i] >= 0) members[c.club[i]].push(players[i]);
  file.teams.forEach((t, i) => {
    if (!t.lineups) return;
    const lineups = {};
    t.lineups.forEach((text, f) => {
      if (text) lineups[file.formations[f]] = [...text].map(ch => members[i][CODE.get(ch)]);
    });
    teams[i].lineups = lineups;
    teams[i].bestFormation = t.bestFormation >= 0 ? file.formations[t.bestFormation] : null;
  });
  return {
    schemaVersion: CATALOG_VERSION,
    compilerVersion: file.compilerVersion,
    source: file.source,
    selection: file.selection,
    attributeKeys: [...file.attributeKeys],
    dictionaries: { positions: [...positions], badges: [...badges] },
    formations: [...file.formations],
    precomputed: { ...file.precomputed },
    leagues: file.leagues,
    teams,
    nations: file.nations,
    players,
  };
}

// Lookup Maps: byId (profileId → player), byNation (nationality name → players),
// byLeague (league id → players), byClub (club id → players). Lists keep catalog order.
export function indexCatalog(catalog) {
  const group = key => {
    const map = new Map();
    for (const p of catalog.players) {
      const k = key(p);
      if (k == null) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(p);
    }
    return map;
  };
  catalog.byId = new Map(catalog.players.map(p => [p.profileId, p]));
  catalog.byNation = group(p => p.source.nationality);
  catalog.byLeague = group(p => (p.source.leagueId == null ? null : String(p.source.leagueId)));
  catalog.byClub = group(p => (p.source.clubId == null ? null : String(p.source.clubId)));
  return catalog;
}
