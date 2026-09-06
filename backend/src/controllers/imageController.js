const User = require('../models/User');
const { currentUsername } = require('../utils/currentProfile');
const { isImageGenConfigured } = require('../services/geminiImage');
const {
  prefixOf,
  buildImagePrompt,
  renderAndStoreGeneratedImage,
} = require('../services/generatedImage');
const {
  isS3Configured,
  getMediaUrl,
  deleteObjects,
} = require('../services/s3Client');

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
  const finalPrompt = buildImagePrompt(prompt, brand);

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

  const handle = (await currentUsername(req.user._id)) || '';
  const { key, mimeType, model } = await renderAndStoreGeneratedImage({
    prompt,
    brand,
    userId: req.user._id,
    handle,
  });
  const url = await getMediaUrl(key);

  res.status(201).json({ key, url, mimeType, model, finalPrompt, handle, addedAt: Date.now() });
}

// GET /api/images/generated → { images: [{ key, prompt, model, addedAt, url }] }
// Only the images generated under the currently active handle, so the folder
// switches with the account — the same scoping as mood images and plans.
async function listGeneratedImages(req, res) {
  const handle = (await currentUsername(req.user._id)) || '';
  const user = await User.findById(req.user._id).select('generatedImages').lean();
  const all = (user && user.generatedImages) || [];
  // Strict handle match. Legacy rows saved before scoping (empty handle) used
  // to be listed on every account — that is the previous-account photo leak
  // after a header switch. They stay on file; they just no longer cross handles.
  const mine = handle ? all.filter((g) => g.handle === handle) : all;
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
