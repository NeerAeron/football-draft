// Match: state, clock, periods, config import/export and the fixed-step loop.
// Behaviour lives in cohesive modules whose methods are installed on Match.prototype.
import { clamp } from '../util/math.js';
import { CONFIG, normalizeConfig } from '../config/config.js';
import { lcgNext, LCG_RANGE } from '../util/rng.js';
import { FORMATIONS } from '../players/formations.js';
import { coachAI, gameStateMentality } from './coach.js';
import { goalZone, goalGeometry } from './goal-zones.js';
import { makeIdentity } from './player-model.js';
import { STYLES, DEFAULT_TAGS } from '../players/traits.js';
import { normalizeBadges } from '../players/badges.js';
import { stoppageMinutes, PERIOD_START, PERIOD_SHARE } from './periods.js';
import { normalizeAttributes } from '../players/ratings.js';
import {
  W,
  H,
  DURATION_PROFILES,
  PROFILE,
  NUMBERS,
  NAMES,
  freshStats,
  install,
} from './constants.js';
import { Player, normalizeChem, beginStepCache, endStepCache } from './player.js';
import { PossessionMethods } from './possession.js';
import { PassingMethods } from './passing.js';
import { ShootingMethods } from './shooting.js';
import { DecisionMethods } from './decisions.js';
import { DefenceMethods } from './defence.js';
import { PlanningMethods } from './planning.js';
import { MovementMethods } from './movement.js';
import { FoulMethods } from './fouls.js';
import { BallMethods } from './ball.js';
import { RestartMethods } from './restarts.js';
import { InsightMethods, MENTALITIES } from './insights.js';

const MENTALITY_LEAN = { push: 1, balanced: 0, hold: -1 };
// Balanced changes nothing: the same fields as tuning.mentality.push / .hold, all zero.
const BALANCED = Object.freeze({
  line: 0,
  attacking: 0,
  restDefence: 0,
  runners: 0,
  shotUrge: 0,
  ambition: 0,
  turnoverCost: 0,
  join: 0,
  lateRuns: 0,
  pressing: 0,
  restartTime: 0,
  load: 0,
  chances: 0,
  exposure: 0,
});
// formation(): the last formation name seen per side and its FORMATIONS rows.
const FORMATION_NAME = [null, null],
  FORMATION_ROWS = [null, null];
import { ShootoutMethods } from './shootout.js';
import { KeeperMethods } from './keeper.js';
import { hypot } from './constants.js';

// Cold start. V8 chooses how a field is stored from the first values written to it and, when
// a later value does not fit (a whole-number field receives a fraction), re-shapes the object
// and throws away the compiled code of every function that used it. A match begins with whole
// numbers almost everywhere (y: 34, energy: 1, cooldown: 0) and meets its first fractions one
// field at a time over the first seconds and minutes of play, so the first match of a page or
// worker used to recompile its hot functions a couple of hundred times. primeShapes() writes a
// fraction once into those fields of a throwaway match: the engine remembers the wider storage
// for every match created afterwards. No value of a real match is touched.
const WHOLE_NUMBER_FIELDS = new Set([
  'id',
  'team',
  'slot',
  'number',
  'weakFoot',
  'yellowCards',
  'seed',
  'duration',
  'half',
  'eventId',
  'kickoffTeam',
  'lastTeam',
  'lastTouch',
  'taker',
]);
let shapesPrimed = false;
function primeShapes(duration) {
  shapesPrimed = true;
  try {
    const m = new Match(1, duration);
    m.importConfig(m.exportConfig());
    const p = m.players[0];
    for (const object of [m, m.ball, m.restart, m.stats[0], p, p.stats])
      for (const key of Object.keys(object))
        if (typeof object[key] === 'number' && key[0] !== '_' && !WHOLE_NUMBER_FIELDS.has(key))
          object[key] = 0.5;
  } catch {
    // Only an optimisation: never let it stop a match from being created.
  }
}

export class Match {
  constructor(seed = Date.now(), duration = 180) {
    if (!DURATION_PROFILES[duration]) throw new RangeError('Unsupported match length');
    this.seed = seed >>> 0;
    this.rng = this.seed;
    this.duration = duration;
    this.tuning = structuredClone(CONFIG);
    this.profile = { ...this.tuning.formats[duration] };
    this.players = [];
    this.pauseAtHalf = false;
    this.teams = [
      { name: 'Northside FC', short: 'NTH', color: '#d9f580' },
      { name: 'Southbank FC', short: 'STH', color: '#baaff0' },
    ].map(t => ({
      ...t,
      tactics: {
        formation: '433',
        style: 'balanced',
        tempo: 3,
        width: 3,
        press: 3,
        fluidity: 3,
        mentality: 'balanced',
      },
    }));
    const oldKeys = [
      'pace',
      'dribbling',
      'passing',
      'shooting',
      'vision',
      'defending',
      'stamina',
      'goalkeeping',
    ];
    // Paired roles have exactly equal starting ability, including goalkeepers.
    const abilities = FORMATIONS['433'].map(([, , role]) => {
      const a = {};
      oldKeys.forEach(
        (key, j) => (a[key] = clamp(PROFILE[role][j] + Math.round(this.rand() * 8 - 4), 5, 99)),
      );
      a.power = clamp(a.shooting * 0.65 + a.pace * 0.35, 20, 94) | 0;
      a.control = Math.round(a.dribbling * 0.7 + a.passing * 0.3);
      a.composure = Math.round(a.vision * 0.5 + a.shooting * 0.25 + a.defending * 0.25);
      a.strength = clamp(
        Math.round((role === 'CB' ? 84 : role === 'ST' ? 78 : 65) + this.rand() * 12 - 6),
        35,
        96,
      );
      a.heading = clamp(
        Math.round((role === 'CB' ? 82 : role === 'ST' ? 86 : 55) + this.rand() * 12 - 6),
        25,
        95,
      );
      return a;
    });
    const identities = FORMATIONS['433'].map(([, , role], i) =>
      makeIdentity(role, i, () => this.rand(), abilities[i]),
    );
    for (let t = 0; t < 2; t++)
      FORMATIONS['433'].forEach(([x, y, role], i) =>
        this.players.push(
          new Player({
            tuning: this.tuning,
            id: t * 11 + i,
            team: t,
            slot: i,
            number: NUMBERS[i],
            name: NAMES[t][i],
            role,
            tags: [...DEFAULT_TAGS[i]],
            attrs: { ...abilities[i] },
            ...identities[i],
            tendencies: { ...identities[i].tendencies },
            x: t ? W - x : x,
            y: t ? H - y : y,
            vx: 0,
            vy: 0,
            tx: 0,
            ty: 0,
            facing: t ? Math.PI : 0,
            energy: 1,
            action: 'Holding shape',
            think: 0,
            cooldown: 0,
            hold: 0,
            trail: [],
            runs: 0,
            touch: 0,
          }),
        ),
      );
    this.competition = { mode: 'sandbox', difficulty: 'medium' };
    this._costCache = null;
    this._costBuffer = null;
    this._planPass = 0;
    this._coverTop = null;
    for (const p of this.players) this.setTags(p.id, p.tags);
    this.reset();
    if (!shapesPrimed) primeShapes(duration);
  }
  setDuration(duration) {
    if (!DURATION_PROFILES[duration]) throw new RangeError('Unsupported match length');
    this.duration = duration;
    this.profile = { ...this.tuning.formats[duration] };
    this.reset();
  }
  rand() {
    this.rng = lcgNext(this.rng);
    return this.rng / LCG_RANGE;
  }
  noise() {
    return (this.rand() + this.rand() + this.rand() - 1.5) * 2;
  }
  direction(t) {
    // A shootout is taken at one end: the kicking side always attacks x = 105.
    if (this.penaltyEnd != null) return t === this.penaltyEnd ? 1 : -1;
    return (t === 0 ? 1 : -1) * (this.half % 2 === 1 ? 1 : -1);
  }
  rel(x, t) {
    return this.direction(t) > 0 ? x : W - x;
  }
  abs(x, t) {
    return this.direction(t) > 0 ? x : W - x;
  }
  reset() {
    this.activePlayers = this.players;
    this.abandonedTeam = null;
    this.nextAI = 0;
    this.rng = this.seed;
    this.time = 0;
    this.elapsed = 0;
    this.half = 1;
    this.periodStart = 0;
    this.addedMinutes = stoppageMinutes(this.seed, this.tuning.periods);
    this.addedAnnounced = [false, false];
    this.halftime = null;
    this.score = [0, 0];
    this.stats = [0, 1].map(() => ({
      possession: 0,
      passes: 0,
      completed: 0,
      shots: 0,
      onTarget: 0,
      tackles: 0,
      saves: 0,
      takeons: 0,
      xg: 0,
      boxShots: 0,
      boxGoals: 0,
      centralGoals: 0,
      wideGoals: 0,
      assistedGoals: 0,
      crosses: 0,
      throughBalls: 0,
      keeperDistributions: 0,
      keeperLosses: 0,
      yellowCards: 0,
      redCards: 0,
      fouls: 0,
      foulsWon: 0,
      offsides: 0,
      penalties: 0,
      penaltyGoals: 0,
      blocked: 0,
      offTarget: 0,
      woodwork: 0,
      forwardPasses: 0,
      backwardPasses: 0,
      dribbleAttempts: 0,
      miscontrols: 0,
    }));
    this.events = [];
    this.eventId = 0;
    this.effects = [];
    this.ballTrail = [];
    this.lastShotSpeed = 0;
    this.phase = 'Kickoff';
    this.mode = 'restart';
    this.finished = false;
    this.planTimer = 0;
    this.lastTeam = 0;
    this.presser = [null, null];
    this.possessionStart = 0;
    this.lastPass = null;
    this.pendingTackle = null;
    this.keeperRelease = null;
    this.lastFlair = -10;
    this.goalHistory = [];
    this.duelHistory = [];
    this.ball = {
      x: 52.5,
      y: 34,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      owner: null,
      lastTouch: 0,
      kicker: null,
      target: null,
      kind: 'loose',
      age: 0,
      offside: false,
      deflectedBy: null,
      deflectedAt: -10,
      // Fields set later by passes, shots and restarts, declared up front (undefined reads
      // the same as absent) so the ball keeps one object shape: it is read in every hot loop.
      offsideState: undefined,
      restartTaker: undefined,
      delivery: undefined,
      strength: undefined,
      chance: undefined,
      pendingPass: undefined,
      destination: undefined,
      deliveryDemand: undefined,
      missedReceiver: undefined,
      saver: undefined,
      deliveryOrigin: undefined,
      passCraft: undefined,
      roll: undefined,
      curve: undefined,
      shotTeam: undefined,
      shotOrigin: undefined,
      shotType: undefined,
      shotRecord: undefined,
      assist: undefined,
      goalCredit: undefined,
      indirect: undefined,
      penaltyTaker: undefined,
      previous: undefined,
      heldSince: undefined,
      penaltyKick: undefined,
    };
    for (const p of this.players) {
      p.stats = freshStats();
      p.yellowCards = 0;
      p.sentOff = false;
      p.emergencyKeeper = false;
      p.dismissedRole = null;
      // A dismissal reshuffled formation slots (fouls.js coverDismissal): put them back.
      if (p.shiftedFrom != null) p.slot = p.shiftedFrom;
      p.shiftedFrom = null;
      p.beatChain = [];
      p.lastReceipt = null;
      p.energy = 1;
      p.sprint = 1;
      p.sprintRest = 0;
      p.markId = null;
      p.markUntil = 0;
      p.displayedAction = null;
      p.pendingAction = null;
      p.receivedAt = -10;
      p.possessionAt = -10;
      p.comboRun = null;
      p.runBehind = null;
      p.finishUntil = 0;
      p.finishTarget = null;
      p.goalKickExempt = false;
      p.penaltyDive = null;
      p.vx = 0;
      p.vy = 0;
      p.cooldown = 0;
      p.controlUntil = 0;
      p.controlErrorAt = -10;
      p.trail = [];
      p.action = 'Taking position';
      p.hold = 0;
      p.runs = 0;
      p.think = 0;
      p.touch = 0;
      p.animation = null;
      p.stun = 0;
      p.feintCooldown = 0;
      p.rethinkAt = 0;
      p.intent = 'shape';
      p.lastShotSpeed = 0;
      p.lastShotType = null;
      p.lastShotChance = null;
    }
    this.positionKickoff(0);
    this.restart = { type: 'Kickoff', team: 0, x: 52.5, y: 34, timer: 0.6, taker: 9 };
    this.kickoffTeam = this.seed % 2;
    this.positionKickoff(this.kickoffTeam);
    this.restart.team = this.kickoffTeam;
    this.restart.taker = this.kickoffTeam * 11 + 9;
    this.addEvent('Kickoff. A new match begins.', this.kickoffTeam, 'kickoff');
    this.shootout = null;
    this.shootoutState = null;
    this.penaltyEnd = null;
    this.resetInsights();
  }
  addEvent(text, team, type = 'play', extra = {}) {
    const e = {
      text,
      team,
      type,
      time: this.time,
      half: this.half,
      elapsed: this.elapsed,
      id: ++this.eventId,
      ...extra,
    };
    this.events.unshift(e);
    return e;
  }
  // The mentality in effect: the side's own choice, or the game-state one for 'auto'.
  mentality(team) {
    const chosen = this.teams[team].tactics.mentality;
    return chosen === 'auto' ? gameStateMentality(this, team) : chosen;
  }
  settings(team) {
    const t = this.teams[team].tactics,
      lean = this.lean(team),
      shift = this.mentalityShift(team);
    // Mentality leans the whole side: push = higher line, more bodies forward;
    // hold = deeper block, fewer runners, patient possession.
    return {
      ...t,
      lean,
      shift,
      pressing: (t.press - 1) * 25,
      widthValue: (t.width - 1) * 25,
      line: (t.style === 'bus' ? 12 : t.style === 'press' ? 72 : 50) + shift.line,
      attacking: (t.style === 'bus' ? 25 : t.style === 'counter' ? 65 : 50) + shift.attacking,
    };
  }
  // +1 push, 0 balanced, -1 hold (the mentality in effect).
  lean(team) {
    return MENTALITY_LEAN[this.mentality(team)] ?? 0;
  }
  // Room for a shot by `team` (0 = balanced against balanced): what its own mentality adds to
  // its chances plus what the defending side's mentality leaves open, and the rewards for a
  // well-timed choice (pushing while behind, holding a lead), read from the score right now.
  shootingRoom(team) {
    const own = this.mentalityShift(team),
      other = this.mentalityShift(1 - team),
      lead = this.score[team] - this.score[1 - team],
      rules = this.tuning.mentality;
    return (
      own.chances +
      other.exposure +
      (lead < 0 && own === rules.push ? rules.chase : 0) -
      (lead < 0 && other === rules.hold ? rules.protect : 0)
    );
  }
  // What the mentality in effect changes (tuning.mentality.push / .hold; zeros when balanced).
  mentalityShift(team) {
    const lean = this.lean(team);
    return lean > 0 ? this.tuning.mentality.push : lean < 0 ? this.tuning.mentality.hold : BALANCED;
  }
  setTags(id, tags) {
    const p = this.players[id];
    p.tags = normalizeBadges(p, tags);
    return p.tags;
  }
  playerProfile(p) {
    return {
      name: p.name,
      fullName: p.fullName || p.name,
      primaryPosition: p.primaryPosition,
      secondaryPositions: [...p.secondaryPositions],
      profileId: p.profileId ?? null,
      sourcePlayerId: p.sourcePlayerId ?? null,
      sourceOverall: p.sourceOverall ?? null,
      source: p.source ? structuredClone(p.source) : null,
      inference: p.inference ? structuredClone(p.inference) : null,
      attrs: { ...p.attrs },
      tags: [...p.tags],
      foot: p.foot,
      weakFoot: p.weakFoot,
      tendencies: { ...p.tendencies },
      chem: p.chem,
    };
  }
  exportConfig() {
    return {
      tuning: structuredClone(this.tuning),
      competition: { ...this.competition },
      teams: this.teams.map(t => ({ ...t, tactics: { ...t.tactics } })),
      players: this.players.map(p => this.playerProfile(p)),
    };
  }
  lineupFixed() {
    return (
      ['ai', 'pvp'].includes(this.competition?.mode) && (this.mode !== 'halftime' || this.finished)
    );
  }
  importConfig(c) {
    this.tuning = normalizeConfig(c.tuning || this.tuning);
    this.profile = { ...this.tuning.formats[this.duration] };
    this.competition = { mode: 'sandbox', difficulty: 'medium', ...c.competition };
    this.teams = c.teams.map(t => ({
      ...t,
      tactics: {
        fluidity: 3,
        ...t.tactics,
        mentality: MENTALITIES.includes(t.tactics?.mentality) ? t.tactics.mentality : 'balanced',
      },
    }));
    this.players.forEach((p, i) => {
      const data = c.players[i];
      p.tuning = this.tuning;
      p.attrs = normalizeAttributes(data.attrs);
      p.name = data.name || p.name;
      p.fullName = data.fullName || p.name;
      p.primaryPosition = data.primaryPosition || p.primaryPosition;
      p.secondaryPositions = [...(data.secondaryPositions || [])];
      // Named stores, not `p[key] = …`: a keyed store that adds a property turns
      // an object this large into a dictionary (slow property access everywhere).
      p.profileId = data.profileId == null ? null : structuredClone(data.profileId);
      p.sourcePlayerId = data.sourcePlayerId == null ? null : structuredClone(data.sourcePlayerId);
      p.sourceOverall = data.sourceOverall == null ? null : structuredClone(data.sourceOverall);
      p.source = data.source == null ? null : structuredClone(data.source);
      p.inference = data.inference == null ? null : structuredClone(data.inference);
      p.foot = data.foot === 'left' ? 'left' : 'right';
      p.weakFoot = data.weakFoot ?? p.weakFoot;
      p.tendencies = { ...p.tendencies, ...data.tendencies };
      p.chem = normalizeChem(data.chem);
      this.setTags(p.id, data.tags || []);
    });
    this.reset();
  }
  setPlayerProfile(id, profile) {
    if (
      ['ai', 'pvp'].includes(this.competition?.mode) ||
      this.elapsed > 0 ||
      this.finished ||
      !this.players[id]
    )
      return false;
    if (
      profile.profileId &&
      this.activePlayers.some(
        p => p.id !== id && p.team === this.players[id].team && p.profileId === profile.profileId,
      )
    )
      return false;
    const config = this.exportConfig();
    config.players[id] = structuredClone(profile);
    this.importConfig(config);
    return true;
  }
  swapLineup(a, b) {
    const p = this.players[a],
      q = this.players[b];
    if (
      this.lineupFixed() ||
      this.finished ||
      !p ||
      !q ||
      p.sentOff ||
      q.sentOff ||
      p.team !== q.team ||
      (this.elapsed > 0 && this.mode !== 'halftime')
    )
      return false;
    if (this.mode === 'halftime') {
      if ((p.role === 'GK') !== (q.role === 'GK')) return false;
      [p.slot, q.slot] = [q.slot, p.slot];
      p.role = this.formation(p)[2];
      q.role = this.formation(q)[2];
      return true;
    }
    const c = this.exportConfig();
    [c.players[a], c.players[b]] = [c.players[b], c.players[a]];
    this.importConfig(c);
    return true;
  }
  location(p, team = p.team) {
    return goalGeometry(this.rel(p.x, team), p.y);
  }
  origin(p) {
    return {
      x: p.x,
      y: p.y,
      attackX: this.rel(p.x, p.team),
      box: this.inBox(p),
      zone: goalZone(this.rel(p.x, p.team), p.y),
    };
  }
  canHandle(p) {
    return p.role === 'GK' && this.rel(p.x, p.team) <= 16.5 && Math.abs(p.y - 34) <= 20.16;
  }
  inBox(p, team = p.team) {
    return this.rel(p.x, team) >= 88.5 && Math.abs(p.y - 34) <= 20.16;
  }
  formation(p) {
    if (p.emergencyKeeper) return [4, 34, 'GK'];
    // Hot path: remember each side's rows instead of looking the name up every call.
    const team = p.team,
      name = this.teams[team].tactics.formation;
    if (FORMATION_NAME[team] !== name) {
      FORMATION_ROWS[team] = FORMATIONS[name];
      FORMATION_NAME[team] = name;
    }
    return FORMATION_ROWS[team][p.slot];
  }
  keeper(team) {
    return this.activePlayers.find(p => p.team === team && p.role === 'GK');
  }
  kickoffTaker(team) {
    return this.activePlayers
      .filter(p => p.team === team)
      .sort(
        (a, b) =>
          (a.role === 'GK') - (b.role === 'GK') + (b.role === 'ST') - (a.role === 'ST') ||
          b.slot - a.slot,
      )[0];
  }
  rebuildActive() {
    this.activePlayers = this.players.filter(p => !p.sentOff);
  }
  positionKickoff(team) {
    for (const p of this.activePlayers) {
      const [x, y, role] = this.formation(p);
      p.role = role;
      p.x = this.abs(Math.min(x * 0.67, 49), p.team);
      p.y = this.direction(p.team) > 0 ? y : H - y;
      p.tx = p.x;
      p.ty = p.y;
      p.vx = p.vy = 0;
      p.trail = [];
    }
    const taker = this.kickoffTaker(team);
    taker.x = 52.5 - this.direction(team) * 0.6;
    taker.y = 34;
    taker.tx = taker.x;
    taker.ty = taker.y;
    this.ball.x = 52.5;
    this.ball.y = 34;
  }
  // Returns true when applied, false when the lineup is locked, undefined when invalid.
  // Mentality ('push' | 'balanced' | 'hold') is a tactic like any other: it is
  // exported with the config and never draws from the match RNG.
  setTactic(team, key, value) {
    if (key === 'formation' && this.lineupFixed()) return false;
    if ((key === 'formation' && !FORMATIONS[value]) || (key === 'style' && !STYLES[value])) return;
    if (key === 'mentality' && !MENTALITIES.includes(value)) return;
    if (['tempo', 'width', 'press', 'fluidity'].includes(key))
      value = clamp(Math.round(Number(value)), 1, 5);
    if (
      !['formation', 'style', 'tempo', 'width', 'press', 'fluidity', 'mentality'].includes(key) ||
      (typeof value === 'number' && !Number.isFinite(value))
    )
      return;
    this.teams[team].tactics[key] = value;
    if (key === 'formation')
      this.activePlayers.filter(p => p.team === team).forEach(p => (p.role = this.formation(p)[2]));
    this.planTimer = 0;
    for (const p of this.activePlayers) if (p.team === team) p.rethinkAt = 0;
    return true;
  }
  // Expire visual effects in place (no per-step allocation).
  ageEffects(dt) {
    const effects = this.effects;
    let n = 0;
    for (let i = 0; i < effects.length; i++)
      if ((effects[i].life -= dt) > 0) effects[n++] = effects[i];
    effects.length = n;
  }
  flair(type, p, duration, extra = {}, force = false) {
    if (!force && this.elapsed - this.lastFlair < 1.1) return;
    this.lastFlair = this.elapsed;
    this.effects = this.effects.filter(e => e.type === 'goal');
    this.effect(type, p, duration, extra);
  }
  effect(type, p, duration, extra = {}) {
    this.effects.push({
      type,
      x: p.x,
      y: p.y,
      life: duration,
      maxLife: duration,
      team: p.team,
      ...extra,
    });
  }
  periodDeadline() {
    return (
      this.periodStart +
      this.duration * PERIOD_SHARE[this.half - 1] +
      (this.addedMinutes[this.half - 1] * this.duration) / 90
    );
  }
  // Real seconds of regulation including stoppage time (plus extra time once it starts).
  expectedDuration() {
    return (
      this.duration * (1 + this.addedMinutes.reduce((a, b) => a + b, 0) / 90) +
      (this.half > 2 ? this.duration / 3 : 0)
    );
  }
  finishPeriod() {
    this.resolveShot('off target');
    if (this.half === 1) {
      const outfield = this.activePlayers.filter(p => p.role !== 'GK'),
        averageStamina = outfield.reduce((sum, p) => sum + p.skill('stamina'), 0) / outfield.length,
        averageTag = (outfield.filter(p => p.has('engine')).length / outfield.length) * 0.008;
      this.halftime = {
        elapsed: this.elapsed,
        time: this.time,
        score: [...this.score],
        energyBefore: this.players.map(p => p.energy),
      };
      for (const p of this.activePlayers) {
        p.energy = clamp(
          p.energy +
            this.tuning.stamina.halftimeRecovery +
            ((p.skill('stamina') - averageStamina) * 0.0005 +
              (p.has('engine') ? 0.008 : 0) -
              averageTag) *
              this.tuning.stamina.halftimeVariation,
          0.001,
          1,
        );
        p.sprint = 1;
        p.sprintRest = 0;
        p.vx = p.vy = 0;
      }
      this.halftime.energyAfter = this.players.map(p => p.energy);
      this.mode = 'halftime';
      this.phase = 'Half-time';
      this.addEvent('Half-time. Time to recover and adjust tactics.', null, 'half');
    } else if (this.half === 2 && this.knockoutLevel() && this.competition.extraTime)
      this.startExtraHalf(3);
    else if (this.half === 3) this.startExtraHalf(4);
    else if (this.knockoutLevel()) {
      for (const p of this.activePlayers) p.vx = p.vy = 0;
      this.addEvent('Full-time. Level, so it goes to penalties.', null, 'full', {
        shootout: true,
      });
      this.startShootout();
    } else {
      this.finished = true;
      this.mode = 'fulltime';
      this.phase = 'Full time';
      for (const p of this.activePlayers) p.vx = p.vy = 0;
      this.finalizeStory();
      this.addEvent('Full-time. The final whistle.', null, 'full');
    }
  }
  // The side that won (0 / 1), null for a draw or while undecided. A shootout
  // decides a level knockout match.
  winner() {
    if (!this.finished || this.abandonedTeam != null)
      return this.abandonedTeam != null ? 1 - this.abandonedTeam : null;
    if (this.score[0] !== this.score[1]) return this.score[0] > this.score[1] ? 0 : 1;
    return this.shootout?.winner ?? null;
  }
  resumeHalf() {
    if (this.mode !== 'halftime') return false;
    this.half = 2;
    this.periodStart = this.elapsed;
    this.time = 2700;
    this.momentumNext = 2700 + this.momentum.step;
    const team = 1 - this.kickoffTeam;
    this.clearTransient();
    if (this.competition?.mode === 'ai') coachAI(this, true);
    this.positionKickoff(team);
    this.startRestart('Second half', team, 52.5, 34, 1.25);
    return true;
  }
  step(dt) {
    beginStepCache();
    try {
      this.stepInner(dt);
    } finally {
      endStepCache();
    }
  }
  stepInner(dt) {
    if (this.finished) return;
    if (this.mode === 'halftime') {
      if (!this.pauseAtHalf) this.resumeHalf();
      return;
    }
    if (this.mode === 'shootout') {
      dt = Math.min(dt, 0.05);
      this.elapsed += dt;
      this.ageEffects(dt);
      this.stepShootout(dt);
      return;
    }
    if (this.competition?.mode === 'ai' && this.elapsed >= this.nextAI) {
      coachAI(this);
      this.nextAI = this.elapsed + this.tuning.ai.coachInterval;
    }
    dt = Math.min(dt, 0.05);
    this.elapsed += dt;
    this.time =
      PERIOD_START[this.half - 1] + ((this.elapsed - this.periodStart) / this.duration) * 5400;
    this.ageEffects(dt);
    this.trackMomentum(dt);
    if (
      this.elapsed - this.periodStart >= this.duration * PERIOD_SHARE[this.half - 1] &&
      !this.addedAnnounced[this.half - 1]
    ) {
      this.addedAnnounced[this.half - 1] = true;
      this.addEvent(
        `A minimum of ${this.addedMinutes[this.half - 1]} added minutes.`,
        null,
        'added',
        { minutes: this.addedMinutes[this.half - 1] },
      );
    }
    const pendingPenalty =
      (this.mode === 'restart' && this.restart.type === 'Penalty') ||
      (this.ball.penaltyKick &&
        (this.ball.kind === 'shot' || this.ball.kind === 'loose') &&
        hypot(this.ball.vx, this.ball.vy) > 0.5);
    const settling =
      (this.ball.kind === 'shot' && this.ball.age < 3) ||
      (this.mode === 'restart' && this.restart.type === 'Goal' && this.restart.timer > 0.1);
    if (
      this.elapsed >= this.periodDeadline() - 1e-7 &&
      !pendingPenalty &&
      (!settling || this.elapsed > this.periodDeadline() + 4)
    ) {
      this.finishPeriod();
      return;
    }
    if (this.mode === 'restart') {
      this.stepRestart(dt);
      return;
    }
    const b = this.ball;
    b.age += dt;
    // A purposeful pass is still possession while it travels. Counting only
    // time at a carrier's feet unfairly favors slow dribbling over quick play.
    const possessionTeam =
      b.owner !== null
        ? this.players[b.owner].team
        : b.kind === 'pass' && !b.missedReceiver
          ? this.players[b.kicker]?.team
          : null;
    if (possessionTeam != null) this.stats[possessionTeam].possession += dt;
    this.planTimer -= dt;
    if (this.planTimer <= 0) {
      this.plan();
      this.planTimer = 0.1;
    }
    for (const p of this.activePlayers) this.move(p, dt);
    if (b.owner !== null) this.stepCarrier(dt);
    else this.moveBall(dt);
    if (this.mode === 'play') this.checkBounds();
  }
}
install(
  Match,
  PossessionMethods,
  PassingMethods,
  ShootingMethods,
  DecisionMethods,
  DefenceMethods,
  PlanningMethods,
  MovementMethods,
  FoulMethods,
  BallMethods,
  RestartMethods,
  InsightMethods,
  ShootoutMethods,
  KeeperMethods,
);
