/*
 * Design Rules agent — the first step of Theme Apply.
 *
 * One vision call reads the reference image (an uploaded photo or a library
 * theme's board) and extracts its visual design rules: art direction,
 * composition, typography (typefaces, treatment, hierarchy), colour use,
 * surface, graphic devices, image treatment, effects and don'ts. The rules go
 * into the render prompt (prompts/theme-apply-render.md, {{DESIGN_RULES}}) next
 * to the reference itself. Run once per Theme Apply request; a library theme's
 * rules are cached in memory.
 *
 * Prompt: prompts/theme-design-rules.md. Model: THEME_RULES_MODEL.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { completeToolCall } = require('./llmComplete');
const { estimatePlanCostUsd } = require('./weeklyPlan');

const PROMPT_PATH = path.join(__dirname, '..', '..', 'prompts', 'theme-design-rules.md');
let promptCache = '';
const loadPrompt = () => (promptCache || (promptCache = fs.readFileSync(PROMPT_PATH, 'utf8').trim()));
// gpt-5.6-terra: tested on the library boards (concrete type specs, ~1.5¢/reference)
const MODEL = () => process.env.THEME_RULES_MODEL || 'gpt-5.6-terra';

const textRole = {
  type: 'object',
  properties: {
    classification: { type: 'string', description: 'Typeface classification and character' },
    googleFont: { type: 'string', description: 'Closest real Google Fonts family' },
    weight: { type: 'string' },
    style: { type: 'string', description: 'roman / italic' },
    case: { type: 'string', description: 'all caps / sentence case / title case / small caps / lowercase' },
    letterSpacing: { type: 'string' },
    lineHeight: { type: 'string' },
    size: { type: 'string', description: 'Size relative to the canvas width' },
    alignment: { type: 'string' },
    treatment: { type: 'string', description: 'How it is treated: outline, highlight, band, rotation, overlap, mixed faces…' },
  },
  required: ['classification', 'googleFont', 'weight', 'case', 'size', 'alignment', 'treatment'],
};

const RULES_TOOL = {
  name: 'record_design_rules',
  description: 'Record the visual design rules of the reference image.',
  input_schema: {
    type: 'object',
    properties: {
      artDirection: { type: 'string', description: 'Two or three sentences: the overall style and mood, as a rule a designer can follow' },
      composition: { type: 'array', items: { type: 'string' }, description: 'Layout rules: grid, alignment, scale contrast, density, empty space, margins, where text and pictures sit' },
      typography: {
        type: 'object',
        properties: {
          headline: textRole,
          supporting: textRole,
          labels: textRole,
          hierarchy: { type: 'string', description: 'How the roles contrast (size ratio, weight, face pairing)' },
          rules: { type: 'array', items: { type: 'string' }, description: 'Further typographic rules (pairing, mixing faces, emphasis, line breaks)' },
        },
        required: ['headline', 'supporting', 'labels', 'hierarchy'],
      },
      colourUse: { type: 'array', items: { type: 'string' }, description: 'How colour is used as a pattern: light/dark balance, how much accent and where, contrast — not the brand hues' },
      palette: { type: 'array', items: { type: 'string' }, description: 'The reference\'s own colours as hex, most used first (for information only)' },
      surface: { type: 'string', description: 'Surface and finish: flat, paper, grain, gloss, photographic… or none' },
      graphicDevices: { type: 'array', items: { type: 'string' }, description: 'Each device it really uses and how: shapes, lines, frames, patterns, stickers, marks — empty when none' },
      imageTreatment: { type: 'string', description: 'How photos / illustrations are cropped, framed, masked, layered or filtered — or none' },
      effects: { type: 'array', items: { type: 'string' }, description: 'Each visual effect: what it is, what it is applied to, how strong — empty when none' },
      donts: { type: 'array', items: { type: 'string' }, description: 'What this style never does' },
      output: {
        type: 'object',
        description: 'The expected output format for a slide restyled in this look, with a confidence score for each format',
        properties: {
          htmlConfidence: { type: 'integer', minimum: 0, maximum: 100, description: 'How confident (0–100) that restyling the slide\'s HTML/CSS reproduces this look well' },
          imageConfidence: { type: 'integer', minimum: 0, maximum: 100, description: 'How confident (0–100) that an image render is needed to reproduce this look (graphics, complex shapes or layout). htmlConfidence + imageConfidence = 100' },
          graphicLoad: { type: 'string', enum: ['low', 'medium', 'high'], description: 'How much of the look lives in graphics — illustration, hand-drawn work, material texture, ornament (not the reference\'s own photos)' },
          shapeComplexity: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Simple rectangles / rounded panels (low) … torn, cut, organic or irregular shapes (high)' },
          layoutComplexity: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Orderly grid, aligned blocks (low) … collage, overlapping, layered, rotated, free-form (high)' },
          format: { type: 'string', enum: ['html', 'image'], description: 'The expected output format: image only when graphics and complex shapes or layout clearly need it; otherwise html (preferred; a close call is html)' },
          reason: { type: 'string', description: 'One sentence: why this format' },
        },
        required: ['htmlConfidence', 'imageConfidence', 'graphicLoad', 'shapeComplexity', 'layoutComplexity', 'format', 'reason'],
      },
    },
    required: ['artDirection', 'composition', 'typography', 'colourUse', 'surface', 'graphicDevices', 'imageTreatment', 'effects', 'donts', 'output'],
  },
};

const cache = new Map();

/**
 * @param {{ buffer: Buffer }} reference
 * @param {{ cacheKey?: string }} [opts] a library theme id — its rules are reused
 * @returns {Promise<{ rules, model, prompt, usage } | null>} null when the call failed
 */
async function extractDesignRules(reference, { cacheKey = '' } = {}) {
  if (!reference?.buffer) return null;
  if (cacheKey && cache.has(cacheKey)) return { ...cache.get(cacheKey), cached: true };
  const started = Date.now();
  const model = MODEL();
  try {
    const jpeg = await sharp(reference.buffer).rotate()
      .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
    const system = loadPrompt();
    const done = await completeToolCall({
      model,
      system,
      userParts: [
        { type: 'text', text: 'THE REFERENCE IMAGE:' },
        { type: 'image', mediaType: 'image/jpeg', data: jpeg.toString('base64') },
        { type: 'text', text: 'Extract its visual design rules and call record_design_rules.' },
      ],
      tool: RULES_TOOL,
      maxTokens: 3000,
      reasoningEffort: process.env.THEME_RULES_EFFORT || 'medium',
      retryHint: 'Call record_design_rules with valid JSON.',
    });
    const rules = done.parsed && typeof done.parsed === 'object' ? done.parsed : null;
    if (!rules?.typography) throw new Error('no rules in the answer');
    const i = Number(done.usage?.input_tokens || done.usage?.prompt_tokens) || 0;
    const o = Number(done.usage?.output_tokens || done.usage?.completion_tokens) || 0;
    const out = {
      rules,
      model,
      prompt: system,
      usage: { inputTokens: i, outputTokens: o, totalTokens: i + o, estimatedCostUsd: estimatePlanCostUsd(model, i, o), elapsedMs: Date.now() - started },
    };
    if (cacheKey) cache.set(cacheKey, out);
    return out;
  } catch (err) {
    console.warn(`[themeDesignRules] extraction failed — Theme Apply goes on with the image alone: ${err.message}`);
    return null;
  }
}

// The rules as the render prompt carries them.
function designRulesSection(rules) {
  if (!rules || typeof rules !== 'object') return '';
  const list = (v) => (Array.isArray(v) ? v.filter(Boolean).map((x) => `- ${x}`) : []);
  const role = (name, r) => {
    if (!r || typeof r !== 'object' || !r.classification) return [];
    const bits = [
      r.classification,
      r.googleFont && `closest font: ${r.googleFont}`,
      r.weight && `weight ${r.weight}`,
      r.style, r.case,
      r.letterSpacing && `letter-spacing ${r.letterSpacing}`,
      r.lineHeight && `line-height ${r.lineHeight}`,
      r.size && `size ${r.size}`,
      r.alignment && `aligned ${r.alignment}`,
      r.treatment && `treatment: ${r.treatment}`,
    ].filter(Boolean);
    return [`- ${name}: ${bits.join('; ')}`];
  };
  const t = rules.typography || {};
  const block = (title, lines) => (lines.length ? [`### ${title}`, ...lines, ''] : []);
  return [
    '## Reference inspiration notes',
    '',
    'An art director studied the reference image and wrote these notes on its style. They are INSPIRATION, not rules: take what suits this slide, leave the rest, and never add an element the slide does not have because a note mentions it. (Colours: the hues stay the slide\'s brand colours. Anything about how much copy there is does not apply — the slide\'s words are fixed.)',
    '',
    ...block('Art direction', rules.artDirection ? [rules.artDirection] : []),
    ...block('Composition', list(rules.composition)),
    ...block('Typography — ideas for the slide\'s type', [
      ...role('Headline', t.headline),
      ...role('Supporting text', t.supporting),
      ...role('Labels / eyebrows / captions', t.labels),
      ...(t.hierarchy ? [`- Hierarchy: ${t.hierarchy}`] : []),
      ...list(t.rules),
    ]),
    ...block('Colour use', list(rules.colourUse)),
    ...block('Surface and finish', rules.surface ? [rules.surface] : []),
    ...block('Graphic devices seen in the reference (for its feel only — do not draw them on the slide)', list(rules.graphicDevices)),
    ...block('How it treats pictures (crop, edge, finish — applies only to the slide\'s own pictures)', rules.imageTreatment ? [rules.imageTreatment] : []),
    ...block('Visual effects', list(rules.effects)),
    ...block('What the reference avoids', list(rules.donts)),
  ].join('\n').trim();
}

// The expected output format the Design Rules agent gave for a reference —
// what the Theme Apply agent generates (html | image), with its confidence
// scores. Its `format` decides; without one, the higher score (a tie → html).
// No read at all → html (the preference).
function outputModeOf(rules) {
  const o = rules?.output;
  if (!o || typeof o !== 'object') return { mode: 'html', reason: 'no read of the reference — HTML by default' };
  const score = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(100, Math.round(Number(v)))) : null);
  const htmlConfidence = score(o.htmlConfidence);
  const imageConfidence = score(o.imageConfidence);
  const mode = ['html', 'image'].includes(o.format) ? o.format
    : ((imageConfidence ?? 0) > (htmlConfidence ?? 0) ? 'image' : 'html');
  return {
    mode,
    htmlConfidence,
    imageConfidence,
    graphicLoad: o.graphicLoad || '',
    shapeComplexity: o.shapeComplexity || '',
    layoutComplexity: o.layoutComplexity || '',
    reason: String(o.reason || ''),
  };
}

module.exports = { extractDesignRules, designRulesSection, outputModeOf, RULES_TOOL };
