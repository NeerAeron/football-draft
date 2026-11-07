import { CONFIG, normalizeConfig } from './config.js';
import { FORMATIONS } from './formations.js';
import { coachAI } from './ai.js';
import { goalZone, goalGeometry } from './goal-zones.js';
import { makeIdentity, preference, footExecution } from './player-model.js';
import { offsideSnapshot, offenceInBox, targetChance } from './rules.js';
import { cardRisk } from './discipline.js';
import { STYLES, DEFAULT_TAGS, badgeBoost } from './traits.js';
import { normalizeBadges } from './badges.js';
import { stoppageMinutes } from './periods.js';
import {
  normalizeAttributes,
  positionFamiliarity,
  passingAbility,
  shootingAbility,
  playerTier,
} from './ratings.js';
export { ATTRS } from './ratings.js';
// Flow: deterministic, fixed-step, continuous 11v11 football simulation.
export const W = 105,
  H = 68,
  GOAL = 7.32;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a, b, t) => a + (b - a) * t;
function segment(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return { d: Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t), t };
}
const NAMES = [
  [
    'Oliver Hart',
    'Theo Brooks',
    'Daniel Reed',
    'Luca Moretti',
    'Noah Park',
    'Elias Ward',
    'Leo Silva',
    'Mateo Cruz',
    'Finn Walker',
    'Alex Laurent',
    'Kai Morgan',
  ],
  [
    'Felix Weber',
    'Jules Martin',
    'Adam Cole',
    'Isaac Blake',
    'Rafael Costa',
    'Owen Clarke',
    'Hugo Vidal',
    'Emil Jensen',
    'Sam Okafor',
    'Marco Rossi',
    'Ben Turner',
  ],
];
const NUMBERS = [1, 3, 4, 5, 2, 6, 10, 8, 11, 9, 7];
const PROFILE = {
  GK: [49, 42, 65, 18, 65, 35, 65, 86],
  LB: [79, 70, 72, 46, 66, 77, 83, 9],
  RB: [82, 71, 70, 43, 68, 76, 84, 8],
  CB: [64, 47, 65, 32, 66, 86, 77, 8],
  DM: [67, 68, 83, 60, 82, 82, 87, 8],
  CM: [76, 83, 87, 75, 88, 63, 81, 8],
  LW: [91, 89, 75, 81, 77, 37, 75, 8],
  RW: [90, 86, 76, 82, 75, 39, 77, 8],
  ST: [82, 81, 65, 91, 79, 28, 76, 8],
  LM: [82, 80, 80, 72, 77, 58, 84, 8],
  RM: [84, 81, 78, 75, 78, 59, 82, 8],
  AM: [79, 88, 87, 82, 90, 42, 77, 8],
};
export const LENGTHS = { full: 300, quick: 180, highlights: 60, instant: 0 };
// Match length never scales movement. Highlights and Instant resolve a 300 s game.
export const DURATION_PROFILES = CONFIG.formats;
const freshStats = () => ({
  goals: 0,
  assists: 0,
  shots: 0,
  onTarget: 0,
  passes: 0,
  completed: 0,
  keyPasses: 0,
  tackles: 0,
  interceptions: 0,
  takeons: 0,
  saves: 0,
  blocks: 0,
  turnovers: 0,
  miscontrols: 0,
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
  distance: 0,
});
const sigmoid = x => 1 / (1 + Math.exp(-x));
// Abilities already affect execution directly. This secondary adjustment is
// deliberately gradual and bounded, so nearby ratings cannot multiply the
// same technical advantage into near-perfect play.
const skillError = (ability, influence) =>
  clamp(1 + (75 - ability) * 0.012 * influence, 0.72, 1.28);
export class Player {
  constructor(data) {
    Object.assign(this, data);
    this.attrs = normalizeAttributes(data.attrs);
    this.primaryPosition = data.primaryPosition || data.role;
    this.secondaryPositions = [...(data.secondaryPositions || [])];
    this.intent = 'shape';
    this.animation = null;
    this.stun = 0;
    this.feintCooldown = 0;
    this.rethinkAt = 0;
  }
  skill(key) {
    // Natural keepers have one technical rating. Their imported outfield
    // placeholders must not make an elite keeper incapable of distribution.
    const keeperTechnique =
      this.role === 'GK' &&
      this.primaryPosition === 'GK' &&
      ['shortPassing', 'longPassing', 'crossing', 'control', 'composure', 'vision'].includes(key);
    const value = this.attrs[keeperTechnique ? 'goalkeeping' : key];
    return clamp(
      70 + (value - 70) * (this.tuning || CONFIG).gameplay.qualityImpact + badgeBoost(this, key),
      1,
      99,
    );
  }
  has(tag) {
    const alias = { creator: 'vision', byline: 'cutback' };
    return this.tags?.includes(alias[tag] || tag);
  }
  familiarity() {
    return positionFamiliarity(this);
  }
  awareness() {
    return this.skill('awareness') * this.familiarity() ** 1.5;
  }
  defensiveReading() {
    return (
      clamp((this.awareness() * 0.8 + this.tackling() * 0.2 - 72) / 22, 0, 1) *
      (0.65 + 0.35 * this.energy) *
      (this.tuning || CONFIG).gameplay.defensiveQuality
    );
  }
  pressAwareness() {
    const base = this.awareness(),
      read = this.vision() * 0.6 + this.skill('composure') * this.familiarity() * 0.4 - 10;
    return (
      base +
      Math.max(0, read - base) * clamp((this.tuning || CONFIG).gameplay.defensiveQuality, 0, 1)
    );
  }
  pressingReading() {
    return Math.max(
      this.defensiveReading(),
      clamp((this.pressAwareness() - 70) / 20, 0, 1) *
        (0.65 + 0.35 * this.energy) *
        (this.tuning || CONFIG).gameplay.defensiveQuality,
    );
  }
  vision() {
    return this.skill('vision') * this.familiarity();
  }
  tackling() {
    return this.skill('defending') * this.familiarity();
  }
  tendency(key) {
    return preference(this, key);
  }
  baseSpeed() {
    return (3.7 + this.skill('pace') * 0.062) * (this.tuning || CONFIG).gameplay.movementSpeed;
  }
  acceleration() {
    return (
      (3.2 + this.skill('acceleration') * 0.08) * (this.tuning || CONFIG).gameplay.acceleration
    );
  }
  topSpeed(carrying = false) {
    return (
      this.baseSpeed() *
      (carrying
        ? (0.78 + this.skill('dribbling') * 0.0014) * (this.has('control') ? 0.96 : 1)
        : 1) *
      (0.72 + this.energy * 0.28)
    );
  }
  arrival(target) {
    const d = dist(this, target),
      speed = this.topSpeed() * (this.sprint < 0.2 || this.sprintRest > 0 ? 0.73 : 0.97),
      toward = ((target.x - this.x) * this.vx + (target.y - this.y) * this.vy) / (d || 1);
    return d / speed + ((1 - clamp(toward / speed, -1, 1)) * 0.28 * 9.28) / this.acceleration();
  }
  intercept(target, maxTime = 2.4) {
    const rx = target.x - this.x,
      ry = target.y - this.y,
      vx = target.vx || 0,
      vy = target.vy || 0,
      s = this.topSpeed() * (this.sprint < 0.2 || this.sprintRest > 0 ? 0.73 : 0.97);
    const a = vx * vx + vy * vy - s * s,
      b = 2 * (rx * vx + ry * vy),
      c = rx * rx + ry * ry,
      disc = b * b - 4 * a * c;
    let time = Math.sqrt(c) / s;
    if (disc >= 0 && Math.abs(a) > 0.001) {
      const roots = [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)].filter(
        t => t > 0,
      );
      if (roots.length) time = Math.min(...roots);
    }
    time = clamp(time, 0, maxTime);
    return { x: clamp(target.x + vx * time, 1, 104), y: clamp(target.y + vy * time, 1, 67), time };
  }
  aim(x, y, intent, action) {
    this.tx = clamp(x, 0.8, 104.2);
    this.ty = clamp(y, 1, 67);
    this.intent = intent;
    this.action = action;
  }
  displayAction(now) {
    if (!this.displayedAction || this.action === this.displayedAction) {
      this.displayedAction = this.action;
      this.pendingAction = null;
    } else if (this.pendingAction !== this.action) {
      this.pendingAction = this.action;
      this.actionSince = now;
    } else if (now - this.actionSince > 0.38) {
      this.displayedAction = this.action;
      this.pendingAction = null;
    }
    return this.displayedAction;
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
      tactics: { formation: '433', style: 'balanced', tempo: 3, width: 3, press: 3, fluidity: 3 },
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
    for (const p of this.players) this.setTags(p.id, p.tags);
    this.reset();
  }
  setDuration(duration) {
    if (!DURATION_PROFILES[duration]) throw new RangeError('Unsupported match length');
    this.duration = duration;
    this.profile = { ...this.tuning.formats[duration] };
    this.reset();
  }
  rand() {
    this.rng = (Math.imul(1664525, this.rng) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }
  noise() {
    return (this.rand() + this.rand() + this.rand() - 1.5) * 2;
  }
  direction(t) {
    return (t === 0 ? 1 : -1) * (this.half === 1 ? 1 : -1);
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
    };
    for (const p of this.players) {
      p.stats = freshStats();
      p.yellowCards = 0;
      p.sentOff = false;
      p.emergencyKeeper = false;
      p.dismissedRole = null;
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
  settings(team) {
    const t = this.teams[team].tactics;
    return {
      ...t,
      pressing: (t.press - 1) * 25,
      widthValue: (t.width - 1) * 25,
      line: t.style === 'bus' ? 12 : t.style === 'press' ? 72 : 50,
      attacking: t.style === 'bus' ? 25 : t.style === 'counter' ? 65 : 50,
    };
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
    this.teams = c.teams.map(t => ({ ...t, tactics: { fluidity: 3, ...t.tactics } }));
    this.players.forEach((p, i) => {
      const data = c.players[i];
      p.tuning = this.tuning;
      p.attrs = normalizeAttributes(data.attrs);
      p.name = data.name || p.name;
      p.fullName = data.fullName || p.name;
      p.primaryPosition = data.primaryPosition || p.primaryPosition;
      p.secondaryPositions = [...(data.secondaryPositions || [])];
      for (const key of ['profileId', 'sourcePlayerId', 'sourceOverall', 'source', 'inference'])
        p[key] = data[key] == null ? null : structuredClone(data[key]);
      p.foot = data.foot === 'left' ? 'left' : 'right';
      p.weakFoot = data.weakFoot ?? p.weakFoot;
      p.tendencies = { ...p.tendencies, ...data.tendencies };
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
    return p.emergencyKeeper
      ? [4, 34, 'GK']
      : FORMATIONS[this.teams[p.team].tactics.formation][p.slot];
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
  setTactic(team, key, value) {
    if (key === 'formation' && this.lineupFixed()) return false;
    if ((key === 'formation' && !FORMATIONS[value]) || (key === 'style' && !STYLES[value])) return;
    if (['tempo', 'width', 'press', 'fluidity'].includes(key))
      value = clamp(Math.round(Number(value)), 1, 5);
    if (
      !['formation', 'style', 'tempo', 'width', 'press', 'fluidity'].includes(key) ||
      (typeof value === 'number' && !Number.isFinite(value))
    )
      return;
    this.teams[team].tactics[key] = value;
    if (key === 'formation')
      this.activePlayers.filter(p => p.team === team).forEach(p => (p.role = this.formation(p)[2]));
    this.planTimer = 0;
    for (const p of this.activePlayers) if (p.team === team) p.rethinkAt = 0;
  }

  checkRestartTouch(p) {
    if (this.ball.restartTaker !== p.id && this.ball.penaltyTaker !== p.id) return false;
    this.addEvent(`${p.name.split(' ').pop()} touches the restart twice.`, 1 - p.team, 'foul', {
      playerId: p.id,
    });
    this.startRestart('Indirect free kick', 1 - p.team, p.x, p.y);
    return true;
  }
  contestAerial(p) {
    const rival = this.activePlayers
      .filter(q => q.team !== p.team && q.role !== 'GK' && q.cooldown <= 0 && dist(q, p) < 1.35)
      .sort((a, b) => dist(a, p) - dist(b, p))[0];
    if (!rival) return false;
    const model = this.challengeModel(p, rival);
    rival.cooldown = 0.7;
    if (this.rand() < model.foul * (0.7 + rival.tendency('aggression'))) {
      this.awardFoul(rival, p);
      return true;
    }
    return false;
  }
  checkOffside(p) {
    if (p.sentOff) return false;
    const snap = this.ball.offsideState;
    if (!snap || p.team !== snap.team || !snap.candidates.includes(p.id)) return false;
    this.stats[p.team].offsides++;
    p.stats.offsides++;
    this.addEvent(`${p.name.split(' ').pop()} is offside.`, p.team, 'offside', {
      playerId: p.id,
      line: snap.line,
    });
    this.effect('whistle', p, 0.9, { label: 'OFFSIDE', strength: 0.35 });
    this.startRestart('Offside', 1 - p.team, p.x, p.y, 0.75);
    return true;
  }
  own(p, handling = false) {
    if (p.sentOff) return false;
    handling = handling && this.canHandle(p);
    if (this.checkRestartTouch(p) || this.checkOffside(p)) return false;
    const b = this.ball,
      passer =
        b.kind === 'pass' && b.kicker !== null
          ? this.players[b.kicker]
          : b.pendingPass
            ? this.players[b.pendingPass.from]
            : null;
    const regain = this.lastTeam !== p.team,
      arrivalHeight = b.z;
    p.lastReceipt = null;
    if (passer && passer.team === p.team && p.id !== passer.id) {
      this.stats[p.team].completed++;
      passer.stats.completed++;
      p.lastReceipt = {
        from: passer.id,
        at: this.elapsed,
        type: b.pendingPass?.delivery || b.delivery || 'pass',
        chance: b.pendingPass?.chance ?? b.chance,
        height: arrivalHeight,
      };
      this.lastPass = { ...p.lastReceipt, to: p.id };
      if (['cross', 'cutback', 'through'].includes(b.delivery) && this.rel(p.x, p.team) > 73) {
        const label =
          b.delivery === 'through'
            ? 'Through ball'
            : b.delivery === 'cutback'
              ? 'Cutback'
              : 'Cross';
        this.addEvent(
          `${passer.name.split(' ').pop()} → ${p.name.split(' ').pop()} · ${label.toLowerCase()}`,
          p.team,
          b.delivery,
          {
            playerId: passer.id,
            chance: b.chance,
            chanceLabel: 'completion',
            strength: b.strength,
          },
        );
        this.flair('delivery', p, 0.7, { label, strength: b.strength });
      }
    } else {
      this.lastPass = null;
      if (passer && passer.team !== p.team) p.stats.interceptions++;
    }
    if (regain) {
      if (b.owner !== null && this.players[b.owner].team !== p.team)
        this.players[b.owner].stats.turnovers++;
      this.possessionStart = this.elapsed;
      if (
        this.keeperRelease &&
        this.keeperRelease.team !== p.team &&
        this.elapsed - this.keeperRelease.at < 5
      )
        this.stats[this.keeperRelease.team].keeperLosses++;
      this.keeperRelease = null;
    }
    if (this.pendingTackle) {
      const win = this.pendingTackle;
      if (p.team === win.team && this.elapsed - win.at < 3) {
        const q = this.players[win.id];
        q.stats.tackles++;
        this.stats[p.team].tackles++;
        this.addEvent(`${q.name.split(' ').pop()} wins possession.`, p.team, 'tackle', {
          playerId: q.id,
          chance: win.chance,
          chanceLabel: 'clean win',
          strength: win.strength,
        });
        this.flair('tackle', q, 0.65, {
          hard: win.hard,
          strength: win.strength,
          label: 'BALL WON',
        });
      }
      this.pendingTackle = null;
    }
    b.owner = p.id;
    b.pendingPass = null;
    b.missedReceiver = false;
    b.previous = null;
    b.kind = handling ? 'held' : 'dribble';
    b.heldSince = handling ? this.elapsed : null;
    b.z = b.vz = 0;
    b.vx = p.vx;
    b.vy = p.vy;
    b.lastTouch = p.team;
    b.kicker = null;
    b.target = null;
    b.offside = false;
    b.offsideState = null;
    b.age = 0;
    b.shotOrigin = null;
    b.shotType = null;
    b.shotRecord = null;
    b.assist = null;
    b.goalCredit = null;
    b.deliveryOrigin = null;
    b.curve = 0;
    b.indirect = null;
    b.penaltyTaker = null;
    b.restartTaker = null;
    b.penaltyKick = false;
    p.beatChain = [];
    p.finishUntil = 0;
    p.hold = 0;
    p.receivedAt = this.elapsed;
    p.possessionAt = this.elapsed;
    p.think = p.has('onetouch') ? 0.07 : 0.1 + (100 - p.skill('composure')) / 700;
    p.touch = 0;
    p.controlUntil = 0;
    p.cooldown = Math.min(p.cooldown, 0.08);
    p.stun = 0;
    p.animation = null;
    this.lastTeam = p.team;
    for (const q of this.activePlayers) q.rethinkAt = 0;
    this.planTimer = 0;
    if (
      p.lastReceipt &&
      Math.abs(p.y - 34) < 16 &&
      this.rel(p.x, p.team) > 40 &&
      this.rel(p.x, p.team) < 85
    )
      this.startCombination(p, passer);
    if (handling) p.aim(this.abs(6, p.team), clamp(p.y, 27, 41), 'hold', 'Ball secured in hands');
    else {
      const escape = this.carryTarget(p);
      p.aim(
        escape.x,
        escape.y,
        'carry',
        regain ? 'Turning away with the ball' : 'Taking a first touch',
      );
      if (Math.hypot(p.vx, p.vy) < 1) p.facing = Math.atan2(escape.y - p.y, escape.x - p.x);
    }
    return true;
  }
  startCombination(receiver, passer) {
    const available = this.activePlayers
      .filter(
        p =>
          p.team === receiver.team &&
          p.id !== receiver.id &&
          p.id !== passer?.id &&
          p.role !== 'GK' &&
          p.tendency('hold') < 0.64 &&
          this.formation(p)[0] >= 45 &&
          dist(p, receiver) < 27,
      )
      .map(p => ({
        p,
        cost: dist(p, receiver) * 0.07 - p.tendency('timing') - p.skill('pace') * 0.006,
      }))
      .sort((a, b) => a.cost - b.cost);
    const cover = this.activePlayers.filter(
      p =>
        p.team === receiver.team &&
        ['CB', 'DM'].includes(p.role) &&
        this.rel(p.x, p.team) < this.rel(receiver.x, receiver.team) - 5,
    ).length;
    const count =
      this.profile.runSupport > 10 && cover >= 2 && this.pressure(receiver) < 0.8 ? 2 : 1;
    for (const [index, { p: runner }] of available.slice(0, count).entries()) {
      const x = this.abs(
          clamp(
            this.rel(receiver.x, receiver.team) + 10 + this.profile.runSupport * 0.4 + index * 2,
            45,
            97,
          ),
          receiver.team,
        ),
        y = 34 + (index === 0 ? (runner.y < 34 ? -8 : 8) : available[0].p.y < 34 ? 8 : -8);
      if (this.activePlayers.some(q => q.team !== runner.team && dist(q, { x, y }) < 3)) continue;
      runner.comboRun = {
        x,
        y,
        until: this.elapsed + 2.0 + (this.teams[runner.team].tactics.fluidity - 1) * 0.4,
      };
      runner.rethinkAt = 0;
    }
  }
  carryTarget(p) {
    const br = this.rel(p.x, p.team),
      dir = this.direction(p.team),
      pressure = this.pressure(p),
      goalAngle = Math.atan2(
        (p.has('byline') && br < 92 ? 0 : 34 - p.y) *
          (br > 65 ? 1 : 0.3 + 0.7 * p.tendency('inside')),
        dir * (105 - br),
      );
    let best = null;
    for (const offset of [-2.8, -2.2, -1.55, -1.0, -0.55, 0, 0.55, 1.0, 1.55, 2.2, 2.8]) {
      const angle = goalAngle + offset,
        length = Math.abs(offset) > 1.5 ? 4.5 : 6;
      const c = {
        x: clamp(p.x + Math.cos(angle) * length, 1, 104),
        y: clamp(p.y + Math.sin(angle) * length, 2, 66),
      };
      // Clipping an outward dribble at the touchline can collapse a six-metre
      // route into a few centimetres. It is not a safe escape or a reason to stop.
      if (dist(p, c) < length * 0.65) continue;
      let clearance = 6,
        landing = 9;
      for (const q of this.activePlayers)
        if (q.team !== p.team) {
          const ahead = { x: q.x + q.vx * 0.25, y: q.y + q.vy * 0.25 },
            route = segment(ahead, p, c);
          if (route.t > 0.12) clearance = Math.min(clearance, route.d);
          landing = Math.min(landing, dist(ahead, c));
        }
      const heading = Math.atan2(c.y - p.y, c.x - p.x),
        progress = (c.x - p.x) * dir,
        turn = Math.abs(Math.atan2(Math.sin(heading - p.facing), Math.cos(heading - p.facing)));
      const score =
        clearance * (0.85 + pressure * 0.75) +
        landing * 0.12 +
        progress * (0.45 + p.tendency('advance') * 0.32) -
        turn * 0.12 -
        Math.abs(c.y - 34) * 0.013;
      const escape = p.has('pressescape') && progress < 0 ? Math.min(pressure, 1.5) * 0.4 : 0;
      if (!best || score + escape > best.score) best = { ...c, score: score + escape };
    }
    return best;
  }
  openCarry(p) {
    const target = this.carryTarget(p),
      dir = this.direction(p.team);
    if ((target.x - p.x) * dir < 4 || this.rel(p.x, p.team) > 97) return null;
    // Check the route as well as its end, including whether a beaten defender
    // can actually catch the next touch. Empty-looking space alone is not safe.
    for (const fraction of [0.5, 1]) {
      const point = { x: lerp(p.x, target.x, fraction), y: lerp(p.y, target.y, fraction) };
      const time = (p.arrival(point) * p.topSpeed()) / p.topSpeed(true);
      if (this.activePlayers.some(q => q.team !== p.team && q.arrival(point) < time + 0.18))
        return null;
    }
    return target;
  }
  receiverMargin(p, r, aim, loft = false) {
    const flight = this.flightTime(dist(p, aim), loft),
      receive = Math.max(flight, r.arrival(aim));
    let opponent = 99;
    for (const q of this.activePlayers)
      if (q.team !== p.team) opponent = Math.min(opponent, q.arrival(aim));
    // Time to take a touch and choose a second action, after both players travel.
    return opponent - receive;
  }

  passSpeed(length, loft = false) {
    return (
      (loft
        ? clamp(18 + length * 0.12, 19, 29)
        : clamp(Math.sqrt(196 + 2 * 3.8 * length), 15, 30)) * this.tuning.gameplay.passSpeed
    );
  }
  deliveryDemand({ d = 0, aim, r, loft = false, delivery = 'pass' }) {
    const lead = aim && r ? dist(aim, r) : 0;
    return clamp(
      clamp((d - 22) / 32, 0, 1) * 0.55 +
        clamp((lead - 2) / 7, 0, 1) * 0.3 +
        (delivery === 'through'
          ? 0.3
          : delivery === 'cross'
            ? 0.32
            : delivery === 'clearance'
              ? 0.22
              : 0) +
        (loft ? 0.2 : 0),
      0,
      1,
    );
  }
  firstTouchChance(
    p,
    height,
    speed,
    pressure,
    teammate = false,
    contactGap = 0,
    expectedDemand = null,
  ) {
    const backpass =
      teammate ||
      (this.ball.pendingPass &&
        this.players[this.ball.pendingPass.from]?.team === p.team &&
        this.ball.lastTouch === p.team);
    const catching = this.canHandle(p) && !backpass,
      ability = p.skill(catching ? 'goalkeeping' : height > 1.15 ? 'heading' : 'control');
    const control = clamp(
      0.66 +
        ability * 0.0031 +
        (p.has('interceptor') ? 0.06 : 0) -
        Math.max(0, speed - 17) * 0.02 -
        pressure * 0.04 -
        (1 - p.energy) * 0.12 -
        (1 - p.familiarity()) * 0.12 -
        (height > 1 ? 0.12 : 0),
      0.3,
      0.99,
    );
    // Routine receptions are much more dependable than contested, fast or
    // aerial deliveries. Preserve those demands and the receiver's ability.
    const demand =
      expectedDemand ??
      (teammate && this.ball.kind === 'pass' ? (this.ball.deliveryDemand ?? 0) : 0);
    const stretch = clamp((contactGap - 0.6) / 0.65, 0, 1) * 0.22;
    const difficulty = clamp(
      Math.max(0, height - 0.3) / 1.3 +
        Math.max(0, speed - 18) / 12 +
        pressure * 1.1 +
        demand * 0.8 +
        stretch,
      0,
      1,
    );
    const technique = clamp(
      1 -
        Math.max(p.skill('control') - 75, 0) * 0.008 +
        Math.max(75 - p.skill('control'), 0) * 0.012,
      0.8,
      1.15,
    );
    const reception = teammate
      ? lerp(
          this.tuning.gameplay.receptionError * technique,
          this.tuning.gameplay.difficultReceptionError,
          difficulty,
        )
      : 1;
    const execution = skillError(
      ability,
      this.tuning.gameplay.controlQuality * (teammate ? difficulty : 0.5),
    );
    return clamp(
      1 -
        ((1 - control) * reception * execution * this.tuning.gameplay.firstTouchError) /
          (teammate ? this.tuning.gameplay.passCompletion : 1),
      0.01,
      0.999,
    );
  }
  collectionReach(p) {
    const b = this.ball,
      base = b.z > 1.1 ? 1.05 : 0.85;
    const receiving =
      b.kind === 'pass' && b.target === p.id && this.players[b.kicker]?.team === p.team;
    // A small reach for the intended receiver, not a larger interception
    // radius for everybody. High balls still require heading and timing.
    const settled = b.kind === 'loose' && b.z < 0.3 && Math.hypot(b.vx, b.vy) < 5;
    return (
      (base +
        (receiving && b.z < 0.6
          ? 0.21 + clamp((p.skill('control') - 50) * 0.002, 0, 0.1)
          : settled
            ? 0.1
            : 0)) *
      this.tuning.gameplay.interceptionReach
    );
  }
  canCollect(p) {
    const b = this.ball;
    if (p.sentOff || p.stun > 0) return false;
    if (p.id === b.kicker && b.age < 0.45 && ['pass', 'shot'].includes(b.kind)) return false;
    // A tackle cooldown is not a ban on taking a loose ball. Keep a separate,
    // short first-touch recovery, with an escape for a ball settled at the feet.
    const settled =
      (b.kind === 'loose' || b.missedReceiver) &&
      b.z < 0.3 &&
      Math.hypot(b.vx, b.vy) < 3.2 &&
      dist(p, b) < 1;
    if (
      (p.controlUntil || 0) > this.elapsed &&
      !(settled && this.elapsed - (p.controlErrorAt ?? -10) > 0.12)
    )
      return false;
    const receiving =
      b.kind === 'pass' && b.target === p.id && this.players[b.kicker]?.team === p.team;
    return receiving || b.kind === 'loose' || b.missedReceiver || p.cooldown <= 0;
  }
  flightTime(length, loft = false, fraction = 1) {
    const speed = this.passSpeed(length, loft),
      remaining = speed * speed - 2 * 3.8 * length * fraction;
    return loft
      ? (length * fraction) / speed
      : remaining < 0
        ? Infinity
        : (speed - Math.sqrt(remaining)) / 3.8;
  }
  laneRisk(p, r, end, loft = null, delivery = 'pass') {
    const length = dist(p, end);
    if (loft === null) {
      loft =
        Math.abs(p.y - 34) > 14 &&
        this.rel(p.x, p.team) > 70 &&
        this.rel(p.x, p.team) < 95 &&
        this.inBox({ x: end.x, y: end.y, team: p.team });
      if (loft) delivery = 'cross';
    }
    const total = loft ? this.flightTime(length, true) : 0,
      start = this.ball.owner === p.id && this.ball.kind === 'held' ? 1.65 : 0.12,
      landing = delivery === 'cross' ? 1.65 : 0.45;
    const craft = passingAbility(p, length, delivery) * 0.65 + p.vision() * 0.35;
    let risk = 0;
    for (const q of this.activePlayers) {
      if (q.team === p.team) continue;
      let threat = 0;
      for (const f of [0.18, 0.36, 0.54, 0.72, 0.9]) {
        const point = { x: lerp(p.x, end.x, f), y: lerp(p.y, end.y, f) },
          flight = this.flightTime(length, loft, f),
          reaction = 0.1 + (100 - q.pressAwareness()) * 0.002;
        // Use the launch arc, so midfield traffic can be cleared but defenders
        // near takeoff and landing still have a realistic interception chance.
        if (loft) {
          const height =
            delivery === 'cross'
              ? 9.81 * total * 0.46 * flight - 4.905 * flight * flight
              : lerp(start, landing, f) + 4.905 * total * total * f * (1 - f);
          if (height > (delivery === 'cross' ? 2 : 1.6 + q.skill('heading') * 0.007)) continue;
        }
        const arrival = q.arrival(point) + reaction;
        threat = Math.max(threat, sigmoid((flight - arrival + 0.04) * 5));
      }
      const disguise =
        1 -
        clamp((craft - q.pressAwareness()) / 30, 0, 1) * 0.12 * this.tuning.gameplay.passingQuality;
      risk += threat * (0.55 + q.skill('defending') * 0.004) * disguise;
    }
    return risk;
  }
  targetForPass(p, r, loft = false) {
    const d = dist(p, r),
      forward = this.rel(r.x, p.team) > this.rel(p.x, p.team) + 6;
    const lead = clamp(this.flightTime(d, loft), 0.2, loft ? 2.2 : 1.8);
    let x = r.x + r.vx * lead * 0.72,
      y = r.y + r.vy * lead * 0.72;
    if (forward && this.formation(r)[0] > 60 && this.rel(p.x, p.team) > (loft ? 24 : 54)) {
      const run =
        clamp(
          r.topSpeed() * lead * 0.4 * (loft ? 0.65 + r.tendency('timing') * 0.55 : 1),
          1,
          loft ? 8 : 6,
        ) * (p.has('through') ? 1.18 : 1);
      x += this.direction(p.team) * run;
      y += clamp(34 - y, -2, 2);
    }
    return { x: clamp(x, 1, 103), y: clamp(y, 1, 67) };
  }
  options(p) {
    const list = [],
      dir = this.direction(p.team),
      tac = this.settings(p.team),
      held = p.role === 'GK',
      pressure = this.pressure(p),
      identity = this.tuning.gameplay.teamCharacter;
    const patient =
      tac.style === 'possession'
        ? clamp((p.skill('shortPassing') + p.skill('composure') + p.vision() - 210) / 60, 0, 1)
        : 0;
    const line = this.activePlayers
      .filter(q => q.team !== p.team)
      .map(q => this.rel(q.x, p.team))
      .sort((a, b) => b - a)[1];
    const counter = tac.style === 'counter' && this.elapsed - this.possessionStart < 7;
    for (const r of this.activePlayers) {
      if (r.team !== p.team || r.id === p.id) continue;
      const distance = dist(p, r);
      if (
        distance < 3 ||
        distance > (held ? (p.has('distributor') ? 88 : 72) : 58) + (p.vision() - 50) * 0.16
      )
        continue;
      // Compare a grounded delivery with a lofted one; badges improve the
      // preference and execution, but every player can attempt either.
      for (const aerial of distance >= 24 ? [false, true] : [false]) {
        const aim = this.targetForPass(p, r, aerial),
          d = dist(p, aim),
          progress = (aim.x - p.x) * dir;
        let space = 14;
        for (const q of this.activePlayers)
          if (q.team !== p.team) space = Math.min(space, dist(q, aim));
        const box = this.inBox({ x: aim.x, y: aim.y, team: p.team }),
          wide = Math.abs(p.y - 34) > 14 && this.rel(p.x, p.team) > 70;
        const delivery =
          wide && box
            ? this.rel(p.x, p.team) > 95
              ? 'cutback'
              : 'cross'
            : progress > 9 && this.formation(r)[0] > 60 && this.rel(aim.x, p.team) > line - 3
              ? 'through'
              : 'pass';
        if (aerial && ['cross', 'cutback'].includes(delivery)) continue;
        // Keep the established conservative crossing assessment; the new flight
        // comparison applies to long distribution, switches and through balls.
        const loft = aerial || delivery === 'cross',
          risk = this.laneRisk(p, r, aim, loft, delivery),
          margin = this.receiverMargin(p, r, aim, aerial);
        if (!Number.isFinite(this.flightTime(d, loft))) continue;
        const goalAccess = box
          ? (0.6 + this.location({ x: aim.x, y: aim.y, team: p.team }).quality * 0.95) *
            (0.65 +
              shootingAbility(r, Math.hypot(105 - this.rel(aim.x, p.team), 34 - aim.y)) * 0.007)
          : clamp((this.rel(aim.x, p.team) - 60) / 30, 0, 1) * 0.7;
        const foot = footExecution(p, Math.atan2(aim.y - p.y, aim.x - p.x));
        const ability = passingAbility(p, d, delivery),
          reading = clamp(
            (p.vision() * 0.5 + p.skill('composure') * 0.3 + ability * 0.2 - 65) / 25,
            0,
            1,
          );
        let control =
          (0.7 + r.skill('control') * 0.0026 - Math.max(0, d - 22) * 0.002) *
          (aerial ? 0.8 + r.skill('control') * 0.001 : 1);
        const demand = this.deliveryDemand({ r, aim, d, loft, delivery }),
          arrivalPressure = clamp(1 - space / (4.5 * this.tuning.gameplay.pressDistance), 0, 1);
        const reception = this.firstTouchChance(
          r,
          loft ? (delivery === 'cross' ? 1.65 : 0.45) : 0,
          this.passSpeed(d, loft),
          arrivalPressure,
          true,
          0,
          demand,
        );
        control = loft
          ? Math.min(control, reception)
          : lerp(control, reception, reading * clamp(this.tuning.gameplay.passingQuality, 0, 1));
        const execution = skillError(
          ability * 0.75 + p.skill('composure') * 0.15 + p.vision() * 0.1,
          this.tuning.gameplay.passingQuality,
        );
        // Better delivery reduces the passer's error; it cannot erase an
        // intercepted lane, a late receiver, or the receiver's poor control.
        const technical = clamp(
          1 - (1 - clamp(0.83 + ability * 0.0017, 0, 0.995)) * execution,
          0.1,
          0.999,
        );
        const completion = clamp(
          control *
            Math.exp(-risk * 0.4) *
            sigmoid(2.8 + margin * 1.4) *
            technical *
            foot.quality *
            this.tuning.gameplay.passCompletion,
          0.06,
          0.98,
        );
        const creative =
          clamp((p.vision() * 0.5 + ability * 0.35 + p.skill('composure') * 0.15 - 75) / 20, 0, 1) *
          this.tuning.gameplay.creativeQuality;
        const ambition =
          0.08 +
          p.tendency('advance') * 0.1 +
          (tac.tempo - 3) * 0.009 +
          (counter ? 0.09 * identity : 0) -
          (tac.style === 'possession' ? 0.013 * identity : 0);
        const judgment =
          1 +
          clamp((p.vision() + p.skill('composure') - 140) * 0.006, 0, 0.35) +
          (tac.style === 'possession' ? 0.25 * identity : 0);
        const turnoverCost =
          (held ? 7 : 4.8 + Math.max(0, 55 - this.rel(p.x, p.team)) * 0.035) *
          (1.25 - p.tendency('risk') * 0.55) *
          judgment;
        let score =
          completion *
            (2 +
              clamp(progress, -20, 30 - patient * 12) *
                ambition *
                (1 - patient * 0.18) *
                this.profile.directness +
              goalAccess * (p.has('creator') ? 1.35 : 1)) -
          (1 - completion) * turnoverCost +
          Math.min(space, 6) * 0.07 +
          clamp(margin, -2, 1) * 0.35;
        score -= patient * risk * (1 + Math.max(0, d - 22) / 18) * identity;
        if (progress < -4) score -= 0.22;
        if (r.role === 'GK') score -= 1.5;
        if (!held && margin < -0.35) score -= 1.6 + Math.abs(margin) * 1.4;
        if (delivery === 'cross' && risk > 0.45) score -= risk * 0.8;
        if (aerial) score -= 0.25 + (100 - p.skill('longPassing')) * 0.009 + pressure * 0.15;
        if (delivery !== 'pass')
          score +=
            delivery === 'through'
              ? p.has('through')
                ? 0.45
                : 0.1
              : p.has('crosser') || p.has('byline')
                ? 0.95
                : 0.35 + (tac.style === 'wings' ? 0.6 * identity : 0);
        if (tac.style === 'possession' && d < 22) score += (0.28 + patient * 0.65) * identity;
        // Skill supports ambition when there is a real progressive option;
        // it does not make a crowded or late pass automatically worthwhile.
        if (progress > 4 && margin > -0.35)
          score += creative * completion * (clamp(progress / 24, 0, 1) * 0.55 + goalAccess * 0.3);
        if (p.has('longball') && Math.abs(aim.y - p.y) > 25 && margin > 0.25 && risk < 0.6)
          score += 0.3;
        if (d >= 28 && (progress > 8 || Math.abs(aim.y - p.y) > 24)) {
          const switchSpace =
            (aim.y - 34) * (p.y - 34) < 0
              ? clamp((Math.abs(aim.y - p.y) - 20) / 22, 0, 1) * clamp((space - 2) / 8, 0, 1)
              : 0;
          const craft = clamp((p.skill('longPassing') - 55) / 40, 0, 1),
            intent =
              0.4 +
              p.tendency('risk') * 0.35 +
              (tac.tempo - 3) * 0.08 +
              (counter ? 0.5 * identity : 0) -
              (tac.style === 'possession' ? 0.25 * identity : 0);
          score +=
            this.tuning.gameplay.longBallPreference *
            0.7 *
            completion *
            (intent +
              craft * 0.4 +
              (p.has('longball') ? 0.3 : 0) +
              switchSpace *
                (0.35 + (tac.width - 1) * 0.1 + (tac.style === 'wings' ? 0.4 * identity : 0)));
        }
        const perceivedOffside =
          this.rel(r.x, p.team) - Math.max(52.5, this.rel(p.x, p.team), line);
        // Players assess a moving line imperfectly. The referee later uses the exact snapshot.
        if (perceivedOffside > 0.1 + (100 - p.vision()) * 0.024) score -= 3 + perceivedOffside;
        // Players do not all read the same perfect map. Rushed, tired or
        // pressured decisions expose weak scanning; excellent readers retain
        // a precise assessment. This changes the choice, never the ball result.
        const scanDemand =
          0.55 +
          clamp(pressure, 0, 1) * 0.7 +
          (this.elapsed - p.receivedAt < 0.65 ? 0.35 : 0) +
          (1 - p.energy) * 0.2;
        const uncertainty =
          (1 - reading) ** 2 * this.tuning.gameplay.passingQuality * scanDemand * 0.25;
        score +=
          this.noise() *
          (((100 - p.vision()) / 240) *
            (1 - reading * 0.5 * clamp(this.tuning.gameplay.passingQuality, 0, 1)) +
            uncertainty);
        list.push({ r, aim, score, risk, d, margin, delivery, loft, chance: completion });
      }
    }
    return list.sort((a, b) => b.score - a.score);
  }
  keeperReleaseClear(p, aim) {
    const length = dist(p, aim) || 1,
      end = {
        x: p.x + ((aim.x - p.x) / length) * Math.min(6, length),
        y: p.y + ((aim.y - p.y) / length) * Math.min(6, length),
      };
    return this.activePlayers.every(
      q => q.team === p.team || dist(q, p) > 7 || segment(q, p, end).d > 1.7,
    );
  }
  keeperOutlet(p, opts) {
    // A clear lane is insufficient: the receiver must survive the next touch.
    const safe = opts.filter(
      o =>
        o.d > 10 &&
        this.keeperReleaseClear(p, o.aim) &&
        o.risk < 0.28 &&
        o.margin > 0.4 &&
        this.rel(o.aim.x, p.team) > 13 &&
        this.activePlayers.some(
          r =>
            r.team === p.team &&
            r.id !== p.id &&
            r.id !== o.r.id &&
            dist(r, o.aim) < 23 &&
            this.pressure(r) < 0.4,
        ),
    );
    safe.sort((a, b) => b.margin * 0.8 + b.score - (a.margin * 0.8 + a.score));
    if (safe.length) return safe[0];
    return null;
  }
  clearKeeper(p, opts) {
    const outlets = opts
      .filter(o => o.d > 28 && Math.abs(o.aim.y - 34) > 10)
      .sort((a, b) => b.margin + b.d * 0.025 - (a.margin + a.d * 0.025));
    const o = outlets[0] || opts.filter(o => o.d > 25).sort((a, b) => b.d - a.d)[0];
    if (o) this.pass(p, { ...o, delivery: 'clearance', loft: true });
    else {
      const r = this.activePlayers
        .filter(q => q.team === p.team && q.role !== 'GK')
        .sort((a, b) => this.rel(b.x, p.team) - this.rel(a.x, p.team))[0];
      this.pass(p, {
        r,
        aim: { x: this.abs(63, p.team), y: p.y < 34 ? 8 : 60 },
        d: 58,
        delivery: 'clearance',
        loft: true,
        risk: 0,
      });
    }
  }
  outfieldClearance(p, opts) {
    const depth = this.rel(p.x, p.team),
      pressure = this.pressure(p),
      tac = this.settings(p.team);
    if (depth > 38 || pressure < 0.45) return null;
    const craft =
      0.4 * p.skill('shortPassing') +
      0.2 * p.skill('control') +
      0.2 * p.skill('dribbling') +
      0.2 * p.vision();
    const simpleExit =
      p.role === 'CB' ? 0.22 * clamp((74 - craft) / 25, 0, 1) * clamp(pressure, 0.45, 1.5) : 0;
    const danger =
      (pressure * (1.2 + (38 - depth) / 45) +
        (70 - p.skill('composure')) * 0.006 +
        (p.tendency('hold') - 0.5) * 0.25 -
        (p.tendency('carry') - 0.5) * 0.25 +
        (tac.style === 'bus' ? 0.2 : tac.style === 'possession' ? -0.2 : 0) *
          this.tuning.gameplay.teamCharacter +
        simpleExit) *
      this.tuning.gameplay.clearanceWillingness;
    // A modest preference for safety must not override an available short exit.
    if (
      danger < 1.7 ||
      (danger < 3.1 &&
        opts.some(
          o =>
            o.chance > 0.72 &&
            o.margin > 0 &&
            o.risk < 0.65 &&
            o.d < 28 &&
            this.rel(o.aim.x, p.team) > 9,
        ))
    )
      return null;
    const outlets = opts.filter(
      o => o.loft && o.d >= 28 && (o.aim.x - p.x) * this.direction(p.team) > 18,
    );
    const value = o =>
      clamp(o.margin, -2, 2) * 0.5 +
      Math.abs(o.aim.y - 34) * 0.025 +
      o.r.skill('heading') * 0.006 +
      o.r.skill('strength') * 0.003 -
      o.risk * 0.35;
    const outlet = outlets.sort((a, b) => value(b) - value(a))[0];
    if (outlet) return { ...outlet, delivery: 'clearance', loft: true };
    // When nobody is free, clear into a wide area and contest the second ball.
    const aim = {
      x: this.abs(clamp(depth + 34 + p.skill('power') * 0.14, 44, 82), p.team),
      y: p.y < 34 ? 9 : 59,
    };
    const r = this.activePlayers
      .filter(q => q.team === p.team && q.id !== p.id && q.role !== 'GK')
      .sort((a, b) => a.arrival(aim) - b.arrival(aim))[0];
    return { r, aim, d: dist(p, aim), delivery: 'clearance', loft: true };
  }
  pass(p, option, restart = null) {
    if (!option || p.sentOff || option.r?.sentOff) return;
    p.beatChain = [];
    const b = this.ball,
      held = b.kind === 'held',
      { r, aim, d } = option,
      delivery = option.delivery || 'pass',
      pressure = this.executionPressure(p),
      tempo = this.teams[p.team].tactics.tempo;
    const foot = footExecution(p, Math.atan2(aim.y - p.y, aim.x - p.x));
    const ability = passingAbility(p, d, delivery);
    const loft = option.loft || delivery === 'cross',
      demand = this.deliveryDemand({ ...option, delivery, loft }),
      difficulty = clamp(pressure * 0.9 + demand, 0, 1);
    const context = lerp(
      this.tuning.gameplay.routinePassError,
      this.tuning.gameplay.difficultPassError,
      difficulty,
    );
    const execution = skillError(
      ability * 0.75 + p.skill('composure') * 0.15 + p.vision() * 0.1,
      this.tuning.gameplay.passingQuality,
    );
    const rawError =
      (((0.16 + (100 - ability) * 0.03 + 0.035 * clamp((ability - 78) / 20, 0, 1)) *
        (1 + pressure * 0.45 + Math.max(0, tempo - 3) * 0.07 + (1 - p.energy) * 0.5) *
        Math.max(0.6, d / 24)) /
        foot.quality) *
      this.profile.deliveryError *
      this.tuning.gameplay.passError *
      context *
      execution;
    const error = Math.min(rawError, 0.8 + d * 0.08 + pressure * 0.3);
    const tx = clamp(aim.x + this.noise() * error, 0.1, 104.9),
      ty = aim.y + this.noise() * error,
      length = Math.hypot(tx - p.x, ty - p.y),
      angle = Math.atan2(ty - p.y, tx - p.x);
    const speed = this.passSpeed(length, loft);
    const restartType = p.goalKickExempt
      ? 'Goal kick'
      : typeof restart === 'string'
        ? restart
        : null;
    b.x = p.x;
    b.y = p.y;
    b.offsideState = offsideSnapshot(this, p, restartType);
    b.restartTaker = restartType ? p.id : null;
    p.goalKickExempt = false;
    b.owner = null;
    b.x += Math.cos(angle) * 0.6;
    b.y += Math.sin(angle) * 0.6;
    b.z = held && loft ? 1.65 : 0.12;
    b.vx = Math.cos(angle) * speed;
    b.vy = Math.sin(angle) * speed;
    b.vz = loft
      ? ((delivery === 'cross' ? 1.65 : 0.45) - b.z + 4.905 * (length / speed) ** 2) /
        (length / speed)
      : 0;
    b.kind = 'pass';
    b.delivery = delivery;
    b.strength = clamp(d / 70 + (option.risk || 0) * 0.12, 0.1, 1);
    b.chance = option.chance ?? clamp(0.9 - error * 0.04 - (option.risk || 0) * 0.15, 0.1, 0.98);
    b.pendingPass = null;
    b.destination = { x: tx, y: ty };
    b.deliveryDemand = demand;
    b.missedReceiver = false;
    b.saver = null;
    b.deliveryOrigin = this.origin(p);
    b.passCraft = passingAbility(p, d, delivery) * 0.65 + p.vision() * 0.35;
    b.roll = 3.8;
    b.kicker = p.id;
    b.target = r.id;
    b.age = 0;
    b.lastTouch = p.team;
    b.curve = 0;
    b.offside = b.offsideState?.candidates.includes(r.id) || false;
    this.stats[p.team].passes++;
    p.stats.passes++;
    const progress = (aim.x - p.x) * this.direction(p.team);
    const category = progress > 3 ? 'forwardPasses' : progress < -3 ? 'backwardPasses' : null;
    if (category) {
      this.stats[p.team][category]++;
      p.stats[category]++;
    }
    if (delivery === 'cross' || delivery === 'cutback') this.stats[p.team].crosses++;
    if (delivery === 'through') this.stats[p.team].throughBalls++;
    if (p.role === 'GK') {
      this.stats[p.team].keeperDistributions++;
      this.keeperRelease = { team: p.team, at: this.elapsed };
    }
    p.cooldown = 0.35;
    p.think = 0.4;
    p.animation = { type: 'pass', start: this.elapsed, duration: 0.2, angle };
    p.action =
      delivery === 'clearance'
        ? 'Clearing beyond the press'
        : delivery === 'cross'
          ? 'Crossing'
          : delivery === 'cutback'
            ? 'Cutting it back'
            : delivery === 'through'
              ? loft
                ? 'Lifting a ball behind the defense'
                : 'Releasing the runner'
              : loft && d >= 28
                ? Math.abs(aim.y - p.y) > 24
                  ? 'Switching play'
                  : 'Playing long'
                : 'Passing';
    r.aim(tx, ty, 'receive', 'Moving to receive');
    r.rethinkAt = 0;
    this.planTimer = 0;
    p.runs =
      this.elapsed +
      1.6 +
      (this.teams[p.team].tactics.fluidity - 1) * 0.35 +
      (p.has('givego') ? 0.75 : 0);
    b.shotTeam = null;
    b.shotOrigin = null;
    b.shotType = null;
    b.shotRecord = null;
    b.assist = null;
    b.goalCredit = null;
    b.indirect = ['Offside', 'Indirect free kick'].includes(restart) ? p.id : null;
    b.penaltyTaker = null;
  }

  pressure(p) {
    return this.activePlayers.reduce(
      (sum, q) =>
        sum +
        (q.team !== p.team && q.role !== 'GK'
          ? Math.max(0, 1 - dist(p, q) / (4.5 * this.tuning.gameplay.pressDistance))
          : 0),
      0,
    );
  }
  // Technique changes execution under pressure, not the physical space
  // perceived by tactics, shooting decisions, or supporting teammates.
  executionPressure(p) {
    const calm =
      clamp((p.skill('composure') * 0.55 + p.skill('control') * 0.45 - 75) / 20, 0, 1) *
      (0.65 + 0.35 * p.energy);
    const resistance = 1 + calm * 0.3 * this.tuning.gameplay.controlQuality;
    let n = 0;
    for (const q of this.activePlayers)
      if (q.team !== p.team && q.role !== 'GK') {
        const proximity = Math.max(0, 1 - dist(p, q) / (4.5 * this.tuning.gameplay.pressDistance));
        if (proximity)
          n +=
            proximity *
            (1 +
              clamp((q.pressAwareness() - 72) / 22, 0, 1) *
                0.2 *
                this.tuning.gameplay.defensiveQuality);
      }
    return n / resistance;
  }
  shotWeights(p, d, aerialHeight = 0, penalty = false) {
    if (penalty) return [['Penalty', 1]];
    if (aerialHeight > 1.15)
      return [
        ['Header', 0.9 + p.skill('heading') / 100],
        ['Volley', aerialHeight < 1.7 ? (p.has('volley') ? 0.65 : 0.3) : 0.02],
      ];
    if (aerialHeight > 0.4)
      return [
        ['Volley', 1],
        ['Driven shot', 0.25],
      ];
    return [
      ['Placed finish', d < 16 ? 1.2 + p.skill('composure') / 100 : 0.12],
      ['Driven shot', 1.1],
      ['Power shot', 0.25 + p.skill('power') * 0.006 + (p.has('power') ? 1.4 : 0)],
      ['Curler', (d > 10 ? 0.12 : 0.015) + (p.has('curve') && d > 10 ? 1.4 : 0)],
      ['Knuckleball', d > 19 ? 0.022 + (p.has('knuckle') ? 0.85 : 0) : 0.001],
    ];
  }
  chooseWeighted(options) {
    let n = this.rand() * options.reduce((sum, [, weight]) => sum + weight, 0);
    for (const [value, weight] of options) {
      n -= weight;
      if (n <= 0) return value;
    }
    return options.at(-1)[0];
  }
  shoot(p, context = {}) {
    if (p.sentOff) return;
    p.beatChain = [];
    const b = this.ball,
      goalX = this.abs(105, p.team),
      d = Math.hypot(goalX - p.x, 34 - p.y),
      pressure = this.pressure(p),
      box = this.inBox(p),
      spatial = this.location(p),
      penalty = !!context.penalty;
    const shotType = this.chooseWeighted(
        this.shotWeights(p, d, context.aerialHeight || 0, penalty),
      ),
      header = shotType === 'Header';
    const skill = shootingAbility(p, d, { header, penalty }) / 100,
      foot = header
        ? { quality: 1, foot: null }
        : footExecution(p, Math.atan2(34 - p.y, goalX - p.x));
    const curve = shotType === 'Curler' ? (p.y < 34 ? 1 : -1) * this.direction(p.team) * 3.6 : 0;
    const aimY = 34 + (this.rand() > 0.5 ? 1 : -1) * (penalty ? 2.35 : 1.25 + this.rand() * 1.2);
    const balance =
      1 +
      (100 - p.skill('composure')) * 0.004 +
      Math.max(0, Math.hypot(p.vx, p.vy) - 5) * 0.045 +
      (1 - p.energy) * 0.6;
    const spread = penalty
      ? (0.3 + (1 - skill) * 1.8 + (100 - p.skill('composure')) * 0.008) /
        this.tuning.gameplay.penaltyPrecision
      : ((this.profile.spread *
          this.tuning.gameplay.shotScatter *
          (0.7 + (1 - skill) * 7.5) *
          (box ? 0.65 + d / 30 : 1.45 + d / 23) *
          (1 + pressure * 0.5) *
          balance) /
          foot.quality) *
        (header ? 1.18 : 1) *
        (p.has('finisher') && box ? 0.93 : 1) *
        (1 + (1 - spatial.openness) * 0.4) *
        clamp(1 / Math.sqrt(spatial.quality), 0.9, 1.2);
    const ty = aimY + this.noise() * spread,
      angle = Math.atan2(ty - p.y, goalX - p.x);
    const speed =
      (14 + p.skill('power') * 0.22 + this.rand() * 1.5) *
      (header ? 0.65 : shotType === 'Placed finish' ? 0.82 : 1) *
      (header ? 1 : Math.sqrt(foot.quality)) *
      this.tuning.gameplay.shotPower;
    const flight = d / speed,
      startZ = header
        ? context.aerialHeight
        : shotType === 'Volley'
          ? Math.max(0.5, context.aerialHeight)
          : 0.2;
    const height = penalty
      ? 0.5 + this.rand() * 0.9 + this.noise() * 0.25
      : 0.7 + this.rand() * 0.9 + this.noise() * spread * 0.42;
    b.x = p.x;
    b.y = p.y;
    b.offsideState = offsideSnapshot(this, p);
    b.owner = null;
    b.x += Math.cos(angle) * 0.6;
    b.y += Math.sin(angle) * 0.6;
    b.z = startZ;
    b.vx = Math.cos(angle) * speed;
    b.vy = Math.sin(angle) * speed - curve * flight * 0.5;
    b.vz = (height - startZ + 4.905 * flight * flight) / flight;
    b.kind = 'shot';
    b.deliveryOrigin = null;
    b.kicker = p.id;
    b.target = null;
    b.age = 0;
    b.lastTouch = p.team;
    b.shotTeam = p.team;
    b.offside = false;
    b.saver = null;
    b.curve = curve;
    b.shotType = shotType;
    b.strength = clamp((speed - 15) / 22, 0.12, 1);
    b.shotOrigin = this.origin(p);
    b.assist =
      !penalty && this.lastPass?.to === p.id && this.elapsed - this.lastPass.at < 8
        ? this.lastPass.from
        : null;
    b.goalCredit = { shooter: p.id, assist: b.assist, origin: { ...b.shotOrigin }, shotType };
    if (b.assist !== null) this.players[b.assist].stats.keyPasses++;
    b.penaltyTaker = penalty ? p.id : null;
    b.restartTaker = penalty || context.restart ? p.id : null;
    b.penaltyKick = penalty;
    b.indirect = null;
    this.lastShotSpeed = speed * 3.6;
    p.lastShotSpeed = speed * 3.6;
    p.lastShotType = shotType;
    p.animation = {
      type: 'shot',
      start: this.elapsed,
      duration: 0.4,
      angle,
      power: p.skill('power'),
    };
    const stat = this.stats[p.team];
    stat.shots++;
    p.stats.shots++;
    if (box) stat.boxShots++;
    if (penalty) p.stats.penalties++;
    const chance = targetChance(
      aimY,
      spread,
      penalty ? 0.99 : clamp(1 - spread * 0.055, 0.55, 0.98),
    );
    stat.xg += penalty
      ? 0.74
      : clamp((spatial.rate * (0.55 + skill)) / (1 + pressure * 0.45), 0.005, 0.7);
    p.cooldown = 0.65;
    p.action = shotType;
    p.think = 0.5;
    p.lastShotChance = chance;
    const e = this.addEvent(
      `${p.name.split(' ').pop()} · ${shotType.toLowerCase()}`,
      p.team,
      'shot',
      {
        playerId: p.id,
        chance,
        chanceLabel: 'on target',
        strength: b.strength,
        shotType,
        box,
        zone: spatial.zone,
        origin: { ...b.shotOrigin },
        outcome: 'in flight',
        foot: foot.foot,
        penalty,
      },
    );
    b.shotRecord = { team: p.team, player: p.id, eventId: e.id, status: null, penalty };
    this.flair(
      'shot',
      p,
      1.05,
      {
        tx: goalX,
        ty,
        power: p.skill('power'),
        speed: speed * 3.6,
        strength: b.strength,
        label: shotType,
        shotType,
      },
      true,
    );
    if (penalty) {
      const g = this.keeper(1 - p.team);
      g.penaltyDive = {
        until: this.elapsed + 0.8,
        y: 34 + (this.rand() < 0.5 ? -1 : 1) * (2 + this.rand() * 1.2),
      };
    }
  }
  resolveShot(outcome) {
    const record = this.ball.shotRecord;
    if (!record || record.status === outcome) return;
    const key = o =>
      o === 'goal' || o === 'saved'
        ? 'onTarget'
        : o === 'blocked'
          ? 'blocked'
          : o === 'post'
            ? 'woodwork'
            : 'offTarget';
    const previous = record.status,
      stat = this.stats[record.team],
      p = this.players[record.player];
    if (previous) {
      if (outcome !== 'goal') return;
      stat[key(previous)]--;
      p.stats[key(previous)]--;
    }
    stat[key(outcome)]++;
    p.stats[key(outcome)]++;
    record.status = outcome;
    if (record.penalty && outcome === 'goal') {
      stat.penaltyGoals++;
      p.stats.penaltyGoals++;
    }
    const event = this.events.find(e => e.id === record.eventId);
    if (event) {
      event.outcome = outcome;
      event.resolvedAt = this.elapsed;
    }
  }
  projectedOnTarget() {
    const b = this.ball,
      team =
        b.shotTeam ??
        b.shotRecord?.team ??
        this.players[b.goalCredit?.shooter ?? b.kicker]?.team ??
        b.lastTouch;
    if (team === undefined || team === null) return false;
    const directTime = (this.abs(105, team) - b.x) / (b.vx || 0.001);
    if (directTime <= 0 || directTime > 3) return false;
    let x = b.x,
      y = b.y,
      z = b.z,
      vx = b.vx,
      vy = b.vy,
      vz = b.vz,
      age = b.age;
    const goal = this.abs(105, team),
      dir = this.direction(team);
    if (vx * dir <= 0) return false;
    for (let i = 0; i < 300; i++) {
      const dt = 0.01;
      if (b.shotType === 'Curler') vy += (b.curve || 0) * dt;
      if (b.shotType === 'Knuckleball') vy += Math.sin(age * 23) * 7 * dt;
      const old = { x, y, z };
      x += vx * dt;
      y += vy * dt;
      z = Math.max(0, z + vz * dt);
      vz -= 9.81 * dt;
      age += dt;
      if (z === 0) {
        vz = Math.abs(vz) > 0.9 ? -vz * 0.3 : 0;
        const speed = Math.hypot(vx, vy),
          drag = Math.max(0, 1 - (2 * dt) / (speed || 1));
        vx *= drag;
        vy *= drag;
      }
      if ((x - goal) * dir >= 0) {
        const f = (goal - old.x) / (x - old.x || 1);
        return Math.abs(lerp(old.y, y, f) - 34) < GOAL / 2 && lerp(old.z, z, f) < 2.44;
      }
    }
    return false;
  }
  decide(p) {
    if (this.ball.owner !== p.id) return;
    const rx = this.rel(p.x, p.team),
      dGoal = Math.hypot(105 - rx, p.y - 34),
      pressure = this.pressure(p),
      opts = this.options(p),
      best = opts[0],
      tac = this.settings(p.team);
    p.think =
      ((0.19 + (100 - p.vision()) * 0.003 + this.rand() * 0.08) *
        (1.18 - tac.tempo * 0.06) *
        (1 + (1 - p.energy) * 0.4) *
        this.profile.decisionTime) /
      p.familiarity() ** 2;
    if (p.role === 'GK') {
      p.action = 'Checking the receiver’s next touch';
      if (p.hold < (this.ball.kind === 'held' ? this.profile.release : 0.55)) return;
      const outlet = this.keeperOutlet(p, opts);
      if (outlet) {
        this.pass(p, outlet);
        return;
      }
      if (
        p.hold > (p.has('distributor') ? 3.2 : 2.5) ||
        (this.ball.kind !== 'held' && pressure > 0.8)
      )
        this.clearKeeper(p, opts);
      return;
    }
    const quickTouch = !!p.lastReceipt && this.elapsed - p.receivedAt < 0.8,
      releaseAfter = quickTouch ? (p.has('onetouch') ? 0.07 : 0.1) : 0.16;
    if (p.hold < (quickTouch ? (p.has('onetouch') ? 0.07 : 0.1) : 0.15)) return;
    const spatial = this.location(p),
      box = spatial.inside,
      wide = Math.abs(p.y - 34) > 14;
    const judgment =
      clamp((p.vision() * 0.6 + p.skill('composure') * 0.4 - 72) / 22, 0, 1) *
      clamp(this.tuning.gameplay.creativeQuality, 0, 1);
    const delivery = opts.find(
      o =>
        ['cross', 'cutback'].includes(o.delivery) &&
        o.risk < 1.1 &&
        o.margin > -0.45 &&
        (!judgment ||
          (o.chance > 0.3 + judgment * 0.35 && o.score > best.score - (2.4 - judgment * 1.8))),
    );
    if (
      wide &&
      rx > 73 &&
      delivery &&
      p.hold > 0.28 &&
      (p.has('crosser') ||
        p.has('byline') ||
        rx > 89 ||
        tac.style === 'wings' ||
        delivery.score > 3.5)
    ) {
      this.pass(p, delivery);
      return;
    }
    if (dGoal < 34 && Math.abs(p.y - 34) < 22) {
      let blocks = 99;
      for (const targetY of [31.5, 34, 36.5]) {
        let count = 0;
        for (const q of this.activePlayers)
          if (q.team !== p.team && q.role !== 'GK') {
            const a = segment(q, p, { x: this.abs(105, p.team), y: targetY });
            if (a.t > 0.04 && a.t < 1 && a.d < 1.2) count++;
          }
        blocks = Math.min(blocks, count);
      }
      const better = opts.find(
        o =>
          this.inBox({ x: o.aim.x, y: o.aim.y, team: p.team }) &&
          o.margin > -0.1 &&
          o.risk < 0.65 &&
          Math.abs(o.aim.y - 34) < Math.abs(p.y - 34) - 3,
      );
      if (better && pressure > 0.3) {
        this.pass(p, better);
        return;
      }
      const nextTouch = {
          x: p.x + this.direction(p.team) * Math.min(4, dGoal - 8),
          y: lerp(p.y, 34, 0.25),
        },
        arrival = p.arrival(nextTouch);
      const canImprove =
        box &&
        dGoal > 11 &&
        Math.abs(p.y - 34) < 14 &&
        p.hold < this.profile.finishPatience &&
        !better &&
        this.activePlayers.every(q => q.team === p.team || q.arrival(nextTouch) > arrival + 0.22);
      if (canImprove) {
        p.action = 'Taking a touch toward goal';
        p.finishTarget = nextTouch;
        p.finishUntil = this.elapsed + 0.38;
        return;
      }
      const specialist = p.has('longshot') || p.has('knuckle') || p.has('curve');
      let urge = box
        ? clamp(
            (0.28 +
              (22 - dGoal) * 0.032 +
              (shootingAbility(p, dGoal) - 65) * 0.004 -
              blocks * 0.13 -
              pressure * 0.04) *
              spatial.quality,
            0.035,
            0.9,
          )
        : 0.1 *
          (specialist ? 2 : 1) *
          (spatial.central ? 1 : 0.4) *
          clamp((35 - dGoal) / 10, 0.15, 1);
      if (spatial.zone === 'deep_central') urge *= this.profile.deepUrge;
      if (!box && (blocks > (specialist ? 1 : 0) || pressure > 1 || p.hold < 0.27)) urge = 0;
      if (
        this.rand() <
        urge *
          (0.7 + p.tendency('shoot') * 0.6) *
          (box ? this.profile.shotUrge : this.profile.rangeUrge) *
          this.tuning.gameplay.shotFrequency
      ) {
        this.shoot(p);
        return;
      }
    }
    const runway = this.openCarry(p);
    if (runway) {
      const release = opts.find(
        o =>
          o.delivery === 'through' &&
          o.score > 2.5 &&
          o.chance > 0.75 &&
          o.margin > 0.35 &&
          o.risk < 0.45 &&
          this.rel(o.aim.x, p.team) > this.rel(runway.x, p.team) + 7 &&
          Math.abs(o.aim.y - 34) < Math.abs(runway.y - 34) + 5,
      );
      if (release) {
        this.pass(p, release);
        return;
      }
      p.finishTarget = runway;
      p.finishUntil = this.elapsed + p.think;
      p.aim(runway.x, runway.y, 'carry', 'Driving into space');
      return;
    }
    // A composed carrier facing a press releases to a genuinely available
    // outlet instead of waiting for another dribble/decision cycle.
    const retention = clamp(
      (p.skill('shortPassing') + p.skill('control') + p.skill('composure') + p.vision() - 280) / 90,
      0,
      1,
    );
    const safe = opts.find(o => o.chance > 0.76 && o.risk < 0.32 && o.margin > 0.2);
    if (
      pressure > 0.28 &&
      safe &&
      safe.score > best.score - retention * (tac.style === 'possession' ? 1.5 : 0.85) &&
      p.hold > 0.15
    ) {
      this.pass(p, safe);
      return;
    }
    const urgency =
      0.52 +
      (tac.style === 'possession' ? 0.28 * this.tuning.gameplay.teamCharacter : 0) +
      pressure * 0.85 +
      Math.max(0, p.hold - 1.2) * 0.38 +
      (tac.tempo - 3) * 0.1 +
      this.profile.passUrge +
      (1 - p.tendency('carry')) * 0.25 +
      (quickTouch ? 0.04 : 0);
    const clearance = this.outfieldClearance(p, opts);
    if (clearance) {
      this.pass(p, clearance);
      return;
    }
    if (
      best &&
      p.hold > releaseAfter &&
      best.score > 2.0 - urgency &&
      (this.rand() < clamp(0.2 + urgency * 0.3, 0.2, 0.9) || p.hold > 3.5)
    ) {
      this.pass(p, best);
      return;
    }
    if (rx > 98 && best) {
      this.pass(p, best);
      return;
    }
    if (p.feintCooldown <= 0 && p.hold > 0.35) {
      const q = this.activePlayers
        .filter(q => q.team !== p.team && q.role !== 'GK' && dist(q, p) < 3.1 && dist(q, p) > 1.2)
        .sort((a, b) => dist(a, p) - dist(b, p))[0];
      if (
        q &&
        this.rand() <
          (0.12 + p.tendency('carry') * 0.45) *
            (tac.style === 'possession' ? 1 - retention * 0.45 : 1)
      )
        this.feint(p, q);
    }
    if (p.animation?.type !== 'feint')
      p.action = pressure > 0.5 ? 'Protecting the ball' : 'Driving into space';
  }

  feint(p, q) {
    const escape = this.carryTarget(p),
      angle = Math.atan2(escape.y - p.y, escape.x - p.x),
      side = p.y < q.y ? -1 : 1;
    const support = this.activePlayers
      .filter(r => r.team !== p.team && r.id !== q.id && r.role !== 'GK')
      .reduce((sum, r) => sum + clamp(1 - r.arrival(escape) / 1.65, 0, 1), 0);
    const chain = p.beatChain.filter(b => this.elapsed - b.at < 7),
      balance = (p.skill('strength') - q.skill('strength')) * 0.004;
    const chance = clamp(
      sigmoid(
        (p.skill('dribbling') - q.tackling()) / 27 +
          0.1 +
          balance +
          (p.energy - q.energy) * 0.5 +
          (p.sprint - 0.5) * 0.25 -
          support * 0.95 -
          chain.length * 0.36,
      ) * this.tuning.gameplay.dribbleSuccess,
      0.035,
      0.9,
    );
    p.feintCooldown = p.has('dribbler') ? 1.5 : 2.1;
    p.animation = { type: 'feint', start: this.elapsed, duration: 0.55, side, angle };
    p.sprint = clamp(p.sprint - 0.07, 0, 1);
    p.feintTarget = escape;
    p.action = 'Feinting past the defender';
    p.intent = 'dribble';
    p.stats.dribbleAttempts++;
    this.stats[p.team].dribbleAttempts++;
    if (this.rand() < chance) {
      q.stun = 0.22 + p.skill('dribbling') * 0.002;
      q.cooldown = 0.48;
      q.animation = { type: 'beaten', start: this.elapsed, duration: 0.55, side };
      this.stats[p.team].takeons++;
      p.stats.takeons++;
      p.beatChain = chain.filter(b => b.id !== q.id);
      p.beatChain.push({ id: q.id, at: this.elapsed });
      const strength = clamp(0.2 + support * 0.15 + p.beatChain.length * 0.16, 0, 1);
      this.flair('feint', p, 0.7, {
        side,
        angle,
        strength,
        label: p.beatChain.length > 1 ? 'SLALOM' : 'BEATEN',
      });
      this.addEvent(
        `${p.name.split(' ').pop()} beats ${q.name.split(' ').pop()}.`,
        p.team,
        'dribble',
        { playerId: p.id, chance, chanceLabel: 'take-on', strength },
      );
    } else {
      p.stun = 0.12;
      p.cooldown = 0.18;
      p.animation = { type: 'stumble', start: this.elapsed, duration: 0.3 };
      p.feintTarget = { x: p.x - Math.cos(angle), y: p.y - Math.sin(angle) };
      if (this.rand() < 0.4 + support * 0.12) {
        this.ball.owner = null;
        this.ball.kind = 'loose';
        this.ball.kicker = p.id;
        this.ball.lastTouch = p.team;
        this.ball.age = 0;
        this.ball.vx = Math.cos(angle) * 3;
        this.ball.vy = Math.sin(angle) * 3;
        p.stats.turnovers++;
        this.planTimer = 0;
      }
    }
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
  markingPoint(team, attacker, defender, coordination = 0) {
    const dir = this.direction(team),
      depth = this.rel(attacker.x, team);
    const expertise = defender.defensiveReading(),
      reading = 0.25 + defender.awareness() * 0.004 + expertise * 0.16;
    const lead = clamp(
      reading + Math.max(0, dist(defender, attacker) - 4) * 0.025,
      0.25,
      0.85 + expertise * 0.15,
    );
    const goalward = Math.min(0, (attacker.vx || 0) * dir);
    const beaten = this.rel(defender.x, team) > depth - 1;
    const closingRun = Math.max(0, -goalward),
      speedGap = Math.max(0, attacker.topSpeed() - defender.topSpeed());
    const cushion =
      1.25 +
      (100 - defender.awareness()) * 0.012 +
      (beaten ? 1.1 : 0) +
      Math.min(0.9, closingRun * 0.07 + speedGap * 0.2);
    // Read the runner, stay between them and goal, shade toward the passing lane.
    const x = clamp(
      depth + goalward * lead - cushion * this.tuning.gameplay.markingDistance,
      1,
      100,
    );
    const y = clamp(
      attacker.y +
        (attacker.vy || 0) * lead +
        (34 - attacker.y) * 0.04 +
        (this.ball.y - attacker.y) * 0.025,
      2,
      66,
    );
    const point = { x: this.abs(x, team), y },
      tac = this.teams[team].tactics;
    // In the opposition's build-up, a coordinated midfield/front line can
    // screen an outlet from the ball side. Backs and dangerous runners retain
    // their goal-side protection; this is a physical run, never a free steal.
    if (this.canScreenOutlet(team, attacker, defender, coordination)) {
      const length = dist(this.ball, attacker),
        step =
          clamp((defender.pressingReading() + coordination) * 1.2, 0, 0.98) *
          clamp((tac.press - 1) / 2, 0, 1);
      if (length > 4) {
        point.x = lerp(point.x, attacker.x + ((this.ball.x - attacker.x) / length) * 1.5, step);
        point.y = lerp(point.y, attacker.y + ((this.ball.y - attacker.y) / length) * 1.5, step);
      }
    }
    return point;
  }
  canScreenOutlet(team, attacker, defender, coordination) {
    const depth = this.rel(attacker.x, team);
    return (
      coordination > 0 &&
      depth > 64 &&
      depth >= this.rel(this.ball.x, team) - 2 &&
      (attacker.vx || 0) * this.direction(team) > -1 &&
      this.formation(defender)[0] >= 30 &&
      this.ball.owner !== attacker.id &&
      this.teams[team].tactics.style !== 'bus'
    );
  }
  threatValue(team, a) {
    const depth = this.rel(a.x, team),
      central = 1 - clamp(Math.abs(a.y - 34) / 32, 0, 1);
    return (
      clamp((65 - depth) / 45, 0, 1.4) * (1 + central * 0.55) +
      Math.max(0, -(a.vx || 0) * this.direction(team)) * 0.045
    );
  }
  assignmentCost(d, a) {
    const base = this.formation(d)[0],
      depth = this.rel(a.x, d.team);
    // The back line protects forward threats, rather than following opponents
    // well behind the ball upfield. Keep close marking around our box, where
    // a cutback is dangerous even when its receiver is behind the carrier.
    if (base < 30 && depth > 30 && depth > this.rel(this.ball.x, d.team) + 4) return Infinity;
    const point = this.markingPoint(d.team, a, d),
      behind = Math.max(0, this.rel(d.x, d.team) - depth);
    const lateral = Math.abs(this.formation(d)[1] - (this.direction(d.team) > 0 ? a.y : H - a.y)),
      binding = Math.max(0, 3 - this.teams[d.team].tactics.fluidity) * 0.025;
    return (
      d.arrival(point) +
      behind * 0.045 +
      (base < 30 && depth > 58 ? 0.7 : base > 60 && depth < 25 ? 0.45 : 0) +
      Math.max(0, lateral - 10) * binding * (depth < 35 ? 0.15 : 1) -
      (d.markId === a.id ? 0.6 : 0)
    );
  }
  supportTarget(p, target, anchor, openRun = false) {
    const f = (this.teams[p.team].tactics.fluidity - 1) / 4;
    // Shape moves with the ball. Clear runs are exempt from the strong pull;
    // even the most structured team can attack an opening.
    const pull = openRun ? 0.06 * (1 - f) : 0.55 * Math.max(0, 1 - f * 2);
    const lateral = 8 + f * 16 + (openRun ? 16 : 0);
    return {
      x: lerp(target.x, anchor.x, pull),
      y: clamp(lerp(target.y, anchor.y, pull), anchor.y - lateral, anchor.y + lateral),
    };
  }
  abandonment(team, defender, carrier, excluded = []) {
    const others = this.activePlayers.filter(
      p => p.team === team && p.role !== 'GK' && p.id !== defender.id && !excluded.includes(p.id),
    );
    let cost = 0;
    for (const a of this.activePlayers) {
      if (a.team === team || a.role === 'GK' || a.id === carrier?.id || this.rel(a.x, team) > 54)
        continue;
      const own = this.assignmentCost(defender, a),
        next = Math.min(...others.map(p => this.assignmentCost(p, a)));
      if (own < 2.2 && next > own + 0.3)
        cost = Math.max(cost, (next - own) * this.threatValue(team, a));
    }
    return cost;
  }
  carrierMotion(defender, carrier) {
    // A fresh receiver's visible body direction hints at the next touch. Read
    // only a short launch, not the carrier's chosen target or future decisions.
    const fresh = clamp(1 - (this.elapsed - carrier.receivedAt) / 0.65, 0, 1);
    const forward = Math.max(0, -Math.cos(carrier.facing) * this.direction(defender.team));
    const launch =
      fresh *
      forward *
      Math.max(0, 4 - Math.hypot(carrier.vx, carrier.vy)) *
      (0.55 + defender.pressingReading() * 0.25);
    return {
      vx: carrier.vx + Math.cos(carrier.facing) * launch,
      vy: carrier.vy + Math.sin(carrier.facing) * launch,
    };
  }
  assignDefense(team, carrier) {
    const defending = this.activePlayers.filter(p => p.team === team && p.role !== 'GK');
    const bids = defending
      .map(p => {
        let point = p.intercept(carrier, 1.5);
        const beaten = this.rel(p.x, team) > this.rel(carrier.x, team) + 0.7;
        // A beaten defender cuts toward the inside shoulder ahead of the runner,
        // instead of chasing their current position from behind.
        if (beaten && dist(p, carrier) > 3) {
          const ahead = this.markingPoint(team, carrier, p);
          point = { x: ahead.x, y: lerp(ahead.y, 34, 0.08) };
        } else if (!beaten) {
          // Leave enough room to brake when closing a controlled receiver.
          // A slow or exposed touch still brings the defender into tackle range.
          const gap = dist(p, carrier),
            close = this.ball.owner === carrier.id ? clamp((10 - gap) / 4, 0, 1) : 0;
          const motion = close ? this.carrierMotion(p, carrier) : carrier;
          if (close)
            point = p.intercept(
              {
                ...carrier,
                vx: lerp(carrier.vx, motion.vx, close),
                vy: lerp(carrier.vy, motion.vy, close),
              },
              1.5,
            );
          const closing = Math.max(
            0,
            ((p.vx - motion.vx) * (carrier.x - p.x) + (p.vy - motion.vy) * (carrier.y - p.y)) /
              (gap || 1),
          );
          const braking =
            close *
            clamp((closing * closing) / (2 * p.acceleration() * (0.72 + p.energy * 0.28)), 0, 1.1);
          const goal = { x: this.abs(0, team), y: 34 },
            length = dist(point, goal) || 1;
          const cushion = 0.9 + p.pressingReading() * 0.25 + braking;
          point = {
            ...point,
            x: point.x + ((goal.x - point.x) / length) * cushion,
            y: point.y + ((goal.y - point.y) / length) * cushion,
          };
        }
        const abandon = this.abandonment(team, p, carrier);
        return {
          p,
          point,
          beaten,
          cost:
            p.arrival(point) +
            (beaten ? 0.25 : 0) +
            abandon * 0.75 * (1 + p.defensiveReading() * 0.25) -
            (p.has('ballwinner') ? 0.12 : 0) +
            (this.presser[team] === p.id ? -0.4 : 0),
        };
      })
      .sort((a, b) => a.cost - b.cost);
    const press = bids[0];
    this.presser[team] = press.p.id;
    const goal = { x: this.abs(0, team), y: 34 },
      gdist = dist(goal, press.point) || 1;
    const coverPoint = {
      x: clamp(press.point.x + ((goal.x - press.point.x) / gdist) * 5, 1, 104),
      y: clamp(press.point.y + ((34 - press.point.y) / gdist) * 5, 1, 67),
    };
    const alternatives = bids
      .slice(1)
      .map(b => ({ ...b, abandonment: this.abandonment(team, b.p, carrier, [press.p.id]) }))
      .sort(
        (a, b) =>
          a.p.arrival(coverPoint) + a.abandonment * 3 - b.p.arrival(coverPoint) - b.abandonment * 3,
      );
    const depth = this.rel(carrier.x, team),
      closing = -carrier.vx * this.direction(team),
      pressArrival = press.p.arrival(press.point);
    const breaking =
      depth < 65 &&
      Math.abs(carrier.y - 34) < 26 &&
      (press.beaten || press.p.stun > 0 || (closing > 2 && pressArrival > 0.8));
    const candidate = alternatives[0],
      needsCover = breaking || (depth < 45 && Math.abs(carrier.y - 34) < 22 && pressArrival > 0.5);
    const cover =
      needsCover && candidate.abandonment < 0.28 && candidate.p.arrival(coverPoint) < 1.8
        ? candidate.p.id
        : null;
    return { press: press.p.id, point: press.point, cover, coverPoint };
  }
  assignMarks(team, carrier, defence, coordination = 0) {
    const defenders = this.activePlayers.filter(
      p => p.team === team && p.role !== 'GK' && p.id !== defence?.press && p.id !== defence?.cover,
    );
    const attackers = this.activePlayers
      .filter(p => p.team !== team && p.role !== 'GK' && p.id !== carrier?.id)
      .sort((a, b) => this.threatValue(team, b) - this.threatValue(team, a) || a.id - b.id);
    const marks = new Map();
    for (const id of [defence?.press, defence?.cover])
      if (id != null) this.players[id].markId = null;
    // Prioritize dangerous runners, with a switching cost to keep useful matches.
    // Expiring timers may never reserve the nearest defender for a harmless man.
    for (const a of attackers) {
      let best = null;
      for (const d of defenders) {
        if (marks.has(d.id)) continue;
        const cost = this.assignmentCost(d, a);
        if (!Number.isFinite(cost)) continue;
        if (!best || cost < best.cost) best = { d, cost };
      }
      if (best && (best.cost < 5.5 || this.rel(a.x, team) < 38)) marks.set(best.d.id, a);
    }
    // Organizers can hand over two marks rather than send teammates across
    // each other. Existing switching costs keep useful assignments stable;
    // a dangerous runner may not gain space just to improve the total cost.
    if (coordination > 0.2)
      for (let sweep = 0; sweep < 2; sweep++)
        for (let i = 0; i < defenders.length; i++)
          for (let j = i + 1; j < defenders.length; j++) {
            const a = defenders[i],
              b = defenders[j],
              ma = marks.get(a.id),
              mb = marks.get(b.id);
            if (!ma && !mb) continue;
            const aa = ma ? this.assignmentCost(a, ma) : 0,
              bb = mb ? this.assignmentCost(b, mb) : 0;
            const ba = ma ? this.assignmentCost(b, ma) : 0,
              ab = mb ? this.assignmentCost(a, mb) : 0;
            if (ba + ab + 0.18 / coordination >= aa + bb) continue;
            if (
              (ma && this.rel(ma.x, team) < 38 && ba > aa + 0.1) ||
              (mb && this.rel(mb.x, team) < 38 && ab > bb + 0.1)
            )
              continue;
            if (mb) marks.set(a.id, mb);
            else marks.delete(a.id);
            if (ma) marks.set(b.id, ma);
            else marks.delete(b.id);
          }
    for (const d of defenders) {
      const mark = marks.get(d.id);
      if (d.markId !== (mark?.id ?? null)) {
        d.markId = mark?.id ?? null;
        d.markUntil = this.elapsed + 0.75;
        d.rethinkAt = 0;
      }
    }
    return marks;
  }
  receiverPressPoint(team, receiver, defender, coordination = 0) {
    const point = this.markingPoint(team, receiver, defender, coordination),
      b = this.ball;
    if (
      b.kind !== 'pass' ||
      b.missedReceiver ||
      !b.destination ||
      b.z > 1 ||
      this.rel(defender.x, team) > this.rel(receiver.x, team) - 0.5
    )
      return point;
    if (this.rel(b.destination.x, team) < this.rel(b.deliveryOrigin?.x ?? b.x, team) - 4)
      return point;
    const reading = clamp(defender.pressingReading() * 0.8 + coordination * 0.6, 0, 0.9);
    if (!reading) return point;
    const goal = { x: this.abs(0, team), y: 34 },
      length = dist(b.destination, goal) || 1;
    const contact = {
      x: b.destination.x + ((goal.x - b.destination.x) / length) * 1.15,
      y: b.destination.y + ((goal.y - b.destination.y) / length) * 1.15,
    };
    return { x: lerp(point.x, contact.x, reading), y: lerp(point.y, contact.y, reading) };
  }
  readPassingLane(team, receiver) {
    const b = this.ball,
      speed = Math.hypot(b.vx, b.vy);
    if (b.kind !== 'pass' || b.missedReceiver || b.z > 0.65 || b.vz > 1 || speed < 5) return null;
    let best = null;
    for (const p of this.activePlayers) {
      if (p.team !== team || p.role === 'GK' || p.stun > 0) continue;
      const reading = p.pressingReading();
      if (reading <= 0) continue;
      const reaction =
        0.08 +
        (100 - p.pressAwareness()) * 0.003 +
        Math.max(0, (b.passCraft ?? 60) - p.pressAwareness()) *
          0.004 *
          this.tuning.gameplay.passingQuality;
      for (const time of [0.18, 0.32, 0.48, 0.7, 0.9]) {
        if (time > 0.25 + reading * 0.75) break;
        const travel = Math.max(
          0,
          speed * time - (b.z < 0.15 ? (b.roll || 3.8) * time * time * 0.5 : 0),
        );
        const point = { x: b.x + (b.vx / speed) * travel, y: b.y + (b.vy / speed) * travel };
        if (
          point.x < 1 ||
          point.x > 104 ||
          point.y < 1 ||
          point.y > 67 ||
          (b.destination &&
            (point.x - b.destination.x) * b.vx + (point.y - b.destination.y) * b.vy > 0)
        )
          continue;
        if (receiver && receiver.arrival(point) < time - 0.06) break;
        const arrival = Math.max(
            p.arrival(point) + reaction,
            p.cooldown,
            (p.controlUntil || 0) - this.elapsed,
          ),
          lead = time - arrival;
        if (lead < -0.04 || (receiver && receiver.arrival(point) < arrival + 0.08)) continue;
        // A high-risk gamble cannot release a dangerous runner. A clearly
        // early interception can be attacked with the normal movement limits.
        const abandon = this.abandonment(team, p, receiver);
        if (abandon > 0.25 && (lead < 0.16 || this.formation(p)[0] < 30)) continue;
        const cost = arrival + abandon * 0.15 - reading * 0.08;
        if (!best || cost < best.cost) best = { p, point, cost };
        break;
      }
    }
    return best;
  }
  plan() {
    const b = this.ball,
      owner = b.owner !== null ? this.players[b.owner] : null,
      attack = this.mode === 'restart' ? this.restart.team : owner ? owner.team : b.lastTouch;
    for (let t = 0; t < 2; t++) {
      const dir = this.direction(t),
        tac = this.settings(t),
        team = this.activePlayers.filter(p => p.team === t),
        enemies = this.activePlayers.filter(p => p.team !== t),
        has = attack === t,
        br = this.rel(b.x, t);
      // The strongest readers organize nearby teammates' marking. This is
      // derived from the active players, with no club-tier or score modifier.
      const organizers = team
        .filter(p => p.role !== 'GK')
        .map(p => ({
          ability: p.awareness() * 0.7 + p.skill('composure') * 0.3,
          readiness: 0.75 + 0.25 * p.energy,
        }))
        .sort((a, b) => b.ability - a.ability)
        .slice(0, 5);
      const coordination =
        Math.pow(
          clamp(
            (organizers.reduce((sum, p) => sum + p.ability, 0) / (organizers.length || 1) - 74) /
              16,
            0,
            1,
          ),
          1.5,
        ) *
        (organizers.reduce((sum, p) => sum + p.readiness, 0) / (organizers.length || 1)) *
        this.tuning.gameplay.defensiveQuality;
      const threat =
        owner ||
        (!has && b.kind === 'pass' && !b.missedReceiver && b.target !== null
          ? this.players[b.target]
          : null);
      const defence = threat && !has && b.kind !== 'held' ? this.assignDefense(t, threat) : null;
      const anticipation = defence ? this.readPassingLane(t, threat) : null;
      if (anticipation) {
        defence.press = anticipation.p.id;
        defence.point = anticipation.point;
        defence.lane = true;
        if (defence.cover === defence.press) defence.cover = null;
        this.presser[t] = defence.press;
      }
      const marks = !has ? this.assignMarks(t, threat, defence, coordination) : new Map();
      const freeBall =
        this.mode !== 'restart' && !owner && (b.kind === 'loose' || b.missedReceiver);
      const loose = team
        .filter(p => p.role !== 'GK')
        .map(p => ({
          p,
          time: Math.max(
            p.arrival(p.intercept(b, 0.8)),
            p.stun,
            (p.controlUntil || 0) - this.elapsed,
          ),
        }))
        .sort((a, b) => a.time - b.time);
      const oppLine = enemies.map(q => this.rel(q.x, t)).sort((a, b) => b - a)[1] || 96;

      for (const p of team) {
        const [base, by, role] = this.formation(p);
        p.role = role;
        const sideY = dir > 0 ? by : H - by;
        if (
          this.elapsed < p.rethinkAt &&
          p.id !== owner?.id &&
          p.id !== defence?.press &&
          p.id !== defence?.cover &&
          !(b.kind === 'pass' && b.target === p.id) &&
          !(freeBall && loose[0]?.p.id === p.id)
        )
          continue;
        p.rethinkAt =
          this.elapsed +
          ((0.08 + (100 - (has ? p.vision() : p.awareness())) * 0.002 + (p.id % 3) * 0.017) /
            p.familiarity() ** 2) *
            (has ? 1 : 1 - clamp(p.defensiveReading() * 0.3, 0, 0.5));
        let x, y;
        // Receiving a backpass takes priority over a keeper's default goal
        // position, including when a nearby attacker makes sweeping unsafe.
        if (!owner && b.kind === 'pass' && b.target === p.id) {
          const aim = b.missedReceiver
            ? p.intercept(b, 0.8)
            : dist(p, b) < 7
              ? p.intercept(b, 0.18)
              : b.destination || p.intercept(b, 0.4);
          p.aim(aim.x, aim.y, 'receive', 'Moving to receive');
          continue;
        }
        if (role === 'GK') {
          if (owner?.id === p.id) {
            p.aim(
              this.abs(6, t),
              clamp(p.y, 27, 41),
              'hold',
              b.kind === 'held' ? 'Ball secured in hands' : 'Preparing distribution',
            );
            continue;
          }
          x = clamp(2.5 + br * 0.035, 2.5, 6);
          y = clamp(34 + ((b.y - 34) * x) / Math.max(br, 6), 28, 40);
          if (b.kind === 'shot' && b.shotTeam !== t && p.penaltyDive?.until > this.elapsed) {
            p.aim(this.abs(0.25, t), p.penaltyDive.y, 'save', 'Diving for the penalty');
            continue;
          }
          if (
            !owner &&
            ((b.kind === 'shot' && b.shotTeam !== t) ||
              (this.rel(b.x, t) < 27 && b.vx * dir < 0 && this.projectedOnTarget()))
          ) {
            x = 2.8;
            const crossing = (this.abs(x, t) - b.x) / (b.vx || 0.001);
            if (
              crossing > 0 &&
              crossing < 2 &&
              b.age > (p.has('reflexes') ? 0.03 : 0.07) + (100 - p.skill('goalkeeping')) * 0.002
            ) {
              y = clamp(b.y + b.vy * crossing, 28.5, 39.5);
              p.aim(this.abs(x, t), y, 'save', 'Tracking the shot');
              continue;
            }
          }
          if (
            !owner &&
            br < 15 &&
            Math.abs(b.y - 34) < 18 &&
            b.kind !== 'shot' &&
            dist(p, b) < 11 + 7 * p.tendency('sweep') &&
            p.arrival(p.intercept(b, 0.7)) < Math.min(...enemies.map(q => q.arrival(b)))
          ) {
            p.aim(b.x, b.y, 'sweep', 'Sweeping');
            continue;
          }
          p.aim(this.abs(x, t), y, 'keeper', 'Guarding the goal');
          continue;
        }
        if (owner?.id === p.id) {
          if (p.animation?.type === 'feint') {
            p.aim(p.feintTarget.x, p.feintTarget.y, 'dribble', 'Feinting past the defender');
            continue;
          }
          const best = p.finishUntil > this.elapsed ? p.finishTarget : this.carryTarget(p);
          p.aim(
            best.x,
            best.y,
            'carry',
            (best.x - p.x) * dir < -0.5 ? 'Carrying away from pressure' : 'Driving into space',
          );
          continue;
        }
        if (freeBall && loose[0]?.p.id === p.id) {
          const aim = p.intercept(b, 0.9);
          p.aim(aim.x, aim.y, 'recover', 'Attacking the loose ball');
          continue;
        }
        if (defence && p.id === defence.press) {
          if (defence.lane) {
            p.aim(defence.point.x, defence.point.y, 'intercept', 'Reading the passing lane');
            continue;
          }
          if (b.kind === 'pass' && !has) {
            const lane = segment(p, b, b.destination || threat),
              intercept = p.intercept(b, 0.7);
            if (lane.d < 4 && p.arrival(intercept) < 0.8) {
              p.aim(intercept.x, intercept.y, 'intercept', 'Closing the passing lane');
            } else {
              const point = this.receiverPressPoint(t, threat, p, coordination);
              p.aim(point.x, point.y, 'track', 'Reading the receiver');
            }
            continue;
          }
          // An approaching runner can enter the pressing zone before the ball
          // reaches it. Use the assigned interception point as well, so the
          // presser does not retreat while his covering teammate steps up.
          const approaching = (threat.vx || 0) * dir < -1;
          const pressDistance = approaching
            ? Math.min(dist(p, b), dist(p, defence.point))
            : dist(p, b);
          const urgent =
            tac.style === 'bus'
              ? br < 35 && pressDistance < 8 + tac.pressing * 0.15
              : br < 43 ||
                pressDistance <
                  10 +
                    tac.pressing * 0.25 +
                    (coordination * 5 * (tac.press - 1)) / 4 +
                    (tac.style === 'press' ? 9 * this.tuning.gameplay.teamCharacter : 0);
          if (urgent) {
            p.aim(defence.point.x, defence.point.y, 'press', 'Closing the runner');
            continue;
          }
          if (tac.style !== 'bus' && base >= 30 && coordination > 0) {
            const approach = clamp((coordination * coordination * (tac.press - 1)) / 3, 0, 1);
            if (approach > 0) {
              p.aim(
                lerp(p.x, defence.point.x, approach),
                lerp(p.y, defence.point.y, approach),
                'shape',
                'Advancing the press',
              );
              continue;
            }
          }
        }
        if (defence && p.id === defence.cover) {
          p.aim(defence.coverPoint.x, defence.coverPoint.y, 'cover', 'Covering behind the press');
          continue;
        }
        if (!has) {
          const block =
            coordination *
            4 *
            clamp((br - 65) / 30, 0, 1) *
            clamp((tac.press - 1) / 3, 0, 1) *
            (tac.style === 'bus' ? 0 : 1);
          const line = clamp(22 + (br - 52) * 0.34 + (tac.line - 50) * 0.13 + block, 7, 48);
          x = base < 30 ? line : base < 58 ? line + 13 : line + 28;
          y = 34 + (sideY - 34) * 0.74 + (b.y - 34) * 0.13;
          const q = marks.get(p.id);
          if (q) {
            const qr = this.rel(q.x, t),
              danger = clamp((62 - qr) / 30, 0, 1),
              point = this.markingPoint(t, q, p, coordination);
            const outlet = (clamp(1 - dist(q, b) / 35, 0, 1) * (tac.press - 1)) / 4;
            const unit = coordination * (0.3 + 1.25 * outlet) * clamp(1 - dist(p, q) / 45, 0, 1);
            const weight = clamp(
              0.72 +
                (tac.fluidity - 3) * 0.06 +
                danger * 0.28 +
                (p.defensiveReading() * 0.14 + unit) * (1 - danger),
              0.5,
              1,
            );
            const cushion = this.canScreenOutlet(t, q, p, coordination) ? 0.25 : 1;
            x = Math.min(lerp(x, this.rel(point.x, t), weight), qr - cushion);
            y = lerp(y, point.y, weight);
            const recovering = this.rel(p.x, t) > qr - 0.7 || (dist(p, point) > 4.5 && qr < 55);
            p.aim(
              this.abs(x, t),
              y,
              recovering ? 'track' : 'mark',
              recovering ? 'Recovering goal-side' : 'Watching the runner',
            );
          } else {
            const recovering = base < 30 && br < 65 && this.rel(p.x, t) > br - 3;
            p.aim(
              this.abs(x, t),
              y,
              recovering
                ? 'recover'
                : tac.fluidity < 3 && dist(p, { x: this.abs(x, t), y }) > 5
                  ? 'reset'
                  : 'shape',
              recovering || tac.fluidity < 3
                ? 'Recovering defensive shape'
                : 'Keeping defensive shape',
            );
          }
        } else {
          const attackBias = (tac.attacking - 50) * 0.1;
          if (base < 30) {
            x = clamp(br - 24 + (base - 22) * 0.7 + attackBias, 20, 70);
            if (role === 'CB') {
              const recovery = 0.55 * p.skill('pace') + 0.45 * p.skill('acceleration'),
                slow = clamp((75 - recovery) / 30, 0, 1),
                security = owner ? clamp(1 - this.pressure(owner) * 0.5, 0, 1) : 0.5,
                cover = this.activePlayers.filter(
                  q =>
                    q.team === t && q.id !== p.id && q.role !== 'GK' && this.rel(q.x, t) < br - 10,
                ).length;
              x -=
                (2 + slow * 6 + (1 - security) * 3 + (cover < 2 ? 2 : 0)) *
                (1 - 0.35 * p.tendency('advance'));
            }
          } else if (base < 58) {
            const advanced =
              ['CM', 'AM', 'LM', 'RM'].includes(role) &&
              p.id !== owner?.id &&
              p.tendency('advance') + p.tendency('timing') * 0.4 > 0.72 &&
              Math.abs(p.y - b.y) < 22 &&
              this.activePlayers.filter(
                q => q.team === t && q.id !== p.id && q.role !== 'GK' && this.rel(q.x, t) < br,
              ).length >= 3;
            x = clamp(
              br +
                (advanced ? 8 : 1) +
                (base - 45) * 0.35 +
                attackBias +
                this.profile.runSupport * 0.55,
              25,
              94,
            );
          } else
            x = clamp(Math.max(br + 13 + attackBias, base + 5 + this.profile.runSupport), 45, 99);
          y =
            34 +
            (sideY - 34) *
              (0.58 +
                tac.widthValue * 0.007 +
                (tac.style === 'wings' ? 0.15 * this.tuning.gameplay.teamCharacter : 0)) +
            (b.y - 34) * 0.1;
          const anchor = { x, y };
          if (base > 60) anchor.x = Math.min(anchor.x, Math.max(br, oppLine - 0.5));
          let action =
              base < 30
                ? 'Supporting the build-up'
                : base < 58
                  ? 'Creating a passing angle'
                  : 'Stretching the defense',
            intent = 'support';
          if (base > 60 && br < 66) {
            x = Math.min(x, br + 17 + p.tendency('roam') * 6);
            action = 'Offering a forward link';
          }
          if (base > 60) {
            const timing = p.tendency('timing') * p.familiarity(),
              margin = 0.45 + (1 - timing) * 0.8;
            x = Math.min(x, Math.max(oppLine - margin, br));
            if (
              br > 62 &&
              Math.sin(this.elapsed * 0.55 + p.slot * 1.7) > 1 - p.tendency('advance')
            ) {
              x = Math.min(100, Math.max(br, oppLine) + 0.8 + (1 - timing) * 1.1);
              action = 'Timing a forward run';
              intent = 'run';
            }
          }
          if (p.runs > this.elapsed && base > 30) {
            x = clamp(br + 9, 24, 96);
            action = 'Pass and move';
            intent = 'run';
          }
          if (owner?.role === 'GK' && base < 58) {
            x = base < 30 ? 19 : 35;
            y = base < 30 ? 34 + (sideY - 34) * 1.35 : 34 + (sideY - 34) * 1.55;
            action = 'Opening a safe outlet';
            const marker = enemies.reduce((a, q) => (!a || dist(q, p) < dist(a, p) ? q : a), null);
            if (marker && dist(marker, p) < 9) {
              y += p.y < marker.y ? -6 : 6;
              x += 4;
            }
          }
          if (
            base >= 30 &&
            base < 60 &&
            p.tendency('hold') < 0.64 &&
            (dist(p, b) > 12 || br > 64)
          ) {
            intent = 'run';
            action = 'Joining the attack';
          }
          if (base > 60 && br > 72 && Math.abs(b.y - 34) < 13) {
            y = lerp(y, 34, 0.25);
            action = 'Attacking an inside channel';
            intent = 'run';
          }
          if (role === 'DM') {
            const hold = clamp((p.tendency('hold') - 0.35) * 1.5, 0, 0.85);
            x = lerp(x, Math.min(x, br - 13), hold);
            y = lerp(y, 34, hold * 0.45);
          }
          if (p.has('latearrival') && base >= 30 && base < 60 && br < 70) {
            x -= 2;
            action = 'Waiting to join the move';
          }
          if ((role === 'LB' || role === 'RB') && owner?.role !== 'GK') {
            const sameSide = (b.y - 34) * (sideY - 34) > 0,
              backCover = team.filter(
                q => q.id !== p.id && ['CB', 'DM'].includes(q.role) && this.rel(q.x, t) < br - 6,
              ).length;
            const opposite = team.find(q => q.id !== p.id && ['LB', 'RB'].includes(q.role)),
              otherHigh = opposite && this.rel(opposite.x, t) > br;
            const security = owner ? clamp(1 - this.pressure(owner) * 0.5, 0, 1) : 0.4;
            const join = clamp(
              p.tendency('overlap') * 0.55 +
                security * 0.2 +
                (sameSide ? 0.16 : 0) +
                Math.min(backCover, 3) * 0.06 -
                (otherHigh ? 0.25 : 0) -
                (tac.style === 'bus' ? 0.17 : 0),
              0.05,
              0.97,
            );
            const height = clamp(br - 14 + join * 24, 22, 94);
            x = lerp(x, height, clamp((br - 35) / 35, 0, 1));
            if (p.skill('shortPassing') - p.skill('crossing') > 5 && p.tendency('inside') > 0.5) {
              y = lerp(y, 34 + (sideY < 34 ? -8 : 8), join * p.tendency('inside'));
              action = 'Offering an inside outlet';
            } else if (join > 0.66 && sameSide) {
              y = lerp(y, sideY < 34 ? 5 : 63, join);
              action = 'Choosing an overlap';
            } else action = 'Supporting from full-back';
            if (x > this.rel(p.x, t) + 8 && join > 0.56) intent = 'run';
          }
          if (
            ((base >= 30 && p.tendency('timing') > 0.68 && p.tendency('advance') > 0.6) ||
              base > 60) &&
            br > 68 &&
            Math.abs(b.y - 34) > 13 &&
            owner?.role !== 'GK'
          ) {
            x = clamp(br + 4 + (p.slot % 3) * 2, 88, 99);
            y = 25 + (p.slot % 3) * 9;
            intent = 'run';
            action = 'Attacking the delivery';
          }
          if (role === 'ST' && br > 84) {
            const attack = p.tendency('timing') * p.tendency('shoot');
            x = lerp(x, Math.max(x, 96), attack);
            y = lerp(y, 34 + (p.slot % 2 ? 4 : -4), attack);
          }
          if (role === 'ST' && br > 70 && Math.abs(b.y - 34) > 13) {
            const aerial = p.tendency('aerial');
            x = lerp(x, Math.max(x, 91), aerial);
            y = lerp(y, 31 + (p.slot % 2) * 6, aerial);
          }
          if (tac.style === 'counter' && this.elapsed - this.possessionStart < 7 && base > 60) {
            x = Math.min(100, Math.max(br, oppLine) - 0.2);
            intent = 'run';
            action = 'Breaking into the channel';
          }
          if (tac.style === 'bus' && base < 60) x -= 6 * this.tuning.gameplay.teamCharacter;
          if (tac.style === 'possession' && base >= 30 && base < 60) {
            x = lerp(x, br - 3, 0.35 * this.tuning.gameplay.teamCharacter);
            y = lerp(y, b.y, 0.18 * this.tuning.gameplay.teamCharacter);
          }
          if (base > 60 && intent !== 'run') x = Math.min(x, Math.max(br, oppLine - 0.5));
          if (base >= 30 && p.tendency('hold') < 0.64) {
            const freedom = p.tendency('roam') * (0.4 + (tac.fluidity - 1) * 0.3);
            y += Math.sin(this.elapsed * 0.24 + p.slot * 1.9) * 3.5 * freedom;
            x += Math.sin(this.elapsed * 0.19 + p.slot) * 1.8 * freedom;
          }
          if (p.comboRun?.until > this.elapsed && owner?.role !== 'GK') {
            x = this.rel(p.comboRun.x, t);
            y = p.comboRun.y;
            intent = 'run';
            action = 'Making a third-man run';
          }
          if (owner && dist(p, b) < 7) {
            y += sideY < 34 ? -5 : 5;
            x -= 3;
          }
          // Move away from markers into a nearby reachable passing pocket.
          if (base >= 30 && base < 60) {
            const mark = enemies.find(q => dist(q, { x: this.abs(x, t), y }) < 3);
            if (mark) y += p.y < mark.y ? -3.8 : 3.8;
          }
          const openRun =
            intent === 'run' && enemies.every(q => dist(q, { x: this.abs(x, t), y }) > 3);
          ({ x, y } = this.supportTarget(p, { x, y }, anchor, openRun));
          if (tac.fluidity < 3 && !openRun && dist(p, { x: this.abs(x, t), y }) > 5) {
            intent = 'reset';
            action = 'Recovering position';
          }
          if (base > 60 && intent !== 'run') x = Math.min(x, Math.max(br, oppLine - 0.5));
          if (role === 'CB' && owner?.role !== 'GK') {
            const outlet = enemies
              .filter(q => this.formation(q)[0] > 60 && this.rel(q.x, t) < 72)
              .sort((a, b) => Math.abs(a.y - p.y) - Math.abs(b.y - p.y))[0];
            if (outlet) {
              const buffer = 1.2 + Math.max(0, outlet.topSpeed() - p.topSpeed()) * 0.8;
              x = Math.min(x, this.rel(outlet.x, t) - buffer);
              action = 'Protecting against the counter';
            }
          }
          p.markId = null;
          p.aim(this.abs(x, t), y, intent, action);
        }
      }
    }
    this.phase = owner
      ? b.kind === 'held'
        ? 'Keeper possession'
        : this.rel(owner.x, owner.team) > 72
          ? 'Final third'
          : this.rel(owner.x, owner.team) < 37
            ? 'Build-up'
            : 'In transition'
      : b.kind === 'shot'
        ? 'Shot on goal'
        : b.kind === 'pass'
          ? 'Moving the ball'
          : 'Ball in dispute';
  }
  move(p, dt, restart = false) {
    if (p.sentOff) return;
    let dx = p.tx - p.x,
      dy = p.ty - p.y;
    for (const q of this.activePlayers) {
      if (q.id === p.id) continue;
      const d = dist(p, q);
      if (d > 0.01 && d < 1.55) {
        const force = (1.55 - d) * (q.team === p.team ? 2 : 0.55);
        dx += ((p.x - q.x) / d) * force;
        dy += ((p.y - q.y) / d) * force;
      }
    }
    const d = Math.hypot(dx, dy),
      carrying = this.ball.owner === p.id && this.ball.kind !== 'held';
    const owner =
      !restart && p.intent === 'press' && this.ball.owner !== null
        ? this.players[this.ball.owner]
        : null;
    const carrier = owner && owner.team !== p.team ? owner : null;
    const goalSide = carrier && this.rel(p.x, p.team) < this.rel(carrier.x, p.team) + 0.4;
    const jockey = goalSide
      ? clamp((10 - dist(p, carrier)) / 4, 0, 1) * clamp(0.75 + p.pressingReading() * 0.35, 0, 1)
      : 0;
    const motion = jockey ? this.carrierMotion(p, carrier) : carrier;
    const urgent =
      [
        'press',
        'cover',
        'recover',
        'receive',
        'intercept',
        'sweep',
        'dribble',
        'track',
        'reset',
      ].includes(p.intent) ||
      (p.intent === 'mark' && (d > 3 || Math.hypot(p.vx, p.vy) > p.topSpeed() * 0.55)) ||
      (p.intent === 'run' && d > 5) ||
      (carrying && d > 4 && p.tendency('advance') > 0.48);
    if (p.sprint < 0.08) p.sprintRest = Math.max(p.sprintRest, 1.8);
    p.sprintRest = Math.max(0, p.sprintRest - dt);
    const trackingRun = jockey > 0 && Math.hypot(carrier.vx, carrier.vy) > p.topSpeed() * 0.65;
    const sprint = urgent && p.sprint > 0.16 && p.sprintRest === 0 && (d > 2 || trackingRun);
    let max =
      p.topSpeed(carrying) *
      (restart
        ? 0.6
        : sprint
          ? 0.84 + 0.16 * clamp(p.sprint / 0.45, 0, 1)
          : p.intent === 'hold'
            ? 0.25
            : 0.7);
    if (p.stun > 0) max *= 0.2;
    const mark =
      !restart && ['mark', 'track'].includes(p.intent) && p.markId != null
        ? this.players[p.markId]
        : null;
    // A moving mark is not a stationary arrival point. Match their velocity
    // before braking, otherwise the defender trails just behind the runner.
    const targetSpeed = Math.min(max, d * 2.1),
      followX =
        (mark?.vx || 0) + (motion?.vx || 0) * jockey + (d > 0.02 ? (dx / d) * targetSpeed : 0),
      followY =
        (mark?.vy || 0) + (motion?.vy || 0) * jockey + (d > 0.02 ? (dy / d) * targetSpeed : 0);
    const followScale = Math.min(1, max / (Math.hypot(followX, followY) || 1)),
      vx = followX * followScale,
      vy = followY * followScale;
    const accel = p.acceleration() * (0.72 + p.energy * 0.28) * dt,
      dv = Math.hypot(vx - p.vx, vy - p.vy),
      weight = Math.min(1, accel / (dv || 1));
    p.vx += (vx - p.vx) * weight;
    p.vy += (vy - p.vy) * weight;
    const speed = Math.hypot(p.vx, p.vy);
    p.stats.distance += speed * dt;
    p.x = clamp(p.x + p.vx * dt, 0.5, 104.5);
    p.y = clamp(p.y + p.vy * dt, 0.5, 67.5);
    if (speed > 0.3) p.facing = Math.atan2(p.vy, p.vx);
    const effort = speed / p.baseSpeed(),
      stamina = p.skill('stamina') / 100;
    const burst = sprint && effort > 0.72 && !restart;
    p.sprint = clamp(
      p.sprint +
        dt *
          (burst
            ? -this.tuning.stamina.sprintDrain / (3.1 + stamina * 4.5)
            : this.tuning.stamina.sprintRecovery *
              (0.065 + stamina * 0.065) *
              Math.max(0.2, 1 - effort)),
      0,
      1,
    );
    // Work is normalized by match fraction; sprint reserve remains in real seconds.
    const relativeEffort = effort / (0.72 + p.energy * 0.28);
    const workload =
      0.55 +
      relativeEffort * relativeEffort * 1.05 +
      (burst ? 0.32 : 0) +
      Math.min(dv / dt, 12) * 0.005;
    const lowReserve = p.energy < 0.18 ? 0.35 + (0.65 * p.energy) / 0.18 : 1;
    const drain =
      (dt / this.duration) *
      workload *
      (1.12 - stamina * 0.33) *
      (p.has('engine') ? 0.96 : 1) *
      (restart ? 0.65 : 1) *
      (this.half === 2 ? 1.1 : 1);
    p.energy = clamp(p.energy - drain * lowReserve * this.tuning.stamina.drain, 0.001, 1);
    p.cooldown = Math.max(0, p.cooldown - dt);
    p.stun = Math.max(0, p.stun - dt);
    p.feintCooldown = Math.max(0, p.feintCooldown - dt);
    if (p.animation && this.elapsed - p.animation.start > p.animation.duration) p.animation = null;
  }
  challengeModel(p, q) {
    const bearing =
      ((q.x - p.x) * Math.cos(p.facing) + (q.y - p.y) * Math.sin(p.facing)) / (dist(p, q) || 1);
    const closing = Math.hypot(q.vx - p.vx, q.vy - p.vy),
      behind = Math.max(0, -bearing),
      reach = dist(q, this.ball);
    const fatigue = 1 - q.energy,
      aggression = q.tendency('aggression'),
      discipline = q.tendency('discipline');
    const caution = offenceInBox(this, q, p) ? 0.75 : 1;
    const foul = clamp(
      (0.009 +
        behind * 0.052 +
        (closing / 9) ** 2 * 0.04 +
        (reach > 1.1 ? 0.022 : 0) +
        (1 - discipline) * 0.044 +
        (100 - q.tackling()) * 0.00035 +
        fatigue * 0.035) *
        (0.7 + aggression * 0.65) *
        caution,
      0.007,
      0.34,
    );
    const protection =
      p.skill('dribbling') * 0.65 +
      p.skill('control') * 0.2 +
      p.skill('strength') * 0.15 +
      (p.has('control') ? 4 : 0);
    const shielding =
      clamp((p.skill('control') + p.skill('composure') - 140) / 70, 0, 0.55) *
      (0.75 + p.energy * 0.25);
    const win = clamp(
      sigmoid(
        (q.tackling() - protection) / 26 +
          bearing * 0.55 -
          0.55 +
          (q.skill('strength') - p.skill('strength')) * 0.004 +
          (q.energy - p.energy) * 0.7,
      ) *
        (1 - shielding * 0.45),
      0.04,
      0.84,
    );
    const cautionFactor = q.yellowCards === 1 ? this.tuning.discipline.bookedFoulRisk : 1;
    return {
      foul: clamp(foul * this.tuning.gameplay.foulFrequency * cautionFactor, 0, 0.8),
      win: clamp(win * this.tuning.gameplay.tackleSuccess, 0.01, 0.99),
      hard: closing > 4,
      bearing,
      closing,
    };
  }
  issueCard(p, card, reason = 'Reckless challenge') {
    if (p.sentOff) return false;
    if (card === 'yellow') {
      p.yellowCards++;
      p.stats.yellowCards++;
      this.stats[p.team].yellowCards++;
    }
    const secondYellow = card === 'yellow' && p.yellowCards === 2,
      red = card === 'red' || secondYellow;
    this.addEvent(
      `${p.name} · ${red ? (secondYellow ? 'second yellow, sent off' : 'red card') : 'yellow card'}`,
      p.team,
      red ? 'red' : 'yellow',
      { playerId: p.id, secondYellow, reason },
    );
    this.effect('whistle', p, 1, {
      label: red ? 'RED CARD' : 'YELLOW CARD',
      strength: red ? 0.8 : 0.4,
    });
    if (!red) return true;
    p.sentOff = true;
    p.dismissedRole = p.role;
    p.stats.redCards++;
    this.stats[p.team].redCards++;
    p.vx = p.vy = 0;
    p.action = 'Sent off';
    p.animation = null;
    p.trail = [];
    this.rebuildActive();
    if (!this.keeper(p.team)) {
      const standIn = this.activePlayers
        .filter(q => q.team === p.team)
        .sort(
          (a, b) =>
            b.skill('goalkeeping') - a.skill('goalkeeping') ||
            b.skill('heading') - a.skill('heading'),
        )[0];
      if (standIn) {
        standIn.emergencyKeeper = true;
        standIn.role = 'GK';
        standIn.action = 'Taking over in goal';
      }
    }
    if (this.ball.owner === p.id) {
      this.ball.owner = null;
      this.ball.kind = 'loose';
      this.ball.vx = this.ball.vy = 0;
    }
    if (this.ball.target === p.id) {
      this.ball.target = null;
      this.ball.missedReceiver = true;
    }
    if (this.pendingTackle?.id === p.id) this.pendingTackle = null;
    for (const q of this.activePlayers) {
      q.rethinkAt = 0;
      q.markId = null;
    }
    this.presser = [null, null];
    this.planTimer = 0;
    if (this.activePlayers.filter(q => q.team === p.team).length < 7) {
      this.abandonedTeam = p.team;
      this.finished = true;
      this.mode = 'fulltime';
      this.phase = 'Match abandoned';
      this.addEvent(
        `${this.teams[p.team].name} have fewer than seven players. Match abandoned.`,
        p.team,
        'full',
      );
    }
    return true;
  }
  awardFoul(offender, victim, point = { x: victim.x, y: victim.y }) {
    const penalty = offenceInBox(this, offender, point),
      team = victim.team;
    const risk = cardRisk(this, offender, victim, this.challengeModel(victim, offender), penalty);
    offender.stats.fouls++;
    victim.stats.foulsWon++;
    this.stats[offender.team].fouls++;
    this.stats[team].foulsWon++;
    if (penalty) this.stats[team].penalties++;
    this.addEvent(
      `${offender.name.split(' ').pop()} fouls ${victim.name.split(' ').pop()}${penalty ? ' · penalty awarded' : ''}.`,
      team,
      penalty ? 'penalty' : 'foul',
      { playerId: victim.id, offenderId: offender.id, origin: { ...point } },
    );
    this.effect('whistle', { ...point, team }, penalty ? 1.4 : 0.85, {
      label: penalty ? 'PENALTY' : 'FOUL',
      strength: penalty ? 0.8 : 0.3,
    });
    if (this.rand() < risk.red)
      this.issueCard(
        offender,
        'red',
        risk.dogso ? 'Denied a clear goal chance' : 'Excessive force',
      );
    else if (this.rand() < risk.yellow)
      this.issueCard(
        offender,
        'yellow',
        risk.dogso ? 'Denied a goal chance while challenging for the ball' : 'Reckless challenge',
      );
    if (this.finished) return;
    this.startRestart(
      penalty ? 'Penalty' : 'Free kick',
      team,
      penalty ? this.abs(94, team) : point.x,
      penalty ? 34 : point.y,
      penalty ? 1.7 : 0.85,
    );
  }
  duel(p, q) {
    if (p.sentOff || q.sentOff) return false;
    const b = this.ball;
    if (
      b.kind === 'held' ||
      q.cooldown > 0 ||
      q.stun > 0 ||
      (dist(q, b) > 1.15 + q.skill('defending') * 0.006 + (q.has('ballwinner') ? 0.12 : 0) &&
        dist(q, p) > 0.85)
    )
      return false;
    const press = this.teams[q.team].tactics.press,
      model = this.challengeModel(p, q);
    if (
      q.yellowCards === 1 &&
      (model.bearing < -0.1 || model.closing > 6) &&
      this.rand() < this.tuning.discipline.bookedRiskAversion
    ) {
      q.cooldown = 0.35 + q.tendency('discipline') * 0.25;
      q.action = 'Staying on feet after booking';
      return false;
    }
    q.cooldown =
      0.55 + (5 - press) * 0.11 + (1 - q.tendency('aggression')) * 0.25 + this.rand() * 0.2;
    if (q.yellowCards === 1) q.cooldown *= 1.35;
    q.animation = {
      type: 'tackle',
      start: this.elapsed,
      duration: 0.38,
      angle: Math.atan2(b.y - q.y, b.x - q.x),
      hard: model.hard,
    };
    this.duelHistory.push({
      at: this.elapsed,
      team: q.team,
      foulChance: model.foul,
      winChance: model.win,
      box: offenceInBox(this, q, p),
    });
    if (this.rand() < model.foul) {
      this.awardFoul(q, p);
      return true;
    }
    if (this.rand() < model.win) {
      this.pendingTackle = {
        id: q.id,
        team: q.team,
        at: this.elapsed,
        hard: model.hard,
        chance: model.win * (1 - model.foul),
        strength: clamp(model.closing / 10, 0.2, 1),
      };
      p.stats.turnovers++;
      p.cooldown = 0.5;
      p.stun = 0.28;
      p.animation = { type: 'stumble', start: this.elapsed, duration: 0.4 };
      b.owner = null;
      b.kind = 'loose';
      b.target = null;
      b.kicker = p.id;
      b.age = 0;
      b.lastTouch = q.team;
      b.offsideState = null;
      const escape = this.carryTarget(q),
        angle = Math.atan2(escape.y - q.y, escape.x - q.x);
      b.vx = Math.cos(angle) * (1.3 + this.rand() * 1.5);
      b.vy = Math.sin(angle) * (1.3 + this.rand() * 1.5);
      b.vz = model.hard ? 1.1 : 0.3;
      q.action = 'Collecting the tackle';
      q.cooldown = 0.1;
      this.planTimer = 0;
      return true;
    }
    return false;
  }
  periodDeadline() {
    return (
      this.periodStart + this.duration / 2 + (this.addedMinutes[this.half - 1] * this.duration) / 90
    );
  }
  expectedDuration() {
    return this.duration * (1 + this.addedMinutes.reduce((a, b) => a + b, 0) / 90);
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
    } else {
      this.finished = true;
      this.mode = 'fulltime';
      this.phase = 'Full time';
      for (const p of this.activePlayers) p.vx = p.vy = 0;
      this.addEvent('Full-time. The final whistle.', null, 'full');
    }
  }
  resumeHalf() {
    if (this.mode !== 'halftime') return false;
    this.half = 2;
    this.periodStart = this.elapsed;
    this.time = 2700;
    const team = 1 - this.kickoffTeam;
    for (const p of this.activePlayers) {
      p.runs = 0;
      p.comboRun = null;
      p.finishUntil = 0;
      p.finishTarget = null;
      p.beatChain = [];
      p.penaltyDive = null;
      p.receivedAt = -10;
      p.possessionAt = -10;
      p.lastReceipt = null;
      p.goalKickExempt = false;
      p.markId = null;
      p.markUntil = 0;
      p.animation = null;
      p.stun = 0;
      p.feintCooldown = 0;
      p.feintTarget = null;
      p.cooldown = 0;
      p.controlUntil = 0;
      p.controlErrorAt = -10;
      p.rethinkAt = 0;
      p.hold = 0;
      p.think = 0;
      p.touch = 0;
      p.displayedAction = null;
      p.pendingAction = null;
    }
    this.pendingTackle = null;
    this.keeperRelease = null;
    this.lastPass = null;
    this.presser = [null, null];
    this.ballTrail = [];
    if (this.competition?.mode === 'ai') coachAI(this, true);
    this.positionKickoff(team);
    this.startRestart('Second half', team, 52.5, 34, 1.25);
    return true;
  }
  step(dt) {
    if (this.finished) return;
    if (this.mode === 'halftime') {
      if (!this.pauseAtHalf) this.resumeHalf();
      return;
    }
    if (this.competition?.mode === 'ai' && this.elapsed >= this.nextAI) {
      coachAI(this);
      this.nextAI = this.elapsed + this.tuning.ai.coachInterval;
    }
    dt = Math.min(dt, 0.05);
    this.elapsed += dt;
    this.time = (this.half - 1) * 2700 + ((this.elapsed - this.periodStart) / this.duration) * 5400;
    this.effects = this.effects.filter(e => (e.life -= dt) > 0);
    if (
      this.elapsed - this.periodStart >= this.duration / 2 &&
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
        ['shot', 'loose'].includes(this.ball.kind) &&
        Math.hypot(this.ball.vx, this.ball.vy) > 0.5);
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
    if (b.owner !== null) {
      const p = this.players[b.owner];
      p.hold += dt;
      p.think -= dt;
      p.touch += dt;
      if (p.think <= 0) {
        if (b.kind !== 'held')
          for (const q of this.activePlayers) if (q.team !== p.team && this.duel(p, q)) break;
        if (b.owner === p.id && this.mode === 'play') this.decide(p);
      }
      if (b.owner !== null) {
        const held = b.kind === 'held';
        const gait = Math.sin(p.touch * (6 + p.skill('dribbling') * 0.055));
        const firstTouch = clamp((this.elapsed - p.receivedAt) / 0.6, 0, 1),
          protection = this.pressure(p);
        const lead = held
          ? 0.36
          : (((p.has('control') ? 0.3 : 0.42) +
              (1 - p.skill('dribbling') / 100) * 0.6 +
              (0.08 + Math.hypot(p.vx, p.vy) * 0.025) * (gait + 1)) *
              (0.62 + firstTouch * 0.38)) /
            (1 + protection * 0.1 + p.skill('strength') * 0.001);
        let angle = p.facing;
        if (p.animation?.type === 'feint')
          angle +=
            Math.sin(((this.elapsed - p.animation.start) / p.animation.duration) * Math.PI * 2) *
            0.65 *
            p.animation.side;
        b.previous = null;
        b.x = p.x + Math.cos(angle) * lead;
        b.y = p.y + Math.sin(angle) * lead;
        b.vx = p.vx;
        b.vy = p.vy;
        b.z = held ? 0.8 : 0.05;
        b.lastTouch = p.team;
        if (!held) {
          for (const q of this.activePlayers) if (q.team !== p.team && this.duel(p, q)) break;
          if (
            b.owner !== null &&
            Math.hypot(p.vx, p.vy) > 4 &&
            this.rand() <
              ((dt * 0.07 * this.tuning.gameplay.dribbleLoss * (100 - p.skill('dribbling'))) / 70) *
                skillError(
                  p.skill('control') * 0.65 + p.skill('dribbling') * 0.35,
                  this.tuning.gameplay.controlQuality,
                ) *
                (1 + this.executionPressure(p) * 0.35 + (1 - p.energy))
          ) {
            b.owner = null;
            b.kind = 'loose';
            b.kicker = p.id;
            b.target = null;
            b.age = 0;
            b.vx = p.vx * 1.4;
            b.vy = p.vy * 1.4;
            p.cooldown = 0.25;
            p.controlUntil = this.elapsed + 0.16;
            p.controlErrorAt = this.elapsed;
            p.action = 'Heavy touch';
            p.stats.miscontrols++;
            this.stats[p.team].miscontrols++;
            p.stats.turnovers++;
            this.planTimer = 0;
          }
        }
      }
    } else this.moveBall(dt);
    if (this.mode === 'play') this.checkBounds();
  }
  moveBall(dt) {
    const b = this.ball,
      prev = { x: b.x, y: b.y };
    b.previous = { x: b.x, y: b.y, z: b.z };
    if (b.kind === 'shot') {
      b.vy += (b.curve || 0) * dt;
      if (b.shotType === 'Knuckleball') b.vy += Math.sin(b.age * 23) * 7 * dt;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z = Math.max(0, b.z + b.vz * dt);
    b.vz -= 9.81 * dt;
    if (b.z === 0) {
      b.vz = Math.abs(b.vz) > 0.9 ? -b.vz * 0.3 : 0;
      const speed = Math.hypot(b.vx, b.vy),
        drag = Math.max(0, 1 - ((b.kind === 'pass' ? b.roll || 3.8 : 2) * dt) / (speed || 1));
      b.vx *= drag;
      b.vy *= drag;
    }
    if (
      b.kind === 'pass' &&
      b.destination &&
      ((b.x - b.destination.x) * b.vx + (b.y - b.destination.y) * b.vy > 0 ||
        Math.hypot(b.vx, b.vy) < 5)
    ) {
      b.missedReceiver = true;
      this.planTimer = 0;
    }
    const flightTeam =
      b.shotTeam ??
      b.shotRecord?.team ??
      this.players[b.goalCredit?.shooter ?? b.kicker]?.team ??
      b.lastTouch;
    const incomingGoal =
      b.kind === 'shot' || (this.rel(b.x, flightTeam) > 77 && this.projectedOnTarget());
    const candidates = this.activePlayers
      .filter(p => this.canCollect(p))
      .map(p => ({ p, ...segment(p, prev, b) }))
      .filter(
        o =>
          o.d <
          (this.canHandle(o.p) && incomingGoal
            ? 1.3 + o.p.skill('goalkeeping') * 0.011
            : this.collectionReach(o.p)),
      )
      .sort((a, c) => a.t - c.t || a.d - c.d);
    if (b.kind === 'shot' && b.offsideState) {
      const g = this.keeper(1 - b.shotTeam);
      for (const id of b.offsideState.candidates) {
        const p = this.players[id],
          screen = segment(p, b, g);
        if (
          dist(p, g) < 2 &&
          screen.t > 0.05 &&
          screen.t < 0.98 &&
          screen.d < 0.65 &&
          this.checkOffside(p)
        )
          return;
      }
    }
    for (const c of candidates) {
      const p = c.p;
      if (b.z > (this.canHandle(p) && incomingGoal ? 2.7 : 1.6 + p.skill('heading') * 0.007))
        continue;
      if (this.checkOffside(p)) return;
      if (this.checkRestartTouch(p)) return;
      if (this.canHandle(p) && incomingGoal && p.team !== flightTeam) {
        if (b.saver === p.id) continue;
        b.saver = p.id;
        const speed = Math.hypot(b.vx, b.vy),
          lateral = Math.abs((p.x - b.x) * b.vy - (p.y - b.y) * b.vx) / (speed || 1),
          onTarget = this.projectedOnTarget();
        const prob = clamp(
          0.34 +
            p.skill('goalkeeping') * 0.0063 -
            lateral * 0.14 -
            Math.max(0, speed - 25) * 0.016 +
            this.profile.saveBoost +
            (b.penaltyKick ? -0.08 - this.profile.saveBoost : 0) +
            (b.shotRecord ? 0 : 0.18 + Math.max(0, 24 - speed) * 0.015) +
            (p.has('gkoneonone') && b.shotOrigin && dist(p, b.shotOrigin) < 16 ? 0.035 : 0),
          0.04,
          b.shotRecord ? 0.95 : 0.995,
        );
        p.action = 'Diving';
        p.animation = {
          type: 'dive',
          start: this.elapsed,
          duration: 0.6,
          angle: Math.atan2(b.y - p.y, b.x - p.x),
        };
        const effectiveSave = clamp(prob * this.tuning.gameplay.saveAbility, 0.01, 0.995);
        if (this.rand() < effectiveSave) {
          this.resolveShot(onTarget ? 'saved' : 'off target');
          if (onTarget && b.shotRecord) {
            this.stats[p.team].saves++;
            p.stats.saves++;
            this.addEvent(`${p.name.split(' ').pop()} makes the save.`, p.team, 'save', {
              playerId: p.id,
              chance: effectiveSave,
              chanceLabel: 'save',
              strength: clamp(speed / 38, 0, 1),
            });
          }
          b.penaltyTaker = null;
          b.restartTaker = null;
          b.indirect = null;
          if (
            this.rand() <
            0.48 + p.skill('goalkeeping') * 0.003 + (p.has('safehands') ? 0.1 : 0)
          ) {
            this.own(p, true);
            p.hold = 0;
            if (onTarget) this.flair('catch', p, 0.55, { label: 'SAVED', strength: 0.35 });
          } else {
            if (onTarget) this.flair('parry', p, 0.7, { label: 'PARRIED', strength: 0.65 });
            b.vx *= -0.2;
            b.vy = (b.y > p.y ? 1 : -1) * (4 + this.rand() * 6);
            b.vz = 2;
            b.kind = 'loose';
            b.lastTouch = p.team;
            b.kicker = p.id;
            b.age = 0;
            p.cooldown = 0.6;
          }
          return;
        }
        continue;
      }
      if (b.z > 1.6 + p.skill('heading') * 0.007) continue;
      if (b.kind === 'shot') {
        if (p.team === b.shotTeam) continue;
        if (this.rand() < 0.35 + p.skill('defending') * 0.003) {
          this.resolveShot('blocked');
          b.vx *= -0.22;
          b.vy += this.noise() * 6;
          b.vz = 1.5;
          b.kind = 'loose';
          b.lastTouch = p.team;
          b.kicker = p.id;
          b.age = 0;
          b.indirect = null;
          b.penaltyTaker = null;
          b.restartTaker = null;
          b.penaltyKick = false;
          p.cooldown = 0.3;
          p.stats.blocks++;
          this.addEvent(`${p.name.split(' ').pop()} blocks the shot.`, p.team, 'block', {
            playerId: p.id,
            strength: 0.4,
          });
          return;
        }
        p.cooldown = 0.2;
        continue;
      }
      const height = b.z,
        speed = Math.hypot(b.vx, b.vy),
        teammate = b.kind === 'pass' && b.kicker !== null && this.players[b.kicker].team === p.team;
      if (!teammate && b.kind === 'pass' && p.role !== 'GK') {
        const facing = (Math.cos(p.facing) * -b.vx + Math.sin(p.facing) * -b.vy) / (speed || 1);
        const disguise =
          (1 - clamp(((b.passCraft ?? 60) - 60) * 0.0085, 0, 0.34)) *
          (1 -
            clamp(((b.passCraft ?? 60) - p.pressAwareness()) / 30, 0, 1) *
              0.2 *
              this.tuning.gameplay.passingQuality);
        const read = clamp(
          (0.53 +
            p.pressAwareness() * 0.0042 +
            p.pressingReading() * 0.05 -
            Math.max(0, speed - 17) * 0.008 +
            facing * 0.035 +
            (p.has('interceptor') ? 0.08 : 0)) *
            this.profile.readWindow *
            disguise,
          0.28,
          0.96,
        );
        if (this.rand() > read) {
          p.cooldown = 0.15;
          continue;
        }
      }
      // Measure sideways reach from the flight line. Distance to this frame's
      // short segment wrongly labels a centered, approaching pass a stretch.
      const touchOffset =
        speed > 1 ? Math.abs((p.x - prev.x) * b.vy - (p.y - prev.y) * b.vx) / speed : c.d;
      const pressure = this.pressure(p),
        baseControl = this.firstTouchChance(
          p,
          height,
          speed,
          this.executionPressure(p),
          teammate,
          touchOffset,
        );
      // Closing pressure can win a duel; it should not make a ball already at
      // the feet invisible to its nearest player.
      const settled = (b.kind === 'loose' || b.missedReceiver) && height < 0.3 && speed < 3.2;
      const control = settled ? 1 - (1 - baseControl) * 0.12 : baseControl;
      if (this.rand() < control) {
        if (teammate && height > 1.15 && this.contestAerial(p)) return;
        const aerial =
          teammate &&
          height > 0.45 &&
          this.inBox(p) &&
          this.rand() < (0.25 + p.tendency('shoot') * 0.6) * (height > 1.15 ? 0.9 : 1);
        if (!teammate && b.kind === 'pass')
          this.addEvent(`${p.name.split(' ').pop()} intercepts.`, p.team, 'intercept', {
            playerId: p.id,
          });
        const recoveringBackpass =
          b.pendingPass &&
          this.players[b.pendingPass.from]?.team === p.team &&
          b.lastTouch === p.team;
        const handling = this.canHandle(p) && !teammate && !recoveringBackpass;
        if (this.own(p, handling) && aerial) this.shoot(p, { aerialHeight: height });
        return;
      }
      p.stats.miscontrols++;
      this.stats[p.team].miscontrols++;
      if (teammate && b.kicker !== null)
        b.pendingPass = { from: b.kicker, delivery: b.delivery, chance: b.chance };
      b.vx *= 0.4;
      b.vy *= 0.4;
      b.kind = 'loose';
      b.lastTouch = p.team;
      b.target = null;
      b.indirect = null;
      b.penaltyTaker = null;
      b.offsideState = teammate
        ? offsideSnapshot(this, p)
        : speed < 15 && height < 1 && pressure < 0.4 && p.skill('control') > 65
          ? null
          : b.offsideState;
      b.restartTaker = null;
      // Recovering balance after a poor reception takes longer under pressure;
      // players keep chasing, and better control shortens the recovery.
      p.cooldown = teammate
        ? 0.32 + clamp((100 - p.skill('control')) * 0.006, 0, 0.3) + Math.min(pressure, 0.8) * 0.12
        : 0.2;
      p.controlErrorAt = this.elapsed;
      p.controlUntil = this.elapsed + p.cooldown;
      if (teammate) {
        p.action = 'Miscontrolled first touch';
        p.animation = {
          type: 'stumble',
          start: this.elapsed,
          duration: Math.min(0.35, p.cooldown),
        };
      }
      this.planTimer = 0;
      // The touch changed the flight. Recompute nearby candidates next frame
      // instead of awarding another contact along the old trajectory.
      return;
    }
  }
  checkBounds() {
    const b = this.ball;
    if (b.x < 0 || b.x > W) {
      const right = b.x > W;
      let crossY = b.y,
        crossZ = b.z;
      if (b.previous && b.previous.x >= 0 && b.previous.x <= W) {
        const f = ((right ? W : 0) - b.previous.x) / (b.x - b.previous.x || 1);
        crossY = lerp(b.previous.y, b.y, f);
        crossZ = lerp(b.previous.z, b.z, f);
      }
      const frameHit =
        (Math.abs(Math.abs(crossY - 34) - GOAL / 2) < 0.16 && crossZ < 2.6) ||
        (Math.abs(crossZ - 2.44) < 0.13 && Math.abs(crossY - 34) < GOAL / 2 + 0.1);
      if (frameHit && b.kind === 'shot') {
        this.resolveShot('post');
        b.x = right ? 104.8 : 0.2;
        b.y = crossY;
        b.z = crossZ;
        b.vx *= -0.55;
        b.vy += this.noise() * 2;
        b.kind = 'loose';
        b.previous = null;
        this.addEvent('Off the woodwork!', b.shotTeam, 'post', { strength: 0.8 });
        return;
      }
      if (Math.abs(crossY - 34) < GOAL / 2 && crossZ < 2.44) {
        const team = this.direction(0) === (right ? 1 : -1) ? 0 : 1;
        if (b.indirect !== null && b.indirect !== undefined) {
          const own = this.players[b.indirect].team !== team;
          this.startRestart(
            own ? 'Corner' : 'Goal kick',
            own ? team : 1 - team,
            right ? (own ? 104.7 : 99.5) : own ? 0.3 : 5.5,
            own ? (crossY < 34 ? 0.3 : 67.7) : 34,
          );
          return;
        }
        this.resolveShot(this.ball.shotRecord?.team === team ? 'goal' : 'off target');
        this.score[team]++;
        const scorer = this.players[b.goalCredit?.shooter ?? b.owner ?? b.kicker],
          ownGoal = scorer && scorer.team !== team,
          assist =
            !ownGoal && b.goalCredit?.assist != null ? this.players[b.goalCredit.assist] : null,
          origin =
            b.goalCredit?.origin ||
            b.shotOrigin ||
            b.deliveryOrigin ||
            (scorer
              ? this.origin(scorer)
              : {
                  x: b.x,
                  y: b.y,
                  attackX: this.rel(b.x, team),
                  box: false,
                  zone: goalZone(this.rel(b.x, team), b.y),
                });
        if (ownGoal) {
          origin.attackX = this.rel(origin.x, team);
          origin.box = origin.attackX >= 88.5 && Math.abs(origin.y - 34) <= 20.16;
          origin.zone = goalZone(origin.attackX, origin.y);
        }
        if (scorer && !ownGoal) {
          scorer.stats.goals++;
          if (!b.shotRecord) {
            this.stats[team].shots++;
            this.stats[team].onTarget++;
            scorer.stats.shots++;
            scorer.stats.onTarget++;
            if (origin.box) this.stats[team].boxShots++;
          }
        }
        if (assist) {
          assist.stats.assists++;
          this.stats[team].assistedGoals++;
        }
        if (origin.box) this.stats[team].boxGoals++;
        if (Math.abs(origin.y - 34) <= 9.16) this.stats[team].centralGoals++;
        else this.stats[team].wideGoals++;
        const event = this.addEvent(
          `${scorer && !ownGoal ? scorer.name.split(' ').pop() : this.teams[team].name} scores${ownGoal ? ' · own goal' : ''}${assist ? ' · ' + assist.name.split(' ').pop() + ' assist' : ''}!`,
          team,
          'goal',
          {
            playerId: ownGoal ? null : scorer?.id,
            assistId: assist?.id,
            strength: 1,
            box: !!origin.box,
            zone: origin.zone || goalZone(origin.attackX ?? this.rel(origin.x, team), origin.y),
            shotType:
              b.goalCredit?.shotType ||
              b.shotType ||
              (b.kind === 'pass'
                ? b.delivery === 'cross'
                  ? 'Cross into goal'
                  : 'Pass into goal'
                : 'Finish'),
            origin,
            ownGoal: !!ownGoal,
          },
        );
        this.goalHistory.push(event);
        this.effect('goal', { x: right ? 104 : 1, y: 34, team }, 2.5, {
          label: 'GOAL',
          strength: 1,
          scorer: scorer?.name,
          assist: assist?.name,
        });
        this.startRestart('Goal', 1 - team, 52.5, 34, 2.5);
        return;
      }
      this.resolveShot('off target');
      const defending = this.direction(0) === (right ? -1 : 1) ? 0 : 1;
      if (b.lastTouch === defending)
        this.startRestart('Corner', 1 - defending, right ? 104.7 : 0.3, b.y < 34 ? 0.3 : 67.7);
      else this.startRestart('Goal kick', defending, right ? 99.5 : 5.5, 34);
      return;
    }
    if (b.y < 0 || b.y > H) {
      this.resolveShot('off target');
      this.startRestart('Throw-in', 1 - b.lastTouch, clamp(b.x, 1, 104), b.y < 0 ? 0.2 : 67.8);
    }
  }
  startRestart(type, team, x, y, timer) {
    timer ??=
      type === 'Goal kick' ? 1.7 : type === 'Corner' ? 2.1 : type === 'Throw-in' ? 1.15 : 1.2;
    if (!['Goal', 'Second half', 'Kickoff'].includes(type))
      timer *= this.tuning.gameplay.restartSetup;
    this.mode = 'restart';
    this.phase = type;
    const b = this.ball;
    b.owner = null;
    b.pendingPass = null;
    b.missedReceiver = false;
    b.previous = null;
    b.vx = b.vy = b.vz = b.z = 0;
    b.x = x;
    b.y = y;
    b.kind = 'loose';
    b.lastTouch = team;
    b.target = null;
    b.kicker = null;
    b.offside = false;
    b.offsideState = null;
    b.assist = null;
    b.goalCredit = null;
    b.deliveryOrigin = null;
    b.shotOrigin = null;
    b.shotType = null;
    b.shotRecord = null;
    b.penaltyKick = false;
    b.indirect = null;
    b.penaltyTaker = null;
    b.restartTaker = null;
    this.lastPass = null;
    this.pendingTackle = null;
    let taker;
    if (['Goal', 'Second half', 'Kickoff'].includes(type)) taker = this.kickoffTaker(team);
    else if (type === 'Goal kick') taker = this.keeper(team);
    else if (type === 'Penalty')
      taker = this.activePlayers
        .filter(p => p.team === team && p.role !== 'GK')
        .sort(
          (a, c) =>
            c.skill('penalties') +
            c.skill('composure') * 0.6 -
            (a.skill('penalties') + a.skill('composure') * 0.6),
        )[0];
    else
      taker = this.activePlayers
        .filter(p => p.team === team && p.role !== 'GK')
        .sort((a, c) => dist(a, b) - dist(c, b))[0];
    this.restart = { type, team, x, y, timer, taker: taker.id };
    if (!['Goal', 'Second half', 'Penalty', 'Free kick', 'Offside'].includes(type))
      this.addEvent(`${type} · ${this.teams[team].name}`, team, 'restart');
    this.planTimer = 0;
    for (const p of this.activePlayers) {
      p.rethinkAt = 0;
      p.markId = null;
      p.markUntil = 0;
    }
    this.plan();
    const wall =
      type === 'Free kick'
        ? this.activePlayers
            .filter(p => p.team !== team && p.role !== 'GK')
            .sort((a, b) => dist(a, this.ball) - dist(b, this.ball))
            .slice(0, 3)
        : [];
    const cornerAttack =
      type === 'Corner'
        ? this.activePlayers
            .filter(p => p.team === team && p.role !== 'GK' && p.id !== taker.id)
            .sort(
              (a, c) =>
                c.skill('heading') * 0.6 +
                c.skill('strength') * 0.25 +
                c.skill('shooting') * 0.15 -
                (a.skill('heading') * 0.6 +
                  a.skill('strength') * 0.25 +
                  a.skill('shooting') * 0.15),
            )
            .slice(0, 5)
        : [];
    for (const p of this.activePlayers) {
      p.cooldown = 0;
      p.stun = 0;
      p.animation = null;
      p.action = 'Taking position';
      if (['Goal', 'Second half', 'Kickoff'].includes(type)) {
        const [base, by] = this.formation(p);
        p.tx = this.abs(Math.min(base * 0.67, 49), p.team);
        p.ty = this.direction(p.team) > 0 ? by : H - by;
      }
      if (type === 'Goal kick' && p.id !== taker.id && p.role !== 'GK') {
        const [base, by] = this.formation(p),
          own = p.team === team;
        p.tx = this.abs(
          own ? (base < 30 ? 18 : base < 58 ? 37 : 62) : base < 30 ? 36 : base < 58 ? 54 : 77,
          p.team,
        );
        p.ty = this.direction(p.team) > 0 ? by : H - by;
      }
      if (type === 'Corner' && p.role !== 'GK' && p.id !== taker.id) {
        if (p.team !== team || cornerAttack.includes(p)) {
          p.tx = this.abs(team === p.team ? 89 + this.rand() * 10 : 9 + this.rand() * 8, p.team);
          p.ty = 18 + this.rand() * 32;
        } else {
          p.tx = this.abs(55 + (p.slot % 2) * 12, p.team);
          p.ty = 20 + (p.slot % 3) * 14;
        }
      }
      if (type === 'Penalty') {
        if (p.team !== team && p.role === 'GK') {
          p.tx = this.abs(105, team);
          p.ty = 34;
        } else if (p.id !== taker.id) {
          p.tx = this.abs(82 - (p.slot % 3) * 2, team);
          p.ty = 18 + (p.slot % 6) * 7;
        }
      } else if (p.team !== team && dist(p, b) < 9.15) {
        const angle = Math.atan2(p.y - y, p.x - x);
        p.tx = clamp(x + Math.cos(angle) * 9.4, 1, 104);
        p.ty = clamp(y + Math.sin(angle) * 9.4, 1, 67);
      }
      const wallIndex = wall.indexOf(p);
      if (wallIndex >= 0) {
        const angle = Math.atan2(34 - y, this.abs(105, team) - x);
        p.tx = x + Math.cos(angle) * 9.3 - Math.sin(angle) * (wallIndex - 1);
        p.ty = y + Math.sin(angle) * 9.3 + Math.cos(angle) * (wallIndex - 1);
      }
    }
    taker.tx = x - this.direction(team) * 0.6;
    taker.ty = clamp(y, 1, 67);
  }
  stepRestart(dt) {
    const r = this.restart;
    r.timer -= dt;
    for (const p of this.activePlayers) this.move(p, dt, true);
    if (r.timer > 0) return;
    const taker = this.players[r.taker],
      kickoff = ['Goal', 'Second half', 'Kickoff'].includes(r.type);
    if (kickoff) this.positionKickoff(r.team);
    for (const p of this.activePlayers) {
      if (r.type === 'Penalty') {
        if (p.team !== r.team && p.role === 'GK') {
          p.x = this.abs(105, r.team);
          p.y = 34;
          p.vx = p.vy = 0;
        } else if (p.id !== taker.id) {
          p.x = this.abs(82 - (p.slot % 3) * 2, r.team);
          p.y = 18 + (p.slot % 6) * 7;
          p.vx = p.vy = 0;
        }
      } else if (!kickoff && p.team !== r.team) {
        const radius = r.type === 'Throw-in' ? 2 : 9.15,
          distance = dist(p, r);
        if (distance < radius) {
          const angle = Math.atan2(p.y - r.y, p.x - r.x);
          p.x = clamp(r.x + Math.cos(angle) * (radius + 0.2), 0.5, 104.5);
          p.y = clamp(r.y + Math.sin(angle) * (radius + 0.2), 0.5, 67.5);
        }
        if (r.type === 'Goal kick' && this.inBox(p, p.team)) {
          p.x = this.abs(20, r.team);
        }
      }
    }
    taker.x = clamp(r.x - this.direction(r.team) * 0.5, 0.5, 104.5);
    taker.y = clamp(r.y, 0.5, 67.5);
    taker.vx = taker.vy = 0;
    taker.facing = this.direction(r.team) > 0 ? 0 : Math.PI;
    this.ball.x = r.x;
    this.ball.y = r.y;
    this.ball.owner = taker.id;
    this.ball.lastTouch = r.team;
    this.ball.kind = r.type === 'Goal kick' ? 'held' : 'dribble';
    this.mode = 'play';
    this.lastTeam = r.team;
    taker.hold = 0.2;
    taker.possessionAt = this.elapsed;
    this.planTimer = 0;
    if (r.type === 'Penalty') {
      taker.x = r.x;
      this.shoot(taker, { penalty: true });
      return;
    }
    const opts = this.options(taker);
    if (r.type === 'Goal kick') {
      taker.hold = 0;
      taker.think = 0.2;
      taker.goalKickExempt = true;
      this.plan();
      return;
    }
    if (r.type === 'Corner') {
      const box = opts.filter(o => this.inBox(o.r)).sort((a, b) => b.score - a.score)[0];
      if (box) {
        this.pass(taker, { ...box, delivery: 'cross' }, r.type);
        return;
      }
    }
    if (
      r.type === 'Free kick' &&
      this.rel(taker.x, taker.team) > 77 &&
      Math.abs(taker.y - 34) < 19 &&
      this.rand() < 0.32 + taker.tendency('shoot') * 0.4
    )
      this.shoot(taker, { restart: true });
    else if (opts.length) this.pass(taker, opts[0], r.type);
    else this.own(taker);
  }
}
