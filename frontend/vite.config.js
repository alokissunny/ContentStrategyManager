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
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5002',
    },
  },
}));
