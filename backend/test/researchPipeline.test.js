const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
let invalidDraftOnce = false; let generationCalls = 0; let lastCorrections;
let auditPass = true; let renderFail = false; let lastFolder; let uploads = [];
const source = { title: 'Source', url: 'https://example.com/source', quote: 'Test evidence.' };
const plan = { sources: [source], caption: 'Try this.', slides: Array.from({length:7}, () => ({ title: 'Try a small change', body: 'Consider planning ahead.', sourceIds: [1] })) };
function stub(name, exports) { const id = require.resolve(name); require.cache[id] = { id, filename: id, loaded: true, exports }; }
stub('../src/services/openaiClient', () => ({ responses: { create: async () => ({ output_text: 'Test evidence.', output: [{ action: { sources: [{ url: source.url }] } }] }) } }));
stub('../src/services/llmComplete', { completeToolCall: async args => {
  if (args.tool.name === 'audit') return { parsed: { passed: auditPass, problems: auditPass ? [] : ['Unsupported claim'] } };
  generationCalls++;
  lastCorrections = JSON.parse(args.userParts[0].text).corrections;
  if (invalidDraftOnce) { invalidDraftOnce = false; return { parsed: { ...plan, sources: [{ ...source, url: 'https://invented.example/' }] } }; }
  return { parsed: plan };
} });
stub('../src/services/s3Client', { uploadBytes: async (key, bytes, type) => { uploads.push({key, bytes, type}); }, getMediaUrl: async key => `https://media.example/${key}` });
require('node:child_process').execFile = function () {};
require('node:child_process').execFile[promisify.custom] = async (_bin, args) => {
  if (args[0].endsWith('render_carousel.py')) {
    if (renderFail) throw new Error('Layout failed');
    const out = args[args.indexOf('--out') + 1]; lastFolder = path.dirname(out);
    await fs.mkdir(out);
    for (let i = 1; i <= 8; i++) await fs.writeFile(path.join(out, `slide-${String(i).padStart(2,'0')}.png`), 'png');
    assert.ok(args.includes('--strict'));
    assert.ok(!args.includes('--skip-validation'));
  } else if (args[1].includes('zipfile')) await fs.writeFile(path.join(args[2], 'carousel.zip'), 'zip');
  return { stdout: '', stderr: '' };
};
const { generateCarousel } = require('../src/services/researchCarousel');
test('pipeline returns audited previews and ZIP and removes temporary files', async () => {
  const result = await generateCarousel({ topic: 'Planning' }, 'user-1');
  assert.equal(result.slides.length, 8); assert.equal(uploads.length, 9);
  assert.ok(uploads.every(u => u.key.startsWith('projects/user-1/research-')));
  assert.equal(uploads.at(-1).type, 'application/zip');
  assert.deepEqual(result.audits, { content: 'passed', layout: 'passed' });
  await assert.rejects(fs.access(lastFolder));
});
test('content and layout failures never upload unchecked slides', async () => {
  uploads = []; auditPass = false;
  await assert.rejects(generateCarousel({ topic: 'Planning' }, 'user-1'), /unsupported claims/);
  assert.equal(uploads.length, 0);
  auditPass = true; renderFail = true;
  await assert.rejects(generateCarousel({ topic: 'Planning' }, 'user-1'), /layout audit/);
  assert.equal(uploads.length, 0);
});

test('repairs a draft with an unverified source URL before rendering', async () => {
  uploads = []; auditPass = true; renderFail = false; invalidDraftOnce = true; generationCalls = 0;
  const result = await generateCarousel({ topic: 'Planning' }, 'user-1');
  assert.equal(generationCalls, 2);
  assert.match(lastCorrections[0], /exactly match/);
  assert.equal(result.slides.length, 8);
  assert.equal(uploads.length, 9);
});
test('reports every generation retry and audit call to debug collector', async () => {
 auditPass=true;renderFail=false;invalidDraftOnce=true;
 const entries=[];
 await generateCarousel({topic:'Planning'},'user-1',{onAiCall:entry=>entries.push(entry)});
 assert.deepEqual(entries.map(e=>e.source),['Research: web search','Research: carousel · attempt 1','Research: carousel · attempt 2','Research: content audit · attempt 2']);
 assert.ok(entries.every(e=>e.usage && typeof e.elapsedMs==='number'));
 auditPass=false;
 const failed=[];
 await assert.rejects(generateCarousel({topic:'Planning'},'user-1',{onAiCall:entry=>failed.push(entry)}));
 assert.equal(failed.length,7);
});
