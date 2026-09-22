/*
 * Plan generation — lives outside any page so a run can finish after the
 * studio has left Your Plans. YourPlans shows PlanLoom while they watch;
 * GenerationToast in the dashboard shell picks up the result everywhere else.
 */

import { useSyncExternalStore } from 'react';
import { generatePlan } from '../api/posts';
import { distributionForGenerate } from './distribution';

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
  watching: false,
  toast: null, // { kind: 'busy' | 'done' | 'error' | 'guidance', text, action? }
};

let snapshot = { ...IDLE };
let inFlight = null;

function set(patch) {
  snapshot = { ...snapshot, ...patch };
  emit();
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

export async function startPlanGeneration(trigger, extras = {}) {
  if (snapshot.status === 'generating' || inFlight) return inFlight;
  const startedAt = Date.now();
  set({
    status: 'generating',
    trigger,
    posts: [],
    count: null,
    error: '',
    startedAt,
    toast: snapshot.watching ? null : busyToast(),
  });
  inFlight = (async () => {
    try {
      // Fill onto the studio's chosen publishing weekdays unless the caller
      // already named a distribution.
      const withDist = { ...distributionForGenerate(), ...extras };
      const data = await generatePlan(trigger, withDist);
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
      return data;
    } catch (err) {
      const message = err.response?.data?.message
        || "We couldn't build a plan just now. Please try again.";
      // a 422 with `needsInput` is the strategist asking for a clearer idea, not
      // a failure — surface it as a friendly prompt/CTA, never a red error
      const needsInput = !!err.response?.data?.needsInput;
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
    }
  })();
  return inFlight;
}
