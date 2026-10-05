/*
 * Editor ⋯ › Layout › Upload a composition. A picture the studio laid out the
 * way they want is read for its ARRANGEMENT (not its look): which of the six
 * layouts it is nearest, and the arrangement in words for the Slide Edit agent
 * that re-lays the slide out. One small vision call.
 */
const sharp = require('sharp');
const { completeToolCall } = require('./llmComplete');

const MODEL = () => process.env.COMPOSITION_READ_MODEL || process.env.THEME_REGIONS_MODEL || 'claude-haiku-4-5-20251001';
const LAYOUTS = ['text', 'top', 'bottom', 'left', 'right', 'bleed'];

const TOOL = {
  name: 'record_composition',
  description: 'Record how the picture is laid out.',
  input_schema: {
    type: 'object',
    properties: {
      layout: {
        type: 'string',
        enum: LAYOUTS,
        description: 'The nearest arrangement: text = words only, no picture area; top / bottom / left / right = a picture area on that side with the words in the rest; bleed = a picture filling the whole frame with the words over it.',
      },
      description: {
        type: 'string',
        description: 'The arrangement in 2–4 sentences, as layout instructions: where the picture area sits and roughly how much of the frame it takes, where the headline and other text sit and how they are aligned, the scale contrast, and any distinctive placement (a label in a corner, a caption under the picture). Say nothing about colours, subject matter or typefaces.',
      },
    },
    required: ['layout', 'description'],
  },
};

async function readComposition(buffer) {
  const jpeg = await sharp(buffer).rotate().flatten({ background: '#ffffff' })
    .resize({ width: 768, height: 960, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  const started = Date.now();
  const done = await completeToolCall({
    model: MODEL(),
    system: 'You read the COMPOSITION of a picture an Instagram studio wants its slide laid out like — the arrangement of picture areas and text blocks only, never its colours, subject or style. Call record_composition.',
    userParts: [
      { type: 'image', mediaType: 'image/jpeg', data: jpeg.toString('base64') },
      { type: 'text', text: 'How is this laid out?' },
    ],
    tool: TOOL,
    maxTokens: 500,
    reasoningEffort: 'low',
    retryHint: 'Call record_composition with valid JSON.',
  });
  const p = done.parsed && typeof done.parsed === 'object' ? done.parsed : {};
  return {
    layout: LAYOUTS.includes(p.layout) ? p.layout : '',
    description: String(p.description || '').trim().slice(0, 900),
    model: MODEL(),
    elapsedMs: Date.now() - started,
    usage: done.usage || null,
  };
}

module.exports = { readComposition, LAYOUTS };
