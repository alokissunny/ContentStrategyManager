import client from './client';
import { ingestPlanDebug } from './posts';

/* A landing visitor's Instagram: the read starts the moment they give it, before they have an account
   (backend routes/publicRoutes.js). Returns { token, handle }. */
export function startVisitorRead(handle) {
  return client.post('/public/instagram-read', { handle }).then((res) => res.data);
}

/* A visitor's voice note, before they have an account (backend routes/publicRoutes.js `/transcribe`):
   the same transcriber, per-address capped, nothing stored. Returns { text }. */
export function transcribeVisitor(blob, { hint, languages } = {}) {
  const headers = { 'Content-Type': blob.type || 'audio/webm' };
  const first = String(hint || '').trim();
  if (first) headers['X-Transcript-Hint'] = encodeURIComponent(first.slice(0, 1500));
  const langs = (languages || []).map((k) => String(k || '').trim()).filter(Boolean);
  if (langs.length) headers['X-Transcript-Languages'] = encodeURIComponent(langs.slice(0, 8).join(','));
  return client.post('/public/transcribe', blob, { headers, transformRequest: [(data) => data] }).then((r) => r.data || {});
}

/* After sign-up: the read (waited for if still running) and the studio answers become this account's
   Instagram profile and Business memory. Returns { username, instagram }. Can take up to ~2 minutes. */
export function claimVisitorRead({ token, answers }) {
  return client.post('/instagram/visitor-claim', { token, answers }, { timeout: 150000 }).then((res) => {
    // the account read's rows (Apify, the account analysis, Business memory gaps) for the AI debug panel
    ingestPlanDebug('Onboarding · account', res.data || {});
    return res.data;
  });
}
