import { Match, Player, clamp, MATCH_SECONDS } from './engine.js';
import { freshStats } from './constants.js';
export const RECORD_STEP = 3; // 20 stored frames/s; interpolate display, retain 60 Hz physics.
export const EXTRA_TIME_REEL = 20; // seconds of Key Moments for extra time (30 for a half)
// Shallow equality of two flat records (a stats row, a restart, an animation).
function sameRecord(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (let i = 0; i < keys.length; i++) if (a[keys[i]] !== b[keys[i]]) return false;
  return true;
}
const sameList = (a, b) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
/**
 * One recorded frame. `previous` (the frame before it, optional) lets the parts that did not
 * change — most players' states, a side's stats, the restart — be shared with it instead of
 * copied: a Key Moments half is then a third of the size to hand from the worker to the page
 * (structured clone writes a shared object once), and the Full-mode ring makes less garbage.
 * Frames are never written to after they are made.
 */
export function snapshot(m, previous = null) {
  const positions = new Float32Array(22 * 9),
    players = m.players,
    states = new Array(players.length),
    before = previous?.states;
  for (let i = 0; i < players.length; i++) {
    const p = players[i],
      j = i * 9,
      old = before?.[i];
    positions[j] = p.x;
    positions[j + 1] = p.y;
    positions[j + 2] = p.vx;
    positions[j + 3] = p.vy;
    positions[j + 4] = p.tx;
    positions[j + 5] = p.ty;
    positions[j + 6] = p.facing;
    positions[j + 7] = p.energy;
    positions[j + 8] = p.lastShotSpeed || 0;
    states[i] =
      old &&
      old.action === p.action &&
      old.intent === p.intent &&
      old.possessionAt === p.possessionAt &&
      old.lastShotChance === p.lastShotChance &&
      old.lastShotType === p.lastShotType &&
      old.yellowCards === p.yellowCards &&
      old.sentOff === p.sentOff &&
      old.emergencyKeeper === p.emergencyKeeper &&
      old.role === p.role &&
      old.slot === p.slot &&
      sameRecord(old.animation, p.animation)
        ? old
        : {
            action: p.action,
            intent: p.intent,
            possessionAt: p.possessionAt,
            animation: p.animation ? { ...p.animation } : null,
            lastShotChance: p.lastShotChance,
            lastShotType: p.lastShotType,
            yellowCards: p.yellowCards,
            sentOff: p.sentOff,
            emergencyKeeper: p.emergencyKeeper,
            role: p.role,
            slot: p.slot,
          };
  }
  return {
    elapsed: m.elapsed,
    time: m.time,
    half: m.half,
    periodStart: m.periodStart,
    addedMinutes:
      previous && sameList(previous.addedMinutes, m.addedMinutes)
        ? previous.addedMinutes
        : [...m.addedMinutes],
    score: previous && sameList(previous.score, m.score) ? previous.score : [...m.score],
    stats: m.stats.map((s, t) =>
      previous && sameRecord(previous.stats[t], s) ? previous.stats[t] : { ...s },
    ),
    positions,
    states,
    abandonedTeam: m.abandonedTeam,
    ball: { ...m.ball },
    effects: m.effects.map(e => ({ ...e })),
    mode: m.mode,
    phase: m.phase,
    restart:
      previous && sameRecord(previous.restart, m.restart) ? previous.restart : { ...m.restart },
    momentumSamples: m.momentum?.samples.length ?? 0,
    penaltyEnd: m.penaltyEnd ?? null,
    shootout: m.shootout
      ? {
          first: m.shootout.first,
          kicks: m.shootout.kicks.map(k => ({ ...k })),
          score: [...m.shootout.score],
          winner: m.shootout.winner,
        }
      : null,
  };
}
// How much a non-goal moment deserves a highlight slot: chance quality (xG),
// save difficulty and drama, not a flat priority per event type. (xG is the engine's own:
// a typical shot is ~0.25, a big chance 0.6+.)
export function highlightScore(e) {
  const xg = e.xg ?? 0,
    big = e.bigChance ? 1.5 : 0,
    strength = e.strength || 0;
  switch (e.type) {
    case 'shot':
      return (
        2.5 +
        xg * 3 +
        big +
        (e.outcome === 'post' ? 1.5 : e.outcome === 'saved' ? 1 : e.outcome === 'blocked' ? 0.3 : 0)
      );
    case 'save':
      return 3 + (e.difficulty ?? 0.5) * 5 + xg * 2 + big;
    case 'post':
      return 5 + xg * 2 + big;
    case 'near-miss':
      return 3.5 + xg * 2.5 + big;
    case 'block':
      return 2.5 + xg * 2 + big;
    case 'red':
      return 8;
    case 'penalty':
      return 7;
    case 'yellow':
      return 1.5;
    case 'cross':
    case 'cutback':
    case 'through':
      return 2 + strength * 1.5;
    case 'dribble':
    case 'tackle':
      return 1.5 + strength * 1.5;
    default:
      return 0;
  }
}
// A penalty shootout is never part of a reel (the UI shows its kicks as a list of marks):
// the clips end with the final whistle.
export function selectHighlights(events, duration, budget = 60) {
  const pens = events.find(e => e.type === 'shootout-start');
  if (pens) {
    duration = Math.min(duration, pens.elapsed);
    events = events.filter(e => e.elapsed <= duration && !e.type.startsWith('shootout'));
  }
  budget = Math.min(budget, duration);
  const goals = events.filter(e => e.type === 'goal').sort((a, b) => a.elapsed - b.elapsed);
  const merge = list => {
    const out = [];
    for (const c of list.sort((a, b) => a.start - b.start)) {
      const last = out.at(-1);
      if (last && c.start <= last.end + 0.015) last.end = Math.max(last.end, c.end);
      else out.push({ ...c });
    }
    return out;
  };
  const total = list => list.reduce((s, c) => s + c.end - c.start, 0);
  // Goals and red cards are always shown: they share the reel when there are many.
  const reds = events.filter(e => e.type === 'red'),
    perGoal = Math.min(8, budget / Math.max(1, goals.length + reds.length)),
    perRed = Math.min(5, perGoal);
  let clips = merge([
    ...goals.map(e => ({
      start: clamp(e.elapsed - perGoal * 0.67, 0, duration - perGoal),
      end: clamp(e.elapsed - perGoal * 0.67, 0, duration - perGoal) + perGoal,
    })),
    ...reds.map(e => ({
      start: clamp(e.elapsed - perRed * 0.6, 0, duration - perRed),
      end: clamp(e.elapsed - perRed * 0.6, 0, duration - perRed) + perRed,
    })),
  ]);
  const candidates = events
    .map(e => ({ e, score: highlightScore(e) }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score || a.e.elapsed - b.e.elapsed)
    .map(c => c.e);
  for (const e of candidates) {
    const remaining = budget - total(clips);
    if (remaining < 0.05) break;
    if (clips.some(c => e.elapsed >= c.start && e.elapsed <= c.end)) continue;
    const length = Math.min(6, remaining),
      start = clamp(e.elapsed - length * 0.72, 0, duration - length),
      candidate = { start, end: start + length };
    const merged = merge([...clips, candidate]);
    if (total(merged) <= budget + 0.001) clips = merged;
  }
  // Fill short reports with actual buildup, never invented action or accelerated motion.
  const gaps = [];
  let edge = 0;
  for (const c of clips) {
    if (c.start > edge) gaps.push({ start: edge, end: c.start });
    edge = c.end;
  }
  if (edge < duration) gaps.push({ start: edge, end: duration });
  for (const gap of gaps) {
    const remaining = budget - total(clips);
    if (remaining < 0.001) break;
    const length = Math.min(remaining, gap.end - gap.start);
    clips = merge([...clips, { start: gap.end - length, end: gap.end }]);
  }
  let offset = 0;
  return clips.map(c => {
    const clip = { ...c, offset };
    offset += c.end - c.start;
    return clip;
  });
}
export async function simulateComplete(
  config,
  seed,
  record = false,
  onProgress = () => {},
  cancelled = () => false,
) {
  const m = new Match(seed, MATCH_SECONDS);
  m.importConfig(config);
  const frames = record ? [snapshot(m)] : [];
  let ticks = 0;
  while (!m.finished) {
    for (let i = 0; i < 600 && !m.finished; i++) {
      const before = m.mode;
      m.step(1 / 60);
      ticks++;
      if (
        record &&
        m.mode !== 'shootout' &&
        !m.shootout &&
        (ticks % RECORD_STEP === 0 || (before !== m.mode && m.mode === 'halftime'))
      )
        frames.push(snapshot(m, frames.at(-1)));
    }
    if (cancelled()) return null;
    onProgress(clamp(m.elapsed / m.expectedDuration(), 0, 1));
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  // A shootout is not recorded (nobody replays it): those frames end at the final whistle.
  if (record && !m.shootout && frames.at(-1)?.elapsed !== m.elapsed)
    frames.push(snapshot(m, frames.at(-1)));
  return { result: m, frames, clips: record ? selectHighlights(m.events, m.elapsed, 60) : [] };
}
// A structured clone of a Match (plain data) → a working Match with the same state.
// The state is copied onto objects built by the real constructors and literals (match,
// players, ball, stats), so they get the hidden classes the engine's hot paths are optimised
// for. Restoring prototypes with Object.assign(Object.create(proto), data) left the match and
// all 22 players in dictionary mode (every property access a hash lookup, about 3x slower
// per step).
function restoreMatch(data) {
  const m = new Match(data.seed, data.duration),
    { ball, stats } = m;
  Object.assign(m, data);
  m.ball = Object.assign(ball, data.ball);
  m.stats = data.stats.map((side, i) => Object.assign(stats[i] || {}, side));
  m.players = data.players.map(source => {
    const p = new Player(source);
    // The constructor normalises attrs and resets its transient fields: put those back.
    for (const key of Object.keys(source))
      if (key !== 'attrs' && key[0] !== '_') p[key] = source[key];
    p.stats = Object.assign(freshStats(), source.stats);
    return p;
  });
  return m;
}
/**
 * One stretch of a match between two breaks, with its highlight clips: the first half (from
 * kick-off to half-time), the second (to the end, or to the break before extra time) or the
 * whole of extra time (both periods; the sides only change ends between them).
 */
export async function simulateHalf(source, onProgress = () => {}, cancelled = () => false) {
  // Keep the authoritative simulation separate from the display snapshots.
  const m = restoreMatch(structuredClone(source));
  m.rebuildActive();
  m.pauseAtHalf = true;
  if (m.mode === 'halftime') m.resumeHalf();
  const start = m.elapsed,
    half = m.half,
    frames = [snapshot(m)];
  let ticks = 0;
  while (!m.finished && m.mode !== 'halftime') {
    for (let i = 0; i < 600 && !m.finished && m.mode !== 'halftime'; i++) {
      m.step(1 / 60);
      ticks++;
      if (ticks % RECORD_STEP === 0 && m.mode !== 'shootout' && !m.shootout)
        frames.push(snapshot(m, frames.at(-1)));
    }
    if (cancelled()) return null;
    // Extra time is two periods in one stretch: the first one's length stands for both.
    const end = m.periodDeadline() + (m.half === 3 ? m.periodDeadline() - m.periodStart : 0);
    onProgress(clamp((m.elapsed - start) / (end - start), 0, 1));
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (!m.shootout && frames.at(-1).elapsed !== m.elapsed) frames.push(snapshot(m, frames.at(-1)));
  // Extra time is a third as long as the ninety minutes, and so is its reel.
  const extra = half > 2,
    budget = extra ? EXTRA_TIME_REEL : 30;
  const events = m.events
    .filter(e => e.half >= half)
    .map(e => ({ ...e, elapsed: e.elapsed - start }));
  const clips = selectHighlights(events, m.elapsed - start, budget).map(c => ({
    ...c,
    start: c.start + start,
    end: c.end + start,
  }));
  return {
    result: m,
    frames,
    clips,
    viewDuration: budget,
    viewOffset: extra ? 60 : (half - 1) * 30,
  };
}
function frameIndex(frames, time) {
  let lo = 0,
    hi = frames.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (frames[mid].elapsed <= time + 1e-8) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
// The frame each display match shows. A reel is played at 60 fps from 20 recorded frames a
// second, so two calls in three find the same frame: its discrete state (score, stats, player
// states, effects, the ball's fields, the trail) is then already on the display match and
// only the interpolated parts are written again.
const shown = new WeakMap();
export function applyReplayFrame(target, recording, viewTime) {
  const clip =
    recording.clips.find(c => viewTime < c.offset + c.end - c.start) || recording.clips.at(-1);
  const frames = recording.frames,
    sourceTime = clamp(clip.start + viewTime - clip.offset, clip.start, clip.end),
    index = frameIndex(frames, sourceTime),
    a = frames[index],
    b = frames[Math.min(index + 1, frames.length - 1)],
    mix = clamp((sourceTime - a.elapsed) / (b.elapsed - a.elapsed || 0.05), 0, 1);
  const aTime = a.time ?? (a.elapsed / target.duration) * 5400,
    bTime = b.time ?? (b.elapsed / target.duration) * 5400;
  let seen = shown.get(target);
  if (!seen) shown.set(target, (seen = { frame: null, frames: null }));
  const fresh = seen.frame !== a || seen.frames !== frames;
  seen.frame = a;
  seen.frames = frames;
  target.elapsed = sourceTime;
  target.time = aTime + (a.half === b.half ? (bTime - aTime) * mix : 0);
  if (fresh) {
    target.half = a.half;
    target.periodStart = a.periodStart ?? 0;
    if (a.addedMinutes) target.addedMinutes = [...a.addedMinutes];
    target.score = [...a.score];
    target.stats = a.stats.map(s => ({ ...s }));
    target.ball = { ...a.ball };
    target.effects = a.effects.map(e => ({ ...e }));
    target.mode = a.mode;
    target.abandonedTeam = a.abandonedTeam ?? null;
    target.penaltyEnd = a.penaltyEnd ?? null;
    target.shootout = a.shootout ?? null;
    target.phase = a.phase;
    target.restart = a.restart;
  }
  const pa = a.positions,
    pb = b.positions,
    players = target.players;
  for (let i = 0; i < players.length; i++) {
    const p = players[i],
      j = i * 9,
      jx = pa[j] - pb[j],
      jy = pa[j + 1] - pb[j + 1],
      // A player who moved more than 4 m between two frames was repositioned: no sliding
      k = jx * jx + jy * jy > 16 ? 0 : mix,
      turn = pb[j + 6] - pa[j + 6];
    p.x = pa[j] + (pb[j] - pa[j]) * k;
    p.y = pa[j + 1] + (pb[j + 1] - pa[j + 1]) * k;
    p.vx = pa[j + 2] + (pb[j + 2] - pa[j + 2]) * k;
    p.vy = pa[j + 3] + (pb[j + 3] - pa[j + 3]) * k;
    p.tx = pa[j + 4] + (pb[j + 4] - pa[j + 4]) * k;
    p.ty = pa[j + 5] + (pb[j + 5] - pa[j + 5]) * k;
    p.facing = pa[j + 6] + Math.atan2(Math.sin(turn), Math.cos(turn)) * k;
    p.energy = pa[j + 7] + (pb[j + 7] - pa[j + 7]) * k;
    p.lastShotSpeed = pa[j + 8] + (pb[j + 8] - pa[j + 8]) * k;
    if (fresh) Object.assign(p, a.states[i]);
  }
  if (fresh) target.rebuildActive();
  const ball = target.ball,
    ax = a.ball.x - b.ball.x,
    ay = a.ball.y - b.ball.y;
  if (a.ball.kind === b.ball.kind && ax * ax + ay * ay < 36) {
    ball.x = a.ball.x + (b.ball.x - a.ball.x) * mix;
    ball.y = a.ball.y + (b.ball.y - a.ball.y) * mix;
    ball.z = a.ball.z + (b.ball.z - a.ball.z) * mix;
  } else if (a.ball.owner === null && b.score[0] + b.score[1] > a.score[0] + a.score[1]) {
    // A goal between these frames (the next one has the ball back on the centre spot): it
    // runs on into the net instead of stopping a metre short of the line.
    const dt = sourceTime - a.elapsed;
    ball.x = clamp(a.ball.x + a.ball.vx * dt, -1.6, 106.6);
    ball.y = a.ball.y + a.ball.vy * dt;
    ball.z = Math.max(0, a.ball.z + a.ball.vz * dt);
  }
  target.events = recording.result.events
    .filter(e => e.elapsed <= sourceTime)
    .map(e => (e.resolvedAt > sourceTime ? { ...e, outcome: 'in flight' } : e));
  const momentum = recording.result.momentum;
  if (momentum) {
    // The recorded series up to this frame (re-sliced only when it grows).
    const count = a.momentumSamples ?? 0,
      shown = target.momentum?.samples;
    if (shown?.length !== count || (count && shown[0] !== momentum.samples[0]))
      target.momentum = {
        step: momentum.step,
        samples: momentum.samples.slice(0, count),
        current: momentum.samples[count - 1]?.values ?? [0, 0],
      };
  }
  if (fresh) {
    target.ballTrail = [];
    for (let n = Math.max(0, index - 7); n <= index; n++) {
      const at = frames[n].ball;
      target.ballTrail.push({ x: at.x, y: at.y, z: at.z, kind: at.kind, age: at.age });
    }
  }
  return recording.clips.indexOf(clip) + 1;
}
export function performanceRating(p, m) {
  const s = p.stats,
    op = m.score[1 - p.team],
    contribution =
      s.goals * 1.12 +
      s.assists * 0.72 +
      s.keyPasses * 0.14 +
      s.takeons * 0.075 +
      s.tackles * 0.13 +
      s.interceptions * 0.055 +
      s.blocks * 0.1 +
      s.saves * 0.22;
  const mistakes =
    s.turnovers * 0.055 +
    s.fouls * 0.055 +
    (s.passes - s.completed) * 0.012 +
    (s.yellowCards || 0) * 0.12 +
    (s.redCards || 0) * 0.8;
  const clean = p.role === 'GK' || p.role === 'CB' ? (op === 0 ? 0.55 : -op * 0.09) : 0;
  return clamp(6 + contribution + clean + Math.min(0.35, s.completed * 0.009) - mistakes, 3, 10);
}
