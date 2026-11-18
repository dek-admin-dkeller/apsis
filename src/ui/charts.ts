/**
 * Small hand-drawn canvas charts for the inspector and the encounter panel. No chart
 * library: each function clears the canvas and draws one picture from plain arrays.
 */

import { type Look, type Observer, type OrbitSeries, wrapLon } from '../data/ephemeris.ts';

const CYAN = '#7fe3ff';
const AMBER = '#ffb454';
const RED = '#ff4d5e';
const GRID = 'rgba(150, 185, 230, 0.12)';
const MUTED = '#8296ae';
const TEXT = '#dce8f6';
const MONO = '11px "JetBrains Mono Variable", ui-monospace, monospace';

/** Size the canvas buffer to its CSS box (sharp on Retina) and return a context in CSS pixels. */
function prepare(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (w === 0 || h === 0) return null; // hidden tab
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

export interface LineChartOptions {
  values: ArrayLike<number>;
  color?: string;
  /** Position of the "now" cursor along the x axis, 0 … 1 (omit for none). */
  cursor?: number;
  /** Force the y range; otherwise it fits the data with a little headroom. */
  min?: number;
  max?: number;
  format: (value: number) => string;
  /** Horizontal reference line, e.g. the alert distance. */
  threshold?: { value: number; label: string };
  xLabels?: [string, string] | [string, string, string];
  /** Shade the stretches where this is 0 (e.g. in the Earth's shadow). */
  lit?: Uint8Array;
}

export function drawLineChart(canvas: HTMLCanvasElement, o: LineChartOptions): void {
  const p = prepare(canvas);
  if (!p) return;
  const { ctx, w, h } = p;
  const n = o.values.length;
  const left = 4, right = w - 4, top = 14, bottom = h - (o.xLabels ? 16 : 5);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = o.values[i];
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) return;
  const pad = Math.max((hi - lo) * 0.12, Math.abs(hi) * 0.0005, 1e-6);
  lo = o.min ?? lo - pad;
  hi = o.max ?? hi + pad;
  const x = (i: number) => left + ((right - left) * i) / (n - 1);
  const y = (v: number) => bottom - ((bottom - top) * (v - lo)) / (hi - lo);

  // shadow bands
  if (o.lit) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
    for (let i = 0; i < n - 1; i++) if (!o.lit[i]) ctx.fillRect(x(i), top, x(i + 1) - x(i) + 0.5, bottom - top);
  }
  // grid: three horizontal lines
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = 0; k <= 2; k++) {
    const gy = Math.round(top + ((bottom - top) * k) / 2) + 0.5;
    ctx.moveTo(left, gy);
    ctx.lineTo(right, gy);
  }
  ctx.stroke();

  if (o.threshold && o.threshold.value > lo && o.threshold.value < hi) {
    const ty = Math.round(y(o.threshold.value)) + 0.5;
    ctx.strokeStyle = 'rgba(255, 77, 94, 0.6)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(left, ty);
    ctx.lineTo(right, ty);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = RED;
    ctx.font = MONO;
    ctx.textAlign = 'right';
    ctx.fillText(o.threshold.label, right, ty - 4);
  }

  // the curve, with a soft fill underneath
  const color = o.color ?? CYAN;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < n; i++) {
    const v = o.values[i];
    if (!Number.isFinite(v)) continue;
    if (started) ctx.lineTo(x(i), y(v));
    else ctx.moveTo(x(i), y(v));
    started = true;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.lineTo(right, bottom);
  ctx.lineTo(left, bottom);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, top, 0, bottom);
  fill.addColorStop(0, color + '38');
  fill.addColorStop(1, color + '00');
  ctx.fillStyle = fill;
  ctx.fill();

  // y range labels
  ctx.font = MONO;
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'left';
  ctx.fillText(o.format(hi), left + 2, top - 3);
  if (o.xLabels) {
    ctx.fillText(o.xLabels[0], left, h - 3);
    ctx.textAlign = 'right';
    ctx.fillText(o.xLabels[o.xLabels.length - 1], right, h - 3);
    if (o.xLabels.length === 3) {
      ctx.textAlign = 'center';
      ctx.fillText(o.xLabels[1], (left + right) / 2, h - 3);
    }
  }

  // cursor
  if (o.cursor !== undefined && o.cursor >= 0 && o.cursor <= 1) {
    const cx = left + (right - left) * o.cursor;
    const at = o.cursor * (n - 1);
    const i0 = Math.floor(at), i1 = Math.min(n - 1, i0 + 1);
    const v = o.values[i0] + (o.values[i1] - o.values[i0]) * (at - i0);
    ctx.strokeStyle = 'rgba(220, 232, 246, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(cx) + 0.5, top);
    ctx.lineTo(Math.round(cx) + 0.5, bottom);
    ctx.stroke();
    if (Number.isFinite(v)) {
      ctx.fillStyle = TEXT;
      ctx.beginPath();
      ctx.arc(cx, y(v), 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = MONO;
      ctx.textAlign = cx > w * 0.6 ? 'right' : 'left';
      ctx.fillText(o.format(v), cx + (cx > w * 0.6 ? -7 : 7), Math.max(top + 10, y(v) - 7));
    }
  }
}

/** A single strip: bright where the object is in sunlight, dark where it is in the Earth's shadow. */
export function drawSunStrip(canvas: HTMLCanvasElement, lit: Uint8Array, cursor: number): void {
  const p = prepare(canvas);
  if (!p) return;
  const { ctx, w, h } = p;
  const n = lit.length;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = lit[i] ? 'rgba(255, 180, 84, 0.85)' : 'rgba(60, 80, 120, 0.45)';
    ctx.fillRect((w * i) / n, 4, w / n + 0.6, h - 8);
  }
  ctx.fillStyle = TEXT;
  ctx.fillRect(Math.round(w * cursor) - 1, 0, 2, h);
}

/** World map with the ground track, the day/night edge, the object and the ground station. */
export function drawGroundMap(
  canvas: HTMLCanvasElement, image: HTMLImageElement | null, series: OrbitSeries, nowIndex: number,
  sunLatDeg: number, sunLonDeg: number, observer: Observer,
): void {
  const p = prepare(canvas);
  if (!p) return;
  const { ctx, w, h } = p;
  const X = (lon: number) => ((lon + 180) / 360) * w;
  const Y = (lat: number) => ((90 - lat) / 180) * h;
  if (image && image.complete && image.naturalWidth > 0) {
    ctx.globalAlpha = 0.6;
    ctx.drawImage(image, 0, 0, w, h);
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = '#0a1626';
    ctx.fillRect(0, 0, w, h);
  }

  // Night side: for each longitude, the latitude where the Sun sits on the horizon.
  ctx.fillStyle = 'rgba(2, 5, 12, 0.55)';
  ctx.beginPath();
  const tanDec = Math.tan(((Math.abs(sunLatDeg) < 0.2 ? 0.2 * Math.sign(sunLatDeg || 1) : sunLatDeg) * Math.PI) / 180);
  for (let i = 0; i <= 72; i++) {
    const lon = -180 + i * 5;
    const lat = (Math.atan(-Math.cos(((lon - sunLonDeg) * Math.PI) / 180) / tanDec) * 180) / Math.PI;
    if (i === 0) ctx.moveTo(X(lon), Y(lat));
    else ctx.lineTo(X(lon), Y(lat));
  }
  const darkPole = sunLatDeg >= 0 ? h : 0; // the pole that is in polar night
  ctx.lineTo(w, darkPole);
  ctx.lineTo(0, darkPole);
  ctx.closePath();
  ctx.fill();

  // graticule every 30°
  ctx.strokeStyle = 'rgba(150, 185, 230, 0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let lon = -150; lon < 180; lon += 30) {
    ctx.moveTo(Math.round(X(lon)) + 0.5, 0);
    ctx.lineTo(Math.round(X(lon)) + 0.5, h);
  }
  for (let lat = -60; lat < 90; lat += 30) {
    ctx.moveTo(0, Math.round(Y(lat)) + 0.5);
    ctx.lineTo(w, Math.round(Y(lat)) + 0.5);
  }
  ctx.stroke();

  // track: past dim, future bright; break the line where it wraps round the date line
  const stroke = (from: number, to: number, style: string, width: number) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    let pen = false;
    for (let i = from; i <= to; i++) {
      if (!Number.isFinite(series.altKm[i])) continue;
      const jump = i > from && Math.abs(series.lonDeg[i] - series.lonDeg[i - 1]) > 180;
      if (pen && !jump) ctx.lineTo(X(series.lonDeg[i]), Y(series.latDeg[i]));
      else ctx.moveTo(X(series.lonDeg[i]), Y(series.latDeg[i]));
      pen = true;
    }
    ctx.stroke();
  };
  const at = Math.max(0, Math.min(series.count - 1, Math.round(nowIndex)));
  stroke(0, at, 'rgba(255, 180, 84, 0.35)', 1.2);
  stroke(at, series.count - 1, AMBER, 1.6);

  // ground station
  ctx.strokeStyle = TEXT;
  ctx.lineWidth = 1.2;
  const ox = X(wrapLon(observer.lonDeg)), oy = Y(observer.latDeg);
  ctx.beginPath();
  ctx.moveTo(ox - 4, oy);
  ctx.lineTo(ox + 4, oy);
  ctx.moveTo(ox, oy - 4);
  ctx.lineTo(ox, oy + 4);
  ctx.stroke();

  // the object now
  if (Number.isFinite(series.altKm[at])) {
    const sx = X(series.lonDeg[at]), sy = Y(series.latDeg[at]);
    ctx.fillStyle = 'rgba(127, 227, 255, 0.25)';
    ctx.beginPath();
    ctx.arc(sx, sy, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = CYAN;
    ctx.beginPath();
    ctx.arc(sx, sy, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** The orbit ellipse and the Earth drawn to the same scale, seen face-on. */
export function drawOrbitShape(canvas: HTMLCanvasElement, semiMajorKm: number, eccentricity: number, trueAnomalyRad: number): void {
  const p = prepare(canvas);
  if (!p) return;
  const { ctx, w, h } = p;
  const a = semiMajorKm, e = Math.min(0.98, eccentricity);
  const b = a * Math.sqrt(1 - e * e), c = a * e; // Earth sits at one focus, c from the centre
  const scale = Math.min((w - 70) / (2 * a), (h - 34) / (2 * b));
  const cx = w / 2, cy = h / 2;
  const earthX = cx + c * scale; // perigee on the right

  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - a * scale - 10, cy + 0.5);
  ctx.lineTo(cx + a * scale + 10, cy + 0.5);
  ctx.stroke();

  const earthR = Math.max(1.5, 6371 * scale);
  const globe = ctx.createRadialGradient(earthX - earthR * 0.3, cy - earthR * 0.3, earthR * 0.1, earthX, cy, earthR);
  globe.addColorStop(0, '#3f7fd0');
  globe.addColorStop(1, '#0d2a55');
  ctx.fillStyle = globe;
  ctx.beginPath();
  ctx.arc(earthX, cy, earthR, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = CYAN;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(cx, cy, a * scale, Math.max(0.5, b * scale), 0, 0, Math.PI * 2);
  ctx.stroke();

  // the object, from its true anomaly (angle from perigee, measured at the Earth)
  const r = (a * (1 - e * e)) / (1 + e * Math.cos(trueAnomalyRad));
  const sx = earthX + r * Math.cos(trueAnomalyRad) * scale, sy = cy - r * Math.sin(trueAnomalyRad) * scale;
  ctx.fillStyle = TEXT;
  ctx.beginPath();
  ctx.arc(sx, sy, 3.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = MONO;
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'left';
  ctx.fillText('perigee', Math.min(w - 50, cx + a * scale + 6), cy - 5);
  ctx.textAlign = 'right';
  ctx.fillText('apogee', Math.max(46, cx - a * scale - 6), cy - 5);
}

/** A pass across the observer's sky: centre = overhead, edge = horizon, north up. */
export function drawPolar(canvas: HTMLCanvasElement, track: Look[] | null, now: Look | null): void {
  const p = prepare(canvas);
  if (!p) return;
  const { ctx, w, h } = p;
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 16;
  const point = (look: Look) => {
    const r = (R * (90 - Math.max(0, look.elDeg))) / 90, a = (look.azDeg * Math.PI) / 180;
    return [cx + r * Math.sin(a), cy - r * Math.cos(a)] as const;
  };
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  for (const el of [0, 30, 60]) {
    ctx.beginPath();
    ctx.arc(cx, cy, (R * (90 - el)) / 90, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx - R, cy + 0.5);
  ctx.lineTo(cx + R, cy + 0.5);
  ctx.moveTo(cx + 0.5, cy - R);
  ctx.lineTo(cx + 0.5, cy + R);
  ctx.stroke();
  ctx.font = MONO;
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'center';
  ctx.fillText('N', cx, cy - R - 4);
  ctx.fillText('S', cx, cy + R + 12);
  ctx.textAlign = 'left';
  ctx.fillText('E', cx + R + 4, cy + 4);
  ctx.textAlign = 'right';
  ctx.fillText('W', cx - R - 4, cy + 4);
  ctx.textAlign = 'left';
  ctx.fillText('30°', cx + 3, cy - (R * 60) / 90 - 3);
  ctx.fillText('60°', cx + 3, cy - (R * 30) / 90 - 3);

  if (track && track.length > 1) {
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    track.forEach((look, i) => {
      const [x, y] = point(look);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    // arrow head at the end = direction of travel
    const [ex, ey] = point(track[track.length - 1]);
    const [px, py] = point(track[track.length - 2]);
    const ang = Math.atan2(ey - py, ex - px);
    ctx.fillStyle = AMBER;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - 8 * Math.cos(ang - 0.4), ey - 8 * Math.sin(ang - 0.4));
    ctx.lineTo(ex - 8 * Math.cos(ang + 0.4), ey - 8 * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fill();
    const [sx, sy] = point(track[0]);
    ctx.beginPath();
    ctx.arc(sx, sy, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  if (now && now.elDeg > 0) {
    const [x, y] = point(now);
    ctx.fillStyle = 'rgba(127, 227, 255, 0.25)';
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = CYAN;
    ctx.beginPath();
    ctx.arc(x, y, 3.4, 0, Math.PI * 2);
    ctx.fill();
  }
}
