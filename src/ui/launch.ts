/**
 * The loading screen's launch scene: a two-stage rocket lifting off its pad while the
 * catalogue loads.
 *
 * How it moves: #loading carries a number --p (0 → 1, the load progress). launch.css
 * registers --p as an animatable property and derives everything from it — the "camera"
 * follows the vehicle, so the rocket stays near the same place on screen while the pad,
 * the tower and the horizon fall away and three layers of stars drift past at different
 * rates. When loading finishes (#loading.is-liftoff) the camera lets go and the vehicle
 * accelerates out of frame.
 *
 * The only per-frame JavaScript is the small telemetry readout, and it stops as soon as
 * the loading screen is done.
 */

import './launch.css';
import { fmtKm, fmtKmS } from './dom.ts';

/** The vehicle, drawn 52 × 548 units (the body is 38 wide: about 1 : 14). Nose up. */
const ROCKET = /* svg */ `
<svg viewBox="0 0 52 548" aria-hidden="true">
  <defs>
    <linearGradient id="lx-hull" gradientUnits="userSpaceOnUse" x1="7" x2="45" y1="0" y2="0">
      <stop offset="0" stop-color="#6b7990" /><stop offset="0.16" stop-color="#c7d1dd" />
      <stop offset="0.4" stop-color="#ffffff" /><stop offset="0.62" stop-color="#e4eaf2" />
      <stop offset="0.86" stop-color="#97a4b8" /><stop offset="1" stop-color="#566278" />
    </linearGradient>
    <linearGradient id="lx-dark" gradientUnits="userSpaceOnUse" x1="10" x2="42" y1="0" y2="0">
      <stop offset="0" stop-color="#0a0f18" /><stop offset="0.36" stop-color="#2c3648" />
      <stop offset="0.62" stop-color="#19212f" /><stop offset="1" stop-color="#070a11" />
    </linearGradient>
    <linearGradient id="lx-heat" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="430" y2="532">
      <stop offset="0" stop-color="#ffb060" stop-opacity="0" /><stop offset="1" stop-color="#ffb060" stop-opacity="0.4" />
    </linearGradient>
  </defs>

  <!-- payload fairing -->
  <path d="M26 2C32.5 16 45 44 45 76V120L40 134H12L7 120V76C7 44 19.5 16 26 2Z" fill="url(#lx-hull)" />
  <g fill="none" stroke="#3c4b62" stroke-width="0.6" vector-effect="non-scaling-stroke" opacity="0.4">
    <path d="M26 7V133M7.3 98H44.7" />
  </g>
  <!-- the Apsis mark -->
  <g transform="translate(26 62) rotate(-30) scale(0.6)">
    <path d="M11.5 0a11.5 7 0 1 1-3.4-4.95" fill="none" stroke="#24324a" stroke-width="2" stroke-linecap="round" />
    <circle cx="-3.6" r="3.3" fill="#24324a" /><circle cx="10.7" cy="-2.7" r="2.2" fill="#35c3ee" />
  </g>

  <!-- second stage, interstage band -->
  <rect x="12" y="134" width="28" height="62" fill="url(#lx-hull)" />
  <rect x="12" y="196" width="28" height="32" fill="url(#lx-dark)" />

  <!-- first stage -->
  <rect x="12" y="228" width="28" height="292" fill="url(#lx-hull)" />
  <g fill="none" stroke="#3c4b62" stroke-width="0.6" vector-effect="non-scaling-stroke" opacity="0.3">
    <path d="M12 162H40M12 292H40M12 356H40M12 420H40M12 484H40" />
  </g>
  <rect x="34.2" y="232" width="1.3" height="282" fill="#28344a" opacity="0.35" />
  <rect x="22.3" y="136" width="1.1" height="384" fill="#ffffff" opacity="0.6" />

  <!-- grid fins, folded flat for the climb -->
  <rect x="9.6" y="236" width="2.4" height="20" rx="0.6" fill="#1a2230" />
  <rect x="40" y="236" width="2.4" height="20" rx="0.6" fill="#1a2230" />
  <rect x="20.5" y="236" width="11" height="18" rx="0.8" fill="#222c3c" />
  <path d="M23.25 236V254M26 236V254M28.75 236V254M20.5 240.5H31.5M20.5 245H31.5M20.5 249.5H31.5" fill="none" stroke="#8fa3c2" stroke-width="0.5" vector-effect="non-scaling-stroke" opacity="0.4" />

  <!-- landing legs, stowed along the tank -->
  <path d="M12 438L9.2 516Q9 520 12 520Z" fill="#1a2230" />
  <path d="M40 438L42.8 516Q43 520 40 520Z" fill="#1a2230" />
  <path d="M26 436L22.2 518H29.8Z" fill="#202a3a" />
  <path d="M26 441V516" fill="none" stroke="#9db0cc" stroke-width="0.5" vector-effect="non-scaling-stroke" opacity="0.3" />

  <!-- warm light from the engines, then the engine section and three of its nine bells -->
  <rect x="12" y="430" width="28" height="90" fill="url(#lx-heat)" />
  <path d="M11.4 520H40.6L41.4 532H10.6Z" fill="url(#lx-dark)" />
  <g fill="#262f3f">
    <path d="M14.2 532h5.6l1.6 12h-8.8z" /><path d="M23.2 532h5.6l1.6 12h-8.8z" /><path d="M32.2 532h5.6l1.6 12h-8.8z" />
  </g>
  <g fill="#ffe2b0">
    <ellipse cx="17" cy="544" rx="4.2" ry="1" /><ellipse cx="26" cy="544" rx="4.2" ry="1" /><ellipse cx="35" cy="544" rx="4.2" ry="1" />
  </g>
</svg>`;

/** The service tower: two rails, cross-bracing every level, a mast, and three arms reaching for the vehicle. */
function towerSvg(): string {
  const d: string[] = ['M8 320V20', 'M24 320V20', 'M8 20H24', 'M16 20V3'];
  for (let y = 20, level = 0; y < 320; y += 30, level++) {
    d.push(`M8 ${y}H24`, level % 2 ? `M8 ${y}L24 ${y + 30}` : `M24 ${y}L8 ${y + 30}`);
  }
  d.push('M24 74H39', 'M24 82L34 74', 'M24 164H37', 'M24 172L33 164', 'M24 254H36');
  return `<svg viewBox="0 0 40 320" aria-hidden="true"><path d="${d.join('')}" fill="none" stroke="#4a5b74" stroke-width="1" vector-effect="non-scaling-stroke" stroke-linecap="round" /></svg>`;
}

/** Small deterministic random-number generator, so the sky is the same on every load. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One layer of stars as a stack of tiny radial gradients (a single element, no images). */
function starField(count: number, seed: number, radius: number, brightness: number): string {
  const random = seeded(seed);
  const stars: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = (random() * 100).toFixed(2), y = (random() * 100).toFixed(2);
    const r = radius * (0.7 + random() * 0.6);
    const alpha = (brightness * (0.45 + random() * 0.55)).toFixed(2);
    const tint = random() < 0.2 ? '190, 214, 255' : random() < 0.12 ? '255, 232, 205' : '255, 255, 255';
    stars.push(`radial-gradient(circle at ${x}% ${y}%, rgba(${tint}, ${alpha}) 0, rgba(${tint}, ${alpha}) ${r.toFixed(2)}px, rgba(${tint}, 0) ${(r + 0.7).toFixed(2)}px)`);
  }
  return stars.join(', ');
}

/** Exhaust clouds rolling away from the pad: each drifts its own way at its own pace. */
function smoke(count: number, seed: number, reach: number, strength: number): string {
  const random = seeded(seed);
  let html = '';
  for (let i = 0; i < count; i++) {
    const side = i % 2 ? 1 : -1;
    const dx = (side * (reach * (0.45 + random() * 0.55))).toFixed(1);
    const dy = (-(0.5 + random() * 3)).toFixed(1);
    const scale = (1.9 + random() * 1.3).toFixed(2);
    const duration = (3.1 + random() * 2.2).toFixed(2);
    const delay = (-random() * 5).toFixed(2); // negative: already billowing when the page appears
    html += `<i class="lx-smoke" style="--lx-dx:${dx}vw;--lx-dy:${dy}vh;--lx-s:${scale};--lx-a:${(strength * (0.7 + random() * 0.3)).toFixed(2)};animation-duration:${duration}s;animation-delay:${delay}s"></i>`;
  }
  return html;
}

/** Build the launch scene inside `container` (replaces its children). Call once at start-up. */
export function mountLaunch(container: HTMLElement): void {
  const root = document.createElement('div');
  root.className = 'lx-root';
  root.innerHTML = `
    <div class="lx-sky"></div>
    <div class="lx-stars lx-s1"></div>
    <div class="lx-stars lx-s2"></div>
    <div class="lx-stars lx-s3"></div>

    <div class="lx-plume-wrap">
      <div class="lx-plume">
        <i class="lx-sheath"></i>
        <i class="lx-core"></i>
        <i class="lx-boost"></i>
        <i class="lx-blue"></i>
        <i class="lx-bead lx-b1"></i><i class="lx-bead lx-b2"></i><i class="lx-bead lx-b3"></i><i class="lx-bead lx-b4"></i>
      </div>
    </div>

    <div class="lx-ground">
      <div class="lx-horizon"></div>
      <div class="lx-earth"></div>
      <div class="lx-mast"></div>
      <div class="lx-tower">${towerSvg()}<i class="lx-beacon"></i></div>
      <div class="lx-bloom"></div>
      ${smoke(6, 11, 17, 0.5)}
      <div class="lx-pad"></div>
    </div>

    <div class="lx-vehicle">${ROCKET}<div class="lx-vent"><i></i></div></div>

    <div class="lx-ground lx-front">${smoke(3, 29, 11, 0.34)}</div>

    <dl class="lx-telemetry">
      <div><dt>Mission clock</dt><dd data-lx="clock">T+ 0:00</dd></div>
      <div><dt>Altitude</dt><dd data-lx="altitude">${fmtKm(0, 1)}</dd></div>
      <div><dt>Speed</dt><dd data-lx="speed">${fmtKmS(0)}</dd></div>
    </dl>`;
  root.querySelector<HTMLElement>('.lx-s1')!.style.backgroundImage = starField(34, 2710, 0.55, 0.6);
  root.querySelector<HTMLElement>('.lx-s2')!.style.backgroundImage = starField(22, 1957, 0.8, 0.8);
  root.querySelector<HTMLElement>('.lx-s3')!.style.backgroundImage = starField(11, 1969, 1.15, 0.95);
  container.replaceChildren(root);

  // ---- telemetry: numbers that follow the same --p the picture follows
  const loading = container.closest<HTMLElement>('#loading') ?? container;
  const clock = root.querySelector<HTMLElement>('[data-lx="clock"]')!;
  const altitude = root.querySelector<HTMLElement>('[data-lx="altitude"]')!;
  const speed = root.querySelector<HTMLElement>('[data-lx="speed"]')!;
  const started = performance.now();
  let lastRead = -Infinity;
  const write = (el: HTMLElement, text: string) => {
    if (el.textContent !== text) el.textContent = text;
  };
  const tick = (now: number) => {
    if (loading.classList.contains('is-done') || !root.isConnected) return; // the loading screen has gone: stop
    requestAnimationFrame(tick);
    if (loading.classList.contains('is-aside')) return; // set aside behind the home page: nobody is reading
    if (now - lastRead < 50) return; // 20 readings a second is plenty
    lastRead = now;
    const p = Math.min(1, Math.max(0, parseFloat(getComputedStyle(loading).getPropertyValue('--p')) || 0));
    const seconds = Math.floor((now - started) / 1000);
    const km = 200 * Math.pow(p, 1.7); // slow off the pad, then quickly up to orbit height
    write(clock, `T+ ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
    write(altitude, fmtKm(km, km < 100 ? 1 : 0));
    write(speed, fmtKmS(7.8 * Math.pow(p, 1.15)));
  };
  requestAnimationFrame(tick);
}
