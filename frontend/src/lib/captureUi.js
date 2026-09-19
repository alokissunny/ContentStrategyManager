/**
 * Capture idea — one open path for the whole app (bauhly-v3 AppShell).
 * Sidebar (and empty-day menus) call openCaptureIdea(); pages/layout subscribe
 * and mount CaptureChat. Keeps a single home for the control on every route.
 */

const listeners = new Set();

export function openCaptureIdea() {
  listeners.forEach((fn) => {
    try { fn(); } catch { /* subscriber errors must not block others */ }
  });
}

export function subscribeCaptureIdea(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
