/*
 * Image analysis — runs a captured asset through Claude's vision model and
 * returns structured metadata (summary, tags, colours, mood, subjects, any
 * legible text). Used by the Projects detail page: the studio can analyse an
 * asset on demand, and the result is stored on the attachment so the weekly
 * plan can read it back.
 */

const getAnthropicClient = require('./anthropicClient');
const { getObjectBytes } = require('./s3Client');
const { normalizeSubjects } = require('./subjectBox');

// Claude vision accepts these; HEIC and others are not supported, so we bail
// out early with a clear message rather than sending bytes the API rejects.
const SUPPORTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// Map a stored Content-Type (or a file extension fallback) to a media type the
// vision API understands.
function resolveMediaType(contentType, key) {
  const ct = (contentType || '').toLowerCase().split(';')[0].trim();
  if (SUPPORTED_MEDIA_TYPES.includes(ct)) return ct;
  if (ct === 'image/jpg') return 'image/jpeg';
  const ext = (key || '').toLowerCase().split('.').pop();
  const byExt = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
  return byExt[ext] || null;
}

const SYSTEM_PROMPT = `You are a visual analyst for a design studio's content library. You look at one photo and describe what is actually visible — concretely and usefully, so the studio can find and reuse it later. Never invent details you cannot see. Respond with ONLY a JSON object, no prose or markdown fences, using exactly these keys:
{
  "summary": "one short sentence describing the image",
  "description": "2-4 sentences with the useful detail: what it is, the setting, the materials/finishes, anything notable",
  "tags": ["6-12 short lowercase keywords for search"],
  "colors": ["dominant colours, plain names or hex"],
  "mood": "a few words on the overall feeling / tone",
  "subjects": [
    {
      "name": "short name of one visible object, person, or scene element",
      "box": { "x": 0, "y": 0, "w": 0, "h": 0 }
    }
  ],
  "text": "any legible text in the image, verbatim, or empty string if none"
}

subjects: list the 3–8 most important things in the frame. Every subject MUST have a box.

box is the tight axis-aligned bounding box of THAT subject as percentages of the full image (0–100). Origin is the top-left corner. x,y is the top-left of the box. w,h are width and height. Point at the object itself — not a nearby door, wall, empty space, or the person holding it unless the subject is the person.

A specific object someone is installing or holding (pendant light, fitting, tool) is its own subject with its own box around that object.`;

// Models sometimes put a raw newline or tab *inside* a JSON string value (e.g. a
// multi-line description), which JSON.parse rejects ("Bad control character in
// string literal"). Walk the text tracking string state and escape any control
// char (< 0x20) that appears inside a string, leaving structural whitespace and
// already-escaped sequences untouched.
function escapeControlCharsInStrings(s) {
  let out = '';
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    const code = s.charCodeAt(i);
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === '\\' && inStr) { out += ch; escaped = true; continue; }
    if (ch === '"') { inStr = !inStr; out += ch; continue; }
    if (inStr && code < 0x20) {
      if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else out += `\\u${code.toString(16).padStart(4, '0')}`;
      continue;
    }
    out += ch;
  }
  return out;
}

// Pull the JSON object out of the model's reply, tolerating stray prose or a
// ```json fence if the model adds one despite the instruction.
function parseAnalysisJson(raw) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in model response');
  const slice = candidate.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch (err) {
    // Retry once after escaping raw control characters inside string literals.
    return JSON.parse(escapeControlCharsInStrings(slice));
  }
}

const asStringArray = (v) =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 20) : [];

// Approximate API prices in USD per 1M tokens (input, output). Used only to show
// the studio a rough per-asset cost — not billing-grade. Prices per the current
// model catalogue; unknown models fall back to Sonnet-tier rates.
const PRICING = {
  'claude-fable-5': { in: 10, out: 50 },
  'claude-mythos-5': { in: 10, out: 50 },
  'claude-opus-5': { in: 5, out: 25 },
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-opus-4-7': { in: 5, out: 25 },
  'claude-opus-4-6': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 },
};

function estimateCost(model, inputTokens, outputTokens) {
  const p = PRICING[model] || PRICING['claude-sonnet-5'];
  return ((inputTokens * p.in) + (outputTokens * p.out)) / 1_000_000;
}

/**
 * Analyse a single stored image asset. Returns the descriptive fields for the
 * attachment's `analysis` sub-document (status/model/analyzedAt are set by the
 * caller). Throws on unsupported types or an API/parse failure.
 */
async function analyzeImageAsset(key, { type } = {}) {
  if (type && type !== 'image') {
    const err = new Error('Only images can be analysed');
    err.code = 'UNSUPPORTED_TYPE';
    throw err;
  }

  const { buffer, contentType } = await getObjectBytes(key);
  const mediaType = resolveMediaType(contentType, key);
  if (!mediaType) {
    const err = new Error('This image format can’t be analysed (try JPEG, PNG, GIF or WebP)');
    err.code = 'UNSUPPORTED_TYPE';
    throw err;
  }

  const model = process.env.ANTHROPIC_VISION_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model,
    max_tokens: 1536,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: buffer.toString('base64') } },
          { type: 'text', text: 'Analyse this image and respond with only the JSON object.' },
        ],
      },
    ],
  });

  const raw = (response.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  const parsed = parseAnalysisJson(raw);
  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  return {
    summary: String(parsed.summary || '').trim(),
    description: String(parsed.description || '').trim(),
    tags: asStringArray(parsed.tags),
    colors: asStringArray(parsed.colors),
    mood: String(parsed.mood || '').trim(),
    subjects: normalizeSubjects(parsed.subjects),
    text: String(parsed.text || '').trim(),
    model,
    inputTokens,
    outputTokens,
    costUsd: estimateCost(model, inputTokens, outputTokens),
  };
}

module.exports = { analyzeImageAsset };
