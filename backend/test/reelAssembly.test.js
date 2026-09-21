const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ffmpeg = require('ffmpeg-static');
const run = promisify(execFile);
const { assembleReel } = require('../src/services/reelAssembly');
let folder; let video; let image;
before(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), 'assembly-test-'));
  await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=red:s=160x120:r=30:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-c:a', 'aac', '-threads', '1', path.join(folder, 'video.mp4')]);
  await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=blue:s=100x200', '-frames:v', '1', '-threads', '1', path.join(folder, 'photo.png')]);
  video = { buffer: await fs.readFile(path.join(folder, 'video.mp4')), contentType: 'video/mp4', kind: 'video' };
  image = { buffer: await fs.readFile(path.join(folder, 'photo.png')), contentType: 'image/png', kind: 'image', durationSec: 1 };
});
after(async () => { await fs.rm(folder, { recursive: true, force: true }); });
for (const transition of ['none', 'fade', 'slide']) test(`assembles actual video and photo with ${transition}`, async () => {
  const result = await assembleReel({ assets: [video, image], transition });
  assert.equal(result.contentType, 'video/mp4');
  assert.equal(result.clips.length, 2);
  const expected = transition === 'none' ? 2 : 2 - 11 / 30;
  assert.ok(Math.abs(result.durationSec - expected) < 0.001);
  const file = path.join(folder, `${transition}.mp4`);
  await fs.writeFile(file, result.buffer);
  const { stderr } = await run(ffmpeg, ['-i', file, '-f', 'null', '-']);
  assert.match(stderr, /720x1280/);
  assert.match(stderr, /48000 Hz, stereo/);
  const match = stderr.match(/Duration: 00:00:(\d+\.\d+)/);
  assert.ok(Math.abs(Number(match[1]) - expected) < 0.06, stderr);
  // Verify that the reel changes visually, and isn't merely a copy of the first input.
  const frame = async time => (await run(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', 'crop=2:2:359:639', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer' })).stdout;
  const first = await frame(0.1); const last = await frame(expected - 0.15);
  assert.ok(first[0] > first[2] + 100, 'First clip should be red');
  assert.ok(last[2] > last[0] + 100, 'Photo should be blue');
});
test('uses real media duration, accepts trim, rejects false or oversized durations', async () => {
  await assert.rejects(assembleReel({ assets: [{ ...video, endSec: 100 }] }), /invalid duration/);
  await assert.rejects(assembleReel({ assets: [{ ...image, durationSec: 11 }] }), /invalid duration/);
  await assert.rejects(assembleReel({ assets: [{ ...video, buffer: Buffer.from('not video') }] }), /could not be decoded/);
  await assert.rejects(assembleReel({ assets: Array(13).fill(image) }), /between 1 and 12/);
  const result = await assembleReel({ assets: [{ ...video, startSec: 0.2, endSec: 0.8 }] });
  assert.equal(result.durationSec, 0.6);
  assert.equal(result.clips[0].sourceStart, 0.2);
});

test('stitches three assets including silent video with exact overlap timing', async () => {
  const silentPath = path.join(folder, 'silent.mp4');
  await run(ffmpeg, ['-y', '-i', path.join(folder, 'video.mp4'), '-an', '-c:v', 'copy', silentPath]);
  const silent = { ...video, buffer: await fs.readFile(silentPath) };
  const result = await assembleReel({ assets: [silent, image, video], transition: 'fade' });
  assert.ok(Math.abs(result.durationSec - (3 - 22 / 30)) < 0.001);
  assert.ok(Math.abs(result.clips[2].start - (2 - 22 / 30)) < 0.001);
  const file = path.join(folder, 'three.mp4');
  await fs.writeFile(file, result.buffer);
  const { stderr } = await run(ffmpeg, ['-i', file, '-f', 'null', '-']);
  assert.match(stderr, /48000 Hz, stereo/);
  const duration = stderr.match(/Duration: 00:00:(\d+\.\d+)/);
  assert.ok(Math.abs(Number(duration[1]) - result.durationSec) < 0.06);
});
test('rejects combined timelines longer than three minutes before rendering', async () => {
  const file = path.join(folder, 'long.mp4');
  await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=red:s=32x32:r=1:d=91', '-c:v', 'libx264', '-threads', '1', file]);
  const long = { ...video, buffer: await fs.readFile(file) };
  await assert.rejects(assembleReel({ assets: [long, long] }), error => error.statusCode === 400 && /3 minutes/.test(error.message));
});

test('three minimum-length clips retain frame-exact overlapping transitions', async () => {
  const result = await assembleReel({ assets: [{ ...video, endSec: 0.5 }, { ...image, durationSec: 0.5 }, { ...video, endSec: 0.5 }], transition: 'fade' });
  assert.equal(result.durationSec, 23 / 30);
  assert.equal(result.clips[2].start, 8 / 30);
  const file = path.join(folder, 'short.mp4');
  await fs.writeFile(file, result.buffer);
  const { stderr } = await run(ffmpeg, ['-i', file, '-f', 'null', '-']);
  const duration = stderr.match(/Duration: 00:00:(\d+\.\d+)/);
  assert.ok(Math.abs(Number(duration[1]) - result.durationSec) < 0.04);
  assert.match(stderr, /frame=\s*23\b/);
});
