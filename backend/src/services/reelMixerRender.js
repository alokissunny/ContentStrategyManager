const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { assembleReel } = require('./reelAssembly');
const run = promisify(execFile);
const invalid = message => Object.assign(new Error(message), { statusCode: 400 });
const frame = value => Math.round(value * 30) / 30;
const formats = { 'video/mp4': 'mov', 'video/quicktime': 'mov', 'video/webm': 'matroska', 'image/jpeg': 'image2', 'image/png': 'image2', 'image/webp': 'image2' };

async function renderMixedReel({ assets, plan }) {
  if (!Array.isArray(assets) || !assets.length || assets.length > 12 || !plan || !Array.isArray(plan.sequence) || !plan.sequence.length || plan.sequence.length > 12 || !Array.isArray(plan.overlays) || plan.overlays.length > 12) throw invalid('Invalid mixer timeline.');
  const getAsset = index => {
    if (!Number.isInteger(index) || !assets[index]) throw invalid('Mixer references an unknown asset.');
    return assets[index];
  };
  const sequence = plan.sequence.map(clip => {
    const asset = getAsset(clip.assetIndex);
    if (asset.kind === 'image') {
      const durationSec = clip.durationSec ?? asset.durationSec;
      if ((clip.startSec != null && clip.startSec !== 0) || (asset.durationSec != null && durationSec > asset.durationSec)) throw invalid('Mixer photo exceeds the selected duration.');
      return { ...asset, durationSec };
    }
    const requestedStart = clip.startSec ?? asset.startSec ?? 0;
    const requestedEnd = clip.endSec ?? asset.endSec;
    const startSec = Math.ceil(requestedStart * 30 - 0.00001) / 30;
    const endSec = requestedEnd == null ? undefined : Math.floor(requestedEnd * 30 + 0.00001) / 30;
    if (startSec < (asset.startSec ?? 0) || (asset.endSec != null && endSec > asset.endSec)) throw invalid('Mixer sequence exceeds the selected trim.');
    return { ...asset, startSec, endSec };
  });
  // Cheap checks before assembly; decoded-duration checks follow below.
  const overlays = plan.overlays.map(overlay => {
    getAsset(overlay.assetIndex);
    if (!['pip', 'cutaway'].includes(overlay.mode) || !['none', 'fade'].includes(overlay.transition) || !['top-right', 'top-left', 'bottom-right', 'bottom-left'].includes(overlay.position) || !Number.isFinite(overlay.atSec) || !Number.isFinite(overlay.durationSec) || !Number.isFinite(overlay.startSec ?? 0) || overlay.atSec < 0 || overlay.durationSec < 0.5 || overlay.startSec < 0 || overlay.atSec + overlay.durationSec > 180) throw invalid('Invalid mixer overlay.');
    return { ...overlay, atSec: frame(overlay.atSec), durationSec: Math.floor(overlay.durationSec * 30 + 0.00001) / 30, startSec: frame(overlay.startSec ?? 0) };
  }).sort((a, b) => a.atSec - b.atSec);
  for (let i = 1; i < overlays.length; i++) if (overlays[i].atSec < overlays[i - 1].atSec + overlays[i - 1].durationSec - 0.001) throw invalid('Mixer overlays must not overlap.');
  const base = await assembleReel({ assets: sequence, transition: plan.transition });
  const result = { ...base, clips: base.clips.map((clip, i) => ({ ...clip, index: plan.sequence[i].assetIndex, assetIndex: plan.sequence[i].assetIndex })), overlays };
  if (!overlays.length) return result;
  if (overlays.some(o => o.atSec + o.durationSec > base.durationSec + 0.001)) throw invalid('Mixer overlay exceeds the reel duration.');
  const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static');
  const execute = args => run(ffmpeg, ['-nostdin', '-hide_banner', '-y', '-threads', '1', '-filter_threads', '1', '-filter_complex_threads', '1', ...args], { timeout: 240000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'reel-mixer-'));
  try {
    const basePath = path.join(folder, 'base.mp4');
    await fs.writeFile(basePath, base.buffer);
    const inputs = ['-protocol_whitelist', 'file,pipe', '-i', basePath];
    const filters = [];
    for (const [i, overlay] of overlays.entries()) {
      const asset = getAsset(overlay.assetIndex);
      if (!formats[asset.contentType] || !['video', 'image'].includes(asset.kind) || !asset.contentType.startsWith(`${asset.kind}/`) || !Buffer.isBuffer(asset.buffer) || !asset.buffer.length) throw invalid('Unsupported mixer overlay media.');
      const source = path.join(folder, `source-${i}`);
      await fs.writeFile(source, asset.buffer);
      const input = ['-protocol_whitelist', 'file,pipe', '-f', formats[asset.contentType], '-i', source];
      let info;
      try { info = await execute([...input, '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-']); } catch { throw invalid('Mixer overlay could not be decoded.'); }
      if (asset.kind === 'video') {
        const match = info.stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
        const duration = match ? +match[1] * 3600 + +match[2] * 60 + +match[3] : 0;
        const end = Math.min(duration, asset.endSec ?? duration);
        if (!duration || overlay.startSec < (asset.startSec ?? 0) - 0.001 || overlay.startSec + overlay.durationSec > end + 0.001) throw invalid('Mixer overlay exceeds the actual video duration or selected trim.');
        inputs.push('-ss', String(overlay.startSec), '-t', String(overlay.durationSec), ...input);
      } else {
        if (overlay.startSec !== 0 || overlay.durationSec > 10 || (asset.durationSec != null && overlay.durationSec > asset.durationSec)) throw invalid('Invalid photo overlay duration or selected duration.');
        inputs.push('-loop', '1', '-framerate', '30', '-t', String(overlay.durationSec), ...input);
      }
      const dimensions = overlay.mode === 'pip' ? '260:400' : '720:1280';
      const fit = `scale=${dimensions}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1`;
      const framing = overlay.mode === 'pip' ? 'pad=iw+8:ih+8:4:4:color=white' : 'pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=black';
      const fadeDuration = Math.min(0.2, overlay.durationSec / 4);
      const fade = overlay.transition === 'fade' ? `,fade=t=in:st=0:d=${fadeDuration}:alpha=1,fade=t=out:st=${overlay.durationSec - fadeDuration}:d=${fadeDuration}:alpha=1` : '';
      filters.push(`[${i + 1}:v]fps=30,trim=duration=${overlay.durationSec},setpts=PTS-STARTPTS,${fit},${framing},format=yuva420p${fade},setpts=PTS+${overlay.atSec}/TB[overlay${i}]`);
      const x = overlay.mode === 'cutaway' ? '0' : overlay.position.endsWith('right') ? 'W-w-36' : '36';
      const y = overlay.mode === 'cutaway' ? '0' : overlay.position.startsWith('top') ? '64' : 'H-h-220';
      filters.push(`[${i ? `mixed${i - 1}` : '0:v'}][overlay${i}]overlay=x=${x}:y=${y}:eof_action=pass:repeatlast=0:enable='gte(t,${overlay.atSec})*lt(t,${frame(overlay.atSec + overlay.durationSec)})'[mixed${i}]`);
    }
    const output = path.join(folder, 'mixed.mp4');
    await execute(['-loglevel', 'error', ...inputs, '-filter_complex', filters.join(';'), '-map', `[mixed${overlays.length - 1}]`, '-map', '0:a:0', '-c:a', 'copy', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-t', String(base.durationSec), '-threads', '1', '-movflags', '+faststart', output]);
    return { ...result, buffer: await fs.readFile(output), notes: [...base.notes, 'Supporting visuals are placed over the running reel; its audio continues uninterrupted.'] };
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
}
module.exports = { renderMixedReel };
