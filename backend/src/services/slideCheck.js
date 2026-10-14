/*
 * Slide check — the Theme Apply agent's quality gate.
 *
 * A cheap vision model (Haiku, THEME_CHECK_MODEL) looks at the finished slide
 * and reports what an image model gets wrong: text cut off or touching an
 * edge, text outside the safe margin, and words that differ from the slide's
 * copy. The agent re-renders once with those problems named, and keeps the
 * better of the two.
 */

const sharp = require('sharp');
const { completeToolCall } = require('./llmComplete');

const CHECK_TOOL = {
  name: 'record_slide_check',
  description: 'Record every quality problem on this finished Instagram slide.',
  input_schema: {
    type: 'object',
    properties: {
      clipped: {
        type: 'array',
        description: 'Text that is cut off by an edge of the image, or runs off it — even a sliver of a letter',
        items: { type: 'object', properties: { text: { type: 'string' }, edge: { type: 'string', description: 'top | bottom | left | right' } }, required: ['text', 'edge'] },
      },
      tooClose: {
        type: 'array',
        description: 'Text that is not cut off but sits inside the outer 6% band of the image (crowding the border)',
        items: { type: 'object', properties: { text: { type: 'string' }, edge: { type: 'string' } }, required: ['text', 'edge'] },
      },
      wordProblems: {
        type: 'array',
        items: { type: 'string' },
        description: 'Each difference from the expected copy: a misspelled, missing, extra or changed word or punctuation mark (quote it)',
      },
      covered: {
        type: 'array',
        items: { type: 'string' },
        description: 'Text that is covered or crossed by a decoration, tape, a frame or the photo',
      },
    },
    required: ['clipped', 'tooClose', 'wordProblems', 'covered'],
  },
};

const SYSTEM = 'You are a strict quality checker for Instagram carousel slides. You get the whole slide, then each of its four edges enlarged. Compare the slide\'s text with the expected copy, and inspect every edge strip for letters that are sliced by the border (only the bottom or top half of a word visible, letters running off the side) or that sit within a few pixels of it. Decorations (flowers, tape, doodles) touching an edge are fine — only text matters. Report only real, visible problems. Call record_slide_check; empty lists when there is nothing wrong.';

// Haiku-class pricing, USD per 1M tokens — display only
const PRICE = { in: Number(process.env.THEME_STYLE_PRICE_IN) || 1, out: Number(process.env.THEME_STYLE_PRICE_OUT) || 5 };

// The outer bands of the slide, enlarged: top/bottom 14% of the height,
// left/right 12% of the width.
async function edgeStrips(jpeg) {
  const { width: W, height: H } = await sharp(jpeg).metadata();
  const bandY = Math.round(H * 0.14);
  const bandX = Math.round(W * 0.12);
  const cut = async (region, resize) => (await sharp(jpeg).extract(region).resize(resize).jpeg({ quality: 88 }).toBuffer()).toString('base64');
  return [
    { edge: 'top', side: 'top', data: await cut({ left: 0, top: 0, width: W, height: bandY }, { width: W * 2 }) },
    { edge: 'bottom', side: 'bottom', data: await cut({ left: 0, top: H - bandY, width: W, height: bandY }, { width: W * 2 }) },
    { edge: 'left', side: 'left', data: await cut({ left: 0, top: 0, width: bandX, height: H }, { height: H }) },
    { edge: 'right', side: 'right', data: await cut({ left: W - bandX, top: 0, width: bandX, height: H }, { height: H }) },
  ];
}

/**
 * @param {Buffer} buffer the finished slide
 * @param {{ role: string, text: string }[]} lines the expected copy
 * @returns {Promise<{ problems: string[], usage, model } | null>} null when the check could not run
 */
async function checkSlide(buffer, lines = []) {
  const started = Date.now();
  const model = process.env.THEME_CHECK_MODEL || process.env.THEME_STYLE_MODEL || 'claude-haiku-4-5-20251001';
  try {
    const jpeg = await sharp(buffer).rotate().resize({ width: 1024, height: 1280, fit: 'inside' }).jpeg({ quality: 88 }).toBuffer();
    const expected = lines.length
      ? lines.map((l, i) => `${i + 1}. ${l.role}: ${JSON.stringify(l.text)}`).join('\n')
      : '(no text expected)';
    // the edges, up close: a thin row of half-letters is easy to miss on the
    // whole slide (it was, on a real clipped eyebrow) — each strip enlarged
    const strips = await edgeStrips(jpeg);
    const done = await completeToolCall({
      model,
      system: SYSTEM,
      userParts: [
        { type: 'text', text: 'THE WHOLE SLIDE:' },
        { type: 'image', mediaType: 'image/jpeg', data: jpeg.toString('base64') },
        ...strips.flatMap((st) => [
          { type: 'text', text: `${st.edge.toUpperCase()} EDGE, enlarged (the ${st.edge} border of the slide is the ${st.side} side of this strip): are any letters cut off at that border, or within a few pixels of it?` },
          { type: 'image', mediaType: 'image/jpeg', data: st.data },
        ]),
        { type: 'text', text: `EXPECTED COPY (exact):\n${expected}\n\nEvery expected line must be fully visible — a line whose letters are sliced by an edge is CLIPPED, even if you can still read it.` },
      ],
      tool: CHECK_TOOL,
      maxTokens: 800,
      reasoningEffort: 'low',
      retryHint: 'Call record_slide_check with valid JSON.',
    });
    const p = done.parsed && typeof done.parsed === 'object' ? done.parsed : {};
    const list = (v) => (Array.isArray(v) ? v : []);
    const problems = [
      ...list(p.clipped).map((x) => `text cut off at the ${x.edge || 'edge'}: "${x.text}"`),
      ...list(p.tooClose).map((x) => `text too close to the ${x.edge || 'edge'} (inside the safe margin): "${x.text}"`),
      ...list(p.wordProblems).map((x) => `wrong copy: ${x}`),
      ...list(p.covered).map((x) => `text covered by artwork: ${x}`),
    ];
    const i = Number(done.usage?.input_tokens || done.usage?.prompt_tokens) || 0;
    const o = Number(done.usage?.output_tokens || done.usage?.completion_tokens) || 0;
    return {
      problems,
      model,
      usage: { inputTokens: i, outputTokens: o, totalTokens: i + o, estimatedCostUsd: (i * PRICE.in + o * PRICE.out) / 1e6, elapsedMs: Date.now() - started },
    };
  } catch (err) {
    console.warn(`[slideCheck] check failed — slide kept unchecked: ${err.message}`);
    return null;
  }
}

module.exports = { checkSlide };
