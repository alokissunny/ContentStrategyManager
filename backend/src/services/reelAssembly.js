const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const run = promisify(execFile);
const FPS = 30;
// Use a whole number of frames so video and audio overlaps have identical timing.
const OVERLAP = 11 / FPS;
const MAX_DURATION = 180;
const invalid = (message) => Object.assign(new Error(message), { statusCode: 400 });
const FORMATS = {
  'video/mp4': 'mov', 'video/quicktime': 'mov', 'video/webm': 'matroska',
  'image/jpeg': 'image2', 'image/png': 'image2', 'image/webp': 'image2',
};

async function assembleReel({ assets, transition = 'fade' }) {
  if (!Array.isArray(assets) || !assets.length || assets.length > 12) throw invalid('Choose between 1 and 12 videos or photos.');
  if (!['none', 'fade', 'slide'].includes(transition)) throw invalid('Unknown reel transition.');
  const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static');
  if (!ffmpeg) throw new Error('FFmpeg is unavailable on this platform.');
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'reel-assembly-'));
  const execute = (args) => run(ffmpeg, ['-nostdin', '-hide_banner', '-y', '-threads', '1', '-filter_threads', '1', '-filter_complex_threads', '1', ...args], { timeout: 240000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  try {
    const clips = [];
    const prepared = [];
    let durationSec = 0;
    for (const [index, asset] of assets.entries()) {
      const format = FORMATS[asset.contentType];
      if (!format || !Buffer.isBuffer(asset.buffer) || !asset.buffer.length || !['video', 'image'].includes(asset.kind) || !asset.contentType.startsWith(`${asset.kind}/`)) throw invalid(`Clip ${index + 1}: unsupported or empty media.`);
      const input = path.join(folder, `source-${index}`);
      await fs.writeFile(input, asset.buffer);
      const inputArgs = ['-protocol_whitelist', 'file,pipe', '-f', format, '-i', input];
      let info;
      try {
        info = await execute([...inputArgs, '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-']);
      } catch { throw invalid(`Clip ${index + 1}: this media could not be decoded.`); }
      const match = info.stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
      const realDuration = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
      const hasAudio = /Stream #\d+:\d+.*Audio:/.test(info.stderr);
      const start = asset.kind === 'image' ? 0 : (asset.startSec ?? 0);
      const end = asset.kind === 'image' ? (asset.durationSec ?? 3) : (asset.endSec ?? realDuration);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || (asset.kind === 'image' && end > 10) || (asset.kind === 'video' && (!realDuration || end > realDuration + 0.05))) throw invalid(`Clip ${index + 1}: invalid duration or trim range.`);
      const length = Math.floor((end - start) * FPS + 0.00001) / FPS;
      if (length < 0.5) throw invalid(`Clip ${index + 1}: clips must be at least half a second long.`);
      const overlap = index && transition !== 'none' ? OVERLAP : 0;
      const clipStart = Math.round((durationSec - overlap) * FPS) / FPS;
      durationSec = Math.round((clipStart + length) * FPS) / FPS;
      if (durationSec > MAX_DURATION + 0.001) throw invalid('The combined reel must be no longer than 3 minutes. Trim or remove a clip.');
      clips.push({ index, start: clipStart, end: durationSec, sourceStart: start, sourceEnd: start + length, kind: asset.kind });
      prepared.push({ inputArgs, start, length, kind: asset.kind, hasAudio });
    }
    // Validate the complete timeline before doing the expensive normalization work.
    const normalized = [];
    for (const [index, clip] of prepared.entries()) {
      const output = path.join(folder, `clip-${index}.mp4`);
      const args = ['-loglevel', 'error', ...(clip.kind === 'image' ? ['-loop', '1', '-framerate', String(FPS)] : ['-ss', String(clip.start)]), ...clip.inputArgs];
      const useAudio = clip.kind === 'video' && clip.hasAudio;
      if (!useAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
      args.push('-map', '0:v:0', '-map', useAudio ? '0:a:0' : '1:a:0', '-vf', 'scale=720:1280:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p', '-af', 'aresample=48000:first_pts=0,apad', '-t', String(clip.length), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k', '-threads', '1', '-movflags', '+faststart', output);
      await execute(args);
      normalized.push(output);
    }
    const output = path.join(folder, 'reel.mp4');
    if (normalized.length === 1) await fs.copyFile(normalized[0], output);
    else {
      const filters = [];
      for (let i = 0; i < normalized.length; i++) filters.push(`[${i}:v]trim=duration=${prepared[i].length},settb=AVTB,setpts=PTS-STARTPTS[v${i}];[${i}:a]atrim=duration=${prepared[i].length},asetpts=PTS-STARTPTS[a${i}]`);
      let video = 'v0'; let audio = 'a0';
      for (let i = 1; i < normalized.length; i++) {
        if (transition === 'none') filters.push(`[${video}][${audio}][v${i}][a${i}]concat=n=2:v=1:a=1[outv${i}][outa${i}]`);
        else {
          filters.push(`[${video}][v${i}]xfade=transition=${transition === 'slide' ? 'slideleft' : 'fade'}:duration=${OVERLAP}:offset=${clips[i].start}[outv${i}]`);
          filters.push(`[${audio}][a${i}]acrossfade=d=${OVERLAP}:c1=tri:c2=tri[outa${i}]`);
        }
        video = `outv${i}`; audio = `outa${i}`;
      }
      await execute(['-loglevel', 'error', ...normalized.flatMap(file => ['-protocol_whitelist', 'file,pipe', '-i', file]), '-filter_complex', filters.join(';'), '-map', `[${video}]`, '-map', `[${audio}]`, '-t', String(durationSec), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-threads', '1', '-movflags', '+faststart', output]);
    }
    return { buffer: await fs.readFile(output), contentType: 'video/mp4', durationSec, clips, notes: ['Media is fitted to a vertical frame without cropping.', ...(transition !== 'none' && clips.length > 1 ? ['Transitions overlap adjacent clips by 11 frames (about 0.37 seconds), with an audio crossfade.'] : [])] };
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
}

module.exports = { assembleReel };
