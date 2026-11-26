#!/usr/bin/env node
/**
 * Standalone render entry for the Animated Carousel Cover.
 *
 * Runs inside this Remotion workspace (its own node_modules), so the backend
 * server never has to import Remotion's React/Chromium deps. The agent module
 * shells out to it:
 *
 *   node render.mjs <specJsonPath> <outMp4Path>
 *   node render.mjs --sample out/sample.mp4       # render the built-in sample
 *   node render.mjs --sample-reel out/reel.mp4    # the built-in Capture Reel sample
 *
 * A JSON file of the form { composition: 'CaptureReel', props: {...} } renders
 * that composition with those props (services/captureReelAgent.js); any other
 * JSON is a cover spec for AnimatedCover.
 *
 * Exit code 0 on success; prints the output path as the last stdout line.
 */
import { bundle } from '@remotion/bundler';
import { selectComposition, renderMedia, openBrowser } from '@remotion/renderer';
import { readFileSync, mkdirSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  let specPath = null;
  let outPath = null;
  let compositionId = 'AnimatedCover';

  // build time (scripts/setup-remotion.js): make the webpack bundle now, so
  // the first reel after a deploy doesn't pay ~16 s for it
  if (args[0] === '--bundle-only') {
    const dir = await cachedBundle();
    console.log(dir);
    return;
  }

  if (args[0] === '--sample-reel') {
    outPath = args[1] || 'out/reel-sample.mp4';
    compositionId = 'CaptureReel';
  } else if (args[0] === '--sample') {
    outPath = args[1] || 'out/sample.mp4';
  } else {
    specPath = args[0];
    outPath = args[1];
  }
  if (!outPath) {
    console.error('usage: node render.mjs <specJsonPath> <outMp4Path>  |  --sample <outMp4Path>');
    process.exit(2);
  }
  outPath = resolve(process.cwd(), outPath);
  mkdirSync(dirname(outPath), { recursive: true });

  // Load spec (or fall back to the bundled sample via defaultProps).
  let inputProps = {};
  if (specPath) {
    const raw = readFileSync(resolve(process.cwd(), specPath), 'utf8');
    const spec = JSON.parse(raw);
    if (spec && typeof spec.composition === 'string') {
      compositionId = spec.composition;
      inputProps = spec.props || {};
    } else {
      inputProps = { spec: spec.spec ?? spec };
    }
  }

  // Motion reels: film grain is added by ffmpeg after the render instead of drawn into every frame
  // (lemo-opuscar TECHNIQUE §2: in-page grain makes frames incompressible and slow — measured here
  // 2026-11-24: 31.2 s → 19.7 s capture on an 18 s reel). REEL_POST_GRAIN=off keeps it in the page.
  const reelSpec = inputProps && inputProps.reel;
  const postGrain = Boolean(reelSpec && reelSpec.motion) && reelSpec.postGrain !== false && String(process.env.REEL_POST_GRAIN || '').toLowerCase() !== 'off';
  if (postGrain) inputProps = { ...inputProps, reel: { ...reelSpec, postGrain: true } };
  const renderOut = postGrain ? outPath.replace(/\.mp4$/i, '') + '.pregrain.mp4' : outPath;

  const t0 = Date.now();
  const serveUrl = await cachedBundle();
  // We open (and always close) headless Chrome ourselves: left to Remotion,
  // Chrome outlived a finished render as an orphan holding ~1.3 GB — every
  // reel leaked one until the server ran out of memory.
  browser = await openBrowser('chrome', { chromiumOptions: { gl: glBackend(compositionId) }, logLevel: 'error' });

  const tBundled = Date.now();
  console.error(`[render:timing] bundle ${tBundled - t0}ms`);
  console.error('[render] selecting composition…');
  const composition = await selectComposition({
    serveUrl,
    puppeteerInstance: browser,
    id: compositionId,
    inputProps,
    timeoutInMilliseconds: 120000,
  });

  console.error(
    `[render] ${composition.width}x${composition.height} @ ${composition.fps}fps · ${composition.durationInFrames} frames · ${renderTabs()} tab(s)`,
  );
  const tRender = Date.now();
  await renderMedia({
    serveUrl,
    puppeteerInstance: browser,
    composition,
    codec: 'h264',
    outputLocation: renderOut,
    inputProps,
    // a production box is small (Render starter = 512 MB, shared with the API):
    // one Chrome tab and a capped video-frame cache unless told otherwise
    concurrency: renderTabs(),
    offthreadVideoCacheSizeInBytes: Number(process.env.REEL_VIDEO_CACHE_BYTES) || (process.env.NODE_ENV === 'production' ? 150 * 1024 * 1024 : null),
    timeoutInMilliseconds: 120000,
    chromiumOptions: { gl: glBackend(compositionId) },
    x264Preset: process.env.REEL_X264_PRESET || 'veryfast',
    // Quality (studio report "the video quality seems degraded", 2026-11-24 bench on a real reel, 100
    // frames vs a lossless PNG/CRF 8 reference): Remotion captures each frame as JPEG q80 by default and
    // we encoded at CRF 23 → PSNR 42.0 dB. JPEG q95 + CRF 21 → 43.3 dB (same as lossless PNG capture,
    // which costs +55 % render time) for +3 % render time, ~6.6 Mbps. REEL_CRF / REEL_JPEG_QUALITY /
    // REEL_IMAGE_FORMAT override.
    ...(compositionId === 'CaptureReel' ? { crf: Number(process.env.REEL_CRF) || 21 } : {}),
    ...(compositionId === 'CaptureReel' || process.env.REEL_JPEG_QUALITY
      ? { jpegQuality: Number(process.env.REEL_JPEG_QUALITY) || 92 } : {}),
    ...(process.env.REEL_IMAGE_FORMAT ? { imageFormat: process.env.REEL_IMAGE_FORMAT } : {}),
    ...(Number(process.env.REEL_RENDER_SCALE) > 0 ? { scale: Number(process.env.REEL_RENDER_SCALE) } : {}),
    ...(frameRange() ? { frameRange: frameRange() } : {}),
    onProgress: ({ progress }) => {
      // every 5 %: the server turns these into the reel's progress bar and
      // its hang watchdog (services/captureReelAgent.js renderReel)
      const pct = Math.floor(progress * 20) * 5;
      if (pct !== lastPct) {
        lastPct = pct;
        process.stderr.write(`[render] ${pct}%\n`);
      }
    },
  });

  console.error(`[render:timing] select ${tRender - tBundled}ms · render ${Date.now() - tRender}ms`);
  if (postGrain) {
    const tGrain = Date.now();
    await addGrain(renderOut, outPath, Number(process.env.REEL_CRF) || 21);
    rmSync(renderOut, { force: true });
    console.error(`[render:timing] grain ${Date.now() - tGrain}ms`);
  }
  // last stdout line = the artifact path (the agent module reads this)
  console.log(outPath);
}

let lastPct = -1;

// How many Chrome tabs render frames at once. Frames scale ~linearly with
// tabs, so use every CPU the box has — but each tab holds ~450 MB on a reel
// with video clips (measured 2026-11-26: 972-frame voiceover reel, one tab,
// ~1 GB for the renderer + Chrome), so memory caps it too.
// REEL_RENDER_CONCURRENCY overrides.
function renderTabs() {
  const forced = Number(process.env.REEL_RENDER_CONCURRENCY);
  if (forced > 0) return forced;
  const cpus = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  const memMb = memoryLimitMb();
  const byMem = Math.floor((memMb - 900) / 450); // ~900 MB for node + Chrome itself
  return Math.max(1, Math.min(cpus, byMem, 8));
}

// the container's memory limit (cgroup), not the host's — same as backend utils/memoryLimit.js
function memoryLimitMb() {
  const read = (f) => {
    try {
      const raw = readFileSync(f, 'utf8').trim();
      const n = Number(raw);
      return raw && raw !== 'max' && Number.isFinite(n) && n > 0 && n < 2 ** 60 ? n : null;
    } catch { return null; }
  };
  const bytes = read('/sys/fs/cgroup/memory.max') ?? read('/sys/fs/cgroup/memory/memory.limit_in_bytes');
  return Math.round(Math.min(bytes || os.totalmem(), os.totalmem()) / (1024 * 1024));
}

// the same ffmpeg the backend uses (FFMPEG_PATH, else the ffmpeg-static package, else the PATH one)
function ffmpegBin() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { return createRequire(import.meta.url)('ffmpeg-static') || 'ffmpeg'; } catch { return 'ffmpeg'; }
}

// temporal luma grain, light (the page used to draw it at ~9 % multiply); audio copied untouched
function addGrain(src, dst, crf) {
  return new Promise((res, rej) => {
    const p = spawn(ffmpegBin(), [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', src,
      '-vf', 'noise=c0s=9:c0f=t+u', '-c:v', 'libx264', '-preset', process.env.REEL_X264_PRESET || 'veryfast',
      '-crf', String(crf), '-tune', 'grain', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', dst,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', rej);
    p.on('close', (code) => (code === 0 ? res() : rej(new Error(`grain pass failed (${code}): ${err.slice(-400)}`))));
  });
}

// Capture reels: SwiftShader (pure CPU, works on a GPU-less host) renders
// ~6× faster than swangle — 150 frames 4.2 s vs 26 s (Nov 2026 bench), and a
// touch faster than the Mac GPU via ANGLE. The cover keeps swangle.
// RENDER_GL overrides both.
function glBackend(id) {
  return process.env.RENDER_GL || (id === 'CaptureReel' ? 'swiftshader' : 'swangle');
}

// RENDER_FRAMES="0-149" renders a slice (benchmarks)
function frameRange() {
  const m = /^(\d+)-(\d+)$/.exec(String(process.env.RENDER_FRAMES || ''));
  return m ? [Number(m[1]), Number(m[2])] : null;
}

// Webpack-bundling the compositions costs ~10 s per render. The bundle only
// changes when src/ or the dependencies do, so it is kept on disk keyed by a
// hash of those files and reused.
async function cachedBundle() {
  const files = [
    ...readdirSync(resolve(__dirname, 'src')).map((f) => resolve(__dirname, 'src', f)),
    resolve(__dirname, 'package-lock.json'),
    // public/ is copied into the bundle (sound effects: scripts/make-sfx.mjs)
    ...(existsSync(resolve(__dirname, 'public/sfx')) ? readdirSync(resolve(__dirname, 'public/sfx')).map((f) => resolve(__dirname, 'public/sfx', f)) : []),
  ].filter((f) => existsSync(f) && statSync(f).isFile()).sort();
  const hash = createHash('sha1');
  for (const f of files) hash.update(f).update(readFileSync(f));
  const key = hash.digest('hex').slice(0, 16);
  const root = resolve(__dirname, '.bundle-cache');
  const dir = resolve(root, key);
  if (existsSync(resolve(dir, 'index.html'))) return dir;
  console.error('[render] bundling…');
  // old bundles are dead weight once the source changed
  if (existsSync(root)) for (const d of readdirSync(root)) if (d !== key && !d.startsWith('tmp-')) rmSync(resolve(root, d), { recursive: true, force: true });
  const tmp = resolve(root, `tmp-${process.pid}-${Date.now()}`);
  await bundle({ entryPoint: resolve(__dirname, 'src/index.ts'), outDir: tmp, publicDir: resolve(__dirname, 'public') });
  // publish atomically so a parallel render never reads a half-written bundle
  try {
    const { renameSync } = await import('node:fs');
    renameSync(tmp, dir);
    return dir;
  } catch {
    // another render published the same bundle first
    if (existsSync(resolve(dir, 'index.html'))) { rmSync(tmp, { recursive: true, force: true }); return dir; }
    return tmp;
  }
}

// Remotion can leave handles open after the file is written (seen: a finished
// render hanging until killed), so leave explicitly.
let browser = null;
async function closeBrowser() {
  const b = browser;
  browser = null;
  if (b) await b.close({ silent: true }).catch(() => {});
}
// the server stops a render with SIGTERM first (then SIGKILL): close Chrome
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { closeBrowser().finally(() => process.exit(143)); });
}

main().then(async () => { await closeBrowser(); process.exit(0); }).catch(async (err) => {
  await closeBrowser();
  console.error('[render] failed:', err?.stack || err?.message || err);
  process.exit(1);
});
