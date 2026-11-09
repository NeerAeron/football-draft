import { Match, Player, clamp, MATCH_SECONDS } from './engine.js';
import { normalizeAttributes } from '../players/ratings.js';
export const RECORD_STEP = 3; // 20 stored frames/s; interpolate display, retain 60 Hz physics.
export function snapshot(m) {
  const positions = new Float32Array(22 * 9);
  m.players.forEach((p, i) =>
    positions.set(
      [p.x, p.y, p.vx, p.vy, p.tx, p.ty, p.facing, p.energy, p.lastShotSpeed || 0],
      i * 9,
    ),
  );
  return {
    elapsed: m.elapsed,
    time: m.time,
    half: m.half,
    periodStart: m.periodStart,
    addedMinutes: [...m.addedMinutes],
    score: [...m.score],
    stats: m.stats.map(s => ({ ...s })),
    positions,
    states: m.players.map(p => ({
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
    })),
    abandonedTeam: m.abandonedTeam,
    ball: { ...m.ball },
    effects: m.effects.map(e => ({ ...e })),
    mode: m.mode,
    phase: m.phase,
    restart: { ...m.restart },
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
// save difficulty and drama, not a flat priority per event type.
export function highlightScore(e) {
  const xg = e.xg ?? 0,
    big = e.bigChance ? 1.5 : 0,
    strength = e.strength || 0;
  switch (e.type) {
    case 'shot':
      return (
        2.5 +
        xg * 10 +
        big +
        (e.outcome === 'post' ? 1.5 : e.outcome === 'saved' ? 1 : e.outcome === 'blocked' ? 0.3 : 0)
      );
    case 'save':
      return 3 + (e.difficulty ?? 0.5) * 5 + xg * 6 + big;
    case 'post':
      return 5 + xg * 6 + big;
    case 'near-miss':
      return 3.5 + xg * 8 + big;
    case 'block':
      return 2.5 + xg * 6 + big;
    case 'red':
      return 8;
    case 'penalty':
      return 7;
    case 'yellow':
      return 1.5;
    case 'shootout':
      return 6 + (e.decisive ? 4 : 0);
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
// Every penalty-shootout kick is shown: a short clip from the run-up to the outcome.
const KICK_BEFORE = 1.1,
  KICK_AFTER = 0.7;
export function selectHighlights(events, duration, budget = 60) {
  budget = Math.min(budget, duration);
  const goals = events.filter(e => e.type === 'goal').sort((a, b) => a.elapsed - b.elapsed);
  const kicks = events.filter(e => e.type === 'shootout');
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
  // Kicks may use up to 60% of the reel; a very long shootout trims each run-up.
  const kickSpan = e => Math.max(0.3, e.elapsed - (e.kickedAt ?? e.elapsed));
  const natural = kicks.reduce((s, e) => s + kickSpan(e) + KICK_BEFORE + KICK_AFTER, 0),
    squeeze = natural > budget * 0.6 ? (budget * 0.6) / natural : 1;
  const kickClips = kicks.map(e => {
    const end = Math.min(duration, e.elapsed + KICK_AFTER * squeeze),
      start = Math.max(0, end - (kickSpan(e) + KICK_BEFORE + KICK_AFTER) * squeeze);
    return { start, end };
  });
  const kickTime = total(merge(kickClips.map(c => ({ ...c }))));
  const perGoal = Math.min(8, (budget - kickTime) / Math.max(1, goals.length));
  let clips = merge([
    ...goals.map(e => ({
      start: clamp(e.elapsed - perGoal * 0.67, 0, duration - perGoal),
      end: clamp(e.elapsed - perGoal * 0.67, 0, duration - perGoal) + perGoal,
    })),
    ...kickClips,
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
      if (record && (ticks % RECORD_STEP === 0 || (before !== m.mode && m.mode === 'halftime')))
        frames.push(snapshot(m));
    }
    if (cancelled()) return null;
    onProgress(clamp(m.elapsed / m.expectedDuration(), 0, 1));
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (record && frames.at(-1)?.elapsed !== m.elapsed) frames.push(snapshot(m));
  return { result: m, frames, clips: record ? selectHighlights(m.events, m.elapsed, 60) : [] };
}
export async function simulateHalf(source, onProgress = () => {}, cancelled = () => false) {
  // Keep the authoritative simulation separate from the display snapshots.
  const m = Object.assign(Object.create(Match.prototype), structuredClone(source));
  m.players = m.players.map(p =>
    Object.assign(Object.create(Player.prototype), p, { attrs: normalizeAttributes(p.attrs) }),
  );
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
      if (ticks % RECORD_STEP === 0) frames.push(snapshot(m));
    }
    if (cancelled()) return null;
    onProgress(clamp((m.elapsed - start) / (m.periodDeadline() - start), 0, 1));
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (frames.at(-1).elapsed !== m.elapsed) frames.push(snapshot(m));
  const events = m.events
    .filter(e => e.half === half)
    .map(e => ({ ...e, elapsed: e.elapsed - start }));
  const clips = selectHighlights(events, m.elapsed - start, 30).map(c => ({
    ...c,
    start: c.start + start,
    end: c.end + start,
  }));
  return { result: m, frames, clips, viewDuration: 30, viewOffset: (half - 1) * 30 };
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
export function applyReplayFrame(target, recording, viewTime) {
  const clip =
    recording.clips.find(c => viewTime < c.offset + c.end - c.start) || recording.clips.at(-1);
  const sourceTime = clamp(clip.start + viewTime - clip.offset, clip.start, clip.end),
    index = frameIndex(recording.frames, sourceTime),
    a = recording.frames[index],
    b = recording.frames[Math.min(index + 1, recording.frames.length - 1)],
    mix = clamp((sourceTime - a.elapsed) / (b.elapsed - a.elapsed || 0.05), 0, 1);
  const aTime = a.time ?? (a.elapsed / target.duration) * 5400,
    bTime = b.time ?? (b.elapsed / target.duration) * 5400;
  target.elapsed = sourceTime;
  target.time = aTime + (a.half === b.half ? (bTime - aTime) * mix : 0);
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
  target.players.forEach((p, i) => {
    const j = i * 9,
      teleport =
        Math.hypot(a.positions[j] - b.positions[j], a.positions[j + 1] - b.positions[j + 1]) > 4;
    ['x', 'y', 'vx', 'vy', 'tx', 'ty', 'facing', 'energy', 'lastShotSpeed'].forEach((key, k) => {
      const delta = b.positions[j + k] - a.positions[j + k];
      p[key] =
        a.positions[j + k] +
        (k === 6 ? Math.atan2(Math.sin(delta), Math.cos(delta)) : delta) * (teleport ? 0 : mix);
    });
    Object.assign(p, a.states[i]);
  });
  target.rebuildActive();
  if (a.ball.kind === b.ball.kind && Math.hypot(a.ball.x - b.ball.x, a.ball.y - b.ball.y) < 6) {
    for (const key of ['x', 'y', 'z'])
      target.ball[key] = a.ball[key] + (b.ball[key] - a.ball[key]) * mix;
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
  target.ballTrail = [];
  for (let n = Math.max(0, index - 7); n <= index; n++) {
    const ball = recording.frames[n].ball;
    target.ballTrail.push({ x: ball.x, y: ball.y, z: ball.z, kind: ball.kind, age: ball.age });
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
