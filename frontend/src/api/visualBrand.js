import client from './client';

// Visual Brand — the studio's Visual Mood images (Library Settings page). The
// bytes go straight to S3 via a presigned PUT; the API keeps the object key and
// hands back short-lived presigned read URLs.

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
