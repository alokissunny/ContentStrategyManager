/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5190,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    // Unit tests exercise the repository's behaviour, not the network — run
    // them against the in-memory mock dataset. API wiring is covered by the
    // backend's own tests and end-to-end checks.
    env: { VITE_USE_MOCKS: 'true' },
  },
})
