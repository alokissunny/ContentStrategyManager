/*
 * OpenAI image generation — turns a text prompt into a picture with OpenAI's
 * `gpt-image-1` model. This is the render backend for the Visual Generator
 * agent (see services/visualAgent.js): the plan pipeline decides a slide needs a
 * conceptual visual it has no supplied asset for, the agent writes an
 * art-direction prompt, and this module renders the bytes so they can be stored
 * on S3 like any other project photo.
 *
 * It intentionally mirrors the small surface of services/geminiImage.js
 * (`generateImage(prompt, opts) -> { buffer, mimeType, model }` and
 * `isImageGenConfigured()`), so callers can swap render backends without change.
 *
 * Auth is the same OPENAI_API_KEY used elsewhere (competitor discovery, plan
 * text agents) — no extra credentials.
 */

const getOpenAIClient = require('./openaiClient');

// Overridable so the model id can be swapped without a code change.
const DEFAULT_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';

// gpt-image-1 only renders a fixed set of sizes. Instagram carousels are 4:5
// portrait; the closest supported shape is 1024x1536 (2:3 portrait), which the
// layout cover-crops into the 4:5 frame. Square (1024x1024) and landscape
// (1536x1024) are the other choices. Overridable via OPENAI_IMAGE_SIZE.
const DEFAULT_SIZE = process.env.OPENAI_IMAGE_SIZE || '1024x1536';

// Render quality: 'low' | 'medium' | 'high' | 'auto'. Medium is a sensible
// cost/quality default for social imagery; bump to 'high' via env when needed.
const DEFAULT_QUALITY = process.env.OPENAI_IMAGE_QUALITY || 'medium';

const OUTPUT_FORMAT = (process.env.OPENAI_IMAGE_FORMAT || 'png').toLowerCase();
const FORMAT_MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

// WebP/JPEG compression (0–100). The model's default is 100 — a 1024×1536 WebP
// came out at ~1.7 MB, which is what made a new visual paint in slowly on the
// slide. ~80 is visually the same for social imagery at a fraction of the bytes.
// Ignored for PNG. Overridable via OPENAI_IMAGE_COMPRESSION.
const OUTPUT_COMPRESSION = Math.max(0, Math.min(100, Number(process.env.OPENAI_IMAGE_COMPRESSION) || 80));

// Approximate gpt-image-1 output pricing per image (USD), by quality × size — the
// image cost is NOT reported as token usage, so estimate it for the debug panel.
// Override a single flat per-image price with OPENAI_IMAGE_COST_USD.
const IMAGE_COST_USD = {
  low: { '1024x1024': 0.011, '1024x1536': 0.016, '1536x1024': 0.016 },
  medium: { '1024x1024': 0.042, '1024x1536': 0.063, '1536x1024': 0.063 },
  high: { '1024x1024': 0.167, '1024x1536': 0.25, '1536x1024': 0.25 },
};

function estimateImageCostUsd(size, quality) {
  const override = Number(process.env.OPENAI_IMAGE_COST_USD);
  if (Number.isFinite(override) && override >= 0) return override;
  const q = String(quality || DEFAULT_QUALITY || 'medium').toLowerCase();
  const s = String(size || DEFAULT_SIZE || '1024x1536');
  return (IMAGE_COST_USD[q] && IMAGE_COST_USD[q][s]) || IMAGE_COST_USD.medium['1024x1536'];
}

// Whether image generation is configured at all — lets callers answer with a
// clear message instead of throwing when no key is present.
function isImageGenConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Generate a single image from a prompt.
 * @param {string} prompt fully-composed instruction (subject + brand style + guardrails).
 * @param {{ size?: string, quality?: string }} [opts] optional output shape / quality.
 * @returns {Promise<{ buffer: Buffer, mimeType: string, model: string }>}
 */
async function generateImage(prompt, opts = {}) {
  const text = String(prompt || '').trim();
  if (!text) throw new Error('A prompt is required to generate an image.');

  const client = getOpenAIClient();
  const model = DEFAULT_MODEL;
  const size = opts.size || DEFAULT_SIZE;
  const quality = opts.quality || DEFAULT_QUALITY;

  // A hard request timeout is a guard rail: a stalled render fails fast instead
  // of holding the plan pipeline open. Overridable; default 120s (image models
  // are slower than text).
  const timeout = Number(process.env.OPENAI_IMAGE_TIMEOUT_MS) || 120000;
  const started = Date.now();

  let response;
  try {
    response = await client.images.generate(
      {
        model,
        prompt: text,
        size,
        quality,
        n: 1,
        output_format: OUTPUT_FORMAT,
        ...(OUTPUT_FORMAT === 'png' ? {} : { output_compression: OUTPUT_COMPRESSION }),
      },
      { timeout },
    );
  } catch (err) {
    // Some deployments reject `quality`/`size`/`output_format` combinations for
    // a given model build — retry once with only the prompt so a stray option
    // never fails the whole render.
    console.warn('[openaiImage] generate rejected, retrying minimal request:', err?.message || err);
    response = await client.images.generate({ model, prompt: text, n: 1 }, { timeout });
  }

  const b64 = response?.data?.[0]?.b64_json;
  if (!b64) {
    const note = response?.data?.[0]?.revised_prompt || '';
    throw new Error(
      note
        ? `The image model returned no picture: ${note}`
        : 'The image model returned no picture. Try rephrasing the request.',
    );
  }

  return {
    buffer: Buffer.from(b64, 'base64'),
    mimeType: FORMAT_MIME[OUTPUT_FORMAT] || 'image/png',
    model,
    elapsedMs: Date.now() - started,
    estimatedCostUsd: estimateImageCostUsd(size, quality),
  };
}

/**
 * Edit an existing picture with a prompt (gpt-image-1 image edit) — Editor
 * mode's picture actions, e.g. `Correct the perspective`. The source bytes go
 * in as the image; the output keeps the source's shape (`size: 'auto'`).
 * @param {{ buffer: Buffer, mediaType: string, prompt: string, quality?: string }} p
 * @returns {Promise<{ buffer, mimeType, model, elapsedMs, estimatedCostUsd }>}
 */
async function editImage({ buffer, mediaType, prompt, quality } = {}) {
  const text = String(prompt || '').trim();
  if (!text) throw new Error('A prompt is required to edit an image.');
  if (!buffer || !buffer.length) throw new Error('There is no picture to edit.');
  const { toFile } = require('openai');
  const client = getOpenAIClient();
  const model = DEFAULT_MODEL;
  const q = quality || DEFAULT_QUALITY;
  const timeout = Number(process.env.OPENAI_IMAGE_TIMEOUT_MS) || 120000;
  const type = /png|webp|jpe?g/i.test(String(mediaType || '')) ? mediaType : 'image/jpeg';
  const ext = type.includes('png') ? 'png' : (type.includes('webp') ? 'webp' : 'jpg');
  // keep the photo's shape: gpt-image-1 edits come back in one of three sizes,
  // and `auto` was observed returning a square for a 3:4 portrait
  let size = '1024x1536';
  try {
    const sharp = require('sharp');
    const meta = await sharp(buffer).rotate().metadata();
    const w = Number(meta.width) || 0;
    const h = Number(meta.height) || 0;
    // EXIF orientation 5–8 swaps width and height
    const [W, H] = Number(meta.orientation) >= 5 ? [h, w] : [w, h];
    if (W && H) size = W / H > 1.15 ? '1536x1024' : (H / W > 1.15 ? '1024x1536' : '1024x1024');
  } catch { /* keep the portrait default — carousels are 4:5 */ }
  const started = Date.now();
  const file = await toFile(buffer, `source.${ext}`, { type });
  let response;
  try {
    response = await client.images.edit(
      {
        model,
        image: file,
        prompt: text,
        size,
        quality: q,
        n: 1,
        output_format: OUTPUT_FORMAT,
        ...(OUTPUT_FORMAT === 'png' ? {} : { output_compression: OUTPUT_COMPRESSION }),
      },
      { timeout },
    );
  } catch (err) {
    console.warn('[openaiImage] edit rejected, retrying minimal request:', err?.message || err);
    const again = await toFile(buffer, `source.${ext}`, { type });
    response = await client.images.edit({ model, image: again, prompt: text, size, n: 1 }, { timeout });
  }
  const b64 = response?.data?.[0]?.b64_json;
  if (!b64) throw new Error('The image model returned no picture.');
  return {
    buffer: Buffer.from(b64, 'base64'),
    mimeType: FORMAT_MIME[OUTPUT_FORMAT] || 'image/png',
    model,
    elapsedMs: Date.now() - started,
    size,
    estimatedCostUsd: estimateImageCostUsd(size, q),
  };
}

module.exports = { generateImage, editImage, isImageGenConfigured, estimateImageCostUsd, DEFAULT_MODEL };
