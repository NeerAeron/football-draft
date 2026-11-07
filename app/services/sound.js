// Presentation-only audio. No simulation RNG, player stats, or draft odds are used.
import { clamp } from '../core/util/math.js';
const PREFERENCE_KEY = 'football-draft-sound';
const MATCH_CUES = new Set([
  'shot',
  'save',
  'goal',
  'post',
  'block',
  'tackle',
  'dribble',
  'foul',
  'penalty',
  'offside',
]);

export function selectionSound(tier) {
  return tier === 'Superstar' ? 'pick-superstar' : tier === 'Star' ? 'pick-star' : 'pick';
}

// Consume only new, visible action: never replay the event log after a highlight
// cut, unmute, tab switch, or background simulation.
export class MatchSoundEvents {
  constructor(play) {
    this.play = play;
    this.lastId = 0;
    this.elapsed = 0;
  }
  reset(match) {
    this.lastId = match.events[0]?.id || 0;
    this.elapsed = match.elapsed;
  }
  update(match, { audible = true, seek = false } = {}) {
    if (seek || match.elapsed < this.elapsed) {
      this.reset(match);
      return;
    }
    const fresh = [];
    for (const event of match.events) {
      if (event.id <= this.lastId) break;
      fresh.push(event);
    }
    this.reset(match);
    if (!audible) return;
    for (const event of fresh.reverse()) {
      if (!MATCH_CUES.has(event.type) || match.elapsed - event.elapsed > 0.3) continue;
      if (event.type === 'dribble' && (event.strength || 0) < 0.6) continue;
      const x = event.origin?.x ?? match.players[event.playerId]?.x ?? 52.5;
      this.play(event.type, {
        strength: event.strength ?? 0.5,
        shotType: event.shotType,
        pan: clamp((x / 105 - 0.5) * 0.8, -0.4, 0.4),
      });
    }
  }
}

export class GameAudio {
  constructor({ document = globalThis.document, contextFactory, storage } = {}) {
    this.document = document;
    this.contextFactory =
      contextFactory || (() => new (globalThis.AudioContext || globalThis.webkitAudioContext)());
    this.available =
      !!contextFactory || !!(globalThis.AudioContext || globalThis.webkitAudioContext);
    this.context = null;
    this.voices = new Set();
    this.lastPlayed = new Map();
    this.muted = false;
    this.volume = 0.45;
    try {
      this.storage = storage ?? globalThis.localStorage;
      const saved = JSON.parse(this.storage?.getItem(PREFERENCE_KEY) || 'null');
      if (saved) {
        this.muted = saved.muted === true;
        if (Number.isFinite(saved.volume)) this.volume = clamp(saved.volume, 0, 1);
      }
    } catch {}
  }
  unlock() {
    if (!this.available || this.muted || this.volume === 0 || this.document?.hidden) return;
    try {
      if (!this.context) {
        const c = (this.context = this.contextFactory());
        this.master = c.createGain();
        this.master.gain.value = this.volume;
        const limiter = c.createDynamicsCompressor();
        limiter.threshold.value = -12;
        limiter.knee.value = 14;
        limiter.ratio.value = 8;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.18;
        this.master.connect(limiter);
        limiter.connect(c.destination);
        this.noise = c.createBuffer(1, c.sampleRate * 3, c.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.context.state !== 'running') this.context.resume().catch(() => {});
    } catch {
      this.available = false;
    }
  }
  save() {
    try {
      this.storage?.setItem(
        PREFERENCE_KEY,
        JSON.stringify({ muted: this.muted, volume: this.volume }),
      );
    } catch {}
  }
  setMuted(muted) {
    this.muted = !!muted;
    if (this.muted) this.stop();
    else {
      if (!this.volume) this.volume = 0.45;
      this.unlock();
    }
    this.applyVolume();
    this.save();
  }
  setVolume(volume) {
    if (!Number.isFinite(volume)) return;
    this.volume = clamp(volume, 0, 1);
    this.muted = this.volume === 0;
    if (this.muted) this.stop();
    else this.unlock();
    this.applyVolume();
    this.save();
  }
  applyVolume() {
    if (this.context && this.master) {
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, now, 0.015);
    }
  }
  stop() {
    for (const voice of [...this.voices]) {
      try {
        voice.source.stop();
      } catch {}
      voice.cleanup();
    }
    this.lastPlayed.clear();
  }
  voice(source, { duration, gain, delay = 0, attack = 0.004, pan = 0, filter = null }) {
    const c = this.context,
      start = c.currentTime + delay,
      end = start + duration,
      envelope = c.createGain(),
      spatial = c.createStereoPanner?.(),
      nodes = [source, envelope];
    if (filter) {
      source.connect(filter);
      filter.connect(envelope);
      nodes.push(filter);
    } else source.connect(envelope);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(
      Math.max(0.0002, gain),
      start + Math.min(attack, duration * 0.4),
    );
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    if (spatial) {
      spatial.pan.value = pan;
      envelope.connect(spatial);
      spatial.connect(this.master);
      nodes.push(spatial);
    } else envelope.connect(this.master);
    const voice = {
      source,
      cleanup: () => {
        nodes.forEach(node => node.disconnect());
        this.voices.delete(voice);
      },
    };
    source.onended = voice.cleanup;
    this.voices.add(voice);
    source.start(start);
    source.stop(end + 0.02);
  }
  tone(
    frequency,
    endFrequency,
    duration,
    gain,
    { type = 'sine', delay = 0, pan = 0, attack = 0.004 } = {},
  ) {
    const c = this.context,
      o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(frequency, c.currentTime + delay);
    o.frequency.exponentialRampToValueAtTime(endFrequency, c.currentTime + delay + duration);
    this.voice(o, { duration, gain, delay, pan, attack });
  }
  hiss(
    frequency,
    duration,
    gain,
    { delay = 0, attack = 0.004, pan = 0, type = 'bandpass', q = 0.6 } = {},
  ) {
    const c = this.context,
      s = c.createBufferSource(),
      filter = c.createBiquadFilter();
    s.buffer = this.noise;
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    this.voice(s, { duration, gain, delay, attack, pan, filter });
  }
  whistle(count = 1) {
    for (let i = 0; i < count; i++) {
      const delay = i * 0.24,
        duration = i === count - 1 ? 0.34 : 0.15;
      this.tone(2450, 2570, duration, 0.065, { delay, attack: 0.025 });
      this.tone(3320, 3390, duration, 0.024, { delay, attack: 0.025 });
      this.hiss(3700, duration, 0.028, { delay, attack: 0.025 });
    }
  }
  play(cue, { strength = 0.5, shotType = '', pan = 0 } = {}) {
    if (
      !this.available ||
      this.muted ||
      !this.volume ||
      this.document?.hidden ||
      this.context?.state !== 'running'
    )
      return;
    const now = this.context.currentTime,
      cooldown =
        cue === 'tick'
          ? 0.045
          : cue === 'goal'
            ? 1.5
            : ['tackle', 'dribble'].includes(cue)
              ? 0.3
              : 0.08;
    if (now - (this.lastPlayed.get(cue) ?? -10) < cooldown) return;
    this.lastPlayed.set(cue, now);
    if (this.voices.size > 70 && cue !== 'goal') return;
    const s = clamp(strength, 0, 1),
      at = { pan };
    try {
      switch (cue) {
        case 'shot':
          this.tone(145 + s * 75, 48, 0.16, 0.18 + s * 0.14, at);
          this.hiss(shotType === 'Header' ? 720 : 1550, 0.09, 0.13 + s * 0.1, at);
          if (s > 0.7 || shotType === 'Curler' || shotType === 'Knuckleball')
            this.hiss(900, 0.24, 0.075, { ...at, attack: 0.035 });
          break;
        case 'save':
          this.hiss(1250, 0.16, 0.28, at);
          this.tone(115, 52, 0.16, 0.17, at);
          break;
        case 'block':
        case 'tackle':
          this.tone(135, 45, 0.13, 0.17, at);
          this.hiss(650, 0.16, 0.15, at);
          break;
        case 'dribble':
          this.hiss(1700, 0.15, 0.095, { ...at, attack: 0.03 });
          break;
        case 'post':
          [730, 1170, 1910].forEach((f, i) =>
            this.tone(f, f * 0.985, 0.65 - i * 0.1, 0.09 / (i + 1), at),
          );
          this.hiss(2400, 0.06, 0.12, at);
          break;
        case 'goal':
          this.hiss(650, 2.5, 0.85, { attack: 0.32 });
          this.hiss(1700, 2.2, 0.38, { attack: 0.42, delay: 0.08 });
          [261.63, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
            this.tone(f, f, 1.1, 0.13, { type: 'triangle', delay: i * 0.065, attack: 0.018 }),
          );
          break;
        case 'kickoff':
        case 'foul':
        case 'offside':
          this.whistle();
          break;
        case 'penalty':
        case 'half':
          this.whistle(2);
          break;
        case 'full':
          this.whistle(3);
          break;
        case 'tick':
          this.hiss(2100, 0.025, 0.07);
          this.tone(740, 430, 0.028, 0.04);
          break;
        case 'reveal':
          [440, 659.25].forEach((f, i) =>
            this.tone(f, f, 0.25, 0.1, { type: 'triangle', delay: i * 0.065 }),
          );
          break;
        case 'pick':
          [392, 523.25].forEach((f, i) =>
            this.tone(f, f, 0.26, 0.11, { type: 'triangle', delay: i * 0.065 }),
          );
          break;
        case 'pick-star':
          [392, 493.88, 587.33, 783.99].forEach((f, i) =>
            this.tone(f, f, 0.5, 0.12, { type: 'triangle', delay: i * 0.07 }),
          );
          this.hiss(3500, 0.4, 0.035, { delay: 0.14, attack: 0.04 });
          break;
        case 'pick-superstar':
          this.tone(130.81, 130.81, 0.8, 0.16, { attack: 0.018 });
          [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) =>
            this.tone(f, f, 0.85, 0.13, { type: 'triangle', delay: i * 0.075 }),
          );
          this.hiss(4300, 0.8, 0.08, { delay: 0.16, attack: 0.12 });
          this.tone(2093, 2093, 0.65, 0.045, { delay: 0.32 });
          break;
      }
    } catch {
      this.stop();
      this.available = false;
    }
  }
}

export function createGameAudio(options) {
  const sound = new GameAudio(options),
    doc = sound.document;
  for (const type of ['pointerdown', 'keydown', 'click'])
    doc.addEventListener(type, () => sound.unlock(), { capture: true, passive: true });
  doc.addEventListener('visibilitychange', () => {
    if (doc.hidden) sound.stop();
  });
  return sound;
}
