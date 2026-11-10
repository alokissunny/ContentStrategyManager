import client from './client';

/* A landing visitor's Instagram: the read starts the moment they give it, before they have an account
   (backend routes/publicRoutes.js). Returns { token, handle }. */
export function startVisitorRead(handle) {
  return client.post('/public/instagram-read', { handle }).then((res) => res.data);
}

/* After sign-up: the read (waited for if still running) and the studio answers become this account's
   Instagram profile and Business memory. Returns { username, instagram }. Can take up to ~2 minutes. */
export function claimVisitorRead({ token, answers }) {
  return client.post('/instagram/visitor-claim', { token, answers }, { timeout: 150000 }).then((res) => res.data);
}
