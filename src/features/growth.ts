/**
 * Growth by year: wind today's catalogue back to any year since Sputnik (reserved element:
 * #growth-body in the Objects panel).
 *
 * One compact instrument (redesigned at the owner's request: the first version was a column of
 * sentences, a legend, a slider, two buttons and two notes, and "felt like AI"): the year,
 * large, with a round play button; the chart of launch years, which IS the scrubber (click or
 * drag on it; a visually hidden range input under it keeps the keyboard and screen readers);
 * the chosen year's objects as three coloured figures; a reset chip only while a year is in
 * force; and one short line of caveat.
 *
 * The chart chooses a year; the globe then shows only the
 * objects launched in or before it. Nothing is simulated differently: the module registers
 * one test with `app.setFilter('growth', …)`, and the filter code hides whatever fails it
 * (which also takes those objects out of the close-approach screening).
 *
 * What this can and cannot show: the catalogue lists what is in orbit TODAY, so a year's bar
 * is "still up there from that year", not "everything launched that year". And a fragment
 * carries the launch year of the object it broke off, so a break-up decades later shows up
 * as a spike in the year its parent was launched.
 *
 * The far right of the slider is the present and means "everything": the filter is removed
 * rather than set to this year, so the section cannot be left quietly hiding something.
 */

import './growth.css';
import type { Catalog } from '../data/catalog.ts';
import { CATEGORY_COLORS, type Satellite } from '../data/types.ts';
import type { App } from '../ui/app.ts';
import { $, fmtInt } from '../ui/dom.ts';

const FIRST_YEAR = 1957; // Sputnik 1
const STEP_MS = 330; // "Play" moves about three years a second
const AMBER = '#ffb454';
const TEXT = '#dce8f6';
const MUTED = '#8296ae';
const LINE = 'rgba(150, 185, 230, 0.26)';
const MONO = '10px "JetBrains Mono Variable", ui-monospace, monospace';

// Three kinds keep the bars readable at four pixels a year; the colours are the globe's own.
const KINDS = [
  { key: 'other', label: 'Other satellites', color: CATEGORY_COLORS.Other },
  { key: 'starlink', label: 'Starlink', color: CATEGORY_COLORS.Starlink },
  { key: 'debris', label: 'Debris', color: CATEGORY_COLORS.Debris },
] as const; // bottom of the bar first
type Kind = (typeof KINDS)[number]['key'];
type Tally = Record<Kind, number> & { total: number };

const kindOf = (sat: Satellite): Kind => (sat.category === 'Debris' ? 'debris' : sat.category === 'Starlink' ? 'starlink' : 'other');

export function installGrowth(app: App): void {
  const host = $('growth-body');
  host.classList.add('growth');
  host.innerHTML = `
    <div class="growth-top">
      <button class="growth-play" type="button" aria-pressed="false"></button>
      <output class="growth-year"></output>
      <span class="growth-count"></span>
    </div>
    <div class="growth-chart" title="Click or drag to wind the sky back to a year">
      <canvas aria-hidden="true"></canvas>
      <input type="range" class="growth-slider" min="${FIRST_YEAR}" step="1" aria-label="Show objects launched up to this year" />
    </div>
    <div class="growth-kinds">${KINDS.map((kind) => `<span data-kind="${kind.key}"><i style="background: ${kind.color}"></i><b>0</b> ${kind.label}</span>`).join('')}</div>
    <div class="growth-foot">
      <button class="growth-all" type="button" hidden></button>
      <p class="growth-honest"></p>
    </div>`;

  const el = <T extends HTMLElement = HTMLElement>(selector: string) => host.querySelector(selector) as T;
  const slider = el<HTMLInputElement>('.growth-slider');
  const canvas = el<HTMLCanvasElement>('canvas');
  const playButton = el<HTMLButtonElement>('.growth-play');
  const allButton = el<HTMLButtonElement>('.growth-all');

  // The section can be folded away, so its heading says when a year is in force.
  const section = host.closest('details');
  const badge = document.createElement('span');
  badge.className = 'sum-note growth-badge';
  section?.querySelector('summary')?.append(badge);

  // ---------------------------------------------------------------- state

  let lastYear = new Date().getUTCFullYear(); // the right-hand end of the slider: "today"
  let year: number | null = null; // objects launched after this are hidden; null = everything is shown
  let hover: number | null = null; // the year under the pointer, for the line below the chart
  let timer = 0; // the "Play" interval, 0 when not playing
  // Launch year → how many of today's objects date from it. A hash table: one lookup and one
  // increment per object, however the catalogue happens to be ordered.
  let perYear = new Map<number, Tally>();
  let upTo: number[] = []; // running total: upTo[y - FIRST_YEAR] = objects launched in or before y
  let total = 0; // everything in the catalogue
  let peak = 1; // the tallest bar, for the chart's scale

  /** The test handed to the filters. It reads `year` when called, so one function serves every year. */
  const keep = (sat: Satellite): boolean => year !== null && sat.launchYear !== null && sat.launchYear <= year;

  // ---------------------------------------------------------------- counting

  function count(catalog: Catalog): void {
    lastYear = new Date().getUTCFullYear();
    perYear = new Map();
    total = catalog.sats.length;
    for (const sat of catalog.sats) {
      if (sat.launchYear === null) continue; // no designator: it cannot be placed in a year
      let tally = perYear.get(sat.launchYear);
      if (!tally) perYear.set(sat.launchYear, (tally = { total: 0, other: 0, starlink: 0, debris: 0 }));
      tally.total++;
      tally[kindOf(sat)]++;
    }
    upTo = [];
    peak = 1;
    let running = 0;
    for (let y = FIRST_YEAR; y <= lastYear; y++) {
      const tally = perYear.get(y);
      running += tally?.total ?? 0;
      peak = Math.max(peak, tally?.total ?? 0);
      upTo.push(running);
    }
    slider.max = String(lastYear);
  }

  // ---------------------------------------------------------------- choosing a year

  function setYear(next: number | null): void {
    // The right-hand end is the present: that is "everything", not "up to this year".
    const chosen = next === null || next >= lastYear ? null : Math.max(FIRST_YEAR, Math.round(next));
    if (chosen === year) return;
    year = chosen;
    app.setFilter('growth', year === null ? null : keep, { label: `launched by ${year}`, clear: () => {
      stop();
      setYear(null);
    } });
    render();
  }

  // Home puts everything back, and that includes this filter: a year left on by accident would
  // quietly hide most of the catalogue.
  app.onHome(() => {
    stop();
    setYear(null);
  });

  function stop(): void {
    clearInterval(timer);
    timer = 0;
    playButton.setAttribute('aria-pressed', 'false');
    playButton.setAttribute('aria-label', 'Play from 1957');
    playButton.title = 'Play from 1957';
  }

  function play(): void {
    if (timer) return stop();
    if (year === null) setYear(FIRST_YEAR); // from the start, unless a year is already chosen: then carry on from it
    playButton.setAttribute('aria-pressed', 'true');
    playButton.setAttribute('aria-label', 'Stop');
    playButton.title = 'Stop';
    timer = window.setInterval(() => {
      setYear((year ?? lastYear) + 1);
      if (year === null) stop(); // reached the present: everything is showing again
    }, STEP_MS);
  }

  /** A change made by hand: it always ends a run in progress. */
  function choose(next: number | null): void {
    stop();
    setYear(next);
  }

  // ---------------------------------------------------------------- text

  /** The three figures under the chart: what is on the globe (or, pointing at a bar, what dates from that year). */
  function detail(): void {
    const pointed = hover !== null ? perYear.get(hover) : null;
    const sums: Record<Kind, number> = { other: 0, starlink: 0, debris: 0 };
    if (hover !== null) {
      for (const kind of KINDS) sums[kind.key] = pointed?.[kind.key] ?? 0;
    } else {
      const last = year ?? lastYear;
      for (const [y, tally] of perYear) if (y <= last) for (const kind of KINDS) sums[kind.key] += tally[kind.key];
    }
    for (const kind of KINDS) host.querySelector(`[data-kind="${kind.key}"] b`)!.textContent = fmtInt(sums[kind.key]);
    host.classList.toggle('is-pointing', hover !== null);
    el('.growth-kinds').title = hover !== null ? `Launched in ${hover} and still in orbit` : 'On the globe';
  }

  function render(): void {
    const active = year !== null;
    const shown = active ? upTo[year! - FIRST_YEAR] ?? 0 : total;
    slider.value = String(year ?? lastYear);
    slider.setAttribute('aria-valuetext', active ? `up to ${year}` : 'everything');
    el('.growth-year').textContent = active ? String(year) : 'Today';
    el('.growth-count').innerHTML = `<b>${fmtInt(shown)}</b> / ${fmtInt(total)}`;
    el('.growth-count').title = active ? `${fmtInt(shown)} of today's ${fmtInt(total)} objects had been launched by ${year}; the rest are hidden, and left out of the close-approach screening` : 'Every object tracked today';
    host.classList.toggle('is-active', active);
    section?.classList.toggle('growth-on', active);
    badge.textContent = active ? `up to ${year}` : '';
    allButton.hidden = !active;
    allButton.textContent = active ? `Up to ${year}  ×` : '';
    allButton.title = 'Show everything again';
    detail();

    // One line of caveat; the two break-ups are named only when their debris is in the data.
    const spikes = (perYear.get(1993)?.debris ?? 0) > 100 && (perYear.get(1999)?.debris ?? 0) > 100;
    el('.growth-honest').textContent = `Counts what is still in orbit today. Fragments carry their parent's launch year${spikes ? ' (hence 1993 and 1999)' : ''}.`;
    draw();
  }

  // ---------------------------------------------------------------- chart

  /** Left and right margin of the bars: half a slider thumb, so a year sits under the thumb that chooses it. */
  const margin = () => (window.matchMedia('(pointer: coarse)').matches ? 11 : 7);

  function draw(): void {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w === 0 || h === 0) return; // section folded or panel closed; the ResizeObserver below redraws when it opens
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const left = margin(), top = 13, base = h - 15;
    const step = (w - 2 * left) / (lastYear - FIRST_YEAR + 1);
    const barWidth = Math.max(1, step - 1);
    const centre = (y: number) => left + (y - FIRST_YEAR + 0.5) * step;

    // bars: one per launch year, stacked by kind, faded beyond the chosen year
    for (let y = FIRST_YEAR; y <= lastYear; y++) {
      const tally = perYear.get(y);
      if (!tally) continue;
      g.globalAlpha = year === null || y <= year ? 1 : 0.25;
      const x = left + (y - FIRST_YEAR) * step;
      const full = (tally.total / peak) * (base - top);
      if (full < 2) {
        // A year with a handful of objects is a small fraction of a pixel on this scale. Draw a
        // stub so that it is at least seen to have something; every taller bar is to scale, and
        // the line under the chart gives the exact numbers.
        g.fillStyle = KINDS.reduce((a, b) => (tally[b.key] > tally[a.key] ? b : a)).color;
        g.fillRect(x, base - 2, barWidth, 2);
        continue;
      }
      let bottom = base;
      for (const kind of KINDS) {
        const height = (tally[kind.key] / tally.total) * full;
        if (height <= 0) continue;
        g.fillStyle = kind.color;
        g.fillRect(x, bottom - height, barWidth, height);
        bottom -= height;
      }
    }
    g.globalAlpha = 1;

    // axis: the baseline, a few years, and the value of the tallest bar for scale
    g.fillStyle = LINE;
    g.fillRect(left, base, w - 2 * left, 1);
    g.font = MONO;
    g.fillStyle = MUTED;
    g.textBaseline = 'alphabetic';
    for (const y of [1960, 1980, 2000, 2020]) {
      if (y > lastYear) continue;
      g.textAlign = 'center';
      g.fillText(String(y), centre(y), h - 3);
      g.fillStyle = LINE;
      g.fillRect(Math.round(centre(y)), base, 1, 3);
      g.fillStyle = MUTED;
    }
    g.textAlign = 'right';
    g.fillText(fmtInt(peak), w - left, 9); // the scale: the tallest bar

    // the year under the pointer, then the chosen year on top of it
    if (hover !== null && hover !== (year ?? lastYear)) {
      g.fillStyle = 'rgba(220, 232, 246, 0.3)';
      g.fillRect(Math.round(centre(hover)), top, 1, base - top);
    }
    const marked = year ?? lastYear;
    const x = Math.round(centre(marked));
    g.fillStyle = year === null ? TEXT : AMBER;
    g.fillRect(x, top - 3, 1, base - top + 3);
    g.beginPath();
    g.moveTo(x - 3.5, top - 7);
    g.lineTo(x + 4.5, top - 7);
    g.lineTo(x + 0.5, top - 2);
    g.fill();
  }

  /** The year whose bar is under a pointer event. */
  function yearAt(event: PointerEvent): number {
    const box = canvas.getBoundingClientRect();
    const left = margin();
    const step = (box.width - 2 * left) / (lastYear - FIRST_YEAR + 1);
    return Math.min(lastYear, Math.max(FIRST_YEAR, FIRST_YEAR + Math.floor((event.clientX - box.left - left) / step)));
  }

  // ---------------------------------------------------------------- wiring

  slider.addEventListener('input', () => choose(Number(slider.value)));
  playButton.addEventListener('click', play);
  allButton.addEventListener('click', () => choose(null));

  let dragging = false;
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
    choose(yearAt(event));
  });
  canvas.addEventListener('pointermove', (event) => {
    const y = yearAt(event);
    if (dragging) return choose(y);
    if (event.pointerType !== 'mouse' || y === hover) return;
    hover = y;
    detail();
    draw();
  });
  const release = () => (dragging = false);
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => {
    if (hover === null) return;
    hover = null;
    detail();
    draw();
  });
  // The canvas has no size while its section is folded or the panel is closed: draw when it gets one.
  new ResizeObserver(draw).observe(canvas);

  // Closing the panel with a year still chosen is how a filter gets forgotten, so say it once
  // more on the way out. (While playing there is no need: the run ends with everything shown.)
  const panel = host.closest('.panel');
  if (panel) {
    let wasOpen = !panel.classList.contains('is-hidden');
    new MutationObserver(() => {
      const open = !panel.classList.contains('is-hidden');
      if (wasOpen && !open && year !== null && !timer) app.toast(`Still showing only launches up to ${year}`);
      wasOpen = open;
    }).observe(panel, { attributes: true, attributeFilter: ['class'] });
  }

  app.onCatalog((catalog) => {
    // The filter itself survives a new catalogue (it is a test, not a list), so only the numbers change.
    count(catalog);
    if (year !== null && year >= lastYear) setYear(null); // the calendar moved on while the page was open
    else render();
  });
  const loaded = app.catalog();
  if (loaded) count(loaded);
  slider.max = String(lastYear);
  stop();
  render();
}
