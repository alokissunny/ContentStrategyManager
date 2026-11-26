/*
 * Reels being made, for the floating GenPill — one store for the whole app.
 *
 * Reels run on the server (a worker renders them; see backend reelQueue), so
 * this only asks: GET /capture-reels?recent=1 → reels queued/working and ones
 * finished in the last 12 h. It polls every few seconds while one is being
 * made, rarely otherwise, and at once when a reel is started anywhere
 * (api/captureReels fires `bauhly:reel-started`).
 *
 * `Clear` hides a finished line on this device (localStorage), never the reel.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { listRecentCaptureReels, reelWorking, REEL_STARTED_EVENT } from '../api/captureReels';

const HIDDEN_KEY = 'bauhly.reelJobsHidden';
const FAST_MS = 4000;
const SLOW_MS = 60000;

function loadHidden() {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]');
    return new Set(Array.isArray(v) ? v.slice(-100) : []);
  } catch {
    return new Set();
  }
}
const hidden = loadHidden();
const saveHidden = () => {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden].slice(-100))); } catch { /* private mode */ }
};

let snapshot = { reels: [], loaded: false };
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const visible = (list) => list.filter((r) => !hidden.has(r.id));

let timer = null;
let users = 0;
let fetching = null;

async function refresh() {
  if (fetching) return fetching;
  fetching = listRecentCaptureReels()
    .then((list) => { snapshot = { reels: visible(list), loaded: true }; emit(); })
    .catch(() => { /* offline or signed out: keep what we had */ })
    .finally(() => { fetching = null; schedule(); });
  return fetching;
}

function schedule() {
  window.clearTimeout(timer);
  if (!users) return;
  const live = snapshot.reels.some(reelWorking);
  timer = window.setTimeout(refresh, live ? FAST_MS : SLOW_MS);
}

function onStarted() { refresh(); }

export function useReelJobs() {
  useEffect(() => {
    users += 1;
    if (users === 1) {
      window.addEventListener(REEL_STARTED_EVENT, onStarted);
      refresh();
    }
    return () => {
      users -= 1;
      if (!users) {
        window.clearTimeout(timer);
        window.removeEventListener(REEL_STARTED_EVENT, onStarted);
      }
    };
  }, []);
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

export function clearReelJob(id) {
  hidden.add(id);
  saveHidden();
  snapshot = { ...snapshot, reels: visible(snapshot.reels) };
  emit();
}

export function clearFinishedReelJobs() {
  snapshot.reels.filter((r) => !reelWorking(r)).forEach((r) => hidden.add(r.id));
  saveHidden();
  snapshot = { ...snapshot, reels: visible(snapshot.reels) };
  emit();
}

/* ── the words, shared by the pill and the Reel studio ── */
export const REEL_STEPS = [
  { id: 'reading', say: 'Watching your photos and clips', detail: 'Finding the strongest shots and what is said in each clip.' },
  { id: 'writing', say: 'Writing the hook and the cut', detail: 'Choosing the opening line and the order of the shots.' },
  { id: 'voicing', say: 'Recording the voiceover', detail: 'Reading the script in your voice.' },
  { id: 'scoring', say: 'Composing the music', detail: 'An original track, timed to the cuts.' },
  { id: 'cutting', say: 'Cutting and animating the reel', detail: 'Captions, callouts and transitions on every beat.' },
  { id: 'saving', say: 'Saving it', detail: 'Writing the video file and putting it on your calendar.' },
];
// the render itself is part of 'cutting'
export const reelStepIndex = (stage) => REEL_STEPS.findIndex((s) => s.id === (stage === 'rendering' ? 'cutting' : stage));

export function aboutMin(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (s < 50) return 'less than a minute';
  const m = Math.max(1, Math.round(s / 60));
  return `about ${m} min`;
}

export function clockOf(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// one line for where a reel is: "In line · 2 ahead" / "Cutting and animating the reel"
export function reelStatusLine(r) {
  if (!r) return '';
  if (r.status === 'done') return 'Reel ready';
  if (r.status === 'error') return 'Reel didn’t finish';
  if (r.stage === 'retrying') return 'Trying again';
  if (r.status === 'queued') {
    const ahead = r.queue?.ahead || 0;
    return ahead ? `In line · ${ahead} ${ahead === 1 ? 'reel' : 'reels'} ahead` : 'Starting';
  }
  if (r.browserRender?.state === 'claimed') return `Rendering in your browser · ${r.renderPct || 0}%`;
  if (r.stage === 'rendering') return `Rendering the video · ${r.renderPct || 0}%`;
  const i = reelStepIndex(r.stage);
  return i >= 0 ? REEL_STEPS[i].say : 'Making your reel';
}

/**
 * Open a reel in its Reel studio (Captures page, which reads `openReel` from
 * the route state): the floating pill's "View reel", and every flow that
 * starts a reel — they jump straight to the studio's progress screen.
 */
export function openReelStudio(navigate, reel) {
  if (!reel?.id) return;
  navigate('/dashboard/projects', { state: { openReel: { id: reel.id, captureIds: reel.captureIds || [] } } });
}
