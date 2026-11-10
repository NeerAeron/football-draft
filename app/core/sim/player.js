// Player: per-player ratings view (skill, awareness, speed) and kinematic helpers.
import { CONFIG } from '../config/config.js';
import { clamp } from '../util/math.js';
import { preference, tendencyAbility, blendPreference } from './player-model.js';
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
// Links (chemistry) bonus, 0..4 rating points added to every skill. The draft
// computes it from club / nation / league links (up to 2) plus the captain's boost; matches
// default to 0.
export const normalizeChem = value =>
  Number.isFinite(value) ? Math.max(0, Math.min(4, value)) : 0;
// Per-step cache of skill values and familiarity. It is only active while a
// Match step runs (stamp != 0): inside one step attributes, badges, tuning and
// roles are fixed, while code outside a step (tests, UI, setup) mutating
// p.attrs / p.tags / tuning in place always reads fresh values.
//
// Behind it sits a memo that survives from step to step, so a step normally
// recomputes nothing. Once per step and player (in syncCache) the memo is
// checked against everything its values were computed from: the attrs object
// and each attribute, the badge list, chemistry, positions and the tuning
// values involved. The role can change during a step (formation changes,
// stand-in keepers), so it is compared on every memo lookup instead.
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
const NO_ATTRS = Object.freeze({});
const newMemo = () => ({
  role: undefined,
  attrs: NO_ATTRS,
  values: new Array(SKILL_KEYS.length).fill(undefined),
  tags: undefined,
  tagList: [],
  chem: NaN,
  primary: undefined,
  secondary: undefined,
  tuning: undefined,
  quality: NaN,
  boosts: undefined,
  cap: NaN,
  familiarityBase: NaN,
  familiarityBonus: NaN,
  familiarityDecay: NaN,
  secondaryDistance: NaN,
  unfamiliarFit: NaN,
  skills: new Float64Array(SKILL_KEYS.length), // rawSkill per attribute
  abilities: new Float64Array(TENDENCY_KEYS.length), // tendencyAbility per tendency
  familiarity: NaN,
});
// True when any input of the memoised values differs from the memo's snapshot.
// The attribute comparisons are spelled out (plain property loads, no keyed
// access): they must list every key of ATTRS, in SKILL_KEYS order.
function memoStale(p, m) {
  const a = p.attrs,
    v = m.values,
    tags = p.tags,
    tuning = p.tuning;
  if (
    a !== m.attrs ||
    tags !== m.tags ||
    tuning !== m.tuning ||
    p.chem !== m.chem ||
    p.primaryPosition !== m.primary ||
    p.secondaryPositions !== m.secondary ||
    a.pace !== v[0] ||
    a.acceleration !== v[1] ||
    a.shooting !== v[2] ||
    a.power !== v[3] ||
    a.longShots !== v[4] ||
    a.penalties !== v[5] ||
    a.heading !== v[6] ||
    a.shortPassing !== v[7] ||
    a.longPassing !== v[8] ||
    a.crossing !== v[9] ||
    a.vision !== v[10] ||
    a.dribbling !== v[11] ||
    a.control !== v[12] ||
    a.composure !== v[13] ||
    a.defending !== v[14] ||
    a.awareness !== v[15] ||
    a.stamina !== v[16] ||
    a.strength !== v[17] ||
    a.goalkeeping !== v[18]
  )
    return true;
  if (tags) {
    const list = m.tagList;
    if (tags.length !== list.length) return true;
    for (let i = 0; i < tags.length; i++) if (tags[i] !== list[i]) return true;
  }
  const badges = tuning?.badges || CONFIG.badges,
    ratings = tuning?.ratings || CONFIG.ratings;
  return (
    (tuning || CONFIG).gameplay.qualityImpact !== m.quality ||
    badges.boosts !== m.boosts ||
    badges.attributeCap !== m.cap ||
    ratings.familiarityBase !== m.familiarityBase ||
    ratings.familiarityBonus !== m.familiarityBonus ||
    ratings.familiarityDecay !== m.familiarityDecay ||
    ratings.secondaryDistance !== m.secondaryDistance ||
    ratings.unfamiliarFit !== m.unfamiliarFit
  );
}
function resetMemo(p, m) {
  const a = p.attrs,
    tags = p.tags,
    tuning = p.tuning,
    badges = tuning?.badges || CONFIG.badges,
    ratings = tuning?.ratings || CONFIG.ratings;
  m.role = p.role;
  // Without an attrs object nothing is memoised: NO_ATTRS never matches.
  m.attrs = a || NO_ATTRS;
  for (let i = 0; i < SKILL_KEYS.length; i++) m.values[i] = a ? a[SKILL_KEYS[i]] : undefined;
  m.tags = tags;
  m.tagList.length = 0;
  if (tags) for (let i = 0; i < tags.length; i++) m.tagList.push(tags[i]);
  m.chem = p.chem;
  m.primary = p.primaryPosition;
  m.secondary = p.secondaryPositions;
  m.tuning = tuning;
  m.quality = (tuning || CONFIG).gameplay.qualityImpact;
  m.boosts = badges.boosts;
  m.cap = badges.attributeCap;
  m.familiarityBase = ratings.familiarityBase;
  m.familiarityBonus = ratings.familiarityBonus;
  m.familiarityDecay = ratings.familiarityDecay;
  m.secondaryDistance = ratings.secondaryDistance;
  m.unfamiliarFit = ratings.unfamiliarFit;
  m.skills.fill(NaN);
  m.abilities.fill(NaN);
  m.familiarity = NaN;
}
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
    // Per-step values; bit i of _skillBits / _tendencyBits says slot i is set.
    this._skills = null;
    this._tendencies = null;
    this._skillBits = 0;
    this._tendencyBits = 0;
    this._familiarity = NaN;
    this._awareness = NaN;
    this._pressAwareness = NaN;
    this._baseSpeed = NaN;
    this._acceleration = NaN;
    this._memo = null;
  }
  skill(key) {
    if (stamp !== 0) {
      const slot = SKILL_SLOT[key];
      if (slot !== undefined) {
        if (this._stamp !== stamp) this.syncCache();
        const bit = 1 << slot;
        if ((this._skillBits & bit) !== 0) return this._skills[slot];
        const memo = this.memo(),
          known = memo.skills[slot],
          value = known === known ? known : (memo.skills[slot] = this.rawSkill(key));
        // NaN (a broken attribute) is never kept, as before: every read recomputes.
        if (value === value) {
          this._skills[slot] = value;
          this._skillBits |= bit;
        }
        return value;
      }
    }
    return this.rawSkill(key);
  }
  syncCache() {
    if (this._skills === null) {
      this._skills = new Float64Array(SKILL_KEYS.length);
      this._tendencies = new Float64Array(TENDENCY_KEYS.length);
    }
    this._skillBits = 0;
    this._tendencyBits = 0;
    this._familiarity = NaN;
    this._awareness = NaN;
    this._pressAwareness = NaN;
    this._baseSpeed = NaN;
    this._acceleration = NaN;
    this._stamp = stamp;
    const memo = (this._memo ??= newMemo());
    if (memoStale(this, memo)) resetMemo(this, memo);
  }
  // The step-to-step memo for the current role (see the note above; only
  // called after syncCache in the same step, so _memo exists and is checked).
  memo() {
    const memo = this._memo;
    if (memo.role !== this.role) {
      memo.role = this.role;
      memo.skills.fill(NaN);
      memo.abilities.fill(NaN);
      memo.familiarity = NaN;
    }
    return memo;
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
    // Two legacy names are aliases of current badges.
    return this.tags?.includes(tag === 'creator' ? 'vision' : tag === 'byline' ? 'cutback' : tag);
  }
  familiarity() {
    if (stamp === 0) return positionFamiliarity(this);
    if (this._stamp !== stamp) this.syncCache();
    const cached = this._familiarity;
    if (cached === cached) return cached;
    const memo = this.memo(),
      known = memo.familiarity;
    return (this._familiarity =
      known === known ? known : (memo.familiarity = positionFamiliarity(this)));
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
    if (stamp !== 0 && this._stamp === stamp && this._pressAwareness === this._pressAwareness)
      return this._pressAwareness;
    const base = this.awareness(),
      read = this.vision() * 0.6 + this.skill('composure') * this.familiarity() * 0.4 - 10;
    const value =
      base +
      Math.max(0, read - base) * clamp((this.tuning || CONFIG).gameplay.defensiveQuality, 0, 1);
    // awareness() above has synced the per-step cache, so the value belongs to this step.
    if (stamp !== 0) this._pressAwareness = value;
    return value;
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
    const bit = 1 << slot;
    if ((this._tendencyBits & bit) !== 0) return this._tendencies[slot];
    // Only the attribute-driven part is memoised; the stored tendency, its
    // weight and the badge adjustments are read live.
    const memo = this.memo();
    let ability = memo.abilities[slot];
    if (ability !== ability) ability = memo.abilities[slot] = tendencyAbility(this, key);
    const value = blendPreference(this, key, ability);
    if (value === value) {
      this._tendencies[slot] = value;
      this._tendencyBits |= bit;
    }
    return value;
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
  // Time to reach a target. It splits into two values that depend only on the
  // player (arrivalSpeed, acceleration) and the per-target part (arrivalAt), so
  // a loop over many targets can read the player's values once.
  arrival(target) {
    return this.arrivalAt(target, this.arrivalSpeed(), this.acceleration());
  }
  arrivalSpeed() {
    return this.topSpeed() * (this.sprint < 0.2 || this.sprintRest > 0 ? 0.73 : 0.97);
  }
  arrivalAt(target, speed, acceleration) {
    const d = dist(this, target),
      toward = ((target.x - this.x) * this.vx + (target.y - this.y) * this.vy) / (d || 1);
    return d / speed + ((1 - clamp(toward / speed, -1, 1)) * 0.28 * 9.28) / acceleration;
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
