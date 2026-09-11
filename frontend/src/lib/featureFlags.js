import { useSyncExternalStore } from 'react';

/**
 * Client feature flags, persisted per-browser in localStorage. Default OFF.
 * Same external-store shape as aiDebug so components can subscribe with a hook.
 */
const KEYS = {
  videoCover: 'bauhly.ff.videoCover',
};

function readBool(key, fallback = false) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === '1' || raw === 'true';
  } catch {
    return fallback;
  }
}

let state = {
  videoCover: readBool(KEYS.videoCover, false),
};

const listeners = new Set();

function emit() {
  listeners.forEach((fn) => { try { fn(); } catch { /* subscriber must not sink the turn */ } });
}

function setState(patch) {
  state = { ...state, ...patch };
  try {
    if ('videoCover' in patch) localStorage.setItem(KEYS.videoCover, state.videoCover ? '1' : '0');
  } catch {
    // best-effort local cache only
  }
  emit();
}

export function isVideoCoverEnabled() {
  return Boolean(state.videoCover);
}

export function setVideoCoverEnabled(next) {
  setState({ videoCover: Boolean(next) });
}

export function useFeatureFlags() {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => state,
  );
}
