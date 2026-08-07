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
 * @returns {Promise<{ buffer: Buffer, mimeType: string, model: string }>}
 */
async function generateImage(prompt) {
  const text = String(prompt || '').trim();
  if (!text) throw new Error('A prompt is required to generate an image.');

  const ai = getClient();
  const model = DEFAULT_MODEL;

  const response = await ai.models.generateContent({
    model,
    contents: text,
  });

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
