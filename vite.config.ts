import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  // One bundle on purpose (no code splitting: the site is a handful of static files). The limit is only
  // where Vite starts to warn; it was passed when the models of craft beyond Earth orbit were added.
  //
  // cssTarget: stylesheets write `backdrop-filter` only; naming real browsers here makes the
  // minifier add `-webkit-backdrop-filter` for Safari before 18. The two used to be written side
  // by side, unprefixed first, and the minifier then kept ONLY the prefixed one: Chrome and
  // Firefox, which know only the unprefixed one, drew every frosted panel on the live site
  // without its blur (the dev server does not minify, which hid it). Do not write the prefixed
  // one by hand again. Check a build with: grep -o "[^-]backdrop-filter" dist/assets/*.css | wc -l
  build: { target: 'es2022', cssTarget: ['chrome111', 'firefox111', 'safari15'], chunkSizeWarningLimit: 1400 },
});
