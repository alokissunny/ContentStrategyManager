const { test } = require('node:test');
const assert = require('node:assert/strict');
const owner = '123456789012345678901234';
let objects; let reads; let renderArgs; let editorArgs; let cleanCalls;
function stub(relativePath, exports) {
  const id = require.resolve(relativePath);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
stub('../src/services/s3Client', {
  isS3Configured: () => true,
  getPresignedUploadUrl: async (key) => `https://example.test/upload/${key}`,
  getObjectBytes: async (key) => {
    reads.push(key);
    if (!objects.has(key)) throw new Error('not found');
    return { buffer: objects.get(key) };
  },
  uploadBytes: async (key, bytes) => { objects.set(key, bytes); },
  getPresignedDownloadUrl: async (key) => `https://example.test/${key}`,
  deleteObjects: async (keys) => keys.forEach((key) => objects.delete(key)),
});
stub('../src/services/reelAssembly', {
  assembleReel: async (args) => {
    renderArgs = args;
    return { buffer: Buffer.from('rendered mp4'), durationSec: 4,
      clips: args.assets.map((a, index) => ({ index, kind: a.kind, start: index * 2, end: (index + 1) * 2, sourceStart: 0, sourceEnd: 2 })) };
  },
});
stub('../src/services/reelAudio', { cleanReelAudio: async () => { cleanCalls++; throw new Error('not expected'); } });
stub('../src/services/reelEditorAgent', { runReelEditor: async (args) => { editorArgs = args; return { spec: {}, notes: [] }; } });
const { assembleReel, editReel, signUpload } = require('../src/controllers/reelController');
function reset() { objects = new Map(); reads = []; renderArgs = null; editorArgs = null; cleanCalls = 0; }
async function invoke(handler, body) {
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(result) { this.body = result; return this; } };
  await handler({ user: { _id: owner }, body: handler === assembleReel ? { mixMode: 'manual', ...body } : body }, response);
  return response;
}
test('signs allowed images and refuses unsupported types', async () => {
  reset();
  const signed = await invoke(signUpload, { contentType: 'image/jpeg' });
  assert.equal(signed.statusCode, 200);
  assert.match(signed.body.key, new RegExp(`^projects/${owner}/.*\\.jpg$`));
  assert.equal((await invoke(signUpload, { contentType: 'image/svg+xml' })).statusCode, 400);
});
test('validates every source ownership and type before reading any stored media', async () => {
  reset();
  const invalid = [
    { assets: [] },
    { assets: [{ key: 'projects/aaaaaaaaaaaaaaaaaaaaaaaa/stolen.mp4', kind: 'video' }] },
    { assets: [{ key: `projects/${owner}/photo.png`, kind: 'video' }] },
    { assets: [{ key: `projects/${owner}/photo.png`, durationSec: 11 }] },
    { assets: [{ key: `projects/${owner}/video.mp4`, startSec: 4, endSec: 2 }] },
    { assets: [{ key: `projects/${owner}/photo.png` }], transition: 'untrusted-filter' },
  ];
  for (const body of invalid) assert.equal((await invoke(assembleReel, body)).statusCode, 400);
  assert.deepEqual(reads, []);
  assert.equal(renderArgs, null);
});
test('assembles sources in user order and uses trusted final timing/scene context in edit', async () => {
  reset();
  const photo = `projects/${owner}/photo.png`; const video = `projects/${owner}/video.mp4`;
  objects.set(photo, Buffer.from('photo')); objects.set(video, Buffer.from('video'));
  const response = await invoke(assembleReel, { assets: [{ key: photo, durationSec: 2 }, { key: video, startSec: 1, endSec: 3 }], transition: 'slide' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(renderArgs.assets.map((a) => a.kind), ['image', 'video']);
  assert.equal(renderArgs.assets[1].startSec, 1);
  assert.equal(renderArgs.transition, 'slide');
  assert.match(response.body.key, /-assembled\.mp4$/);
  await invoke(editReel, { key: response.body.key, durationSec: 99 });
  assert.equal(editorArgs.durationSec, 4, 'use actual output duration rather than client metadata');
  assert.equal(editorArgs.assembly.transition, 'slide');
  assert.deepEqual(editorArgs.assembly.clips.map((c) => c.kind), ['image', 'video']);
});
test('photo-only reels skip voice cleanup and preserve photo timeline for transcription skip', async () => {
  reset();
  const key = `projects/${owner}/photo.png`; objects.set(key, Buffer.from('photo'));
  const response = await invoke(assembleReel, { assets: [{ key, durationSec: 2 }] });
  const edited = await invoke(editReel, { key: response.body.key, durationSec: 4, cleanAudio: true });
  assert.equal(cleanCalls, 0);
  assert.equal(edited.body.audioCleanup.status, 'no-audio');
  assert.equal(editorArgs.assembly.clips[0].kind, 'image');
});
test('missing uploads return404 without trying to render', async () => {
  reset();
  assert.equal((await invoke(assembleReel, { assets: [{ key: `projects/${owner}/missing.mp4` }] })).statusCode, 404);
  assert.equal(renderArgs, null);
});
