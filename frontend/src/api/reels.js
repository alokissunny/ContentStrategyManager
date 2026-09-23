import client from './client';
import { addAiDebugEntry } from '../lib/aiDebug';

// Experimental Reel Editor API.
//
// Upload flow mirrors api/projects.uploadFiles: presign a PUT, then send the
// clip straight to S3 (never through the app server). The returned object key
// is what /edit reads to run the multi-agent pipeline.

const VIDEO_TYPES = {
  'video/mp4': true,
  'video/quicktime': true,
  'video/webm': true,
};

export function isSupportedMedia(file) {
  return isSupportedVideo(file) || ['image/jpeg', 'image/png', 'image/webp'].includes(file?.type);
}

export async function assembleReel({ assets, transition, guidance, mixMode = 'smart' }) {
  const { data } = await client.post('/reels/assemble', { assets, transition, guidance, mixMode }, { timeout: 600000 });
  ingestDebug(data.debug);
  return data;
}

export function isSupportedVideo(file) {
  return Boolean(file && VIDEO_TYPES[file.type]);
}

// Ingest each agent's prompt/output into the AI debug panel (same shape as the
// capture/plan pipelines), newest last so the panel reads top-down by run order.
function ingestDebug(debug) {
  const agents = Array.isArray(debug?.agents) ? debug.agents : [];
  if (!agents.length) return;
  try {
    agents.forEach((a) => {
      addAiDebugEntry({
        source: a.source || 'Reel editor',
        model: a.model,
        prompt: a.finalPrompt || a.prompt,
        output: a.output,
        systemPrompt: a.systemPrompt,
        elapsedMs: Number(a.elapsedMs) || 0,
        note: a.note || '',
        usage: a.usage || {}, // { inputTokens, outputTokens, totalTokens, estimatedCostUsd }
      });
    });
  } catch {
    /* the debug panel must never sink an edit run */
  }
}

// Presign + PUT the clip to S3. Returns { key }.
export async function uploadReelClip(file, onProgress, signal, purpose) {
  if (!isSupportedMedia(file)) {
    throw new Error('Upload MP4, MOV, WebM, JPEG, PNG, or WebP files.');
  }
  const { data } = await client.post('/reels/uploads/sign', { contentType: file.type, purpose }, { signal });
  const { key, uploadUrl, cacheControl } = data;
  const headers = { 'Content-Type': file.type };
  if (cacheControl) headers['Cache-Control'] = cacheControl;

  await new Promise((resolve, reject) => {
    // XHR (not fetch) so the upload can report progress on large clips.
    signal?.throwIfAborted();
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    signal?.addEventListener('abort', abort, { once: true });
    xhr.onloadend = () => signal?.removeEventListener('abort', abort);
    xhr.onabort = () => reject(new DOMException('Export cancelled', 'AbortError'));
    xhr.open('PUT', uploadUrl);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && typeof onProgress === 'function') {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300
      ? resolve()
      : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Upload failed — check your connection and try again.'));
    xhr.send(file);
  });

  return { key };
}

// Run the multi-agent edit. `frames` are base64 JPEGs sampled from the clip so
// the vision agent can anchor pointers to what's on screen; `accentColor` is the
// clip's own dominant colour (derived from its pixels, never hardcoded).
// Returns { spec, transcript, direction, visualContext, notes }.
export async function editReel({ key, durationSec, guidance, brand, frames, accentColor, cleanAudio = false } = {}) {
  const { data } = await client.post('/reels/edit', { key, durationSec, guidance, brand, frames, accentColor, cleanAudio });
  ingestDebug(data.debug);
  return data;
}

export async function promptEditReel({ spec, prompt, time, selected, assets }) {
  const { visualAssets, sourceVisualAssets, ...editable } = spec;
  const { data } = await client.post('/reels/prompt-edit', { spec: editable, prompt, time, selected, assets }, { timeout: 360000 });
  data.spec.visualAssets = [...(visualAssets || []), ...(data.generatedAssets || [])];
  data.spec.sourceVisualAssets = sourceVisualAssets;
  return data;
}

export async function finishReelExport(keys, signal) {
  try {
    const { data } = await client.post('/reels/export', keys, { signal, responseType: 'blob', timeout: 180000 });
    return data;
  } catch (error) {
    if (error.response?.data instanceof Blob) {
      try { const body = JSON.parse(await error.response.data.text()); error.message = body.message || error.message; } catch { /* preserve transport error */ }
    }
    throw error;
  }
}

export async function cleanupReelExport(keys) {
  if (keys.length) await client.post('/reels/export/cleanup', { keys }, { timeout: 15000 });
}
