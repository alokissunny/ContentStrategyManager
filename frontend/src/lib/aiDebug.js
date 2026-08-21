import { useSyncExternalStore } from 'react';

const ENABLE_KEY = 'bauhly.debugPrompts';
const OPEN_KEY = 'bauhly.debugPanelOpen';
const LOG_KEY = 'bauhly.debugPromptLog';
const MAX_ENTRIES = 200;

function readBool(key, fallback = false) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === '1' || raw === 'true';
  } catch {
    return fallback;
  }
}

function readEntries() {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

let state = {
  enabled: readBool(ENABLE_KEY, false),
  open: readBool(OPEN_KEY, false),
  entries: readEntries(),
};

const listeners = new Set();

function emit() {
  listeners.forEach((fn) => fn());
}

function persist() {
  try {
    localStorage.setItem(ENABLE_KEY, state.enabled ? '1' : '0');
    localStorage.setItem(OPEN_KEY, state.open ? '1' : '0');
    localStorage.setItem(LOG_KEY, JSON.stringify(state.entries));
  } catch {
    // best-effort local cache only
  }
}

function setState(patch) {
  state = { ...state, ...patch };
  persist();
  emit();
}

export function isAiDebugEnabled() {
  return Boolean(state.enabled);
}

export function setAiDebugEnabled(next) {
  const on = Boolean(next);
  setState({ enabled: on, open: on ? true : false });
}

export function setAiDebugPanelOpen(next) {
  setState({ open: Boolean(next) });
}

export function clearAiDebugEntries() {
  setState({ entries: [] });
}

function asText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function addAiDebugEntry(entry = {}) {
  if (!state.enabled) return;
  const prompt = asText(entry.prompt).trim();
  const output = asText(entry.output).trim();
  const systemPrompt = asText(entry.systemPrompt).trim();
  if (!prompt && !output && !String(entry.note || '').trim()) return;
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    source: String(entry.source || 'AI call'),
    model: String(entry.model || ''),
    prompt,
    output,
    systemPrompt,
    note: String(entry.note || ''),
  };
  const next = [item, ...state.entries].slice(0, MAX_ENTRIES);
  setState({ entries: next });
}

export function updateAiDebugEntry(id, patch = {}) {
  if (!id) return;
  const next = state.entries.map((item) => {
    if (item.id !== id) return item;
    const merged = { ...item };
    if (patch.prompt !== undefined) merged.prompt = asText(patch.prompt);
    if (patch.output !== undefined) merged.output = asText(patch.output);
    if (patch.model !== undefined) merged.model = String(patch.model || '');
    if (patch.note !== undefined) merged.note = String(patch.note || '');
    return merged;
  });
  setState({ entries: next });
}

export function useAiDebug() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}
