// World Cup Run: a group of four (you + three AI teams), three group matches, top two advance,
// then Round of 16, quarter-final, semi-final and final against escalating opponents. The UI
// plays the user's matches with the engine and reports each result; AI-vs-AI group results
// come from the seeded rating model (competition/model.js). Pure; serialise/restore for
// localStorage. API guide: docs/competition-api.md.
import { CONFIG } from '../config/config.js';
import { lcg, lcgNext, LCG_RANGE } from '../util/rng.js';
import { FORMATIONS } from '../players/formations.js';
import { catalogIndex, catalogStamp, roleRating, roleFit, naturalRating } from '../draft/pools.js';
import { buildSide, seedValue, mixSeed, DIFFICULTIES } from '../draft/session.js';
import {
  chooseOpponent,
  buildOpponent,
  opponentCandidates,
  ladderTarget,
  MODE_BASELINES,
} from '../draft/opponents.js';
import { simulateResult } from './model.js';

export const CUP_ROUNDS = [
  { id: 'group1', label: 'Group · Matchday 1', stage: 'group', knockout: false },
  { id: 'group2', label: 'Group · Matchday 2', stage: 'group', knockout: false },
  { id: 'group3', label: 'Group · Matchday 3', stage: 'group', knockout: false },
  { id: 'r16', label: 'Round of 16', stage: 'r16', knockout: true },
  { id: 'qf', label: 'Quarter-final', stage: 'qf', knockout: true },
  { id: 'sf', label: 'Semi-final', stage: 'sf', knockout: true },
  { id: 'final', label: 'Final', stage: 'final', knockout: true },
];
/** How far the run got: eliminated in a stage, or champion. */
export const STAGE_LABELS = {
  group: 'Group stage',
  r16: 'Round of 16',
  qf: 'Quarter-finals',
  sf: 'Semi-finals',
  final: 'Final',
  champion: 'Champions',
};
const STAGE_ORDER = ['group', 'r16', 'qf', 'sf', 'final', 'champion'];
/**
 * Opponent strength per round, as offsets to the level's target (effective rating). The
 * group is drawn from "lower pots" (weaker than the level), knockouts escalate past it.
 */
export const CUP_TUNING = { groupOffsets: [-4.5, -3.5, -2.5], knockoutOffsets: [-2, -1, 0, 1] };
export const CUP_FORMAT = 1;
const USER = 'user';
const round2 = x => Math.round(x * 100) / 100;
// Group fixtures by matchday: team indexes into [user, A, B, C] (A weakest).
const FIXTURES = [
  [0, 1, 2, 3],
  [0, 2, 3, 1],
  [0, 3, 1, 2],
];

// ---- standings ----------------------------------------------------------------------------
const emptyRow = key => ({
  key,
  played: 0,
  won: 0,
  drawn: 0,
  lost: 0,
  gf: 0,
  ga: 0,
  gd: 0,
  points: 0,
});
function tally(keys, fixtures) {
  const rows = new Map(keys.map(k => [k, emptyRow(k)]));
  for (const f of fixtures) {
    if (!f.score || !rows.has(f.home) || !rows.has(f.away)) continue;
    const [a, b] = f.score,
      h = rows.get(f.home),
      w = rows.get(f.away);
    for (const [r, gf, ga] of [
      [h, a, b],
      [w, b, a],
    ]) {
      r.played++;
      r.gf += gf;
      r.ga += ga;
      r.gd = r.gf - r.ga;
      if (gf > ga) (r.won++, (r.points += 3));
      else if (gf === ga) (r.drawn++, r.points++);
      else r.lost++;
    }
  }
  return rows;
}
const overall = (x, y) => y.points - x.points || y.gd - x.gd || y.gf - x.gf;
/**
 * Group table with FIFA World Cup tiebreaks: points, goal difference, goals scored; then,
 * among teams still level, head-to-head points, goal difference and goals; then the drawing
 * of lots (`lots`: a seeded order of the keys). Each row gets `position` and `decidedBy`: the
 * criterion that separates it from the team below ('points' | 'goalDifference' | 'goalsFor' |
 * 'headToHead' | 'lots' | null for the last row).
 */
export function standings(keys, fixtures, lots = keys) {
  const rows = tally(keys, fixtures),
    sorted = [...rows.values()].sort(overall),
    result = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && overall(sorted[i], sorted[j + 1]) === 0) j++;
    const tied = sorted.slice(i, j + 1);
    if (tied.length > 1) {
      const mini = tally(
        tied.map(r => r.key),
        fixtures.filter(f => tied.some(r => r.key === f.home) && tied.some(r => r.key === f.away)),
      );
      tied.sort(
        (a, b) =>
          overall(mini.get(a.key), mini.get(b.key)) || lots.indexOf(a.key) - lots.indexOf(b.key),
      );
      tied.forEach(r => (r.h2h = mini.get(r.key)));
    }
    result.push(...tied);
    i = j + 1;
  }
  return result.map((r, i) => {
    const next = result[i + 1];
    let decidedBy = null;
    if (next)
      decidedBy =
        r.points !== next.points
          ? 'points'
          : r.gd !== next.gd
            ? 'goalDifference'
            : r.gf !== next.gf
              ? 'goalsFor'
              : r.h2h && next.h2h && overall(r.h2h, next.h2h) !== 0
                ? 'headToHead'
                : 'lots';
    const { h2h, ...row } = r;
    return { ...row, position: i + 1, decidedBy };
  });
}

// ---- grades ---------------------------------------------------------------------------------
export const GRADES = ['S+', 'S', 'A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F'];
/**
 * Grade and named verdict of a finished run.
 * champion: 7 wins S+ "Perfect Seven", unbeaten S "Invincibles", else A+ "World Champions";
 * lost final A "Final Heartbreak"; semi-final B+ (5 wins) / B; quarter-final C+ (4 wins) / C;
 * Round of 16 D; group exit F. Penalty exits get their own verdicts.
 */
export function cupGrade({ stage, record, lostOnPenalties = false }) {
  const w = record.w;
  const g = (grade, verdict) => ({ grade, verdict, stage, stageLabel: STAGE_LABELS[stage] });
  if (stage === 'champion')
    return w === 7
      ? g('S+', 'Perfect Seven')
      : record.l === 0
        ? g('S', 'Invincibles')
        : g('A+', 'World Champions');
  if (stage === 'final')
    return g('A', lostOnPenalties ? 'Heartbreak on Penalties' : 'Final Heartbreak');
  if (stage === 'sf') return w >= 5 ? g('B+', 'Semi-final Heartbreak') : g('B', 'Semi-finalists');
  if (stage === 'qf')
    return w >= 4 ? g('C+', 'Quarter-final Heartbreak') : g('C', 'Quarter-finalists');
  if (stage === 'r16') return g('D', lostOnPenalties ? 'Out on Penalties' : 'Round of 16 Exit');
  return g('F', record.w + record.d === 0 ? 'Early Flight Home' : 'Group Stage Exit');
}

// ---- run --------------------------------------------------------------------------------------
const sideRef = s => ({
  key: s.key,
  kind: s.kind,
  id: s.id,
  name: s.name,
  code: s.code ?? null,
  flag: s.flag ?? null,
  color: s.color ?? null,
  secondary: s.secondary ?? null,
  formation: s.formation,
  players: s.players.map(p => p.profileId),
  rating: s.rating,
  effective: s.effective,
  nominal: s.nominal ?? s.effective,
  target: s.target ?? null,
});

export class CupRun {
  #catalog;
  #index;
  constructor(catalog, state) {
    this.#catalog = catalog;
    this.#index = catalogIndex(catalog);
    Object.assign(this, structuredClone(state));
    for (const id of [...this.user.players, ...this.opponents.flatMap(o => o.players)])
      if (!this.#index.byId.has(id)) throw Error('Saved run does not match the player database');
  }
  get complete() {
    return this.status !== 'playing';
  }
  get round() {
    return this.complete ? null : this.matches.length;
  }
  #players(ids) {
    return ids.map(id => this.#index.byId.get(id));
  }
  /** Engine-ready user side (buildSide). */
  userSide() {
    const u = this.user;
    return buildSide({
      ...u,
      players: this.#players(u.players),
      links: this.rules.links,
      kind: 'draft',
    });
  }
  /** Engine-ready side of the opponent in a round (0–6). */
  opponentSide(round) {
    const o = this.opponents[round];
    return {
      ...buildSide({ ...o, players: this.#players(o.players), links: this.rules.links }),
      key: o.key,
      flag: o.flag,
    };
  }
  /** Seed for the engine match of a round (deterministic per run). */
  matchSeed(round) {
    return mixSeed((this.rngSeed + Math.imul(round + 1, 0x9e3779b9)) >>> 0);
  }
  /** The next user match, or null when the run is over. */
  nextMatch() {
    if (this.complete) return null;
    const round = this.matches.length,
      info = CUP_ROUNDS[round];
    return {
      round,
      ...info,
      seed: this.matchSeed(round),
      opponent: this.#opponentSummary(round),
      home: this.userSide(),
      away: this.opponentSide(round),
    };
  }
  // Group opponents carry a pot label by strength: strongest pot 2 … weakest pot 4.
  #opponentSummary(round) {
    const { players, ...o } = this.opponents[round];
    if (round > 2) return { ...o, pot: null };
    const stronger = this.opponents.slice(0, 3).filter(x => x.effective > o.effective).length;
    return { ...o, pot: 2 + stronger };
  }
  #random() {
    this.aiRng = lcgNext(this.aiRng);
    return this.aiRng / LCG_RANGE;
  }
  /**
   * Report the user's match: { goalsFor, goalsAgainst, shootout?, players? }.
   * shootout (knockout draws only): { winner: 'user' | 'opponent', score?: [for, against] }.
   * players: [{ profileId, rating (engine performance 3–10), goals?, assists? }] for the
   * Player of the Tournament / Held you back helpers.
   */
  recordResult({ goalsFor, goalsAgainst, shootout = null, players = [] }) {
    if (this.complete) throw Error('The run is over');
    for (const v of [goalsFor, goalsAgainst])
      if (!Number.isInteger(v) || v < 0) throw Error('Goals must be whole numbers');
    const round = this.matches.length,
      info = CUP_ROUNDS[round],
      draw = goalsFor === goalsAgainst;
    if (info.knockout && draw && !['user', 'opponent'].includes(shootout?.winner))
      throw Error('A knockout draw needs a shootout winner');
    const outcome = goalsFor > goalsAgainst ? 'W' : draw ? 'D' : 'L';
    const pens =
      info.knockout && draw ? { winner: shootout.winner, score: shootout.score ?? null } : null;
    const won = outcome === 'W' || pens?.winner === 'user';
    this.matches.push({
      round,
      id: info.id,
      opponent: this.opponents[round].key,
      goals: [goalsFor, goalsAgainst],
      outcome,
      shootout: pens,
      players: players.map(p => ({
        profileId: String(p.profileId),
        rating: Number(p.rating) || 0,
        goals: p.goals | 0,
        assists: p.assists | 0,
      })),
    });
    if (!info.knockout) {
      const md = round,
        [, a, b, c] = this.group.teams,
        teams = [USER, a, b, c];
      const fixtures = this.group.fixtures.filter(f => f.md === md + 1);
      for (const f of fixtures)
        if (f.home === USER) f.score = [goalsFor, goalsAgainst];
        else {
          const rating = key => this.opponents.find(o => o.key === key).effective;
          f.score = simulateResult(rating(f.home), rating(f.away), () => this.#random()).goals;
        }
      if (md === 2) {
        const table = standings(teams, this.group.fixtures, this.group.lots);
        if (table.findIndex(r => r.key === USER) > 1) this.status = 'eliminated';
      }
    } else if (!won) this.status = 'eliminated';
    else if (info.id === 'final') this.status = 'champion';
    return this.snapshot();
  }
  /** Play the next match with the fast rating model (auto-sim / tests). */
  simulateNext(random = lcg(this.matchSeed(this.matches.length))) {
    const m = this.nextMatch();
    if (!m) return null;
    const r = simulateResult(m.home.effective, m.away.effective, random, { knockout: m.knockout });
    return this.recordResult({
      goalsFor: r.goals[0],
      goalsAgainst: r.goals[1],
      shootout: r.shootout && {
        winner: r.shootout.winner ? 'opponent' : 'user',
        score: r.shootout.score,
      },
    });
  }
  /** W-D-L by the 90-minute score (a knockout decided on penalties counts as a draw). */
  record() {
    const r = { w: 0, d: 0, l: 0, gf: 0, ga: 0, played: this.matches.length };
    for (const m of this.matches) {
      r[m.outcome.toLowerCase()]++;
      r.gf += m.goals[0];
      r.ga += m.goals[1];
    }
    return r;
  }
  /** Stage reached: where the run ended ('group' … 'final') or 'champion'; current if playing. */
  stage() {
    if (this.status === 'champion') return 'champion';
    const last = this.matches.at(-1);
    if (this.status === 'eliminated') return CUP_ROUNDS[last.round].stage;
    return CUP_ROUNDS[this.matches.length].stage;
  }
  table() {
    const [, a, b, c] = this.group.teams;
    return standings([USER, a, b, c], this.group.fixtures, this.group.lots);
  }
  grade() {
    if (!this.complete) return null;
    const last = this.matches.at(-1);
    return cupGrade({
      stage: this.stage(),
      record: this.record(),
      lostOnPenalties: last.shootout?.winner === 'opponent',
    });
  }
  // ---- player awards --------------------------------------------------------------------
  #playerStats() {
    const stats = new Map(
      this.user.players.map((id, slot) => [
        id,
        { profileId: id, slot, ratings: [], goals: 0, assists: 0 },
      ]),
    );
    for (const m of this.matches)
      for (const p of m.players) {
        const s = stats.get(p.profileId);
        if (!s) continue;
        s.ratings.push(p.rating);
        s.goals += p.goals;
        s.assists += p.assists;
      }
    const rows = FORMATIONS[this.user.formation];
    return [...stats.values()].map(s => {
      const p = this.#index.byId.get(s.profileId),
        role = rows[s.slot][2];
      return {
        profileId: s.profileId,
        name: p.name,
        role,
        matches: s.ratings.length,
        average: s.ratings.length
          ? round2(s.ratings.reduce((a, b) => a + b, 0) / s.ratings.length)
          : null,
        goals: s.goals,
        assists: s.assists,
        slotRating: Math.round(roleRating(p, role)),
        natural: Math.round(naturalRating(p)),
        familiarity: round2(roleFit(p, role)),
      };
    });
  }
  /** Best average match rating (played at least half the matches); ties: goals, assists. */
  playerOfTheTournament() {
    const rows = this.#playerStats(),
      min = Math.ceil(this.matches.length / 2),
      eligible = rows.filter(r => r.matches && r.matches >= min);
    if (!eligible.length) return null;
    return eligible.sort(
      (a, b) =>
        b.average - a.average ||
        b.goals - a.goals ||
        b.assists - a.assists ||
        a.name.localeCompare(b.name),
    )[0];
  }
  /**
   * The players who held the team back: lowest average match rating (or, before any rated
   * match, lowest slot rating), each with a short reason.
   */
  heldYouBack(count = 1) {
    const rows = this.#playerStats(),
      rated = rows.some(r => r.matches);
    const mean = rows.reduce((s, r) => s + r.slotRating, 0) / rows.length;
    return rows
      .filter(r => !rated || r.matches)
      .sort(
        (a, b) =>
          (rated ? a.average - b.average : 0) ||
          a.slotRating - b.slotRating ||
          a.name.localeCompare(b.name),
      )
      .slice(0, count)
      .map(r => ({
        ...r,
        reason:
          r.familiarity < 0.95
            ? `Out of position at ${r.role}: ${r.slotRating} (natural ${r.natural})`
            : r.slotRating <= mean - 3
              ? `Weakest link: ${r.slotRating} OVR vs team ${round2(mean)}`
              : rated
                ? `Lowest match rating: ${r.average}`
                : `Lowest rating in the XI: ${r.slotRating}`,
      }));
  }
  // ---- views ------------------------------------------------------------------------------
  snapshot() {
    const record = this.record(),
      table = this.table();
    return {
      type: 'cup-snapshot',
      mode: this.mode,
      difficulty: this.difficulty,
      daily: this.daily ?? null,
      status: this.status,
      complete: this.complete,
      round: this.round,
      stage: this.stage(),
      stageLabel: STAGE_LABELS[this.stage()],
      user: { name: this.user.name, rating: this.user.rating, effective: this.user.effective },
      rounds: CUP_ROUNDS.map((info, round) => {
        const m = this.matches[round];
        return {
          ...info,
          opponent: this.#opponentSummary(round),
          result: m
            ? {
                goalsFor: m.goals[0],
                goalsAgainst: m.goals[1],
                outcome: m.outcome,
                shootout: m.shootout,
              }
            : null,
        };
      }),
      group: {
        teams: this.group.teams.map(key =>
          key === USER
            ? { key, name: this.user.name, user: true }
            : {
                key,
                name: this.opponents.find(o => o.key === key).name,
                code: this.opponents.find(o => o.key === key).code,
                user: false,
              },
        ),
        fixtures: structuredClone(this.group.fixtures),
        table: table.map(r => ({
          ...r,
          name: r.key === USER ? this.user.name : this.opponents.find(o => o.key === r.key).name,
          user: r.key === USER,
        })),
      },
      results: this.matches.map(m => m.outcome),
      record,
      grade: this.grade(),
    };
  }
  serialize() {
    const { aiRng, ...rest } = structuredClone({ ...this });
    return {
      type: 'cup-run',
      format: CUP_FORMAT,
      catalog: catalogStamp(this.#catalog),
      ...rest,
      aiRng,
    };
  }
}

/**
 * Start a World Cup Run after the draft.
 * @param catalog decoded catalog
 * @param options {
 *   mode, difficulty, seed,
 *   user: { name, color, secondary, formation, players: 11 catalog players or ids (slot order) },
 *   opponents?: 7 candidate keys (daily: fixed), rules?: CONFIG.draft-like, rerolls?: number,
 *   daily?: daily id for the snapshot }
 */
export function createCupRun(catalog, options) {
  const { mode, difficulty = 'pro', seed, user, rules = CONFIG.draft, rerolls } = options;
  if (!MODE_BASELINES[mode]) throw Error('Unknown draft mode: ' + mode);
  if (!DIFFICULTIES.includes(difficulty)) throw Error('Unknown difficulty: ' + difficulty);
  const index = catalogIndex(catalog),
    players = user.players.map(p => (typeof p === 'string' ? index.byId.get(p) : p));
  if (players.length !== 11 || players.some(p => !p)) throw Error('The run needs a complete XI');
  const ids = players.map(p => p.profileId),
    links = { links: rules.links };
  const side = buildSide({ ...user, players, ...links, kind: 'draft' });
  const rngSeed = seedValue(seed),
    random = lcg(mixSeed(rngSeed ^ 0x632be5ab));
  // Opponents: fixed keys (daily) or the ladder with round offsets, never repeating.
  const offsets = [...CUP_TUNING.groupOffsets, ...CUP_TUNING.knockoutOffsets],
    opponents = [],
    avoid = [];
  const byKey = new Map(opponentCandidates(catalog, { rules }).map(c => [c.key, c]));
  while (opponents.length < 7) {
    const round = opponents.length,
      fixed = options.opponents?.[round];
    const ref = fixed
      ? byKey.get(fixed)
      : chooseOpponent(catalog, {
          mode,
          level: difficulty,
          offset: offsets[round],
          avoid,
          rules,
          rerolls,
          random,
        });
    if (!ref) throw Error('Unknown opponent: ' + fixed);
    avoid.push(ref.key);
    const built = buildOpponent(catalog, ref, { excludePlayers: ids, rules });
    if (!built && fixed) throw Error('Opponent cannot field an XI: ' + fixed);
    // A club weakened below an XI by the user's picks is skipped; the ladder draws again.
    if (built)
      opponents.push(
        sideRef({
          ...built,
          target: ladderTarget(mode, difficulty, { offset: offsets[round], rules, rerolls }),
        }),
      );
  }
  // Matchday order in the group: weakest first (a fixed daily schedule keeps its order).
  const group = opponents.slice(0, 3),
    ordered = options.opponents
      ? group
      : [...group].sort((a, b) => a.effective - b.effective || (a.key < b.key ? -1 : 1)),
    teams = [USER, ...ordered.map(o => o.key)];
  const lots = [...teams];
  for (let i = lots.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [lots[i], lots[j]] = [lots[j], lots[i]];
  }
  const state = {
    mode,
    difficulty,
    seed,
    rngSeed,
    daily: options.daily ?? null,
    rules: structuredClone({ links: rules.links, ladder: rules.ladder, rerolls: rules.rerolls }),
    user: {
      name: side.name,
      short: side.short,
      color: side.color,
      secondary: side.secondary,
      formation: side.formation,
      players: ids,
      rating: side.rating,
      effective: side.effective,
    },
    opponents: [...ordered, ...opponents.slice(3)],
    group: {
      teams,
      fixtures: FIXTURES.flatMap((f, md) => [
        { md: md + 1, home: teams[f[0]], away: teams[f[1]], score: null },
        { md: md + 1, home: teams[f[2]], away: teams[f[3]], score: null },
      ]),
      lots,
    },
    matches: [],
    status: 'playing',
    aiRng: mixSeed(rngSeed ^ 0x2545f491),
  };
  return new CupRun(catalog, state);
}

/** Rebuild a run from serialize() output (throws if it does not fit the catalog). */
export function restoreCupRun(catalog, data) {
  if (data?.type !== 'cup-run' || data.format !== CUP_FORMAT) throw Error('Not a saved run');
  const { type, format, catalog: stamp, ...state } = data;
  return new CupRun(catalog, state);
}

/**
 * Projected stage for a team rating (effective) in a mode and level: a seeded Monte-Carlo of
 * runs against the ladder's round targets with the fast model. For live draft meters.
 * @returns {{ stage, label, probabilities: {group, r16, qf, sf, final, champion} }}
 */
export function projectRun({
  rating,
  mode,
  difficulty = 'pro',
  rules = CONFIG.draft,
  rerolls,
  runs = 300,
  seed = 1,
}) {
  const offsets = [...CUP_TUNING.groupOffsets, ...CUP_TUNING.knockoutOffsets],
    targets = offsets.map(o => ladderTarget(mode, difficulty, { offset: o, rules, rerolls })),
    random = lcg(mixSeed(seed >>> 0)),
    reached = Object.fromEntries(STAGE_ORDER.map(s => [s, 0]));
  const keys = [USER, 'a', 'b', 'c'],
    rating_ = { [USER]: rating, a: targets[0], b: targets[1], c: targets[2] };
  for (let k = 0; k < runs; k++) {
    const fixtures = FIXTURES.flatMap((f, md) =>
      [
        [f[0], f[1]],
        [f[2], f[3]],
      ].map(([h, a]) => ({
        md,
        home: keys[h],
        away: keys[a],
        score: simulateResult(rating_[keys[h]], rating_[keys[a]], random).goals,
      })),
    );
    let stage = 'group';
    if (standings(keys, fixtures).findIndex(r => r.key === USER) < 2) {
      stage = 'r16';
      for (let r = 3; r < 7; r++) {
        const res = simulateResult(rating, targets[r], random, { knockout: true });
        const won = res.goals[0] > res.goals[1] || res.shootout?.winner === 0;
        if (!won) break;
        stage = r === 6 ? 'champion' : CUP_ROUNDS[r + 1].stage;
      }
    }
    reached[stage]++;
  }
  const probabilities = Object.fromEntries(STAGE_ORDER.map(s => [s, round2(reached[s] / runs)]));
  // Median outcome: the furthest stage reached in at least half of the runs.
  let cumulative = 0,
    stage = 'group';
  for (const s of [...STAGE_ORDER].reverse()) {
    cumulative += reached[s];
    if (cumulative >= runs / 2) {
      stage = s;
      break;
    }
  }
  return { stage, label: 'Projected: ' + STAGE_LABELS[stage], probabilities };
}
