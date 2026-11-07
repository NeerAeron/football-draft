// Safe localStorage helpers. Every key this game writes starts with KEY_PREFIX so
// "Reset local data" can clear exactly our keys (GitHub Pages origins are shared).
export const KEY_PREFIX = 'football-draft';

export function readJSON(key, fallback = null) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJSON(key, value) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key) {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {}
}

/** Keys owned by this game (prefix match), e.g. sound, tuning overrides, runs, UI prefs. */
export function ownKeys() {
  try {
    const storage = globalThis.localStorage;
    const keys = [];
    for (let i = 0; i < (storage?.length || 0); i++) {
      const key = storage.key(i);
      if (key?.startsWith(KEY_PREFIX)) keys.push(key);
    }
    return keys.sort();
  } catch {
    return [];
  }
}

export function clearOwnKeys() {
  for (const key of ownKeys()) removeKey(key);
}
