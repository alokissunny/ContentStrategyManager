import client from './client';
import { addAiDebugEntry } from '../lib/aiDebug';

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
export function listGeneratedImages() {
  return client.get('/images/generated').then((r) => r.data.images || []);
}

export function deleteGeneratedImage(key) {
  return client.delete(`/images/generated/${encodeURIComponent(key)}`).then((r) => r.data.key);
}
