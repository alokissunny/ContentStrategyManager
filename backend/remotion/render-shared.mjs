/**
 * Shared by render.mjs (local Chrome) and render-lambda.mjs (Remotion Lambda):
 * the hashed webpack bundle and the ffmpeg grain pass for motion reels.
 */
import { bundle } from '@remotion/bundler';
import { readFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// the same ffmpeg the backend uses (FFMPEG_PATH, else the ffmpeg-static package, else the PATH one)
export function ffmpegBin() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { return createRequire(import.meta.url)('ffmpeg-static') || 'ffmpeg'; } catch { return 'ffmpeg'; }
}

// temporal luma grain, light (the page used to draw it at ~9 % multiply); audio copied untouched
export function addGrain(src, dst, crf) {
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

// Webpack-bundling the compositions costs ~10 s per render. The bundle only
// changes when src/ or the dependencies do, so it is kept on disk keyed by a
// hash of those files and reused.
export async function cachedBundle() {
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

