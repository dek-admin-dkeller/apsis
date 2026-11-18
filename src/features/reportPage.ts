/**
 * The printable close-approach report: one self-contained HTML document, built as a string.
 *
 * It is opened in its own tab by features/report.ts and printed (or saved as a PDF) from the
 * browser, so it carries its own styles and depends on nothing in the app: white paper, serif
 * text, ruled tables — the one place in the project meant to read as a printed technical note
 * rather than a dashboard. Times are UTC and lengths kilometres whatever the visitor's
 * settings; their own units follow in square brackets if they differ.
 *
 * This file only lays numbers out. The numbers come from data/approachData.ts.
 */

import type { ApproachSummary } from '../data/approachData.ts';
import { fmt, fmtInt, fmtKm, fmtKmS, fmtRange, getUnits } from '../ui/dom.ts';

export interface ReportObject {
  name: string;
  noradId: number;
  intlDes: string;
  type: string; // '' when the catalogue facts are not loaded
  owner: string;
  launched: string;
  epochMs: number; // when its orbital elements were measured
}

export interface ReportInput {
  a: ReportObject;
  b: ReportObject;
  summary: ApproachSummary;
  /** The two fly together (docked, in formation): there is no single passing moment. */
  coMoving: boolean;
  /** Seconds either side of the closest approach covered by the chart. */
  windowS: number;
  /** Range in km at evenly spaced instants from −windowS to +windowS. */
  ranges: number[];
  alertKm: number;
  /** Rough name of what lies under the midpoint ("North Atlantic"). */
  region: string;
  generatedMs: number;
  /** When the orbital elements were downloaded (ISO time), '' if unknown. */
  dataFetchedAt: string;
  /** The visitor reads the clock in local time: give the closest approach in it as well. */
  localClock: boolean;
}

// Names come from a public catalogue, not from us: nothing is put into the page unescaped.
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };
const esc = (text: string): string => text.replace(/[&<>"']/g, (c) => ESCAPES[c]);

const two = (n: number): string => String(n).padStart(2, '0');

/** "2026-11-18 14:03:22.512 UTC": unambiguous, sortable, and says its clock. */
function utc(ms: number, detail: 'ms' | 's' | 'min'): string {
  const d = new Date(Math.round(ms));
  const date = `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
  const time = `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`
    + (detail === 'min' ? '' : `:${two(d.getUTCSeconds())}`)
    + (detail === 'ms' ? `.${String(d.getUTCMilliseconds()).padStart(3, '0')}` : '');
  return `${date} ${time} UTC`;
}

/** The same instant on the visitor's own clock, with the zone named ("18 Nov 2026, 09:03:22 GMT-5"). */
function local(ms: number): string {
  try {
    return new Date(ms).toLocaleString('en-GB', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
  } catch {
    return new Date(ms).toString();
  }
}

/** The visitor's own units in square brackets after the metric value — only if theirs are not metric. */
const own = (text: string): string => (getUnits() === 'imperial' ? ` <span class="own">[${esc(text)}]</span>` : '');
const signed = (value: number, digits: number): string => `${value < 0 ? '−' : '+'}${fmt(Math.abs(value), digits)}`;
const latLon = (latDeg: number, lonDeg: number): string =>
  `${fmt(Math.abs(latDeg), 2)}° ${latDeg >= 0 ? 'N' : 'S'}, ${fmt(Math.abs(lonDeg), 2)}° ${lonDeg >= 0 ? 'E' : 'W'}`;
const speed = (kmS: number): string =>
  (kmS < 0.01 ? `${fmt(kmS * 1000, 2)} m/s` : `${fmt(kmS, 3)} km/s (${fmtInt(kmS * 3600)} km/h)`) + own(fmtKmS(kmS));

function age(days: number): string {
  const amount = Math.abs(days) < 2 ? `${fmt(Math.abs(days) * 24, 1)} hours` : `${fmt(Math.abs(days), 1)} days`;
  return days >= 0 ? amount : `${amount} (measured after the event)`;
}

// ---------------------------------------------------------------- the chart

/** Round a step up to 1, 2 or 5 times a power of ten, so axis ticks land on round numbers. */
function roundStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const mantissa = raw / power;
  return (mantissa <= 1 ? 1 : mantissa <= 2 ? 2 : mantissa <= 5 ? 5 : 10) * power;
}
const decimalsFor = (step: number): number => Math.min(4, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));

/**
 * Range against time as inline SVG (so it prints sharply and needs no script to appear): one
 * dark curve, hairline grid, round-number ticks, the closest point labelled directly.
 */
function rangeChart(input: ReportInput): { svg: string; alertDrawn: boolean } {
  const { ranges, windowS, alertKm, summary } = input;
  const W = 680, H = 166, left = 54, right = 664, top = 18, bottom = 120;
  const highest = Math.max(...ranges.filter(Number.isFinite), summary.missKm, 0.001); // never a zero-height axis (docked objects)
  const yStep = roundStep(highest / 4);
  const yTop = Math.max(yStep, Math.ceil(highest / yStep - 1e-9) * yStep);
  const xStep = roundStep(windowS / 4);
  const x = (seconds: number): number => left + ((seconds + windowS) / (2 * windowS)) * (right - left);
  const y = (km: number): number => bottom - (km / yTop) * (bottom - top);
  const n = (value: number): string => value.toFixed(1);
  const parts: string[] = [];

  const yDigits = decimalsFor(yStep);
  for (let km = 0; km <= yTop + yStep / 2; km += yStep) {
    if (km > 0) parts.push(`<line x1="${left}" x2="${right}" y1="${n(y(km))}" y2="${n(y(km))}" class="grid"/>`);
    parts.push(`<text x="${left - 7}" y="${n(y(km) + 3.5)}" text-anchor="end">${fmt(km, yDigits)}</text>`);
  }
  const xDigits = decimalsFor(xStep);
  for (let s = -Math.floor(windowS / xStep) * xStep; s <= windowS + 1e-9; s += xStep) {
    const label = Math.abs(s) < xStep / 2 ? '0' : signed(s, xDigits);
    parts.push(`<line x1="${n(x(s))}" x2="${n(x(s))}" y1="${bottom}" y2="${bottom + 4}" class="axis"/>`);
    parts.push(`<text x="${n(x(s))}" y="${bottom + 17}" text-anchor="middle">${label}</text>`);
  }
  parts.push(`<line x1="${left}" x2="${right}" y1="${bottom}" y2="${bottom}" class="axis"/>`);
  parts.push(`<text x="${left - 46}" y="11" class="title">Range, km</text>`);
  parts.push(`<text x="${(left + right) / 2}" y="${H - 8}" text-anchor="middle" class="title">Seconds from closest approach</text>`);

  // The monitor's alert distance, when it falls inside the picture. Named in words: never by colour alone.
  const alertDrawn = alertKm > 0 && alertKm <= yTop;
  if (alertDrawn) {
    // Its label goes where the curve stays furthest from the line over the label's whole width (clear of
    // the middle, which the closest point's label uses), on the side of the line the curve is not on.
    const curveAt = (share: number): number => ranges[Math.round(Math.min(1, Math.max(0, share)) * (ranges.length - 1))] ?? alertKm;
    const gapAt = (share: number): number => Math.min(...[-0.08, -0.04, 0, 0.04, 0.08].map((off) => Math.abs(curveAt(share + off) - alertKm)));
    const share = [0.1, 0.2, 0.3, 0.7, 0.8, 0.9].reduce((best, candidate) => (gapAt(candidate) > gapAt(best) ? candidate : best));
    const labelDy = curveAt(share) > alertKm ? 11 : -4;
    parts.push(`<line x1="${left}" x2="${right}" y1="${n(y(alertKm))}" y2="${n(y(alertKm))}" class="alert"/>`);
    parts.push(`<text x="${n(left + share * (right - left))}" y="${n(y(alertKm) + labelDy)}" text-anchor="middle" class="halo">alert distance ${fmt(alertKm, 0)} km</text>`);
  }

  const points = ranges
    .map((km, i) => (Number.isFinite(km) ? `${n(left + (i / (ranges.length - 1)) * (right - left))},${n(y(km))}` : ''))
    .filter(Boolean).join(' ');
  parts.push(`<polyline points="${points}" class="curve"/>`);

  // The closest point: a dot, and its value written where the curve leaves room (above a
  // low point, below a high one), joined to it by a hairline.
  const dotX = x(0), dotY = y(summary.missKm);
  let labelY = dotY > (top + bottom) / 2 ? top + 0.3 * (bottom - top) : top + 0.72 * (bottom - top);
  if (alertDrawn && Math.abs(labelY - 3 - y(alertKm)) < 11) labelY = y(alertKm) + 16; // not on top of the alert line
  parts.push(`<line x1="${n(dotX)}" x2="${n(dotX)}" y1="${n(labelY + (labelY < dotY ? 5 : -13))}" y2="${n(dotY)}" class="leader"/>`);
  parts.push(`<circle cx="${n(dotX)}" cy="${n(dotY)}" r="3.6" class="dot"/>`);
  parts.push(`<text x="${n(dotX)}" y="${n(labelY)}" text-anchor="middle" class="halo value">closest: ${fmt(summary.missKm, 3)} km</text>`);

  // On screen only: a line that follows the pointer and reads the curve off (see the script at the end of the page).
  parts.push(`<g id="probe" class="no-print" visibility="hidden"><line id="probe-line" y1="${top}" y2="${bottom}" class="leader"/><circle id="probe-dot" r="3" class="dot"/><text id="probe-text" x="${right}" y="11" text-anchor="end"></text></g>`);
  parts.push(`<rect id="probe-area" class="no-print" x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" fill="transparent"/>`);

  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="chart-title" data-left="${left}" data-right="${right}" data-top="${top}" data-bottom="${bottom}" data-ytop="${yTop}" data-window="${windowS}">`
    + `<title id="chart-title">Range between the two objects against time; the smallest value is ${fmt(summary.missKm, 3)} km at closest approach</title>${parts.join('')}</svg>`;
  return { svg, alertDrawn };
}

/** Reads the curve under the pointer. Plain ES5 on purpose: it lives inside the report, outside the app's build. */
const PROBE_SCRIPT = `
(function () {
  var svg = document.querySelector('svg[data-window]'), area = document.getElementById('probe-area');
  if (!svg || !area || !window.RANGES) return;
  var d = svg.dataset, left = +d.left, right = +d.right, top = +d.top, bottom = +d.bottom, yTop = +d.ytop, win = +d.window;
  var probe = document.getElementById('probe'), line = document.getElementById('probe-line');
  var dot = document.getElementById('probe-dot'), text = document.getElementById('probe-text');
  area.addEventListener('pointermove', function (event) {
    var box = area.getBoundingClientRect();
    var share = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    var i = Math.round(share * (RANGES.length - 1)), km = RANGES[i];
    if (!isFinite(km)) return;
    var px = left + (i / (RANGES.length - 1)) * (right - left), py = bottom - (km / yTop) * (bottom - top);
    var s = (i / (RANGES.length - 1) * 2 - 1) * win;
    line.setAttribute('x1', px); line.setAttribute('x2', px);
    dot.setAttribute('cx', px); dot.setAttribute('cy', py);
    text.textContent = (s < 0 ? '\\u2212' : '+') + Math.abs(s).toFixed(win < 10 ? 2 : 1) + ' s:  ' + km.toFixed(3) + ' km';
    probe.setAttribute('visibility', 'visible');
  });
  area.addEventListener('pointerleave', function () { probe.setAttribute('visibility', 'hidden'); });
})();`;

// ---------------------------------------------------------------- the page

/**
 * On screen the body is drawn as a sheet of paper with the print margins as padding, so what
 * is seen is what prints. Type and spacing are sized for the whole report to fit one A4 or
 * US Letter page.
 */
const STYLE = `
@page { margin: 11mm 17mm; }
:root { color-scheme: light; }
* { box-sizing: border-box; }
html { background: #e8e7e3; }
body { width: 210mm; max-width: 100%; min-height: 297mm; margin: 22px auto; padding: 11mm 17mm; background: #fff; color: #161616;
  font: 9.2pt/1.32 "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif; box-shadow: 0 1px 5px rgba(0, 0, 0, 0.18); }
.print { position: fixed; top: 14px; right: 16px; padding: 8px 14px; min-height: 38px; border: 1px solid #161616; border-radius: 3px; background: #fff; color: #161616;
  font: 600 13px/1 system-ui, -apple-system, "Segoe UI", sans-serif; cursor: pointer; }
.print:hover { background: #161616; color: #fff; }
.kicker { margin: 0; font-size: 8.6pt; letter-spacing: 0.04em; color: #555; }
h1 { margin: 1pt 0 0; font-size: 17pt; line-height: 1.2; font-weight: 600; }
.lede { margin: 4pt 0 0; color: #333; }
h2 { margin: 6.5pt 0 1.5pt; padding-bottom: 1.5pt; border-bottom: 0.7pt solid #161616; font-size: 9.2pt; font-weight: 700; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums lining-nums; }
th, td { padding: 1pt 9pt 1pt 0; border-bottom: 0.4pt solid #c9c9c9; text-align: left; vertical-align: top; }
th { width: 31%; font-weight: 400; color: #444; }
thead th { border-bottom: 0.7pt solid #161616; font-weight: 700; color: #161616; }
tr:last-child > * { border-bottom: 0; }
.own, .aside { color: #555; }
.beside { display: grid; grid-template-columns: 44% 1fr; column-gap: 16pt; align-items: start; }
.split th { width: 27%; }
.split td:nth-child(2) { width: 1%; white-space: nowrap; text-align: right; }
.note { margin: 3pt 0 0; font-size: 8.3pt; line-height: 1.34; color: #444; }
.beside .note { margin-top: 1.5pt; }
figure { margin: 3pt 0 0; }
svg { display: block; width: 100%; height: auto; font: 9px/1 "Helvetica Neue", Helvetica, Arial, sans-serif; fill: #3a3a3a; }
svg .title { fill: #161616; }
svg .value { fill: #161616; font-weight: 600; font-size: 9.5px; }
svg .halo { paint-order: stroke; stroke: #fff; stroke-width: 3px; stroke-linejoin: round; }
svg .grid { stroke: #dedede; stroke-width: 0.6; }
svg .axis { stroke: #161616; stroke-width: 0.8; }
svg .leader { stroke: #8a8a8a; stroke-width: 0.6; }
svg .alert { stroke: #a3281f; stroke-width: 0.9; }
svg .curve { fill: none; stroke: #161616; stroke-width: 1.8; stroke-linejoin: round; stroke-linecap: round; }
svg .dot { fill: #161616; stroke: #fff; stroke-width: 1.6; }
#probe-area { cursor: crosshair; }
figcaption { margin-top: 1pt; font-size: 8.3pt; line-height: 1.34; color: #444; }
.method { margin: 0; font-size: 8.4pt; line-height: 1.34; text-align: justify; hyphens: auto; }
footer { margin-top: 6pt; padding-top: 3pt; border-top: 0.4pt solid #c9c9c9; font-size: 8pt; color: #555; }
@media screen and (max-width: 760px) {
  html { background: #fff; }
  body { width: auto; min-height: 0; margin: 0; padding: 14px 16px 24px; box-shadow: none; font-size: 14.5px; }
  .print { position: static; display: block; margin: 0 0 14px auto; } /* in the flow: a floating button would cover the tables */
  figure { overflow-x: auto; } /* the chart keeps a readable size and scrolls sideways instead of shrinking to nothing */
  svg { min-width: 600px; }
  .note, figcaption, footer, .method { font-size: 13px; }
  th { width: 38%; }
  .pair { table-layout: fixed; }
  .pair th { width: 30%; }
  .pair td { overflow-wrap: anywhere; }
  .beside { display: block; }
  .method { text-align: left; }
}
@media print {
  html { background: #fff; }
  body { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
  .no-print { display: none !important; }
  h2 { break-after: avoid; }
  tr, figure { break-inside: avoid; }
}`;

export function reportHtml(input: ReportInput): string {
  const { a, b, summary: s, coMoving, windowS } = input;
  const row = (label: string, value: string): string => `<tr><th scope="row">${label}</th><td>${value}</td></tr>`;
  const pair = (label: string, first: string, second: string): string => `<tr><th scope="row">${label}</th><td>${first}</td><td>${second}</td></tr>`;
  const text = (value: string): string => (value ? esc(value) : '<span class="own">not available</span>');
  const flight = (o: ApproachSummary['a']): string => `${fmt(o.altKm, 1)} km, ${fmt(o.speedKmS, 3)} km/s${own(`${fmtKm(o.altKm)}, ${fmtKmS(o.speedKmS)}`)}`;
  const title = `Close approach: ${a.name} and ${b.name}, ${utc(s.tcaMs, 'min')}`;

  // Two catalogue entries with one and the same element set (a station's modules) come out exactly on top of each other.
  const sameElements = s.missKm < 1e-6 && s.relSpeedKmS < 1e-9;
  const split = s.split && !sameElements
    ? `<h2>2. Where the second object is, seen from the first</h2>
<div class="beside">
<table class="split"><tbody>
<tr><th scope="row">Radial</th><td>${signed(s.split.radialKm, 3)} km</td><td>${s.split.radialKm >= 0 ? 'higher' : 'lower'}${own(fmtRange(Math.abs(s.split.radialKm)))}</td></tr>
<tr><th scope="row">Along-track</th><td>${signed(s.split.alongKm, 3)} km</td><td>${s.split.alongKm >= 0 ? 'ahead' : 'behind'}${own(fmtRange(Math.abs(s.split.alongKm)))}</td></tr>
<tr><th scope="row">Cross-track</th><td>${signed(s.split.crossKm, 3)} km</td><td>to the ${s.split.crossKm >= 0 ? 'left' : 'right'}${own(fmtRange(Math.abs(s.split.crossKm)))}</td></tr>
</tbody></table>
<p class="note">The miss distance at closest approach, split along three directions at right angles taken from ${esc(a.name)}: radial is away from the Earth's centre, along-track the way it is travelling, cross-track at right angles to its orbit plane (left and right as seen from above).</p>
</div>`
    : '';
  const sections = split ? { objects: 3, figure: 4, method: 5 } : { objects: 2, figure: 3, method: 4 };

  const sampleS = (2 * windowS) / (input.ranges.length - 1);
  const { svg, alertDrawn } = rangeChart(input);
  const caption = `Figure 1. Range through the approach, computed every ${fmt(sampleS, sampleS < 1 ? 2 : 1)} s.`
    + (alertDrawn ? ` The red line is the alert distance the monitor was set to (${fmt(input.alertKm, 0)} km).` : '');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<button type="button" class="print no-print" onclick="window.print()">Print or save as PDF</button>
<p class="kicker">Close-approach report</p>
<h1>${esc(a.name)} and ${esc(b.name)}</h1>
<p class="lede">${coMoving
    ? `These two objects travel together. Their smallest separation in the period examined was ${fmt(s.missKm, 3)} km, at ${utc(s.tcaMs, 's')}.`
    : `Predicted to pass ${fmt(s.missKm, 3)} km apart at ${utc(s.tcaMs, 's')}, moving at ${fmt(s.relSpeedKmS, 2)} km/s relative to each other.`}</p>

<h2>1. Closest approach</h2>
<table><tbody>
${row('Time of closest approach', utc(s.tcaMs, 'ms'))}
${input.localClock ? row('In your local time', esc(local(s.tcaMs))) : ''}
${row('Miss distance', `${fmt(s.missKm, 3)} km (${fmtInt(s.missKm * 1000)} m)${own(fmtRange(s.missKm))}`)}
${row('Relative speed', speed(s.relSpeedKmS))}
${row('Angle between the two paths', `${fmt(s.crossingAngleDeg, 1)}° <span class="aside">(0° = same direction, 180° = head-on)</span>`)}
${row('Midpoint between them', `${fmt(s.mid.altKm, 1)} km${own(fmtKm(s.mid.altKm))} above ${latLon(s.mid.latDeg, s.mid.lonDeg)}${input.region ? ` (${esc(input.region)})` : ''}`)}
</tbody></table>
${coMoving ? `<p class="note">${sameElements
    ? 'The two are catalogued with one and the same set of orbital elements (parts of one spacecraft, or docked), so the computed separation is zero by construction; it says nothing about the real distance between them.'
    : 'Because the two travel together (docked, in formation, or neighbours in the same slot), the range hardly changes and there is no single passing moment: the time above is only where the computed range was smallest.'}</p>` : ''}
${split}
<h2>${sections.objects}. The two objects</h2>
<table class="pair">
<thead><tr><th></th><th scope="col">First object</th><th scope="col">Second object</th></tr></thead>
<tbody>
${pair('Name', esc(a.name), esc(b.name))}
${pair('NORAD catalogue number', String(a.noradId), String(b.noradId))}
${pair('International designator', text(a.intlDes), text(b.intlDes))}
${pair('Type and owner', text([a.type, a.owner].filter(Boolean).join(', ')), text([b.type, b.owner].filter(Boolean).join(', ')))}
${pair('Launched', text(a.launched), text(b.launched))}
${pair('Altitude and speed at approach', flight(s.a), flight(s.b))}
${pair('Orbital elements measured', utc(a.epochMs, 'min'), utc(b.epochMs, 'min'))}
${pair('Their age at closest approach', age(s.a.elementAgeDays), age(s.b.elementAgeDays))}
</tbody></table>

<h2>${sections.figure}. Range through the approach</h2>
<figure>
${svg}
<figcaption>${caption}</figcaption>
</figure>

<h2>${sections.method}. Method and limits</h2>
<p class="method">Positions and velocities come from public orbital elements (general-perturbations sets distributed by CelesTrak) propagated with SGP4 in an Earth-centred inertial frame (TEME); altitudes are above the WGS&nbsp;84 ellipsoid. The closest approach was found by sampling the range every second and refining the minimum by golden-section search. Such elements place an object to within roughly a kilometre when fresh, and the error grows with their age, mostly along the track, so the miss distance is uncertain by a similar amount, possibly more than the miss distance itself. No uncertainty (covariance) data are published with them, so no probability of collision can be worked out and none is given. This is an educational estimate, not a conjunction warning, and must not be used for operational decisions.</p>

<footer>Generated ${utc(input.generatedMs, 'min')} by Apsis (OrbitHash).${input.dataFetchedAt && Number.isFinite(Date.parse(input.dataFetchedAt)) ? ` Orbital elements from CelesTrak, downloaded ${utc(Date.parse(input.dataFetchedAt), 'min')}.` : ''}</footer>
<script>var RANGES = [${input.ranges.map((km) => (Number.isFinite(km) ? km.toFixed(4) : 'NaN')).join(',')}];${PROBE_SCRIPT}</script>
</body>
</html>`;
}
