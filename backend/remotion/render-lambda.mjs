#!/usr/bin/env node
/**
 * Render a reel on Remotion Lambda instead of local Chrome (backend/aws/REEL_RENDER_LAMBDA.md).
 * Same contract as render.mjs, so captureReelAgent.js renderReel() only picks the script:
 *
 *   node render-lambda.mjs <specJsonPath> <outMp4Path>
 *     stderr: `[render] N%` every 5 %, `[render:timing] bundle Xms` / `… · render Yms`,
 *             `[render:cost] 0.0123` (USD, Remotion's estimate); last stdout line = the output path
 *     exit 0 = done · 1 = the render failed · 3 = Lambda isn't usable here (no creds / no function)
 *   node render-lambda.mjs --deploy-site
 *     uploads the current bundle as site `reel-<bundle hash>` (idempotent) and drops old sites
 *
 * Env: REMOTION_AWS_ACCESS_KEY_ID / REMOTION_AWS_SECRET_ACCESS_KEY / REMOTION_AWS_REGION,
 * REMOTION_LAMBDA_FUNCTION (default: the deployed function matching this Remotion version),
 * REEL_LAMBDA_FRAMES_PER_LAMBDA (default: Remotion's auto), REEL_CRF / REEL_JPEG_QUALITY /
 * REEL_X264_PRESET as render.mjs, RENDER_GL (Lambda default: swangle — matched local in the spike).
 */
import {
  getFunctions, getOrCreateBucket, getSites, deleteSite, deploySiteFromBundle,
  renderMediaOnLambda, getRenderProgress, downloadMedia,
} from '@remotion/lambda';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachedBundle, addGrain } from './render-shared.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const region = process.env.REMOTION_AWS_REGION || '';
const KEEP_SITES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const unusable = (msg) => Object.assign(new Error(msg), { exitCode: 3 });

function checkEnv() {
  if (!region || !process.env.REMOTION_AWS_ACCESS_KEY_ID || !process.env.REMOTION_AWS_SECRET_ACCESS_KEY) {
    throw unusable('Lambda render not configured (REMOTION_AWS_* missing)');
  }
}

async function functionName() {
  if (process.env.REMOTION_LAMBDA_FUNCTION) return process.env.REMOTION_LAMBDA_FUNCTION;
  const fns = await getFunctions({ region, compatibleOnly: true });
  if (!fns.length) throw unusable(`no Remotion Lambda function for this version in ${region} — deploy one (REEL_RENDER_LAMBDA.md)`);
  // the biggest memory size renders fastest
  return fns.sort((a, b) => b.memorySizeInMb - a.memorySizeInMb)[0].functionName;
}

// the site for the current bundle; uploaded on first use when the build step didn't
async function site({ prune = false } = {}) {
  const bundleDir = await cachedBundle();
  const siteName = `reel-${basename(bundleDir)}`;
  const marker = resolve(__dirname, '.bundle-cache', `.lambda-site-${region}-${basename(bundleDir)}`);
  if (!prune && existsSync(marker)) return JSON.parse(readFileSync(marker, 'utf8'));
  const { bucketName } = await getOrCreateBucket({ region, enableFolderExpiry: true });
  const { sites } = await getSites({ region });
  let serveUrl = sites.find((s) => s.id === siteName)?.serveUrl;
  if (!serveUrl) {
    const t0 = Date.now();
    ({ serveUrl } = await deploySiteFromBundle({ region, bucketName, bundleDir, siteName }));
    console.error(`[render] site ${siteName} uploaded in ${Date.now() - t0}ms`);
  }
  if (prune) {
    // keep the newest few: a render still running on the previous deploy keeps working
    const old = sites.filter((s) => s.id.startsWith('reel-') && s.id !== siteName)
      .sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0)).slice(KEEP_SITES - 1);
    for (const s of old) await deleteSite({ region, bucketName: s.bucketName, siteName: s.id }).catch(() => {});
    if (old.length) console.error(`[render] removed ${old.length} old site(s)`);
  }
  const info = { serveUrl, bucketName, siteName };
  writeFileSync(marker, JSON.stringify(info));
  return info;
}

async function render(specPath, outPath) {
  const spec = JSON.parse(readFileSync(resolve(process.cwd(), specPath), 'utf8'));
  const composition = typeof spec.composition === 'string' ? spec.composition : 'AnimatedCover';
  let inputProps = typeof spec.composition === 'string' ? (spec.props || {}) : { spec: spec.spec ?? spec };
  // motion reels: grain added after, as render.mjs does
  const reelSpec = inputProps.reel;
  const postGrain = Boolean(reelSpec && reelSpec.motion) && reelSpec.postGrain !== false && String(process.env.REEL_POST_GRAIN || '').toLowerCase() !== 'off';
  if (postGrain) inputProps = { ...inputProps, reel: { ...reelSpec, postGrain: true } };
  outPath = resolve(process.cwd(), outPath);
  mkdirSync(dirname(outPath), { recursive: true });
  const renderOut = postGrain ? outPath.replace(/\.mp4$/i, '') + '.pregrain.mp4' : outPath;

  const t0 = Date.now();
  const [fn, { serveUrl }] = await Promise.all([functionName(), site()]);
  const tReady = Date.now();
  console.error(`[render:timing] bundle ${tReady - t0}ms`);
  const fpl = Number(process.env.REEL_LAMBDA_FRAMES_PER_LAMBDA) || undefined;
  const { renderId, bucketName } = await renderMediaOnLambda({
    region,
    functionName: fn,
    serveUrl,
    composition,
    inputProps,
    codec: 'h264',
    crf: Number(process.env.REEL_CRF) || 21,
    jpegQuality: Number(process.env.REEL_JPEG_QUALITY) || 92,
    x264Preset: process.env.REEL_X264_PRESET || 'veryfast',
    ...(process.env.RENDER_GL ? { chromiumOptions: { gl: process.env.RENDER_GL } } : {}),
    ...(fpl ? { framesPerLambda: fpl } : {}),
    privacy: 'private',
    maxRetries: 1,
    deleteAfter: '1-day', // the MP4 is downloaded right away; S3 copies are dead weight
    // Remotion usage reporting (Company Licence "Automators", $0.01/render); never blocks a render
    ...(process.env.REMOTION_LICENSE_KEY ? { licenseKey: process.env.REMOTION_LICENSE_KEY } : {}),
    timeoutInMilliseconds: 120000,
  });
  console.error(`[render] lambda render ${renderId} · ${fn}`);
  let lastPct = -1;
  let progress;
  for (;;) {
    await sleep(2000);
    progress = await getRenderProgress({ renderId, bucketName, functionName: fn, region });
    const pct = Math.min(100, Math.floor(progress.overallProgress * 20) * 5);
    if (pct > lastPct) { lastPct = pct; process.stderr.write(`[render] ${pct}%\n`); }
    if (progress.fatalErrorEncountered) {
      const e = progress.errors?.[0];
      throw new Error(`lambda render ${renderId} failed: ${String(e?.message || 'unknown error').split('\n')[0].slice(0, 400)}`);
    }
    if (progress.done) break;
  }
  await downloadMedia({ bucketName, region, renderId, outPath: renderOut });
  console.error(`[render:timing] select 0ms · render ${Date.now() - tReady}ms`);
  console.error(`[render:cost] ${Number(progress.costs?.accruedSoFar || 0).toFixed(5)} · ${progress.lambdasInvoked} lambdas`);
  if (postGrain) {
    const tGrain = Date.now();
    await addGrain(renderOut, outPath, Number(process.env.REEL_CRF) || 21);
    rmSync(renderOut, { force: true });
    console.error(`[render:timing] grain ${Date.now() - tGrain}ms`);
  }
  console.log(outPath);
}

async function main() {
  checkEnv();
  const args = process.argv.slice(2);
  if (args[0] === '--deploy-site') { console.log((await site({ prune: true })).serveUrl); return; }
  if (!args[0] || !args[1]) {
    console.error('usage: node render-lambda.mjs <specJsonPath> <outMp4Path>  |  --deploy-site');
    process.exit(2);
  }
  await render(args[0], args[1]);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('[render] failed:', err?.message || err);
  process.exit(err?.exitCode || 1);
});
