import client from './client';

// A CORS-fetchable URL for a stored media object, keyed by its S3 key.
//
// The app normally displays media from the CloudFront CDN, whose URLs are great
// for <img> but send no Access-Control-Allow-Origin header — so they can't be
// fetched-and-inlined into a canvas (what publishing does when it rasterises a
// post slide). This routes the same bytes through the API, which is same-origin
// in dev (Vite proxies /api) and CORS-allowed in prod, so the renderer can read
// them. Use it ONLY where the bytes must be fetched cross-origin; keep the CDN
// URL for plain display.
export function mediaProxyUrl(key) {
  if (!key) return '';
  const base = (client.defaults.baseURL || '/api').replace(/\/$/, '');
  return `${base}/media/proxy?key=${encodeURIComponent(key)}`;
}

export function isProxyUrl(url) {
  return /\/media\/proxy\?key=/.test(String(url || ''));
}

function trimBase(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

let cachedCdnBase = trimBase(import.meta.env.VITE_MEDIA_CDN_BASE_URL);
let cdnBasePromise = null;
const cdnListeners = new Set();

export function getCdnBase() {
  return cachedCdnBase;
}

export function onCdnBase(listener) {
  cdnListeners.add(listener);
  if (cachedCdnBase) listener(cachedCdnBase);
  return () => cdnListeners.delete(listener);
}

function setCdnBase(base) {
  const next = trimBase(base);
  if (!next || next === cachedCdnBase) return cachedCdnBase;
  cachedCdnBase = next;
  cdnListeners.forEach((fn) => fn(cachedCdnBase));
  return cachedCdnBase;
}

export function inferCdnBaseFromUrl(url) {
  if (!url || isProxyUrl(url)) return '';
  if (/^(blob:|data:)/i.test(url)) return '';
  try {
    const u = new URL(url);
    if (u.search.includes('X-Amz-')) return '';
    if (u.hostname.includes('cloudfront.net') || u.hostname.startsWith('cdn.') || !u.search) {
      return u.origin;
    }
  } catch { /* ignore */ }
  return '';
}

export function rememberCdnBase(url) {
  const inferred = inferCdnBaseFromUrl(url);
  if (inferred) setCdnBase(inferred);
  return cachedCdnBase;
}

export function keyFromMediaUrl(url) {
  const raw = String(url || '');
  if (!raw || /^(blob:|data:)/i.test(raw)) return '';
  try {
    const u = new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'http://local');
    if (isProxyUrl(raw)) return u.searchParams.get('key') || '';
    const path = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
    return /^projects\//.test(path) ? path : '';
  } catch {
    return '';
  }
}

export function displayMediaUrl(key) {
  if (!key || !cachedCdnBase) return '';
  const path = String(key).split('/').map(encodeURIComponent).join('/');
  return `${cachedCdnBase}/${path}`;
}

// Prefer a CloudFront URL for <img> display. Blob/data URLs stay as-is (in-progress
// edits). Proxy URLs are rewritten once the CDN base is known — they are never
// returned for display.
export function toDisplayUrl(url, key) {
  if (url && /^(blob:|data:)/i.test(url)) return url;
  const k = key || keyFromMediaUrl(url);
  if (k && cachedCdnBase) return displayMediaUrl(k);
  if (url && !isProxyUrl(url)) {
    rememberCdnBase(url);
    if (k && cachedCdnBase) return displayMediaUrl(k);
    return url;
  }
  return displayMediaUrl(k);
}

export function loadCdnBase() {
  if (cachedCdnBase) return Promise.resolve(cachedCdnBase);
  if (!cdnBasePromise) {
    cdnBasePromise = client.get('/media/cdn-base')
      .then((r) => {
        const base = trimBase(r.data?.base);
        if (base) setCdnBase(base);
        return cachedCdnBase;
      })
      .catch(() => cachedCdnBase || '');
  }
  return cdnBasePromise;
}

loadCdnBase();
