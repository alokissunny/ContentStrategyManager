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
  listeners.forEach((fn) => {
    try { fn(); } catch { /* a debug-panel subscriber must not sink the turn */ }
  });
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

export function fmtElapsed(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1000) return `${Math.round(n)}ms`;
  const sec = n / 1000;
  if (sec < 60) return `${sec < 10 ? sec.toFixed(1) : Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

export function fmtCost(usd) {
  const n = Number(usd);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export function fmtTokens(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return String(Math.round(v));
}

function usageFields(entry = {}) {
  const u = entry.usage && typeof entry.usage === 'object' ? entry.usage : entry;
  const inputTokens = Number(u.inputTokens) || 0;
  const outputTokens = Number(u.outputTokens) || 0;
  const totalTokens = Number(u.totalTokens) || (inputTokens + outputTokens);
  const estimatedCostUsd = Number(u.estimatedCostUsd) || 0;
  if (!totalTokens && !estimatedCostUsd) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
    };
  }
  return { inputTokens, outputTokens, totalTokens, estimatedCostUsd };
}

export function addAiDebugEntry(entry = {}) {
  if (!state.enabled) return;
  const prompt = asText(entry.prompt).trim();
  const output = asText(entry.output).trim();
  const systemPrompt = asText(entry.systemPrompt).trim();
  const elapsedMs = Number(entry.elapsedMs) || 0;
  const usage = usageFields(entry);
  if (!prompt && !output && !String(entry.note || '').trim() && !elapsedMs && !usage.estimatedCostUsd) return;
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    source: String(entry.source || 'AI call'),
    model: String(entry.model || ''),
    prompt,
    output,
    systemPrompt,
    note: String(entry.note || ''),
    elapsedMs,
    ...usage,
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
    if (patch.elapsedMs !== undefined) merged.elapsedMs = Number(patch.elapsedMs) || 0;
    if (
      patch.usage !== undefined
      || patch.estimatedCostUsd !== undefined
      || patch.inputTokens !== undefined
      || patch.outputTokens !== undefined
      || patch.totalTokens !== undefined
    ) {
      Object.assign(merged, usageFields({ ...merged, ...patch, usage: patch.usage || patch }));
    }
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
