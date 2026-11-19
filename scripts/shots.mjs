/**
 * Product pictures for the home page: `npm run shots`.
 *
 * The home page shows the tracker itself — real screens, not drawings. This script takes
 * those pictures, so they can be retaken whenever the interface changes: it starts a headless
 * Chrome, opens the running app at a few share links, presses a few buttons, and saves each
 * screen as a WebP file in public/shots/.
 *
 * Needs: Google Chrome installed, and the app being served (`npm run dev`, or pass another
 * address: `npm run shots -- --url http://localhost:4173`). No npm packages: Chrome is driven
 * over its DevTools protocol through the WebSocket that Node has built in.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gstime } from 'satellite.js';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const APP = arg('url', 'http://localhost:5173').replace(/\/$/, '');
const ONLY = arg('only', '');
const OUT = new URL('../public/shots/', import.meta.url).pathname;
const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((path) => existsSync(path));
const PORT = 9377;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A camera position (the app's `#cam=x,y,z`, thousands of km in its inertial scene frame)
 * that looks straight down on a place in daylight right now. The Earth turns under that
 * frame, so the place's longitude has to be turned by the sidereal angle first.
 */
function daylitGround(altitudeKm) {
  const now = new Date();
  const sunLon = -15 * (now.getUTCHours() + now.getUTCMinutes() / 60 - 12); // where it is noon
  // Places that look good from above, spread round the world: [latitude, longitude].
  const places = [[-20.5, 119], [26.5, 31.5], [27.5, -113], [-46, -71], [22, 51], [41, 14.5], [25, -78], [29.5, 84], [-23, 15.5], [36, 139], [19.5, -156]];
  const off = (lon) => Math.abs(((lon - sunLon + 540) % 360) - 180);
  const [lat, lon] = places.reduce((best, place) => (off(place[1]) < off(best[1]) ? place : best));
  const phi = (lat * Math.PI) / 180, lambda = (lon * Math.PI) / 180 + gstime(now);
  const r = 6.371 + altitudeKm / 1000;
  const eci = [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
  return [eci[0] * r, eci[2] * r, -eci[1] * r].map((v) => v.toFixed(3)).join(','); // inertial (x, y, z) → scene (x, z, −y)
}

// Tidy the screen: no tour, no location question.
const CLEAN = `
  [...document.querySelectorAll('button')].find((b) => /skip/i.test(b.textContent) && b.getBoundingClientRect().width > 0)?.click();
  document.getElementById('loc-ask')?.remove();
`;

/** Each picture: where to open the app, the screen size, what to press, how long to let it settle. */
const SHOTS = [
  { name: 'sky', hash: '#cam=9.5,7.5,17', size: [1440, 900, 1.5], settle: 9000 },
  { name: 'object', hash: '#sat=25544', size: [1440, 900, 1.5], settle: 11000 },
  {
    name: 'approach', hash: '#cam=10,8,18', size: [1440, 900, 1.5], settle: 4500,
    setup: `
      document.getElementById('conj-toggle').click();
      document.getElementById('layer-grid').click();
      await new Promise((r) => setTimeout(r, 4500));
      const rows = [...document.querySelectorAll('#pair-list li')];
      const speed = (row) => parseFloat((row.querySelector('small')?.textContent || '').replace(/[^0-9.]/g, '')) || 99;
      (rows.sort((a, b) => speed(a) - speed(b))[0])?.click(); // the slowest crossing stays in view longest
      document.querySelector('[data-panel=conj]')?.click();
    `,
  },
  {
    name: 'ground', hash: () => `#cam=${daylitGround(650)}`, size: [1440, 900, 1.5], settle: 12000,
    // Left alone, the view drifts slowly round the planet; held still, it stays over the chosen place.
    setup: `const drift = document.querySelector('input[data-setting=earthDrift]'); if (drift?.checked) drift.click();`,
  },
  // Beyond Earth orbit: a share link opens straight at a place (ui/places.ts), so no clicking is needed.
  { name: 'system', hash: '#place=system', size: [1440, 900, 1.5], settle: 9000 },
  { name: 'world', hash: '#place=mars', size: [1440, 900, 1.5], settle: 12000 },
  { name: 'phone', hash: '#sat=20580', size: [390, 844, 3, true], settle: 11000 },
];

if (!CHROME) {
  console.error('Google Chrome was not found: install it, or edit the CHROME list in scripts/shots.mjs.');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'apsis-shots-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars',
  '--mute-audio', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' });

try {
  // Find the page Chrome opened and attach to it.
  let target = null;
  for (let tries = 0; tries < 160 && !target; tries++) { // up to 40 s: a busy machine starts Chrome slowly
    await sleep(250);
    try {
      target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page');
    } catch { /* Chrome is still starting */ }
  }
  if (!target) throw new Error('Chrome did not start');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  // Replies are matched to requests by id: a Map from id to the promise waiting for it.
  const waiting = new Map();
  let nextId = 1;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
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
  for (const shot of SHOTS) {
    if (ONLY && shot.name !== ONLY) continue;
    const [width, height, scale, mobile = false] = shot.size;
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
    if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true });
    else await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    const hash = typeof shot.hash === 'function' ? shot.hash() : shot.hash;
    await send('Page.navigate', { url: 'about:blank' }); // a hash-only change would not reload the app
    await send('Page.navigate', { url: `${APP}/?shot=${shot.name}${hash}` });
    // Wait for the tracker to finish loading (its interface appears).
    for (let tries = 0; tries < 120; tries++) {
      await sleep(500);
      // (The address is part of the test: straight after `navigate` the previous page can still answer.)
      const ready = await run(`return location.search.includes('shot=${shot.name}') && !!document.getElementById('hud') && !document.getElementById('hud').classList.contains('hud-hidden');`).catch(() => false);
      if (ready) break;
    }
    await run(CLEAN);
    if (shot.setup) await run(shot.setup);
    await sleep(shot.settle);
    await run(CLEAN);
    const { data } = await send('Page.captureScreenshot', { format: 'webp', quality: 80 });
    writeFileSync(join(OUT, `${shot.name}.webp`), Buffer.from(data, 'base64'));
    console.log(`saved public/shots/${shot.name}.webp  (${Math.round(Buffer.from(data, 'base64').length / 1024)} KB)`);
  }
  socket.close();
} finally {
  chrome.kill();
  await sleep(600);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); // Chrome may still be writing as it exits
  } catch { /* a leftover temporary folder is harmless */ }
}
