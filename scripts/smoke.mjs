// A smoke test of the BUILT site in headless Chrome: does it start, and do its main places open
// without an error? `npm run smoke` (after `npm run build`); the deploy runs it on every push,
// so a broken page is never published.
//
// What fails it (exit 1), and only this, so that it is not flaky:
//   - an uncaught exception or unhandled rejection in the page;
//   - a feature module that fails to load or to start ("A feature module failed …");
//   - the tracker not ready within the time limit (its interface never appears);
//   - one of the places below not opening (the path in the top bar does not say where it is).
// Console errors from outside services (Wikipedia, NOAA, NASA, Launch Library, map tiles) are
// printed but not counted: CI has no say over another site's availability.
//
// It serves dist/ itself (`vite preview` on a spare port) and drives Chrome over the DevTools
// protocol like scripts/shots.mjs. Without a GPU (CI) Chrome draws WebGL in software
// (SwiftShader): slower, hence the generous limits.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 4199;
const DEBUG_PORT = 9399;
const APP = `http://localhost:${PORT}`;
const LOAD_LIMIT_MS = 180000;
const CHROME = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((path) => path && existsSync(path));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!existsSync(new URL('../dist/index.html', import.meta.url))) {
  console.error('smoke: dist/ is missing: run `npm run build` first');
  process.exit(1);
}
if (!CHROME) {
  console.error('smoke: Google Chrome was not found (set CHROME=/path/to/chrome)');
  process.exit(1);
}

const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const profile = mkdtempSync(join(tmpdir(), 'apsis-smoke-')); // removed at the end: a run's profile is tens of MB
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-sandbox', '--hide-scrollbars', '--mute-audio', '--window-size=1280,800',
  '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  // SMOKE_SOFTWARE=1 draws in software even where there is a GPU: what CI will do.
  ...(process.env.SMOKE_SOFTWARE ? ['--use-angle=swiftshader'] : []),
  'about:blank',
], { stdio: 'ignore' });

const problems = [];
const noted = [];
let failed = false;
const check = (pass, what, detail = '') => {
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}${detail ? `  — ${detail}` : ''}`);
  if (!pass) failed = true;
};

try {
  for (let i = 0; i < 120; i++) { // the preview server
    try {
      if ((await fetch(APP)).ok) break;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  let target = null;
  for (let i = 0; i < 160 && !target; i++) {
    await sleep(250);
    try {
      target = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find((t) => t.type === 'page');
    } catch { /* Chrome is still starting */ }
  }
  if (!target) throw new Error('Chrome did not start');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const waiting = new Map();
  let nextId = 1;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') {
      const d = message.params.exceptionDetails;
      problems.push(`uncaught: ${(d.exception?.description ?? d.text ?? '').split('\n').slice(0, 3).join(' | ')}`);
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      const text = message.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      if (/feature module failed|could not be worked out|Warming up failed/i.test(text)) problems.push(`console: ${text.slice(0, 300)}`);
      else noted.push(text.slice(0, 160));
    }
    const settle = waiting.get(message.id);
    if (!settle) return;
    waiting.delete(message.id);
    if (message.error) settle.reject(new Error(message.error.message));
    else settle.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const run = async (expression) => (await send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true })).result?.value;
  await send('Page.enable');
  await send('Runtime.enable');

  /** Open the app at a link and wait for the tracker's interface; true if it came. */
  const open = async (hash) => {
    await send('Page.navigate', { url: 'about:blank' });
    await send('Page.navigate', { url: `${APP}/${hash}` });
    const start = Date.now();
    while (Date.now() - start < LOAD_LIMIT_MS) {
      await sleep(1000);
      const ready = await run(`return !!document.getElementById('hud') && !document.getElementById('hud').classList.contains('hud-hidden');`).catch(() => false);
      if (ready) {
        await sleep(4000); // the features install and the first frames run
        return true;
      }
    }
    return false;
  };

  // First visit: no tour, no location question in the way.
  await send('Page.navigate', { url: `${APP}/#smoke` });
  await sleep(1500);
  await run(`try { localStorage.setItem('apsis.tour.seen', '1'); localStorage.setItem('apsis.location.consent', 'no'); } catch {} return 1;`);

  const started = Date.now();
  check(await open('#smoke'), 'the tracker starts', `${Math.round((Date.now() - started) / 1000)} s`);
  check(await run(`return !!document.getElementById('bell') && document.querySelectorAll('.bell-dot').length > 0;`), 'the bell is there');
  check(await run(`return document.querySelectorAll('.layer-tile').length > 20;`), 'the Layers panel is filled');
  check(await run(`document.getElementById('bell').click(); await new Promise((r) => setTimeout(r, 800)); const ok = !document.getElementById('bell-menu').classList.contains('is-hidden'); document.getElementById('bell').click(); return ok;`), 'the bell opens');

  for (const [hash, expect] of [['#place=system', 'Solar system'], ['#place=mars', 'Mars'], ['#craft=roadster', 'Solar system']]) {
    const came = await open(hash);
    await sleep(6000); // the move into the place
    const path = came ? await run(`return document.getElementById('path')?.textContent ?? '';`) : '';
    check(came && path.includes(expect), `${hash} opens`, path.replace(/\s+/g, ' ').trim());
  }
  socket.close();
} catch (error) {
  problems.push(`smoke test itself: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  chrome.kill();
  server.kill();
  await sleep(600);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); // Chrome may still be writing as it exits
  } catch { /* a leftover temporary folder is harmless */ }
}

for (const problem of problems) check(false, problem);
if (noted.length) console.log(`\n(${noted.length} console errors from outside services, not counted; first: ${noted[0]})`);
console.log(failed ? '\nSmoke test FAILED.' : '\nSmoke test passed.');
process.exit(failed ? 1 : 0);
