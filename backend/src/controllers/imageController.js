const crypto = require('crypto');
const User = require('../models/User');
const { currentUsername } = require('../utils/currentProfile');
const { generateImage, isImageGenConfigured } = require('../services/geminiImage');
const {
  isS3Configured,
  uploadBytes,
  getMediaUrl,
  deleteObjects,
} = require('../services/s3Client');

// Generated images live under the same per-user prefix as uploaded media, so
// they flow through every existing path (presigning, cleanup) unchanged.
function prefixOf(userId) {
  return `projects/${userId}/`;
}

const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

// Hard rules appended to EVERY image request. The most important is no text:
// the headline/caption is composited by the layout system on top of the picture
// (the prompts deliberately leave negative space for it), so a model that also
// renders its own — usually garbled — lettering fights that. Kept as one place
// so the guardrails can't drift between the seed, base and typed-ask paths.
//
// THE BAND GUARD (2026-08-12). The earlier "leave clean, uncluttered negative
// space" line told the model to add empty space, which it rendered as a literal
// flat-colour panel down one side — a vertical band the layout then draws copy
// over. Negative space is now defined as part of the PHOTOGRAPHED SCENE (a wall,
// a table, sky), never an empty panel, and full-bleed edge-to-edge framing is
// required outright. Paired with an explicit output aspect ratio (see
// geminiImage.generateImage) so the model composes for the portrait frame
// instead of padding a square to fit it.
const GUARDRAILS = [
  'Produce a single, polished social-media image with a cohesive brand identity.',
  'Do NOT render any text, letters, words, numbers, captions, labels, watermarks, logos, or signatures anywhere in the image — the copy is added afterwards.',
  'Leave a calm, uncluttered area for that copy, but it MUST be part of the photographed scene (a plain wall, tabletop, sky or floor) — never a solid-colour block or empty panel.',
  'Fill the ENTIRE frame edge to edge (full bleed). Do NOT add solid-colour bands, stripes, margins, borders, frames, panels, gutters, letterboxing or pillarboxing on any side; every edge of the image must be part of the scene.',
  'One continuous scene only — no collages, no split screens, no side-by-side panels unless explicitly asked.',
  'Avoid distorted anatomy (extra or missing fingers/limbs), warped faces, and unreadable/melted geometry, and nothing not-safe-for-work.',
].join(' ');

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

  // brand.font is intentionally NOT used to place text — see GUARDRAILS (no text
  // in the image). The typeface only matters for the layout copy composited later.
  if (brand.mood) lines.push(`Overall mood: ${brand.mood}.`);

  lines.push(GUARDRAILS);
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

  // The full text the renderer actually sees — the studio's ask composed with
  // their brand palette/type/mood and the house tail. Returned so the client's
  // debug view can show exactly what was sent (see WeekView CreateImageChat).
  const finalPrompt = buildPrompt(prompt, brand);

  // Log the exact prompt the renderer will receive, so it's visible in the
  // server console even when the client debug view isn't.
  console.log(
    [
      '',
      '───────── IMAGE GENERATION · FULL PROMPT ─────────',
      `user: ${req.user?._id}`,
      `brand: ${JSON.stringify(brand)}`,
      '── prompt sent to model ──',
      finalPrompt,
      '──────────────────────────────────────────────────',
      '',
    ].join('\n'),
  );

  const { buffer, mimeType, model } = await generateImage(finalPrompt);

  const ext = MIME_EXT[mimeType] || 'png';
  const key = `${prefixOf(req.user._id)}gen-${crypto.randomUUID()}.${ext}`;
  await uploadBytes(key, buffer, mimeType);
  const url = await getMediaUrl(key);

  // Persist a record so the image survives beyond this session — a slide's
  // assetKey resolves against this list on reload, and the Projects page shows
  // them in a "Generated" folder. Tagged with the current handle for account
  // scoping. A DB hiccup here must not fail a good render, so it's best-effort.
  const handle = (await currentUsername(req.user._id)) || '';
  try {
    await User.updateOne(
      { _id: req.user._id },
      { $push: { generatedImages: { $each: [{ key, prompt: finalPrompt, model, handle }], $position: 0 } } },
    );
  } catch (err) {
    console.error('Failed to persist generated image record:', err?.message || err);
  }

  res.status(201).json({ key, url, mimeType, model, finalPrompt, handle, addedAt: Date.now() });
}

// GET /api/images/generated → { images: [{ key, prompt, model, addedAt, url }] }
// Only the images generated under the currently active handle, so the folder
// switches with the account — the same scoping as mood images and plans.
async function listGeneratedImages(req, res) {
  const handle = (await currentUsername(req.user._id)) || '';
  const user = await User.findById(req.user._id).select('generatedImages').lean();
  const all = (user && user.generatedImages) || [];
  // When a handle is active, show that handle's images; legacy records saved
  // before scoping (handle === '') are shown to everyone rather than orphaned.
  const mine = handle ? all.filter((g) => !g.handle || g.handle === handle) : all;
  const images = await Promise.all(
    mine.map(async (g) => ({
      key: g.key,
      prompt: g.prompt || '',
      model: g.model || '',
      addedAt: g.addedAt || 0,
      url: isS3Configured() ? await getMediaUrl(g.key) : '',
    })),
  );
  res.json({ images });
}

// DELETE /api/images/generated/:key → { key }
// Removes the S3 object and the record. Only a key under this user's own prefix
// is ever touched, so no cross-user delete is possible.
async function deleteGeneratedImage(req, res) {
  const key = String(req.params.key || '');
  if (!key.startsWith(prefixOf(req.user._id))) {
    return res.status(403).json({ message: 'Not your image.' });
  }
  if (isS3Configured()) {
    try { await deleteObjects([key]); } catch (err) { console.error('S3 delete failed:', err?.message || err); }
  }
  await User.updateOne({ _id: req.user._id }, { $pull: { generatedImages: { key } } });
  res.json({ key });
}

module.exports = { createImage, listGeneratedImages, deleteGeneratedImage };
