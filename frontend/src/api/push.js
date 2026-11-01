import client from './client';

// { vapidPublicKey, web, apns } — which channels the server can send on.
export function getPushConfig() {
  return client.get('/push/config').then((res) => res.data);
}

// { kind: 'web', subscription } | { kind: 'apns', token }
export function subscribePush(body) {
  return client.post('/push/subscribe', body).then((res) => res.data);
}

export function unsubscribePush(body) {
  return client.post('/push/unsubscribe', body).then((res) => res.data);
}

export function sendTestPush() {
  return client.post('/push/test').then((res) => res.data);
}
