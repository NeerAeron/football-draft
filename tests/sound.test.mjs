import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio, MatchSoundEvents, selectionSound } from '../app/sound.js';

const match = () => ({ elapsed: 10, events: [], players: [{ x: 90 }] });
const event = (id, type, elapsed = 10, extra = {}) => ({
  id,
  type,
  elapsed,
  playerId: 0,
  ...extra,
});
test('visible actions sound once; resolving a shot and refreshing the UI do not repeat it', () => {
  const played = [],
    audio = new MatchSoundEvents((cue, options) => played.push({ cue, ...options })),
    m = match();
  m.events = [event(2, 'shot', 10, { strength: 0.9, shotType: 'Knuckleball' }), event(1, 'pass')];
  audio.update(m);
  audio.update(m);
  m.events[0].outcome = 'saved';
  m.elapsed = 10.15;
  m.events.unshift(event(3, 'save', 10.15));
  audio.update(m);
  assert.deepEqual(
    played.map(e => e.cue),
    ['shot', 'save'],
  );
  assert.equal(played[0].strength, 0.9);
  assert.equal(played[0].shotType, 'Knuckleball');
  assert.ok(played[0].pan > 0);
});
test('highlight jumps, muted updates, old events and rewinds never dump past sounds', () => {
  const played = [],
    audio = new MatchSoundEvents(cue => played.push(cue)),
    m = match();
  m.events = [event(1, 'goal', 9)];
  audio.update(m);
  assert.equal(played.length, 0);
  m.elapsed = 40;
  m.events.unshift(event(2, 'goal', 40));
  audio.update(m, { seek: true });
  audio.update(m);
  m.elapsed = 41;
  m.events.unshift(event(3, 'shot', 41));
  audio.update(m, { audible: false });
  audio.update(m);
  assert.equal(played.length, 0);
  m.elapsed = 41.1;
  m.events.unshift(event(4, 'save', 41.1));
  audio.update(m);
  assert.deepEqual(played, ['save']);
  m.elapsed = 10;
  m.events = [event(1, 'goal', 10)];
  audio.update(m);
  assert.deepEqual(played, ['save']);
});
test('routine touches stay quiet and only strong take-ons get a cue', () => {
  const played = [],
    audio = new MatchSoundEvents(cue => played.push(cue)),
    m = match();
  m.events = [
    event(5, 'dribble', 10, { strength: 0.8 }),
    event(4, 'dribble', 10, { strength: 0.3 }),
    event(3, 'intercept'),
    event(2, 'restart'),
    event(1, 'through'),
  ];
  audio.update(m);
  assert.deepEqual(played, ['dribble']);
});

class Param {
  constructor() {
    this.value = 0;
    this.events = [];
  }
  setValueAtTime(v, t) {
    assert.ok(Number.isFinite(v) && Number.isFinite(t));
    this.events.push([v, t]);
  }
  exponentialRampToValueAtTime(v, t) {
    assert.ok(v > 0 && Number.isFinite(t));
    this.events.push([v, t]);
  }
  setTargetAtTime(v, t) {
    this.value = v;
    this.events.push([v, t]);
  }
  cancelScheduledValues() {}
}
class Node {
  constructor() {
    for (const key of [
      'gain',
      'frequency',
      'pan',
      'Q',
      'threshold',
      'knee',
      'ratio',
      'attack',
      'release',
    ])
      this[key] = new Param();
    this.stops = [];
  }
  connect() {}
  disconnect() {
    this.disconnected = true;
  }
  start(t) {
    this.startTime = t;
  }
  stop(t) {
    this.stops.push(t);
  }
}
class Context {
  constructor() {
    this.currentTime = 0;
    this.state = 'suspended';
    this.sampleRate = 8000;
    this.destination = new Node();
    this.sources = [];
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  createGain() {
    return new Node();
  }
  createStereoPanner() {
    return new Node();
  }
  createDynamicsCompressor() {
    return new Node();
  }
  createBiquadFilter() {
    return new Node();
  }
  createOscillator() {
    const n = new Node();
    this.sources.push(n);
    return n;
  }
  createBufferSource() {
    return this.createOscillator();
  }
  createBuffer(channels, length) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
}
function fixture() {
  const document = { hidden: false, querySelectorAll: () => [] },
    values = new Map(),
    storage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) };
  let created = 0;
  const context = new Context(),
    sound = new GameAudio({
      document,
      storage,
      contextFactory: () => {
        created++;
        return context;
      },
    });
  return {
    sound,
    context,
    document,
    storage,
    get created() {
      return created;
    },
  };
}
test('audio starts only after a gesture; mute stops active and scheduled sounds and persists', () => {
  const f = fixture();
  f.sound.play('goal');
  assert.equal(f.created, 0);
  f.sound.unlock();
  f.sound.play('pick-superstar');
  assert.equal(f.created, 1);
  assert.ok(f.sound.voices.size > 0);
  const sources = [...f.context.sources];
  assert.ok(sources.some(n => n.startTime > 0));
  f.sound.setMuted(true);
  assert.equal(f.sound.voices.size, 0);
  assert.ok(sources.every(n => n.disconnected && n.stops.length === 2));
  f.sound.play('goal');
  assert.equal(f.context.sources.length, sources.length);
  const restored = new GameAudio({
    document: f.document,
    storage: f.storage,
    contextFactory: () => {
      throw Error('should stay muted');
    },
  });
  restored.unlock();
  assert.equal(restored.muted, true);
  assert.equal(restored.context, null);
  f.sound.setVolume(0.25);
  assert.equal(f.sound.muted, false);
  assert.equal(f.sound.master.gain.value, 0.25);
  f.sound.setVolume(0);
  assert.equal(f.sound.voices.size, 0);
  f.sound.setMuted(false);
  assert.equal(f.sound.volume, 0.45);
});
test('hidden or suspended audio is discarded; rapid duplicate cues are throttled', () => {
  const f = fixture();
  f.sound.unlock();
  f.document.hidden = true;
  f.sound.play('goal');
  assert.equal(f.context.sources.length, 0);
  f.document.hidden = false;
  f.context.state = 'suspended';
  f.sound.play('goal');
  assert.equal(f.context.sources.length, 0);
  f.sound.unlock();
  f.sound.play('tick');
  const count = f.context.sources.length;
  f.sound.play('tick');
  assert.equal(f.context.sources.length, count);
  f.context.currentTime = 0.1;
  f.sound.play('tick');
  assert.ok(f.context.sources.length > count);
});
test('all sound recipes schedule finite, bounded voices and release their nodes', () => {
  const f = fixture();
  f.sound.unlock();
  for (const cue of [
    'shot',
    'save',
    'goal',
    'post',
    'block',
    'tackle',
    'dribble',
    'kickoff',
    'foul',
    'penalty',
    'offside',
    'half',
    'full',
    'tick',
    'reveal',
    'pick',
    'pick-star',
    'pick-superstar',
  ]) {
    f.sound.play(cue, { strength: 0.9, shotType: 'Knuckleball' });
    assert.ok(f.sound.voices.size > 0, cue);
    for (const voice of [...f.sound.voices]) {
      assert.ok(voice.source.stops[0] - voice.source.startTime < 3);
      voice.source.onended();
    }
    assert.equal(f.sound.voices.size, 0);
    f.context.currentTime += 4;
  }
});
test('Star and Superstar selections have distinct, increasingly prominent cues', () => {
  const f = fixture();
  f.sound.unlock();
  const durations = [];
  for (const tier of ['Starter', 'Star', 'Superstar']) {
    const start = f.context.sources.length;
    f.sound.play(selectionSound(tier));
    const sources = f.context.sources.slice(start);
    durations.push(Math.max(...sources.map(s => s.stops[0])));
    f.sound.stop();
  }
  assert.ok(durations[0] < durations[1] && durations[1] < durations[2]);
  assert.equal(selectionSound('Bench'), selectionSound('Normal'));
});
test('a browser that cannot start audio keeps the game usable', () => {
  const sound = new GameAudio({
    document: { querySelectorAll: () => [] },
    contextFactory: () => {
      throw Error('Audio unavailable');
    },
    storage: { getItem: () => null },
  });
  assert.doesNotThrow(() => sound.unlock());
  assert.equal(sound.available, false);
  assert.doesNotThrow(() => sound.play('shot'));
  const f = fixture();
  f.sound.unlock();
  f.context.createOscillator = () => {
    throw Error('Audio device interrupted');
  };
  assert.doesNotThrow(() => f.sound.play('pick-star'));
  assert.equal(f.sound.available, false);
});
