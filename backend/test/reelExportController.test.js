const { test } = require('node:test');
const assert = require('node:assert/strict');
const owner = '123456789012345678901234';
let reads = [], deleted = [], fail = false, args;
function stub(module, exports) { const id = require.resolve(module); require.cache[id] = { id, filename: id, loaded: true, exports }; }
stub('../src/services/s3Client', { deleteObjects: async (keys) => { deleted.push(...keys); }, getObjectBytes: async (key) => { reads.push(key); if (fail) throw Error('Missing media'); return { buffer: Buffer.from(key) }; } });
stub('../src/services/reelEditorAgent', {});
stub('../src/services/reelExport', { muxReelExport: async (...values) => { args = values; return Buffer.from('finished'); } });
const { exportReel, cleanupReelExport } = require('../src/controllers/reelController');
async function invoke(body, handler = exportReel) {
  const res = { code: 200, headers: {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, set(key, value) { this.headers[key] = value; return this; }, send(body) { this.body = body; return this; } };
  await handler({ user: { _id: owner }, body }, res);
  return res;
}
test('export rejects foreign keys and URLs before fetching media', async () => {
  for (const videoKey of ['https://example.com/x.mp4', 'projects/aaaaaaaaaaaaaaaaaaaaaaaa/foreign.mp4', `projects/${owner}/../x.mp4`, undefined]) {
    assert.equal((await invoke({ videoKey, audioKey: `projects/${owner}/audio.mp4` })).code, 400);
  }
  assert.deepEqual(reads, []);
});
test('export uses selected audio, returns an MP4 attachment and recovers after failure', async () => {
  const body = { videoKey: `projects/${owner}/render.mp4`, audioKey: `projects/${owner}/cleaned.webm` };
  fail = true; assert.equal((await invoke(body)).code, 500); fail = false;
  const res = await invoke(body);
  assert.equal(res.code, 200);
  assert.equal(res.headers['Content-Type'], 'video/mp4');
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.match(res.headers['Content-Disposition'], /finished-reel\.mp4/);
  assert.equal(args[1].toString(), body.audioKey);
  assert.equal(args[2], 'video/webm');
  assert.equal(res.body.toString(), 'finished');
});

test('cleanup only deletes the current user’s temporary export uploads', async () => {
  for (const keys of [[`projects/${owner}/original.mp4`], ['projects/aaaaaaaaaaaaaaaaaaaaaaaa/x-export-tmp.mp4'], ['https://example.com/x-export-tmp.mp4']]) {
    assert.equal((await invoke({ keys }, cleanupReelExport)).code, 400);
  }
  assert.deepEqual(deleted, []);
  const keys = [`projects/${owner}/picture-export-tmp.mp4`, `projects/${owner}/audio-export-tmp.webm`];
  assert.equal((await invoke({ keys }, cleanupReelExport)).code, 200);
  assert.deepEqual(deleted, keys);
  deleted = [];
  await invoke({ videoKey: keys[0], audioKey: keys[1] });
  assert.deepEqual(deleted, keys, 'successful export also cleans temporary files on the server');
});
