// One clock owns playback. Paused/hidden time and partially accumulated steps
// cannot leak into a resume, including a click between animation frames.
export class PlaybackClock {
  constructor() {
    this.paused = true;
    this.last = null;
    this.accumulator = 0;
  }
  setPaused(value, now) {
    this.paused = Boolean(value);
    this.last = now;
    this.accumulator = 0;
  }
  reset(now) {
    this.setPaused(true, now);
  }
  frame(now, blocked = false) {
    const delta = this.last === null ? 0 : Math.max(0, Math.min((now - this.last) / 1000, 0.1));
    this.last = now;
    return this.paused || blocked ? 0 : delta;
  }
  ticks(delta) {
    this.accumulator += delta;
    const count = Math.floor((this.accumulator + 1e-10) * 60);
    this.accumulator -= count / 60;
    return count;
  }
}
