import client from './client';

export function fetchInstagram(username) {
  return client.post('/instagram/fetch', { username }).then((res) => res.data.profile);
}
