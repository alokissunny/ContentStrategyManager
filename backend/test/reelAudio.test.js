const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const ffmpeg = require('ffmpeg-static');
const { cleanReelAudio } = require('../src/services/reelAudio');

async function run(args) {
  return execFile(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', ...args], { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 });
}

function toneAmplitude(buffer, hz) {
  // Analyze a full second in the middle, avoiding codec startup/padding.
  let real = 0; let imaginary = 0;
  for (let i = 0; i < 48000; i += 1) {
    const value = buffer.readFloatLE((i + 24000) * 4);
    const phase = 2 * Math.PI * hz * i / 48000;
    real += value * Math.cos(phase);
    imaginary += value * Math.sin(phase);
  }
  return Math.hypot(real, imaginary);
}

test('voice cleanup preserves video, reduces rumble relative to speech, and supports MP4/WebM', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reel-audio-test-'));
  try {
    for (const ext of ['mp4', 'webm']) {
      const input = path.join(dir, `input.${ext}`);
      await run(['-f', 'lavfi', '-i', 'color=c=blue:s=64x96:r=10:d=2', '-f', 'lavfi', '-i',
        'aevalsrc=0.1*sin(2*PI*60*t)+0.05*sin(2*PI*1000*t):s=48000:d=2',
        '-c:v', ext === 'mp4' ? 'libx264' : 'libvpx', '-c:a', ext === 'mp4' ? 'aac' : 'libopus', '-t', '2', input]);
      const result = await cleanReelAudio(await fs.readFile(input), `video/${ext}`);
      assert.equal(result.status, 'applied');
      assert.equal(result.contentType, `video/${ext}`);
      const output = path.join(dir, `output.${ext}`);
      await fs.writeFile(output, result.buffer);
      const hash = async (file) => (await run(['-i', file, '-map', '0:v:0', '-c:v', 'copy', '-f', 'hash', '-hash', 'sha256', '-'])).stdout.toString();
      assert.equal(await hash(input), await hash(output), 'video packets must not change');
      const pcm = async (file) => (await run(['-i', file, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'])).stdout;
      const original = await pcm(input); const cleaned = await pcm(output);
      assert.ok(Math.abs(cleaned.length - original.length) / 4 / 48000 < 0.06, 'audio remains in sync');
      const before = toneAmplitude(original, 60) / toneAmplitude(original, 1000);
      const after = toneAmplitude(cleaned, 60) / toneAmplitude(cleaned, 1000);
      assert.ok(after < before * 0.8, `rumble relative to speech: ${before} → ${after}`);
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('clips without an audio track are skipped and corrupt media rejects', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reel-silent-test-'));
  try {
    const input = path.join(dir, 'silent.mp4');
    await run(['-f', 'lavfi', '-i', 'color=c=black:s=64x96:r=10:d=1', '-c:v', 'libx264', input]);
    assert.equal((await cleanReelAudio(await fs.readFile(input), 'video/mp4')).status, 'no-audio');
    await assert.rejects(cleanReelAudio(Buffer.from('not a video'), 'video/mp4'));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
