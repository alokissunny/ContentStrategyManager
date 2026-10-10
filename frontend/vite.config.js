import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import localize from './build/localize.cjs';

export default defineConfig({
  plugins: [react({ babel: { plugins: [[localize, {}]] } })],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5002',
    },
  },
});
