/*
 * Plan generation — lives outside any page so a run can finish after the
 * studio has left Your Plans. YourPlans shows PlanLoom while they watch;
 * GenPill (the generation queue) in the dashboard shell shows every run, everywhere.
 */

import { useSyncExternalStore } from 'react';
import { generatePlan, getActivePlanRun, ingestPlanDebug, waitForPlanRun } from '../api/posts';
import { distributionForGenerate } from './distribution';
import { getActiveHandle } from './store';

const listeners = new Set();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const IDLE = {
  status: 'idle', // idle | generating | ready | error | needs-input
  trigger: '',
  posts: [],
  count: null,
  error: '',
  guidance: '', // a soft "needs more context" note (not an error) — the
  // strategist asked for a clearer idea/visual; the UI shows it as a prompt/CTA
  startedAt: 0,
  // the queued run's own stage while it runs ('queued' | 'planning' | 'writing' | 'finalizing'), '' when
  // the backend does not report one (no PLAN_QUEUE) — the onboarding Capture's progress reads it
  phase: '',
  watching: false,
  // the post this run makes opens straight in the Editor (a landing visitor's first post)
  openEditor: false,
  toast: null, // { kind: 'busy' | 'done' | 'error' | 'guidance', text, action? }
  // the generation queue's history (GenPill, bauhly-v3 decision 735): one line per request to make posts
  jobs: [],
};

/* ── THE QUEUE'S LINES (bauhly-v3 GenPill / lib/postrun.js postJobs) ─────────────────────────────────────────────
   Every request to make posts is a line: { id, handle, trigger, label, status: 'queued'|'running'|'done'|'failed',
   phase, at, endedAt, posts: [{ _id, date, kind, slides }], message, needsInput, seen }. Only one run goes to the
   server at a time; a capture filed while one is running waits as `queued` and the next run starts when it ends.
   Kept in localStorage so the history survives a reload; `Clear` removes a line, never the post it made. */
const JOBS_KEY = 'bauhly.genJobs';
const JOBS_MAX = 20;
function loadJobs() {
  try {
    const list = JSON.parse(localStorage.getItem(JOBS_KEY) || '[]');
    // a run that was going when the page went away is picked up by resumePlanGeneration, not by its old line
    return (Array.isArray(list) ? list : []).filter((j) => j && j.id && (j.status === 'done' || j.status === 'failed'));
  } catch {
    return [];
  }
}
function saveJobs(jobs) {
  try { localStorage.setItem(JOBS_KEY, JSON.stringify(jobs.slice(-JOBS_MAX))); } catch { /* private mode: this tab still knows */ }
}

let snapshot = { ...IDLE, jobs: loadJobs() };
let inFlight = null;
const queuedRuns = []; // [{ jobId, trigger, extras, resolve, reject }]

function set(patch) {
  snapshot = { ...snapshot, ...patch };
  if (patch.jobs) saveJobs(patch.jobs);
  emit();
}

let jobSeq = 0;
function newJob(trigger, extras, status) {
  const label = String(extras?.label || '').replace(/\s+/g, ' ').trim();
  return {
    id: `gj-${Date.now().toString(36)}-${(jobSeq += 1)}`,
    handle: getActiveHandle() || '',
    trigger,
    label,
    status,
    phase: '',
    at: Date.now(),
    endedAt: 0,
    posts: [],
    message: '',
    needsInput: false,
    seen: false,
  };
}
function patchJob(id, patch) {
  if (!id) return;
  set({ jobs: snapshot.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) });
}
function addJob(job) {
  set({ jobs: [...snapshot.jobs, job].slice(-JOBS_MAX) });
}
function postsOf(list) {
  return (Array.isArray(list) ? list : []).map((p) => {
    const slides = Array.isArray(p?.content?.slides) ? p.content.slides.length : 0;
    const kind = slides > 1 || p?.format === 'Carousel' ? 'Carousel'
      : p?.format === 'Reel' ? 'Reel'
        : p?.format === 'Story' ? 'Story' : 'Single post';
    return { _id: String(p?._id || ''), date: String(p?.date || '').slice(0, 10), kind, slides };
  }).filter((p) => p._id);
}

/* `Clear`: the line leaves the list; the post stays on the plan */
export function clearGenJob(id) {
  set({ jobs: snapshot.jobs.filter((j) => j.id !== id) });
}
/* `Clear all`: what has finished leaves; what is still being made stays */
export function clearFinishedGenJobs() {
  const handle = getActiveHandle() || '';
  set({ jobs: snapshot.jobs.filter((j) => (j.handle && j.handle !== handle) || j.status === 'queued' || j.status === 'running') });
}
export function markGenJobSeen(id) {
  const j = snapshot.jobs.find((x) => x.id === id);
  if (j && !j.seen) patchJob(id, { seen: true });
}
/* `Try again` on a line that did not finish: a fresh run with the same trigger and words */
export function retryGenJob(id) {
  const j = snapshot.jobs.find((x) => x.id === id);
  if (!j) return null;
  clearGenJob(id);
  return startPlanGeneration(j.trigger || 'generate', { label: j.label }).catch(() => null);
}

/* ── VIEW POST: the calendar opens the post's day in Day view (YourPlans listens) ─────────────────────────────── */
const openListeners = new Set();
let pendingOpen = null;
export function requestOpenPostDay(iso) {
  pendingOpen = { iso, at: Date.now() };
  openListeners.forEach((fn) => fn(pendingOpen));
}
export function subscribeOpenPostDay(fn) {
  openListeners.add(fn);
  if (pendingOpen && Date.now() - pendingOpen.at < 5000) fn(pendingOpen);
  return () => openListeners.delete(fn);
}
export function takePendingOpen() {
  const p = pendingOpen;
  pendingOpen = null;
  return p;
}

function busyToast() {
  return { kind: 'busy', text: 'Building your plan…' };
}

function doneToast() {
  return { kind: 'done', text: 'Your plan is ready.', action: 'view' };
}

export function getPlanGeneration() {
  return snapshot;
}

export function usePlanGeneration() {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

export function setPlanWatching(watching) {
  const next = Boolean(watching);
  if (snapshot.watching === next) return;
  let { toast } = snapshot;
  if (!next && snapshot.status === 'generating') toast = busyToast();
  else if (next && toast?.kind === 'busy') toast = null;
  else if (!next && snapshot.status === 'ready' && !toast) toast = doneToast();
  set({ watching: next, toast });
}

export function dismissPlanToast() {
  if (!snapshot.toast) return;
  set({ toast: null });
}

export function consumePlanReady() {
  if (snapshot.status !== 'ready') return null;
  const taken = snapshot;
  set({
    status: 'idle',
    trigger: '',
    posts: [],
    count: null,
    toast: snapshot.toast?.kind === 'done' ? null : snapshot.toast,
  });
  return taken;
}

/* ── A FIRST-TIME STUDIO LANDS IN THE EDITOR (Nov 10) ─────────────────────────────────────────────
   A visitor who has just made their account from the landing page's Capture goes from the generation
   straight into Editor mode on the post it made, not back to the calendar. Kept in sessionStorage too,
   so a reload during the run still lands there (YourPlans reads it when the run is ready). */
const OPEN_EDITOR_KEY = 'bauhly.openEditorAfterGen';
export function openNextInEditor() {
  try { sessionStorage.setItem(OPEN_EDITOR_KEY, '1'); } catch { /* private mode: this tab still knows */ }
  set({ openEditor: true });
}
export function takeOpenInEditor() {
  let stored = false;
  try { stored = sessionStorage.getItem(OPEN_EDITOR_KEY) === '1'; sessionStorage.removeItem(OPEN_EDITOR_KEY); } catch { /* ok */ }
  const want = snapshot.openEditor || stored;
  if (snapshot.openEditor) set({ openEditor: false });
  return want;
}

export async function startPlanGeneration(trigger, extras = {}) {
  if (snapshot.status === 'generating' || inFlight) {
    // one run at a time: this request waits as a queued line and runs when the current one ends
    const job = newJob(trigger, extras, 'queued');
    addJob(job);
    return new Promise((resolve, reject) => {
      queuedRuns.push({ jobId: job.id, trigger, extras, resolve, reject });
    });
  }
  const job = newJob(trigger, extras, 'running');
  addJob(job);
  return runFor(job.id, trigger, extras);
}

function runFor(jobId, trigger, extras = {}) {
  // Fill onto the studio's chosen publishing weekdays unless the caller
  // already named a distribution.
  const onProgress = (run) => {
    if (snapshot.status === 'generating' && run?.status && run.status !== snapshot.phase) {
      set({ phase: run.status });
      patchJob(jobId, { phase: run.status });
    }
  };
  const { label, ...rest } = extras || {};
  return track(trigger, Date.now(), () => generatePlan(trigger, { ...distributionForGenerate(), ...rest, onProgress }), jobId);
}

/* the next queued request, once the run before it has ended and the calendar has had a moment to take its
   result (YourPlans holds a finished run for up to 1.8s before it reloads) */
function runNextQueued() {
  if (!queuedRuns.length || inFlight || snapshot.status === 'generating') return;
  window.setTimeout(() => {
    if (!queuedRuns.length || inFlight || snapshot.status === 'generating') return;
    const next = queuedRuns.shift();
    if (!snapshot.jobs.some((j) => j.id === next.jobId)) { runNextQueued(); return; }
    patchJob(next.jobId, { status: 'running', at: Date.now() });
    runFor(next.jobId, next.trigger, next.extras).then(next.resolve, next.reject);
  }, 2200);
}

// A reload (or a new tab / app restart) loses the wait above, but a queued
// run keeps going on the server. On load, pick up the handle's run in
// progress so the plan lands without a manual refresh.
let resumeChecked = false;
export async function resumePlanGeneration() {
  if (resumeChecked || snapshot.status === 'generating' || inFlight) return inFlight;
  resumeChecked = true;
  let run = null;
  try {
    run = await getActivePlanRun();
  } catch {
    return null;
  }
  if (!run?.runId || snapshot.status === 'generating' || inFlight) return inFlight;
  const trigger = run.trigger || 'resume';
  const job = newJob(trigger, { label: '' }, 'running');
  job.phase = run.status || '';
  addJob(job);
  return track(trigger, Date.now(), async () => {
    const data = await waitForPlanRun(run.runId);
    ingestPlanDebug(`Generate posts (${trigger}, resumed)`, data);
    return data;
  }, job.id).catch(() => null);
}

function track(trigger, startedAt, run, jobId = null) {
  set({
    status: 'generating',
    trigger,
    phase: '',
    posts: [],
    count: null,
    error: '',
    startedAt,
    toast: snapshot.watching ? null : busyToast(),
  });
  inFlight = (async () => {
    try {
      const data = await run();
      const posts = Array.isArray(data.posts) ? data.posts : [];
      const watching = snapshot.watching;
      set({
        status: 'ready',
        posts,
        count: Number(data.count) || posts.length || null,
        error: '',
        guidance: '',
        toast: watching ? null : doneToast(),
      });
      patchJob(jobId, { status: 'done', endedAt: Date.now(), posts: postsOf(posts) });
      return data;
    } catch (err) {
      const message = err.response?.data?.message
        || "We couldn't build a plan just now. Please try again.";
      // a 422 with `needsInput` is the strategist asking for a clearer idea, not
      // a failure — surface it as a friendly prompt/CTA, never a red error
      const needsInput = !!err.response?.data?.needsInput;
      patchJob(jobId, { status: 'failed', endedAt: Date.now(), message, needsInput });
      if (needsInput) {
        set({
          status: 'needs-input',
          error: '',
          guidance: message,
          toast: snapshot.watching ? null : { kind: 'guidance', text: message, action: 'capture' },
        });
      } else {
        set({
          status: 'error',
          error: message,
          guidance: '',
          toast: snapshot.watching ? null : { kind: 'error', text: message },
        });
      }
      throw err;
    } finally {
      inFlight = null;
      runNextQueued();
    }
  })();
  return inFlight;
}
