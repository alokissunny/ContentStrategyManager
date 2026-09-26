const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const invalid = message => Object.assign(new Error(message), { statusCode: 400 });

function execute(args, { signal, timeout = 600000, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('Podcast export cancelled.'), { name: 'AbortError' }));
    const child = spawn(process.env.FFMPEG_PATH || require('ffmpeg-static'), ['-nostdin', '-hide_banner', '-y', '-threads', '1', '-filter_threads', '1', '-filter_complex_threads', '1', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '', progress = '', failure;
    const abort = () => { failure = Object.assign(new Error('Podcast export cancelled.'), { name: 'AbortError' }); child.kill('SIGKILL'); };
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { failure = new Error('Podcast export timed out. Try a shorter selection.'); child.kill('SIGKILL'); }, timeout);
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-65536); });
    child.stdout.on('data', data => {
      progress += data;
      const lines = progress.split('\n'); progress = lines.pop();
      for (const line of lines) if (line.startsWith('out_time_us=')) onProgress?.(Number(line.slice(12)) / 1000000);
    });
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    child.on('error', error => { cleanup(); reject(error); });
    child.on('close', code => { cleanup(); if (failure) reject(failure); else if (code !== 0) reject(new Error(`Podcast media processing failed: ${stderr.slice(-1500)}`)); else resolve(stderr); });
  });
}

async function probePodcast(filePath, signal) {
  const info = await execute(['-protocol_whitelist', 'file,pipe', '-i', filePath, '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-'], { signal, timeout: 30000 });
  const duration = info.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const video = info.split('\n').find(line => /Stream .*Video:/.test(line));
  const size = video?.match(/\b(\d{2,5})x(\d{2,5})\b/);
  const durationSec = duration ? +duration[1] * 3600 + +duration[2] * 60 + +duration[3] : 0;
  if (!durationSec || !size) throw invalid('A podcast source must be a readable video with a finite duration.');
  return { durationSec, hasAudio: /Stream .*Audio:/.test(info), width: +size[1], height: +size[2] };
}

async function renderPodcast({ assets, plan, mode = 'conversation', masterAssetId, masterStartSec = 0, aspectRatio = '16:9', cleanAudio = true, brandingPath, signal, onProgress }) {
  const sizes = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [720, 720] };
  if (!sizes[aspectRatio] || !['conversation', 'segments'].includes(mode) || !Array.isArray(assets) || assets.length < 1 || assets.length > 12 || !plan?.segments?.length || plan.segments.length > 300) throw invalid('Invalid podcast render settings.');
  const lookup = new Map(assets.map(asset => [asset.id, asset]));
  let elapsed = 0;
  const segments = plan.segments.map(segment => {
    const asset = lookup.get(segment.assetId);
    const duration = segment.sourceEnd - segment.sourceStart;
    if (!asset || !Number.isFinite(asset.durationSec) || !Number.isFinite(segment.sourceStart) || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) || !Number.isFinite(duration) || segment.sourceStart < 0 || duration < 1 / 30 || segment.sourceEnd > asset.durationSec + 0.04 || Math.abs(segment.start - elapsed) > 0.04 || Math.abs(segment.end - segment.start - duration) > 0.04) throw invalid('Podcast timeline contains invalid or non-contiguous source ranges.');
    elapsed += duration;
    const frames = Math.round(segment.end * 30) - Math.round(segment.start * 30);
    if (frames < 1) throw invalid('Podcast cuts must contain at least one output frame.');
    return { ...segment, asset, duration: frames / 30, frames };
  });
  if (!Number.isFinite(plan.durationSec) || elapsed > 1800 || Math.abs(elapsed - plan.durationSec) > 0.05) throw invalid('Podcast duration must match its timeline and cannot exceed 30 minutes.');
  const master = lookup.get(masterAssetId);
  if (mode === 'conversation' && (!master || !Number.isFinite(masterStartSec) || masterStartSec < 0 || masterStartSec + elapsed > master.durationSec + 0.04)) throw invalid('The continuous audio source must cover the entire podcast.');
  elapsed = Math.round(elapsed * 30) / 30;
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'podcast-render-'));
  const [width, height] = sizes[aspectRatio];
  const commonOutput = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-threads', '1'];
  try {
    // Encode sequentially to bound decoder memory even with hundreds of camera cuts.
    const files = [];
    for (const [index, segment] of segments.entries()) {
      const output = path.join(folder, `clip-${index}.mov`);
      const audio = mode === 'segments';
      const input = ['-ss', String(segment.sourceStart), '-protocol_whitelist', 'file,pipe', '-i', segment.asset.path];
      if (audio && !segment.asset.hasAudio) input.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
      await execute([...input, '-t', String(segment.duration), '-frames:v', String(segment.frames), '-map', '0:v:0', ...(audio ? ['-map', segment.asset.hasAudio ? '0:a:0' : '1:a:0', '-af', 'aresample=48000,apad', '-ac', '2', '-c:a', 'pcm_s16le'] : ['-an']), '-vf', `setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30`, ...commonOutput, output], { signal });
      files.push(`file '${output}'`);
      onProgress?.(Math.round((index + 1) / segments.length * 85));
    }
    const list = path.join(folder, 'clips.txt');
    await fs.writeFile(list, files.join('\n'));
    const inputs = ['-f', 'concat', '-safe', '0', '-protocol_whitelist', 'file,pipe', '-i', list];
    if (mode === 'conversation') {
      if (master.hasAudio) inputs.push('-ss', String(masterStartSec), '-protocol_whitelist', 'file,pipe', '-i', master.path);
      else inputs.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
    }
    const brandingIndex = mode === 'conversation' ? 2 : 1;
    if (brandingPath) inputs.push('-loop', '1', '-protocol_whitelist', 'file,pipe', '-i', brandingPath);
    const output = path.join(folder, 'podcast.mp4');
    const audioFilter = cleanAudio ? 'highpass=f=70,afftdn=nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,apad' : 'aresample=48000,apad';
    await execute([...inputs, ...(brandingPath ? ['-filter_complex', `[${brandingIndex}:v]scale=${width}:${height},format=rgba[brand];[0:v][brand]overlay=0:0:shortest=1[branded]`, '-map', '[branded]', ...commonOutput] : ['-map', '0:v:0', '-c:v', 'copy']), '-map', mode === 'conversation' ? '1:a:0' : '0:a:0', '-af', audioFilter, '-ac', '2', '-c:a', 'aac', '-b:a', '192k', '-t', String(elapsed), '-movflags', '+faststart', '-progress', 'pipe:1', output], { signal, onProgress: seconds => onProgress?.(Math.min(99, 85 + Math.round(seconds / elapsed * 14))) });
    const verified = await probePodcast(output, signal);
    if (Math.abs(verified.durationSec - elapsed) > 0.12 || verified.width !== width || verified.height !== height || !verified.hasAudio) throw new Error('Rendered podcast failed duration, dimensions, or audio validation.');
    const buffer = await fs.readFile(output);
    onProgress?.(100);
    return { buffer, durationSec: verified.durationSec, contentType: 'video/mp4' };
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
}
module.exports = { renderPodcast, probePodcast };
