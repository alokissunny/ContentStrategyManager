import client from './client';

export function getMetaStatus() {
  return client.get('/meta/status').then((r) => r.data);
}

export function metaConnectionsList(status) {
  if (Array.isArray(status?.connections) && status.connections.length) return status.connections;
  if (status?.connected && status.igUsername) {
    return [{
      igUserId: status.igUserId || null,
      igUsername: status.igUsername,
      pageName: status.pageName || null,
      connectedAt: status.connectedAt || null,
    }];
  }
  return [];
}

export function metaConnectionFor(status, username) {
  const handle = String(username || '').replace(/^@/, '').trim().toLowerCase();
  if (!status || !handle) return null;
  return metaConnectionsList(status).find(
    (c) => String(c.igUsername || '').toLowerCase() === handle,
  ) || null;
}

export function isMetaConnectedFor(status, username) {
  return Boolean(metaConnectionFor(status, username));
}

/** Meta IGs linked on this user that do not match `username`. */
export function otherMetaConnections(status, username) {
  const handle = String(username || '').replace(/^@/, '').trim().toLowerCase();
  return metaConnectionsList(status).filter(
    (c) => String(c.igUsername || '').toLowerCase() && String(c.igUsername || '').toLowerCase() !== handle,
  );
}

const OAUTH_RETURN_KEY = 'meta_oauth_return';
const OAUTH_RESULT_KEY = 'meta_oauth_result';

/** Remember which plan/handle Connect was started from so the callback can return. */
export function rememberMetaOAuthReturn(payload) {
  try {
    sessionStorage.setItem(OAUTH_RETURN_KEY, JSON.stringify(payload || {}));
  } catch { /* ignore quota / private mode */ }
}

export function takeMetaOAuthReturn() {
  try {
    const raw = sessionStorage.getItem(OAUTH_RETURN_KEY);
    sessionStorage.removeItem(OAUTH_RETURN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeMetaOAuthResult(payload) {
  try {
    sessionStorage.setItem(OAUTH_RESULT_KEY, JSON.stringify(payload || {}));
  } catch { /* ignore */ }
}

export function peekMetaOAuthResult() {
  try {
    const raw = sessionStorage.getItem(OAUTH_RESULT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function takeMetaOAuthResult() {
  try {
    const raw = sessionStorage.getItem(OAUTH_RESULT_KEY);
    sessionStorage.removeItem(OAUTH_RESULT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function metaCallbackUri() {
  if (typeof window === 'undefined') return undefined;
  return `${window.location.origin}/dashboard/meta/callback`;
}

export function startMetaConnect() {
  return client.post('/meta/connect', { redirectUri: metaCallbackUri() }).then((r) => r.data);
}

export function completeMetaConnect(code, state) {
  return client.post('/meta/connect/complete', { code, state, redirectUri: metaCallbackUri() }).then((r) => r.data);
}

/** Disconnect one Meta IG account. Pass igUserId from status.connections[]. */
export function disconnectMeta(igUserId) {
  if (igUserId) {
    return client.delete(`/meta/connect/${encodeURIComponent(igUserId)}`).then((r) => r.data);
  }
  return client.delete('/meta/connect').then((r) => r.data);
}

export function publishDayToMeta(routeId, dayIndex, body = {}) {
  return client
    .post(`/meta/publish/${routeId}/day/${dayIndex}`, body, { timeout: 120000 })
    .then((r) => r.data);
}
