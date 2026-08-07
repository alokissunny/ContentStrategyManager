import client from './client';

// Projects — Bauhly's long-term memory, backed by the API (Mongo + S3 media).

export function listProjects() {
  return client.get('/projects').then((r) => r.data.projects || []);
}
export function createProject(name) {
  return client.post('/projects', { name }).then((r) => r.data.project);
}
export function renameProject(id, name) {
  return client.patch(`/projects/${id}`, { name }).then((r) => r.data.project);
}
export function deleteProject(id) {
  return client.delete(`/projects/${id}`).then((r) => r.data.id);
}
export function addCapture(projectId, capture) {
  return client.post(`/projects/${projectId}/captures`, capture).then((r) => r.data.project);
}
export function updateCapture(projectId, captureId, patch) {
  return client.patch(`/projects/${projectId}/captures/${captureId}`, patch).then((r) => r.data.project);
}
export function deleteCapture(projectId, captureId) {
  return client.delete(`/projects/${projectId}/captures/${captureId}`).then((r) => r.data.project);
}
export function moveCapture(projectId, captureId, toProjectId) {
  return client.post(`/projects/${projectId}/captures/${captureId}/move`, { toProjectId }).then((r) => r.data);
}

// AI asset analysis — vision-model metadata stored on each image attachment.
// analyzeProject runs every image asset (pass { force: true } to re-run ones
// already analysed); analyzeAsset runs (or re-runs) a single asset.
export function analyzeProject(projectId, { force = false } = {}) {
  return client
    .post(`/projects/${projectId}/analyze`, { force })
    .then((r) => ({ project: r.data.project, analyzed: r.data.analyzed, usage: r.data.usage }));
}
export function analyzeAsset(projectId, captureId, attachmentId) {
  return client
    .post(`/projects/${projectId}/captures/${captureId}/attachments/${attachmentId}/analyze`)
    .then((r) => r.data.project);
}

// Presign a batch of uploads, then PUT each file straight to S3. Returns
// attachment descriptors { type, key } for the capture, plus a local objectURL
// for instant preview before the server round-trip.
export async function uploadFiles(files) {
  const arr = [...files];
  if (!arr.length) return [];
  const { data } = await client.post('/projects/uploads/sign', {
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
  return arr.map((f, i) => {
    const preview = URL.createObjectURL(f);
    return {
      id: uploads[i].key,
      type: f.type.startsWith('video') ? 'video' : 'image',
      key: uploads[i].key,
      url: preview,
      thumbnailUrl: preview,
    };
  });
}
