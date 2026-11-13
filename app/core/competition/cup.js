// World Cup Run: a group of four (you + three AI teams), three group matches, top two advance
// (and a third place with enough points: BEST_THIRD, the 2026 format's eight best thirds of
// twelve groups), then Round of 32, Round of 16, quarter-final, semi-final and the final — or,
// for the semi-final's loser, the third-place play-off. Eight matches for every run that reaches
// the semi-finals. A run ends on a place: champions, runners-up, third, fourth, or the round it
// went out in.
// Opponents: Pro and World Class draw real nations (or clubs) from the draft ladder with round
// offsets (CUP_TUNING); Legendary in a Nations draft plays the real field: a whole 48-nation
// tournament is drawn and simulated from the run's seed (worldCupDraw) and the user meets
// whoever comes through his part of the bracket.
// The UI plays the user's matches with the engine and reports each result; AI-vs-AI results
// come from the seeded rating model (competition/model.js). Pure; serialise/restore for
// localStorage. API guide: docs/competition-api.md.
import { CONFIG } from '../config/config.js';
import { lcg, lcgNext, LCG_RANGE } from '../util/rng.js';
import { FORMATIONS } from '../players/formations.js';
import {
  catalogIndex,
  catalogStamp,
  draftRules,
  roleRating,
  roleFit,
  naturalRating,
  isKeeper,
} from '../draft/pools.js';
import { buildSide, seedValue, mixSeed, DIFFICULTIES } from '../draft/session.js';
import { validLinks } from '../draft/links.js';
import {
  chooseOpponent,
  buildOpponent,
  opponentCandidates,
  ladderTarget,
  MODE_BASELINES,
} from '../draft/opponents.js';
import { simulateResult } from './model.js';
import { matchPerformances } from './scorers.js';
import { tournamentSteps } from './awards.js';
import { baseProfileId } from '../players/legends.js';
import { eraPlayer } from '../players/eras.js';

export const CUP_ROUNDS = [
  { id: 'group1', label: 'Group · Matchday 1', stage: 'group', knockout: false },
  { id: 'group2', label: 'Group · Matchday 2', stage: 'group', knockout: false },
  { id: 'group3', label: 'Group · Matchday 3', stage: 'group', knockout: false },
  { id: 'r32', label: 'Round of 32', stage: 'r32', knockout: true },
  { id: 'r16', label: 'Round of 16', stage: 'r16', knockout: true },
  { id: 'qf', label: 'Quarter-final', stage: 'qf', knockout: true },
  { id: 'sf', label: 'Semi-final', stage: 'sf', knockout: true },
  { id: 'final', label: 'Final', stage: 'final', knockout: true },
];
/** The eighth match of a run that lost its semi-final (in place of the final). */
export const THIRD_ROUND = {
  id: 'third',
  label: 'Third-place play-off',
  stage: 'third',
  knockout: true,
};
const LAST = CUP_ROUNDS.length - 1,
  SEMI = LAST - 1,
  // Index of the play-off opponent (the other semi-final's loser) in a run's `opponents`.
  THIRD = CUP_ROUNDS.length;
/** The stage a run is in while it is being played (snapshot.stage of an unfinished run). */
export const STAGE_LABELS = {
  group: 'Group stage',
  r32: 'Round of 32',
  r16: 'Round of 16',
  qf: 'Quarter-finals',
  sf: 'Semi-finals',
  third: 'Third-place play-off',
  final: 'Final',
  champion: 'Champions',
};
/**
 * Where a finished run ended, worst to best (snapshot.place; also snapshot.stage once the run
 * is over): out in the group / Round of 32 / Round of 16 / quarter-finals, fourth (lost the
 * third-place play-off), third (won it), 'final' = runners-up, champion.
 */
export const PLACES = ['group', 'r32', 'r16', 'qf', 'fourth', 'third', 'final', 'champion'];
export const PLACE_LABELS = {
  group: 'Group stage',
  r32: 'Round of 32',
  r16: 'Round of 16',
  qf: 'Quarter-finals',
  fourth: 'Fourth place',
  third: 'Third place',
  final: 'Runners-up',
  champion: 'Champions',
};
/** Medals of the top three places. */
export const MEDALS = { champion: 'gold', final: 'silver', third: 'bronze' };
/**
 * Opponent strength per round for the ladder difficulties: offsets (effective rating) to the
 * level's ladder target, in round order MD1, MD2, MD3, R32, R16, QF, SF, final, third-place
 * play-off. The group is drawn from "lower pots" (weaker than the level); the knockouts escalate
 * so the final is a top side for that difficulty; the play-off opponent is a beaten
 * semi-finalist. Real teams only (no World XI / All-Stars). Legendary's row is used outside a
 * Nations draft only: in Nations it plays the real field (worldCupDraw). Tuned with
 * tools/calibration/cup-calibration.mjs (docs/competition-api.md).
 */
export const CUP_TUNING = {
  pro: [-12, -10.5, -9, -9, -8.5, -5.5, -2.5, 2.5, -2.5],
  worldclass: [-12.5, -11, -9.5, -9.5, -9, -5.5, -2.5, 0.5, -2.5],
  legendary: [-13, -11.5, -10, -10, -9.5, -6.5, -3.5, -1, -3.5],
};
/**
 * The difficulty that plays the real World Cup field in a Nations draft, and the effective
 * ratings a run meets there on average (group pots 4, 3, 2, then R32, R16, QF, SF, final,
 * play-off; cup-calibration.mjs runs --only legendary) — projectRun's targets for it.
 */
export const FIELD_LEVEL = 'legendary';
export const FIELD_TYPICAL = [77.2, 79.1, 81.3, 80.3, 83.5, 84.6, 85.6, 86.5, 84.9];
/**
 * Rating points the fast model adds to the user in his knockout matches (projectRun,
 * simulateNext). In the engine a drafted XI goes through 77.6% of its cup knockout ties where
 * independent Poisson goals at the same ratings say 73.0% (584 ties,
 * tools/calibration/cup-calibration.mjs runs --engine): the engine converts a rating edge into
 * wins a little more reliably than the model. Group matches agree with the model (81.7% vs
 * 79.7% wins), so they get no edge.
 */
export const KNOCKOUT_EDGE = 1.5;
/** The nine round offsets (group ×3, R32, R16, QF, SF, final, play-off) of a difficulty. */
export function cupOffsets(difficulty = 'pro', tuning = CUP_TUNING) {
  return [...(tuning[difficulty] ?? tuning.pro)];
}
/**
 * Third place in the group goes through with BEST_THIRD.points or more, and never with fewer
 * (in the 2026 format eight of twelve thirds go through; a third on 4+ points always does).
 * One plain rule, so the hub can tell the user exactly what a third place needs.
 */
export const BEST_THIRD = { points: 4 };
/** Does a group-table row in third place go through? Four points or more, nothing less. */
export const thirdQualifies = row => row.points >= BEST_THIRD.points;
/** Whether a row of the final group table goes through: top two, or a qualifying third. */
const advances = (row, index) => index < 2 || (index === 2 && thirdQualifies(row));
// Format 4: the user's XI can hold era cards (catalog.eras); the third-place play-off (nine
// opponents) and three difficulties. Anything older
// is not a saved run.
export const CUP_FORMAT = 4;
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
  pot: s.pot ?? null,
});
/** The group stage: three matches, played in the formation the XI was drafted in. */
const GROUP_MATCHES = 3;
// A side's tactics as the UI keeps them ({ mentality: 'push', tempo: 3, … }): a few short
// strings and numbers, nothing else.
function plainTactics(tactics) {
  const out = {};
  if (!tactics || typeof tactics !== 'object') return out;
  for (const [key, value] of Object.entries(tactics).slice(0, 12))
    if (typeof value === 'string' ? value.length <= 24 : Number.isFinite(value)) out[key] = value;
  return out;
}
/** A recorded match the user got through: won, or won on penalties. */
const wonMatch = m => m.outcome === 'W' || m.shootout?.winner === 'user';

// One recorded player line of a match.
const playerLine = p => ({
  profileId: String(p.profileId),
  rating: Number(p.rating) || 0,
  goals: p.goals | 0,
  assists: p.assists | 0,
});

export class CupRun {
  #catalog;
  #index;
  #awards = null;
  constructor(catalog, state) {
    this.#catalog = catalog;
    this.#index = catalogIndex(catalog);
    Object.assign(this, structuredClone(state));
    for (const id of [...this.user.players, ...this.opponents.flatMap(o => o.players)])
      if (!this.#player(id)) throw Error('Saved run does not match the player database');
  }
  get complete() {
    return this.status !== 'playing';
  }
  get round() {
    return this.complete ? null : this.matches.length;
  }
  // A catalog player, or a drafted era card (catalog.eras).
  #player(id) {
    return this.#index.byId.get(id) ?? eraPlayer(this.#catalog, id);
  }
  #players(ids) {
    return ids.map(id => this.#player(id));
  }
  /** Engine-ready user side (buildSide), with the tactics set for the run (setLineup), if any. */
  userSide() {
    const { tactics, ...u } = this.user;
    const side = buildSide({
      ...u,
      players: this.#players(u.players),
      links: this.rules.links,
      kind: 'draft',
    });
    return tactics ? { ...side, tactics: { ...tactics } } : side;
  }
  /**
   * The formation the XI was drafted in is played through the group stage: it can change from
   * the Round of 32 on.
   */
  get formationLocked() {
    return !this.complete && this.matches.length < GROUP_MATCHES;
  }
  /**
   * The user's line-up for the matches to come — what was set up before a match stays for the
   * next ones: { formation?, players? (the same eleven, ids or players, in the new slot
   * order), tactics? ({ mentality, … }) }. Team OVR and effective rating follow the new slots.
   * Returns false, changing nothing, when it is not this XI, a keeper is not in goal (or an
   * outfield player is), the formation is unknown, or it would change during the group stage.
   */
  setLineup({ formation = this.user.formation, players = this.user.players, tactics } = {}) {
    if (this.complete || !FORMATIONS[formation]) return false;
    if (formation !== this.user.formation && this.formationLocked) return false;
    if (!Array.isArray(players) || players.length !== 11) return false;
    const ids = players.map(p => (typeof p === 'string' ? p : String(p?.profileId))),
      mine = new Set(this.user.players);
    if (new Set(ids).size !== 11 || ids.some(id => !mine.has(id))) return false;
    const rows = FORMATIONS[formation],
      xi = this.#players(ids);
    if (xi.some((p, slot) => (rows[slot][2] === 'GK') !== isKeeper(p))) return false;
    const { tactics: kept, ...u } = this.user,
      side = buildSide({ ...u, formation, players: xi, links: this.rules.links, kind: 'draft' });
    const next = tactics === undefined ? kept : plainTactics(tactics);
    this.user = {
      ...u,
      formation,
      players: ids,
      rating: side.rating,
      effective: side.effective,
      ...(next && Object.keys(next).length ? { tactics: next } : {}),
    };
    return true;
  }
  /** The semi-final was lost: the eighth match is the third-place play-off. */
  #playoff() {
    const semi = this.matches[SEMI];
    return !!semi && !wonMatch(semi);
  }
  #info(round) {
    return round === LAST && this.#playoff() ? THIRD_ROUND : CUP_ROUNDS[round];
  }
  #opponent(round) {
    return this.opponents[round === LAST && this.#playoff() ? THIRD : round];
  }
  /** Engine-ready side of the opponent in a round (0–7; the play-off's once the semi is lost). */
  opponentSide(round) {
    const o = this.#opponent(round);
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
      info = this.#info(round);
    return {
      round,
      ...info,
      seed: this.matchSeed(round),
      // Group matches are played in the formation the XI was drafted in.
      formationLocked: this.formationLocked,
      opponent: this.#opponentSummary(round),
      home: this.userSide(),
      away: this.opponentSide(round),
    };
  }
  // Group opponents carry a pot label: their real pot in the field (Legendary), otherwise by
  // strength, strongest pot 2 … weakest pot 4.
  #opponentSummary(round) {
    const { players, ...o } = this.#opponent(round);
    if (round > 2) return { ...o, pot: null };
    if (o.pot) return o;
    const stronger = this.opponents
      .slice(0, 3)
      .filter(
        x => x.effective > o.effective || (x.effective === o.effective && x.key > o.key),
      ).length;
    return { ...o, pot: 2 + stronger };
  }
  #random() {
    this.aiRng = lcgNext(this.aiRng);
    return this.aiRng / LCG_RANGE;
  }
  /**
   * Report the user's match: { goalsFor, goalsAgainst, extraTime?, shootout?, players?,
   * opponents? }.
   * The goals are the final score: a knockout tie that went to extra time (`extraTime: true`)
   * reports the score after it, and counts as a win or a defeat when that decided it.
   * shootout (knockout draws only): { winner: 'user' | 'opponent', score?: [for, against] }.
   * players: [{ profileId, rating (engine performance 3–10), goals?, assists? }]: the user's
   * XI in that match — the squad's stats, Player of the Tournament, Held you back and the
   * tournament awards count them. A result without them (the fast model, simulateNext) gets
   * the lines of competition/scorers.js, from the match's seed, so every match has its scorers.
   * opponents: the same lines for the other side, when the engine played the match.
   */
  recordResult({
    goalsFor,
    goalsAgainst,
    extraTime = false,
    shootout = null,
    players = [],
    opponents = [],
  }) {
    if (this.complete) throw Error('The run is over');
    for (const v of [goalsFor, goalsAgainst])
      if (!Number.isInteger(v) || v < 0) throw Error('Goals must be whole numbers');
    const round = this.matches.length,
      info = this.#info(round),
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
      opponent: this.#opponent(round).key,
      goals: [goalsFor, goalsAgainst],
      outcome,
      // Knockouts only: the tie went to extra time (the goals include it).
      extraTime: info.knockout && !!extraTime,
      shootout: pens,
      players: players.length
        ? players.map(playerLine)
        : this.#modelled(round, goalsFor, goalsAgainst),
      // The other side's lines when the engine played the match (else modelled for the awards).
      ...(opponents.length ? { against: opponents.map(playerLine) } : {}),
    });
    this.#awards = null;
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
        const table = standings(teams, this.group.fixtures, this.group.lots),
          position = table.findIndex(r => r.key === USER);
        if (!advances(table[position], position)) this.status = 'eliminated';
      }
    } else if (info.id === 'final') this.status = won ? 'champion' : 'eliminated';
    // The play-off ends the run either way (third or fourth); a lost semi-final leads to it.
    else if (info.id === 'third') this.status = 'eliminated';
    else if (!won && info.id !== 'sf') this.status = 'eliminated';
    return this.snapshot();
  }
  // The user's lines for a result that has none: scorers.js, seeded by the match.
  #modelled(round, goalsFor, goalsAgainst) {
    const rows = FORMATIONS[this.user.formation],
      xi = this.#players(this.user.players).map((p, slot) => ({ ...p, role: rows[slot][2] }));
    return matchPerformances(xi, {
      goalsFor,
      goalsAgainst,
      random: lcg(mixSeed(this.matchSeed(round) ^ 0x51ed270b)),
    });
  }
  /** Play the next match with the fast rating model (auto-sim / tests). */
  simulateNext(random = lcg(this.matchSeed(this.matches.length))) {
    const m = this.nextMatch();
    if (!m) return null;
    const edge = m.knockout ? KNOCKOUT_EDGE : 0,
      r = simulateResult(m.home.effective + edge, m.away.effective, random, {
        knockout: m.knockout,
      });
    return this.recordResult({
      goalsFor: r.goals[0],
      goalsAgainst: r.goals[1],
      extraTime: r.extraTime,
      shootout: r.shootout && {
        winner: r.shootout.winner ? 'opponent' : 'user',
        score: r.shootout.score,
      },
    });
  }
  /**
   * W-D-L by the final score — after extra time in a knockout tie that needed it (a tie decided
   * on penalties counts as a draw).
   */
  record() {
    const r = { w: 0, d: 0, l: 0, gf: 0, ga: 0, played: this.matches.length };
    for (const m of this.matches) {
      r[m.outcome.toLowerCase()]++;
      r.gf += m.goals[0];
      r.ga += m.goals[1];
    }
    return r;
  }
  /**
   * Where a finished run ended (PLACES): 'champion', 'final' (runners-up), 'third' / 'fourth'
   * (the play-off won / lost), or the round it went out in; null while it is being played.
   */
  place() {
    if (!this.complete) return null;
    if (this.status === 'champion') return 'champion';
    const last = this.matches.at(-1);
    if (last.id === 'third') return wonMatch(last) ? 'third' : 'fourth';
    return CUP_ROUNDS[last.round].stage;
  }
  /** The stage being played ('group' … 'sf', 'third', 'final'); the place once it is over. */
  stage() {
    return this.place() ?? this.#info(this.matches.length).stage;
  }
  table() {
    const [, a, b, c] = this.group.teams;
    return standings([USER, a, b, c], this.group.fixtures, this.group.lots);
  }
  // ---- player awards --------------------------------------------------------------------
  #playerStats() {
    const stats = new Map(
      this.user.players.map((id, slot) => [
        id,
        { profileId: id, slot, ratings: [], goals: 0, assists: 0, cleanSheets: 0 },
      ]),
    );
    for (const m of this.matches)
      for (const p of m.players) {
        const s = stats.get(p.profileId);
        if (!s) continue;
        s.ratings.push(p.rating);
        s.goals += p.goals;
        s.assists += p.assists;
        if (m.goals[1] === 0) s.cleanSheets++;
      }
    const rows = FORMATIONS[this.user.formation];
    return [...stats.values()].map(s => {
      const p = this.#player(s.profileId),
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
        // Matches without a goal against — the keeper's number.
        cleanSheets: s.cleanSheets,
        slotRating: Math.round(roleRating(p, role)),
        natural: Math.round(naturalRating(p)),
        familiarity: round2(roleFit(p, role)),
      };
    });
  }
  /**
   * The XI's tournament so far, in slot order: [{ profileId, name, role, matches, goals,
   * assists, average (match rating, null before a match), cleanSheets, slotRating, … }] —
   * whichever way the matches were played.
   */
  squadStats() {
    return this.#playerStats();
  }
  /**
   * The tournament's awards (competition/awards.js), once the run is over: { teams, boot,
   * ball, glove } — null while it is being played. awardsSteps() is the same work as a
   * step-wise generator (a Legendary run builds the 38 other squads of its World Cup): drive it
   * with services/catalog.js stepped(); its return value is the awards.
   */
  awards() {
    const steps = this.awardsSteps();
    let step = steps.next();
    while (!step.done) step = steps.next();
    return step.value;
  }
  *awardsSteps() {
    if (!this.complete) return null;
    this.#awards ??= yield* tournamentSteps(this, {
      catalog: this.#catalog,
      player: id => this.#player(id),
    });
    return this.#awards;
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
    // Compared with the Team OVR every screen shows (user.rating), not a second average.
    const team = Number.isFinite(this.user.rating)
      ? this.user.rating
      : rows.reduce((s, r) => s + r.slotRating, 0) / rows.length;
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
            : r.slotRating <= team - 3
              ? `Weakest link: ${r.slotRating} OVR vs Team OVR ${team.toFixed(1)}`
              : rated
                ? `Lowest match rating: ${r.average}`
                : `Lowest rating in the XI: ${r.slotRating}`,
      }));
  }
  // ---- views ------------------------------------------------------------------------------
  snapshot() {
    const record = this.record(),
      table = this.table(),
      place = this.place();
    return {
      type: 'cup-snapshot',
      mode: this.mode,
      difficulty: this.difficulty,
      daily: this.daily ?? null,
      status: this.status,
      complete: this.complete,
      round: this.round,
      stage: this.stage(),
      stageLabel: place ? PLACE_LABELS[place] : STAGE_LABELS[this.stage()],
      // The finish: null while playing. medal: 'gold' | 'silver' | 'bronze' | null.
      place,
      placeLabel: place ? PLACE_LABELS[place] : null,
      medal: (place && MEDALS[place]) ?? null,
      perfect: place === 'champion' && record.w === CUP_ROUNDS.length,
      user: {
        name: this.user.name,
        rating: this.user.rating,
        effective: this.user.effective,
        formation: this.user.formation,
      },
      // The eighth round is the final, or the play-off once the semi-final is lost.
      rounds: CUP_ROUNDS.map((_, round) => {
        const m = this.matches[round],
          info = this.#info(round);
        return {
          ...info,
          opponent: this.#opponentSummary(round),
          result: m
            ? {
                goalsFor: m.goals[0],
                goalsAgainst: m.goals[1],
                outcome: m.outcome,
                extraTime: !!m.extraTime,
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
        // qualifies: goes through as the table stands (top two, or a third on BEST_THIRD).
        table: table.map((r, i) => ({
          ...r,
          qualifies: advances(r, i),
          name: r.key === USER ? this.user.name : this.opponents.find(o => o.key === r.key).name,
          user: r.key === USER,
        })),
      },
      results: this.matches.map(m => m.outcome),
      record,
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

// ---- the real field (Legendary) ------------------------------------------------------------
function shuffle(list, random) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
const GROUP_PAIRS = [
  [0, 1],
  [2, 3],
  [0, 2],
  [3, 1],
  [0, 3],
  [1, 2],
];
/**
 * Draw and play a whole World Cup around the user, in the real format: the 48-nation field in
 * its four pots (catalogIndex field), twelve groups with one team per pot, the user in a pot-1
 * seat (the weakest pot-1 nation stays at home). The eleven other groups and every tie without
 * the user are played by the fast model; the top two of each group and the best thirds go to
 * the Round of 32, where the twelve group winners (the user's seat among them) and the four
 * best runners-up are seeded against the rest in a bracket drawn at random. The user meets whoever
 * comes through his part of the bracket; the play-off opponent is the loser of the other
 * semi-final. The user's group mates never reach his bracket (their group is being played by
 * the user, so its outcome is not known here): the 31 other places go to the 22 top-two
 * finishers of the other groups and the nine best of their eleven thirds.
 * Deterministic for `random`. Returns { group: 3 keys (pots 2, 3, 4), knockouts: 5 keys (R32 …
 * final), third: key, keys: all nine in opponent order, matches: every tie played here as
 * [stage, home key, away key, goals, goals, winner?] } or null when the catalog's field is not
 * 4 × 12 nations.
 */
export function worldCupDraw(catalog, { random, rules = CONFIG.draft }) {
  const nations = opponentCandidates(catalog, { rules }).filter(c => c.kind === 'nation'),
    rating = new Map(nations.map(c => [c.id, c.effective])),
    field = qualify(catalog, random, rules).filter(n => rating.has(n.id)),
    pots = [0, 1, 2, 3].map(pot => field.slice(pot * 12, pot * 12 + 12));
  if (field.length !== 48) return null;
  const seats = pots.map(pot => pot.map(n => n.id)),
    potOf = new Map(field.map((n, i) => ['nation:' + n.id, Math.floor(i / 12) + 1]));
  // The field is sorted by strength: the last nation of pot 1 is its weakest.
  seats[0][11] = USER;
  for (const pot of seats) shuffle(pot, random);
  const rank = (a, b) =>
    overall(a, b) || rating.get(b.key) - rating.get(a.key) || (a.key < b.key ? -1 : 1);
  const winners = [],
    seconds = [],
    thirds = [],
    // Every tie played here, for the tournament's awards: [stage, home, away, goals, goals,
    // winner (knockouts: 0 | 1)].
    matches = [];
  let mates = null;
  for (let g = 0; g < 12; g++) {
    const ids = seats.map(pot => pot[g]);
    if (ids.includes(USER)) {
      mates = ids.filter(id => id !== USER);
      continue;
    }
    const fixtures = GROUP_PAIRS.map(([h, a]) => ({
        home: ids[h],
        away: ids[a],
        score: simulateResult(rating.get(ids[h]), rating.get(ids[a]), random).goals,
      })),
      table = standings(ids, fixtures);
    for (const f of fixtures) matches.push(['group', f.home, f.away, ...f.score]);
    winners.push(table[0]);
    seconds.push(table[1]);
    thirds.push(table[2]);
  }
  for (const list of [winners, seconds, thirds]) list.sort(rank);
  // The Round of 32 draw: sixteen seeded teams (the group winners, the user's seat among them,
  // and the four best runners-up) against the rest, in a bracket drawn at random.
  const seeded = [USER, ...[...winners, ...seconds.slice(0, 4)].map(r => r.key)],
    rest = [...seconds.slice(4), ...thirds.slice(0, 9)].map(r => r.key);
  shuffle(seeded, random);
  shuffle(rest, random);
  let alive = seeded.flatMap((key, i) => [key, rest[i]]),
    third = null;
  const knockouts = [],
    stages = { 32: 'r32', 16: 'r16', 8: 'qf', 4: 'sf', 2: 'final' };
  while (alive.length > 1) {
    const next = [];
    for (let i = 0; i < alive.length; i += 2) {
      const a = alive[i],
        b = alive[i + 1];
      if (a === USER || b === USER) {
        knockouts.push(a === USER ? b : a);
        next.push(USER);
        continue;
      }
      const r = simulateResult(rating.get(a), rating.get(b), random, { knockout: true }),
        first = r.goals[0] > r.goals[1] || r.shootout?.winner === 0;
      matches.push([stages[alive.length], a, b, ...r.goals, first ? 0 : 1]);
      next.push(first ? a : b);
      if (alive.length === 4) third = first ? b : a;
    }
    alive = next;
  }
  const key = id => 'nation:' + id,
    draw = { group: mates.map(key), knockouts: knockouts.map(key), third: key(third) };
  return {
    ...draw,
    keys: [...draw.group, ...draw.knockouts, draw.third],
    pots: potOf,
    matches: matches.map(([stage, a, b, ...rest]) => [stage, key(a), key(b), ...rest]),
  };
}
/**
 * Qualification for one World Cup: 48 of the playable nations (catalogIndex playable),
 * strongest first. The strongest `nations.fieldCore` are always in; the other seats are drawn
 * without replacement from the rest, a nation's odds halving every `nations.fieldHalving`
 * rating points below the last core nation — so a lower-rated nation sometimes makes it, like
 * real qualification.
 */
function qualify(catalog, random, rules) {
  const index = catalogIndex(catalog, draftRules(rules)),
    { fieldSize, fieldCore, fieldHalving } = rules.nations,
    playable = index.playable;
  if (playable.length <= fieldSize) return index.field;
  const core = Math.min(fieldCore, fieldSize),
    chosen = playable.slice(0, core),
    rest = playable.slice(core),
    top = (playable[core - 1] ?? rest[0]).strength,
    weights = rest.map(n => 2 ** ((n.strength - top) / fieldHalving));
  while (chosen.length < fieldSize) {
    let r = random() * weights.reduce((a, b) => a + b, 0),
      i = weights.findIndex(w => (r -= w) < 0);
    if (i < 0) i = weights.findLastIndex(w => w > 0);
    chosen.push(rest[i]);
    weights[i] = 0;
  }
  return chosen.sort((a, b) => b.strength - a.strength || a.name.localeCompare(b.name));
}

/**
 * Start a World Cup Run after the draft.
 * @param catalog decoded catalog
 * @param options {
 *   mode, difficulty, seed,
 *   user: { name, color, secondary, formation, players: 11 catalog players or ids (slot order) },
 *   opponents?: 9 candidate keys (daily: fixed; group ×3, R32 … final, play-off),
 *   rules?: CONFIG.draft-like, rerolls?: number, daily?: daily id for the snapshot }
 */
export function createCupRun(catalog, options) {
  const { mode, difficulty = 'pro', seed, user, rules = CONFIG.draft, rerolls } = options;
  if (!MODE_BASELINES[mode]) throw Error('Unknown draft mode: ' + mode);
  if (!DIFFICULTIES.includes(difficulty)) throw Error('Unknown difficulty: ' + difficulty);
  const index = catalogIndex(catalog),
    players = user.players.map(p =>
      typeof p === 'string' ? (index.byId.get(p) ?? eraPlayer(catalog, p)) : p,
    );
  if (players.length !== 11 || players.some(p => !p)) throw Error('The run needs a complete XI');
  // Opponents never field the user's players — an era card counts as the current player.
  const ids = players.map(p => p.profileId),
    taken = players.map(baseProfileId),
    links = { links: rules.links };
  const side = buildSide({ ...user, players, ...links, kind: 'draft' });
  const rngSeed = seedValue(seed),
    random = lcg(mixSeed(rngSeed ^ 0x632be5ab));
  // Opponents: fixed keys (daily), the real field (Legendary, Nations), or the ladder with
  // round offsets; never repeating, real teams only.
  const field =
    !options.opponents && mode === 'nations' && difficulty === FIELD_LEVEL
      ? worldCupDraw(catalog, { random, rules })
      : null;
  const offsets = cupOffsets(difficulty),
    opponents = [],
    avoid = [...(field?.keys ?? [])];
  const candidates = opponentCandidates(catalog, { rules }),
    byKey = new Map(candidates.map(c => [c.key, c])),
    pots = field?.pots;
  const build = ref => buildOpponent(catalog, ref, { excludePlayers: taken, rules });
  while (opponents.length <= CUP_ROUNDS.length) {
    const round = opponents.length,
      fixed = options.opponents?.[round];
    const ref = fixed
      ? byKey.get(fixed)
      : field
        ? byKey.get(field.keys[round])
        : chooseOpponent(catalog, {
            mode,
            level: difficulty,
            offset: offsets[round],
            avoid,
            rules,
            rerolls,
            random,
            bosses: false,
          });
    if (!ref) throw Error('Unknown opponent: ' + fixed);
    if (!field) avoid.push(ref.key);
    let built = build(ref);
    if (!built && fixed) throw Error('Opponent cannot field an XI: ' + fixed);
    // A field nation left without an XI by the user's picks: the nearest nation steps in.
    if (!built && field) {
      const left = ref.key;
      const others = candidates
        .filter(c => c.kind === 'nation' && !avoid.includes(c.key))
        .sort(
          (x, y) => Math.abs(x.effective - ref.effective) - Math.abs(y.effective - ref.effective),
        );
      for (const other of others) {
        avoid.push(other.key);
        if ((built = build(other))) break;
      }
      if (!built) throw Error('No opponent can field an XI');
      for (const m of field.matches)
        for (const side of [1, 2]) if (m[side] === left) m[side] = built.key;
    }
    // A club weakened below an XI by the user's picks is skipped; the ladder draws again.
    if (built)
      opponents.push(
        sideRef({
          ...built,
          target: field
            ? null
            : ladderTarget(mode, difficulty, { offset: offsets[round], rules, rerolls }),
          pot: field && round < 3 ? (pots.get(ref.key) ?? null) : null,
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
    rules: structuredClone({ links: rules.links, ladder: rules.ladder }),
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
    // Group ×3, R32, R16, QF, SF, final, and the play-off opponent (index 8).
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
    // Legendary's World Cup: the ties played around the user (the awards count their players).
    ...(field ? { field: { matches: field.matches } } : {}),
  };
  return new CupRun(catalog, state);
}

/** Rebuild a run from serialize() output (throws if it does not fit the catalog). */
export function restoreCupRun(catalog, data) {
  if (data?.type !== 'cup-run' || data.format !== CUP_FORMAT) throw Error('Not a saved run');
  const { type, format, catalog: stamp, ...state } = data;
  // A run of a draft mode the game no longer has does not restore either.
  if (
    !DIFFICULTIES.includes(state.difficulty) ||
    !MODE_BASELINES[state.mode] ||
    state.opponents?.length !== CUP_ROUNDS.length + 1 ||
    !validLinks(state.rules?.links)
  )
    throw Error('Not a saved run');
  return new CupRun(catalog, state);
}

// The round a place reached ("Projected: Semi-finals" for a third or fourth place).
const REACHED = { fourth: 'sf', third: 'sf' };
/**
 * Projected finish for a team rating (effective) in a mode and level: a seeded Monte-Carlo of
 * runs against the ladder's round targets (Legendary in Nations: FIELD_TYPICAL) with the fast
 * model. For live draft meters.
 * @returns {{ stage ('group' | 'r32' | 'r16' | 'qf' | 'sf' | 'final' | 'champion': the round the
 *   median run reaches), place (its PLACES id), label,
 *   probabilities: {group, r32, r16, qf, fourth, third, final, champion} }}
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
  const level = DIFFICULTIES.includes(difficulty) ? difficulty : 'pro',
    targets =
      mode === 'nations' && level === FIELD_LEVEL
        ? FIELD_TYPICAL
        : cupOffsets(level).map(o => ladderTarget(mode, level, { offset: o, rules, rerolls })),
    random = lcg(mixSeed(seed >>> 0)),
    reached = Object.fromEntries(PLACES.map(s => [s, 0]));
  const keys = [USER, 'a', 'b', 'c'],
    rating_ = { [USER]: rating, a: targets[0], b: targets[1], c: targets[2] };
  const beats = target => {
    const res = simulateResult(rating + KNOCKOUT_EDGE, target, random, { knockout: true });
    return res.goals[0] > res.goals[1] || res.shootout?.winner === 0;
  };
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
    let place = 'group';
    const table = standings(keys, fixtures),
      position = table.findIndex(r => r.key === USER);
    if (advances(table[position], position)) {
      let r = 3;
      while (r < SEMI && beats(targets[r])) r++;
      if (r < SEMI) place = CUP_ROUNDS[r].stage;
      else if (beats(targets[SEMI])) place = beats(targets[LAST]) ? 'champion' : 'final';
      else place = beats(targets[THIRD]) ? 'third' : 'fourth';
    }
    reached[place]++;
  }
  const probabilities = Object.fromEntries(PLACES.map(s => [s, round2(reached[s] / runs)]));
  // Median outcome: the best place reached in at least half of the runs.
  let cumulative = 0,
    place = 'group';
  for (const s of [...PLACES].reverse()) {
    cumulative += reached[s];
    if (cumulative >= runs / 2) {
      place = s;
      break;
    }
  }
  const stage = REACHED[place] ?? place;
  return { stage, place, label: 'Projected: ' + STAGE_LABELS[stage], probabilities };
}
