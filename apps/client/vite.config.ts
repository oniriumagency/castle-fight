import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    // `pnpm dev:server` (wrangler) listens on 8787.
    proxy: {
      '/api': { target: 'http://localhost:8787', ws: true },
    },
  },
  build: {
    target: 'es2022',
  },
});
