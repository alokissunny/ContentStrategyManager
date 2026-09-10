import client from './client';

export function requestEarlyAccess({ name, instagramHandle }) {
  return client.post('/early-access', { name, instagramHandle }).then((res) => res.data);
}
