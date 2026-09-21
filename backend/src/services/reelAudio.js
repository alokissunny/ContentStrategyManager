const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const execFileAsync = promisify(execFile);

// Conservative speech cleanup: rumble, steady fan/hiss, then consistent volume.
// Keep the picture bit-for-bit and preserve timing for word-synced captions.
const VOICE_FILTER = 'highpass=f=80,afftdn=nr=12:nf=-40:tn=1:gs=5,loudnorm=I=-16:TP=-1.5:LRA=11';

async function cleanReelAudio(buffer, contentType) {
  const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static');
  if (!ffmpeg) throw new Error('FFmpeg is unavailable on this platform');
  const webm = contentType === 'video/webm';
  const ext = webm ? 'webm' : 'mp4';
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'reel-audio-'));
  try {
    const input = path.join(folder, 'input');
    const output = path.join(folder, `cleaned.${ext}`);
    await fs.writeFile(input, buffer);
    try {
      await execFileAsync(ffmpeg, [
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
        '-threads', '1', '-protocol_whitelist', 'file,pipe',
        '-f', webm ? 'matroska' : 'mov', '-i', input,
        '-map', '0:v:0', '-map', '0:a:0',
        '-c:v', 'copy', '-af', VOICE_FILTER,
        '-c:a', webm ? 'libopus' : 'aac', '-b:a', '128k', '-ar', '48000',
        '-threads', '1', '-filter_threads', '1', '-t', '185',
        ...(webm ? [] : ['-movflags', '+faststart']), output,
      ], { timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true });
    } catch (error) {
      if (/Stream map ['"]?0:a:0['"]? matches no streams/i.test(error.stderr || '')) {
        return { status: 'no-audio' };
      }
      throw error;
    }
    return { status: 'applied', buffer: await fs.readFile(output), contentType: webm ? 'video/webm' : 'video/mp4', ext };
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
}

module.exports = { cleanReelAudio, VOICE_FILTER };
