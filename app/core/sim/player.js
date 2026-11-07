// Player: per-player ratings view (skill, awareness, speed) and kinematic helpers.
import { CONFIG } from '../config/config.js';
import { clamp } from '../util/math.js';
import { preference } from './player-model.js';
import { badgeBoost } from '../players/traits.js';
import { ATTRS, normalizeAttributes, positionFamiliarity } from '../players/ratings.js';
import { dist } from './constants.js';

const KEEPER_TECHNIQUE = new Set([
  'shortPassing',
  'longPassing',
  'crossing',
  'control',
  'composure',
  'vision',
]);
// Links (chemistry) bonus, 0..2 rating points added to every skill. The draft
// computes it from club / nation / league links; matches default to 0.
export const normalizeChem = value =>
  Number.isFinite(value) ? Math.max(0, Math.min(2, value)) : 0;
const TAG_ALIAS = { creator: 'vision', byline: 'cutback' };
// Per-step cache of skill values and familiarity. It is only active while a
// Match step runs (stamp != 0): inside one step attributes, badges, tuning and
// roles are fixed, while code outside a step (tests, UI, setup) mutating
// p.attrs / p.tags / tuning in place always reads fresh values.
const SKILL_KEYS = Object.keys(ATTRS),
  SKILL_SLOT = Object.fromEntries(SKILL_KEYS.map((key, i) => [key, i]));
let stamp = 0,
  stamps = 0;
const TENDENCY_KEYS = [
    'advance',
    'carry',
    'risk',
    'shoot',
    'overlap',
    'timing',
    'roam',
    'aggression',
    'discipline',
    'hold',
    'inside',
    'aerial',
    'sweep',
  ],
  TENDENCY_SLOT = Object.fromEntries(TENDENCY_KEYS.map((key, i) => [key, i]));
export const beginStepCache = () => (stamp = ++stamps);
export const endStepCache = () => (stamp = 0);
export class Player {
  constructor(data) {
    Object.assign(this, data);
    this.attrs = normalizeAttributes(data.attrs);
    this.chem = normalizeChem(data.chem);
    this.primaryPosition = data.primaryPosition || data.role;
    this.secondaryPositions = [...(data.secondaryPositions || [])];
    this.intent = 'shape';
    this.animation = null;
    this.stun = 0;
    this.feintCooldown = 0;
    this.rethinkAt = 0;
    // Fields set later by the simulation, declared up front so every player
    // keeps one object shape (fast, monomorphic property access in hot loops).
    this.feintTarget = null;
    this.actionSince = 0;
    this.bylineAt = null;
    this._stamp = 0;
    this._skills = null;
    this._tendencies = null;
    this._familiarity = NaN;
    this._awareness = NaN;
    this._baseSpeed = NaN;
    this._acceleration = NaN;
  }
  skill(key) {
    if (stamp !== 0) {
      const slot = SKILL_SLOT[key];
      if (slot !== undefined) {
        if (this._stamp !== stamp) this.syncCache();
        const cached = this._skills[slot];
        return cached === cached ? cached : (this._skills[slot] = this.rawSkill(key));
      }
    }
    return this.rawSkill(key);
  }
  syncCache() {
    (this._skills ??= new Float64Array(SKILL_KEYS.length)).fill(NaN);
    (this._tendencies ??= new Float64Array(TENDENCY_KEYS.length)).fill(NaN);
    this._familiarity = NaN;
    this._awareness = NaN;
    this._baseSpeed = NaN;
    this._acceleration = NaN;
    this._stamp = stamp;
  }
  rawSkill(key) {
    // Natural keepers have one technical rating. Their imported outfield
    // placeholders must not make an elite keeper incapable of distribution.
    const keeperTechnique =
      this.role === 'GK' && this.primaryPosition === 'GK' && KEEPER_TECHNIQUE.has(key);
    const value = this.attrs[keeperTechnique ? 'goalkeeping' : key];
    return clamp(
      70 +
        (value - 70) * (this.tuning || CONFIG).gameplay.qualityImpact +
        badgeBoost(this, key) +
        this.chem,
      1,
      99,
    );
  }
  has(tag) {
    return this.tags?.includes(TAG_ALIAS[tag] || tag);
  }
  familiarity() {
    if (stamp === 0) return positionFamiliarity(this);
    if (this._stamp !== stamp) this.syncCache();
    const cached = this._familiarity;
    return cached === cached ? cached : (this._familiarity = positionFamiliarity(this));
  }
  awareness() {
    if (stamp !== 0 && this._stamp === stamp && this._awareness === this._awareness)
      return this._awareness;
    const value = this.skill('awareness') * this.familiarity() ** 1.5;
    if (stamp !== 0) this._awareness = value;
    return value;
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
    if (stamp === 0) return preference(this, key);
    const slot = TENDENCY_SLOT[key];
    if (slot === undefined) return preference(this, key);
    if (this._stamp !== stamp) this.syncCache();
    const cached = this._tendencies[slot];
    return cached === cached ? cached : (this._tendencies[slot] = preference(this, key));
  }
  baseSpeed() {
    if (stamp !== 0 && this._stamp === stamp && this._baseSpeed === this._baseSpeed)
      return this._baseSpeed;
    const value =
      (3.7 + this.skill('pace') * 0.062) * (this.tuning || CONFIG).gameplay.movementSpeed;
    if (stamp !== 0) this._baseSpeed = value;
    return value;
  }
  acceleration() {
    if (stamp !== 0 && this._stamp === stamp && this._acceleration === this._acceleration)
      return this._acceleration;
    const value =
      (3.2 + this.skill('acceleration') * 0.08) * (this.tuning || CONFIG).gameplay.acceleration;
    if (stamp !== 0) this._acceleration = value;
    return value;
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
      const root = Math.sqrt(disc),
        t1 = (-b - root) / (2 * a),
        t2 = (-b + root) / (2 * a);
      if (t1 > 0 || t2 > 0) time = t1 > 0 && t2 > 0 ? Math.min(t1, t2) : t1 > 0 ? t1 : t2;
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
