import { useSyncExternalStore } from 'react';

/**
 * Client feature flags, persisted per-browser in localStorage. Default OFF.
 * Same external-store shape as aiDebug so components can subscribe with a hook.
 */
const KEYS = {
  videoCover: 'bauhly.ff.videoCover',
  reelEditor: 'bauhly.ff.reelEditor',
  linkedin: 'bauhly.ff.linkedin',
  htmlThemes: 'bauhly.ff.htmlThemes',
  canva: 'bauhly.ff.canva',
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
  reelEditor: readBool(KEYS.reelEditor, false),
  linkedin: readBool(KEYS.linkedin, false),
  htmlThemes: readBool(KEYS.htmlThemes, false),
  canva: readBool(KEYS.canva, false),
};

const listeners = new Set();

function emit() {
  listeners.forEach((fn) => { try { fn(); } catch { /* subscriber must not sink the turn */ } });
}

function setState(patch) {
  state = { ...state, ...patch };
  try {
    if ('videoCover' in patch) localStorage.setItem(KEYS.videoCover, state.videoCover ? '1' : '0');
    if ('reelEditor' in patch) localStorage.setItem(KEYS.reelEditor, state.reelEditor ? '1' : '0');
    if ('linkedin' in patch) localStorage.setItem(KEYS.linkedin, state.linkedin ? '1' : '0');
    if ('htmlThemes' in patch) localStorage.setItem(KEYS.htmlThemes, state.htmlThemes ? '1' : '0');
    if ('canva' in patch) localStorage.setItem(KEYS.canva, state.canva ? '1' : '0');
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

export function isReelEditorEnabled() {
  return Boolean(state.reelEditor);
}

export function setReelEditorEnabled(next) {
  setState({ reelEditor: Boolean(next) });
}

export function setLinkedInEnabled(next) {
  setState({ linkedin: Boolean(next) });
}

// Editor ⋯ › Theme › HTML themes (experimental interior templates)
export function setHtmlThemesEnabled(next) {
  setState({ htmlThemes: Boolean(next) });
}

// Editor ⋯ › Theme › Design in Canva (Canva MCP, experimental)
export function setCanvaEnabled(next) {
  setState({ canva: Boolean(next) });
}

export function useFeatureFlags() {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => state,
  );
}
