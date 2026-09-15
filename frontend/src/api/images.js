import client from './client';
import { addAiDebugEntry } from '../lib/aiDebug';
import { getActiveHandle } from '../lib/store';

// Create an image from a prompt (WeekView "Create image"). The server renders
// it with Gemini "nano banana", stores the bytes on S3, and returns the object
// key (to persist onto the slide, same as an upload) plus a short-lived
// presigned URL to show it right away.
export function createImage({ prompt, brand } = {}) {
  return client
    .post('/images/create', { prompt, brand })
    .then((r) => {
      const data = r.data || {};
      addAiDebugEntry({
        source: 'Create image',
        model: data.model,
        prompt: data.finalPrompt || prompt,
      });
      return data;
    }); // { key, url, mimeType, model, finalPrompt }
}

// The studio's generated-image library (the "Generated" asset folder). Scoped
// to the active Instagram handle on the server. Each item: { key, prompt,
// model, addedAt, url } — url is a short-lived presigned read URL.
//
// Concurrent callers share one request — StrictMode's double-invoked mount
// effect (and remounts) would otherwise fire GET /images/generated twice. Keyed
// by the active handle so a soft account switch never reuses the previous
// account's in-flight request.
let generatedInflight = null;
let generatedInflightHandle = null;
export function listGeneratedImages() {
  const handle = getActiveHandle();
  if (generatedInflight && generatedInflightHandle === handle) return generatedInflight;
  generatedInflightHandle = handle;
  const p = client.get('/images/generated')
    .then((r) => r.data.images || [])
    .finally(() => { if (generatedInflight === p) generatedInflight = null; });
  generatedInflight = p;
  return p;
}

export function deleteGeneratedImage(key) {
  return client.delete(`/images/generated/${encodeURIComponent(key)}`).then((r) => r.data.key);
}
