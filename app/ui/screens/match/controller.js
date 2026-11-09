// Match screen controller: owns the Match objects, the playback loop (RAF only while
// something moves), Key Moments reels from the worker, the Full-mode ring buffer (goal
// replays, "skip to next moment"), the action camera, moment captions, commentary, sound and
// a throttled HUD store for Preact. Never consumes simulation RNG for presentation, and the
// frame loop reuses its view/scene objects (no per-frame allocations on this side).
import { Match } from '../../../core/sim/engine.js';
import { snapshot, applyReplayFrame, RECORD_STEP } from '../../../core/sim/replay.js';
import { matchClock } from '../../../core/sim/periods.js';
import { tacticAccess } from '../../../core/sim/coach.js';
import { MatchSoundEvents } from '../../../services/sound.js';
import { PlaybackClock } from '../../../services/playback.js';
import { createSimClient } from '../../../services/sim-client.js';
import { createStore } from '../../lib/store.js';
import { playCue } from '../../lib/audio.js';
import { isReducedMotion } from '../../lib/motion.js';
import { markMatchLive, saveMatchResult, FULL_DURATION } from '../../lib/match-store.js';
import { commentary } from './commentary.js';
import { summarizeMatch } from './report.js';
import { forceShootout } from './demo.js';
import { readJSON, writeJSON } from '../../lib/storage.js';
import {
  draw,
  makeKits,
  WORLD,
  ActionCamera,
  CAMERA_ZOOM,
  createRenderState,
  resetRenderState,
  makeTransform,
  paintPitch,
  zoomLayerScale,
} from './renderer/index.js';

const RING_SECONDS = 12;
const RING_SIZE = Math.ceil((RING_SECONDS * 60) / RECORD_STEP);
const CELEBRATE = 2.2;
const CELEBRATE_REDUCED = 1.8;
const REPLAY_BEFORE = 2.8;
const REPLAY_AFTER = 0.7;
const REPLAY_RATE = 0.6;
const FLAIR_LIFE = 1.5;
// A restart that moves several players at once (a corner being set up, a kick-off) is shown
// as a cut — a short fade and a camera snap — never as tokens sliding across the pitch.
const JUMP_PLAYERS = 4;
const JUMP_SPEED = 13; // m/s no player reaches: anything faster is a reposition
const FF_BUDGET_MS = 9;
const SPEEDS = [1, 2, 4];

let sharedSim = null;
const simClient = () => (sharedSim ??= createSimClient());

/** Kick-off clock period label for the HUD. */
export function periodLabel(m) {
  if (!m) return '';
  if (m.finished) return 'FT';
  if (m.mode === 'shootout' || m.penaltyEnd != null) return 'PENS';
  if (m.mode === 'halftime') return 'HT';
  return ['1H', '2H', 'ET1', 'ET2'][m.half - 1] || '';
}

/** Camera choice per view ('football-draft-match-camera'): the action camera or the full pitch. */
export const CAMERA_KEY = 'football-draft-match-camera';
const CAMERA_DEFAULTS = { key: 'action', full: 'wide' };
const CAMERA_MODES = ['action', 'wide'];
export function readCameraPrefs() {
  const saved = readJSON(CAMERA_KEY, null);
  const out = { ...CAMERA_DEFAULTS };
  for (const view of Object.keys(out))
    if (CAMERA_MODES.includes(saved?.[view])) out[view] = saved[view];
  return out;
}

const viewDuration = (view, request) => (view === 'full' ? request.duration || FULL_DURATION : 300);

function shotStop(e) {
  switch (e.type) {
    case 'goal':
      return 0;
    case 'penalty':
    case 'red':
      return 0.4;
    case 'shot':
      return e.bigChance || (e.xg ?? 0) >= 0.14 ? 1.1 : null;
    case 'post':
    case 'near-miss':
      return 0.6;
    case 'save':
      return (e.difficulty ?? 0) >= 0.5 ? 0.6 : null;
    case 'shootout':
      return 0.3;
    default:
      return null;
  }
}

export class MatchController {
  constructor(request) {
    this.request = request;
    this.userSides = request.meta?.userSides ?? [0];
    this.kits = makeKits(request.config.teams);
    this.preview = this.makeMatch(request.view);
    this.live = null; // Full: the authoritative live match
    this.display = null; // replay target for reels, rewinds and goal replays
    this.htMatch = null; // Key Moments: authoritative match at half-time
    this.clock = new PlaybackClock();
    this.sounds = new MatchSoundEvents((cue, options) => playCue(cue, options));
    this.ring = [];
    this.flash = 0;
    this.camera = new ActionCamera();
    this.cameraPrefs = readCameraPrefs();
    // Reused every frame by render(): the renderer's view and scene (see renderer/draw.js)
    this.fx = createRenderState();
    this.flair = { text: '', tone: 'miss', x: 0, y: 0, age: 0, life: FLAIR_LIFE, on: false };
    this.viewState = {
      width: 0,
      height: 0,
      dpr: 1,
      orientation: 'landscape',
      camera: WORLD,
      zoomed: false,
      dt: undefined,
    };
    this.scene = {
      match: null,
      kits: this.kits,
      fx: this.fx,
      scorerId: null,
      flair: null,
      flash: 0,
      flashColor: null,
      dim: 0,
      still: false,
    };
    this.scorerId = null;
    this.jump = { x: new Float32Array(22), y: new Float32Array(22), match: null, elapsed: 0 };
    this.baseT = {};
    this.layered = false;
    this.frameDt = undefined;
    this.presenting = 'idle';
    this.resumeTo = null;
    this.reel = null;
    this.rw = null;
    this.rp = null;
    this.ff = null;
    this.jobs = { half1: null, half2: null, instant: null };
    this.lastEventId = 0;
    this.pendingShots = new Map();
    this.seenGoals = new Set();
    this.score = [0, 0];
    this.feed = [];
    this.moments = [];
    this.hudAt = 0;
    this.statsAt = 0;
    this.steps = 0;
    this.visible = true;
    this.raf = 0;
    this.disposed = false;
    this.perf = { frames: 0, total: 0, worst: 0, samples: [] };
    globalThis.__matchPerf = this.perf; // read by the browser flows (frame times)
    this.hud = createStore({
      phase: 'pre',
      view: request.view,
      paused: false,
      speed: 1,
      presenting: 'idle',
      clock: '00:00',
      period: '1H',
      score: [0, 0],
      pens: null,
      xg: [0, 0],
      momentum: { samples: [], n: 0 },
      stats: null,
      ticker: null,
      feed: [],
      moments: [],
      goal: null,
      replay: false,
      skipping: false,
      clip: null,
      progress: 0,
      shootout: null,
      tactics: this.preview.teams.map(t => ({ ...t.tactics })),
      access: this.accessFor(this.preview, 'pre'),
      announce: '',
      error: null,
      result: null,
      halftime: null,
      cut: 0,
      camera: this.cameraPrefs[request.view] || 'wide',
    });
    this.loop = this.loop.bind(this);
    this.prefetch();
  }

  // ---------- setup ----------

  makeMatch(view) {
    const m = new Match(this.request.seed, viewDuration(view, this.request));
    m.importConfig(structuredClone(this.request.config));
    m.pauseAtHalf = true;
    return m;
  }

  /** The match tactics edits go to right now. */
  editTarget() {
    const phase = this.hud.get().phase;
    if (phase === 'pre') return this.preview;
    if (this.live) return this.live;
    if (phase === 'halftime' && this.htMatch) return this.htMatch;
    return null;
  }

  accessFor(m, phase) {
    const mode = this.request.config.competition?.mode || 'ai';
    return [0, 1].map(team => {
      const user = this.userSides.includes(team);
      const tactics =
        user &&
        !!m &&
        (phase === 'pre' ||
          (phase === 'halftime' && tacticAccess(mode, team, { started: true, halftime: true })) ||
          (phase === 'playing' &&
            this.request.view === 'full' &&
            tacticAccess(mode, team, { started: true, halftime: false })));
      const mentality =
        user &&
        !!m &&
        (phase === 'pre' || phase === 'halftime' || (phase === 'playing' && !!this.live));
      return { tactics, mentality, formation: tactics && !!m && !m.lineupFixed() };
    });
  }

  refreshTactics() {
    const m = this.editTarget() || this.live || this.htMatch || this.preview;
    const phase = this.hud.get().phase;
    this.hud.set({
      tactics: m.teams.map(t => ({ ...t.tactics })),
      access: this.accessFor(this.editTarget(), phase),
    });
  }

  setView(view) {
    if (this.hud.get().phase !== 'pre' || view === this.request.view) return;
    this.request = { ...this.request, view, duration: viewDuration(view, this.request) };
    this.preview.setDuration(viewDuration(view, this.request));
    this.hud.set({ view, camera: this.cameraPrefs[view] || 'wide' });
    this.prefetch();
  }

  /** Start simulating Key Moments / Instant speculatively while the user reads the line-ups. */
  prefetch() {
    clearTimeout(this.prefetchTimer);
    this.cancelJob('half1');
    this.cancelJob('instant');
    if (this.request.view === 'full') return;
    this.prefetchTimer = setTimeout(() => {
      if (this.disposed || this.hud.get().phase !== 'pre') return;
      if (this.request.view === 'key') this.jobs.half1 = this.startHalfJob(this.kickoffSource());
      else this.jobs.instant = this.startInstantJob();
    }, 250);
  }

  kickoffSource() {
    const m = this.makeMatch(this.request.view);
    m.teams = this.preview.teams.map(t => ({ ...t, tactics: { ...t.tactics } }));
    if (this.request.meta?.forceShootout) forceShootout(m);
    return m;
  }

  startHalfJob(source) {
    const job = simClient().half(source, {
      onProgress: p => this.jobProgress(job, p),
    });
    return job;
  }

  startInstantJob() {
    if (this.request.meta?.forceShootout) return this.startHalfJob(this.kickoffSource());
    const config = this.preview.exportConfig();
    const job = simClient().complete(config, this.request.seed, {
      onProgress: p => this.jobProgress(job, p),
    });
    return job;
  }

  jobProgress(job, p) {
    if (this.awaiting === job) this.hud.set({ progress: p });
  }

  cancelJob(name) {
    this.jobs[name]?.cancel();
    this.jobs[name] = null;
  }

  // ---------- tactics ----------

  setTactic(team, key, value) {
    const m = this.editTarget();
    if (!m) return false;
    const access = this.accessFor(m, this.hud.get().phase)[team];
    if (key === 'mentality' ? !access.mentality : !access.tactics) return false;
    if (key === 'formation' && !access.formation) return false;
    const ok = m.setTactic(team, key, value);
    if (ok) {
      if (m === this.preview) this.prefetch();
      if (m === this.htMatch) this.cancelJob('half2');
    }
    this.refreshTactics();
    return !!ok;
  }

  // ---------- kickoff ----------

  async kickoff() {
    if (this.hud.get().phase !== 'pre') return;
    clearTimeout(this.prefetchTimer);
    markMatchLive();
    const view = this.request.view;
    playCue('kickoff');
    if (view === 'full') {
      clearTimeout(this.prefetchTimer);
      this.live = this.preview;
      this.live.pauseAtHalf = true;
      if (this.request.meta?.forceShootout) forceShootout(this.live);
      this.display = this.makeMatch('full');
      this.sounds.reset(this.live);
      this.hud.set({ phase: 'playing' });
      this.presentLive();
      this.refreshTactics();
      return;
    }
    this.display = this.makeMatch(view);
    if (view === 'key') {
      const job = this.jobs.half1 || this.startHalfJob(this.kickoffSource());
      this.jobs.half1 = null;
      const rec = await this.await(job);
      if (rec) this.startReel(rec);
    } else {
      const job = this.jobs.instant || this.startInstantJob();
      this.jobs.instant = null;
      const out = await this.await(job);
      if (out) this.finish(out.result);
    }
  }

  async await(job) {
    this.awaiting = job;
    this.hud.set({ phase: 'loading', progress: 0, error: null });
    try {
      const out = await job.promise;
      if (this.disposed || this.awaiting !== job) return null;
      this.awaiting = null;
      return out;
    } catch (error) {
      console.error('[match] simulation failed', error);
      if (!this.disposed) this.hud.set({ phase: 'error', error: String(error?.message || error) });
      return null;
    }
  }

  // ---------- presentation modes ----------

  presentLive() {
    this.presenting = 'live';
    this.clock.setPaused(this.hud.get().paused, performance.now());
    this.hud.set({ presenting: 'live', skipping: false, replay: false });
    this.kick();
  }

  startReel(rec) {
    const last = rec.clips.at(-1);
    this.reel = {
      rec,
      t: 0,
      length: last ? last.offset + (last.end - last.start) : 0,
      clip: 0,
      total: rec.clips.length,
    };
    this.resetScene();
    this.sounds.reset(this.display);
    this.presenting = 'reel';
    this.clock.setPaused(this.hud.get().paused, performance.now());
    this.hud.set({
      phase: 'playing',
      presenting: 'reel',
      clip: { n: 1, total: rec.clips.length },
      progress: 1,
    });
    this.applyReel();
    this.refreshTactics();
    this.kick();
  }

  applyReel() {
    const r = this.reel;
    const n = applyReplayFrame(this.display, r.rec, Math.min(r.t, Math.max(0, r.length - 1e-6)));
    if (n !== r.clip) {
      const first = r.clip === 0;
      r.clip = n;
      this.resetScene();
      this.sounds.reset(this.display);
      this.hud.set({
        clip: { n, total: r.total },
        cut: first ? 0 : this.hud.get().cut + 1,
        ticker: null, // a new clip starts without the previous clip's line
      });
    }
  }

  nextClip() {
    const r = this.reel;
    if (this.presenting === 'celebrate' || this.presenting === 'replay') {
      this.endCelebration(true);
      return;
    }
    if (!r || this.presenting !== 'reel') return;
    const next = r.rec.clips[r.clip]; // clips are 1-based in r.clip
    r.t = next ? next.offset + 1e-4 : r.length;
    this.kick();
  }

  skipToEnd() {
    if (this.presenting === 'celebrate' || this.presenting === 'replay') this.endCelebration(true);
    if (this.reel) {
      this.reel.t = this.reel.length;
      this.kick();
    }
  }

  /** Full mode: fast-forward until something worth seeing, then show its build-up. */
  skipToMoment() {
    if (!this.live || this.live.finished) return;
    if (this.presenting === 'celebrate' || this.presenting === 'replay') {
      this.endCelebration(true);
      return;
    }
    if (this.presenting !== 'live') return;
    this.ff = { from: this.live.elapsed, stopAt: null, trigger: null, lastId: this.live.eventId };
    this.presenting = 'ff';
    this.hud.set({ presenting: 'ff', skipping: true, ticker: null });
    if (this.hud.get().paused) this.setPaused(false);
    this.kick();
  }

  startRewind(from) {
    const frames = this.ring.slice();
    const start = Math.max(frames[0]?.elapsed ?? this.live.elapsed, from);
    if (!frames.length || this.live.elapsed - start < 0.5) {
      this.afterLive();
      return;
    }
    this.rw = {
      rec: {
        frames,
        clips: [{ start, end: this.live.elapsed, offset: 0 }],
        result: this.live,
      },
      t: 0,
      length: this.live.elapsed - start,
    };
    this.resetScene();
    applyReplayFrame(this.display, this.rw.rec, 0);
    this.sounds.reset(this.display);
    this.presenting = 'rewind';
    this.hud.set({ presenting: 'rewind', skipping: false });
  }

  /** After live stepping stopped (or a rewind caught up): continue, half-time or full time. */
  afterLive() {
    const m = this.live;
    if (m.finished) this.onLiveFinished();
    else if (m.mode === 'halftime') this.onHalftime(m);
    else this.presentLive();
  }

  celebrate(goal) {
    if (this.presenting === 'celebrate' || this.presenting === 'replay') return;
    this.resumeTo = this.presenting;
    this.presenting = 'celebrate';
    this.celebrateLeft = isReducedMotion() ? CELEBRATE_REDUCED : CELEBRATE;
    this.celebrateGoal = goal;
    this.scorerId = goal.type === 'goal' && !goal.ownGoal ? (goal.playerId ?? null) : null;
    this.flair.on = false;
    this.flash = isReducedMotion() ? 0 : 1;
    this.hud.set({ presenting: 'celebrate', goal: this.goalInfo(goal), replay: false });
  }

  startGoalReplay() {
    const goal = this.celebrateGoal;
    const source =
      this.resumeTo === 'reel'
        ? this.reel?.rec
        : { frames: this.ring.slice(), result: this.live, clips: [] };
    const frames = source?.frames || [];
    if (isReducedMotion() || !goal || frames.length < 4) return this.endCelebration();
    const first = frames.find(f => f.elapsed >= goal.elapsed - REPLAY_BEFORE - 0.05);
    const start = Math.max(first?.elapsed ?? goal.elapsed, goal.elapsed - REPLAY_BEFORE),
      end = Math.min(frames.at(-1).elapsed, goal.elapsed + REPLAY_AFTER);
    if (end - start < 0.8) return this.endCelebration();
    this.rp = {
      rec: { frames, clips: [{ start, end, offset: 0 }], result: source.result },
      t: 0,
      length: end - start,
    };
    // Show the first replay frame straight away (never a stale frame of the display match)
    applyReplayFrame(this.display, this.rp.rec, 0);
    this.presenting = 'replay';
    this.hud.set({ presenting: 'replay', replay: true });
    this.cut();
  }

  endCelebration(skipped = false) {
    if (this.presenting !== 'celebrate' && this.presenting !== 'replay') return;
    const back = this.resumeTo || 'live';
    const replayed = this.presenting === 'replay';
    this.resumeTo = null;
    this.rp = null;
    this.hud.set({ goal: null, replay: false });
    if (replayed) this.cut();
    else this.resetScene();
    if (back === 'reel') {
      this.presenting = 'reel';
      this.applyReel();
      this.sounds.reset(this.display);
    } else if (back === 'rewind' && this.rw) {
      this.presenting = 'rewind';
      applyReplayFrame(this.display, this.rw.rec, this.rw.t);
      this.sounds.reset(this.display);
    } else if (this.live) {
      this.presenting = 'live';
      this.sounds.reset(this.live);
      if (this.live.finished || this.live.mode === 'halftime') {
        this.afterLive();
        return;
      }
    }
    this.hud.set({ presenting: this.presenting });
    if (skipped) this.kick();
  }

  goalInfo(e) {
    const m = this.presented();
    const name = id => (id != null ? m.players[id]?.name : null);
    if (e.type === 'shootout') {
      const winner = e.outcome === 'goal' ? e.team : 1 - e.team;
      return {
        id: e.id,
        kind: 'shootout',
        team: winner,
        scorer: name(e.outcome === 'goal' ? e.playerId : e.keeperId),
        story: [],
        minute: e.outcome === 'goal' ? 'scores the decisive kick' : 'makes the decisive save',
        score: [...(e.shootoutScore || [0, 0])],
      };
    }
    return {
      id: e.id,
      team: e.team,
      scorer: name(e.playerId),
      assist: e.penalty ? null : name(e.assistId),
      ownGoal: !!e.ownGoal,
      penalty: !!e.penalty,
      story: e.story ? [...e.story] : [],
      minute: commentary(e, m)?.minute || '',
      score: e.scoreAfter ? [...e.scoreAfter] : [...this.score],
      xg: e.xg ?? null,
      shotType: e.shotType || null,
    };
  }

  // ---------- half-time / full time ----------

  onHalftime(m) {
    this.presenting = 'idle';
    this.catchUp(m);
    playCue('half');
    this.hud.set({
      phase: 'halftime',
      presenting: 'idle',
      halftime: { score: [...this.score], stats: this.statsOf(m) },
      stats: this.statsOf(m),
    });
    this.refreshTactics();
    this.updateHud(m, true);
    this.requestDraw();
    if (this.request.view === 'key') this.jobs.half2 = this.startHalfJob(m);
  }

  async secondHalf() {
    if (this.hud.get().phase !== 'halftime') return;
    playCue('kickoff');
    if (this.live) {
      this.live.resumeHalf();
      this.sounds.reset(this.live);
      this.hud.set({ phase: 'playing', halftime: null });
      this.refreshTactics();
      this.presentLive();
      return;
    }
    const job = this.jobs.half2 || this.startHalfJob(this.htMatch);
    this.jobs.half2 = null;
    const rec = await this.await(job);
    if (rec) {
      this.hud.set({ halftime: null });
      this.startReel(rec);
    }
  }

  onReelEnd() {
    const result = this.reel.rec.result;
    this.reel = null;
    this.presenting = 'idle';
    this.hud.set({ presenting: 'idle', clip: null });
    if (result.mode === 'halftime' && !result.finished) {
      this.htMatch = result;
      this.onHalftime(result);
    } else this.finish(result);
  }

  onLiveFinished() {
    this.presenting = 'idle';
    this.finish(this.live);
  }

  finish(m) {
    this.presenting = 'idle';
    this.catchUp(m);
    this.updateHud(m, true);
    playCue('full');
    const result = summarizeMatch(m, this.request);
    saveMatchResult(result);
    this.finalMatch = m;
    this.resetScene();
    this.scorerId = null;
    this.flair.on = false;
    this.flash = 0;
    const instant = this.request.view === 'instant';
    this.hud.set({
      phase: instant ? 'finished' : 'fulltime',
      presenting: 'idle',
      result,
      goal: null,
      replay: false,
      clip: null,
      shootout: null,
    });
    this.requestDraw();
    if (!instant)
      this.fulltimeTimer = setTimeout(
        () => !this.disposed && this.hud.set({ phase: 'finished' }),
        isReducedMotion() ? 1200 : 2200,
      );
  }

  // ---------- events ----------

  presented() {
    switch (this.presenting) {
      case 'live':
      case 'ff':
        return this.live;
      case 'reel':
      case 'rewind':
      case 'replay':
        return this.display;
      case 'celebrate':
        return this.resumeTo === 'live' ? this.live : this.display;
      default:
        return this.finalMatch || this.htMatch || this.live || this.preview;
    }
  }

  /** New events of the primary presentation → commentary, moments, score, goal overlay. */
  processEvents(m, { live = true } = {}) {
    const fresh = [];
    for (const e of m.events) {
      if (e.id <= this.lastEventId) break;
      fresh.push(e);
    }
    if (fresh.length) this.lastEventId = fresh[0].id;
    let goal = null;
    for (let i = fresh.length - 1; i >= 0; i--) {
      const e = fresh[i];
      if (e.type === 'shot' && (e.outcome === 'in flight' || e.outcome == null)) {
        this.pendingShots.set(e.id, e.elapsed);
        continue;
      }
      const g = this.handleEvent(e, m, live && m.elapsed - e.elapsed < 3);
      if (g) goal = g;
    }
    if (this.pendingShots.size) {
      for (const e of m.events.slice(0, 40)) {
        if (!this.pendingShots.has(e.id) || e.outcome === 'in flight') continue;
        this.pendingShots.delete(e.id);
        this.handleEvent(e, m, live);
      }
      for (const [id, at] of this.pendingShots)
        if (m.elapsed - at > 12) this.pendingShots.delete(id);
    }
    return goal;
  }

  handleEvent(e, m, recent) {
    if (e.type === 'goal' && e.scoreAfter) this.score = [...e.scoreAfter];
    const line = commentary(e, m);
    if (!line) return null;
    if (line.level >= 2 && !this.moments.some(x => x.id === line.id)) {
      this.moments = [...this.moments, line];
      this.momentsDirty = true;
    }
    if (recent) {
      this.momentFlair(e, m);
      this.feed = [line, ...this.feed.filter(x => x.id !== line.id)].slice(0, 40);
      this.feedDirty = true;
      if (line.level >= 3) {
        const t = m.teams;
        const s = e.type === 'shootout' ? e.shootoutScore : this.score;
        this.hud.set({
          announce: `${line.text} ${t[0].name} ${s?.[0] ?? ''}, ${t[1].name} ${s?.[1] ?? ''}${e.type === 'shootout' ? ' on penalties' : ''}.`,
        });
      }
    }
    const celebrated = e.type === 'goal' || (e.type === 'shootout' && e.decisive);
    if (celebrated && recent && !this.seenGoals.has(e.id)) {
      this.seenGoals.add(e.id);
      return e;
    }
    if (e.type === 'goal') this.seenGoals.add(e.id);
    return null;
  }

  /** Woodwork, near misses and big saves get a caption on the pitch (renderer `flair`). */
  momentFlair(e, m) {
    const f = this.flair;
    let text = null,
      tone = 'miss';
    if (e.type === 'post') {
      text = e.frame === 'bar' ? 'OFF THE BAR!' : 'OFF THE POST!';
      tone = 'gold';
    } else if (e.type === 'near-miss') text = e.miss === 'over' ? 'JUST OVER!' : 'JUST WIDE!';
    else if (e.type === 'save' && (e.difficulty ?? 0) >= 0.7) {
      text = 'WHAT A SAVE!';
      tone = 'save';
    }
    if (!text) return;
    const keeper = e.type === 'save' ? m.players[e.playerId] : null,
      b = m.ball,
      end = (keeper ? keeper.x : b.x) > 52.5 ? 105 : 0;
    f.text = text;
    f.tone = tone;
    f.x = keeper ? keeper.x : end;
    f.y = keeper ? keeper.y : Math.max(28, Math.min(40, b.y));
    f.age = 0;
    f.on = true;
  }

  // ---------- camera ----------

  /** 'action' (follow the ball) or 'wide' (the whole pitch) for the current view; persisted. */
  setCamera(mode) {
    if (!CAMERA_MODES.includes(mode)) return;
    const view = this.request.view;
    if (view in this.cameraPrefs) {
      this.cameraPrefs[view] = mode;
      writeJSON(CAMERA_KEY, this.cameraPrefs);
    }
    this.hud.set({ camera: mode });
    this.kick();
    this.requestDraw();
  }

  toggleCamera() {
    this.setCamera(this.hud.get().camera === 'action' ? 'wide' : 'action');
  }

  /** What the camera should do for the match on screen. */
  cameraMode(m) {
    if (m.mode === 'shootout' || m.penaltyEnd != null) return 'shootout';
    if (isReducedMotion()) return 'wide';
    const p = this.presenting;
    if (p === 'replay') return 'follow'; // the replay is always the close-up
    if (p === 'idle' || p === 'ff') return 'wide';
    return this.hud.get().camera === 'action' ? 'follow' : 'wide';
  }

  /** A cut: a short fade over the stage, the camera jumps, trails and label memory reset. */
  cut() {
    this.resetScene();
    this.hud.set({ cut: this.hud.get().cut + 1 });
  }

  resetScene() {
    resetRenderState(this.fx);
    this.camera.snap();
    this.jump.match = null;
  }

  /** Several players moved further than anyone can run: the engine set up a restart. */
  jumped(m) {
    const j = this.jump,
      players = m.players,
      same = j.match === m,
      span = m.elapsed - j.elapsed,
      reach = same && span >= 0 && span < 1 ? JUMP_SPEED * span + 1.5 : -1;
    let count = 0;
    for (let i = 0; i < players.length && i < 22; i++) {
      const p = players[i];
      if (reach >= 0 && !p.sentOff) {
        const dx = p.x - j.x[i],
          dy = p.y - j.y[i];
        if (dx * dx + dy * dy > reach * reach) count++;
      }
      j.x[i] = p.x;
      j.y[i] = p.y;
    }
    j.match = m;
    j.elapsed = m.elapsed;
    return count >= JUMP_PLAYERS;
  }

  /** Process everything up to now without ticker/overlays (cuts, half-time, instant). */
  catchUp(m) {
    this.processEvents(m, { live: false });
    for (const id of this.pendingShots.keys()) {
      const e = m.events.find(x => x.id === id);
      if (e) this.handleEvent(e, m, false);
    }
    this.pendingShots.clear();
    this.flushLists();
  }

  flushLists() {
    const patch = {};
    if (this.momentsDirty) patch.moments = this.moments;
    if (this.feedDirty) {
      patch.feed = this.feed;
      patch.ticker = this.feed[0] || null;
    }
    this.momentsDirty = this.feedDirty = false;
    if (Object.keys(patch).length) this.hud.set(patch);
  }

  // ---------- loop ----------

  setPaused(paused) {
    const now = performance.now();
    this.clock.setPaused(paused, now);
    this.hud.set({ paused });
    if (paused) this.sounds.reset(this.presented());
    this.kick();
  }

  togglePause() {
    const { phase, paused } = this.hud.get();
    if (phase !== 'playing') return;
    this.setPaused(!paused);
  }

  setSpeed(speed) {
    if (!SPEEDS.includes(speed)) return;
    this.hud.set({ speed });
  }

  stepSpeed(dir) {
    const i = SPEEDS.indexOf(this.hud.get().speed);
    this.setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + dir))]);
  }

  /**
   * `canvas` shows the players. With `pitch` and `pitchZoom` (two canvases under it) the
   * pitch is a layer of its own: painted once per size and moved by CSS when the camera
   * zooms, so a frame redraws only the tokens.
   */
  attach(canvas, pitch = null, pitchZoom = null) {
    this.canvas = canvas;
    this.pitchCanvas = pitch;
    this.zoomCanvas = pitchZoom;
    this.layered = !!(pitch && pitchZoom);
    this.viewState.pitch = !this.layered;
    this.ctx = canvas.getContext('2d', { alpha: this.layered });
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.io = new IntersectionObserver(entries => {
      this.visible = entries.some(e => e.isIntersecting);
      if (this.visible) this.requestDraw();
    });
    this.io.observe(canvas);
    this.onVisibility = () => {
      if (!document.hidden) {
        this.clock.setPaused(this.hud.get().paused, performance.now());
        this.kick();
      }
    };
    document.addEventListener('visibilitychange', this.onVisibility);
    this.requestDraw();
  }

  resize() {
    const c = this.canvas;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr)),
      h = Math.max(1, Math.round(rect.height * dpr));
    const resized = c.width !== w || c.height !== h;
    if (resized) {
      c.width = w;
      c.height = h;
    }
    this.dpr = dpr;
    this.orientation = rect.height > rect.width * 1.02 ? 'portrait' : 'landscape';
    this.camera.resize(w, h, this.orientation);
    if (this.layered && (resized || this.pitchKey !== this.orientation)) {
      this.pitchKey = this.orientation;
      makeTransform({ width: w, height: h, orientation: this.orientation }, this.baseT);
      paintPitch(this.pitchCanvas, w, h, this.orientation);
      // The zoomed copy is painted ahead of the first camera move (not during a frame)
      this.zoomPainted = false;
      this.pitchZoomed = null;
      clearTimeout(this.layerTimer);
      if (!isReducedMotion()) this.layerTimer = setTimeout(() => this.paintZoom(), 300);
    }
    this.requestDraw();
  }

  paintZoom() {
    const c = this.canvas;
    if (this.disposed || !this.layered || this.zoomPainted || !c?.width) return;
    paintPitch(
      this.zoomCanvas,
      c.width,
      c.height,
      this.orientation,
      zoomLayerScale(c.width, c.height),
    );
    this.zoomPainted = true;
  }

  /** Show the pitch layer that matches the camera and move the zoomed one under it. */
  placePitch() {
    const zoomed = this.camera.zoomed;
    if (zoomed !== this.pitchZoomed) {
      this.pitchZoomed = zoomed;
      if (zoomed) this.paintZoom();
      this.canvas.parentNode?.classList.toggle('is-zoomed', zoomed);
    }
    if (!zoomed) return;
    // base (zoom 1) pixels → this frame's pixels: scale k about the origin, then translate
    const t = this.fx.t,
      b = this.baseT,
      k = t.s / b.s,
      x = (t.e - k * b.e) / this.dpr,
      y = (t.f - k * b.f) / this.dpr;
    if (x === this.pitchX && y === this.pitchY && k === this.pitchK) return;
    this.pitchX = x;
    this.pitchY = y;
    this.pitchK = k;
    this.zoomCanvas.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) scale(${k.toFixed(5)})`;
  }

  /** Make sure the loop runs (it stops itself when nothing moves). */
  kick() {
    if (!this.raf && !this.disposed) {
      this.clock.last = null;
      this.raf = requestAnimationFrame(this.loop);
    }
  }

  requestDraw() {
    if (!this.raf && !this.disposed)
      this.raf = requestAnimationFrame(now => {
        this.raf = 0;
        this.frameDt = undefined;
        this.render(now);
        if (this.moving()) this.kick();
      });
  }

  moving() {
    const { paused } = this.hud.get();
    return (
      !this.disposed &&
      ((!paused && this.presenting !== 'idle') ||
        this.flash > 0.01 ||
        (!paused && (!this.camera.settled || this.flair.on)))
    );
  }

  loop(now) {
    this.raf = 0;
    if (this.disposed) return;
    const t0 = performance.now();
    const dt = this.clock.frame(now, document.hidden);
    this.update(dt, now);
    this.frameDt = dt;
    this.render(now);
    const spent = performance.now() - t0;
    const perf = this.perf;
    perf.frames++;
    perf.total += spent;
    perf.worst = Math.max(perf.worst, spent);
    if (perf.samples.length < 4000) perf.samples.push(spent);
    if (this.moving()) this.raf = requestAnimationFrame(this.loop);
  }

  update(dt) {
    const speed = this.hud.get().speed;
    switch (this.presenting) {
      case 'live':
        this.updateLive(dt * speed);
        break;
      case 'ff':
        this.updateFastForward();
        break;
      case 'reel': {
        const r = this.reel;
        r.t += dt * speed;
        if (r.t >= r.length) {
          r.t = r.length;
          this.applyReel();
          this.processEvents(this.display);
          this.onReelEnd();
          return;
        }
        this.applyReel();
        const goal = this.processEvents(this.display);
        if (goal) this.celebrate(goal);
        break;
      }
      case 'rewind': {
        const w = this.rw;
        w.t += dt * speed;
        applyReplayFrame(this.display, w.rec, Math.min(w.t, w.length));
        const goal = this.processEvents(this.display);
        if (goal) this.celebrate(goal);
        else if (w.t >= w.length) {
          this.rw = null;
          this.afterLive();
        }
        break;
      }
      case 'celebrate':
        this.celebrateLeft -= dt;
        if (this.celebrateLeft <= 0) this.startGoalReplay();
        break;
      case 'replay': {
        const p = this.rp;
        p.t += dt * REPLAY_RATE;
        applyReplayFrame(this.display, p.rec, Math.min(p.t, p.length));
        if (p.t >= p.length) this.endCelebration();
        break;
      }
    }
    this.flash = Math.max(0, this.flash - dt * 1.6);
    const m = this.presented(),
      p = this.presenting,
      playing = p === 'live' || p === 'reel' || p === 'rewind';
    if (this.flair.on && (this.flair.age += dt) >= this.flair.life) this.flair.on = false;
    if (playing) {
      // The scorer stays labelled until the game restarts
      if (this.scorerId != null && !(m.mode === 'restart' && m.restart?.type === 'Goal'))
        this.scorerId = null;
      if (this.jumped(m)) this.cut();
    }
    const mode = this.cameraMode(m),
      replay = p === 'replay';
    if (isReducedMotion()) this.camera.snap();
    // The camera holds still under the goal banner. Live, it keeps match time (it tracks as
    // tightly at 2× / 4×, from a wider view).
    if (p !== 'celebrate' || mode === 'shootout')
      this.camera.update(
        replay ? dt : dt * speed,
        m,
        mode,
        replay ? CAMERA_ZOOM.replay : speed >= 4 ? 1.2 : speed >= 2 ? 1.35 : CAMERA_ZOOM.follow,
      );
    if (playing && dt > 0) this.sounds.update(m, { audible: !document.hidden });
    this.updateHud(m);
  }

  updateLive(dt) {
    const m = this.live;
    const ticks = this.clock.ticks(dt);
    for (let i = 0; i < ticks; i++) {
      const stop = this.stepLive();
      const goal = this.processEvents(m);
      if (goal) {
        this.clock.accumulator = 0;
        this.celebrate(goal);
        return;
      }
      if (stop) {
        this.clock.accumulator = 0;
        this.afterLive();
        return;
      }
    }
  }

  stepLive() {
    const m = this.live;
    m.step(1 / 60);
    this.steps++;
    if (this.steps % RECORD_STEP === 0) {
      this.ring.push(snapshot(m));
      if (this.ring.length > RING_SIZE) this.ring.splice(0, this.ring.length - RING_SIZE);
    }
    return m.finished || m.mode === 'halftime';
  }

  updateFastForward() {
    const m = this.live,
      ff = this.ff,
      until = performance.now() + FF_BUDGET_MS;
    while (performance.now() < until) {
      const end = this.stepLive();
      if (m.eventId !== ff.lastId) {
        for (const e of m.events) {
          if (e.id <= ff.lastId) break;
          const wait = shotStop(e);
          if (wait != null && !ff.trigger) {
            ff.trigger = e;
            ff.stopAt = e.elapsed + wait;
          }
        }
        ff.lastId = m.eventId;
      }
      if (end || (ff.stopAt != null && m.elapsed >= ff.stopAt)) {
        const from = ff.trigger ? ff.trigger.elapsed - 5 : m.elapsed - 3;
        this.ff = null;
        this.hud.set({ skipping: false });
        this.startRewind(Math.max(ff.from, from));
        return;
      }
    }
  }

  statsOf(m) {
    const total = m.stats[0].possession + m.stats[1].possession;
    const home = total > 0 ? Math.round((100 * m.stats[0].possession) / total) : 50;
    return m.stats.map((s, t) => ({
      possession: t ? 100 - home : home,
      shots: s.shots,
      onTarget: s.onTarget,
      xg: s.xg || 0,
      passes: s.passes,
      passAccuracy: s.passes ? Math.round((100 * s.completed) / s.passes) : 0,
      saves: s.saves,
      tackles: s.tackles,
      fouls: s.fouls,
      yellowCards: s.yellowCards,
      redCards: s.redCards,
      offsides: s.offsides,
    }));
  }

  updateHud(m, force = false) {
    if (!m) return;
    const now = performance.now();
    this.flushLists();
    if (!force && now - this.hudAt < 110) return;
    // A replay shows the past: keep the live clock, stats and momentum on screen.
    if (this.presenting === 'replay' && !force) return;
    this.hudAt = now;
    const patch = {
      clock: m.mode === 'shootout' || m.penaltyEnd != null ? 'PENS' : matchClock(m.time, m.half),
      period: periodLabel(m),
      score: this.score,
      xg: [m.stats[0].xg || 0, m.stats[1].xg || 0],
    };
    const cur = this.hud.get();
    if (cur.score[0] === this.score[0] && cur.score[1] === this.score[1]) patch.score = cur.score;
    const samples = m.momentum?.samples || [];
    if (samples.length !== cur.momentum.n || force)
      patch.momentum = { samples: samples.map(s => s.values[0] - s.values[1]), n: samples.length };
    if (force || now - this.statsAt > 900) {
      this.statsAt = now;
      patch.stats = this.statsOf(m);
    }
    patch.shootout = m.shootout ? this.shootoutInfo(m) : null;
    if (
      cur.shootout &&
      patch.shootout &&
      cur.shootout.kicks.length === patch.shootout.kicks.length &&
      cur.shootout.takerId === patch.shootout.takerId
    )
      patch.shootout = cur.shootout;
    patch.pens = m.shootout ? [...m.shootout.score] : null;
    if (cur.pens && patch.pens && cur.pens[0] === patch.pens[0] && cur.pens[1] === patch.pens[1])
      patch.pens = cur.pens;
    if (
      cur.xg[0].toFixed(2) === patch.xg[0].toFixed(2) &&
      cur.xg[1].toFixed(2) === patch.xg[1].toFixed(2)
    )
      patch.xg = cur.xg;
    this.hud.set(patch);
  }

  shootoutInfo(m) {
    const sh = m.shootout;
    const kicking = m.penaltyEnd ?? (sh.kicks.length % 2 === 0 ? sh.first : 1 - sh.first);
    let taker = null,
      keeper = null,
      best = Infinity,
      bestK = Infinity;
    for (const p of m.activePlayers) {
      if (p.team === kicking) {
        const d = Math.hypot(p.x - 92, p.y - 34);
        if (d < best) {
          best = d;
          taker = p;
        }
      } else {
        const d = Math.hypot(p.x - 104.6, p.y - 34);
        if (d < bestK) {
          bestK = d;
          keeper = p;
        }
      }
    }
    const decided = sh.winner != null;
    return {
      first: sh.first,
      kicks: sh.kicks.map(k => ({
        team: k.team,
        scored: !!k.scored,
        outcome: k.outcome,
        round: k.round,
      })),
      score: [...sh.score],
      winner: sh.winner,
      suddenDeath: sh.kicks.length >= 10,
      kicking: decided ? null : kicking,
      takerId: decided ? null : (taker?.id ?? null),
      taker: decided || best > 6 ? null : (taker?.name ?? null),
      keeper: decided || bestK > 6 ? null : (keeper?.name ?? null),
    };
  }

  render() {
    if (!this.ctx || !this.visible || !this.canvas.width) return;
    const m = this.presented();
    if (!m) return;
    const cam = this.camera,
      view = this.viewState,
      scene = this.scene;
    view.width = this.canvas.width;
    view.height = this.canvas.height;
    view.dpr = this.dpr || 1;
    view.orientation = this.orientation || 'landscape';
    view.zoomed = cam.zoomed;
    view.camera = cam.zoomed ? cam.rect : WORLD;
    view.dt = this.frameDt;
    scene.match = m;
    scene.scorerId = this.scorerId;
    scene.flair = this.flair.on ? this.flair : null;
    scene.flash = this.flash;
    scene.flashColor = this.kits[this.celebrateGoal?.team ?? 0]?.primary;
    scene.dim = this.hud.get().paused && this.presenting !== 'idle' ? 1 : 0;
    draw(this.ctx, view, scene);
    if (this.layered) this.placePitch();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.prefetchTimer);
    clearTimeout(this.fulltimeTimer);
    clearTimeout(this.layerTimer);
    for (const name of Object.keys(this.jobs)) this.cancelJob(name);
    this.awaiting?.cancel();
    this.ro?.disconnect();
    this.io?.disconnect();
    if (this.onVisibility) document.removeEventListener('visibilitychange', this.onVisibility);
  }
}
