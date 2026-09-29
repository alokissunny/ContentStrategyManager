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
// gpt-image-1-mini output pricing (approximate, USD per image)
const MINI_IMAGE_COST_USD = {
  low: { '1024x1024': 0.005, '1024x1536': 0.006, '1536x1024': 0.006 },
  medium: { '1024x1024': 0.011, '1024x1536': 0.015, '1536x1024': 0.015 },
  high: { '1024x1024': 0.036, '1024x1536': 0.052, '1536x1024': 0.052 },
};

// Per-token image pricing, USD per 1M tokens (text in / image in / image out).
// The images API reports `usage` for GPT image models; when it does, the cost is
// priced from it — the input pictures and prompt are billed too, which the
// flat per-image table above does not see.
// (OpenAI pricing page, Sep 2026)
const IMAGE_TOKEN_PRICE = {
  'gpt-image-1': { textIn: 5, imageIn: 10, out: 40 },
  'gpt-image-1-mini': { textIn: 2, imageIn: 2.5, out: 8 },
  'gpt-image-1.5': { textIn: 5, imageIn: 8, out: 32 },
  'gpt-image-2': { textIn: 5, imageIn: 8, out: 30 },
  'gpt-image-2.5': { textIn: 5, imageIn: 8, out: 30 }, // -flare and -sunburst
};
function tokenPriceFor(model) {
  const m = String(model || '').toLowerCase();
  if (/mini/.test(m)) return IMAGE_TOKEN_PRICE['gpt-image-1-mini'];
  if (/^gpt-image-2\.5/.test(m)) return IMAGE_TOKEN_PRICE['gpt-image-2.5'];
  if (/^gpt-image-2/.test(m)) return IMAGE_TOKEN_PRICE['gpt-image-2'];
  if (/^gpt-image-1\.5/.test(m)) return IMAGE_TOKEN_PRICE['gpt-image-1.5'];
  return IMAGE_TOKEN_PRICE['gpt-image-1'];
}
// `input_fidelity` is only accepted by gpt-image-1 and gpt-image-1.5 (mini and
// the 2.x models answer 400)
const acceptsInputFidelity = (model) => /^gpt-image-1(\.5)?(-\d{4}-\d{2}-\d{2})?$/i.test(String(model || ''));

function costFromImageUsage(usage, model) {
  if (!usage || !(Number(usage.output_tokens) > 0)) return null;
  const p = tokenPriceFor(model);
  const d = usage.input_tokens_details || {};
  const imageIn = Number(d.image_tokens) || 0;
  const textIn = Number(d.text_tokens) || Math.max(0, (Number(usage.input_tokens) || 0) - imageIn);
  const out = Number(usage.output_tokens) || 0;
  return {
    inputTokens: Number(usage.input_tokens) || textIn + imageIn,
    outputTokens: out,
    totalTokens: Number(usage.total_tokens) || textIn + imageIn + out,
    estimatedCostUsd: (textIn * p.textIn + imageIn * p.imageIn + out * p.out) / 1e6,
  };
}

function estimateImageCostUsd(size, quality, model = DEFAULT_MODEL) {
  const override = Number(process.env.OPENAI_IMAGE_COST_USD);
  if (Number.isFinite(override) && override >= 0) return override;
  const q = String(quality || DEFAULT_QUALITY || 'medium').toLowerCase();
  const s = String(size || DEFAULT_SIZE || '1024x1536');
  const table = /mini/i.test(String(model || '')) ? MINI_IMAGE_COST_USD : IMAGE_COST_USD;
  return (table[q] && table[q][s]) || table.medium['1024x1536'];
}

// Whether image generation is configured at all — lets callers answer with a
// clear message instead of throwing when no key is present.
function isImageGenConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Generate a single image from a prompt.
 * @param {string} prompt fully-composed instruction (subject + brand style + guardrails).
 * @param {{ size?: string, quality?: string, background?: 'transparent'|'opaque'|'auto' }} [opts]
 *        optional output shape / quality. `background: 'transparent'` forces a PNG.
 * @returns {Promise<{ buffer: Buffer, mimeType: string, model: string }>}
 */
async function generateImage(prompt, opts = {}) {
  const text = String(prompt || '').trim();
  if (!text) throw new Error('A prompt is required to generate an image.');

  const client = getOpenAIClient();
  const model = DEFAULT_MODEL;
  const size = opts.size || DEFAULT_SIZE;
  const quality = opts.quality || DEFAULT_QUALITY;
  const background = ['transparent', 'opaque', 'auto'].includes(opts.background) ? opts.background : '';
  // Transparency is only honoured for PNG (and WebP). Force PNG so a jpeg
  // default in the environment cannot flatten a sticker onto a white box.
  const format = background === 'transparent' ? 'png' : OUTPUT_FORMAT;

  // A hard request timeout is a guard rail: a stalled render fails fast instead
  // of holding the plan pipeline open. Overridable; default 120s (image models
  // are slower than text).
  const timeout = Number(process.env.OPENAI_IMAGE_TIMEOUT_MS) || 120000;
  const started = Date.now();

  let usedFormat = format;
  let response;
  try {
    response = await client.images.generate(
      {
        model,
        prompt: text,
        size,
        quality,
        n: 1,
        output_format: format,
        ...(format === 'png' ? {} : { output_compression: OUTPUT_COMPRESSION }),
        ...(background ? { background } : {}),
      },
      { timeout },
    );
  } catch (err) {
    // Some deployments reject `quality`/`size`/`output_format` combinations for
    // a given model build — retry once with only the prompt so a stray option
    // never fails the whole render.
    console.warn('[openaiImage] generate rejected, retrying minimal request:', err?.message || err);
    usedFormat = OUTPUT_FORMAT;
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
    mimeType: FORMAT_MIME[usedFormat] || 'image/png',
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

/**
 * Compose a new picture from SEVERAL input pictures and a prompt (gpt-image-1
 * multi-image edit) — the Theme Apply agent hands it the slide as it is, the
 * studio's reference and the slide's own photo, and gets the finished slide
 * back as one image. `images[0]` is the one the output should follow most
 * closely; `input_fidelity: 'high'` keeps faces, type and product detail.
 * @param {{ images: { buffer: Buffer, mediaType?: string, name?: string }[], prompt: string,
 *   size?: string, quality?: string }} p
 * @returns {Promise<{ buffer, mimeType, model, elapsedMs, size, estimatedCostUsd }>}
 */
async function composeImage({ images, prompt, size, quality, model: wanted } = {}) {
  const text = String(prompt || '').trim();
  if (!text) throw new Error('A prompt is required to compose an image.');
  const list = (Array.isArray(images) ? images : []).filter((im) => im?.buffer?.length).slice(0, 16);
  if (!list.length) throw new Error('There are no pictures to compose from.');
  const { toFile } = require('openai');
  const client = getOpenAIClient();
  const model = wanted || DEFAULT_MODEL;
  const q = quality || 'medium';
  const s = size || '1024x1536';
  const timeout = Number(process.env.OPENAI_THEME_IMAGE_TIMEOUT_MS) || 240000;
  const filesOf = () => Promise.all(list.map((im, i) => {
    const type = /png|webp|jpe?g/i.test(String(im.mediaType || '')) ? im.mediaType : 'image/jpeg';
    const ext = type.includes('png') ? 'png' : (type.includes('webp') ? 'webp' : 'jpg');
    return toFile(im.buffer, `${im.name || `input-${i + 1}`}.${ext}`, { type });
  }));
  const started = Date.now();
  let response;
  try {
    response = await client.images.edit(
      {
        model,
        image: await filesOf(),
        prompt: text,
        size: s,
        quality: q,
        // keeps faces / type / detail of the inputs — only where the model takes it
        ...(acceptsInputFidelity(model) ? { input_fidelity: 'high' } : {}),
        n: 1,
        output_format: OUTPUT_FORMAT,
        ...(OUTPUT_FORMAT === 'png' ? {} : { output_compression: Math.max(OUTPUT_COMPRESSION, 90) }),
      },
      { timeout },
    );
  } catch (err) {
    console.warn('[openaiImage] compose rejected, retrying minimal request:', err?.message || err);
    response = await client.images.edit({ model, image: await filesOf(), prompt: text, size: s, quality: q, n: 1 }, { timeout });
  }
  const b64 = response?.data?.[0]?.b64_json;
  if (!b64) throw new Error('The image model returned no picture.');
  return {
    buffer: Buffer.from(b64, 'base64'),
    mimeType: FORMAT_MIME[OUTPUT_FORMAT] || 'image/png',
    model,
    quality: q,
    elapsedMs: Date.now() - started,
    size: s,
    // what the API billed (tokens), else the flat per-image estimate
    usage: costFromImageUsage(response?.usage, model),
    estimatedCostUsd: costFromImageUsage(response?.usage, model)?.estimatedCostUsd ?? estimateImageCostUsd(s, q, model),
  };
}

module.exports = { generateImage, editImage, composeImage, costFromImageUsage, isImageGenConfigured, estimateImageCostUsd, DEFAULT_MODEL };
