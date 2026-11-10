// Draft session: one spin per pick from a pluggable pool source, honest weights, a GK/outfield
// dead-end guard, re-rolls by difficulty, placement with visible fit, serialise/restore and
// match-config helpers. Pure and deterministic for a seed; the UI must never consume its RNG.
// API guide with examples: docs/draft-api.md.
import { CONFIG, DEFAULT_CONFIG } from '../config/config.js';
import { lcgNext, LCG_RANGE } from '../util/rng.js';
import { FORMATIONS } from '../players/formations.js';
import { playerInitials } from '../players/lineups.js';
import {
  catalogIndex,
  catalogStamp,
  draftRules,
  callUps,
  roleRating,
  roleFit,
  naturalRating,
  isKeeper,
  tierName,
  LINE_OF,
} from './pools.js';
import { teamLinks } from './links.js';

export const DRAFT_MODES = {
  nations: { label: 'Nations', categories: ['nation'] },
  leagues: { label: 'Leagues', categories: ['league'] },
  clubs: { label: 'Clubs', categories: ['club'] },
  clubAndCountry: { label: 'Club & Country', categories: ['nation', 'league'] },
};
export const DIFFICULTIES = ['pro', 'worldclass', 'legendary'];
export const DIFFICULTY_LABELS = {
  pro: 'Pro',
  worldclass: 'World Class',
  legendary: 'Legendary',
};
/**
 * A difficulty id from a save or a link: the removed levels ('amateur', 'semipro') and anything
 * unknown read as 'pro'.
 */
export const difficultyOf = id => (DIFFICULTIES.includes(id) ? id : 'pro');
/** Familiarity at or above this counts as a natural position (auto placement prefers it). */
export const NATURAL_FIT = 0.95;
export const SESSION_FORMAT = 1;
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
  // Saves and links from before the three difficulties: the removed levels play as Pro.
  const difficulty =
    o.difficulty === 'amateur' || o.difficulty === 'semipro' ? 'pro' : (o.difficulty ?? 'pro');
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
    excludeNations: [...(o.excludeNations || [])].map(String),
    excludeClubs: [...(o.excludeClubs || [])].map(String),
    excludePlayers: [...(o.excludePlayers || [])].map(String),
    schedule: o.schedule
      ? {
          rounds: o.schedule.rounds.map(r => ({
            spin: r.spin ?? null,
            alternate: r.alternate ?? null,
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
    this.rerollsPerSide = this.options.rerolls ?? this.rules.rerolls[this.options.difficulty];
    this.excluded = {
      nations: new Set(this.options.excludeNations),
      clubs: new Set(this.options.excludeClubs),
      players: new Set(this.options.excludePlayers),
    };
    this.rng = seedValue(this.options.seed);
    if (state) Object.assign(this, structuredClone(state));
    else {
      this.first = this.sides === 2 ? (this.random() < 0.5 ? 0 : 1) : 0;
      this.turn = this.first;
      this.picks = Array.from({ length: this.sides }, () => Array(11).fill(null));
      this.rerollsLeft = Array(this.sides).fill(this.rerollsPerSide);
      this.history = [];
      this.current = null;
      this.seen = [];
    }
    this.used = new Set(this.picks.flat().filter(Boolean));
    for (const id of this.used)
      if (!this.#index.byId.has(id)) throw Error('Saved draft does not match the player database');
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
  player(id) {
    return this.#index.byId.get(String(id)) || null;
  }
  // ---- availability and the dead-end guard ---------------------------------------------
  available(p) {
    const s = p.source || {};
    return (
      !this.used.has(p.profileId) &&
      !this.excluded.players.has(p.profileId) &&
      !this.excluded.nations.has(s.nationality) &&
      !this.excluded.clubs.has(String(s.clubId))
    );
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
  // The guard: some available player of the group can fill an open slot class. Call-ups always
  // include the best available keepers and outfield players, so the whole group is checked.
  #fills(category, id, side) {
    const ix = this.#index,
      group =
        category === 'nation'
          ? ix.nations.get(id)
          : category === 'league'
            ? ix.leagueById.get(id)
            : ix.clubs.get(id);
    if (!group) return false;
    const open = this.openClasses(side);
    return group.players.some(p => (isKeeper(p) ? open.gk : open.out) && this.available(p));
  }
  #poolOf(category, id) {
    const ix = this.#index;
    if (category === 'nation') {
      const nation = ix.nations.get(id);
      return nation ? callUps(nation, p => this.available(p), this.rules.nations) : [];
    }
    const group = category === 'league' ? ix.leagueById.get(id) : ix.clubs.get(id);
    return group ? group.players.filter(p => this.available(p)) : [];
  }
  #nationUsed(side, id) {
    return this.history.some(h => h.side === side && h.category === 'nation' && h.optionId === id);
  }
  #valid(category, id, side) {
    if (category === 'nation') {
      if (this.excluded.nations.has(id)) return false;
      if (this.options.uniqueNations && this.#nationUsed(side, id)) return false;
    }
    if (category === 'club' && this.excluded.clubs.has(id)) return false;
    return this.#fills(category, id, side);
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
  #draw(category, exclude, forcedId) {
    const side = this.turn,
      ix = this.#index,
      tierWeight = t => this.rules.leagueTierWeights[t] ?? 0;
    if (category === 'nation') {
      const reel = this.#land(
        this.#reel(
          'nation',
          ix.field.map(n => ({
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
    const category = this.category(),
      forced = this.#scheduled('spin'),
      result = this.#draw(category, new Set(), forced);
    this.current = {
      ...result,
      side: this.turn,
      round: this.round(),
      reroll: 0,
      scheduled: forced !== null && result.option.id === forced,
    };
    this.seen = [result.option.id];
    this.#changed();
    return structuredClone(this.current);
  }
  /** Why the current side cannot re-roll now, or '' when it can. */
  rerollBlocked() {
    if (this.complete) return 'The draft is complete';
    if (!this.current) return 'Spin first';
    if (this.rerollsLeft[this.turn] <= 0) return 'No re-rolls left';
    if (this.options.schedule && this.current.reroll > 0) return 'One alternate per round';
    return '';
  }
  /** Spend a re-roll: spin again without the options already seen this round. */
  reroll() {
    const blocked = this.rerollBlocked();
    if (blocked) throw Error(blocked);
    const category = this.current.category,
      forced = this.#scheduled('alternate'),
      result = this.#draw(category, new Set(this.seen), forced);
    this.rerollsLeft[this.turn]--;
    this.current = {
      ...result,
      side: this.turn,
      round: this.round(),
      reroll: this.current.reroll + 1,
      scheduled: forced !== null && result.option.id === forced,
    };
    this.seen.push(result.option.id);
    this.#changed();
    return structuredClone(this.current);
  }
  // ---- pool and placement ----------------------------------------------------------------
  /** Players of the current spin (drafted/excluded players removed), best fit first. */
  poolPlayers() {
    if (!this.current) return [];
    this.#pool ??= this.#poolOf(this.current.category, this.current.option.id);
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
          : this.used.has(p.profileId)
            ? 'Already drafted'
            : !this.#inPool(p)
              ? 'Not in this pool'
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
    this.used.add(p.profileId);
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
    for (const p of this.poolPlayers())
      open.forEach((role, slot) => {
        if (!role || (role === 'GK') !== isKeeper(p)) return;
        const v = roleRating(p, role);
        if (!best || v > best.v + 1e-9) best = { v, profileId: p.profileId, slot };
      });
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
  // ---- views ----------------------------------------------------------------------------
  /** Display summary of a catalog player (no fit information). */
  playerSummary(p) {
    const s = p.source || {};
    return {
      profileId: p.profileId,
      name: p.name,
      fullName: p.fullName || p.name,
      position: p.primaryPosition,
      secondary: [...(p.secondaryPositions || [])],
      ovr: Math.round(naturalRating(p)),
      tier: tierName(p),
      nation: s.nationality || null,
      nationCode: this.#index.nations.get(s.nationality)?.code ?? null,
      club: s.club || null,
      clubId: s.clubId == null ? null : String(s.clubId),
      league: this.#index.leagueById.get(String(s.leagueId))?.name ?? null,
      leagueId: s.leagueId == null ? null : String(s.leagueId),
    };
  }
  #entry(p, side) {
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
    const ok = this.available(p) && !!best;
    return {
      ...this.playerSummary(p),
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
      links: { ...linkSummary, levels: linkPlayers.map(e => e?.level ?? null) },
      rerollsLeft: this.rerollsLeft[side],
      complete: filled.length === 11,
    };
  }
  /** Serialisable view for the UI (cached until the state changes). */
  snapshot() {
    if (this.#snapshot) return this.#snapshot;
    const side = this.turn;
    const pool = this.poolPlayers()
      .map(p => this.#entry(p, side))
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
      chem: round3(summary.chem),
      pairs: summary.pairs,
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
  if (data?.type !== 'draft-session' || data.format !== SESSION_FORMAT)
    throw Error('Not a saved draft session');
  return new DraftSession(catalog, data.options, { rules: data.rules, state: data.state });
}
