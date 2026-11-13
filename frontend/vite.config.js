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

export default defineConfig(({ mode }) => ({
  plugins: [
    react({ babel: { plugins: [[localize, {}]] } }),
    mode === 'mobile' && nativeShellHtml(),
  ].filter(Boolean),
  build: mode === 'mobile' ? { outDir: 'dist-mobile' } : undefined,
  // The reel preview plays the SAME Remotion composition the server renders
  // (backend/remotion/src, imported via @reel). Those files sit outside this
  // package, so their react / remotion imports are pinned to ours (one React).
  resolve: {
    alias: { '@reel': fileURLToPath(new URL('../backend/remotion/src', import.meta.url)) },
    dedupe: ['react', 'react-dom', 'remotion', '@remotion/google-fonts', '@remotion/player'],
  },
  // prebundled at startup, so the dev server never re-optimises mid-session
  // (that briefly loads two copies of React → "Invalid hook call")
  optimizeDeps: { include: ['remotion', '@remotion/player'] },
  server: {
    fs: { allow: ['..'] },
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5002',
    },
  },
}));
