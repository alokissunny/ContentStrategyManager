/*
 * Plan generation — lives outside any page so a run can finish after the
 * studio has left Your Plans. YourPlans shows PlanLoom while they watch;
 * GenerationToast in the dashboard shell picks up the result everywhere else.
 */

import { useSyncExternalStore } from 'react';
import { generateRoute } from '../api/routes';

const listeners = new Set();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const IDLE = {
  status: 'idle', // idle | generating | ready | error
  trigger: '',
  route: null,
  expectedWeeks: null,
  error: '',
  startedAt: 0,
  watching: false,
  toast: null, // { kind: 'busy' | 'done' | 'error', text, action?: 'view' }
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
    route: null,
    expectedWeeks: null,
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
    route: null,
    expectedWeeks: null,
    error: '',
    startedAt,
    toast: snapshot.watching ? null : busyToast(),
  });
  inFlight = (async () => {
    try {
      const data = await generateRoute(trigger, extras);
      const route = data.route || data;
      const watching = snapshot.watching;
      set({
        status: 'ready',
        route,
        expectedWeeks: data.expectedWeeks || null,
        error: '',
        toast: watching ? null : doneToast(),
      });
      return data;
    } catch (err) {
      const message = err.response?.data?.message
        || "We couldn't build a plan just now. Please try again.";
      set({
        status: 'error',
        error: message,
        toast: snapshot.watching ? null : { kind: 'error', text: message },
      });
      throw err;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
