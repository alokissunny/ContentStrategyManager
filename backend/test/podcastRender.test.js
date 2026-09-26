const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { renderPodcast, probePodcast } = require('../src/services/podcastRender');
const run = promisify(execFile);
const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static');

test('renders alternating sources with continuous master audio and silent-source segment audio', { timeout: 60000 }, async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'podcast-test-'));
  try {
    const host = path.join(folder, 'host.mp4');
    const guest = path.join(folder, 'guest.mp4');
    await run(ffmpeg, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', '-c:v', 'libx264', '-threads', '1', '-c:a', 'aac', host]);
    await run(ffmpeg, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=90x160:r=30', '-t', '2', '-c:v', 'libx264', '-threads', '1', guest]);
    const assets = [{ id: 'host', path: host, ...await probePodcast(host) }, { id: 'guest', path: guest, ...await probePodcast(guest) }];
    assert.equal(assets[0].hasAudio, true);
    assert.equal(assets[1].hasAudio, false);
    const plan = { durationSec: 2, segments: [{ assetId: 'host', sourceStart: 0, sourceEnd: 1, start: 0, end: 1 }, { assetId: 'guest', sourceStart: 1, sourceEnd: 2, start: 1, end: 2 }] };
    for (const mode of ['conversation', 'segments']) {
      const progress = [];
      const result = await renderPodcast({ assets, plan, mode, masterAssetId: 'host', onProgress: value => progress.push(value) });
      const output = path.join(folder, `${mode}.mp4`);
      await fs.writeFile(output, result.buffer);
      const info = await probePodcast(output);
      assert.equal(info.width, 1280);
      assert.equal(info.height, 720);
      assert.equal(info.hasAudio, true);
      assert.ok(Math.abs(info.durationSec - 2) < 0.1);
      assert.equal(progress.at(-1), 100);
      const audio = await run(ffmpeg, ['-v', 'error', '-ss', '1.5', '-i', output, '-t', '0.2', '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'], { encoding: 'buffer' });
      let energy = 0;
      for (let i = 0; i + 1 < audio.stdout.length; i += 2) energy += Math.abs(audio.stdout.readInt16LE(i));
      const meanAmplitude = energy / (audio.stdout.length / 2);
      assert.ok(mode === 'conversation' ? meanAmplitude > 100 : meanAmplitude < 10, 'master audio continues across silent guest footage; segment mode emits silence');
      const sample = await run(ffmpeg, ['-v', 'error', '-ss', '1.5', '-i', output, '-frames:v', '1', '-vf', 'crop=2:2:640:360,format=rgb24', '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer' });
      assert.ok(sample.stdout[2] > 180 && sample.stdout[0] < 30, 'second shot is the blue guest camera');
    }
    const fractionalPlan = { durationSec: 1.918, segments: Array.from({ length: 14 }, (_, i) => ({ assetId: i % 2 ? 'guest' : 'host', sourceStart: i * 0.137, sourceEnd: (i + 1) * 0.137, start: i * 0.137, end: (i + 1) * 0.137 })) };
    const fractional = await renderPodcast({ assets, plan: fractionalPlan, mode: 'segments', cleanAudio: false });
    assert.ok(Math.abs(fractional.durationSec - 58 / 30) < 0.06, 'fractional cuts retain total duration without cumulative frame drift');
    const fractionalOutput = path.join(folder, 'fractional.mp4');
    await fs.writeFile(fractionalOutput, fractional.buffer);
    // The last cut is silent; AAC encoding happens only once after PCM concatenation.
    const tail = await run(ffmpeg, ['-v', 'error', '-ss', '1.85', '-i', fractionalOutput, '-t', '0.04', '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'], { encoding: 'buffer' });
    assert.ok(tail.stdout.length > 100, 'audio covers the final fractional cut');
    let tailEnergy = 0;
    for (let i = 0; i + 1 < tail.stdout.length; i += 2) tailEnergy += Math.abs(tail.stdout.readInt16LE(i));
    assert.ok(tailEnergy / (tail.stdout.length / 2) < 10, 'audio remains synchronized with the final silent guest cut');
    const brandingPath = path.join(folder, 'brand.png');
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=1280x720', '-frames:v', '1', '-threads', '1', brandingPath]);
    const branded = await renderPodcast({ assets, plan, masterAssetId: 'host', brandingPath });
    const brandedOutput = path.join(folder, 'branded.mp4');
    await fs.writeFile(brandedOutput, branded.buffer);
    const brandedPixel = await run(ffmpeg, ['-v', 'error', '-i', brandedOutput, '-frames:v', '1', '-vf', 'crop=2:2:640:360,format=rgb24', '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer' });
    assert.ok(brandedPixel.stdout[1] > 90 && brandedPixel.stdout[0] < 30, 'branding composites above the camera');
    await assert.rejects(renderPodcast({ assets, plan: { ...plan, durationSec: 3 }, masterAssetId: 'host' }), /duration/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(renderPodcast({ assets, plan, masterAssetId: 'host', signal: controller.signal }), { name: 'AbortError' });
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});
