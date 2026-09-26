import client from './client';

export async function createPodcastJob(payload, signal) {
  return (await client.post('/reels/podcast/jobs', payload, { signal })).data;
}
export async function getPodcastJob(id, signal) {
  return (await client.get(`/reels/podcast/jobs/${encodeURIComponent(id)}`, { signal })).data;
}
export async function renderPodcastJob(id, payload, signal) {
  return (await client.post(`/reels/podcast/jobs/${encodeURIComponent(id)}/render`, payload, { signal })).data;
}
export async function cancelPodcastJob(id) {
  return (await client.delete(`/reels/podcast/jobs/${encodeURIComponent(id)}`)).data;
}
