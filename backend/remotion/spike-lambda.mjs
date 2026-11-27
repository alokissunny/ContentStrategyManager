#!/usr/bin/env node
/**
 * Phase 0 spike: render a saved reel timeline on Remotion Lambda
 * (plan: backend/aws/REEL_RENDER_LAMBDA.md). Not wired into the app.
 *
 *   node spike-lambda.mjs deploy
 *       deploys the render function + uploads the current bundle as a site
 *       (site name = the bundle-cache hash), writes .lambda-spike.json
 *   node spike-lambda.mjs render <spec.json> <out.mp4> [framesPerLambda]
 *       same spec file render.mjs takes; prints time + cost; downloads the MP4
 *
 * Credentials: REMOTION_AWS_ACCESS_KEY_ID / REMOTION_AWS_SECRET_ACCESS_KEY,
 * region REMOTION_AWS_REGION (the media bucket's region).
 * Options as render.mjs: REEL_CRF (21), REEL_JPEG_QUALITY (92),
 * REEL_X264_PRESET (veryfast), RENDER_GL (Lambda default: swangle).
 */
import {
  deployFunction, deploySiteFromBundle, getOrCreateBucket,
  renderMediaOnLambda, getRenderProgress, downloadMedia,
} from '@remotion/lambda';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE = resolve(__dirname, '.lambda-spike.json');
const region = process.env.REMOTION_AWS_REGION || process.env.AWS_REGION;
if (!region) throw new Error('set REMOTION_AWS_REGION');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function deploy() {
  const fn = await deployFunction({
    region,
    memorySizeInMb: Number(process.env.SPIKE_MEMORY_MB) || 3008,
    diskSizeInMb: 2048,
    timeoutInSeconds: 240,
    createCloudWatchLogGroup: true,
  });
  console.error(`[spike] function ${fn.functionName} (${fn.alreadyExisted ? 'existed' : 'created'})`);
  const { bucketName } = await getOrCreateBucket({ region });
  // the same webpack bundle render.mjs uses, keyed by the source hash
  const bundleDir = execFileSync('node', ['render.mjs', '--bundle-only'], { cwd: __dirname, encoding: 'utf8' }).trim().split('\n').pop();
  const siteName = `reel-${basename(bundleDir)}`;
  const t0 = Date.now();
  const site = await deploySiteFromBundle({ region, bucketName, bundleDir, siteName });
  console.error(`[spike] site ${siteName} uploaded in ${Date.now() - t0}ms`);
  writeFileSync(STATE, JSON.stringify({ region, functionName: fn.functionName, bucketName, serveUrl: site.serveUrl, siteName }, null, 2));
  console.log(site.serveUrl);
}

async function render(specPath, outPath, framesPerLambda) {
  if (!existsSync(STATE)) throw new Error('run `node spike-lambda.mjs deploy` first');
  const { functionName, serveUrl } = JSON.parse(readFileSync(STATE, 'utf8'));
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const t0 = Date.now();
  const { renderId, bucketName } = await renderMediaOnLambda({
    region,
    functionName,
    serveUrl,
    composition: spec.composition || 'CaptureReel',
    inputProps: spec.props || {},
    codec: 'h264',
    crf: Number(process.env.REEL_CRF) || 21,
    jpegQuality: Number(process.env.REEL_JPEG_QUALITY) || 92,
    x264Preset: process.env.REEL_X264_PRESET || 'veryfast',
    ...(process.env.RENDER_GL ? { chromiumOptions: { gl: process.env.RENDER_GL } } : {}),
    framesPerLambda: Number(framesPerLambda) || undefined,
    privacy: 'private',
    maxRetries: 1,
    timeoutInMilliseconds: 120000,
  });
  console.error(`[spike] render ${renderId} started`);
  let lastPct = -1;
  for (;;) {
    await sleep(2000);
    const p = await getRenderProgress({ renderId, bucketName, functionName, region });
    const pct = Math.floor(p.overallProgress * 20) * 5;
    if (pct !== lastPct) { lastPct = pct; console.error(`[render] ${pct}%`); }
    if (p.fatalErrorEncountered) {
      console.error(JSON.stringify(p.errors.slice(0, 3), null, 2));
      process.exit(1);
    }
    if (p.done) {
      const renderMs = Date.now() - t0;
      const t1 = Date.now();
      await downloadMedia({ bucketName, region, renderId, outPath: resolve(process.cwd(), outPath) });
      console.log(JSON.stringify({
        spec: basename(specPath),
        renderMs,
        downloadMs: Date.now() - t1,
        lambdas: p.lambdasInvoked,
        framesPerLambda: Number(framesPerLambda) || 'auto',
        costUsd: p.costs?.accruedSoFar,
        costDisplay: p.costs?.displayCost,
        timeToFinishChunks: p.timeToFinishChunks,
      }));
      return;
    }
  }
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'deploy') await deploy();
else if (cmd === 'render') await render(rest[0], rest[1], rest[2]);
else {
  console.error('usage: node spike-lambda.mjs deploy | render <spec.json> <out.mp4> [framesPerLambda]');
  process.exit(2);
}
