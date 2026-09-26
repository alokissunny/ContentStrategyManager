/**
 * Capture idea — one open path for the whole app (bauhly-v3 AppShell).
 * Sidebar (and empty-day menus) call openCaptureIdea(); pages/layout subscribe
 * and mount CaptureChat. Keeps a single home for the control on every route.
 */

const listeners = new Set();

/* `options` (optional) aims one capture at something specific — Editor mode ›
   Slide › Add before/after passes { opening, savedLine, onSaved }: Capture opens
   on that question, files the capture to the library as usual, then hands it
   back to `onSaved` instead of starting a plan. */
export function openCaptureIdea(options = null) {
  listeners.forEach((fn) => {
    try { fn(options); } catch { /* subscriber errors must not block others */ }
  });
}

export function subscribeCaptureIdea(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
