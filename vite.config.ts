import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  // One bundle on purpose (no code splitting: the site is a handful of static files). The limit is only
  // where Vite starts to warn; it was passed when the models of craft beyond Earth orbit were added.
  build: { target: 'es2022', chunkSizeWarningLimit: 1400 },
});
