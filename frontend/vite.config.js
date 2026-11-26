import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import localize from './build/localize.cjs';

// `--mode mobile` builds the Capacitor app bundle: its own outDir, icons
// bundled instead of the unpkg lucide script, and edge-to-edge viewport so the
// existing env(safe-area-inset-*) padding takes effect.
function nativeShellHtml() {
  return {
    name: 'native-shell-html',
    transformIndexHtml(html) {
      return html
        .replace(/\s*<script src="https:\/\/unpkg\.com\/lucide[^"]*"><\/script>/, '')
        .replace('width=device-width, initial-scale=1.0', 'width=device-width, initial-scale=1.0, viewport-fit=cover');
    },
  };
}

// The reel composition (backend/remotion/src, via @reel) imports its media
// components from './media' — Remotion's classic ones on the server. In this
// app they are @remotion/media's (src/lib/reelWebMedia.js), which the Player
// and the in-browser renderer (@remotion/web-renderer) need. Its sound effects
// (staticFile('sfx/…')) live in the renderer's public/: served at /sfx/ in dev
// and copied into the build.
function reelWebMedia() {
  const target = fileURLToPath(new URL('./src/lib/reelWebMedia.js', import.meta.url));
  const sfxDir = fileURLToPath(new URL('../backend/remotion/public/sfx', import.meta.url));
  return {
    name: 'reel-web-media',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === './media' && importer && importer.includes('/backend/remotion/src/')) return target;
      return null;
    },
    configureServer(server) {
      server.middlewares.use('/sfx', async (req, res, next) => {
        const { createReadStream, existsSync } = await import('node:fs');
        const file = `${sfxDir}/${decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '').replace(/\.\./g, '')}`;
        if (!existsSync(file)) return next();
        res.setHeader('Content-Type', file.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg');
        createReadStream(file).pipe(res);
        return undefined;
      });
    },
    async generateBundle() {
      const { readdirSync, readFileSync, existsSync } = await import('node:fs');
      if (!existsSync(sfxDir)) return;
      for (const f of readdirSync(sfxDir)) {
        this.emitFile({ type: 'asset', fileName: `sfx/${f}`, source: readFileSync(`${sfxDir}/${f}`) });
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react({ babel: { plugins: [[localize, {}]] } }),
    mode === 'mobile' && nativeShellHtml(),
    reelWebMedia(),
  ].filter(Boolean),
  build: mode === 'mobile' ? { outDir: 'dist-mobile' } : undefined,
  // The reel preview plays the SAME Remotion composition the server renders
  // (backend/remotion/src, imported via @reel). Those files sit outside this
  // package, so their react / remotion imports are pinned to ours (one React).
  resolve: {
    alias: { '@reel': fileURLToPath(new URL('../backend/remotion/src', import.meta.url)) },
    dedupe: ['react', 'react-dom', 'remotion', '@remotion/google-fonts', '@remotion/player', '@remotion/web-renderer', '@remotion/media'],
  },
  // prebundled at startup, so the dev server never re-optimises mid-session
  // (that briefly loads two copies of React → "Invalid hook call")
  optimizeDeps: { include: ['remotion', '@remotion/player', '@remotion/web-renderer', '@remotion/media'] },
  server: {
    fs: { allow: ['..'] },
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5002',
      // dev only: CloudFront media as same-origin for the in-browser reel
      // render (lib/browserReelRender.js) — until the distribution sends CORS
      // headers (backend/aws/CLOUDFRONT_CDN.md › CORS)
      '/__cdn': {
        target: 'https://d35l1g85oy1mmk.cloudfront.net',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/__cdn/, ''),
      },
    },
  },
}));
