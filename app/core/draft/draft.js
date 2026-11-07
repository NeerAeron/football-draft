import { CONFIG } from '../config/config.js';
import { FORMATIONS } from '../players/formations.js';
import { overallRating, positionFamiliarity, playerTier } from '../players/ratings.js';
import { draftLeagues, leagueWeight, teamWeight, respinMultiplier } from './leagues.js';
// Private draft pacing. Each resolved player-pool draw counts once per tier,
// regardless of how many matching players it shows or how often it re-renders.
const REVEAL_TARGETS = { superstar: 3, star: 5 },
  TAKEOVER_REVEAL_TARGETS = { superstar: 2, star: 3 },
  REVEAL_START = 3;
const BUDGET_ORDER = ['superstar', 'star', 'starter', 'lower'];
export const BUDGET_LABELS = {
  superstar: 'Superstar',
  star: 'Star',
  starter: 'Starter',
  lower: 'Normal / Bench',
};
export const KITS = [
  { name: 'Sky / white', primary: '#79c7ee', secondary: '#ffffff' },
  { name: 'Red / white', primary: '#e94d58', secondary: '#ffffff' },
  { name: 'Royal / white', primary: '#3676ed', secondary: '#ffffff' },
  { name: 'White / gold', primary: '#f4f1e9', secondary: '#d2ae53' },
  { name: 'Claret / navy', primary: '#be4868', secondary: '#102b63' },
  { name: 'Black / white', primary: '#29323c', secondary: '#ffffff' },
  { name: 'Red / black', primary: '#ed484e', secondary: '#161d27' },
  { name: 'Blue / black', primary: '#418cee', secondary: '#141d2c' },
  { name: 'Yellow / black', primary: '#efdc49', secondary: '#182124' },
  { name: 'Red / gold', primary: '#d9434e', secondary: '#f4d26f' },
  { name: 'Navy / red', primary: '#324875', secondary: '#fa626b' },
  { name: 'Green / white', primary: '#40b781', secondary: '#ffffff' },
];
export class Draft {
  constructor(
    catalog,
    { seed = Date.now(), formations = ['433', '433'], opponent = null, funding = 'takeover' } = {},
  ) {
    if (formations.some(f => !FORMATIONS[f])) throw Error('Unknown formation');
    this.catalog = catalog;
    this.funding = funding;
    this.budgetRules = { ...CONFIG.draft.budget };
    this.budgetCache = null;
    this.leagues = draftLeagues(catalog);
    this.league = null;
    this.club = null;
    this.formations = [...formations];
    this.rng = seed >>> 0;
    this.picks = [
      Array(11).fill(null),
      opponent ? opponent.map(p => structuredClone(p)) : Array(11).fill(null),
    ];
    this.used = new Set(opponent?.map(p => p.profileId) || []);
    this.solo = !!opponent;
    this.first = this.solo ? 0 : Math.floor(this.random() * 2);
    this.turn = this.first;
    this.history = [];
    this.respinRules = { ...CONFIG.draft.respins };
    this.respins = [{ ...this.respinRules }, { ...this.respinRules }];
    this.revealSerial = 0;
    this.revealSpins = Array.from({ length: 2 }, () => ({ superstar: new Set(), star: new Set() }));
    this.tierCache = new WeakMap();
    this.budgetSlots = Array(11).fill(null);
    if (
      this.leagues.reduce(
        (n, l) =>
          n +
          l.players.filter(p => p.primaryPosition === 'GK' && !this.used.has(p.profileId)).length,
        0,
      ) < (this.solo ? 1 : 2)
    )
      throw Error('Not enough eligible goalkeepers for the draft');
  }
  random() {
    this.rng = (Math.imul(1664525, this.rng) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }
  get complete() {
    return this.picks.every(team => team.every(Boolean));
  }
  get needsClub() {
    return this.league && ['A', 'B', 'C'].includes(this.league.tier);
  }
  get unlocked() {
    return !!this.league && (!this.needsClub || !!this.club);
  }
  budgetGroup(p) {
    if (this.tierCache.has(p)) return this.tierCache.get(p);
    const name = playerTier(p).name,
      group =
        name === 'Superstar'
          ? 'superstar'
          : name === 'Star'
            ? 'star'
            : name === 'Starter'
              ? 'starter'
              : 'lower';
    this.tierCache.set(p, group);
    return group;
  }
  budgetState() {
    const counts = { superstar: 0, star: 0, starter: 0, lower: 0 },
      used = { ...counts };
    this.picks[0].forEach((p, i) => {
      if (p) {
        const group = this.budgetGroup(p);
        counts[group]++;
        used[this.budgetSlots[i] || group]++;
      }
    });
    const limits = {
      ...this.budgetRules,
      lower: Math.max(
        0,
        11 - this.budgetRules.superstar - this.budgetRules.star - this.budgetRules.starter,
      ),
    };
    return { counts, used, limits, enabled: this.solo && this.funding === 'budget' };
  }
  budgetOffer(p) {
    const state = this.budgetState(),
      group = this.budgetGroup(p);
    if (!state.enabled || this.turn !== 0)
      return { playerGroup: group, slotGroup: null, requiresConfirmation: false };
    const left = BUDGET_ORDER.map(k => state.limits[k] - state.used[k]);
    if (left.some(n => n < 0)) return null;
    const stamp = this.used.size;
    if (this.budgetCache?.stamp !== stamp) {
      const available = { superstar: [0, 0], star: [0, 0], starter: [0, 0], lower: [0, 0] };
      for (const league of this.leagues)
        if (leagueWeight(league) > 0)
          for (const team of league.teams)
            if (!['A', 'B', 'C'].includes(league.tier) || teamWeight(team) > 0)
              for (const q of team.players)
                if (!this.used.has(q.profileId))
                  available[this.budgetGroup(q)][q.primaryPosition === 'GK' ? 1 : 0]++;
      this.budgetCache = { stamp, available };
    }
    const available = BUDGET_ORDER.map(k => [...this.budgetCache.available[k]]);
    available[BUDGET_ORDER.indexOf(group)][p.primaryPosition === 'GK' ? 1 : 0]--;
    const needsKeeper =
        !this.picks[0].some(q => q?.primaryPosition === 'GK') && p.primaryPosition !== 'GK',
      outfieldLeft =
        this.picks[0].filter((q, i) => !q && FORMATIONS[this.formations[0]][i][2] !== 'GK').length -
        (p.primaryPosition === 'GK' ? 0 : 1);
    const canFill = slots => {
      const remaining = available.map(v => Math.max(0, v[0]));
      let filled = 0;
      // Fill the most restrictive tickets first. Lower-tier players can use
      // higher tickets, but a higher-tier player can never use a lower ticket.
      for (let ticket = 3; ticket >= 0; ticket--) {
        let room = slots[ticket];
        for (let player = ticket; player < 4 && room > 0; player++) {
          const n = Math.min(room, remaining[player]);
          room -= n;
          remaining[player] -= n;
          filled += n;
        }
      }
      return filled >= outfieldLeft;
    };
    const canFinish = slots =>
      !needsKeeper
        ? canFill(slots)
        : available.some(
            (counts, player) =>
              counts[1] > 0 &&
              slots.some((room, ticket) => {
                if (room <= 0 || ticket > player) return false;
                const rest = [...slots];
                rest[ticket]--;
                return canFill(rest);
              }),
          );
    // Prefer the player's own ticket, then the cheapest higher ticket that
    // leaves a complete XI possible, including the remaining goalkeeper.
    for (let ticket = BUDGET_ORDER.indexOf(group); ticket >= 0; ticket--)
      if (left[ticket] > 0) {
        const remaining = [...left];
        remaining[ticket]--;
        if (canFinish(remaining))
          return {
            playerGroup: group,
            slotGroup: BUDGET_ORDER[ticket],
            requiresConfirmation: BUDGET_ORDER[ticket] !== group,
          };
      }
    return null;
  }
  budgetAvailable(p) {
    return !!this.budgetOffer(p);
  }
  slotAvailable(p, slot = null) {
    if (this.complete || this.used.has(p.profileId)) return false;
    return FORMATIONS[this.formations[this.turn]].some(
      (row, i) =>
        (slot === null || i === slot) &&
        !this.picks[this.turn][i] &&
        (row[2] === 'GK') === (p.primaryPosition === 'GK'),
    );
  }
  eligible(p, slot = null) {
    return this.slotAvailable(p, slot) && this.budgetAvailable(p);
  }

  revealNeeds() {
    const budget = this.budgetState(),
      targets = this.solo && this.funding === 'takeover' ? TAKEOVER_REVEAL_TARGETS : REVEAL_TARGETS;
    return Object.entries(targets).filter(
      ([tier, target]) =>
        !this.complete &&
        this.revealSpins[this.turn][tier].size < target &&
        (!budget.enabled || budget.used[tier] < budget.limits[tier]),
    );
  }
  revealScore(players, needs) {
    const missing = new Map(needs);
    let score = 0;
    for (const p of players) {
      const tier = this.budgetGroup(p),
        target = missing.get(tier);
      if (target && this.eligible(p)) {
        score += 1 + (target - this.revealSpins[this.turn][tier].size) / target;
        missing.delete(tier);
        if (!missing.size) break;
      }
    }
    return score;
  }
  prioritizeReveals(options, pools) {
    const needs = this.revealNeeds();
    if (!needs.length || this.picks[this.turn].filter(Boolean).length < REVEAL_START)
      return options;
    const scored = options.map(option => ({
        option,
        score: Math.max(0, ...pools(option).map(players => this.revealScore(players, needs))),
      })),
      best = Math.max(0, ...scored.map(s => s.score));
    // Never require a player type that cannot fill a remaining slot or budget.
    // An impossible/custom target falls back to ordinary eligible draws.
    return best ? scored.filter(s => s.score === best).map(s => s.option) : options;
  }
  eligibleTeams(league) {
    return league.teams.filter(t => teamWeight(t) > 0 && t.players.some(p => this.eligible(p)));
  }
  reelOptions(kind) {
    // Presentation never exposes budget, position or private reveal filtering.
    // Only ordinary catalog availability and disabled baseline weights apply.
    if (kind === 'league') return this.leagues.filter(l => leagueWeight(l) > 0);
    if (kind === 'team')
      return this.needsClub ? this.league.teams.filter(t => teamWeight(t) > 0) : [];
    return [];
  }
  leagueOptions(exclude = null) {
    const options = this.leagues
      .filter(
        l =>
          l.id !== exclude &&
          leagueWeight(l) > 0 &&
          l.players.some(p => this.eligible(p)) &&
          (!['A', 'B', 'C'].includes(l.tier) || this.eligibleTeams(l).length),
      )
      .map(l => ({ ...l, weight: leagueWeight(l) }));
    return this.prioritizeReveals(options, l =>
      ['A', 'B', 'C'].includes(l.tier) ? this.eligibleTeams(l).map(t => t.players) : [l.players],
    );
  }
  weighted(options, weight) {
    let pick = this.random() * options.reduce((n, o) => n + weight(o), 0);
    for (const option of options) {
      pick -= weight(option);
      if (pick < 0) return option;
    }
    return options.at(-1);
  }
  spinLeague() {
    if (this.complete) return null;
    if (this.league) return this.league;
    const options = this.leagueOptions();
    if (!options.length) throw Error('No eligible league remains');
    this.league = this.weighted(options, l => l.weight);
    this.revealSerial++;
    return this.league;
  }
  teamOptions(exclude = null) {
    return this.needsClub
      ? this.prioritizeReveals(
          this.eligibleTeams(this.league).filter(t => t.id !== exclude),
          t => [t.players],
        )
      : [];
  }
  spinTeam() {
    if (!this.needsClub || this.complete) return null;
    if (this.club) return this.club;
    const options = this.teamOptions();
    if (!options.length) throw Error('No eligible club remains');
    this.club = this.weighted(options, teamWeight);
    this.revealSerial++;
    return this.club;
  }
  respinOptions(kind) {
    if (this.complete || !this.respins[this.turn]?.[kind]) return [];
    return kind === 'league' && this.league && !this.club
      ? this.leagueOptions(this.league.id)
      : kind === 'team' && this.club
        ? this.teamOptions(this.club.id)
        : [];
  }
  respin(kind) {
    const options = this.respinOptions(kind);
    if (!options.length) return null;
    const previous = kind === 'league' ? this.league : this.club,
      baseWeight = kind === 'league' ? leagueWeight : teamWeight;
    const result = this.weighted(
      options,
      option => baseWeight(option) * respinMultiplier(kind, previous, option),
    );
    this.respins[this.turn][kind]--;
    this.revealSerial++;
    if (kind === 'league') {
      this.league = result;
      this.club = null;
    } else this.club = result;
    return result;
  }
  recordShown(ids) {
    const shown = new Set(ids);
    for (const p of this.visible())
      if (shown.has(p.profileId) && this.eligible(p))
        this.revealSpins[this.turn][this.budgetGroup(p)]?.add(this.revealSerial);
  }
  // The draw defines the browsing pool. Availability only affects whether a
  // card can be picked, never its visibility or its ranking.
  visible() {
    return this.unlocked ? [...(this.needsClub ? this.club.players : this.league.players)] : [];
  }
  available(slot = null) {
    return this.visible().filter(p => this.eligible(p, slot));
  }
  bestSlot(p, role = null, { includeBudgetBlocked = false } = {}) {
    const rows = FORMATIONS[this.formations[this.turn]],
      options = rows
        .map((r, slot) => ({ slot, role: r[2] }))
        .filter(r =>
          includeBudgetBlocked ? this.slotAvailable(p, r.slot) : this.eligible(p, r.slot),
        );
    const preferred = role ? options.filter(r => r.role === role) : [];
    return (
      (preferred.length ? preferred : options).sort(
        (a, b) =>
          overallRating(p, false, b.role) - overallRating(p, false, a.role) || a.slot - b.slot,
      )[0]?.slot ?? -1
    );
  }
  placement(p, selectedSlot = -1) {
    const slot =
      selectedSlot >= 0 ? selectedSlot : this.bestSlot(p, null, { includeBudgetBlocked: true });
    const role = FORMATIONS[this.formations[this.turn]][slot]?.[2] ?? null;
    let reason = '';
    if (this.used.has(p.profileId)) reason = 'Already drafted';
    else if (this.complete) reason = 'Draft complete';
    else if (selectedSlot >= 0 && this.picks[this.turn][slot]) reason = 'Position filled';
    else if (!this.slotAvailable(p, slot))
      reason =
        selectedSlot >= 0
          ? 'Different position type'
          : p.primaryPosition === 'GK'
            ? 'Goalkeeper slot filled'
            : 'Outfield slots filled';
    else if (!this.budgetAvailable(p)) reason = 'Budget locked';
    return { slot, role, reason, available: !reason };
  }
  pick(slot, id, { confirmedBudgetSlot = null } = {}) {
    const p = this.available(slot).find(p => p.profileId === id);
    if (!p) return false;
    const offer = this.budgetOffer(p);
    if (offer.requiresConfirmation && confirmedBudgetSlot !== offer.slotGroup) return false;
    this.recordShown([id]);
    if (this.solo && this.funding === 'budget') this.budgetSlots[slot] = offer.slotGroup;
    this.picks[this.turn][slot] = structuredClone(p);
    this.used.add(id);
    this.history.push({
      team: this.turn,
      slot,
      id,
      name: p.name,
      leagueId: this.league.id,
      leagueName: this.league.name,
      clubId: this.club?.id || null,
      clubName: this.club?.name || null,
      budgetSlot: offer.slotGroup,
      budgetReplacement: offer.requiresConfirmation,
    });
    this.turn = this.solo ? 0 : 1 - this.turn;
    this.league = null;
    this.club = null;
    return true;
  }
}
// Exact best fit for one drafted XI (2^11 states). No profile can be duplicated.
export function bestSlots(players, formation, { keeperId = null } = {}) {
  const rows = FORMATIONS[formation],
    n = players.length;
  if (n !== 11) throw Error('An XI is required');
  const total = 1 << n,
    score = new Float64Array(total).fill(-Infinity),
    prev = new Int16Array(total).fill(-1);
  score[0] = 0;
  for (let mask = 0; mask < total; mask++)
    if (Number.isFinite(score[mask])) {
      let row = 0;
      for (let bits = mask; bits; bits &= bits - 1) row++;
      if (row === n) continue;
      for (let j = 0; j < n; j++)
        if (
          !(mask & (1 << j)) &&
          (rows[row][2] === 'GK') ===
            (keeperId === null ? players[j].primaryPosition === 'GK' : players[j].id === keeperId)
        ) {
          const next = mask | (1 << j),
            value = score[mask] + overallRating(players[j], false, rows[row][2]);
          if (value > score[next]) {
            score[next] = value;
            prev[next] = j;
          }
        }
    }
  if (prev[total - 1] < 0) throw Error('Lineup requires one goalkeeper');
  const result = Array(n);
  let mask = total - 1;
  for (let i = n - 1; i >= 0; i--) {
    const j = prev[mask];
    result[i] = players[j];
    mask ^= 1 << j;
  }
  return result;
}
