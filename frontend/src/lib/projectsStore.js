/*
 * Projects store — Bauhly's long-term memory, backed by the API.
 *
 * A tiny external store over the /api/projects endpoints: a cache the app reads
 * synchronously via useProjects(), hydrated once on first mount and kept fresh
 * as mutations return the updated project. Media lives in S3 — uploads go
 * browser→S3 with presigned PUT URLs (see api/projects.uploadFiles), and the
 * server returns short-lived presigned read URLs on every attachment.
 *
 * Entry (capture) shape returned by the API:
 *   { id, type: 'note'|'photo'|'video', text, createdAt, understanding,
 *     sessionId, sessionKind, sessionSummary, stories,
 *     attachments: [{ id, type: 'image'|'video', key, url, thumbnailUrl }] }
 */

import { useEffect } from 'react';
import { useSyncExternalStore } from 'react';
import * as api from '../api/projects';
import { previewUrl } from '../api/media';

export { uploadFiles } from '../api/projects';

/* ── the cache + pub/sub ────────────────────────────────────────────────── */
let cache = [];
let hydrated = false; // has the first fetch resolved? (avoids an empty flash)
let loaded = false;
let loading = null;
const listeners = new Set();

function emit() { listeners.forEach((l) => l()); }
function subscribe(l) { listeners.add(l); return () => listeners.delete(l); }
const bySorted = (arr) => [...arr].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

function setAll(projects) { cache = bySorted(projects); emit(); }
function upsert(project) {
  if (!project) return;
  const rest = cache.filter((p) => p.id !== project.id);
  cache = bySorted([...rest, project]);
  emit();
}
function removeById(id) { cache = cache.filter((p) => p.id !== id); emit(); }

async function load() {
  const projects = await api.listProjects();
  hydrated = true;
  setAll(projects);
}
function ensureLoaded() {
  if (loaded) return loading;
  loaded = true;
  loading = load().catch((err) => { loaded = false; throw err; });
  return loading;
}

/** Force a fresh fetch — used when opening Your plans so wordless photos show up. */
export async function refreshProjects() {
  loaded = true;
  loading = load().catch((err) => { loaded = false; throw err; });
  return loading;
}

/** Drop the in-memory cache — used when the header switches Instagram account. */
export function resetProjects() {
  cache = [];
  hydrated = false;
  loaded = false;
  loading = null;
  emit();
}

export function useProjects() {
  const projects = useSyncExternalStore(subscribe, () => cache);
  useEffect(() => { ensureLoaded(); }, []);
  return projects;
}

// True once the first fetch has resolved — lets the page hold the empty state
// until it knows there really is nothing, rather than flashing it on load.
export function useProjectsHydrated() {
  return useSyncExternalStore(subscribe, () => hydrated);
}

/* ── mutations (optimistic where it helps, always reconciled to the server) ─ */
export async function createProject(name) {
  const project = await api.createProject(name);
  upsert(project);
  return project.id;
}
export async function renameProject(id, name) {
  upsert(await api.renameProject(id, name));
}
export async function deleteProject(id) {
  await api.deleteProject(id);
  removeById(id);
}
export async function addEntry(projectId, {
  type, text, attachments, understanding, sessionId, sessionKind, sessionSummary, stories,
}) {
  upsert(await api.addCapture(projectId, {
    type,
    text,
    understanding: understanding || undefined,
    sessionId,
    sessionKind,
    sessionSummary,
    stories,
    attachments: (attachments || []).map((a) => ({ type: a.type, key: a.key })),
  }));
}

function uniqueTexts(parts) {
  return [...new Set((parts || []).map((s) => String(s || '').trim()).filter(Boolean))].join('\n\n');
}

function byChronological(a, b) {
  const cmp = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  if (cmp) return cmp;
  return String(a.id || '').localeCompare(String(b.id || ''));
}

function storiesInToldOrder(stories) {
  return [...(stories || [])].sort((a, b) => {
    const sa = String(a?.segmentId || a?.captureId || a?.id || '');
    const sb = String(b?.segmentId || b?.captureId || b?.id || '');
    if (sa && sb && sa !== sb) return sa.localeCompare(sb, undefined, { numeric: true });
    return 0;
  });
}

export function composeSessionSummary(stories, fallbackText) {
  const ordered = storiesInToldOrder(stories);
  const parts = [...new Set(ordered.map((s) => String(s?.summary || '').trim()).filter(Boolean))];
  if (parts.length) return parts.join('\n\n');
  return String(fallbackText || '').trim();
}

/** File one capture or check-in conversation as a single library session. */
export async function addSession(projectId, {
  type, text, attachments, understanding, understandings, conversationSummary, sessionKind,
}) {
  const stories = storiesInToldOrder(
    (understandings && understandings.length)
      ? understandings.filter(Boolean)
      : (understanding ? [understanding] : []),
  );
  const sessionSummary = String(conversationSummary || '').trim()
    || composeSessionSummary(stories, text);
  return addEntry(projectId, {
    type,
    text: sessionSummary || text,
    attachments,
    understanding: stories[0],
    stories,
    sessionId: (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `session-${Date.now()}`,
    sessionKind: sessionKind || 'capture',
    sessionSummary,
  });
}

export async function updateEntry(projectId, entryId, patch) {
  const payload = {};
  if (patch.text !== undefined) payload.text = patch.text;
  if (patch.sessionSummary !== undefined) payload.sessionSummary = patch.sessionSummary;
  if (patch.attachments !== undefined) payload.attachments = patch.attachments.map((a) => ({ type: a.type, key: a.key }));
  upsert(await api.updateCapture(projectId, entryId, payload));
}
export async function deleteEntry(projectId, entryId) {
  upsert(await api.deleteCapture(projectId, entryId));
}
export async function deleteSession(projectId, memberIds) {
  const ids = [...new Set((memberIds || []).filter(Boolean))];
  if (!ids.length) return;
  let project;
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    project = await api.deleteCapture(projectId, id);
  }
  if (project) upsert(project);
}
export async function moveEntry(fromId, toId, entryId) {
  const { from, to } = await api.moveCapture(fromId, toId, entryId);
  upsert(from);
  upsert(to);
}
export async function moveSession(fromId, toId, memberIds) {
  const ids = [...new Set((memberIds || []).filter(Boolean))];
  let from;
  let to;
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const res = await api.moveCapture(fromId, toId, id);
    from = res.from;
    to = res.to;
  }
  if (from) upsert(from);
  if (to) upsert(to);
}
// AI analysis — the server returns the whole project with each analysed
// attachment's `analysis` populated, so we just reconcile the cache to it.
export async function analyzeProjectAssets(projectId, opts) {
  const { project, analyzed, usage } = await api.analyzeProject(projectId, opts);
  upsert(project);
  return { analyzed, usage };
}
export async function analyzeAsset(projectId, captureId, attachmentId) {
  upsert(await api.analyzeAsset(projectId, captureId, attachmentId));
}

/* ── read helpers (pure) ────────────────────────────────────────────────── */
export function coverOf(p) {
  for (const e of p.captures || []) {
    const im = (e.attachments || []).find((a) => a.type === 'image');
    if (im) return previewUrl(im);
  }
  return null;
}

/* ── week grouping (local time) ─────────────────────────────────────────── */
function weekStart(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday = 0
  return x;
}
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function weekLabel(key, now = new Date()) {
  const diff = Math.round((weekStart(now).getTime() - weekStart(parseYmd(key)).getTime()) / (7 * 86400000));
  if (diff <= 0) return 'This week';
  if (diff === 1) return 'Last week';
  return `${diff} weeks ago`;
}
export function groupByWeek(entries) {
  const map = new Map();
  (entries || []).forEach((c) => {
    const key = ymd(weekStart(new Date(c.createdAt)));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(c);
  });
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, list]) => ({
      key,
      label: weekLabel(key),
      entries: [...list].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    }));
}

export function sessionDisplayText(entry) {
  const stories = Array.isArray(entry?.stories) ? entry.stories : [];
  const fromStories = uniqueTexts(stories.map((s) => s?.summary));
  if (fromStories.includes('\n\n')) return fromStories;
  const summary = String(entry?.sessionSummary || '').trim();
  if (summary) return summary;
  if (fromStories) return fromStories;
  const u = entry?.understanding;
  if (u?.summary) return String(u.summary).trim();
  return String(entry?.text || '').trim();
}

function mergeAttachments(members) {
  const seen = new Set();
  const out = [];
  (members || []).forEach((c) => {
    (c.attachments || []).forEach((a) => {
      const k = a.key || a.id;
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push(a);
    });
  });
  return out;
}

function sessionFromMembers(members) {
  const chrono = [...members].sort(byChronological);
  const newest = chrono[chrono.length - 1] || chrono[0];
  const stories = chrono.flatMap((c) => {
    const rows = Array.isArray(c.stories) && c.stories.length
      ? c.stories
      : (c.understanding ? [c.understanding] : []);
    return members.length === 1 ? storiesInToldOrder(rows) : rows;
  });
  // Prefer per-story summaries in told order over a stored blob that may be reversed.
  const fromStories = uniqueTexts(stories.map((s) => s?.summary));
  const sessionSummary = fromStories
    || uniqueTexts(chrono.map((c) => c.sessionSummary))
    || uniqueTexts(chrono.map((c) => c.text));
  return {
    ...newest,
    memberIds: chrono.map((c) => c.id).filter(Boolean),
    attachments: mergeAttachments(chrono),
    stories,
    sessionSummary,
    text: sessionSummary,
    createdAt: newest.createdAt,
  };
}

/** One library card per capture/check-in conversation. New rows share sessionId;
 *  older split saves (same second) are grouped by a short time burst. */
export function groupCapturesIntoSessions(captures) {
  const list = [...(captures || [])].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const used = new Set();
  const sessions = [];
  const bySessionId = new Map();
  list.forEach((c) => {
    const sid = String(c.sessionId || '').trim();
    if (!sid) return;
    if (!bySessionId.has(sid)) bySessionId.set(sid, []);
    bySessionId.get(sid).push(c);
  });
  bySessionId.forEach((members) => {
    members.forEach((c) => used.add(c.id));
    sessions.push(sessionFromMembers(members));
  });

  const BURST_MS = 8000;
  const rest = list.filter((c) => !used.has(c.id));
  let burst = [];
  rest.forEach((c) => {
    if (!burst.length) {
      burst = [c];
      return;
    }
    const prev = new Date(burst[burst.length - 1].createdAt || 0).getTime();
    const t = new Date(c.createdAt || 0).getTime();
    if (prev && t && Math.abs(prev - t) <= BURST_MS) burst.push(c);
    else {
      sessions.push(sessionFromMembers(burst));
      burst = [c];
    }
  });
  if (burst.length) sessions.push(sessionFromMembers(burst));
  return sessions.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export function sessionCount(project) {
  return groupCapturesIntoSessions(project?.captures).length;
}

/* Today / Yesterday / Mon D, all with 24h HH:MM */
const two = (n) => String(n).padStart(2, '0');
export function fmtWhen(iso) {
  const d = new Date(iso);
  const now = new Date();
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const same = (a, b) => a.toDateString() === b.toDateString();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (same(d, now)) return `Today, ${time}`;
  if (same(d, y)) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
}
