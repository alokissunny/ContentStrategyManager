/*
 * Image generation — turns a text prompt into a picture with Google's
 * "nano banana" model (Gemini 2.5 Flash Image), through the Gemini Vertex SDK
 * (@google/genai). Used by the WeekView "Create image" flow: the studio
 * describes an image in its Visual Brand style and we render it, then store the
 * bytes on S3 like any other project photo.
 *
 * Two ways to authenticate, picked from the environment:
 *   • Vertex AI  — set GOOGLE_GENAI_USE_VERTEXAI=true plus GOOGLE_CLOUD_PROJECT
 *     and GOOGLE_CLOUD_LOCATION; auth uses Application Default Credentials
 *     (a service-account key via GOOGLE_APPLICATION_CREDENTIALS, or a workload
 *     identity). This is the "Gemini Vertex" path.
 *   • Gemini Developer API — set GEMINI_API_KEY (or GOOGLE_API_KEY). Simpler for
 *     local development; same SDK, same model.
 */

const { GoogleGenAI } = require('@google/genai');

// "nano banana". Overridable so the GA id can be swapped without a code change.
const DEFAULT_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

// Optional output aspect ratio. OFF by default: the Gemini *Developer API*
// (GEMINI_API_KEY path) does not accept `imageConfig.aspectRatio` for
// gemini-2.5-flash-image — it stalls the request for minutes before the socket
// is terminated (measured 2026-08-12), so sending it by default would tax every
// render. It is not needed for the band guard anyway: the band came from the
// prompt telling the model to leave empty negative space (fixed in
// imageController GUARDRAILS), and the square output is cover-cropped into the
// 4:5 frame by the layout. Set GEMINI_IMAGE_ASPECT (e.g. "4:5") to opt in — only
// worthwhile on the Vertex path, where the field may be honoured; a value the
// backend rejects still falls back to an unconstrained render (see below).
const DEFAULT_ASPECT = process.env.GEMINI_IMAGE_ASPECT || '';

let client;

function usingVertex() {
  return String(process.env.GOOGLE_GENAI_USE_VERTEXAI || '').toLowerCase() === 'true';
}

function apiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
}

// Whether image generation is configured at all — lets the endpoint answer with
// a clear 503 instead of throwing when no credentials are present.
function isImageGenConfigured() {
  return usingVertex() ? Boolean(process.env.GOOGLE_CLOUD_PROJECT) : Boolean(apiKey());
}

function getClient() {
  if (client) return client;
  if (usingVertex()) {
    if (!process.env.GOOGLE_CLOUD_PROJECT) {
      throw new Error(
        'GOOGLE_CLOUD_PROJECT is not set. For Vertex image generation set GOOGLE_GENAI_USE_VERTEXAI=true, GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION (and GOOGLE_APPLICATION_CREDENTIALS).'
      );
    }
    client = new GoogleGenAI({
      vertexai: true,
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.GOOGLE_CLOUD_LOCATION || 'global',
    });
  } else {
    if (!apiKey()) {
      throw new Error(
        'GEMINI_API_KEY is not set. Add it to backend/.env to enable image generation (or configure Vertex with GOOGLE_GENAI_USE_VERTEXAI=true).'
      );
    }
    client = new GoogleGenAI({ apiKey: apiKey() });
  }
  return client;
}

// Pull the first inline image part out of a generateContent response.
function firstImagePart(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part?.inlineData?.data) {
      return {
        data: part.inlineData.data,
        mimeType: part.inlineData.mimeType || 'image/png',
      };
    }
  }
  return null;
}

// Any text the model returned alongside (or instead of) an image — useful for a
// helpful error when the prompt was refused and no picture came back.
function responseText(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p?.text).filter(Boolean).join(' ').trim();
}

/**
 * Generate a single image from a prompt.
 * @param {string} prompt fully-composed instruction (subject + brand style).
 * @param {{ aspectRatio?: string }} [opts] optional output shape (e.g. "4:5").
 *   Off unless set here or via GEMINI_IMAGE_ASPECT — see DEFAULT_ASPECT. A value
 *   the backend rejects falls back to an unconstrained render, never a failure.
 * @returns {Promise<{ buffer: Buffer, mimeType: string, model: string }>}
 */
async function generateImage(prompt, opts = {}) {
  const text = String(prompt || '').trim();
  if (!text) throw new Error('A prompt is required to generate an image.');

  const ai = getClient();
  const model = DEFAULT_MODEL;
  const aspectRatio = opts.aspectRatio || DEFAULT_ASPECT;

  // A hard request timeout is itself a guard rail: a render that stalls (e.g. an
  // unsupported config that hangs the socket) fails fast instead of holding the
  // studio's request open for minutes. Overridable; default 90s.
  const timeout = Number(process.env.GEMINI_IMAGE_TIMEOUT_MS) || 90000;
  const baseConfig = { httpOptions: { timeout } };

  const request = { model, contents: text, config: baseConfig };
  if (aspectRatio) request.config = { ...baseConfig, imageConfig: { aspectRatio } };

  let response;
  try {
    response = await ai.models.generateContent(request);
  } catch (err) {
    // A model or SDK build that rejects the aspect-ratio config must not fail
    // the whole render — retry once without it. The prompt-level band guard
    // (imageController GUARDRAILS) still applies either way.
    if (aspectRatio) {
      console.warn('[image] aspect-ratio config rejected, retrying unconstrained:', err?.message || err);
      response = await ai.models.generateContent({ model, contents: text, config: baseConfig });
    } else {
      throw err;
    }
  }

  const image = firstImagePart(response);
  if (!image) {
    const note = responseText(response);
    throw new Error(
      note
        ? `The image model returned no picture: ${note}`
        : 'The image model returned no picture. Try rephrasing the request.'
    );
  }

  return {
    buffer: Buffer.from(image.data, 'base64'),
    mimeType: image.mimeType,
    model,
  };
}

module.exports = { generateImage, isImageGenConfigured, DEFAULT_MODEL };
