import client from './client';
import { ingestPlanDebug } from './posts';

/* A landing visitor's Instagram: the read starts the moment they give it, before they have an account
   (backend routes/publicRoutes.js). Returns { token, handle }. */
export function startVisitorRead(handle) {
  return client.post('/public/instagram-read', { handle }).then((res) => res.data);
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
