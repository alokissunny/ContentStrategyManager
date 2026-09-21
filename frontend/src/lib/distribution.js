/*
 * The publishing-day distribution — which weekdays the studio publishes on.
 * Persisted per handle in localStorage by the Distribute panel (Your Plans),
 * Monday-indexed (0=Mon … 6=Sun). Shared here so every "generate posts" path can
 * fill only the studio's chosen days, instead of the next bare calendar day.
 */

export const DIST_DEFAULT = { mode: 'days', days: [0, 2, 4] }; // Mon / Wed / Fri

const HANDLE_KEY = 'bauhly.currentHandle';

export function distStorageKey(handle) {
  return `bauhly:dist:${handle || 'default'}`;
}

// The handle the header account switcher currently points at (store.js writes it
// lowercased). Distribution is saved under the plan's own handle string; IG
// handles are lowercase, so the two agree in practice.
export function currentHandle() {
  try {
    return String(localStorage.getItem(HANDLE_KEY) || '').trim();
  } catch {
    return '';
  }
}

// Read the saved distribution for a handle (defaults to the live one).
export function readDistribution(handle = currentHandle()) {
  try {
    const raw = localStorage.getItem(distStorageKey(handle));
    if (!raw) return { ...DIST_DEFAULT };
    const p = JSON.parse(raw);
    const days = Array.isArray(p.days) && p.days.length
      ? [...new Set(p.days.filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b)
      : [...DIST_DEFAULT.days];
    return {
      mode: p.mode === 'weekly' ? 'weekly' : 'days',
      days: days.length ? days : [...DIST_DEFAULT.days],
    };
  } catch {
    return { ...DIST_DEFAULT };
  }
}

// The { mode, days } to send with POST /posts/generate so the backend fills only
// the allowed weekdays. 'weekly' spread is a distribute-time concern (count-based),
// so it carries no weekday restriction into the fill — the backend leaves it open.
export function distributionForGenerate(handle = currentHandle()) {
  const dist = readDistribution(handle);
  if (dist.mode === 'weekly') return { mode: 'weekly' };
  return { mode: 'days', days: dist.days };
}
