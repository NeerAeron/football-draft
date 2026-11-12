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
import { commentary, minuteLabel } from './commentary.js';
import { summarizeMatch } from './report.js';
import { forceShootout } from './demo.js';
import { readCameraPrefs, saveCameraPref, CAMERA_MODES } from './camera-prefs.js';
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
// Game feel: a few frozen frames when the ball is struck hard, saved or hits the frame
// (presentation timing only — the simulation is stepped exactly as before, just later).
const HIT_STOP = { shot: 0.055, save: 0.09, post: 0.11 };
// A restart that moves several players at once (a corner being set up, a kick-off) is shown
// as a cut — a short fade and a camera snap — never as tokens sliding across the pitch.
const JUMP_PLAYERS = 4;
const JUMP_SPEED = 13; // m/s no player reaches: anything faster is a reposition
const JUMP_BALL_SPEED = 50; // … and no ball
const FF_BUDGET_MS = 6; // fast-forward steps per frame: leaves room to draw at 60 fps on a phone
// The penalty shootout is never animated: the engine takes the kicks (exactly as in an Instant
// match) and the panel fills in kick by kick — the taker's name, then his ✓ / ✗.
const PENS_LEAD = 0.9; // seconds before the first taker is named
const PENS_NAME = 0.35; // a taker's name on its own …
const PENS_VERDICT = 0.5; // … then with his mark, before the next taker
const PENS_WINNER = 2.2; // the winner, before the result
const SPEEDS = [1, 2, 4];
// A stage that keeps changing size (a phone's URL bar sliding away while the page scrolls, a
// rotation, a window being dragged) is resized once it has been still for this long: until
// then the picture is stretched by CSS instead of both pitch layers being repainted per frame.
const RESIZE_SETTLE_MS = 140;

let sharedSim = null;
const simClient = () => (sharedSim ??= createSimClient());

/** Kick-off clock period label for the HUD. */
export function periodLabel(m) {
  if (!m) return '';
  if (m.finished) return 'FT';
  if (m.mode === 'shootout') return 'PENS';
  if (m.mode === 'halftime') return 'HT';
  return ['1H', '2H', 'ET1', 'ET2'][m.half - 1] || '';
}

const viewDuration = () => FULL_DURATION; // one match length for every view

function shotStop(e) {
  switch (e.type) {
    case 'goal':
      return 0;
    case 'penalty':
    case 'red':
      return 0.4;
    case 'shot':
      return e.bigChance || (e.xg ?? 0) >= 0.5 ? 1.1 : null; // the best tenth of shots
    case 'post':
    case 'near-miss':
      return 0.6;
    case 'save':
      return (e.difficulty ?? 0) >= 0.5 ? 0.6 : null;
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
    this.jump = {
      x: new Float32Array(22),
      y: new Float32Array(22),
      bx: 0,
      by: 0,
      match: null,
      elapsed: 0,
    };
    this.baseT = {};
    this.layered = false;
    this.hitStop = 0;
    this.frameDt = undefined;
    this.presenting = 'idle';
    this.resumeTo = null;
    this.reel = null;
    this.rw = null;
    this.rp = null;
    this.ff = null;
    this.pens = null; // the shootout reveal (startPens)
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
      minute: "1'",
      reds: [0, 0], // players sent off per side (a red card by the name in the score bug)
      progress: 0,
      shootout: null,
      tactics: this.preview.teams.map(t => ({ ...t.tactics })),
      effective: this.effectiveMentality(this.preview), // mentality in effect per side
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
      const locked = (this.request.meta?.formationLocked || []).includes(team);
      return {
        tactics,
        mentality,
        formation: tactics && !!m && !m.lineupFixed() && !locked,
        formationLocked: locked,
      };
    });
  }

  refreshTactics() {
    const m = this.editTarget() || this.live || this.htMatch || this.preview;
    const phase = this.hud.get().phase;
    this.hud.set({
      tactics: m.teams.map(t => ({ ...t.tactics })),
      effective: this.effectiveMentality(m),
      access: this.accessFor(this.editTarget(), phase),
    });
  }

  /** The mentality each side plays with right now ('auto' resolved by the engine). */
  effectiveMentality(m) {
    const cur = this.hud?.get().effective;
    const a = m.mentality?.(0) ?? m.teams[0].tactics.mentality,
      b = m.mentality?.(1) ?? m.teams[1].tactics.mentality;
    return cur && cur[0] === a && cur[1] === b ? cur : [a, b];
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
      clip: { n: 1 },
      progress: 1,
    });
    if (!rec.clips.length) return this.onReelEnd(); // nothing was played (straight to penalties)
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
        clip: { n },
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
    if (this.presenting === 'pens') return this.skipPens();
    if (!r || this.presenting !== 'reel') return;
    const next = r.rec.clips[r.clip]; // clips are 1-based in r.clip
    r.t = next ? next.offset + 1e-4 : r.length;
    this.kick();
  }

  skipToEnd() {
    if (this.presenting === 'celebrate' || this.presenting === 'replay') this.endCelebration(true);
    if (this.presenting === 'pens') this.skipPens();
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
    if (this.presenting === 'pens') return this.skipPens();
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
    else if (m.mode === 'shootout') this.startPens(m);
    else this.presentLive();
  }

  // ---------- penalty shootout ----------

  /**
   * A level knockout match: the stage holds the final whistle and the shootout panel fills in
   * one kick at a time. `m` is the authoritative match — the Full-mode live match (its kicks
   * are simulated here, a few milliseconds per frame) or a reel's finished result.
   */
  startPens(m) {
    if (m === this.live) {
      // Hold the picture of the final whistle (the engine lines everybody up for the kicks)
      let last = null;
      for (let i = this.ring.length - 1; i >= 0 && !last; i--)
        if (this.ring[i].mode !== 'shootout') last = this.ring[i];
      if (last) {
        const clips = [{ start: last.elapsed, end: last.elapsed, offset: 0 }];
        applyReplayFrame(this.display, { frames: [last], clips, result: m }, 0);
      }
    }
    this.pens = {
      match: m,
      shown: 0,
      named: false,
      decided: false,
      wait: isReducedMotion() ? 0 : PENS_LEAD,
      events: null,
    };
    this.presenting = 'pens';
    this.scorerId = null;
    this.flair.on = false;
    this.resetScene();
    this.clock.setPaused(this.hud.get().paused, performance.now());
    const whistle = m.events.find(e => e.type === 'full');
    if (whistle) this.handleEvent(whistle, m, true);
    this.hud.set({
      presenting: 'pens',
      skipping: false,
      replay: false,
      goal: null,
      clip: null,
      clock: 'PENS',
      period: 'PENS',
      minute: 'PENS',
      pens: [0, 0],
      shootout: this.pensInfo(),
    });
    this.kick();
  }

  updatePens(dt) {
    const s = this.pens,
      m = s.match;
    if (!m.finished) {
      const until = performance.now() + FF_BUDGET_MS;
      while (!m.finished && performance.now() < until) m.step(1 / 60);
    }
    s.wait -= dt;
    if (s.wait > 0 || !m.finished) return;
    if (s.decided) return this.finish(m, true);
    const kicks = m.shootout.kicks;
    s.events ??= m.events.filter(e => e.type === 'shootout').reverse();
    // Reduced motion: no sequence, the whole shootout at once
    if (isReducedMotion()) while (s.shown < kicks.length) this.revealKick();
    if (s.named) {
      this.revealKick();
      s.wait = PENS_VERDICT;
    } else if (s.shown < kicks.length) {
      s.named = true;
      s.wait = PENS_NAME;
    } else {
      s.decided = true;
      s.wait = isReducedMotion() ? CELEBRATE_REDUCED : PENS_WINNER;
      playCue('full');
    }
    this.showPens();
  }

  /** The next kick's verdict: its mark, commentary line and sound. */
  revealKick() {
    const s = this.pens,
      m = s.match,
      k = m.shootout.kicks[s.shown],
      e = s.events[s.shown];
    s.named = false;
    s.shown++;
    if (e) this.handleEvent(e, m, true);
    if (!isReducedMotion()) playCue(k.scored ? 'shot' : k.outcome === 'saved' ? 'save' : 'post');
  }

  showPens() {
    const info = this.pensInfo();
    this.hud.set({ shootout: info, pens: info.score });
  }

  /** "Next": the rest of the shootout at once, then the winner. */
  skipPens() {
    const s = this.pens;
    if (!s || s.decided) return;
    const m = s.match;
    while (!m.finished) m.step(1 / 60);
    s.events ??= m.events.filter(e => e.type === 'shootout').reverse();
    while (s.shown < m.shootout.kicks.length) this.revealKick();
    s.decided = true;
    s.wait = CELEBRATE_REDUCED;
    playCue('full');
    this.showPens();
    this.kick();
  }

  /** What the shootout panel shows: the kicks revealed so far and the taker on the spot. */
  pensInfo() {
    const s = this.pens,
      m = s.match,
      sh = m.shootout,
      kicks = [],
      score = [0, 0];
    for (let i = 0; i < s.shown; i++) {
      const k = sh.kicks[i];
      kicks.push({ team: k.team, scored: !!k.scored, outcome: k.outcome, round: k.round });
      if (k.scored) score[k.team]++;
    }
    const next = s.named ? sh.kicks[s.shown] : null,
      last = !next && s.shown > 0 ? sh.kicks[s.shown - 1] : null,
      shown = next || last;
    return {
      first: sh.first,
      kicks,
      score,
      winner: s.decided ? sh.winner : null,
      suddenDeath: (shown?.round ?? 0) > 5,
      kicking: next ? next.team : null,
      taker: shown ? (m.players[shown.playerId]?.name ?? null) : null,
      verdict: last ? (last.scored ? 'goal' : 'miss') : null, // of the taker's kick, once taken
    };
  }

  celebrate(goal) {
    if (this.presenting === 'celebrate' || this.presenting === 'replay') return;
    this.resumeTo = this.presenting;
    this.presenting = 'celebrate';
    this.celebrateLeft = isReducedMotion() ? CELEBRATE_REDUCED : CELEBRATE;
    this.celebrateGoal = goal;
    this.scorerId = goal.ownGoal ? null : (goal.playerId ?? null);
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
      if (this.live.finished || this.live.mode === 'halftime' || this.live.mode === 'shootout') {
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
    } else if (result.shootout) this.startPens(result);
    else this.finish(result);
  }

  onLiveFinished() {
    this.presenting = 'idle';
    this.finish(this.live);
  }

  /** `direct`: straight to the result (Instant, or a shootout that already named the winner). */
  finish(m, direct = this.request.view === 'instant') {
    this.presenting = 'idle';
    this.pens = null;
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
    this.hud.set({
      phase: direct ? 'finished' : 'fulltime',
      presenting: 'idle',
      result,
      goal: null,
      replay: false,
      clip: null,
      shootout: null,
    });
    this.requestDraw();
    if (!direct)
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
      case 'pens':
        return this.display;
      case 'celebrate':
        return this.resumeTo === 'live' ? this.live : this.display;
      default:
        return this.finalMatch || this.htMatch || this.live || this.preview;
    }
  }

  /** New events of the primary presentation → commentary, moments, score, goal overlay. */
  processEvents(m, live = true) {
    // Runs every frame (every step in Full): no arrays or option objects here
    const events = m.events;
    let fresh = 0;
    while (fresh < events.length && events[fresh].id > this.lastEventId) fresh++;
    if (fresh) this.lastEventId = events[0].id;
    let goal = null;
    for (let i = fresh - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'shot' && (e.outcome === 'in flight' || e.outcome == null)) {
        this.pendingShots.set(e.id, e.elapsed);
        if (live && m.elapsed - e.elapsed < 0.2) this.impact('shot', m.ball.strength ?? 0.4);
        continue;
      }
      const g = this.handleEvent(e, m, live && m.elapsed - e.elapsed < 3);
      if (g) goal = g;
    }
    if (this.pendingShots.size) {
      for (let i = 0; i < events.length && i < 40; i++) {
        const e = events[i];
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
      if (e.type === 'post') this.impact('post', 1);
      else if (e.type === 'save' && ((e.difficulty ?? 0) >= 0.2 || e.bigChance))
        this.impact('save', Math.max(e.difficulty ?? 0, e.bigChance ? 0.5 : 0));
      else if (e.type === 'goal') this.shake(6);
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
    if (e.type === 'goal' && recent && !this.seenGoals.has(e.id)) {
      this.seenGoals.add(e.id);
      return e;
    }
    if (e.type === 'goal') this.seenGoals.add(e.id);
    return null;
  }

  /**
   * Woodwork, near misses, good saves and wasted big chances get a caption on the pitch
   * (renderer `flair`). Saves are rated by the engine's `difficulty` (most are routine).
   */
  momentFlair(e, m) {
    const f = this.flair,
      d = e.difficulty ?? 0;
    let text = null,
      tone = 'miss';
    if (e.type === 'post') {
      text = e.frame === 'bar' ? 'OFF THE BAR!' : 'OFF THE POST!';
      tone = 'gold';
    } else if (e.type === 'near-miss') text = e.miss === 'over' ? 'JUST OVER!' : 'JUST WIDE!';
    else if (e.type === 'save' && d >= 0.3) {
      text = d >= 0.6 ? 'WHAT A SAVE!' : 'GREAT SAVE!';
      tone = 'save';
    } else if (e.type === 'shot' && e.outcome === 'off target' && e.bigChance) {
      if (f.on && f.age < 0.4) return; // a near miss already said it better
      text = 'CHANCE MISSED!';
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

  /** A beat for a big moment: freeze a few frames and shake the scene (normal speed only). */
  impact(kind, strength = 0.5) {
    if (isReducedMotion() || this.hud.get().speed !== 1 || this.presenting === 'ff') return;
    if (kind === 'shot' && strength < 0.55) return;
    this.hitStop = Math.max(this.hitStop, HIT_STOP[kind] || 0);
    this.shake(kind === 'post' ? 5 : kind === 'save' ? 2 + strength * 2 : 1.5 + strength * 3);
  }

  /** Shake the scene by up to `px` CSS pixels for a fifth of a second. */
  shake(px) {
    const el = this.canvas?.parentNode;
    if (!el?.animate || isReducedMotion() || !(px > 0)) return;
    el.animate(
      [
        { translate: `${px}px ${-px * 0.6}px` },
        { translate: `${-px * 0.7}px ${px * 0.5}px` },
        { translate: `${px * 0.4}px ${px * 0.3}px` },
        { translate: '0 0' },
      ],
      { duration: 220, easing: 'ease-out' },
    );
  }

  // ---------- camera ----------

  /** 'action' (follow the ball) or 'wide' (the whole pitch) for the current view; persisted. */
  setCamera(mode) {
    if (!CAMERA_MODES.includes(mode)) return;
    this.cameraPrefs = saveCameraPref(this.request.view, mode);
    this.hud.set({ camera: mode });
    this.kick();
    this.requestDraw();
  }

  toggleCamera() {
    this.setCamera(this.hud.get().camera === 'action' ? 'wide' : 'action');
  }

  /** What the camera should do for the match on screen. */
  cameraMode(m) {
    if (isReducedMotion()) return 'wide';
    const p = this.presenting;
    if (p === 'replay') return 'follow'; // the replay is always the close-up
    if (p === 'idle' || p === 'ff' || p === 'pens') return 'wide';
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

  /**
   * The engine set up a restart: several players moved further than anyone can run, or the
   * ball was placed somewhere the zoomed camera is not looking.
   */
  jumped(m) {
    const j = this.jump,
      players = m.players,
      b = m.ball,
      same = j.match === m,
      span = m.elapsed - j.elapsed,
      tracked = same && span >= 0 && span < 1,
      reach = JUMP_SPEED * span + 1.5,
      flight = JUMP_BALL_SPEED * span + 3;
    let count = 0;
    for (let i = 0; i < players.length && i < 22; i++) {
      const p = players[i];
      if (tracked && !p.sentOff) {
        const dx = p.x - j.x[i],
          dy = p.y - j.y[i];
        if (dx * dx + dy * dy > reach * reach) count++;
      }
      j.x[i] = p.x;
      j.y[i] = p.y;
    }
    const bx = b.x - j.bx,
      by = b.y - j.by,
      r = this.camera.rect,
      placed =
        tracked &&
        bx * bx + by * by > flight * flight &&
        this.camera.zoomed &&
        (b.x < r.x0 + 2 || b.x > r.x1 - 2 || b.y < r.y0 + 2 || b.y > r.y1 - 2);
    j.bx = b.x;
    j.by = b.y;
    j.match = m;
    j.elapsed = m.elapsed;
    return count >= JUMP_PLAYERS || placed;
  }

  /** Process everything up to now without ticker/overlays (cuts, half-time, instant). */
  catchUp(m) {
    this.processEvents(m, false);
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
    this.ro = new ResizeObserver(() => this.resized());
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

  /** The stage's box changed: size the canvases once it has settled (at once the first time). */
  resized() {
    clearTimeout(this.resizeTimer);
    if (!this.sized) this.resize();
    else this.resizeTimer = setTimeout(() => !this.disposed && this.resize(), RESIZE_SETTLE_MS);
  }

  resize() {
    const c = this.canvas;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.sized = true;
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

  update(real) {
    const speed = this.hud.get().speed;
    // Hit-stop: the picture holds for a few frames; flashes, captions and the camera go on
    let dt = real;
    if (this.hitStop > 0) {
      this.hitStop -= real;
      dt = 0;
    }
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
      case 'pens':
        this.updatePens(real * speed);
        if (this.presenting !== 'pens') return; // straight to the result
        break;
    }
    this.flash = Math.max(0, this.flash - real * 1.6);
    const m = this.presented(),
      p = this.presenting,
      playing = p === 'live' || p === 'reel' || p === 'rewind';
    if (this.flair.on && (this.flair.age += real) >= this.flair.life) this.flair.on = false;
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
    if (p !== 'celebrate')
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
    if (this.steps % RECORD_STEP === 0 && m.mode !== 'shootout') {
      this.ring.push(snapshot(m, this.ring.at(-1)));
      if (this.ring.length > RING_SIZE) this.ring.splice(0, this.ring.length - RING_SIZE);
    }
    return m.finished || m.mode === 'halftime' || m.mode === 'shootout';
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
    // A replay shows the past: keep the live clock, stats and momentum on screen. The shootout
    // reveal writes its own panel and score.
    if ((this.presenting === 'replay' || this.presenting === 'pens') && !force) return;
    this.hudAt = now;
    const patch = {
      clock: matchClock(m.time, m.half),
      period: periodLabel(m),
      minute: minuteLabel(m.time, m.half),
      score: this.score,
      xg: [m.stats[0].xg || 0, m.stats[1].xg || 0],
    };
    const cur = this.hud.get();
    if (cur.score[0] === this.score[0] && cur.score[1] === this.score[1]) patch.score = cur.score;
    const r0 = m.stats[0].redCards || 0,
      r1 = m.stats[1].redCards || 0;
    if (cur.reds[0] !== r0 || cur.reds[1] !== r1) patch.reds = [r0, r1];
    const samples = m.momentum?.samples || [];
    if (samples.length !== cur.momentum.n || force)
      patch.momentum = { samples: samples.map(s => s.values[0] - s.values[1]), n: samples.length };
    if (force || now - this.statsAt > 900) {
      this.statsAt = now;
      patch.stats = this.statsOf(m);
      // 'auto' follows the game state: keep the control's "in effect" mark current
      if (this.live) patch.effective = this.effectiveMentality(this.live);
    }
    if (
      cur.xg[0].toFixed(2) === patch.xg[0].toFixed(2) &&
      cur.xg[1].toFixed(2) === patch.xg[1].toFixed(2)
    )
      patch.xg = cur.xg;
    this.hud.set(patch);
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
    clearTimeout(this.resizeTimer);
    for (const name of Object.keys(this.jobs)) this.cancelJob(name);
    this.awaiting?.cancel();
    this.ro?.disconnect();
    this.io?.disconnect();
    if (this.onVisibility) document.removeEventListener('visibilitychange', this.onVisibility);
  }
}
