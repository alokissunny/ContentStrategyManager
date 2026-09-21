/**
 * Reel Editor controller (experimental) — presign a video upload, then run the
 * multi-agent edit pipeline over the uploaded clip and return a "reel spec" the
 * frontend overlays on the <video> for a live preview.
 */

const crypto = require('crypto');
const {
  isS3Configured,
  getPresignedUploadUrl,
  getObjectBytes,
  uploadBytes,
  getPresignedDownloadUrl,
  MEDIA_CACHE_CONTROL,
} = require('../services/s3Client');
const { cleanReelAudio } = require('../services/reelAudio');
const { runReelEditor } = require('../services/reelEditorAgent');

// Videos only, and only the browser-safe container types the app already
// supports for project media (see projectController's EXT map + media proxy).
const VIDEO_EXT = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };
const MAX_DURATION_SEC = 185; // ~3 min reel + a little tolerance
// A user only ever gets keys under their own prefix — never trust a client key
// pointing elsewhere (mirrors projectController.prefixOf).
function prefixOf(userId) {
  return `projects/${userId}/`;
}
const VIDEO_KEY_RE = /^projects\/[a-f0-9]{24}\/[A-Za-z0-9._-]+\.(mp4|webm|mov)$/i;
const EXT_MIME = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };

// POST /api/reels/uploads/sign  { contentType } → { key, uploadUrl, cacheControl }
async function signUpload(req, res) {
  if (!isS3Configured()) {
    return res.status(503).json({ message: 'Media storage is not configured (set S3_BUCKET_NAME).' });
  }
  const contentType = String(req.body?.contentType || '').toLowerCase();
  const ext = VIDEO_EXT[contentType];
  if (!ext) {
    return res.status(400).json({ message: 'Unsupported video type. Upload an MP4, MOV, or WebM.' });
  }
  const key = `${prefixOf(req.user._id)}${crypto.randomUUID()}.${ext}`;
  const uploadUrl = await getPresignedUploadUrl(key, contentType);
  res.json({ key, uploadUrl, cacheControl: MEDIA_CACHE_CONTROL });
}

// POST /api/reels/edit  { key, durationSec, guidance, brand } → { spec, transcript, debug, notes }
// Frames sampled on the client (canvas → JPEG) so the vision agent can see the
// video without an ffmpeg step. Bounded hard so the request stays small.
function sanitizeFrames(raw) {
  if (!Array.isArray(raw)) return [];
  const ok = { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1 };
  return raw
    .filter((f) => f && typeof f.data === 'string' && f.data.length && f.data.length < 400000)
    .slice(0, 10)
    .map((f) => ({
      t: Number(f.t) || 0,
      mediaType: ok[f.mediaType] ? f.mediaType : 'image/jpeg',
      data: f.data,
    }));
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

async function editReel(req, res) {
  const { key, durationSec, guidance = '', brand = null, accentColor = '', cleanAudio = false } = req.body || {};
  const clean = String(key || '').trim();
  const frames = sanitizeFrames(req.body?.frames);
  // Accent is sampled from the video on the client; only accept a valid hex.
  const accent = HEX_RE.test(String(accentColor || '').trim()) ? String(accentColor).trim() : '';

  if (!VIDEO_KEY_RE.test(clean) || !clean.startsWith(prefixOf(req.user._id))) {
    return res.status(400).json({ message: 'Upload a clip first, then generate the edit.' });
  }
  const dur = Number(durationSec);
  if (!Number.isFinite(dur) || dur <= 0) {
    return res.status(400).json({ message: 'Could not read the clip length. Re-upload the clip.' });
  }
  if (dur > MAX_DURATION_SEC) {
    return res.status(400).json({ message: `Clip is too long (${Math.round(dur)}s). Clips must be 3 minutes or less.` });
  }

  let bytes;
  try {
    bytes = await getObjectBytes(clean);
  } catch (err) {
    console.error('[reel] could not read uploaded clip', clean, err.message);
    return res.status(404).json({ message: 'Uploaded clip not found. Re-upload and try again.' });
  }

  const ext = String(clean.split('.').pop() || '').toLowerCase();
  let pipelineBuffer = bytes.buffer;
  let pipelineContentType = EXT_MIME[ext] || 'video/mp4';
  let audioCleanup = { status: 'disabled' };
  const audioNotes = [];
  if (cleanAudio === true) {
    try {
      const cleaned = await cleanReelAudio(bytes.buffer, pipelineContentType);
      if (cleaned.status === 'applied') {
        const cleanedKey = `${prefixOf(req.user._id)}${crypto.randomUUID()}-voice.${cleaned.ext}`;
        await uploadBytes(cleanedKey, cleaned.buffer, cleaned.contentType);
        audioCleanup = { status: 'applied', key: cleanedKey, url: await getPresignedDownloadUrl(cleanedKey), contentType: cleaned.contentType };
        pipelineBuffer = cleaned.buffer;
        pipelineContentType = cleaned.contentType;
      } else {
        audioCleanup = { status: 'no-audio' };
        audioNotes.push('This clip has no audio track to clean.');
      }
    } catch (err) {
      console.warn('[reel] audio cleanup unavailable:', err.message);
      audioCleanup = { status: 'failed' };
      audioNotes.push('Voice cleanup was unavailable. This edit uses the original audio; you can regenerate to try again.');
    }
  }
  const result = await runReelEditor({
    buffer: pipelineBuffer,
    contentType: pipelineContentType,
    guidance: String(guidance || '').slice(0, 2000),
    brand: brand && typeof brand === 'object' ? brand : null,
    durationSec: dur,
    frames,
    accentColor: accent,
  });

  res.json({ key: clean, ...result, audioCleanup, notes: [...audioNotes, ...(result.notes || [])] });
}

module.exports = { signUpload, editReel };
