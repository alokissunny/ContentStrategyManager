/**
 * Capture idea — one open path for the whole app (bauhly-v3 AppShell).
 * Sidebar (and empty-day menus) call openCaptureIdea(); pages/layout subscribe
 * and mount CaptureChat. Keeps a single home for the control on every route.
 *
 * The landing page opens the same box (bauhly-v3, Nov 5–6: the hero's field
 * grows into Capture). It needs to know whether the box is up — the field
 * fades while it is, and the page's smooth scroll stands down — so the host
 * reports that here and `useCaptureOpen` reads it.
 */
import { useSyncExternalStore } from 'react';

const listeners = new Set();

/* `options` (optional) aims one capture at something specific — Editor mode ›
   Slide › Add before/after passes { opening, savedLine, onSaved }: Capture opens
   on that question, files the capture to the library as usual, then hands it
   back to `onSaved` instead of starting a plan. The landing page passes
   `{ landing: { origin, asks, example, draft } }`. */
export function openCaptureIdea(options = null) {
  listeners.forEach((fn) => {
    try { fn(options); } catch { /* subscriber errors must not block others */ }
  });
}

export function subscribeCaptureIdea(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ── is the box up? (written by CaptureHost) ─────────────────────────────── */
let open = false;
const openListeners = new Set();
export function isCaptureOpen() { return open; }
export function setCaptureOpen(next) {
  const v = Boolean(next);
  if (v === open) return;
  open = v;
  openListeners.forEach((fn) => fn());
}
const subscribeOpen = (fn) => { openListeners.add(fn); return () => openListeners.delete(fn); };
export function useCaptureOpen() {
  return useSyncExternalStore(subscribeOpen, isCaptureOpen, () => false);
}

/* A box opening on its own should not raise a phone's keyboard over what it
   is showing (bauhly-v3, Nov 6). Only a real pointer gets the caret unasked. */
export const canTakeCaret = () => typeof window !== 'undefined'
  && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/* the landing box grows out of what was pressed and shrinks back into it:
   one length for the morph, and a short hold on the way out while what is
   inside it fades first (bauhly-v3 capture-ui.js) */
export const CAPTURE_MORPH_MS = 600;
export const CAPTURE_HOLD_MS = 140;
export const CAPTURE_CLOSE_MS = CAPTURE_MORPH_MS + CAPTURE_HOLD_MS;
