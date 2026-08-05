/*
 * Client state for the Visual Brand feature.
 *
 * Ported alongside the Visual Brand pages from the bauhly-v3 reference, which
 * runs on a localStorage store (no backend). The live app keeps its real data
 * in `api/*` + `projectsStore`; this holds only what the reference's Visual
 * Brand owns and the live backend has no endpoint for yet — the references the
 * studio added on purpose (`visualRefs`) and the visual system they adjusted
 * (`brandStyle`). One key, one shape, one hook, matching the reference contract
 * (`useStore` / `setState`).
 */

import { useSyncExternalStore } from 'react';

const KEY = 'bauhly.visualbrand';

const DEFAULTS = {
  /* references added on purpose — the studio's own photographs are read from
     Projects, never copied here (see lib/visualbrand.js) */
  visualRefs: [], // [{ id, kind, url, title, note, source: 'added', addedAt }]
  /* the visual system once the studio has a hand in it; null = still whatever
     Bauhly read from the pictures */
  brandStyle: null,
  /* the typefaces the studio handed over — the name travels into image prompts */
  brand: {},
  /* seeded on read from lib/projects.js, never persisted */
  projects: null,
  projectsSeedV: 0,
};

let state = load();
const listeners = new Set();

function load() {
  try {
    const s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    /* an object URL dies with the document that made it — a blob: URL read back
       from localStorage is a picture that cannot be shown, so drop it. Added
       references last the session; the library says so out loud. */
    if (Array.isArray(s.visualRefs)) {
      s.visualRefs = s.visualRefs.filter((r) => !String(r?.url || '').startsWith('blob:'));
    }
    if (s.brandStyle) {
      const st = { ...s.brandStyle };
      if (Array.isArray(st.grounds)) st.grounds = st.grounds.filter((g) => !String(g?.url || '').startsWith('blob:'));
      if (st.logo && String(st.logo.url || '').startsWith('blob:')) st.logo = { ...st.logo, url: null };
      s.brandStyle = st;
    }
    return s;
  } catch {
    return { ...DEFAULTS };
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode etc. — state stays in memory */
  }
}

export function setState(patch) {
  state = { ...state, ...patch };
  persist();
  listeners.forEach((fn) => fn());
}

export function getState() {
  return state;
}

export function useStore() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}
