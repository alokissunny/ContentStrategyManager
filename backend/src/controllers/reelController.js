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

// Upload media directly to the current user's S3 prefix; assembly accepts only
// these fixed container/image types, never arbitrary URLs or filesystem paths.
const MEDIA_EXT = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_DURATION_SEC = 185; // ~3 min reel + a little tolerance
// A user only ever gets keys under their own prefix — never trust a client key
// pointing elsewhere (mirrors projectController.prefixOf).
function prefixOf(userId) {
  return `projects/${userId}/`;
}
const VIDEO_KEY_RE = /^projects\/[a-f0-9]{24}\/[A-Za-z0-9._-]+\.(mp4|webm|mov)$/i;
const EXT_MIME = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const MEDIA_KEY_RE = /^projects\/[a-f0-9]{24}\/[A-Za-z0-9._-]+\.(mp4|webm|mov|jpe?g|png|webp)$/i;
const TRANSITIONS = new Set(['none', 'fade', 'slide']);
const MAX_ASSETS = 12;
const MAX_ASSET_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;
let activeAssemblies = 0;

function manifestKey(key) { return `${key}.assembly.json`; }

function validateAssemblyInput(raw, userId, transition) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_ASSETS) {
    throw new Error(`Choose between 1 and ${MAX_ASSETS} videos or photos.`);
  }
  if (!TRANSITIONS.has(transition)) throw new Error('Choose cuts, crossfade, or slide transitions.');
  return raw.map((item, index) => {
    const key = typeof item?.key === 'string' ? item.key.trim() : '';
    if (!MEDIA_KEY_RE.test(key) || !key.startsWith(prefixOf(userId))) {
      throw new Error(`Media ${index + 1} is not a valid upload for this account.`);
    }
    const ext = key.split('.').pop().toLowerCase();
    const contentType = EXT_MIME[ext];
    const kind = contentType.startsWith('image/') ? 'image' : 'video';
    if (item.kind != null && item.kind !== kind) throw new Error(`Media ${index + 1} has the wrong type.`);
    if (kind === 'image') {
      const durationSec = item.durationSec ?? 3;
      if (typeof durationSec !== 'number' || !Number.isFinite(durationSec) || durationSec < 1 || durationSec > 10) {
        throw new Error(`Photo ${index + 1} must be shown for 1–10 seconds.`);
      }
      return { key, contentType, kind, durationSec };
    }
    const startSec = item.startSec ?? 0;
    const endSec = item.endSec;
    if (typeof startSec !== 'number' || !Number.isFinite(startSec) || startSec < 0 ||
      (endSec != null && (typeof endSec !== 'number' || !Number.isFinite(endSec) || endSec - startSec < 0.5 || endSec - startSec > 180))) {
      throw new Error(`Video ${index + 1} needs a valid trim range (0.5–180 seconds).`);
    }
    return { key, contentType, kind, startSec, ...(endSec != null ? { endSec } : {}) };
  });
}

// POST /api/reels/assemble — render real media first, then run /edit against its
// final timestamps. The sidecar is server-authored scene context for the agents.
async function assembleReel(req, res) {
  let input;
  const transition = req.body?.transition ?? 'fade';
  const mixMode = req.body?.mixMode ?? 'smart';
  const guidance = String(req.body?.guidance || '').slice(0, 2000);
  if (!['smart', 'manual'].includes(mixMode)) return res.status(400).json({ message: 'Choose Smart mix or Manual sequence.' });
  try { input = validateAssemblyInput(req.body?.assets, req.user._id, transition); }
  catch (error) { return res.status(400).json({ message: error.message }); }
  if (activeAssemblies >= 2) return res.status(429).json({ message: 'The reel renderer is busy. Please try again shortly.' });
  activeAssemblies += 1;
  const storedKeys = [];
  try {
    const assets = [];
    let totalBytes = 0;
    for (const item of input) {
      let media;
      try { media = await getObjectBytes(item.key); }
      catch { return res.status(404).json({ message: 'One of the uploaded files is missing. Upload it again.' }); }
      totalBytes += media.buffer.length;
      if (media.buffer.length > MAX_ASSET_BYTES || totalBytes > MAX_TOTAL_BYTES) {
        return res.status(413).json({ message: 'Use files under 100 MB each and 300 MB combined.' });
      }
      assets.push({ ...item, buffer: media.buffer });
    }
    let mixed;
    let rendered;
    if (mixMode === 'smart') {
      mixed = await require('../services/reelMixerAgent').planReelMix({ assets, guidance });
      rendered = await require('../services/reelMixerRender').renderMixedReel({ assets, plan: mixed.plan });
    } else {
      rendered = await require('../services/reelAssembly').assembleReel({ assets, transition });
    }
    const key = `${prefixOf(req.user._id)}${crypto.randomUUID()}-assembled.mp4`;
    const assembly = { version: 2, durationSec: rendered.durationSec, transition: mixed?.plan.transition || transition, clips: rendered.clips, ...(mixed ? { mixPlan: mixed.plan, overlays: rendered.overlays || [] } : {}) };
    await uploadBytes(key, rendered.buffer, 'video/mp4');
    storedKeys.push(key);
    await uploadBytes(manifestKey(key), Buffer.from(JSON.stringify(assembly)), 'application/json');
    storedKeys.push(manifestKey(key));
    const url = await getPresignedDownloadUrl(key);
    return res.json({ key, url, contentType: 'video/mp4', durationSec: rendered.durationSec, clips: rendered.clips, mixPlan: mixed?.plan || null, debug: mixed?.debug || { agents: [] }, notes: [...(mixed?.notes || []), ...(rendered.notes || [])] });
  } catch (error) {
    if (storedKeys.length) {
      try { await require('../services/s3Client').deleteObjects(storedKeys); } catch { /* best effort orphan cleanup */ }
    }
    console.error('[reel] assembly failed:', error.message);
    const status = error.statusCode === 400 ? 400 : 500;
    return res.status(status).json({ message: status === 400 ? error.message : 'Could not stitch these files. Please check the clips and try again.' });
  } finally { activeAssemblies -= 1; }
}

// POST /api/reels/uploads/sign  { contentType } → { key, uploadUrl, cacheControl }
async function signUpload(req, res) {
  if (!isS3Configured()) {
    return res.status(503).json({ message: 'Media storage is not configured (set S3_BUCKET_NAME).' });
  }
  const contentType = String(req.body?.contentType || '').toLowerCase();
  const ext = MEDIA_EXT[contentType];
  if (!ext) {
    return res.status(400).json({ message: 'Unsupported media type. Upload MP4, MOV, WebM, JPEG, PNG, or WebP.' });
  }
  const key = `${prefixOf(req.user._id)}${crypto.randomUUID()}${req.body?.purpose === 'reel-export' ? '-export-tmp' : ''}.${ext}`;
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
  let dur = Number(durationSec);
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

  let assembly;
  if (clean.endsWith('-assembled.mp4')) {
    try {
      const stored = await getObjectBytes(manifestKey(clean));
      assembly = JSON.parse(stored.buffer.toString('utf8'));
      if (!Number.isFinite(assembly.durationSec) || assembly.durationSec <= 0 || assembly.durationSec > 180 || !Array.isArray(assembly.clips)) throw new Error('Invalid assembly manifest');
      dur = assembly.durationSec;
    } catch {
      return res.status(404).json({ message: 'The assembled reel details are missing. Regenerate the reel from your source files.' });
    }
  }
  const ext = String(clean.split('.').pop() || '').toLowerCase();
  let pipelineBuffer = bytes.buffer;
  let pipelineContentType = EXT_MIME[ext] || 'video/mp4';
  let audioCleanup = { status: 'disabled' };
  const audioNotes = [];
  if (cleanAudio === true && assembly?.clips?.length && assembly.clips.every((clip) => clip.kind === 'image')) {
    audioCleanup = { status: 'no-audio' };
  } else if (cleanAudio === true) {
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
    assembly,
  });

  res.json({ key: clean, ...result, audioCleanup, mixPlan: assembly?.mixPlan || null, notes: [...audioNotes, ...(result.notes || [])] });
}

function isTemporaryExportKey(key, userId) {
  return typeof key === 'string' && VIDEO_KEY_RE.test(key) && key.startsWith(prefixOf(userId)) && /-export-tmp\.(mp4|webm|mov)$/i.test(key);
}
async function cleanupReelExport(req, res) {
  const keys = req.body?.keys;
  if (!Array.isArray(keys) || keys.length > 2 || !keys.every((key) => isTemporaryExportKey(key, req.user._id))) {
    return res.status(400).json({ message: 'Invalid temporary export files.' });
  }
  if (keys.length) await require('../services/s3Client').deleteObjects(keys);
  return res.json({ ok: true });
}
let activeExports = 0;
async function exportReel(req, res) {
  const { videoKey, audioKey } = req.body || {};
  if (![videoKey, audioKey].every((key) => typeof key === 'string' && VIDEO_KEY_RE.test(key) && key.startsWith(prefixOf(req.user._id)))) {
    return res.status(400).json({ message: 'Upload the rendered reel and its selected audio before exporting.' });
  }
  if (activeExports >= 2) return res.status(429).json({ message: 'The export renderer is busy. Please retry shortly.' });
  activeExports++;
  try {
    const [video, audio] = await Promise.all([getObjectBytes(videoKey), getObjectBytes(audioKey)]);
    if (video.buffer.length > 150 * 1024 * 1024 || audio.buffer.length > MAX_TOTAL_BYTES) {
      return res.status(413).json({ message: 'This reel is too large to export. Shorten the reel and retry.' });
    }
    const output = await require('../services/reelExport').muxReelExport(video.buffer, audio.buffer, EXT_MIME[audioKey.split('.').pop().toLowerCase()]);
    res.set('Content-Type', 'video/mp4');
    res.set('Content-Disposition', 'attachment; filename="finished-reel.mp4"');
    res.set('Cache-Control', 'no-store');
    return res.send(output);
  } catch (error) {
    console.error('[reel] export failed:', error.message);
    return res.status(500).json({ message: 'Could not finish the MP4 export. Please retry.' });
  } finally {
    activeExports--;
    const temporaryKeys = [videoKey, audioKey].filter((key) => isTemporaryExportKey(key, req.user._id));
    if (temporaryKeys.length) {
      try { await require('../services/s3Client').deleteObjects(temporaryKeys); } catch { /* client retries cleanup */ }
    }
  }
}
module.exports = { signUpload, assembleReel, editReel, exportReel, cleanupReelExport };
