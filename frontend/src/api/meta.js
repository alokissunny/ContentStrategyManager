import client from './client';

export function getMetaStatus() {
  return client.get('/meta/status').then((r) => r.data);
}

/** True when Meta is connected for this Instagram handle (case-insensitive). */
export function isMetaConnectedFor(status, username) {
  const handle = String(username || '').replace(/^@/, '').trim().toLowerCase();
  if (!status || !handle) return false;
  const list = status.connections;
  if (Array.isArray(list) && list.length) {
    return list.some((c) => String(c.igUsername || '').toLowerCase() === handle);
  }
  // Legacy single-connection shape from older backends.
  return !!(status.connected && String(status.igUsername || '').toLowerCase() === handle);
}

export function metaConnectionFor(status, username) {
  const handle = String(username || '').replace(/^@/, '').trim().toLowerCase();
  if (!status || !handle) return null;
  const list = status.connections;
  if (Array.isArray(list) && list.length) {
    return list.find((c) => String(c.igUsername || '').toLowerCase() === handle) || null;
  }
  if (status.connected && String(status.igUsername || '').toLowerCase() === handle) {
    return {
      igUserId: status.igUserId || null,
      igUsername: status.igUsername,
      pageName: status.pageName || null,
      connectedAt: status.connectedAt || null,
    };
  }
  return null;
}

export function startMetaConnect() {
  return client.post('/meta/connect').then((r) => r.data);
}

export function completeMetaConnect(code, state) {
  return client.post('/meta/connect/complete', { code, state }).then((r) => r.data);
}

/** Disconnect one Meta IG account. Pass igUserId from status.connections[]. */
export function disconnectMeta(igUserId) {
  if (igUserId) {
    return client.delete(`/meta/connect/${encodeURIComponent(igUserId)}`).then((r) => r.data);
  }
  return client.delete('/meta/connect').then((r) => r.data);
}

export function publishDayToMeta(routeId, dayIndex, body = {}) {
  return client.post(`/meta/publish/${routeId}/day/${dayIndex}`, body).then((r) => r.data);
}
