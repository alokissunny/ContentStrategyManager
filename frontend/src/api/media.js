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
