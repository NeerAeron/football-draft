// The app's single GameAudio (app/services/sound.js), created lazily, plus a store
// mirroring its mute/volume so Preact controls stay in sync.
//
//   const { on, volume, available } = useStore(soundStore);
//   toggleSound(); setVolume(0.6); playCue('pick-star');
//
// Cues: 'tick' 'lock' 'lock-final' 'reveal' 'pick' 'pick-star' 'pick-superstar' 'kickoff' 'half' 'full' 'goal'
// 'shot' 'save' 'post' 'block' 'tackle' 'dribble' 'foul' 'penalty' 'offside'
// (see GameAudio.play). The first pointer/key event unlocks the AudioContext.
import { createGameAudio } from '../../services/sound.js';
import { createStore } from './store.js';

let audio = null;

export const soundStore = createStore({ on: true, volume: 0.45, available: true });

function sync() {
  const a = getAudio();
  soundStore.set({
    on: a.available && !a.muted && a.volume > 0,
    volume: a.volume,
    available: a.available,
  });
}

export function getAudio() {
  if (!audio) {
    // createGameAudio installs the unlock + visibility listeners.
    audio = createGameAudio();
    sync();
  }
  return audio;
}

export function setSoundOn(on) {
  getAudio().setMuted(!on);
  sync();
}

export function toggleSound() {
  setSoundOn(!soundStore.get().on);
}

export function setVolume(volume) {
  getAudio().setVolume(volume);
  sync();
}

/** Back to defaults without persisting (after "Reset local data"). */
export function resetSound() {
  const a = getAudio();
  a.muted = false;
  a.volume = 0.45;
  a.applyVolume();
  sync();
}

export function playCue(cue, options) {
  getAudio().play(cue, options);
}
