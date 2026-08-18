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
 *   { id, type: 'note'|'photo'|'video', text, createdAt,
 *     attachments: [{ id, type: 'image'|'video', key, url, thumbnailUrl }] }
 */

import { useEffect } from 'react';
import { useSyncExternalStore } from 'react';
import * as api from '../api/projects';

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
export async function addEntry(projectId, { type, text, attachments }) {
  upsert(await api.addCapture(projectId, {
    type,
    text,
    attachments: (attachments || []).map((a) => ({ type: a.type, key: a.key })),
  }));
}
export async function updateEntry(projectId, entryId, patch) {
  const payload = {};
  if (patch.text !== undefined) payload.text = patch.text;
  if (patch.attachments !== undefined) payload.attachments = patch.attachments.map((a) => ({ type: a.type, key: a.key }));
  upsert(await api.updateCapture(projectId, entryId, payload));
}
export async function deleteEntry(projectId, entryId) {
  upsert(await api.deleteCapture(projectId, entryId));
}
export async function moveEntry(fromId, toId, entryId) {
  const { from, to } = await api.moveCapture(fromId, toId, entryId);
  upsert(from);
  upsert(to);
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
    if (im) return im.thumbnailUrl;
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
