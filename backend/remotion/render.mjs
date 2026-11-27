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
import { selectComposition, renderMedia, openBrowser } from '@remotion/renderer';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { cachedBundle, addGrain } from './render-shared.mjs';

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
// tabs, so use every CPU the box may use — but each tab holds ~450 MB on a reel
// with video clips (measured 2026-11-26: 972-frame voiceover reel, one tab,
// ~1 GB for the renderer + Chrome), so memory caps it too.
// REEL_RENDER_CONCURRENCY overrides.
//
// Both limits are the CONTAINER's, not the host's: on Render, os.cpus() /
// availableParallelism() and os.totalmem() report the whole host, so the first
// version of this ran several tabs on the 1-CPU 2 GB reel worker and it was
// OOM-killed (2026-11-27). The base also counts the worker process that spawned
// this one (~300 MB: mongoose, sharp, the reel pipeline) and ffmpeg stitching.
function renderTabs() {
  const forced = Number(process.env.REEL_RENDER_CONCURRENCY);
  if (forced > 0) return forced;
  const cpus = cpuLimit();
  const baseMb = Number(process.env.REEL_RENDER_BASE_MB) || 1400;
  const byMem = Math.floor((memoryLimitMb() - baseMb) / 450);
  return Math.max(1, Math.min(cpus, byMem, 8));
}

// CPUs this container may use: the cgroup quota (v2 cpu.max "quota period",
// v1 cfs_quota_us / cfs_period_us) when set, else what the OS reports.
function cpuLimit() {
  const host = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  const readRaw = (f) => { try { return readFileSync(f, 'utf8').trim(); } catch { return null; } };
  let quota = null;
  const v2 = readRaw('/sys/fs/cgroup/cpu.max');
  if (v2) {
    const [q, period] = v2.split(/\s+/);
    if (q !== 'max' && Number(q) > 0 && Number(period) > 0) quota = Number(q) / Number(period);
  } else {
    const q = Number(readRaw('/sys/fs/cgroup/cpu/cpu.cfs_quota_us'));
    const period = Number(readRaw('/sys/fs/cgroup/cpu/cpu.cfs_period_us'));
    if (q > 0 && period > 0) quota = q / period;
  }
  return Math.max(1, Math.min(host, quota ? Math.floor(quota) || 1 : host));
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
