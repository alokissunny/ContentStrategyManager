/*
 * Image analysis — runs a captured asset through Claude's vision model and
 * returns structured metadata (summary, tags, colours, mood, subjects, any
 * legible text). Used by the Projects detail page: the studio can analyse an
 * asset on demand, and the result is stored on the attachment so the weekly
 * plan can read it back.
 */

const { jsonrepair } = require('jsonrepair');
const { completeToolCall } = require('./llmComplete');
const { getObjectBytes } = require('./s3Client');
const { normalizeSubjects } = require('./subjectBox');
const { toVisionImage } = require('./visionImage');

const ANALYSIS_TOOL = {
  name: 'record_image_analysis',
  description: 'Record what is actually visible in this photograph.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'One short sentence describing the image' },
      description: { type: 'string', description: '2-4 sentences: what it is, the setting, materials/finishes, anything notable' },
      tags: { type: 'array', items: { type: 'string' }, description: '6-12 short lowercase keywords for search' },
      colors: { type: 'array', items: { type: 'string' }, description: 'Dominant colours, plain names or hex' },
      mood: { type: 'string', description: 'A few words on the overall feeling / tone' },
      subjects: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Short name of one visible object or person — not an action' },
            box: {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                w: { type: 'number' },
                h: { type: 'number' },
              },
            },
            point: {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
              },
            },
          },
          required: ['name', 'box', 'point'],
        },
      },
      text: { type: 'string', description: 'Any legible text in the image, verbatim, or empty string if none' },
    },
    required: ['summary', 'description', 'tags', 'colors', 'mood', 'subjects', 'text'],
  },
};

const SYSTEM_PROMPT = `You are a visual analyst for a design studio's content library. You look at one photo and describe what is actually visible — concretely and usefully, so the studio can find and reuse it later. Never invent details you cannot see. Call the record_image_analysis tool with exactly these keys:
{
  "summary": "one short sentence describing the image",
  "description": "2-4 sentences with the useful detail: what it is, the setting, the materials/finishes, anything notable",
  "tags": ["6-12 short lowercase keywords for search"],
  "colors": ["dominant colours, plain names or hex"],
  "mood": "a few words on the overall feeling / tone",
  "subjects": [
    {
      "name": "short name of one visible object or person — not an action",
      "box": { "x": 0, "y": 0, "w": 0, "h": 0 },
      "point": { "x": 0, "y": 0 }
    }
  ],
  "text": "any legible text in the image, verbatim, or empty string if none"
}

subjects: list the 3–8 most important things in the frame. Every subject MUST have a tight box and a point.

box is the tight axis-aligned bounding box of THAT subject as percentages of the full image (0–100). Origin is the top-left corner. x,y is the top-left of the box. w,h are width and height.

point is the exact spot an arrow should hit — the centre of the named thing.

CRITICAL box rules:
- HUG the named thing. Typical w and h are 6–18. A box covering more than ~25% of the image height is almost always too big.
- Never wrap a person and the object they are handling in one subject. Split them: the person is one subject (body only); the object (pendant, fitting, tool) is another subject with a small box on that object only.
- Name the object, not the action. Use "pendant light", not "pendant light being installed".
- Do not include nearby doors, cabinets, empty space, or the installer in an object box.

Bad: one tall box from ceiling to cabinets named "pendant being installed".
Good: a small box on the gold cylinder (point on the fitting) plus a separate box on the person.`;

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

function extractJsonObject(text) {
  const src = String(text || '');
  const start = src.indexOf('{');
  if (start === -1) return '';
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inStr) { escaped = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  const end = src.lastIndexOf('}');
  return end > start ? src.slice(start, end + 1) : src.slice(start);
}

function softenJson(s) {
  return escapeControlCharsInStrings(s)
    .replace(/,\s*,+/g, ',')
    .replace(/,\s*([}\]])/g, '$1');
}

// Pull the JSON object out of the model's reply, tolerating stray prose, a
// ```json fence, trailing/double commas, and truncated tails.
function parseAnalysisJson(raw) {
  const fenced = String(raw || '').match(/```(?:json)?\s*([\s\S]*?)```/i);
  const slice = extractJsonObject(fenced ? fenced[1] : raw);
  if (!slice) throw new Error('No JSON object in model response');
  const attempts = [slice, softenJson(slice)];
  let lastErr;
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch (err) {
      lastErr = err;
    }
  }
  try {
    return JSON.parse(jsonrepair(softenJson(slice)));
  } catch (err) {
    throw lastErr || err;
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
  const vision = await toVisionImage(buffer, contentType, key);

  const model = process.env.ANTHROPIC_VISION_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const done = await completeToolCall({
    model,
    system: SYSTEM_PROMPT,
    userParts: [
      { type: 'image', mediaType: vision.mediaType, data: vision.buffer.toString('base64') },
      {
        type: 'text',
        text: 'Analyse this image. Keep every subject box tight on that one thing. Split people from objects they are installing or holding.',
      },
    ],
    tool: ANALYSIS_TOOL,
    maxTokens: 4096,
    retryHint: 'Call record_image_analysis with valid JSON. No trailing commas. Escape quotes inside strings.',
  });

  const parsed = done.parsed && typeof done.parsed === 'object'
    ? done.parsed
    : parseAnalysisJson(done.output || done.text || '');
  const inputTokens = Number(done.usage?.input_tokens) || 0;
  const outputTokens = Number(done.usage?.output_tokens) || 0;
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
