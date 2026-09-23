const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const exec = require('node:util').promisify(require('node:child_process').execFile);
const ffmpeg = require('ffmpeg-static');
const { muxReelExport } = require('../src/services/reelExport');
const run = (args) => exec(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', ...args], { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 });

test('finished export preserves rendered picture and adds selected MP4/WebM audio', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'export-test-'));
  try {
    const picture = path.join(dir, 'picture.mp4');
    await run(['-f', 'lavfi', '-i', 'color=c=blue:s=72x128:r=30:d=1', '-c:v', 'libx264', picture]);
    for (const ext of ['mp4', 'webm']) {
      const source = path.join(dir, `source.${ext}`), output = path.join(dir, `out-${ext}.mp4`);
      await run(['-f', 'lavfi', '-i', 'color=c=red:s=72x128:r=30:d=1', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1',
        '-c:v', ext === 'mp4' ? 'libx264' : 'libvpx', '-c:a', ext === 'mp4' ? 'aac' : 'libopus', '-shortest', source]);
      await fs.writeFile(output, await muxReelExport(await fs.readFile(picture), await fs.readFile(source), `video/${ext}`));
      const hash = async (file) => (await run(['-i', file, '-map', '0:v:0', '-c:v', 'copy', '-f', 'hash', '-hash', 'sha256', '-'])).stdout.toString();
      assert.equal(await hash(output), await hash(picture), 'picture packets must be unchanged');
      const pcm = (await run(['-i', output, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'])).stdout;
      assert.ok(Math.abs(pcm.length / 4 / 48000 - 1) < .06, `audio duration ${pcm.length / 4 / 48000} stays close to video duration`);
      let power = 0; for (let i = 0; i < pcm.length; i += 4) power += pcm.readFloatLE(i) ** 2;
      assert.ok(power / (pcm.length / 4) > .001, 'selected audio is audible');
    }
    const silent = path.join(dir, 'silent.mp4');
    await fs.writeFile(silent, await muxReelExport(await fs.readFile(picture), await fs.readFile(picture)));
    await run(['-i', silent, '-map', '0:v:0', '-f', 'null', '-']);
    await assert.rejects(run(['-i', silent, '-map', '0:a:0', '-f', 'null', '-']), 'silent sources remain valid video without an audio track');
    await assert.rejects(muxReelExport(Buffer.from('corrupt'), await fs.readFile(picture)));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
