const { test } = require('node:test');
const assert = require('node:assert/strict');
const original = Buffer.from('original video');
const cleaned = Buffer.from('cleaned video');
let calls;
let failure;
let status;
function stub(relativePath, exports) {
  const id = require.resolve(relativePath);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
stub('../src/services/s3Client', {
  getObjectBytes: async () => ({ buffer: original, contentType: 'video/mp4' }),
  uploadBytes: async (...args) => { calls.upload = args; },
  getPresignedDownloadUrl: async () => 'https://example.test/cleaned.mp4',
});
stub('../src/services/reelAudio', {
  cleanReelAudio: async (...args) => {
    calls.cleanup = args;
    if (failure) throw new Error('simulated cleanup failure');
    return { status, buffer: cleaned, contentType: 'video/mp4', ext: 'mp4' };
  },
});
stub('../src/services/reelEditorAgent', {
  runReelEditor: async (args) => { calls.edit = args; return { spec: {}, notes: ['existing note'] }; },
});
const { editReel } = require('../src/controllers/reelController');
const userId = '123456789012345678901234';
async function request(cleanAudio) {
  calls = {};
  let result;
  const res = { json: (body) => { result = body; } };
  await editReel({ user: { _id: userId }, body: { key: `projects/${userId}/input.mp4`, durationSec: 10, cleanAudio } }, res);
  return result;
}
test('cleanup feeds transcription and returns a playable processed clip', async () => {
  failure = false; status = 'applied';
  const result = await request(true);
  assert.equal(calls.cleanup[0], original);
  assert.equal(calls.edit.buffer, cleaned);
  assert.equal(calls.upload[1], cleaned);
  assert.match(calls.upload[0], new RegExp(`^projects/${userId}/`));
  assert.equal(result.audioCleanup.status, 'applied');
  assert.ok(result.audioCleanup.url);
  assert.deepEqual(result.notes, ['existing note']);
});
test('opt-out and cleanup failure both retain original media', async () => {
  await request(false);
  assert.equal(calls.cleanup, undefined);
  assert.equal(calls.edit.buffer, original);
  failure = true;
  const result = await request(true);
  assert.equal(calls.edit.buffer, original);
  assert.equal(calls.upload, undefined);
  assert.equal(result.audioCleanup.status, 'failed');
  assert.match(result.notes[0], /original audio/);
});
test('no-audio response is surfaced without uploading a processed clip', async () => {
  failure = false; status = 'no-audio';
  const result = await request(true);
  assert.equal(calls.edit.buffer, original);
  assert.equal(calls.upload, undefined);
  assert.equal(result.audioCleanup.status, 'no-audio');
});
