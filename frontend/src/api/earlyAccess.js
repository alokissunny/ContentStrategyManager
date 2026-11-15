import client from './client';

export function requestEarlyAccess({ name, instagramHandle }) {
  return client.post('/early-access', { name, instagramHandle }).then((res) => res.data);
}

/* the invitation step: is this code good, without using it (backend earlyAccessController.checkInvite).
   → { ok, code } | { ok:false, reason: 'empty'|'invalid'|'redeemed'|'limited'|'offline'|'error' } */
export function checkInviteCode(code) {
  return client.post('/early-access/invite/check', { code })
    .then((res) => res.data)
    .catch((err) => ({ ok: false, reason: !err?.response ? 'offline' : err.response.data?.reason || 'error' }));
}

/* "Join the waitlist" for somebody with no code. → { ok, already } | { ok:false, reason } */
export function joinWaitlist(email, source = '') {
  return client.post('/early-access/waitlist', { email, source })
    .then((res) => res.data)
    .catch((err) => ({ ok: false, reason: !err?.response ? 'offline' : err.response.data?.reason || 'error' }));
}
