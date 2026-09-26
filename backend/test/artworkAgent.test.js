const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Stub the LLM, image model and storage BEFORE planOrchestrator destructures them.
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
const llm = require('../src/services/llmComplete');
const openaiImage = require('../src/services/openaiImage');
const generatedImage = require('../src/services/generatedImage');
const s3 = require('../src/services/s3Client');

let llmCalls;
let llmReply;
let renders;
llm.completeText = async (req) => {
  llmCalls.push(req);
  return { text: JSON.stringify(llmReply), stopReason: 'end_turn', usage: {} };
};
openaiImage.generateImage = async (prompt, opts) => {
  renders.push({ prompt, opts });
  return { buffer: Buffer.from('x'), mimeType: 'image/png', model: 'gpt-image-1', elapsedMs: 5, estimatedCostUsd: 0.04 };
};
let stored = 0;
generatedImage.persistGeneratedImage = async ({ namePrefix }) => {
  stored += 1;
  return { key: `projects/u1/${namePrefix}-${stored}.png`, mimeType: 'image/png' };
};
s3.isS3Configured = () => true;
s3.getMediaUrl = async (key) => `https://cdn.test/${key}`;

const {
  attachGeneratedVisuals, collectArtworkCommissions, fillArtworkSlots,
} = require('../src/services/planOrchestrator');

const commission = (id, request, kind = 'sketch', shape = 'portrait') => (
  `<img data-slot="artwork" data-art-id="${id}" data-art-kind="${kind}" data-art-shape="${shape}" data-art-request="${request}" alt="art ${id}" style="width:60%">`
);
const slide = (index, extra) => ({
  index,
  layoutHtml: `<article class="slide" data-index="${index}"><h2 data-slot="title">Slide ${index}</h2>${extra}</article>`,
});

beforeEach(() => {
  llmCalls = [];
  renders = [];
  delete process.env.PLAN_ARTWORK_AGENT;
  delete process.env.PLAN_VISUAL_AGENT;
});

test('collects open commissions, dedupes by request and ignores filled artwork', () => {
  const slides = [
    { ...slide(1, commission('a1', "Charcoal stair elevation, the bench's the focus")),
      layoutOptions: [{ html: commission('a1', "Charcoal stair elevation, the bench's the focus") }] },
    slide(2, '<img data-slot="artwork" data-art-request="done" src="https://cdn/x.png">'),
    slide(3, commission('a9', 'Oak grain swatch', 'texture', 'square')),
  ];
  const list = collectArtworkCommissions(slides, 3);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((c) => [c.id, c.slide, c.kind, c.shape]), [['a1', 1, 'sketch', 'portrait'], ['a2', 3, 'texture', 'square']]);
  assert.equal(list[0].request, "Charcoal stair elevation, the bench's the focus");
  assert.equal(list[0].slideCopy.title, 'Slide 1');
});

test('fills rendered commissions and drops the rest', () => {
  const html = commission('a1', 'Stair sketch') + commission('a2', 'Chair cutout', 'cutout');
  const out = fillArtworkSlots(html, new Map([['stair sketch', { key: 'k1', src: 'https://cdn/k1.png' }]]));
  assert.match(out, /data-art-request="Stair sketch"[^>]*data-asset-key="k1" src="https:\/\/cdn\/k1.png"/);
  assert.doesNotMatch(out, /Chair cutout/);
});

test('artwork agent art-directs all commissions in one call and renders each', async () => {
  llmReply = {
    sharedFinish: 'charcoal on transparent',
    artworks: [
      { id: 'a1', status: 'ready', imagePrompt: 'Charcoal elevation of a stair with a bench', altText: 'Stair sketch' },
      { id: 'a2', status: 'skip', skipReason: 'would fake a finished room' },
    ],
  };
  const content = {
    themeId: 'scrapbook-diary',
    slides: [slide(1, commission('a1', 'Stair elevation')), slide(2, commission('a2', 'Finished living room', 'illustration'))],
  };
  const out = await attachGeneratedVisuals({ source: 'test', content, brief: { angle: 'x' }, brand: {}, userId: 'u1', handle: 'h' });
  assert.equal(llmCalls.length, 1);
  assert.equal(renders.length, 1);
  assert.equal(renders[0].opts.background, 'transparent');
  assert.equal(renders[0].opts.size, '1024x1536');
  assert.match(renders[0].prompt, /transparent background/);
  assert.match(out.slides[0].layoutHtml, /src="https:\/\/cdn\.test\/projects\/u1\/art-\d+\.png"/);
  assert.doesNotMatch(out.slides[1].layoutHtml, /<img/);
  const dbg = out.artworkTrace;
  assert.equal(dbg.status, 'ran');
  assert.match(dbg.source, /^Artwork:test/);
  assert.match(dbg.input, /COMMISSIONS/);
  assert.match(dbg.input, /Stair elevation/);
  assert.equal(dbg.output.sharedFinish, 'charcoal on transparent');
  assert.deepEqual(dbg.commissions.map((c) => c.id), ['a1', 'a2']);
  assert.deepEqual(dbg.renders.map((t) => [t.index, t.status]), [[1, 'generated'], [2, 'skipped']]);
  assert.match(dbg.renders[0].finalPrompt, /transparent background/);
  assert.equal(dbg.usage.images, 1);
  assert.equal(out.visualTrace, undefined);
});

test('disabled agent drops commissions without calling any model', async () => {
  process.env.PLAN_ARTWORK_AGENT = '0';
  const out = await attachGeneratedVisuals({
    source: 'test', content: { slides: [slide(1, commission('a1', 'Stair'))] }, brief: {}, brand: {}, userId: 'u1',
  });
  assert.equal(llmCalls.length + renders.length, 0);
  assert.equal(out.artworkTrace.status, 'skipped');
  assert.equal(out.artworkTrace.commissions.length, 1);
  assert.doesNotMatch(out.slides[0].layoutHtml, /<img/);
});
