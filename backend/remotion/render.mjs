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
import { selectComposition, renderMedia } from '@remotion/renderer';
import { readFileSync, mkdirSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  let specPath = null;
  let outPath = null;
  let compositionId = 'AnimatedCover';

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

  const t0 = Date.now();
  const serveUrl = await cachedBundle();

  const tBundled = Date.now();
  console.error(`[render:timing] bundle ${tBundled - t0}ms`);
  console.error('[render] selecting composition…');
  const composition = await selectComposition({
    serveUrl,
    id: compositionId,
    inputProps,
    timeoutInMilliseconds: 120000,
  });

  console.error(
    `[render] ${composition.width}x${composition.height} @ ${composition.fps}fps · ${composition.durationInFrames} frames`,
  );
  const tRender = Date.now();
  await renderMedia({
    serveUrl,
    composition,
    codec: 'h264',
    outputLocation: outPath,
    inputProps,
    // a production box is small (Render starter = 512 MB, shared with the API):
    // one Chrome tab and a capped video-frame cache unless told otherwise
    concurrency: Number(process.env.REEL_RENDER_CONCURRENCY) || (process.env.NODE_ENV === 'production' ? 1 : null),
    offthreadVideoCacheSizeInBytes: Number(process.env.REEL_VIDEO_CACHE_BYTES) || (process.env.NODE_ENV === 'production' ? 150 * 1024 * 1024 : null),
    timeoutInMilliseconds: 120000,
    chromiumOptions: { gl: glBackend(compositionId) },
    x264Preset: process.env.REEL_X264_PRESET || 'veryfast',
    // Remotion's default CRF 18 makes a ~5.5 Mbps 1080×1920 reel (22 MB for 32 s)
    // that streams slowly; 23 is visually the same on phone footage and
    // Instagram re-encodes on upload anyway. REEL_CRF overrides.
    ...(compositionId === 'CaptureReel' ? { crf: Number(process.env.REEL_CRF) || 23 } : {}),
    ...(Number(process.env.REEL_RENDER_SCALE) > 0 ? { scale: Number(process.env.REEL_RENDER_SCALE) } : {}),
    ...(frameRange() ? { frameRange: frameRange() } : {}),
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 5) * 20;
      if (pct !== lastPct) {
        lastPct = pct;
        process.stderr.write(`[render] ${pct}%\n`);
      }
    },
  });

  console.error(`[render:timing] select ${tRender - tBundled}ms · render ${Date.now() - tRender}ms`);
  // last stdout line = the artifact path (the agent module reads this)
  console.log(outPath);
}

let lastPct = -1;

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
  await bundle({ entryPoint: resolve(__dirname, 'src/index.ts'), outDir: tmp });
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
main().then(() => process.exit(0)).catch((err) => {
  console.error('[render] failed:', err?.stack || err?.message || err);
  process.exit(1);
});
