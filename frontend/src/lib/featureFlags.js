import { useSyncExternalStore } from 'react';

/**
 * Client feature flags, persisted per-browser in localStorage. Default OFF.
 * Same external-store shape as aiDebug so components can subscribe with a hook.
 */
const KEYS = {
  videoCover: 'bauhly.ff.videoCover',
  reelEditor: 'bauhly.ff.reelEditor',
  linkedin: 'bauhly.ff.linkedin',
  themeApplyHtml: 'bauhly.ff.themeApplyHtml',
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
  themeApplyHtml: readBool(KEYS.themeApplyHtml, false),
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
    if ('themeApplyHtml' in patch) localStorage.setItem(KEYS.themeApplyHtml, state.themeApplyHtml ? '1' : '0');
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

// Theme Apply in HTML mode: Claude Opus 5.5 restyles the slide's HTML (slide
// in and out as HTML) instead of the image model repainting a snapshot.
export function isThemeApplyHtmlEnabled() {
  return Boolean(state.themeApplyHtml);
}

export function setThemeApplyHtmlEnabled(next) {
  setState({ themeApplyHtml: Boolean(next) });
}

export function useFeatureFlags() {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => state,
  );
}
