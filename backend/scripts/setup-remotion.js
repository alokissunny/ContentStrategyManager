#!/usr/bin/env node
/**
 * Installs the Remotion renderer workspace (backend/remotion) — its own
 * node_modules and Remotion's headless Chrome — so capture reels and video
 * covers can render on this machine. Runs as the backend's `postinstall`, so a
 * plain `npm install` in backend/ (Render's build command) sets it up.
 *
 * Never fails the build: the API must deploy even if the renderer can't be
 * installed. Reels then fail with a clear "rendering is not set up" message.
 *
 *   SKIP_REMOTION_SETUP=1   skip (e.g. a service that never renders video)
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const dir = path.join(__dirname, '..', 'remotion');

function log(msg) {
  console.log(`[setup-remotion] ${msg}`);
}

if (['1', 'true', 'yes'].includes(String(process.env.SKIP_REMOTION_SETUP || '').toLowerCase())) {
  log('skipped (SKIP_REMOTION_SETUP)');
  process.exit(0);
}
if (!fs.existsSync(path.join(dir, 'package.json'))) {
  log('no remotion workspace — nothing to do');
  process.exit(0);
}

try {
  log('installing renderer dependencies…');
  execSync('npm install --no-audit --no-fund --loglevel=error', { cwd: dir, stdio: 'inherit', env: { ...process.env, npm_config_production: 'false' } });
  log('downloading headless Chrome (if missing)…');
  execSync(
    'node -e "require(\'@remotion/renderer\').ensureBrowser().then(() => console.log(\'[setup-remotion] browser ready\'))"',
    { cwd: dir, stdio: 'inherit' },
  );
  log('renderer ready');
} catch (err) {
  console.error('[setup-remotion] WARNING: the video renderer could not be installed — capture reels and video covers will not render on this server.');
  console.error(`[setup-remotion] ${err.message}`);
}
process.exit(0);
