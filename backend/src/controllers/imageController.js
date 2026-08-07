const crypto = require('crypto');
const { generateImage, isImageGenConfigured } = require('../services/geminiImage');
const { isS3Configured, uploadBytes, getPresignedMediaUrl } = require('../services/s3Client');

// Generated images live under the same per-user prefix as uploaded media, so
// they flow through every existing path (presigning, cleanup) unchanged.
function prefixOf(userId) {
  return `projects/${userId}/`;
}

const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

// Compose the studio's plain-language request with its Visual Brand so the
// picture sits with the rest of their posts. `brand` is optional and fully
// client-supplied — treated as style hints, never as trusted instructions.
function buildPrompt(prompt, brand = {}) {
  const lines = [String(prompt || '').trim()];

  const style = [];
  if (brand.accent) style.push(`accent colour ${brand.accent}`);
  if (brand.primary) style.push(`primary/ink colour ${brand.primary}`);
  if (brand.neutral) style.push(`neutral/background colour ${brand.neutral}`);
  if (style.length) lines.push(`Use this brand palette: ${style.join(', ')}.`);

  if (brand.font) lines.push(`If any text appears, set it in a typeface like "${brand.font}".`);
  if (brand.mood) lines.push(`Overall mood: ${brand.mood}.`);

  lines.push(
    'Produce a single, polished social-media image, consistent with a cohesive brand identity. No watermarks or logos unless asked.'
  );
  return lines.filter(Boolean).join('\n');
}

// POST /api/images/create
// Body: { prompt, brand? } → { key, url, mimeType, model }.
// Renders the prompt with "nano banana" (Gemini 2.5 Flash Image) and stores the
// bytes on S3, returning the object key (to persist onto a slide) and a
// short-lived presigned read URL (to show it immediately).
async function createImage(req, res) {
  if (!isImageGenConfigured()) {
    return res
      .status(503)
      .json({ message: 'Image generation is not configured (set GEMINI_API_KEY, or GOOGLE_GENAI_USE_VERTEXAI with a project).' });
  }
  if (!isS3Configured()) {
    return res.status(503).json({ message: 'Media storage is not configured (set S3_BUCKET_NAME).' });
  }

  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt) return res.status(400).json({ message: 'A prompt is required.' });
  if (prompt.length > 2000) return res.status(400).json({ message: 'Prompt is too long.' });

  const brand = req.body?.brand && typeof req.body.brand === 'object' ? req.body.brand : {};

  const { buffer, mimeType, model } = await generateImage(buildPrompt(prompt, brand));

  const ext = MIME_EXT[mimeType] || 'png';
  const key = `${prefixOf(req.user._id)}gen-${crypto.randomUUID()}.${ext}`;
  await uploadBytes(key, buffer, mimeType);
  const url = await getPresignedMediaUrl(key);

  res.status(201).json({ key, url, mimeType, model });
}

module.exports = { createImage };
