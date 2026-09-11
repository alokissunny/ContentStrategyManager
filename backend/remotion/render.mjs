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
 *
 * Exit code 0 on success; prints the output path as the last stdout line.
 */
import { bundle } from '@remotion/bundler';
import { selectComposition, renderMedia } from '@remotion/renderer';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  let specPath = null;
  let outPath = null;

  if (args[0] === '--sample') {
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
    inputProps = { spec: spec.spec ?? spec };
  }

  console.error('[render] bundling…');
  const serveUrl = await bundle({
    entryPoint: resolve(__dirname, 'src/index.ts'),
    // Keep webpack defaults; google-fonts + react are resolved from this workspace.
  });

  console.error('[render] selecting composition…');
  const composition = await selectComposition({
    serveUrl,
    id: 'AnimatedCover',
    inputProps,
  });

  console.error(
    `[render] ${composition.width}x${composition.height} @ ${composition.fps}fps · ${composition.durationInFrames} frames`,
  );
  await renderMedia({
    serveUrl,
    composition,
    codec: 'h264',
    outputLocation: outPath,
    inputProps,
    // deterministic, fast enough for a single short cover
    concurrency: null,
    chromiumOptions: { gl: 'swangle' },
    onProgress: ({ progress }) => {
      if (Math.round(progress * 100) % 20 === 0) {
        process.stderr.write(`[render] ${Math.round(progress * 100)}%\n`);
      }
    },
  });

  // last stdout line = the artifact path (the agent module reads this)
  console.log(outPath);
}

main().catch((err) => {
  console.error('[render] failed:', err?.stack || err?.message || err);
  process.exit(1);
});
