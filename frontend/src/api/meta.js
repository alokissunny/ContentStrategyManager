import client from './client';

export function getMetaStatus() {
  return client.get('/meta/status').then((r) => r.data);
}

export function startMetaConnect() {
  return client.post('/meta/connect').then((r) => r.data);
}

export function completeMetaConnect(code, state) {
  return client.post('/meta/connect/complete', { code, state }).then((r) => r.data);
}

export function disconnectMeta() {
  return client.delete('/meta/connect').then((r) => r.data);
}

export function publishDayToMeta(routeId, dayIndex, body = {}) {
  return client.post(`/meta/publish/${routeId}/day/${dayIndex}`, body).then((r) => r.data);
}
