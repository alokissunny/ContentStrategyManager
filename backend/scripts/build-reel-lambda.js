#!/usr/bin/env node
/**
 * Builds the AWS Lambda reel worker package (backend/aws/REEL_WORKER_LAMBDA.md) as a zip, on any
 * machine (no Docker): the backend's production dependencies installed for Linux arm64 (sharp's
 * linux binary, ffmpeg-static's linux binary) + the slice of remotion/ the render step needs
 * (render-lambda.mjs with @remotion/lambda-client — no bundler, no Chrome).
 *
 *   node scripts/build-reel-lambda.js            → .lambda-build/reel-worker.zip
 *   REEL_LAMBDA_ARCH=x64 node scripts/…          (x86_64 functions)
 *
 * Lambda limits: 250 MB unzipped. The script prints the size and fails above it.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.lambda-build');
const PKG = path.join(OUT, 'reel-worker');
const ZIP = path.join(OUT, 'reel-worker.zip');
const ARCH = process.env.REEL_LAMBDA_ARCH === 'x64' ? 'x64' : 'arm64';
const LIMIT_MB = 250;

const sh = (cmd, cwd, env = {}) => execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
const copy = (from, to) => fs.cpSync(path.join(ROOT, from), path.join(PKG, to || from), { recursive: true });
const sizeMb = (dir) => Number(execSync(`du -sk "${dir}"`).toString().split(/\s+/)[0]) / 1024;

fs.rmSync(PKG, { recursive: true, force: true });
fs.rmSync(ZIP, { force: true });
fs.mkdirSync(PKG, { recursive: true });

// 1. the backend: code, prompts, dependencies for Linux
copy('src');
copy('prompts');
copy('package.json');
copy('package-lock.json');
copy('scripts/setup-remotion.js'); // the postinstall hook (skipped below)
const linux = {
  npm_config_platform: 'linux', npm_config_arch: ARCH, npm_config_os: 'linux', npm_config_cpu: ARCH, npm_config_libc: 'glibc',
  SKIP_REMOTION_SETUP: '1', // no Chrome / bundle: the render runs on Remotion Lambda
};
console.log(`[build] backend dependencies (linux-${ARCH})…`);
sh('npm ci --omit=dev --no-audit --no-fund --loglevel=error', PKG, linux);
// test-only and dev-machine packages that the production tree still pulls in
for (const junk of ['mongodb-memory-server', 'mongodb-memory-server-core', 'nodemon', '@img/sharp-darwin-arm64', '@img/sharp-libvips-darwin-arm64']) {
  fs.rmSync(path.join(PKG, 'node_modules', junk), { recursive: true, force: true });
}

// 2. the render step: remotion/render-lambda.mjs + render-shared.mjs + @remotion/lambda-client
const RPKG = path.join(PKG, 'remotion');
fs.mkdirSync(RPKG, { recursive: true });
for (const f of ['render-lambda.mjs', 'render-shared.mjs']) fs.copyFileSync(path.join(ROOT, 'remotion', f), path.join(RPKG, f));
const lambdaClient = require(path.join(ROOT, 'remotion', 'package.json')).dependencies['@remotion/lambda'];
fs.writeFileSync(path.join(RPKG, 'package.json'), JSON.stringify({
  name: 'reel-render-lambda-client', private: true,
  dependencies: { '@remotion/lambda-client': lambdaClient.replace(/^[\^~]/, '') },
}, null, 2));
console.log('[build] @remotion/lambda-client…');
sh('npm install --omit=dev --no-audit --no-fund --loglevel=error --no-package-lock', RPKG, linux);

// 3. checks: the linux binaries are the ones in the package
const ffmpeg = path.join(PKG, 'node_modules', 'ffmpeg-static', 'ffmpeg');
const fileOut = execSync(`file "${ffmpeg}"`).toString();
if (!/ELF/.test(fileOut)) throw new Error(`ffmpeg-static is not a Linux binary: ${fileOut}`);
if (!fs.existsSync(path.join(PKG, 'node_modules', '@img', `sharp-linux-${ARCH}`))) throw new Error(`sharp-linux-${ARCH} missing`);

const mb = sizeMb(PKG);
console.log(`[build] unzipped ${mb.toFixed(0)} MB (Lambda limit ${LIMIT_MB} MB)`);
if (mb > LIMIT_MB) throw new Error('package too big for a zip Lambda — see REEL_WORKER_LAMBDA.md (container image)');

// 4. zip (symlinks kept as links; -X drops Mac metadata)
sh(`zip -qr -X -y "${ZIP}" .`, PKG);
console.log(`[build] ${path.relative(ROOT, ZIP)} · ${(fs.statSync(ZIP).size / 1048576).toFixed(1)} MB`);
