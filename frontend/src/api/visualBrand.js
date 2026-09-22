import client from './client';

// Visual Brand — the studio's Visual Mood images (Library Settings page). The
// bytes go straight to S3 via a presigned PUT; the API keeps the object key and
// hands back short-lived presigned read URLs.

// Concurrent callers (React StrictMode remounts, AccountSwitcher + store hydrate)
// share one in-flight request so a page load does not double-tax Atlas.
let logosInflight = null;
const settingsInflight = new Map();

// Upload one or more files to S3 and persist them as mood images.
// Returns the full mood set (newest first), each with a presigned `url`.
export async function uploadMoodImages(files) {
  const arr = [...files].filter((f) => f && f.type && f.type.startsWith('image/'));
  if (!arr.length) return [];
  const { data } = await client.post('/visual-brand/mood/sign', {
    files: arr.map((f) => ({ contentType: f.type || 'application/octet-stream' })),
  });
  const uploads = data.uploads || [];
  await Promise.all(
    arr.map((f, i) =>
      fetch(uploads[i].uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': f.type || 'application/octet-stream' },
        body: f,
      }).then((res) => {
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      })
    )
  );
  const { data: saved } = await client.post('/visual-brand/mood', {
    images: arr.map((f, i) => ({ key: uploads[i].key, title: f.name })),
  });
  return saved.moodImages || [];
}

// The studio's saved mood images, each with a fresh presigned `url`.
export function listMoodImages() {
  return client.get('/visual-brand/mood').then((r) => r.data.moodImages || []);
}

// Remove one mood image (drops the record and the S3 object).
export function deleteMoodImage(key) {
  return client.delete(`/visual-brand/mood/${encodeURIComponent(key)}`).then((r) => r.data);
}

// ── Logos (Library Settings) ────────────────────────────────────────────────
// Four named slots. The bytes go to S3 the same way mood images do; the API
// keeps the object key per slot and hands back a short-lived presigned `url`.

function packLogos(list) {
  const out = {};
  (list || []).forEach((m) => {
    if (!m || !m.slot) return;
    out[m.slot] = { key: m.key, url: m.url || null, title: m.title || '', addedAt: m.addedAt || 0 };
  });
  return out;
}

export async function uploadLogo(slot, file) {
  if (!file || !file.type || !String(file.type).startsWith('image/')) return null;
  const { data } = await client.post('/visual-brand/logos/sign', {
    files: [{ contentType: file.type || 'application/octet-stream' }],
  });
  const upload = (data.uploads || [])[0];
  if (!upload) throw new Error('no upload');
  const put = await fetch(upload.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  const { data: saved } = await client.post('/visual-brand/logos', {
    slot,
    key: upload.key,
    title: file.name,
  });
  return packLogos(saved.logos);
}

export function listLogos() {
  if (logosInflight) return logosInflight;
  logosInflight = client.get('/visual-brand/logos')
    .then((r) => packLogos(r.data.logos))
    .finally(() => { logosInflight = null; });
  return logosInflight;
}

export function deleteLogo(slot) {
  return client.delete(`/visual-brand/logos/${encodeURIComponent(slot)}`).then((r) => r.data);
}

// ── Library Settings (palette, type, layout toggles) ────────────────────────
// One synced blob per Instagram account, so the library follows the account and
// not the browser origin. The server scopes by the active handle from the
// session; the client owns the blob's shape (see lib/store.js).

// The saved settings blob for one Instagram handle, or null if none saved yet.
export function getBrandSettings(handle) {
  const key = String(handle || '').trim().toLowerCase() || '_';
  if (settingsInflight.has(key)) return settingsInflight.get(key);
  const p = client.get('/visual-brand/settings', { params: handle ? { handle } : {} })
    .then((r) => r.data.settings ?? null)
    .finally(() => { settingsInflight.delete(key); });
  settingsInflight.set(key, p);
  return p;
}

// Upsert one Instagram handle's settings blob. The handle is required so a
// write cannot land on a different connected account.
export function saveBrandSettings(data, handle) {
  return client.put('/visual-brand/settings', { data, handle }).then((r) => r.data);
}

// ── Backgrounds (Brand Kit) ─────────────────────────────────────────────────
// Same S3 presign flow as mood images. Returns the full set (newest first),
// each with a presigned `url` and an `isDefault` flag.

export async function uploadBackground(file) {
  if (!file || !file.type || !String(file.type).startsWith('image/')) return null;
  const { data } = await client.post('/visual-brand/backgrounds/sign', {
    files: [{ contentType: file.type || 'application/octet-stream' }],
  });
  const upload = (data.uploads || [])[0];
  if (!upload) throw new Error('no upload');
  const put = await fetch(upload.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  const { data: saved } = await client.post('/visual-brand/backgrounds', {
    images: [{ key: upload.key, title: file.name }],
  });
  return saved.backgrounds || [];
}

export function listBackgrounds() {
  return client.get('/visual-brand/backgrounds').then((r) => r.data.backgrounds || []);
}

export function setDefaultBackground(key) {
  return client.put('/visual-brand/backgrounds/default', { key }).then((r) => r.data.backgrounds || []);
}

export function deleteBackground(key) {
  return client.delete(`/visual-brand/backgrounds/${encodeURIComponent(key)}`).then((r) => r.data);
}

// ── Visual Mood sets (Brand Kit) ────────────────────────────────────────────
// The whole array of sets is saved at once; each role image is uploaded to S3
// first and referenced by its key.

// Upload one role image, returning { key, url } (not yet attached to a set).
export async function uploadMoodSetImage(file) {
  if (!file || !file.type || !String(file.type).startsWith('image/')) return null;
  const { data } = await client.post('/visual-brand/mood-sets/sign', {
    files: [{ contentType: file.type || 'application/octet-stream' }],
  });
  const upload = (data.uploads || [])[0];
  if (!upload) throw new Error('no upload');
  const put = await fetch(upload.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  return { key: upload.key, url: URL.createObjectURL(file) };
}

export function listMoodSets() {
  return client.get('/visual-brand/mood-sets').then((r) => r.data.moodSets || []);
}

// Persist the full set list for the active handle. Each ref carries { key }.
export function saveMoodSets(moodSets) {
  return client.put('/visual-brand/mood-sets', { moodSets }).then((r) => r.data.moodSets || []);
}
