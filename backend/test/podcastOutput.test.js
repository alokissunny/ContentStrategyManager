const test = require('node:test');
const assert = require('node:assert/strict');
const s3 = require('../src/services/s3Client');
const controller = require('../src/controllers/podcastController');
test('finished output URL renews without a live job and enforces account ownership', async () => {
  const original = s3.getPresignedDownloadUrl;
  const owner = 'a'.repeat(24);
  s3.getPresignedDownloadUrl = async key => `https://example.test/${key}`;
  const request = async key => {
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await controller.output({ method: 'GET', user: { _id: owner }, query: { key } }, res);
    return res;
  };
  try {
    const key = `projects/${owner}/expired-job-podcast.mp4`;
    const ok = await request(key); assert.equal(ok.code, 200); assert.equal(ok.body.key, key); assert.match(ok.body.url, /example.test/);
    for (const bad of [`projects/${'b'.repeat(24)}/expired-job-podcast.mp4`, `projects/${owner}/source.mp4`, `projects/${owner}/../private-podcast.mp4`, undefined]) assert.equal((await request(bad)).code, 400);
  } finally { s3.getPresignedDownloadUrl = original; }
});
