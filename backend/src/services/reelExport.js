const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const exec = promisify(execFile);

// Preserve the browser-rendered H.264 packets and use the preview's selected audio.
async function muxReelExport(video, audio, audioType = 'video/mp4') {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'reel-export-'));
  try {
    const picture = path.join(folder, 'picture.mp4');
    const source = path.join(folder, 'source');
    const output = path.join(folder, 'finished.mp4');
    await Promise.all([fs.writeFile(picture, video), fs.writeFile(source, audio)]);
    await exec(process.env.FFMPEG_PATH || require('ffmpeg-static'), [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      '-threads', '1', '-protocol_whitelist', 'file,pipe', '-f', 'mov', '-i', picture,
      '-threads', '1', '-protocol_whitelist', 'file,pipe', '-f', audioType === 'video/webm' ? 'matroska' : 'mov', '-i', source,
      '-map', '0:v:0', '-map', '1:a:0?', '-map_metadata', '-1',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-af', 'apad',
      '-shortest', '-t', '185', '-threads', '1', '-filter_threads', '1', '-movflags', '+faststart', output,
    ], { timeout: 120000, maxBuffer: 1024 * 1024 });
    return await fs.readFile(output);
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
}
module.exports = { muxReelExport };
