// Draft session: one spin per pick from a pluggable pool source, honest weights, a GK/outfield
// dead-end guard, placement with visible fit, serialise/restore and match-config helpers.
// World Cup drafts (`eras`) spin an era and a nation for every pick — the pool is that nation's
// squad of that World Cup cycle — and have three tokens: a nation respin, an era respin and the
// Prime (a drafted player becomes his best version). The other drafts spin today's players and
// have re-rolls. Pure and deterministic for a seed; the UI must never consume its RNG.
// API guide with examples: docs/draft-api.md.
import { CONFIG, DEFAULT_CONFIG } from '../config/config.js';
import { lcgNext, LCG_RANGE } from '../util/rng.js';
import { FORMATIONS } from '../players/formations.js';
import { playerInitials } from '../players/lineups.js';
import { baseProfileId, editionYear } from '../players/legends.js';
import {
  CURRENT_ERA,
  eraList,
  eraPool,
  eraPlayer,
  personId,
  bestVersion,
} from '../players/eras.js';
import {
  catalogIndex,
  catalogStamp,
  draftRules,
  roleRating,
  roleFit,
  naturalRating,
  selectable,
  isKeeper,
  LINE_OF,
} from './pools.js';
import { teamLinks, linkBoosts } from './links.js';
import { budgetBands, bandIndex, bandUse, tierOfRating } from './budget.js';

export const DRAFT_MODES = {
  nations: { label: 'Nations', categories: ['nation'] },
  leagues: { label: 'Leagues', categories: ['league'] },
  clubs: { label: 'Clubs', categories: ['club'] },
};
/** A draft mode id from a query, a link or a setting: anything unknown reads as 'nations'. */
export const draftModeOf = id => (Object.hasOwn(DRAFT_MODES, id) ? id : 'nations');
export const DIFFICULTIES = ['pro', 'worldclass', 'legendary'];
export const DIFFICULTY_LABELS = {
  pro: 'Pro',
  worldclass: 'World Class',
  legendary: 'Legendary',
};
/** Familiarity at or above this counts as a natural position (auto placement prefers it). */
export const NATURAL_FIT = 0.95;
// Format 3: the rules of this version (era drafts and their tokens, a nation's draft squad, the
// pick minimum, the three difficulties, the named tiers, mates and the Captain). A session
// saved in anything older is not a saved draft session: there is one cut-off and no conversion.
export const SESSION_FORMAT = 3;
/** The tokens of a draft: `respin(kind)` takes the first two, `prime(slot)` spends the third. */
export const TOKENS = ['nation', 'era', 'prime'];
const DEFAULT_TEAMS = [
  { name: 'You', color: '#d9f580', secondary: '#16213a' },
  { name: 'Player 2', color: '#baaff0', secondary: '#16213a' },
];

// murmur3 finaliser: consecutive seeds (dates, counters) must not give correlated first draws,
// which a raw LCG state would (its first outputs for seeds n, n+1, … form a regular lattice).
export function mixSeed(x) {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x = (x ^ (x >>> 13)) >>> 0;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}
/**
 * A seed as a uint32: numbers as is, strings by FNV-1a (so a string seed can travel as a
 * number in a link: seedNumber('abc') seeds exactly like 'abc').
 */
export function seedNumber(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  if (typeof seed === 'string' && seed.length) {
    let h = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0;
    return h;
  }
  throw Error('A draft needs a seed (number or string)');
}
/** RNG state for a seed (number or string), mixed. */
export const seedValue = seed => mixSeed(seedNumber(seed));
const round1 = x => Math.round(x * 10) / 10;
const round3 = x => Math.round(x * 1000) / 1000;

function normalizeOptions(o = {}) {
  const mode = o.mode ?? 'nations';
  if (!DRAFT_MODES[mode]) throw Error('Unknown draft mode: ' + mode);
  const sides = o.sides ?? 1;
  if (sides !== 1 && sides !== 2) throw Error('A draft has 1 or 2 sides');
  const formations = Array.from(
    { length: sides },
    (_, i) => o.formations?.[i] ?? o.formations?.[0] ?? o.formation ?? '433',
  );
  for (const f of formations) if (!FORMATIONS[f]) throw Error('Unknown formation: ' + f);
  const difficulty = o.difficulty ?? 'pro';
  if (!DIFFICULTIES.includes(difficulty)) throw Error('Unknown difficulty: ' + difficulty);
  if (o.schedule && sides !== 1) throw Error('A scheduled (daily) draft has one side');
  const teams = Array.from({ length: sides }, (_, i) => ({
    ...DEFAULT_TEAMS[i],
    ...(sides === 2 && !o.teams?.[i]?.name ? { name: `Player ${i + 1}` } : {}),
    ...o.teams?.[i],
  }));
  return {
    mode,
    seed: o.seed,
    sides,
    formations,
    difficulty,
    rerolls: o.rerolls ?? null,
    hideRatings: !!o.hideRatings,
    uniqueNations: !!o.uniqueNations,
    budget: !!o.budget,
    // Every spin draws an era and a nation (needs catalog.eras; Nations drafts only).
    eras: !!o.eras,
    // Prime tokens per side: true = rules.tokens.prime, a number, or none (needs catalog.eras).
    primes: o.primes === true ? true : Number.isInteger(o.primes) && o.primes > 0 ? o.primes : null,
    excludeNations: [...(o.excludeNations || [])].map(String),
    excludeClubs: [...(o.excludeClubs || [])].map(String),
    excludePlayers: [...(o.excludePlayers || [])].map(String),
    schedule: o.schedule
      ? {
          rounds: o.schedule.rounds.map(r => ({
            // The round's spin and what a nation respin lands on: a nation id. Era drafts
            // also fix the era and what an era respin lands on ({ era, nation }).
            spin: r.spin ?? null,
            alternate: r.alternate ?? null,
            era: r.era ?? null,
            eraAlternate: r.eraAlternate
              ? { era: r.eraAlternate.era, nation: r.eraAlternate.nation ?? null }
              : null,
          })),
        }
      : null,
    teams,
    useDefaultRules: !!o.useDefaultRules,
  };
}

export class DraftSession {
  #catalog;
  #index;
  #snapshot = null;
  #pool = null;
  constructor(catalog, options = {}, { rules = null, state = null } = {}) {
    this.options = normalizeOptions(options);
    this.rules =
      rules ?? draftRules(this.options.useDefaultRules ? DEFAULT_CONFIG.draft : CONFIG.draft);
    this.#catalog = catalog;
    this.#index = catalogIndex(catalog, this.rules);
    this.mode = this.options.mode;
    this.sides = this.options.sides;
    this.formations = [...this.options.formations];
    // The capped tiers (Superstar, Star, Starter: where each starts) and, in Budget mode, their
    // slots (`bands`, null when off).
    this.tiers = budgetBands(this.rules.budget);
    this.bands = this.options.budget ? this.tiers : null;
    this.eras = this.options.eras;
    if (this.eras && this.mode !== 'nations') throw Error('Only a Nations draft spins eras');
    // Only players shown at this rating or more are offered (0: everyone). An era pool is a
    // World Cup squad: nobody is left out of it for his rating.
    this.pickMinimum = this.eras ? 0 : this.rules.pickMinimum;
    // The tokens, the same on every difficulty: nation respins (the re-rolls of a draft without
    // eras), era respins and Primes per side.
    const tokens = this.rules.tokens ?? {};
    this.rerollsPerSide = this.options.rerolls ?? tokens.nation ?? 0;
    this.eraRespinsPerSide = this.eras ? (tokens.era ?? 0) : 0;
    this.primesPerSide =
      this.options.primes === true ? (tokens.prime ?? 0) : (this.options.primes ?? 0);
    if ((this.eras || this.primesPerSide > 0) && !catalog.eras)
      throw Error('This draft needs the era data (catalog.eras)');
    this.excluded = {
      nations: new Set(this.options.excludeNations),
      clubs: new Set(this.options.excludeClubs),
      players: new Set(this.options.excludePlayers),
      // One person, whatever the card: an excluded player's other versions are excluded too.
      persons: new Set(this.options.excludePlayers.map(id => personId({ profileId: id }))),
    };
    this.rng = seedValue(this.options.seed);
    if (state) Object.assign(this, structuredClone(state));
    else {
      this.first = this.sides === 2 ? (this.random() < 0.5 ? 0 : 1) : 0;
      this.turn = this.first;
      this.picks = Array.from({ length: this.sides }, () => Array(11).fill(null));
      this.rerollsLeft = Array(this.sides).fill(this.rerollsPerSide);
      this.eraRespinsLeft = Array(this.sides).fill(this.eraRespinsPerSide);
      this.primesLeft = Array(this.sides).fill(this.primesPerSide);
      // Primed players: the id in the XI → the id of the version that was drafted.
      this.primed = {};
      this.history = [];
      this.current = null;
      this.seen = [];
    }
    // Who is drafted, as persons: a man is in an XI once, whatever the era or the version.
    this.used = new Set();
    for (const id of this.picks.flat()) {
      if (!id) continue;
      const p = this.player(id);
      if (!p) throw Error('Saved draft does not match the player database');
      this.used.add(personId(p));
    }
  }
  random() {
    this.rng = lcgNext(this.rng);
    return this.rng / LCG_RANGE;
  }
  #changed() {
    this.#snapshot = null;
    this.#pool = null;
  }
  get catalog() {
    return this.#catalog;
  }
  get complete() {
    return this.picks.every(side => side.every(Boolean));
  }
  get phase() {
    return this.complete ? 'complete' : this.current ? 'pick' : 'spin';
  }
  /** Picks made by a side so far (its round number, 0-based). */
  round(side = this.turn) {
    return this.picks[side].filter(Boolean).length;
  }
  /** The category the side's next (or current) spin draws from. */
  category(side = this.turn) {
    const c = DRAFT_MODES[this.mode].categories;
    return c[this.round(side) % c.length];
  }
  /** A catalog player or an era card by profileId (null when unknown). */
  player(id) {
    return this.#index.byId.get(String(id)) || eraPlayer(this.#catalog, id);
  }
  // ---- availability and the dead-end guard ---------------------------------------------
  /** Drafted already — he, or another version of him (any era, his Prime). */
  #taken(p) {
    return this.used.has(personId(p));
  }
  /**
   * This draft may offer him: selectable (rules.pickMinimum), not drafted, not excluded. Every
   * pool and every guard of a spin goes through here, so nobody under the minimum is ever
   * listed and a spin never lands where only such players are left.
   */
  available(p) {
    const s = p.source || {};
    return (
      selectable(p, this.pickMinimum) &&
      !this.#taken(p) &&
      !this.excluded.players.has(p.profileId) &&
      !this.excluded.players.has(baseProfileId(p)) &&
      !this.excluded.persons.has(personId(p)) &&
      !this.excluded.nations.has(s.nationality) &&
      !this.excluded.clubs.has(String(s.clubId))
    );
  }
  // ---- Budget mode ------------------------------------------------------------------------
  /**
   * The rating a player is priced by: the OVR shown on him (rounded natural rating). A primed
   * player keeps the price of the version that was drafted: a Prime boost is free.
   */
  #price(p) {
    const from = this.primed[p.profileId],
      drafted = from ? (this.player(from) ?? p) : p;
    return Math.round(naturalRating(drafted));
  }
  /** Players a side holds per band (aligned with this.bands). */
  #bandUsed(side) {
    return bandUse(
      this.bands,
      this.picks[side].filter(Boolean).map(id => this.#price(this.player(id))),
    );
  }
  /** Budget mode: the side still has a slot of this player's band (always true when off). */
  affordable(p, side = this.turn) {
    if (!this.bands) return true;
    const band = bandIndex(this.bands, this.#price(p));
    return band < 0 || this.#bandUsed(side)[band] < this.bands[band].slots;
  }
  #budgetReason(p) {
    return `No ${this.bands[bandIndex(this.bands, this.#price(p))].label} slot left`;
  }
  /** Open slot classes of a side: { gk, out } booleans. */
  openClasses(side = this.turn) {
    const rows = FORMATIONS[this.formations[side]];
    let gk = false,
      out = false;
    this.picks[side].forEach((id, i) => {
      if (!id) rows[i][2] === 'GK' ? (gk = true) : (out = true);
    });
    return { gk, out };
  }
  // The guard: some available (Budget mode: affordable) player the spin would offer can fill an
  // open slot class. A nation offers its draft squad only (pools.js draftSquad) — in an era
  // draft its squad of that era (players/eras.js eraPool) —, a league or a club everyone a
  // draft may offer.
  #group(category, id, era = null) {
    const ix = this.#index;
    if (era !== null) return eraPool(this.#catalog, era, id);
    if (category === 'nation') return ix.nations.get(id)?.squad;
    return (category === 'league' ? ix.leagueById.get(id) : ix.clubs.get(id))?.players;
  }
  #fills(category, id, side, era = null) {
    const group = this.#group(category, id, era);
    if (!group) return false;
    const open = this.openClasses(side),
      used = this.bands && this.#bandUsed(side),
      afford = p => {
        if (!used) return true;
        const band = bandIndex(this.bands, this.#price(p));
        return band < 0 || used[band] < this.bands[band].slots;
      };
    return group.some(p => (isKeeper(p) ? open.gk : open.out) && this.available(p) && afford(p));
  }
  // A pool is the group less whoever is taken or excluded: it does not refill. Budget mode
  // lists the players a full tier closes too (the guard asked for one that is not).
  #poolOf(category, id, era = null) {
    return (this.#group(category, id, era) ?? []).filter(p => this.available(p));
  }
  #nationUsed(side, id) {
    return this.history.some(h => h.side === side && h.category === 'nation' && h.optionId === id);
  }
  #valid(category, id, side, era = null) {
    if (category === 'nation') {
      if (this.excluded.nations.has(id)) return false;
      if (this.options.uniqueNations && this.#nationUsed(side, id)) return false;
    }
    if (category === 'club' && this.excluded.clubs.has(id)) return false;
    return this.#fills(category, id, side, era);
  }
  // ---- spinning ---------------------------------------------------------------------------
  #reel(category, entries, weightOf) {
    const options = entries.map(e => ({ ...e, weight: weightOf(e) }));
    const total = options.reduce((s, o) => s + o.weight, 0);
    for (const o of options) o.probability = total ? round3(o.weight / total) : 0;
    return { category, options, total };
  }
  #land(reel, forcedId = null) {
    let landing = -1;
    if (forcedId !== null) landing = reel.options.findIndex(o => o.id === forcedId && o.weight > 0);
    if (landing < 0) {
      if (!reel.total) throw Error('No eligible ' + reel.category + ' remains');
      let r = this.random() * reel.total;
      landing = reel.options.findIndex(o => (r -= o.weight) < 0);
      if (landing < 0) landing = reel.options.findLastIndex(o => o.weight > 0);
    }
    const { total, ...shown } = reel;
    return { ...shown, landing };
  }
  // ---- era drafts: an era reel, then the reel of that era's nations ------------------------
  #eraReel(weightOf) {
    return this.#reel(
      'era',
      // `name` is the era's full label, `short` the one for a reel or a tight spot (ERAS).
      eraList(this.#catalog).map(e => ({
        id: e.id,
        name: e.label,
        short: e.short ?? e.label,
        from: e.from,
        to: e.to,
      })),
      o => (weightOf(o.id) ? 1 : 0),
    );
  }
  #eraNationReel(era, side, exclude = null) {
    const nations = eraList(this.#catalog).find(e => e.id === era)?.nations ?? [],
      landable = this.#landable(era, side, exclude);
    return this.#reel(
      'nation',
      nations.map(n => ({
        id: n.name,
        name: n.name,
        code: n.code,
        flag: n.flag,
        strength: n.strength,
      })),
      o => (landable.has(o.id) ? 1 : 0),
    );
  }
  /**
   * The nations of an era a spin can land on: those with a pick for an open slot class (so,
   * with only the keeper slot left, those with an available keeper). A pool may have no keeper
   * at all: **while the keeper slot is open beside others, at least half of the landable
   * nations have an available keeper** — keeper-less nations stay only as far as that holds,
   * the strongest first (the reel's order), the rest are off the reel for this spin.
   */
  #landable(era, side, exclude = null) {
    const nations = eraList(this.#catalog).find(e => e.id === era)?.nations ?? [],
      open = this.openClasses(side),
      both = open.gk && open.out,
      out = new Set(),
      bare = [];
    for (const n of nations) {
      if (exclude?.has(n.name) || !this.#valid('nation', n.name, side, era)) continue;
      if (!both || this.#hasKeeper(era, n.name, side)) out.add(n.name);
      else bare.push(n.name);
    }
    const keepers = out.size;
    for (let i = 0; i < bare.length && i < keepers; i++) out.add(bare[i]);
    return out;
  }
  #hasKeeper(era, nation, side) {
    const used = this.bands && this.#bandUsed(side);
    return eraPool(this.#catalog, era, nation).some(p => {
      if (!isKeeper(p) || !this.available(p)) return false;
      if (!used) return true;
      const band = bandIndex(this.bands, this.#price(p));
      return band < 0 || used[band] < this.bands[band].slots;
    });
  }
  /** Some nation of the era can be landed on (never a dead end: such an era has weight 0). */
  #eraOpen(era, side, exclude = null) {
    return this.#landable(era, side, exclude).size > 0;
  }
  // All eras equally likely, then the era's nations equally likely — less the ones a pick could
  // not come from. `forced`: { era, nation } ids a schedule fixed (taken when they can land).
  #drawEra(side, forced = null) {
    const eras = this.#land(
        this.#eraReel(id => this.#eraOpen(id, side)),
        forced?.era ?? null,
      ),
      era = eras.options[eras.landing],
      nations = this.#land(
        this.#eraNationReel(era.id, side),
        era.id === forced?.era ? (forced.nation ?? null) : null,
      );
    return {
      category: 'nation',
      option: nations.options[nations.landing],
      era,
      league: null,
      reels: [eras, nations],
    };
  }
  #draw(category, exclude, forcedId) {
    const side = this.turn,
      ix = this.#index,
      tierWeight = t => this.rules.leagueTierWeights[t] ?? 0;
    if (category === 'nation') {
      const reel = this.#land(
        this.#reel(
          'nation',
          ix.spinField.map(n => ({
            id: n.id,
            name: n.name,
            code: n.code,
            flag: n.flag,
            pot: n.pot,
            strength: round1(n.strength),
          })),
          o => (!exclude.has(o.id) && this.#valid('nation', o.id, side) ? 1 : 0),
        ),
        forcedId,
      );
      return { category, option: reel.options[reel.landing], league: null, reels: [reel] };
    }
    const leagueMeta = l => ({ id: l.id, name: l.name, tier: l.tier, logo: l.logo });
    if (category === 'league') {
      const reel = this.#land(
        this.#reel('league', ix.leagues.map(leagueMeta), o =>
          !exclude.has(o.id) && this.#valid('league', o.id, side) ? tierWeight(o.tier) : 0,
        ),
        forcedId,
      );
      return { category, option: reel.options[reel.landing], league: null, reels: [reel] };
    }
    // Clubs: league then club, chained from one spin.
    const clubOk = c => !exclude.has(c.id) && this.#valid('club', c.id, side);
    const leagues = this.#land(
      this.#reel('league', ix.leagues.map(leagueMeta), o =>
        ix.leagueById.get(o.id).spinnableClubs.some(clubOk)
          ? (this.rules.clubs.leagueTierWeights?.[o.tier] ?? tierWeight(o.tier))
          : 0,
      ),
      forcedId === null ? null : (ix.clubs.get(forcedId)?.leagueId ?? null),
    );
    const league = leagues.options[leagues.landing];
    const clubs = this.#land(
      this.#reel(
        'club',
        ix.leagueById.get(league.id).spinnableClubs.map(c => ({
          id: c.id,
          name: c.name,
          tier: c.tier,
          primary: c.primary,
          secondary: c.secondary,
          leagueId: c.leagueId,
        })),
        o => (clubOk(ix.clubs.get(o.id)) ? (this.rules.clubs.tierWeights?.[o.tier] ?? 1) : 0),
      ),
      forcedId,
    );
    return { category, option: clubs.options[clubs.landing], league, reels: [leagues, clubs] };
  }
  #scheduled(kind) {
    const round = this.options.schedule?.rounds[this.round()];
    return round?.[kind] ?? null;
  }
  /** Spin for the side to act. Returns the spin (also in snapshot().spin). */
  spin() {
    if (this.complete) throw Error('The draft is complete');
    if (this.current) throw Error('Pick a player (or re-roll) before spinning again');
    const forced = this.#scheduled('spin'),
      era = this.eras ? this.#scheduled('era') : null,
      result = this.eras
        ? this.#drawEra(this.turn, era === null ? null : { era, nation: forced })
        : this.#draw(this.category(), new Set(), forced);
    this.current = {
      ...result,
      side: this.turn,
      round: this.round(),
      reroll: 0,
      scheduled:
        forced !== null && result.option.id === forced && (era === null || result.era.id === era),
    };
    this.seen = [this.#seenKey(result)];
    this.#changed();
    return structuredClone(this.current);
  }
  #seenKey(result) {
    return result.era ? `${result.era.id}|${result.option.id}` : result.option.id;
  }
  // What a respin may not land on: the nations seen in this era this round / the eras seen.
  #seenNations(era) {
    const head = `${era}|`;
    return new Set(this.seen.filter(k => k.startsWith(head)).map(k => k.slice(head.length)));
  }
  #seenEras() {
    return new Set(this.seen.map(k => Number(k.slice(0, k.indexOf('|')))));
  }
  /**
   * Why the side to act cannot spend a respin now, or '' when it can. `kind`: 'nation' (keep
   * the era, spin the nation again — the re-roll of a draft without eras) or 'era' (era drafts:
   * spin the era again; the nation stays when the new era has it).
   */
  respinBlocked(kind = 'nation') {
    if (this.complete) return 'The draft is complete';
    if (!this.current) return 'Spin first';
    const side = this.turn;
    if (kind === 'era') {
      if (!this.eras) return 'No era to respin';
      if (this.eraRespinsLeft[side] <= 0) return 'No era respin left';
      const seen = this.#seenEras();
      return eraList(this.#catalog).some(e => !seen.has(e.id) && this.#eraOpen(e.id, side))
        ? ''
        : 'No other era';
    }
    if (kind !== 'nation') return 'Unknown respin';
    if (this.rerollsLeft[side] <= 0)
      return this.eras ? 'No nation respin left' : 'No re-rolls left';
    if (this.eras)
      return this.#eraOpen(this.current.era.id, side, this.#seenNations(this.current.era.id))
        ? ''
        : 'No other nation';
    if (this.options.schedule && this.current.reroll > 0) return 'One alternate per round';
    return '';
  }
  /** Why the current side cannot re-roll (respin the nation) now, or '' when it can. */
  rerollBlocked() {
    return this.respinBlocked('nation');
  }
  /**
   * Spend a respin token (see respinBlocked). 'nation': the era stays, the nation is drawn
   * again without the ones seen. 'era': another era is drawn; the nation stays when that era
   * has it with a pick for an open slot, otherwise the nation is drawn too. Returns the spin,
   * with `respin` (the kind), `spun` (which reels moved) and, for an era respin, `kept`.
   */
  respin(kind = 'nation') {
    const blocked = this.respinBlocked(kind);
    if (blocked) throw Error(blocked);
    const side = this.turn,
      was = this.current;
    let result,
      scheduled = false,
      extra = {};
    if (!this.eras) {
      const forced = this.#scheduled('alternate');
      result = this.#draw(was.category, new Set(this.seen), forced);
      scheduled = forced !== null && result.option.id === forced;
      this.rerollsLeft[side]--;
    } else if (kind === 'nation') {
      // A schedule's alternate nation belongs to the scheduled era.
      const forced = was.era.id === this.#scheduled('era') ? this.#scheduled('alternate') : null,
        nations = this.#land(
          this.#eraNationReel(was.era.id, side, this.#seenNations(was.era.id)),
          forced,
        );
      result = {
        category: 'nation',
        option: nations.options[nations.landing],
        era: was.era,
        league: null,
        reels: [was.reels[0], nations],
      };
      scheduled = forced !== null && result.option.id === forced;
      extra = { respin: 'nation', spun: [false, true] };
      this.rerollsLeft[side]--;
    } else {
      const seen = this.#seenEras(),
        forced = this.#scheduled('eraAlternate'),
        eras = this.#land(
          this.#eraReel(id => !seen.has(id) && this.#eraOpen(id, side)),
          forced?.era ?? null,
        ),
        era = eras.options[eras.landing],
        reel = this.#eraNationReel(era.id, side),
        // The nation stays when the new era has it (and it has a pick for an open slot).
        kept = reel.options.some(o => o.id === was.option.id && o.weight > 0),
        nations = this.#land(
          reel,
          kept ? was.option.id : era.id === forced?.era ? (forced.nation ?? null) : null,
        );
      result = {
        category: 'nation',
        option: nations.options[nations.landing],
        era,
        league: null,
        reels: [eras, nations],
      };
      scheduled = forced !== null && era.id === forced.era;
      extra = { respin: 'era', spun: [true, !kept], kept };
      this.eraRespinsLeft[side]--;
    }
    this.current = {
      ...result,
      ...extra,
      side,
      round: this.round(),
      reroll: was.reroll + 1,
      scheduled,
    };
    this.seen.push(this.#seenKey(result));
    this.#changed();
    return structuredClone(this.current);
  }
  /** Spend a re-roll: spin again without the options already seen this round. */
  reroll() {
    return this.respin('nation');
  }
  // ---- pool and placement ----------------------------------------------------------------
  /** Players of the current spin (drafted/excluded players removed), best fit first. */
  poolPlayers() {
    if (!this.current) return [];
    this.#pool ??= this.#poolOf(
      this.current.category,
      this.current.option.id,
      this.current.era?.id ?? null,
    );
    return this.#pool;
  }
  #inPool(p) {
    return this.poolPlayers().includes(p);
  }
  placementOptions(playerId, side = this.turn) {
    const p = this.player(playerId);
    if (!p) throw Error('Unknown player: ' + playerId);
    const rows = FORMATIONS[this.formations[side]],
      natural = Math.round(naturalRating(p));
    const general = this.complete
      ? 'The draft is complete'
      : side !== this.turn
        ? 'Not this side’s turn'
        : !this.current
          ? 'Spin first'
          : this.#taken(p)
            ? 'Already drafted'
            : !this.#inPool(p)
              ? 'Not in this pool'
              : !this.affordable(p, side)
                ? this.#budgetReason(p)
                : '';
    return rows.map(([, , role], slot) => {
      const rating = Math.round(roleRating(p, role)),
        reason =
          general ||
          (this.picks[side][slot]
            ? 'Slot filled'
            : (role === 'GK') !== isKeeper(p)
              ? role === 'GK'
                ? 'Goalkeepers only'
                : 'Outfield players only'
              : '');
      return {
        slot,
        role,
        rating,
        natural,
        delta: rating - natural,
        familiarity: round3(roleFit(p, role)),
        allowed: !reason,
        reason,
      };
    });
  }
  /** Best allowed slot, preferring natural positions (familiarity >= 0.95); null if none. */
  autoSlot(playerId, side = this.turn) {
    const p = this.player(playerId);
    if (!p) throw Error('Unknown player: ' + playerId);
    const allowed = this.placementOptions(playerId, side).filter(o => o.allowed);
    if (!allowed.length) return null;
    const natural = allowed.filter(o => o.familiarity >= NATURAL_FIT),
      best = (natural.length ? natural : allowed).reduce((a, b) =>
        roleRating(p, b.role) > roleRating(p, a.role) + 1e-9 ? b : a,
      );
    return {
      slot: best.slot,
      role: best.role,
      rating: best.rating,
      familiarity: best.familiarity,
      natural: best.familiarity >= NATURAL_FIT,
    };
  }
  /**
   * Draft a player of the current spin into a slot (default: autoSlot). Returns
   * { ok: true, side, slot, role, profileId, rating, familiarity } or { ok: false, reason }.
   */
  pick(playerId, slot = null) {
    const p = this.player(playerId);
    if (!p) return { ok: false, reason: 'Unknown player' };
    const side = this.turn;
    if (slot === null || slot === undefined) {
      const auto = this.autoSlot(playerId);
      if (!auto) {
        const reason = this.placementOptions(playerId).find(o => o.reason)?.reason;
        return { ok: false, reason: reason || 'No open slot' };
      }
      slot = auto.slot;
    }
    const option = this.placementOptions(playerId)[slot];
    if (!option) return { ok: false, reason: 'Unknown slot' };
    if (!option.allowed) return { ok: false, reason: option.reason };
    this.picks[side][slot] = p.profileId;
    this.used.add(personId(p));
    const spin = this.current;
    this.history.push({
      side,
      round: spin.round,
      slot,
      role: option.role,
      profileId: p.profileId,
      category: spin.category,
      optionId: spin.option.id,
      optionName: spin.option.name,
      leagueId: spin.league?.id ?? null,
      rerolls: spin.reroll,
      ...(spin.era ? { era: spin.era.id, eraName: spin.era.name } : {}),
    });
    this.current = null;
    this.seen = [];
    if (this.sides === 2 && !this.complete) this.turn = 1 - this.turn;
    this.#changed();
    return {
      ok: true,
      side,
      slot,
      role: option.role,
      profileId: p.profileId,
      rating: option.rating,
      familiarity: option.familiarity,
    };
  }
  /** Positional policy: the best (player, slot) of the current pool by slot rating. */
  suggestPick() {
    if (!this.current) return null;
    const rows = FORMATIONS[this.formations[this.turn]],
      open = rows.map((r, i) => (this.picks[this.turn][i] ? null : r[2]));
    let best = null;
    for (const p of this.poolPlayers()) {
      if (!this.affordable(p)) continue;
      open.forEach((role, slot) => {
        if (!role || (role === 'GK') !== isKeeper(p)) return;
        const v = roleRating(p, role);
        if (!best || v > best.v + 1e-9) best = { v, profileId: p.profileId, slot };
      });
    }
    return best && { profileId: best.profileId, slot: best.slot, rating: Math.round(best.v) };
  }
  /** Swap two slots of a side (or move into an empty slot). GK slot takes keepers only. */
  move(side, from, to) {
    const rows = FORMATIONS[this.formations[side]],
      picks = this.picks[side];
    if (!rows?.[from] || !rows[to] || from === to) return false;
    const fits = (id, slot) => !id || (rows[slot][2] === 'GK') === isKeeper(this.player(id));
    if (!fits(picks[from], to) || !fits(picks[to], from)) return false;
    [picks[from], picks[to]] = [picks[to], picks[from]];
    this.#changed();
    return true;
  }
  /** Change a side's formation; placed players move to their best slots in the new shape. */
  setFormation(side, formation) {
    if (!FORMATIONS[formation]) throw Error('Unknown formation: ' + formation);
    const rows = FORMATIONS[formation],
      placed = this.picks[side].filter(Boolean).map(id => this.player(id)),
      next = Array(11).fill(null),
      keepers = placed.filter(isKeeper),
      outfield = placed.filter(p => !isKeeper(p)),
      slots = rows.map((r, i) => i).filter(i => rows[i][2] !== 'GK');
    if (keepers[0]) next[rows.findIndex(r => r[2] === 'GK')] = keepers[0].profileId;
    // Exact assignment of up to 10 outfield players to 10 slots (DP over slot masks).
    const memo = new Map();
    const solve = (i, mask) => {
      if (i === outfield.length) return { v: 0, slots: [] };
      const key = i * 1024 + mask;
      if (memo.has(key)) return memo.get(key);
      let best = null;
      slots.forEach((slot, k) => {
        if (mask & (1 << k)) return;
        const rest = solve(i + 1, mask | (1 << k)),
          v = roleRating(outfield[i], rows[slot][2]) + rest.v;
        if (!best || v > best.v + 1e-9) best = { v, slots: [slot, ...rest.slots] };
      });
      memo.set(key, best);
      return best;
    };
    solve(0, 0).slots.forEach((slot, i) => (next[slot] = outfield[i].profileId));
    this.formations[side] = formation;
    this.picks[side] = next;
    this.#changed();
    return true;
  }
  // ---- the Prime token ---------------------------------------------------------------------
  /**
   * The best version of a player across all titles when this draft has Prime tokens and it
   * shows more than he does (players/eras.js bestVersion), else null. A primed player has none.
   */
  #primeOf(p) {
    if (!this.primesPerSide || this.primed[p.profileId]) return null;
    return bestVersion(this.#catalog, p);
  }
  /**
   * What the Prime would do to the player in a side's slot, or null when no version of him
   * shows more (or the slot is open): { slot, profileId, name, from: { ovr, rating }, to:
   * { profileId, ovr, rating, edition, year, position, tier }, allowed, reason }. `rating` is
   * the rating in that slot. `reason` when not allowed: 'No Prime left'. Budget mode never
   * refuses it: he keeps the tier slot of the version that was drafted.
   */
  primeOption(slot, side = this.turn) {
    const id = this.picks[side]?.[slot],
      p = id ? this.player(id) : null,
      prime = p && this.#primeOf(p);
    if (!prime) return null;
    const role = FORMATIONS[this.formations[side]][slot][2],
      ovr = Math.round(naturalRating(prime));
    const reason = this.primesLeft[side] > 0 ? '' : 'No Prime left';
    return {
      slot,
      profileId: p.profileId,
      name: p.name,
      from: { ovr: Math.round(naturalRating(p)), rating: Math.round(roleRating(p, role)) },
      to: {
        profileId: prime.profileId,
        ovr,
        rating: Math.round(roleRating(prime, role)),
        edition: prime.edition ?? null,
        year: this.#year(prime),
        position: prime.primaryPosition,
        tier: tierOfRating(ovr, this.tiers),
      },
      allowed: !reason,
      reason,
    };
  }
  /** Every slot of a side whose player has a better version (see primeOption). */
  primeOptions(side = this.turn) {
    return this.picks[side].map((_, slot) => this.primeOption(slot, side)).filter(Boolean);
  }
  /**
   * Spend the Prime: the player in the slot becomes his best version (the card of that year:
   * its rating, attributes, positions and club). Not reversible.
   * Returns { ok: true, side, slot, profileId, primeOf, rating } or { ok: false, reason }.
   */
  prime(slot, side = this.turn) {
    const option = this.primeOption(slot, side);
    if (!option) return { ok: false, reason: 'No better version' };
    if (!option.allowed) return { ok: false, reason: option.reason };
    this.picks[side][slot] = option.to.profileId;
    this.primed[option.to.profileId] = option.profileId;
    this.primesLeft[side]--;
    for (const h of this.history)
      if (h.side === side && h.profileId === option.profileId) {
        h.profileId = option.to.profileId;
        h.primeOf = option.profileId;
      }
    this.#changed();
    return {
      ok: true,
      side,
      slot,
      profileId: option.to.profileId,
      primeOf: option.profileId,
      rating: option.to.rating,
    };
  }
  // The year of a card's ratings: an era card's own; in a draft with eras or Primes today's
  // players carry today's.
  #year(p) {
    return editionYear(p) ?? (this.eras || this.primesPerSide ? CURRENT_ERA : null);
  }
  // ---- views ----------------------------------------------------------------------------
  /** Display summary of a catalog player (no fit information). */
  playerSummary(p) {
    const s = p.source || {},
      prime = this.#primeOf(p);
    return {
      profileId: p.profileId,
      name: p.name,
      fullName: p.fullName || p.name,
      position: p.primaryPosition,
      secondary: [...(p.secondaryPositions || [])],
      ovr: Math.round(naturalRating(p)),
      tier: tierOfRating(Math.round(naturalRating(p)), this.tiers),
      nation: s.nationality || null,
      nationCode: this.#index.nations.get(s.nationality)?.code ?? null,
      club: s.club || null,
      clubId: s.clubId == null ? null : String(s.clubId),
      league: this.#index.leagueById.get(String(s.leagueId))?.name ?? null,
      leagueId: s.leagueId == null ? null : String(s.leagueId),
      captain: !!p.captain,
      // The Prime was spent on him: this is his best version.
      prime: !!this.primed[p.profileId],
      era: this.eras ? (p.era ?? CURRENT_ERA) : null,
      edition: p.edition ?? null,
      // The year of this version's ratings (FIFA 19 came out in 2018); null in a draft of
      // today's players.
      year: this.#year(p),
      // His best version (drafts with the Prime): what the token would make him.
      primeVersion: prime && {
        profileId: prime.profileId,
        ovr: Math.round(naturalRating(prime)),
        edition: prime.edition ?? null,
        year: this.#year(prime),
        position: prime.primaryPosition,
      },
    };
  }
  /** Nations and clubs of a side's XI (what makes a pool player a mate) + the boosts. */
  #mates(side) {
    const nations = new Set(),
      clubs = new Set();
    for (const p of this.lineup(side)) {
      if (!p) continue;
      if (p.source?.nationality) nations.add(p.source.nationality);
      if (p.source?.clubId != null) clubs.add(String(p.source.clubId));
    }
    return {
      nations,
      clubs,
      value: linkBoosts(this.rules.links),
      captain: this.lineup(side).some(p => p?.captain),
    };
  }
  #entry(p, side, used, mates) {
    const rows = FORMATIONS[this.formations[side]],
      natural = naturalRating(p);
    let best = null,
      naturalSlots = 0;
    rows.forEach(([, , role], slot) => {
      if (this.picks[side][slot] || (role === 'GK') !== isKeeper(p)) return;
      const v = roleRating(p, role),
        fit = roleFit(p, role);
      if (fit >= NATURAL_FIT) naturalSlots++;
      if (!best || v > best.v + 1e-9) best = { v, slot, role, fit };
    });
    const band = this.bands ? bandIndex(this.bands, this.#price(p)) : -1,
      afford = band < 0 || used[band] < this.bands[band].slots,
      ok = this.available(p) && !!best && afford;
    // The mates boost he would get in this XI (null when he has no mate in it).
    const kinds = [];
    if (mates.value.nation > 0 && mates.nations.has(p.source?.nationality)) kinds.push('nation');
    if (
      mates.value.club > 0 &&
      p.source?.clubId != null &&
      mates.clubs.has(String(p.source.clubId))
    )
      kinds.push('club');
    return {
      ...this.playerSummary(p),
      band: band < 0 ? null : this.bands[band].id,
      boost: kinds.length
        ? { value: kinds.reduce((sum, k) => sum + mates.value[k], 0), kinds }
        : null,
      // A Captain who would be the XI's first: what he gives every player (else 0).
      captainBoost: p.captain && !mates.captain ? mates.value.captain : 0,
      best: best && {
        slot: best.slot,
        role: best.role,
        rating: Math.round(best.v),
        familiarity: round3(best.fit),
        delta: Math.round(best.v) - Math.round(natural),
      },
      naturalSlots,
      available: ok,
      reason: ok
        ? ''
        : !this.available(p)
          ? 'Already drafted'
          : !afford && best
            ? `No ${this.bands[band].label} slot left`
            : isKeeper(p)
              ? 'Goalkeeper slot filled'
              : 'Outfield slots filled',
      _v: best ? best.v : -1,
    };
  }
  /** One side's XI as catalog players in slot order (null = open slot). */
  lineup(side = 0) {
    return this.picks[side].map(id => (id ? this.player(id) : null));
  }
  /** Team view of a side: slots with ratings, team OVR, line ratings and Links. */
  team(side = 0) {
    const rows = FORMATIONS[this.formations[side]],
      players = this.lineup(side),
      links = teamLinks(players, this.rules.links);
    const slots = rows.map(([x, y, role], slot) => {
      const p = players[slot];
      return {
        slot,
        role,
        x,
        y,
        line: LINE_OF[role],
        player: p ? this.playerSummary(p) : null,
        rating: p ? Math.round(roleRating(p, role)) : null,
        familiarity: p ? round3(roleFit(p, role)) : null,
        link: links.players[slot],
        // What the Prime would do here (null: no better version).
        prime: p ? this.primeOption(slot, side) : null,
      };
    });
    const mean = list => {
      const v = list.filter(s => s.player).map(s => roleRating(players[s.slot], s.role));
      return v.length ? round1(v.reduce((a, b) => a + b, 0) / v.length) : null;
    };
    const filled = slots.filter(s => s.player);
    const { players: linkPlayers, ...linkSummary } = links;
    return {
      side,
      ...this.options.teams[side],
      formation: this.formations[side],
      slots,
      filled: filled.length,
      rating: mean(slots),
      lines: {
        DEF: mean(slots.filter(s => s.line === 'GK' || s.line === 'DEF')),
        MID: mean(slots.filter(s => s.line === 'MID')),
        ATT: mean(slots.filter(s => s.line === 'ATT')),
      },
      links: { ...linkSummary, boosts: linkPlayers.map(e => e?.chem ?? null) },
      budget: this.bands && this.#budgetView(side),
      rerollsLeft: this.rerollsLeft[side],
      eraRespinsLeft: this.eraRespinsLeft[side],
      primesLeft: this.primesLeft[side],
      complete: filled.length === 11,
    };
  }
  /** Budget mode: the capped tiers with what the side has used: [{ id, label, range, … }]. */
  #budgetView(side) {
    const used = this.#bandUsed(side);
    return this.bands.map((b, i) => ({
      id: b.id,
      label: b.label,
      range: b.range,
      minimum: b.minimum,
      slots: b.slots,
      used: used[i],
      left: Math.max(0, b.slots - used[i]),
    }));
  }
  #tokens(side) {
    const can = kind => !this.complete && !!this.current && !this.respinBlocked(kind);
    return {
      nation: { perSide: this.rerollsPerSide, left: this.rerollsLeft[side], can: can('nation') },
      era: this.eras
        ? { perSide: this.eraRespinsPerSide, left: this.eraRespinsLeft[side], can: can('era') }
        : null,
      prime: this.primesPerSide
        ? {
            perSide: this.primesPerSide,
            left: this.primesLeft[side],
            can: this.primesLeft[side] > 0 && this.primeOptions(side).length > 0,
          }
        : null,
    };
  }
  /** Serialisable view for the UI (cached until the state changes). */
  snapshot() {
    if (this.#snapshot) return this.#snapshot;
    const side = this.turn,
      bandUsed = this.bands && this.#bandUsed(side),
      mates = this.#mates(side);
    const pool = this.poolPlayers()
      .map(p => this.#entry(p, side, bandUsed, mates))
      .sort(
        (a, b) =>
          b.available - a.available ||
          b._v - a._v ||
          b.ovr - a.ovr ||
          (a.profileId < b.profileId ? -1 : 1),
      )
      .map(({ _v, ...e }) => e);
    this.#snapshot = {
      mode: this.mode,
      modeLabel: DRAFT_MODES[this.mode].label,
      difficulty: this.options.difficulty,
      sides: this.sides,
      hideRatings: this.options.hideRatings,
      uniqueNations: this.options.uniqueNations,
      budget: this.options.budget,
      eras: this.eras,
      primes: this.primesPerSide
        ? { perSide: this.primesPerSide, left: [...this.primesLeft] }
        : null,
      // The tokens of the side to act: what is left and whether it can be spent now.
      tokens: this.#tokens(side),
      daily: !!this.options.schedule,
      phase: this.phase,
      complete: this.complete,
      first: this.first,
      turn: side,
      pickIndex: this.history.length,
      totalPicks: 11 * this.sides,
      round: this.round(side),
      category: this.current?.category ?? (this.complete ? null : this.category(side)),
      spin: this.current ? structuredClone(this.current) : null,
      pool,
      rerolls: [...this.rerollsLeft],
      canReroll: !this.rerollBlocked(),
      teams: Array.from({ length: this.sides }, (_, i) => this.team(i)),
      history: structuredClone(this.history),
    };
    return this.#snapshot;
  }
  // ---- persistence ---------------------------------------------------------------------
  /** Plain JSON for localStorage / links; restore with restoreDraftSession(catalog, data). */
  serialize() {
    return {
      type: 'draft-session',
      format: SESSION_FORMAT,
      catalog: catalogStamp(this.#catalog),
      options: structuredClone({ ...this.options, formations: this.formations }),
      rules: structuredClone(this.rules),
      state: structuredClone({
        rng: this.rng,
        first: this.first,
        turn: this.turn,
        picks: this.picks,
        rerollsLeft: this.rerollsLeft,
        eraRespinsLeft: this.eraRespinsLeft,
        primesLeft: this.primesLeft,
        primed: this.primed,
        history: this.history,
        current: this.current,
        seen: this.seen,
      }),
    };
  }
  // ---- match setup -----------------------------------------------------------------------
  /** Engine-ready side: players (clones, slot order, role, chem), formation, colours, links. */
  matchSide(side = 0) {
    if (!this.picks[side].every(Boolean)) throw Error('This side has not completed its XI');
    const team = this.options.teams[side];
    return buildSide({
      name: team.name,
      color: team.color,
      secondary: team.secondary,
      formation: this.formations[side],
      players: this.lineup(side),
      links: this.rules.links,
      kind: 'draft',
    });
  }
}

/** Engine-ready side from any XI (draft side, opponent or exhibition team). */
export function buildSide({
  name,
  short = null,
  color,
  secondary,
  formation,
  players,
  links = CONFIG.draft.links,
  kind = 'team',
  id = null,
  code = null,
}) {
  if (players.length !== 11 || players.some(p => !p)) throw Error('A side needs eleven players');
  const rows = FORMATIONS[formation],
    summary = teamLinks(players, links);
  const ratings = players.map((p, i) => roleRating(p, rows[i][2]));
  const rating = ratings.reduce((a, b) => a + b, 0) / 11;
  return {
    kind,
    id,
    code,
    name,
    short: short || playerInitials({ name }).slice(0, 3),
    color,
    secondary,
    formation,
    players: players.map((p, i) => ({
      ...structuredClone(p),
      slot: i,
      role: rows[i][2],
      chem: round3(summary.players[i].chem),
    })),
    rating: Math.round(rating * 100) / 100,
    effective: Math.round((rating + summary.chem) * 100) / 100,
    links: {
      score: summary.score,
      maxScore: summary.maxScore,
      total: summary.total,
      chem: round3(summary.chem),
      pairs: summary.pairs,
      captain: summary.captain,
      captainBoost: summary.captainBoost,
    },
  };
}

const hex = c => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const colourDistance = (a, b) => {
  const x = hex(a),
    y = hex(b);
  return x && y ? Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) : Infinity;
};
/**
 * Two sides -> the parts of an engine config: { teams: [2], players: [22] } (home first).
 * If the kits clash, the away side wears its secondary colour. Merge into a Match config with
 * applyMatchSetup(match.exportConfig(), setup).
 */
export function matchSetup(home, away) {
  let awayColor = away.color,
    awaySecondary = away.secondary;
  if (colourDistance(home.color, away.color) < 90 && away.secondary) {
    awayColor = away.secondary;
    awaySecondary = away.color;
  }
  const team = (s, color, secondary) => ({
    name: s.name,
    short: s.short,
    color: color || '#d9f580',
    secondary: secondary || color || '#16213a',
    formation: s.formation,
    kind: s.kind,
    id: s.id,
    code: s.code,
  });
  return {
    teams: [team(home, home.color, home.secondary), team(away, awayColor, awaySecondary)],
    players: [...home.players, ...away.players],
  };
}
/** Apply matchSetup() output to a config from match.exportConfig(); returns a new config. */
export function applyMatchSetup(config, setup, competition = {}) {
  return {
    ...config,
    competition: { ...config.competition, ...competition },
    teams: config.teams.map((t, i) => {
      const { formation, ...rest } = setup.teams[i];
      return { ...t, ...rest, tactics: { ...t.tactics, formation } };
    }),
    players: setup.players.map(p => structuredClone(p)),
  };
}

/** Start a draft. See docs/draft-api.md for options and the flow. */
export function createDraftSession(catalog, options = {}) {
  return new DraftSession(catalog, options);
}
/** Rebuild a session from serialize() output (throws if it does not fit the catalog). */
export function restoreDraftSession(catalog, data) {
  if (
    data?.type !== 'draft-session' ||
    data.format !== SESSION_FORMAT ||
    !data.rules ||
    typeof data.rules !== 'object'
  )
    throw Error('Not a saved draft session');
  return new DraftSession(catalog, data.options, { rules: data.rules, state: data.state });
}
