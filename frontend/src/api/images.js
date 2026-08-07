import client from './client';

// Create an image from a prompt (WeekView "Create image"). The server renders
// it with Gemini "nano banana", stores the bytes on S3, and returns the object
// key (to persist onto the slide, same as an upload) plus a short-lived
// presigned URL to show it right away.
export function createImage({ prompt, brand } = {}) {
  return client
    .post('/images/create', { prompt, brand })
    .then((r) => r.data); // { key, url, mimeType, model }
}
