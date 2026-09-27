import client from './client';
import { addAiDebugEntry, isAiDebugEnabled } from '../lib/aiDebug';
const seen = new Map();
function ingest(data) {
  if (isAiDebugEnabled()) for (const entry of data?.debug?.agents || []) {
    const signature = JSON.stringify(entry);
    if (seen.get(entry.id) === signature) continue;
    addAiDebugEntry(entry); seen.set(entry.id, signature);
    if (seen.size > 300) seen.delete(seen.keys().next().value);
  }
  return data;
}

export async function createPodcastJob(payload, signal) {
  return ingest((await client.post('/reels/podcast/jobs', payload, { signal })).data);
}
export async function getPodcastJob(id, signal) {
  return ingest((await client.get(`/reels/podcast/jobs/${encodeURIComponent(id)}`, { signal })).data);
}
export async function renderPodcastJob(id, payload, signal) {
  return ingest((await client.post(`/reels/podcast/jobs/${encodeURIComponent(id)}/render`, payload, { signal })).data);
}
export async function cancelPodcastJob(id) {
  return ingest((await client.delete(`/reels/podcast/jobs/${encodeURIComponent(id)}`, { timeout: 10000 })).data);
}

export async function getPodcastOutput(key, signal) {
  return (await client.get('/reels/podcast/output', { params: { key }, signal })).data;
}
