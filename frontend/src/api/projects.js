import client from './client';
import { filesForUpload } from '../lib/heicUpload';
import { addAiDebugEntry } from '../lib/aiDebug';

function ingestAiDebug(label, data = {}) {
  const debug = data.debug;
  if (!debug) return;
  try {
    const agents = Array.isArray(debug.agents) ? debug.agents : null;
    if (agents?.length) {
      [...agents].reverse().forEach((agent) => {
        addAiDebugEntry({
          source: agent.source || label,
          model: agent.model || debug.model,
          prompt: agent.finalPrompt || agent.prompt,
          output: agent.output,
          systemPrompt: agent.systemPrompt,
          elapsedMs: Number(agent.elapsedMs) || 0,
          note: agent.note || '',
        });
      });
      return;
    }
    addAiDebugEntry({
      source: debug.source || label,
      model: debug.model,
      prompt: debug.finalPrompt || debug.prompt,
      output: debug.output,
      systemPrompt: debug.systemPrompt,
      elapsedMs: Number(debug.elapsedMs) || 0,
      note: debug.note || '',
    });
  } catch {
    /* the debug panel must never sink a capture turn */
  }
}

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

// Capture conversation — strategy-neutral extraction, split confirmation,
// and a clarification ladder when meaning is actually missing.
/** Follow-up the user must answer in words — never a photo-chip step. */
export function assistantQuestionCount(turns) {
  return (turns || []).filter((t) => String(t?.role || '').toLowerCase() === 'assistant' && String(t?.text || '').trim()).length;
}

export function clarificationQuestion(result, turns) {
  const asked = assistantQuestionCount(turns);
  if (asked >= 4) return '';
  const question = String(result?.question || result?.questions?.[0] || result?.message || '').trim();
  if (!question) return '';
  if (result?.action === 'ready'
    && result?.needsClarification !== true
    && String(result?.status || '').toLowerCase() !== 'needs_clarification') {
    return '';
  }
  return question;
}

const TRANSCRIPT_GAP_RE = /\[(?:unclear|inaudible|unintelligible|\?+)\]|\(\s*(?:unclear|inaudible|\?+)\s*\)/i;

export function hasTranscriptGap(text) {
  return TRANSCRIPT_GAP_RE.test(String(text || ''));
}

/** If the model skipped a missed-word marker, still ask before filing. */
export function transcriptGapQuestion(text, alreadyAsked) {
  if (alreadyAsked || !hasTranscriptGap(text)) return '';
  return 'I missed a word in what you said — what was it?';
}

export function understandCapture(payload) {
  return client.post('/projects/captures/understand', payload).then((r) => {
    const data = r.data || {};
    ingestAiDebug('Capture conversation', data);
    return data;
  });
}

// Check-in conversation — same Capture Conversation agent as Projects,
// plus which project (if any) already owns it.
export function understandCheckin(payload) {
  return client.post('/projects/checkin/understand', payload).then((r) => {
    const data = r.data || {};
    ingestAiDebug('Check-in conversation', data);
    return data;
  });
}

// Voice-note → words. Body is the raw audio blob; the conversation keeps the
// transcript, not the recording.
export function transcribeCapture(blob, { hint, keywords } = {}) {
  const headers = { 'Content-Type': blob.type || 'audio/webm' };
  const firstPass = String(hint || '').trim();
  if (firstPass) headers['X-Transcript-Hint'] = encodeURIComponent(firstPass.slice(0, 1500));
  const names = (keywords || []).map((k) => String(k || '').trim()).filter(Boolean);
  if (names.length) headers['X-Transcript-Keywords'] = encodeURIComponent(names.slice(0, 24).join(','));
  return client
    .post('/projects/captures/transcribe', blob, {
      headers,
      transformRequest: [(data) => data],
    })
    .then((r) => {
      const data = r.data || {};
      ingestAiDebug('Voice transcription', data);
      return data;
    });
}

export function correctTranscriptLive(text, { keywords } = {}) {
  const source = String(text || '').trim();
  if (!source) return Promise.resolve({ text: '' });
  return client
    .post('/projects/captures/correct-transcript', {
      text: source.slice(0, 8000),
      keywords: (keywords || []).map((k) => String(k || '').trim()).filter(Boolean).slice(0, 24),
    })
    .then((r) => {
      const data = r.data || {};
      ingestAiDebug('Transcript correction (pause)', data);
      return data;
    });
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
  const arr = await filesForUpload(files);
  if (!arr.length) return [];
  const { data } = await client.post('/projects/uploads/sign', {
    files: arr.map((f) => ({ contentType: f.type || 'application/octet-stream' })),
  });
  const uploads = data.uploads || [];
  await Promise.all(
    arr.map((f, i) => {
      // Both headers are part of the presigned PUT's signature, so they must be
      // sent exactly as the server signed them: Content-Type matches the file,
      // and Cache-Control (immutable) is echoed back from the /sign response so
      // the CDN + browser cache the object long-term.
      const headers = { 'Content-Type': f.type || 'application/octet-stream' };
      if (uploads[i].cacheControl) headers['Cache-Control'] = uploads[i].cacheControl;
      return fetch(uploads[i].uploadUrl, {
        method: 'PUT',
        headers,
        body: f,
      }).then((res) => {
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      });
    })
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
