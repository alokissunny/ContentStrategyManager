const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ffmpeg = require('ffmpeg-static');
const run = promisify(execFile);
const { renderMixedReel } = require('../src/services/reelMixerRender');
let folder; let assets;
before(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), 'mixer-test-'));
  await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=red:s=180x320:r=30:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-c:a', 'aac', '-threads', '1', path.join(folder, 'base.mp4')]);
  await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=blue:s=180x320:r=30:d=1', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1', '-c:v', 'libx264', '-c:a', 'aac', '-threads', '1', path.join(folder, 'insert.mp4')]);
  await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=blue:s=180x320', '-frames:v', '1', '-threads', '1', path.join(folder, 'photo.png')]);
  assets = await Promise.all(['base.mp4', 'insert.mp4', 'photo.png'].map(async (name, i) => ({ buffer: await fs.readFile(path.join(folder, name)), kind: i === 2 ? 'image' : 'video', contentType: i === 2 ? 'image/png' : 'video/mp4' })));
});
after(async () => fs.rm(folder, { recursive: true, force: true }));
const plan = (mode, assetIndex = 2, transition = 'none') => ({ sequence: [{ assetIndex: 0 }], transition: 'none', overlays: [{ assetIndex, atSec: 1, durationSec: 1, startSec: 0, mode, position: 'top-right', transition }] });
async function pixel(file, time, x, y) {
  return (await run(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', `crop=2:2:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer' })).stdout;
}
for (const [mode, index, transition] of [['pip', 2, 'none'], ['cutaway', 1, 'fade']]) test(`${mode} is inserted mid-reel and keeps primary audio`, async () => {
  const result = await renderMixedReel({ assets, plan: plan(mode, index, transition) });
  assert.equal(result.durationSec, 3);
  const file = path.join(folder, `${mode}.mp4`);
  await fs.writeFile(file, result.buffer);
  const [beforePixel, inserted, afterPixel, center] = await Promise.all([pixel(file, 0.5, 550, 200), pixel(file, 1.5, 550, 200), pixel(file, 2.5, 550, 200), pixel(file, 1.5, 360, 640)]);
  assert.ok(beforePixel[0] > beforePixel[2] + 100);
  assert.ok(inserted[2] > inserted[0] + 100, 'blue supporting media appears during primary video');
  assert.ok(afterPixel[0] > afterPixel[2] + 100, 'primary video resumes instead of appended supporting media');
  assert.ok(mode === 'pip' ? center[0] > center[2] + 100 : center[2] > center[0] + 100);
  // Copying primary AAC packets must produce byte-identical audio with and without visuals.
  const original = await renderMixedReel({ assets, plan: { ...plan(mode), overlays: [] } });
  const originalFile = path.join(folder, `${mode}-original.mp4`);
  await fs.writeFile(originalFile, original.buffer);
  const audio = async source => (await run(ffmpeg, ['-v', 'error', '-i', source, '-map', '0:a:0', '-c:a', 'copy', '-f', 'adts', '-'], { encoding: 'buffer' })).stdout;
  assert.deepEqual(await audio(file), await audio(originalFile));
});
test('rejects overlapping, out-of-bounds and invalid actual overlay media', async () => {
  const normal = plan('pip', 1);
  await assert.rejects(renderMixedReel({ assets, plan: { ...normal, overlays: [...normal.overlays, ...normal.overlays] } }), /must not overlap/);
  await assert.rejects(renderMixedReel({ assets, plan: { ...normal, overlays: [{ ...normal.overlays[0], durationSec: 2 }] } }), /actual video duration/);
  await assert.rejects(renderMixedReel({ assets, plan: { ...normal, overlays: [{ ...normal.overlays[0], atSec: 2.5 }] } }), /reel duration/);
  await assert.rejects(renderMixedReel({ assets, plan: { ...normal, overlays: [{ ...normal.overlays[0], startSec: -1 }] } }), /Invalid mixer overlay/);
  await assert.rejects(renderMixedReel({ assets: [assets[0], { ...assets[1], buffer: Buffer.from('bad media') }], plan: normal }), /could not be decoded/);
});
test('maps reordered clips to original assets and honors source trims', async () => {
  const result = await renderMixedReel({ assets, plan: { sequence: [{ assetIndex: 1, startSec: 0.1, endSec: 0.9 }, { assetIndex: 0, startSec: 1, endSec: 2 }], transition: 'none', overlays: [] } });
  assert.deepEqual(result.clips.map(clip => clip.assetIndex), [1, 0]);
  assert.equal(result.durationSec, 1.8);
  const restricted = assets.map((asset, index) => index === 1 ? { ...asset, startSec: 0.3, endSec: 0.9 } : asset);
  await assert.rejects(renderMixedReel({ assets: restricted, plan: plan('pip', 1) }), /actual video duration or selected trim/);
  await assert.rejects(renderMixedReel({ assets: restricted, plan: { sequence: [{ assetIndex: 1, startSec: 0, endSec: 1 }], transition: 'none', overlays: [] } }), /selected trim/);
});
test('respects selected photo duration for sequence and overlays and rejects photo offsets', async () => {
  const restricted = assets.map((asset, index) => index === 2 ? { ...asset, durationSec: 0.5 } : asset);
  await assert.rejects(renderMixedReel({ assets: restricted, plan: { sequence: [{ assetIndex: 2, durationSec: 1 }], transition: 'none', overlays: [] } }), /photo exceeds the selected duration/);
  await assert.rejects(renderMixedReel({ assets: restricted, plan: { sequence: [{ assetIndex: 2, durationSec: 0.5, startSec: 1 }], transition: 'none', overlays: [] } }), /photo exceeds the selected duration/);
  await assert.rejects(renderMixedReel({ assets: restricted, plan: plan('pip', 2) }), /photo overlay duration or selected duration/);
});
