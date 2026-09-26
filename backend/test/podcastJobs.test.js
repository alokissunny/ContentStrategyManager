const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { S3Client } = require('@aws-sdk/client-s3');
const s3 = require('../src/services/s3Client');
const jobs = require('../src/services/podcastJobs');
const owner = 'a'.repeat(24);
async function until(id, statuses) {
  for (let n = 0; n < 200; n++) { const job = jobs.status(id, owner); if (statuses.includes(job.status)) return job; await new Promise(r => setTimeout(r, 25)); }
  throw new Error('Job timeout');
}
test('job lifecycle isolates accounts, requires review, renders MP4 and cancels', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'podcast-jobs-test-'));
  const saved = { send: S3Client.prototype.send, configured: s3.isS3Configured, upload: s3.uploadBytes, url: s3.getPresignedDownloadUrl };
  let output;
  try {
    const file = path.join(folder, 'source.mp4');
    execFileSync(process.env.FFMPEG_PATH || require('ffmpeg-static'), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=30:d=0.6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
    const buffer = await fs.readFile(file);
    S3Client.prototype.send = async () => ({ ContentLength: buffer.length, Body: Readable.from([buffer]) });
    s3.isS3Configured = () => true;
    s3.uploadBytes = async (key, bytes) => { output = bytes; };
    s3.getPresignedDownloadUrl = async () => 'https://example.test/podcast.mp4';
    const body = { mode: 'segments', assets: [{ id: 'host', role: 'host', key: `projects/${owner}/host.mp4` }, { id: 'guest', role: 'guest', key: `projects/${owner}/guest.mp4` }] };
    const job = jobs.create(body, owner);
    assert.throws(() => jobs.status(job.jobId, 'b'.repeat(24)), /not found/);
    assert.throws(() => jobs.render(job.jobId, owner), /not ready/);
    const reviewed = await until(job.jobId, ['review', 'failed']); assert.equal(reviewed.status, 'review', reviewed.error);
    assert.throws(() => jobs.render(job.jobId, owner, { brandingKey: `projects/${'b'.repeat(24)}/brand.png` }), /belonging/);
    jobs.render(job.jobId, owner);
    const finished = await until(job.jobId, ['completed', 'failed']); assert.equal(finished.status, 'completed', finished.error);
    assert.ok(output.length > 1000); assert.equal(finished.result.contentType, 'video/mp4'); assert.equal(finished.progress, 100);
    const cancelled = jobs.create(body, owner); await jobs.cancel(cancelled.jobId, owner);
    assert.equal((await until(cancelled.jobId, ['cancelled'])).status, 'cancelled');
    await new Promise(r => setTimeout(r, 50));
  } finally { S3Client.prototype.send = saved.send; s3.isS3Configured = saved.configured; s3.uploadBytes = saved.upload; s3.getPresignedDownloadUrl = saved.url; await fs.rm(folder, { recursive: true, force: true }); }
});
test('streaming downloads enforce size limits before allocating source bytes', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'podcast-limit-test-'));
  const original = S3Client.prototype.send;
  try {
    S3Client.prototype.send = async () => ({ ContentLength: 101, Body: Readable.from([Buffer.alloc(101)]) });
    await assert.rejects(jobs.download('key', path.join(folder, 'large'), 100, new AbortController().signal), /size limit/);
    S3Client.prototype.send = async () => ({ Body: Readable.from([Buffer.alloc(60), Buffer.alloc(60)]) });
    await assert.rejects(jobs.download('key', path.join(folder, 'chunked'), 100, new AbortController().signal), /size limit/);
  } finally { S3Client.prototype.send = original; await fs.rm(folder, { recursive: true, force: true }); }
});
