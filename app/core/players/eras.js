// Era pools at run time: "nation X in era Y" — that nation's best 26 players of a World Cup
// cycle, each at his best version inside the era's years. Decoded from app/data/eras.v1.json
// (eras-codec.js) and attached to a decoded catalog as `catalog.eras`. Era cards are NOT part
// of catalog.players: league and club pools, opponents and the bosses never see them. Pure: no
// DOM, no fetch. The contract is in docs/draft-api.md ("Eras").
//
// An era card is shaped like a catalog player plus `era` (the era's id), `year` (the year of
// that version's ratings), `edition` (the title's number: 98, 99, 0–26), `person` ('ea:<EA
// id>': one man, whatever the card) and, when he is in the catalog, `eraOf` (the catalog
// player's profileId). The 2026 era holds today's catalog players as they are (the same
// objects) unless an FC 24–26 version of the man shows more.
import { overallRating } from './ratings.js';
import { normalizeBadges } from './badges.js';
import { badgeStamp } from './catalog-derived.js';

/**
 * World Cup cycles, oldest first: an era holds the ratings years that end with its tournament
 * and is named by its hosts. `label` is the full name (headers, sentences); `short` is the one
 * for a reel, a chip or a row (at most 15 characters: only the 2026 hosts are abbreviated).
 */
export const ERAS = Object.freeze(
  [
    [1998, 'France 98', 'France 98', 1997, 1998],
    [2002, 'Korea/Japan 02', 'Korea/Japan 02', 1999, 2002],
    [2006, 'Germany 06', 'Germany 06', 2003, 2006],
    [2010, 'South Africa 10', 'South Africa 10', 2007, 2010],
    [2014, 'Brazil 14', 'Brazil 14', 2011, 2014],
    [2018, 'Russia 18', 'Russia 18', 2015, 2018],
    [2022, 'Qatar 22', 'Qatar 22', 2019, 2022],
    [2026, 'USA/Canada/Mexico 26', 'USA/CAN/MEX 26', 2023, 2026],
  ].map(([id, label, short, from, to]) => Object.freeze({ id, label, short, from, to })),
);
/** Today's era: the one the catalog's players belong to. */
export const CURRENT_ERA = ERAS.at(-1).id;
/** The size of an era pool: a World Cup squad. */
export const ERA_SQUAD = 26;

export const eraById = id => ERAS.find(e => e.id === Number(id)) ?? null;
export const eraOfYear = year => ERAS.find(e => year >= e.from && year <= e.to) ?? null;

const shown = p => overallRating(p, true, p.primaryPosition);
const PERSON = /^ea:(\d+):/;
/**
 * One person, whatever the card: 'ea:<EA id>' for a catalog player, an era card, a legend or
 * a prime version (two ids of one man are merged by the compiler).
 */
export function personId(p) {
  if (p.person) return p.person;
  const m = PERSON.exec(p.profileId);
  return m ? `ea:${m[1]}` : p.profileId;
}
/** The era a player was drafted from: an era card's, else today's. */
export const eraOf = p => p.era ?? CURRENT_ERA;

const poolKey = (era, nation) => `${era}|${nation}`;

/**
 * Attach decoded eras data (decodeEras) to a catalog (idempotent). Returns the catalog.
 * A file built for another catalog build still attaches: a member the catalog does not have
 * is left out of his pool, a card of a player it does not know is nobody's other version.
 */
export function attachEras(catalog, data) {
  const steps = attachErasSteps(catalog, data);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}
/**
 * attachEras as a step-wise generator (drive it with `stepped()` of services/catalog.js):
 * yields every couple of hundred cards and pools, returns the catalog.
 */
export function* attachErasSteps(catalog, data, chunk = 200) {
  if (catalog.eras) return catalog;
  const teams = new Map((catalog.teams || []).map(t => [String(t.id), t])),
    current = catalog.byId ?? new Map(catalog.players.map(p => [p.profileId, p])),
    nationInfo = new Map((catalog.nations || []).map(n => [n.name, n])),
    stale = data.precomputed?.badges !== badgeStamp(),
    byId = new Map(),
    persons = new Map(),
    ratings = new Map(); // filled on demand (bestVersion)
  let done = 0;
  for (const p of data.cards) {
    if (++done % chunk === 0) yield done;
    const team = p.source.clubId == null ? null : teams.get(String(p.source.clubId)),
      era = eraOfYear(p.year),
      card = {
        ...p,
        captain: false,
        era: era ? era.id : null,
        person: personId(p),
        ...(p.eraOf != null && !current.has(p.eraOf) ? { eraOf: undefined } : {}),
        source: {
          club: team ? team.name : null,
          clubId: team ? team.id : null,
          leagueId: team ? team.leagueId : null,
          nationality: p.source.nationality,
        },
      };
    if (stale) card.tags = normalizeBadges(card, card.tags);
    byId.set(card.profileId, card);
    if (!persons.has(card.person)) persons.set(card.person, []);
    persons.get(card.person).push(card);
  }
  for (const list of persons.values()) list.sort((a, b) => a.year - b.year);
  const pools = new Map(),
    nations = new Map(ERAS.map(e => [e.id, []])),
    today = new Map(); // person → the catalog player, when he is his own 2026 card
  for (const pool of data.pools) {
    if (++done % 20 === 0) yield done;
    // The file has a pool's members best first (shown rating, the later year, the id).
    const members = [];
    for (const id of pool.members) {
      const p = byId.get(id) ?? current.get(id);
      if (!p) continue;
      if (!p.era) today.set(personId(p), p);
      members.push(p);
    }
    Object.freeze(members);
    pools.set(poolKey(pool.era, pool.nation), members);
    const info = nationInfo.get(pool.nation);
    nations.get(pool.era)?.push(
      Object.freeze({
        name: pool.nation,
        code: info?.code ?? null,
        flag: info?.flag ?? null,
        strength: pool.strength,
        size: members.length,
        keepers: members.filter(p => p.primaryPosition === 'GK').length,
      }),
    );
  }
  for (const list of nations.values())
    list.sort((a, b) => b.strength - a.strength || (a.name < b.name ? -1 : 1));
  catalog.eras = {
    list: ERAS.map(e =>
      Object.freeze({
        ...e,
        // What a pool without a goalkeeper is rated with in goal (see `strength`).
        keeperLevel: data.eras.find(d => d.id === e.id)?.keeperLevel ?? null,
        nations: Object.freeze(nations.get(e.id)),
      }),
    ),
    byId,
    pools,
    persons,
    today,
    ratings,
    current,
  };
  return catalog;
}

const NONE = Object.freeze([]);
/**
 * Every era with its spinnable nations (strongest first): [{ id, label, short, from, to,
 * keeperLevel, nations }]. A nation's pool may have no goalkeeper (`keepers: 0`).
 */
export const eraList = catalog => catalog?.eras?.list ?? NONE;
/** The spinnable nations of an era: [{ name, code, flag, strength, size, keepers }]. */
export const eraNations = (catalog, eraId) =>
  eraList(catalog).find(e => e.id === Number(eraId))?.nations ?? NONE;
/** The pool of a nation in an era: ≤ 26 players, best first (the same frozen array every call). */
export const eraPool = (catalog, eraId, nation) =>
  catalog?.eras?.pools.get(poolKey(Number(eraId), nation)) ?? NONE;
/** An era card by profileId (null when unknown or no eras are attached). */
export const eraPlayer = (catalog, id) => catalog?.eras?.byId.get(String(id)) ?? null;

/**
 * A person's cards in era order: his era cards, then — for a man in the catalog who has no
 * FC 24–26 card of his own — the catalog player.
 */
export function personVersions(catalog, p) {
  const eras = catalog?.eras;
  if (!eras) return [];
  const key = personId(p),
    cards = eras.persons.get(key) ?? NONE,
    now = eras.today.get(key) ?? catalogPlayer(eras, p, cards);
  return now && !cards.some(c => c.era === CURRENT_ERA) ? [...cards, now] : [...cards];
}
function catalogPlayer(eras, p, cards) {
  const id = p.eraOf ?? p.primeOf ?? p.legendOf ?? cards.find(c => c.eraOf)?.eraOf;
  return (id && eras.current.get(id)) || (p.era || p.prime || p.legend ? null : p);
}
/**
 * The Prime: the best version of the same person across all titles — the card that shows the
 * most (ties: the latest) — or null when none shows more than `p` does.
 */
export function bestVersion(catalog, p) {
  const eras = catalog?.eras;
  if (!eras || !p) return null;
  const rating = q => {
    if (!eras.ratings.has(q)) eras.ratings.set(q, shown(q));
    return eras.ratings.get(q);
  };
  let best = null;
  for (const q of personVersions(catalog, p))
    if (
      q !== p &&
      (!best ||
        rating(q) > rating(best) ||
        (rating(q) === rating(best) && (q.year ?? Infinity) > (best.year ?? Infinity)))
    )
      best = q;
  return best && rating(best) > shown(p) ? best : null;
}
