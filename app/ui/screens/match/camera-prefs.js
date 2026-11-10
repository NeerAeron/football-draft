// Camera choice per match view, persisted in localStorage ('football-draft-match-camera'):
// 'action' follows the ball with a moderate zoom, 'wide' shows the whole pitch. Key Moments
// clips default to the action camera, the Full live view to the whole pitch. Goal replays are
// always the close-up; reduced motion never moves the camera, whatever is stored.
import { readJSON, writeJSON } from '../../lib/storage.js';

export const CAMERA_KEY = 'football-draft-match-camera';
export const CAMERA_MODES = ['action', 'wide'];
export const CAMERA_DEFAULTS = Object.freeze({ key: 'action', full: 'wide' });

/** { key, full } — tolerant of missing or broken data. */
export function readCameraPrefs() {
  const saved = readJSON(CAMERA_KEY, null);
  const out = { ...CAMERA_DEFAULTS };
  for (const view of Object.keys(out))
    if (CAMERA_MODES.includes(saved?.[view])) out[view] = saved[view];
  return out;
}

/** Store the choice for one view ('key' | 'full'); returns the new prefs. */
export function saveCameraPref(view, mode) {
  const prefs = readCameraPrefs();
  if (!(view in prefs) || !CAMERA_MODES.includes(mode)) return prefs;
  prefs[view] = mode;
  writeJSON(CAMERA_KEY, prefs);
  return prefs;
}
