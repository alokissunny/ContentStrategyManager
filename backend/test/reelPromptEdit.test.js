const { test } = require('node:test');
const assert = require('node:assert/strict');
let reply; let request;
const id = require.resolve('../src/services/llmComplete');
require.cache[id] = { id, filename: id, loaded: true, exports: { completeToolCall: async (args) => { request = args; return { parsed: reply }; } } };
const { applyEdits, promptEdit } = require('../src/services/reelPromptEdit');
const imageId = require.resolve('../src/services/openaiImage');
require.cache[imageId] = { id: imageId, filename: imageId, loaded: true, exports: { generateImage: async () => ({ buffer: Buffer.from('test image'), mimeType: 'image/png' }) } };
const source = () => ({ meta: { durationSec: 20 }, background: 'studio', captions: { cues: [{ start: 0, end: 3, text: 'Hello' }] }, animations: [], backgroundMix: { clips: [{ kind: 'video', start: 0, end: 20 }] } });
test('prompt adds timed overlay and preserves all existing media and captions', async () => {
  const spec = source(); reply = { summary: 'Added a bouncing callout at 12 seconds.', edits: [{ action: 'add', target: 'animations', values: { type: 'callout', text: 'Big idea', start: 12, end: 15, motion: 'bounce', position: { x: 50, y: 30 } } }] };
  const result = await promptEdit({ spec, prompt: 'Add Big idea at 12 seconds', time: 5, selected: 'captions:0' });
  assert.equal(result.spec.animations[0].start, 12);
  assert.deepEqual(result.spec.captions, spec.captions);
  assert.deepEqual(result.spec.backgroundMix, spec.backgroundMix);
  assert.equal(spec.animations.length, 0);
  const sent = JSON.parse(request.userParts[0].text);
  assert.equal(sent.time, 5); assert.equal(sent.selected, 'captions:0');
  assert.equal(result.changed, true);
});
test('updates and deletes work and invalid batches are atomic', () => {
  const spec = source();
  const changed = applyEdits(spec, [{ action: 'update', target: 'captions', index: 0, values: { text: 'Updated', position: { x: 40, y: 60 } } }]);
  assert.equal(changed.captions.cues[0].text, 'Updated');
  assert.equal(applyEdits(changed, [{ action: 'delete', target: 'captions', index: 0 }]).captions.cues.length, 0);
  for (const values of [{ type: 'callout', start: 19, end: 22 }, { type: 'html', start: 1, end: 2 }, { type: 'callout', start: 1, end: 2, position: { x: 101, y: 0 } }]) assert.throws(() => applyEdits(spec, [{ action: 'delete', target: 'captions', index: 0 }, { action: 'add', target: 'animations', values }]));
  assert.equal(spec.captions.cues.length, 1);
  assert.throws(() => applyEdits(spec, [{ action: 'update', target: '__proto__', values: {} }]));
});
test('unsupported requests can explain limitations without changing the reel', async () => {
  reply = { summary: 'Audio changes are not available here.', edits: [] };
  const spec = source(); const result = await promptEdit({ spec, prompt: 'Add music' });
  assert.equal(result.changed, false); assert.deepEqual(result.spec, spec);
  await assert.rejects(promptEdit({ spec, prompt: ' ' }));
});
test('generates kids studying visual and keeps it separate from the talking video', async () => {
  reply = { summary: 'Added an AI image of kids studying.', edits: [{ action: 'add', target: 'mediaOverlays', values: { imagePrompt: 'Kids studying together at a classroom desk', start: 3, end: 7, mode: 'pip', width: 40, position: { x: 70, y: 30 } } }] };
  const result = await promptEdit({ spec: source(), prompt: 'Add a visual overlay of kids studying' });
  assert.equal(result.generatedAssets.length, 1);
  assert.match(result.generatedAssets[0].url, /^data:image\/png;base64,/);
  assert.equal(result.spec.mediaOverlays[0].assetId, result.generatedAssets[0].id);
  assert.equal(result.spec.mediaOverlays[0].imagePrompt, undefined);
});
test('accepts available video inserts and rejects missing assets or overlong source ranges', async () => {
  reply = { summary: 'Added footage', edits: [{ action: 'add', target: 'mediaOverlays', values: { assetId: 'clip', start: 3, end: 7, mode: 'cutaway', width: 100, sourceStart: 0 } }] };
  await assert.rejects(promptEdit({ spec: source(), prompt: 'Use clip' }));
  await assert.rejects(promptEdit({ spec: source(), prompt: 'Use clip', assets: [{ id: 'clip', kind: 'video', duration: 2 }] }));
  const result = await promptEdit({ spec: source(), prompt: 'Use clip', assets: [{ id: 'clip', kind: 'video', duration: 10 }] });
  assert.equal(result.spec.mediaOverlays[0].assetId, 'clip');
});
