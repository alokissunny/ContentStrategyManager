import client from './client';

// Captures › Generate reel. POST starts a background job (202); poll GET /:id
// until status is 'done' or 'error'.
export async function createCaptureReel({ projectId, captureIds, direction = '', styleId = '' }) {
  try {
    const { data } = await client.post('/capture-reels', { projectId, captureIds, direction, ...(styleId ? { styleId } : {}) });
    return data.reel;
  } catch (err) {
    // one reel at a time per capture: the running one comes back with the 409
    if (err?.response?.status === 409 && err.response.data?.reel) return err.response.data.reel;
    throw err;
  }
}

export async function listCaptureReels(captureIds = []) {
  const q = captureIds.length ? `?captureId=${captureIds.map(encodeURIComponent).join(',')}` : '';
  const { data } = await client.get(`/capture-reels${q}`);
  return data.reels || [];
}

export async function getCaptureReel(id) {
  const { data } = await client.get(`/capture-reels/${encodeURIComponent(id)}`);
  return data.reel;
}

export async function deleteCaptureReel(id) {
  await client.delete(`/capture-reels/${encodeURIComponent(id)}`);
}

export const reelWorking = (r) => Boolean(r) && (r.status === 'queued' || r.status === 'working');

// Reel styles (Generate reel › Choose reel style): analysed reference reels
export async function listReelStyles() {
  const { data } = await client.get('/reel-styles');
  return data.styles || [];
}

// Paste a reel link → its style is analysed in the background (~30 s); poll
// listReelStyles until it is 'ready' (or 'error')
export async function addReelStyle(url) {
  const { data } = await client.post('/reel-styles', { url });
  return data.style;
}

export async function removeReelStyle(id) {
  await client.delete(`/reel-styles/${encodeURIComponent(id)}`);
}

// Admin only: can this server render reels right now? (403 for everyone else)
export async function getReelSystem() {
  const { data } = await client.get('/capture-reels/system');
  return data;
}
