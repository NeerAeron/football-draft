// Past versions on the scale of today's cards: who is who across the titles (FIFA 98–14), and
// what each title's numbers are worth as an overall on EA's modern 1–99 scale.
//
// 1. Titles with an official overall (FIFA 09–23) keep it: that is the rating of the version.
// 2. Titles without one (FIFA 98–08) are chain-linked to the next title through the players
//    both have (`calibrateLink`): FIFA 08 against FIFA 09, 07 against the calibrated 08, … back
//    to FIFA 98. A title's skills are read with EA's own overall formula of the nearest era
//    that printed one (`eraFormula`: least squares on FIFA 09/10, per position — it reproduces
//    the printed overalls of FIFA 09–11 within a point); a straight line per position group
//    turns that reading into an overall so that the shared players carry, on average and in
//    spread, what the next title gives them (less a year of ageing, measured on FIFA 09–14).
//    Real differences between years survive: nothing is ranked or forced to a common top.
//    The coarse scales of FIFA 98–2003 (8 to 16 levels) are first put on the 1–99 scale skill
//    by skill, the same way.
// 3. FIFA 98–2003 are too coarse to tell a star from a good player on their own (`poolCoarse`):
//    their ratings agree with the next data generation's far less than two official titles
//    agree with each other. That is measured (one number, `coarseTrust`), and a card of those
//    years is rated by what all the data generations within three years say about the player
//    — each weighed by its trust, a fully described title nearly in full — together with the
//    title's average, so thin evidence stays near the average. A player whom only one coarse
//    generation knows gets no card: nothing tells him from an invented name. Keepers are
//    linked and pooled the same way with a trust of their own (FIFA 2000–04 have two keeper
//    skills, FIFA 98/99 none: three other skills stand in); a coarse keeper scale says no more
//    than the best the next title gives the keepers they share.
// 4. A card has the skills of its year, all moved by the same number of points until the
//    game's rating model shows the version's overall (`cardFields`): the model is fitted on FC
//    data and reads older skill sets a few points off what EA printed.
// Deterministic; no rating of any player is typed in.
import { sourceAttributes } from './compile-players.mjs';
import { overallRating, normalizeAttributes } from '../app/core/players/ratings.js';
import { foldDiacritics } from '../app/core/util/text.js';
import { SKILL_FIELDS } from './data/legacy-titles.mjs';

const KEEPING = ['diving', 'handling', 'kicking', 'positioning', 'reflexes'].map(
  k => `goalkeeping_${k}`,
);
const NONE = Object.freeze([]);
const clamp = v => Math.max(1, Math.min(99, v));
const avg = list => list.reduce((s, v) => s + v, 0) / list.length;
const sd = list => {
  const m = avg(list);
  return Math.sqrt(avg(list.map(v => (v - m) ** 2)));
};
const corr = (a, b) => {
  const ma = avg(a),
    mb = avg(b);
  let ab = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += (a[i] - ma) * (b[i] - mb);
    aa += (a[i] - ma) ** 2;
    bb += (b[i] - mb) ** 2;
  }
  return ab / Math.sqrt(aa * bb);
};
const round = (v, digits = 3) => Math.round(v * 10 ** digits) / 10 ** digits;

/** The rating the game shows (unrounded) for a set of compiler columns at a position. */
export function fieldRating(fields, position, overall = 50, keeping = 10) {
  const row = { ...fields, overall };
  for (const k of KEEPING) row[k] = keeping;
  return overallRating(
    {
      attrs: normalizeAttributes(sourceAttributes(row, position)),
      primaryPosition: position,
      secondaryPositions: NONE,
      role: position,
    },
    false,
    position,
  );
}
/**
 * Skills (real numbers) moved by `shift` points, as the 1–99 integers of a card. Each skill
 * rounds at its own fraction of a point (evenly spread, in SKILL_FIELDS order), so a growing
 * shift raises one skill at a time and a rating can be met to a twentieth of a point; whole
 * numbers with no shift stay as they are.
 */
export function shiftFields(values, shift = 0) {
  const out = {},
    n = SKILL_FIELDS.length;
  SKILL_FIELDS.forEach((f, i) => {
    out[f] = clamp(Math.floor(Number(values[f]) + shift + (i + 0.5) / n));
  });
  return out;
}
/**
 * A second striker (EA's CF) is a striker or a No. 10: [better, other] by the game's rating
 * of his skills (ties: striker).
 */
export function secondStrikerRoles(skills) {
  const fields = shiftFields(skills);
  return fieldRating(fields, 'AM') > fieldRating(fields, 'ST') ? ['AM', 'ST'] : ['ST', 'AM'];
}
/**
 * The card of a version: its skills, all moved by the same number of points so that the game
 * shows `target` at `position` (the closest it can get). → { fields, shift }. A keeper's
 * rating is his one goalkeeping number, so his skills stay as they are.
 */
export function cardFields(skills, position, target, keeping = 10) {
  if (position === 'GK') return { fields: shiftFields(skills), shift: 0 };
  const at = shift => fieldRating(shiftFields(skills, shift), position, 50, keeping);
  let lo = -60,
    hi = 60;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < target) lo = mid;
    else hi = mid;
  }
  const shift = Math.abs(at(lo) - target) <= Math.abs(at(hi) - target) ? lo : hi;
  return { fields: shiftFields(skills, shift), shift: round(shift, 2) };
}

// ---------------------------------------------------------------------------------------
// Who is who.

const letters = text =>
  foldDiacritics(String(text ?? ''))
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();
const TEAM_WORDS = {
  utd: 'united',
  man: 'manchester',
  atl: 'atletico',
  rep: 'republic',
  holland: 'netherlands',
  munchen: 'munich',
  munich: 'munich',
  internazionale: 'inter',
  b: 'bayern',
  r: 'real',
  st: 'saint',
};
const TEAM_NOISE = new Set(
  'fc cf ac as sc ss afc cd rc rcd sv vfb vfl club de futbol calcio the of national team sg'.split(
    ' ',
  ),
);
/** Words of a team name that identify it ("Manchester Utd." → manchester united). */
export const teamWords = name =>
  letters(name)
    .split(' ')
    .map(w => TEAM_WORDS[w] ?? w)
    .filter(w => w && !TEAM_NOISE.has(w));
const sameTeam = (a, b) => {
  if (!a.length || !b.length) return false;
  const [small, big] = a.length <= b.length ? [a, b] : [b, a];
  return small.every(w => big.includes(w));
};
const nameWords = p =>
  new Set(`${letters(p.name)} ${letters(p.fullName)}`.split(' ').filter(w => w.length > 1));
// The names a player can be looked up by when a title knows surnames only.
const nameKeys = p => {
  const keys = new Set(),
    name = letters(String(p.name).replace(/^(?:\p{L}\.\s*)+/u, '')),
    full = letters(p.fullName);
  for (const k of [name, full, letters(p.surname), full.split(' ').at(-1)]) if (k) keys.add(k);
  return keys;
};
const shareTeam = (p, q) =>
  p.clubIds.some((id, i) => id != null && q.clubIds.includes(id)) ||
  p.clubs.some(a => q.clubs.some(b => sameTeam(teamWords(a), teamWords(b))));
// The year a row says its player was born: his date of birth (FIFA 2004 on), else from his
// age — FIFA 2002 counts it in 2000, FIFA 2003 in 2003 (measured on the players both share
// with FIFA 2004) — or null. Two rows more than a year apart there are two men, whatever their
// names: EA reused ids.
const AGE_YEAR = { 2: 2000, 3: 2003 };
const birthYear = p =>
  p.born
    ? Number(p.born.slice(0, 4))
    : Number.isFinite(p.age) && p.age > 0 && AGE_YEAR[p.edition]
      ? AGE_YEAR[p.edition] - p.age
      : null;
const agesClash = (p, q) => {
  const a = birthYear(p),
    b = birthYear(q);
  return a != null && b != null && Math.abs(a - b) > 1;
};
const sameMan = (p, q) => {
  if (agesClash(p, q)) return false;
  if (p.standIn !== q.standIn) return p.standIn ? standsFor(p, q) : standsFor(q, p);
  if (p.born && q.born && p.born === q.born) return true;
  const a = nameWords(p);
  for (const w of nameWords(q)) if (a.has(w)) return true;
  return shareTeam(p, q);
};
// A row under a stand-in name ("No 9", an invented name) is the named player of the same id
// when they share a team — or whatever the teams, when the id itself was mapped (an alias).
const standsFor = (standIn, named) =>
  shareTeam(standIn, named) || !/^no\.?\s*\d+$/i.test(standIn.name);
const LOCAL_ID = 1_000_000; // FIFA 98/99 use their own ids: 98,001,109 = id 1109 of FIFA 98

/**
 * One person per player across FIFA 98–14: sets `player.person` on every row that is kept and
 * returns { persons: Map(id → { id, ea (an EA id?), rows[] }), dropped: [reasons], merged }.
 *   – FIFA 2000–14 use EA's ids (the ones FIFA 15–23 and FC 27 use). Rows of one id are one
 *     person when they agree on the date of birth, a word of the name or a club; a row that
 *     fits none of the others (an unlicensed stand-in such as "No 9", a reused id) is dropped.
 *   – FIFA 98/99 share their own ids. Such a player becomes the EA-id person when exactly one
 *     player of FIFA 2000–03 has his name and a team of his; otherwise he stays on his own
 *     (local id), and is dropped when a kept EA-id player of the same name exists whom the
 *     data cannot tell him from.
 *   – Players who are only in classic, all-star or stand-in squads are not persons at all.
 */
export function linkPersons(titles, isNation = () => false) {
  const dropped = [],
    merged = [],
    persons = new Map(),
    era = t => (t.edition >= 90 ? 'local' : 'ea'),
    byId = { local: new Map(), ea: new Map() };
  for (const t of titles)
    for (const p of t.players) {
      p.person = null;
      if (p.representativeOnly || p.otherMan) continue;
      const map = byId[era(t)];
      if (!map.has(p.id)) map.set(p.id, []);
      map.get(p.id).push(p);
    }
  // Rows of one id → groups of rows that are one man.
  const groups = rows => {
    const group = rows.map((_, i) => i);
    const find = i => (group[i] === i ? i : (group[i] = find(group[i])));
    for (let i = 0; i < rows.length; i++)
      for (let j = i + 1; j < rows.length; j++)
        if (find(i) !== find(j) && sameMan(rows[i], rows[j])) group[find(j)] = find(i);
    const out = new Map();
    rows.forEach((p, i) => {
      if (!out.has(find(i))) out.set(find(i), []);
      out.get(find(i)).push(p);
    });
    return [...out.values()];
  };
  const person = (id, ea, rows) => {
    const one = { id, ea, rows };
    for (const p of rows) p.person = one;
    persons.set(id, one);
    return one;
  };
  for (const [id, rows] of byId.ea) {
    const parts = groups(rows).sort((a, b) => b.length - a.length || b.at(-1).year - a.at(-1).year);
    person(id, true, parts[0]);
    for (const part of parts.slice(1))
      for (const p of part)
        dropped.push(
          `${p.name} (${p.title}, id ${id}): not the ${parts[0].at(-1).name} of that id`,
        );
  }
  // One man under two EA ids (Raúl and Bergkamp change id between FIFA 2003 and 2004): the
  // same name, never in the same title, and a team in common within two years — and the same
  // birthday where both ids have one. He goes on under the id of his later rows.
  // A one-word name (Juninho, Leonardo) needs a club in common: two Brazilians of one name
  // share the national team.
  const nationTeams = new Set(
      titles.flatMap(t => t.players.map(p => teamWords(p.nationName ?? '').join(' '))),
    ),
    clubs = p =>
      p.clubs.filter(team => !nationTeams.has(teamWords(team).join(' ')) && !isNation(team)),
    shareClub = (p, q) =>
      clubs(p).some(a => clubs(q).some(b => sameTeam(teamWords(a), teamWords(b)))),
    eaPersons = [...persons.values()],
    twins = new Map();
  // A row with a club: the title has him in a league's squad, not only in a national team's
  // (the national squads of the early titles are filled out with whoever was at hand).
  for (const t of titles) for (const p of t.players) p.atClub = clubs(p).length > 0;
  for (const one of eaPersons)
    for (const k of new Set(one.rows.map(p => letters(p.fullName)))) {
      if (!twins.has(k)) twins.set(k, []);
      twins.get(k).push(one);
    }
  for (const [name, list] of twins)
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i],
          b = list[j];
        if (!persons.has(a.id) || !persons.has(b.id)) continue;
        const apart = a.rows.every(p => b.rows.every(q => q.edition !== p.edition)),
          born = (x, y) => x.rows.find(p => p.born)?.born === y.rows.find(p => p.born)?.born,
          dated = a.rows.some(p => p.born) && b.rows.some(p => p.born),
          together = name.includes(' ') ? (p, q) => shareTeam(p, q) : shareClub,
          near = a.rows.some(p =>
            b.rows.some(q => Math.abs(p.year - q.year) <= 2 && together(p, q)),
          );
        if (!apart || !near || (dated && !born(a, b))) continue;
        if (a.rows.some(p => b.rows.some(q => agesClash(p, q)))) continue;
        const [keep, gone] = a.rows.at(-1).year >= b.rows.at(-1).year ? [a, b] : [b, a];
        keep.rows = [...keep.rows, ...gone.rows].sort((p, q) => p.year - q.year);
        for (const p of keep.rows) p.person = keep;
        persons.delete(gone.id);
        merged.push(`${keep.rows.at(-1).name}: ids ${gone.id} and ${keep.id}`);
      }
  // FIFA 98/99 → the EA-id person of the same name and team, when there is exactly one.
  const early = titles.filter(t => era(t) === 'ea' && t.edition <= 3).flatMap(t => t.players),
    byName = new Map();
  for (const q of early) {
    if (!q.person) continue;
    for (const k of nameKeys(q)) {
      if (!byName.has(k)) byName.set(k, new Set());
      byName.get(k).add(q.person);
    }
  }
  const claims = new Map(); // EA-id person → [local groups]
  const locals = [];
  for (const [id, rows] of byId.local)
    for (const part of groups(rows)) {
      // A namesake is a candidate when he shares a club with the FIFA 98/99 player, or a
      // national team and the part of the pitch he plays in (the names are surnames: a Brazil
      // striker "Lucio" is not the centre-back Lúcio). Of several, the one with the club.
      const candidates = new Set(),
        clubMates = new Set(),
        named = new Set();
      for (const p of part)
        for (const k of nameKeys(p))
          for (const q of byName.get(k) || []) {
            named.add(q);
            // (A keeper is never an outfielder's later self: Flamengo's striker Romário is
            // not its keeper Zé Romário.)
            const early = q.rows.filter(r => r.edition <= 3 && isKeeper(r) === isKeeper(p));
            if (early.some(r => shareClub(p, r))) {
              clubMates.add(q);
              candidates.add(q);
            } else if (early.some(r => shareNation(p, r) && zone(r) === zone(p))) candidates.add(q);
          }
      const chosen = candidates.size > 1 && clubMates.size === 1 ? clubMates : candidates,
        local = {
          id: part[0].edition * LOCAL_ID + id,
          rows: part,
          named: named.size,
          // Several later players could be him: the data cannot say which.
          ambiguous: chosen.size > 1,
        };
      if (chosen.size === 1) {
        const [q] = chosen;
        if (!claims.has(q)) claims.set(q, []);
        claims.get(q).push(local);
      } else locals.push(local);
    }
  for (const [q, list] of claims) {
    // Two FIFA 98/99 players claiming one man: the one with more rows is him.
    list.sort((a, b) => b.rows.length - a.rows.length || a.id - b.id);
    for (const p of list[0].rows) {
      p.person = q;
      q.rows.push(p);
    }
    q.rows.sort((a, b) => a.year - b.year);
    for (const other of list.slice(1)) locals.push({ ...other, rival: q, ambiguous: true });
  }
  for (const local of locals) {
    const one = person(local.id, false, local.rows);
    one.namesakes = local.named; // EA-id players of FIFA 2000–03 with his name
    one.ambiguous = !!local.ambiguous;
    if (local.rival) one.namesakes = Math.max(1, one.namesakes);
  }
  return { persons, dropped, merged };
}
// Keeper, defender or further up: as much of a position as two titles five years apart agree on.
const zone = p =>
  p.positions[0] === 'GK' ? 'GK' : ['CB', 'LB', 'RB'].includes(p.positions[0]) ? 'DEF' : 'UP';
// A team in common, clubs or national teams (the early titles list both).
function shareNation(p, q) {
  const a = p.teams.map(teamWords),
    b = q.teams.map(teamWords);
  return a.some(x => b.some(y => sameTeam(x, y)));
}

// ---------------------------------------------------------------------------------------
// What the numbers are worth.

const isKeeper = p => p.positions[0] === 'GK';
export const GROUPS = ['DEF', 'MID', 'WIDE', 'ST'];
const GROUP = {
  GK: 'GK',
  CB: 'DEF',
  LB: 'DEF',
  RB: 'DEF',
  DM: 'MID',
  CM: 'MID',
  AM: 'MID',
  LM: 'WIDE',
  RM: 'WIDE',
  LW: 'WIDE',
  RW: 'WIDE',
  ST: 'ST',
};
export const groupOf = position => GROUP[position];
const COARSE = edition => edition >= 90 || edition <= 3; // FIFA 98–2003: 8 to 16 levels
// Titles that share a database format and most of its numbers count as one witness:
// FIFA 98/99 (.dbi, 13–17 skills), 2000/01 (12 skills, 1–8), 2002/03 (8 + 3 skills).
const generation = edition =>
  edition >= 90
    ? 'FIFA 98/99'
    : edition <= 1
      ? 'FIFA 2000/01'
      : edition <= 3
        ? 'FIFA 2002/03'
        : edition;
const MIN_SHARED = 20; // the least shared players a link is fitted on
export const POOL_YEARS = 3; // how far apart two titles may be to speak about the same player
// What a fully described title is trusted with next to a coarse one (nine parts in ten: it
// all but decides, the coarse card still leans its own way a little).
export const FULL_TRUST = 0.9;

// A second striker's position, once his skills are on the modern scale.
function settle(p) {
  if (!p.secondStriker) return;
  const roles = secondStrikerRoles(p.skills);
  p.positions = [...roles, ...p.positions.filter(x => !roles.includes(x))];
}
/** A title with an official overall (FIFA 09–14): its skills as they are, its overall kept. */
export function officialTitle(title) {
  for (const p of title.players) {
    if (!p.person) continue;
    p.skills = p.native;
    settle(p);
    p.scale = p.given = p.overall;
  }
}

// Least squares with a small ridge (normal equations, Gaussian elimination with pivoting).
function leastSquares(rows, target, ridge) {
  const n = rows[0].length,
    A = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  rows.forEach((x, r) => {
    for (let i = 0; i < n; i++) {
      A[i][n] += x[i] * target[r];
      for (let j = 0; j < n; j++) A[i][j] += x[i] * x[j];
    }
  });
  for (let i = 1; i < n; i++) A[i][i] += ridge * rows.length;
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[pivot][i])) pivot = k;
    [A[i], A[pivot]] = [A[pivot], A[i]];
    for (let k = i + 1; k < n; k++) {
      const f = A[k][i] / A[i][i];
      for (let j = i; j <= n; j++) A[k][j] -= f * A[i][j];
    }
  }
  const w = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = A[i][n];
    for (let j = i + 1; j < n; j++) sum -= A[i][j] * w[j];
    w[i] = sum / A[i][i];
  }
  return w;
}
// The skills a formula reads: the card's attributes, not the three tendency columns.
const FORMULA_FIELDS = SKILL_FIELDS.filter(
  f => !['mentality_aggression', 'mentality_positioning', 'skill_curve'].includes(f),
);
const FORMULA_MIN = 40, // rows a position needs for a formula of its own (else its group's)
  FORMULA_RIDGE = 0.01;
/**
 * EA's overall formula of an era, recovered from titles that print an overall: per position
 * (per position group for a rare one) the least-squares weights of the skills. Returns
 * `read(p)` → the overall those weights give a row's `skills`.
 */
export function eraFormula(titles) {
  const rows = titles.flatMap(t => t.players.filter(p => p.person && !isKeeper(p))),
    vector = p => [1, ...FORMULA_FIELDS.map(f => p.skills[f])],
    fitted = list =>
      leastSquares(
        list.map(vector),
        list.map(p => p.overall),
        FORMULA_RIDGE,
      ),
    weights = new Map();
  for (const g of GROUPS) weights.set(g, fitted(rows.filter(p => groupOf(p.positions[0]) === g)));
  for (const position of new Set(rows.map(p => p.positions[0]))) {
    const list = rows.filter(p => p.positions[0] === position);
    if (list.length >= FORMULA_MIN) weights.set(position, fitted(list));
  }
  return p => {
    const w = weights.get(p.positions[0]) ?? weights.get(groupOf(p.positions[0])),
      x = vector(p);
    return x.reduce((sum, v, i) => sum + v * w[i], 0);
  };
}

/** Pairs of rows of one person in two titles, outfielders or keepers on both sides. */
function sharedPlayers(a, b, keepers) {
  const next = new Map(b.players.filter(q => q.person && q.scale != null).map(q => [q.person, q])),
    out = [];
  for (const p of a.players) {
    const q = p.person && next.get(p.person);
    if (q && isKeeper(p) === keepers && isKeeper(q) === keepers) out.push([p, q]);
  }
  return out;
}

/**
 * What a year does to the players two official titles share (FIFA 09→10 … 13→14):
 * { drift: mean change of the overall, spread: sd before / sd after, correlation: of the
 * formula's reading of the earlier title with the overall of the later } — the yardstick of
 * the chain. Outfielders and keepers apart.
 */
export function yearOnYear(titles, read, formulaTitles) {
  const out = {};
  for (const keepers of [false, true]) {
    const drift = [],
      spread = [],
      correlation = [];
    for (let i = 0; i + 1 < titles.length; i++) {
      const pairs = sharedPlayers(titles[i], titles[i + 1], keepers),
        a = pairs.map(([p]) => p.scale),
        b = pairs.map(([, q]) => q.scale);
      drift.push(avg(b) - avg(a));
      spread.push(sd(a) / sd(b));
      // Only where the formula is EA's own: the titles it was fitted on.
      if (formulaTitles.includes(titles[i]))
        correlation.push(
          corr(
            pairs.map(([p]) => (keepers ? p.keeping : read(p))),
            b,
          ),
        );
    }
    out[keepers ? 'keepers' : 'outfield'] = {
      drift: round(avg(drift)),
      spread: round(avg(spread)),
      correlation: round(avg(correlation)),
    };
  }
  return out;
}

/**
 * Chain-link `title` (no official overall) to `next` (official, or linked already). Sets on
 * every kept row `skills` (on the 1–99 scale), `reading` and `scale` — his overall on the scale
 * of the next title, or null for a keeper when the two titles share too few keepers to say
 * what this title's keeper skills are worth. Returns the link's numbers for the provenance.
 */
export function calibrateLink(title, next, yardstick, read) {
  const coarse = COARSE(title.edition),
    players = title.players.filter(p => p.person),
    outfield = sharedPlayers(title, next, false),
    link = { title: title.title, against: next.title, shared: outfield.length };
  if (outfield.length < MIN_SHARED)
    throw Error(`${title.title}: only ${outfield.length} players shared with ${next.title}`);
  // 1. Coarse scales → 1–99, skill by skill: the shared outfielders keep the mean and spread
  //    the next title gives them in that skill.
  const scales = {};
  for (const f of SKILL_FIELDS) {
    const x = outfield.map(([p]) => p.native[f]),
      y = outfield.map(([, q]) => q.skills[f]),
      spread = sd(x);
    scales[f] =
      coarse && spread > 0
        ? { slope: sd(y) / spread, at: avg(x), to: avg(y) }
        : { slope: 1, at: 0, to: 0 };
  }
  for (const p of players) {
    p.skills = {};
    for (const f of SKILL_FIELDS) {
      const s = scales[f];
      p.skills[f] = s.to + s.slope * (p.native[f] - s.at);
    }
    settle(p);
    p.reading = isKeeper(p) ? p.keeping : read(p);
    p.scale = p.given = null;
  }
  if (coarse)
    link.skills = Object.fromEntries(SKILL_FIELDS.map(f => [f, round(scales[f].slope, 2)]));
  // 2. The formula's reading of those skills (a keeper: the mean of his keeper skills) → an
  //    overall: the line through the shared players' mean and spread a year on.
  const fit = (pairs, kind, name) => {
    const x = pairs.map(([p]) => p.reading),
      y = pairs.map(([, q]) => q.scale),
      line = {
        slope: (sd(y) * yardstick[kind].spread) / sd(x),
        at: avg(x),
        to: avg(y) - yardstick[kind].drift,
        // A coarse keeper scale (two skills of eight levels, or none at all) has the best and
        // the merely good on its top level: it says no more than the best the next title gives
        // the keepers they share.
        top: coarse && kind === 'keepers' ? Math.max(...y) : Infinity,
      };
    link[name] = {
      shared: pairs.length,
      slope: round(line.slope),
      from: round(line.at),
      to: round(line.to),
      correlation: round(corr(x, y)),
    };
    return line;
  };
  // One line per position group (the model does not read every role of an old title alike),
  // the all-outfield line for a group with too few shared players; keepers have their own.
  const lines = { outfield: fit(outfield, 'outfield', 'outfield'), GK: null },
    keepers = sharedPlayers(title, next, true);
  for (const g of GROUPS) {
    const pairs = outfield.filter(([p]) => groupOf(p.positions[0]) === g);
    lines[g] = pairs.length >= MIN_SHARED ? fit(pairs, 'outfield', g) : lines.outfield;
  }
  // Keepers: their own line, when the two titles have enough keepers in common. (FIFA 98/99
  // have no keeper skills: reaction, agility and awareness stand in, and the pooling below
  // weighs them by what they turn out to be worth.)
  if (keepers.length >= MIN_SHARED) lines.GK = fit(keepers, 'keepers', 'keepers');
  else link.keepers = { shared: keepers.length, skills: title.keeper.length, cards: false };
  for (const p of players) {
    const line = lines[groupOf(p.positions[0])];
    if (!line) continue;
    p.scale = Math.min(line.top, line.to + line.slope * (p.reading - line.at));
    if (!coarse) p.given = p.scale;
  }
  return link;
}

/**
 * How far a coarse title can be trusted, from the links across the borders of the three coarse
 * generations (`links` as calibrateLink returned them): the correlation there against the
 * yardstick, squared, is the product of the two sides' reliabilities — both coarse at
 * FIFA 99→2000 and 2001→2002, one coarse at 2003→2004. One number for all three.
 */
export function coarseTrust(links, yardstick, kind = 'outfield') {
  const share = from =>
    Math.min(
      1,
      ((links.find(l => l.title === from)[kind].correlation ?? 0) / yardstick[kind].correlation) **
        2,
    );
  return round(
    avg([Math.sqrt(share('FIFA 99')), Math.sqrt(share('FIFA 2001')), share('FIFA 2003')]),
  );
}

/**
 * The overall (`given`) of the coarse titles' outfielders: the weighted mean of what the data
 * generations within POOL_YEARS say about the player (each by its nearest title; a coarse one
 * is trusted `trust`, any other FULL_TRUST) and of the title's average. A row that no other
 * generation backs stays without (`given` null). Returns the counts.
 */
export function poolCoarse(titles, trust, keeperTrust = 0) {
  const stats = { trust, keeperTrust, cards: 0, keepers: 0, alone: 0, unbacked: 0 };
  for (const title of titles) {
    if (!COARSE(title.edition)) continue;
    const own = generation(title.edition);
    for (const keepers of [false, true]) {
      const rows = title.players.filter(
          p => p.person && p.scale != null && isKeeper(p) === keepers,
        ),
        coarse = keepers ? keeperTrust : trust;
      if (!rows.length || !(coarse > 0)) continue;
      const mean = avg(rows.map(p => p.scale));
      for (const p of rows) {
        const nearest = new Map([[own, p]]);
        for (const q of p.person.rows) {
          const g = generation(q.edition),
            gap = Math.abs(q.year - p.year);
          if (g === own || q.scale == null || isKeeper(q) !== keepers || gap > POOL_YEARS) continue;
          const best = nearest.get(g);
          if (
            !best ||
            gap < Math.abs(best.year - p.year) ||
            (gap === Math.abs(best.year - p.year) && q.year > best.year)
          )
            nearest.set(g, q);
        }
        // A row no other generation backs: when it may be a later player the data cannot
        // tell (a FIFA 98/99 name with several possible later selves) it gets nothing — he
        // would be in the game twice — and nothing either when the title has him in a national
        // squad only. Otherwise it is rated by its own title alone, which
        // the weights below pull most of the way to the title's average: a card, a modest one
        // (Klinsmann, Bebeto and Dunga retired before FIFA 2000 could vouch for them).
        if (nearest.size < 2 && (p.person.ambiguous || !p.atClub)) {
          stats.unbacked++;
          continue;
        }
        if (nearest.size < 2) stats.alone++;
        // A witness of reliability r weighs r / (1 − r) against the one part of "an average
        // player of this title": three coarse witnesses of 0.3 together are trusted 0.56.
        let weight = 1,
          sum = mean;
        for (const [g, q] of nearest) {
          const r = typeof g === 'string' ? coarse : FULL_TRUST,
            w = r / (1 - r);
          weight += w;
          sum += w * q.scale;
        }
        p.given = sum / weight;
        p.backing = [...nearest.keys()]
          .filter(g => g !== own)
          .map(g => (typeof g === 'string' ? g : `FIFA ${String(g).padStart(2, '0')}`));
        stats[keepers ? 'keepers' : 'cards']++;
      }
    }
  }
  return stats;
}

/**
 * All of the above for the decoded titles (FIFA 98–14, oldest first): persons, then every kept
 * row gets `skills`, `positions` (second strikers settled) and `given` — his overall on the
 * modern scale, or null when the title cannot say (an unbacked coarse row, a keeper of a title
 * without keeper link). Returns { persons, dropped, yardstick, links, pool } for the build's
 * provenance.
 */
export function calibrateTitles(titles, isNation = () => false) {
  const { persons, dropped, merged } = linkPersons(titles, isNation),
    first = titles.findIndex(t => t.players[0].overall != null),
    official = titles.slice(first);
  for (const t of official) officialTitle(t);
  // The two official titles next to the chain share the older titles' database layout.
  const era = official.slice(0, 2),
    read = eraFormula(era),
    yardstick = yearOnYear(official, read, era),
    links = [];
  for (let i = first - 1; i >= 0; i--)
    links.push(calibrateLink(titles[i], titles[i + 1], yardstick, read));
  const keepersLinked = links.every(l => l.keepers.correlation != null),
    pool = poolCoarse(
      titles,
      coarseTrust(links, yardstick),
      keepersLinked ? coarseTrust(links, yardstick, 'keepers') : 0,
    );
  return { persons, dropped, merged, yardstick, links, pool };
}
