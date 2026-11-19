import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  // Split, but never so that a click waits (see "Loading in pieces" in CLAUDE.md):
  //   - three.js and satellite.js in files of their own: they change far less often than the
  //     app, so after a deploy a returning visitor downloads only the app's own code again;
  //   - the optional features (src/features/), fetched in parallel straight after start-up by
  //     main.ts (dynamic imports) and installed the moment they arrive;
  //   - a few on-click pieces (the QR code, the contact timeline) fetched in idle moments.
  //
  // cssTarget: stylesheets write `backdrop-filter` only; naming real browsers here makes the
  // minifier add `-webkit-backdrop-filter` for Safari before 18. The two used to be written side
  // by side, unprefixed first, and the minifier then kept ONLY the prefixed one: Chrome and
  // Firefox, which know only the unprefixed one, drew every frosted panel on the live site
  // without its blur (the dev server does not minify, which hid it). Do not write the prefixed
  // one by hand again. Check a build with: grep -o "[^-]backdrop-filter" dist/assets/*.css | wc -l
  build: {
    target: 'es2022',
    cssTarget: ['chrome111', 'firefox111', 'safari15'],
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three';
          if (id.includes('/node_modules/satellite.js/')) return 'sgp4';
          return undefined;
        },
      },
    },
  },
});
