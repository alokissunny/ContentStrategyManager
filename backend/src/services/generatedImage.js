/*
 * Shared image-generation helpers used by WeekView "Create image" and by the
 * plan Visual Generator agent. Guardrails live here so the two paths cannot drift.
 */

const crypto = require('crypto');
const User = require('../models/User');
const { generateImage, isImageGenConfigured } = require('./geminiImage');
const { isS3Configured, uploadBytes } = require('./s3Client');

const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

// Hard rules appended to EVERY image request. The most important is no text:
// the headline/caption is composited by the layout system on top of the picture
// (the prompts deliberately leave negative space for it), so a model that also
// renders its own — usually garbled — lettering fights that.
//
// THE BAND GUARD (2026-08-12). Negative space must be part of the PHOTOGRAPHED
// SCENE (a wall, a table, sky), never an empty panel, and full-bleed edge-to-edge
// framing is required outright.
const GUARDRAILS = [
  'Produce a single, polished social-media image with a cohesive brand identity.',
  'Do NOT render any text, letters, words, numbers, captions, labels, watermarks, logos, or signatures anywhere in the image — the copy is added afterwards.',
  'Leave a calm, uncluttered area for that copy, but it MUST be part of the photographed scene (a plain wall, tabletop, sky or floor) — never a solid-colour block or empty panel.',
  'Fill the ENTIRE frame edge to edge (full bleed). Do NOT add solid-colour bands, stripes, margins, borders, frames, panels, gutters, letterboxing or pillarboxing on any side; every edge of the image must be part of the scene.',
  'One continuous scene only — no collages, no split screens, no side-by-side panels unless explicitly asked.',
  'Avoid distorted anatomy (extra or missing fingers/limbs), warped faces, and unreadable/melted geometry, and nothing not-safe-for-work.',
].join(' ');

function prefixOf(userId) {
  return `projects/${userId}/`;
}

function buildImagePrompt(prompt, brand = {}) {
  const lines = [String(prompt || '').trim()];

  const style = [];
  if (brand.accent) style.push(`accent colour ${brand.accent}`);
  if (brand.primary) style.push(`primary/ink colour ${brand.primary}`);
  if (brand.neutral) style.push(`neutral/background colour ${brand.neutral}`);
  if (style.length) lines.push(`Use this brand palette: ${style.join(', ')}.`);

  if (brand.mood) lines.push(`Overall mood: ${brand.mood}.`);

  lines.push(GUARDRAILS);
  return lines.filter(Boolean).join('\n');
}

async function persistGeneratedImage({ userId, handle, buffer, mimeType, prompt, model }) {
  if (!userId) throw new Error('userId is required to store a generated image.');
  if (!isS3Configured()) throw new Error('Media storage is not configured (set S3_BUCKET_NAME).');
  const ext = MIME_EXT[mimeType] || 'png';
  const key = `${prefixOf(userId)}gen-${crypto.randomUUID()}.${ext}`;
  await uploadBytes(key, buffer, mimeType);
  try {
    await User.updateOne(
      { _id: userId },
      { $push: { generatedImages: { $each: [{ key, prompt: prompt || '', model: model || '', handle: handle || '' }], $position: 0 } } },
    );
  } catch (err) {
    console.error('Failed to persist generated image record:', err?.message || err);
  }
  return { key, mimeType, model };
}

/**
 * Render a prompt and store the bytes under the user's generated-image library.
 * @returns {Promise<{ key: string, mimeType: string, model: string, finalPrompt: string }>}
 */
async function renderAndStoreGeneratedImage({ prompt, brand, userId, handle }) {
  if (!isImageGenConfigured()) {
    throw new Error('Image generation is not configured.');
  }
  const finalPrompt = buildImagePrompt(prompt, brand);
  const { buffer, mimeType, model } = await generateImage(finalPrompt);
  const stored = await persistGeneratedImage({
    userId,
    handle,
    buffer,
    mimeType,
    prompt: finalPrompt,
    model,
  });
  return { ...stored, finalPrompt };
}

function canStoreGeneratedImage(userId) {
  return Boolean(userId) && isImageGenConfigured() && isS3Configured();
}

module.exports = {
  GUARDRAILS,
  MIME_EXT,
  prefixOf,
  buildImagePrompt,
  persistGeneratedImage,
  renderAndStoreGeneratedImage,
  canStoreGeneratedImage,
};
