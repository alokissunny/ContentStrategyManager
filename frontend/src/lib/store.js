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
import { getBrandSettings, saveBrandSettings } from '../api/visualBrand.js';

// Base key for the (client-only) Visual Brand / Library state. The real store
// is PER INSTAGRAM ACCOUNT: each handle keeps its own blob under
// `bauhly.visualbrand::<handle>`, so switching the account in the header shows
// that account's own library edits, layouts and mood — the same account-scoping
// as projects and plans. `bauhly.currentHandle` remembers which handle is live
// so the right namespace loads synchronously on the next page load (the header
// switch does a full reload). See syncHandle() and AccountSwitcher.
const BASE_KEY = 'bauhly.visualbrand';
const HANDLE_KEY = 'bauhly.currentHandle';

function normHandle(h) {
  return (h ? String(h).trim().toLowerCase() : '') || null;
}

function keyFor(handle) {
  return handle ? `${BASE_KEY}::${handle}` : BASE_KEY;
}

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

  /* ── the Visual Library's state (ported from bauhly-v3) ──────────────────
   * The library keeps only its EXCEPTIONS, so a new layout is in use by default
   * and the shipped set needs nothing stored. `off` and `gone` are keyed by
   * layout id; `addedLayouts` is the studio's own compositions (their `imgs`
   * are object URLs and die with the session); `refAnalysis` is what Bauhly
   * read off each added picture; `libraryEdits` is the palette/type override
   * (empty object = the CSS defaults). See pages/visuallibrary/. */
  layoutsOff: {},   // { [layoutId]: true }
  layoutsGone: {},  // { [layoutId]: true }
  addedLayouts: [], // [{ id, cat, name, kind, tone, levels, imgs, art, own, fromRef, addedAt }]
  refAnalysis: {},  // { [refId]: { colours, shape, ground, at } }
  libraryEdits: { palette: {}, type: {} },
  /* ON by default on the Visual Library (bauhly 857): this page shows how the
     studio's direction reads across layouts. Off still draws empty picture
     regions. The plan's picker shares the same key. */
  layoutMoodOn: true,
};

let activeHandle = (() => {
  try {
    return normHandle(localStorage.getItem(HANDLE_KEY));
  } catch {
    return null;
  }
})();
let state = load(activeHandle);
const listeners = new Set();

function load(handle) {
  try {
    let raw = localStorage.getItem(keyFor(handle));
    // One-time migration: before scoping, everything lived under the bare
    // BASE_KEY (a single account's worth). The first handle to load adopts that
    // blob, and BASE_KEY is retired so other accounts start clean.
    if (raw == null && handle) {
      const legacy = localStorage.getItem(BASE_KEY);
      if (legacy != null) {
        raw = legacy;
        try {
          localStorage.setItem(keyFor(handle), legacy);
          localStorage.removeItem(BASE_KEY);
        } catch {
          /* private mode etc. */
        }
      }
    }
    const s = { ...DEFAULTS, ...JSON.parse(raw || '{}') };
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
    /* a layout the studio added carries an object URL for its picture, which is
       a dead `blob:` once read back from storage — drop it, the same way added
       references are dropped above. Added layouts last the session. */
    if (Array.isArray(s.addedLayouts)) {
      s.addedLayouts = s.addedLayouts.filter((l) => !l?.imgs?.some((u) => String(u || '').startsWith('blob:')));
    }
    return s;
  } catch {
    return { ...DEFAULTS };
  }
}

function persist() {
  try {
    localStorage.setItem(keyFor(activeHandle), JSON.stringify(state));
  } catch {
    /* private mode etc. — state stays in memory */
  }
}

/* ── server sync ────────────────────────────────────────────────────────────
 * localStorage is per ORIGIN, so the same account saw different library
 * settings on localhost and on prod, and a cleared cache lost them. These fields
 * are mirrored to the backend (per handle) so the library follows the account,
 * not the browser. Local-first: the store still initialises synchronously from
 * localStorage, then hydrates over it from the server; edits push back debounced.
 *
 * Session-only fields are intentionally NOT synced: `visualRefs` / `addedLayouts`
 * carry object-URL (`blob:`) pictures that are meaningless on another origin (the
 * mood board is rebuilt from the S3 endpoint on load), and `projects` is seeded
 * from local data every load. What remains is the durable, portable settings:
 * the applied palette/type/fonts, which layouts are on, the per-picture palette
 * readings (keyed by S3 key, so they line up anywhere), and the brand style. */
const SYNC_KEYS = ['libraryEdits', 'layoutsOff', 'layoutsGone', 'refAnalysis', 'brandStyle', 'brand', 'layoutMoodOn'];

// Any `blob:` URL is origin-local; never send a dead reference to the server.
function stripBlobUrls(value) {
  if (Array.isArray(value)) return value.map(stripBlobUrls);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = typeof v === 'string' && v.startsWith('blob:') ? null : stripBlobUrls(v);
    }
    return out;
  }
  return value;
}

function syncPayload(s) {
  const out = {};
  SYNC_KEYS.forEach((k) => { if (k in s) out[k] = stripBlobUrls(s[k]); });
  return out;
}

let pushTimer = null;
let lastPushedSig = null;

// Pull this account's saved settings and merge them over the local state. The
// server is authoritative for the synced fields on load; a switch/reload is the
// only time this runs, so it never clobbers a mid-session edit. Guarded against a
// handle switch landing mid-flight.
async function hydrate(handle) {
  const h = normHandle(handle);
  if (!h) return;
  let remote;
  try {
    remote = await getBrandSettings();
  } catch {
    return; /* offline or signed out — local-first stands */
  }
  if (!remote || typeof remote !== 'object') return;
  if (normHandle(activeHandle) !== h) return; // account changed while we waited
  const merged = { ...state };
  SYNC_KEYS.forEach((k) => { if (k in remote) merged[k] = remote[k]; });
  state = merged;
  // don't echo the just-hydrated blob straight back to the server
  lastPushedSig = JSON.stringify(syncPayload(state));
  persist();
  listeners.forEach((fn) => fn());
}

// Debounced write-back of the synced fields. Coalesces a burst of edits into one
// request and skips a no-op (same blob as last pushed). No account → nothing to
// scope to, so it holds until one is connected.
function schedulePush() {
  if (!activeHandle) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const payload = syncPayload(state);
    const sig = JSON.stringify(payload);
    if (sig === lastPushedSig) return;
    lastPushedSig = sig;
    saveBrandSettings(payload).catch(() => { lastPushedSig = null; /* let the next edit retry */ });
  }, 800);
}

// Point the store at a given Instagram handle's namespace and reload its state.
// Called from the header account switcher: on every dashboard load (so the live
// handle's data shows) and just before a switch reloads the page (so the new
// account's namespace is already selected when the store re-initialises).
export function syncHandle(handle) {
  const next = normHandle(handle);
  if (!next) return;
  if (next !== activeHandle) {
    activeHandle = next;
    try {
      localStorage.setItem(HANDLE_KEY, next);
    } catch {
      /* private mode etc. */
    }
    state = load(next);
    lastPushedSig = null;
    listeners.forEach((fn) => fn());
  }
  // Always pull the server's copy for this handle — even when the handle is
  // unchanged (a fresh dashboard load re-selects the same account), so a setting
  // saved on another origin shows up here.
  hydrate(next);
}

export function setState(patch) {
  state = { ...state, ...patch };
  persist();
  schedulePush();
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

// Local-first: the store is already live from localStorage above; now pull the
// server's copy for the remembered handle so a direct page load (not via the
// account switcher) also picks up settings saved on another origin. A no-op when
// signed out or no handle is remembered yet — the switcher hydrates then.
if (activeHandle) hydrate(activeHandle);

// Account switch writes HANDLE_KEY then reloads that tab. Other tabs keep the
// old handle in memory until they notice — reload dashboard tabs so plans,
// projects and the header stay on the same account.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== HANDLE_KEY) return;
    const next = normHandle(event.newValue);
    if (!next || next === activeHandle) return;
    const path = window.location.pathname || '';
    if (path.startsWith('/dashboard') || path.startsWith('/onboarding')) {
      window.location.reload();
      return;
    }
    activeHandle = next;
    state = load(next);
    lastPushedSig = null;
    listeners.forEach((fn) => fn());
  });
}
