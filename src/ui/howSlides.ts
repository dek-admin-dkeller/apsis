/**
 * "How it works", told in eight scenes on the home page, above the live demo (ui/hashDemo.ts).
 *
 * Built for presenting the project and for any visitor: one idea per scene, a large headline,
 * a sentence or two, and one main visual that animates in when the scene is reached. The pace
 * is the visitor's: ← / → (whenever the scenes are on screen and no text field has the focus;
 * nothing else on the page uses those keys), the ‹ › buttons, the progress segments, or a
 * sideways swipe on a phone. Nothing advances by itself.
 *
 * Two scenes show the REAL code: the source of hashing/SpatialHash.ts and hashing/conjunction.ts
 * is imported as text when the site is built (`?raw`), the functions are cut out by name and
 * drawn with their real line numbers, and the lines that matter are lit with numbered callouts.
 * If the code changes, the scenes change with it; if a function is renamed, the scene says the
 * excerpt could not be found rather than showing something stale (scripts/check-slides.mjs,
 * part of `npm run check`, reads the same rules in ./slideCode.ts and fails first).
 *
 * The figures are live: the catalogue's size and its number of pairs come from the same
 * `[data-ld-count]` / `[data-ld-pairs-exact]` spans the home page fills in (ui/landing.ts).
 *
 * Everything moves with CSS transitions and keyframes (transform and opacity only, so the
 * compositor does the work); the one script-driven animation is a count-up, a second long.
 * With "reduce motion" the scenes simply change.
 */

import './howSlides.css';
import SPATIAL_SOURCE from '../hashing/SpatialHash.ts?raw';
import CONJUNCTION_SOURCE from '../hashing/conjunction.ts?raw';
import { CALLOUTS, EXCERPT_RULES, SCENE_EXCERPTS, excerpt, type Excerpt } from './slideCode.ts';

// ---- the real code, cut out by name (the rules are in ./slideCode.ts, which the check also reads) ----

const SOURCES: Record<string, string> = { 'src/hashing/SpatialHash.ts': SPATIAL_SOURCE, 'src/hashing/conjunction.ts': CONJUNCTION_SOURCE };
const cut = (name: keyof typeof EXCERPT_RULES): Excerpt | null => {
  const rule = EXCERPT_RULES[name];
  return excerpt(SOURCES[rule.file], rule.file, rule.start);
};
const EXCERPTS = { table: () => SCENE_EXCERPTS.table.map(cut), measure: () => SCENE_EXCERPTS.measure.map(cut) };

const KEYWORDS = /\b(const|let|for|if|else|return|continue|new|this|of|number|void|readonly)\b/g;

/** Light syntax colouring: comments, keywords, numbers, calls. The text is escaped first. */
function colour(line: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const comment = line.indexOf('//');
  const code = comment >= 0 ? line.slice(0, comment) : line;
  const rest = comment >= 0 ? line.slice(comment) : '';
  let html = escape(code)
    .replace(/\b(\d+)\b/g, '<span class="tk-n">$1</span>')
    .replace(KEYWORDS, '<span class="tk-k">$1</span>')
    .replace(/([A-Za-z_]\w*)(?=\()/g, '<span class="tk-f">$1</span>');
  if (rest) html += `<span class="tk-c">${escape(rest)}</span>`;
  return html;
}

/** A code panel: excerpts one after another, lit lines numbered to match the callouts. */
function codePanel(parts: (Excerpt | null)[], callouts: readonly { match: RegExp; text: string }[], gapAfter: Set<number> = new Set()): HTMLElement {
  const panel = el('div', 'hs-code');
  const shown = parts.filter((part): part is Excerpt => part !== null);
  const marked = new Set<number>(); // a callout's number is shown on the first of its lines only
  const head = el('div', 'hs-code-head');
  head.append(el('span', 'hs-dot'), el('span', 'hs-dot'), el('span', 'hs-dot'), el('span', 'hs-file', [...new Set(shown.map((part) => part.file))].join('  ·  ')));
  panel.append(head);
  const body = el('pre', 'hs-code-body');
  if (shown.length < parts.length) body.append(el('span', 'hs-missing', 'An excerpt of the code could not be found: it has been renamed.'));
  shown.forEach((part, p) => {
    if (p > 0) body.append(el('span', 'hs-gap', '⋯'));
    for (const line of part.lines) {
      const row = el('span', 'hs-line');
      const which = callouts.findIndex((callout) => callout.match.test(line.text));
      if (which >= 0) {
        row.classList.add('is-lit');
        row.style.setProperty('--d', `${0.5 + which * 0.55}s`);
        if (!marked.has(which)) row.dataset.mark = String(which + 1);
        marked.add(which);
      }
      const n = el('span', 'hs-ln', String(line.n));
      const text = el('span', 'hs-tx');
      text.innerHTML = colour(line.text) || ' ';
      row.append(n, text);
      body.append(row);
    }
    if (gapAfter.has(p)) body.append(el('span', 'hs-gap', ''));
  });
  panel.append(body);
  const notes = el('ol', 'hs-callouts');
  callouts.forEach((callout, i) => {
    const item = el('li', '', callout.text);
    item.style.setProperty('--d', `${0.6 + i * 0.55}s`);
    item.dataset.mark = String(i + 1);
    notes.append(item);
  });
  const wrap = el('div', 'hs-code-wrap');
  wrap.append(panel, notes);
  return wrap;
}

// ---- small helpers -----------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function svg(markup: string, className: string, viewBox: string): HTMLElement {
  const holder = el('div', className);
  holder.innerHTML = `<svg viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${markup}</svg>`;
  return holder;
}

/** A pseudo-random but fixed scatter (the same picture every visit). */
function scatter(count: number, seed: number, w: number, h: number, margin: number): [number, number][] {
  let s = seed;
  const next = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: count }, () => [margin + next() * (w - 2 * margin), margin + next() * (h - 2 * margin)]);
}

// ---- the scenes ---------------------------------------------------------------------------------

interface Scene {
  kicker: string;
  title: string;
  /** HTML allowed (live-number spans); written by us, not from data. */
  text: string;
  visual: () => HTMLElement;
  /** The scene's own extra (a button), under the text. */
  extra?: () => HTMLElement;
}

const SCENES: Scene[] = [
  {
    kicker: 'The question',
    title: 'Which objects come close?',
    text: 'Apsis works out where every tracked satellite and piece of debris is at a given moment, from public orbital data. Take one satellite, <b>A</b>. What is within 10 km of it?',
    visual: () => {
      const v = el('div', 'hs-photo');
      const img = el('img');
      img.src = './slides/earth.webp';
      img.alt = 'The Apsis tracker: the Earth with every tracked object around it';
      img.decoding = 'async';
      img.loading = 'lazy';
      const mark = el('div', 'hs-target');
      mark.append(el('span', 'hs-target-ring'), el('span', 'hs-target-ring is-2'), el('b', '', 'A'), el('span', 'hs-target-label', 'within 10 km?'));
      v.append(img, mark);
      return v;
    },
  },
  {
    kicker: 'The obvious way',
    title: 'Every pair is a lot of pairs',
    text: 'Measuring every object against every other one means <span data-ld-pairs-exact>191,521,806</span> distance checks for the catalogue as it stands — and nearly all of them between objects nowhere near each other.',
    visual: () => {
      const dots = scatter(26, 11, 600, 420, 24);
      let lines = '';
      for (let i = 0; i < dots.length; i++) for (let j = i + 1; j < dots.length; j++) lines += `M${dots[i][0].toFixed(0)} ${dots[i][1].toFixed(0)}L${dots[j][0].toFixed(0)} ${dots[j][1].toFixed(0)}`;
      const mesh = svg(`<path class="hs-mesh" d="${lines}"/>${dots.map(([x, y]) => `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="3.2" class="hs-node"/>`).join('')}`, 'hs-mesh-wrap', '0 0 600 420');
      const v = el('div', 'hs-numbers');
      const a = el('div', 'hs-num');
      a.innerHTML = '<b data-countup data-ld-count>19,572</b><span>objects tracked right now</span>';
      const arrow = el('div', 'hs-num-arrow', '→');
      const b = el('div', 'hs-num is-big');
      b.innerHTML = '<b data-countup data-ld-pairs-exact>191,521,806</b><span>distance checks, every pair</span>';
      v.append(a, arrow, b);
      const wrap = el('div', 'hs-split');
      wrap.append(mesh, v);
      return wrap;
    },
  },
  {
    kicker: 'Step 1 · an address',
    title: 'Every object gets a grid address',
    text: 'Space is cut into cubes 10 km wide. Divide each coordinate by 10 and round down: A, at (6709, 23, −4), is in cell (670, 2, −1). Rounding <i>down</i> is why −0.4 becomes −1.',
    visual: () => {
      const v = el('div', 'hs-address');
      const rows: [string, string, string, string][] = [['x', '6709', '670.9', '670'], ['y', '23', '2.3', '2'], ['z', '−4', '−0.4', '−1']];
      const table = el('div', 'hs-calc');
      rows.forEach(([axis, value, divided, cell], i) => {
        const row = el('div', 'hs-calc-row');
        row.style.setProperty('--d', `${0.35 + i * 0.35}s`);
        row.innerHTML = `<i>${axis}</i><span>${value}</span><em>÷ 10 =</em><span class="is-soft">${divided}</span><em>round down</em><b>${cell}</b>`;
        table.append(row);
      });
      const result = el('div', 'hs-cell-result');
      result.innerHTML = '<span>A is filed under cell</span><b>(670, 2, −1)</b>';
      // A small isometric block of cells with A dropping into one of them.
      const cube = (x: number, y: number, cls: string) => {
        const w = 46, h = 26, d = 46;
        return `<g class="${cls}" transform="translate(${x} ${y})"><path d="M0 ${h / 2}L${w} 0L${2 * w} ${h / 2}L${w} ${h}Z"/><path d="M0 ${h / 2}L0 ${h / 2 + d}L${w} ${h + d}L${w} ${h}Z"/><path d="M${2 * w} ${h / 2}L${2 * w} ${h / 2 + d}L${w} ${h + d}L${w} ${h}Z"/></g>`;
      };
      let cells = '';
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cells += cube(40 + c * 46 + r * 46, 40 + r * 23 - c * 23 + 40, r === 1 && c === 1 ? 'hs-iso is-a' : 'hs-iso');
      const iso = svg(`${cells}<g class="hs-drop"><circle cx="178" cy="${40 + 23 + 40 + 13}" r="7"/><text x="192" y="${40 + 23 + 40 + 6}">A</text></g>`, 'hs-iso-wrap', '0 0 340 260');
      v.append(iso, table, result);
      return v;
    },
  },
  {
    kicker: 'Step 2 · the hash table',
    title: 'Filed in a hash table',
    text: 'Apsis keeps a hash table whose key is a place in space. The three cell numbers are packed into one key; the bucket under that key holds the IDs of every object in the cell. Finding what is near something becomes a lookup, not a search.',
    visual: () => codePanel(
      EXCERPTS.table(),
      CALLOUTS.table,
    ),
  },
  {
    kicker: 'Step 3 · the neighbours',
    title: 'Close can mean next door',
    text: 'B, at (6711, 23, −4), is only 2 km from A, but it falls in the next cube. So a search looks in A’s own cube and the 26 that touch it — and C, far away, is never looked at.',
    visual: () => {
      const size = 64, cols = 7, rows = 5, ox = 20, oy = 20;
      let grid = '';
      for (let c = 0; c <= cols; c++) grid += `<line x1="${ox + c * size}" y1="${oy}" x2="${ox + c * size}" y2="${oy + rows * size}" style="--i:${c}"/>`;
      for (let r = 0; r <= rows; r++) grid += `<line x1="${ox}" y1="${oy + r * size}" x2="${ox + cols * size}" y2="${oy + r * size}" style="--i:${r}"/>`;
      // A near the right wall of its cell (col 2, row 2); B just across it; C far off.
      const ax = ox + 2 * size + size - 9, ay = oy + 2 * size + 30, bx = ox + 3 * size + 9, by = ay + 4, cx = ox + 6 * size + 30, cy = oy + 0 * size + 26;
      const markup = `<g class="hs-grid">${grid}</g>
        <rect class="hs-block" x="${ox + 1 * size}" y="${oy + 1 * size}" width="${3 * size}" height="${3 * size}" rx="3"/>
        <rect class="hs-own" x="${ox + 2 * size}" y="${oy + 2 * size}" width="${size}" height="${size}"/>
        <line class="hs-wall" x1="${ox + 3 * size}" y1="${oy + 2 * size - 8}" x2="${ox + 3 * size}" y2="${oy + 3 * size + 8}"/>
        <g class="hs-gapline"><line x1="${ax}" y1="${ay + 18}" x2="${bx}" y2="${by + 18}"/><text x="${(ax + bx) / 2}" y="${ay + 34}">2 km</text></g>
        <g class="hs-pt is-a"><circle cx="${ax}" cy="${ay}" r="7"/><text x="${ax - 20}" y="${ay - 12}">A</text></g>
        <g class="hs-pt is-b"><circle cx="${bx}" cy="${by}" r="7"/><text x="${bx + 8}" y="${by - 12}">B</text></g>
        <g class="hs-pt is-c"><circle cx="${cx}" cy="${cy}" r="7"/><text x="${cx + 10}" y="${cy + 4}">C</text></g>
        <text class="hs-note" x="${ox}" y="${oy + rows * size + 26}">One layer of the 3D grid: 9 of the 27 cubes searched round A</text>`;
      return svg(markup, 'hs-wall-wrap', '0 0 490 380');
    },
  },
  {
    kicker: 'Step 4 · measure the candidates',
    title: 'Only the candidates are measured',
    text: 'The first part gathers the IDs from the 27 buckets. The second measures how far each candidate really is. A and B are 2 km apart, so they make the list — once, not twice.',
    visual: () => codePanel(
      EXCERPTS.measure(),
      CALLOUTS.measure,
    ),
  },
  {
    kicker: 'The result',
    title: 'Same answer, far fewer checks',
    text: 'With A, B and a faraway C, checking every pair takes three measurements. The grid needs one. Both find A and B. The more spread out the objects, the bigger the saving — with the whole catalogue it is millions of times fewer.',
    visual: () => {
      const A = [150, 230], B = [210, 250], C = [470, 90];
      const line = (p: number[], q: number[], cls: string) => `<line class="${cls}" x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}"/>`;
      const markup = `${line(A, C, 'hs-l is-cut')}${line(B, C, 'hs-l is-cut is-2')}${line(A, B, 'hs-l is-kept')}
        <g class="hs-pt is-a"><circle cx="${A[0]}" cy="${A[1]}" r="8"/><text x="${A[0] - 24}" y="${A[1] + 5}">A</text></g>
        <g class="hs-pt is-b"><circle cx="${B[0]}" cy="${B[1]}" r="8"/><text x="${B[0] + 14}" y="${B[1] + 6}">B</text></g>
        <g class="hs-pt is-c"><circle cx="${C[0]}" cy="${C[1]}" r="8"/><text x="${C[0] + 14}" y="${C[1] + 5}">C</text></g>`;
      const v = el('div', 'hs-result');
      const tally = el('div', 'hs-tally');
      tally.innerHTML = '<span class="hs-t-from">3</span><span class="hs-t-arrow">→</span><span class="hs-t-to">1</span><small>measurements</small>';
      v.append(svg(markup, 'hs-tri', '0 0 560 320'), tally);
      return v;
    },
    extra: () => {
      const go = el('button', 'hs-try', 'Try it live ↓');
      go.type = 'button';
      go.addEventListener('click', () => document.querySelector('.ld-demo')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      return go;
    },
  },
  {
    kicker: 'In Apsis',
    title: 'Every second, the whole catalogue',
    text: 'With the monitor on, this is the search the tracker runs once a second on all <span data-ld-count>19,572</span> objects; the same search screens the spacecraft at every other world. Each close pair it finds is listed in the monitor, and the close-approach view draws the two objects in their cells: the grid from these scenes, live.',
    visual: () => {
      const v = el('div', 'hs-photo is-live');
      const img = el('img');
      img.src = './slides/approach.webp';
      img.alt = 'A close approach in the Apsis tracker: two objects inside the screening cells';
      img.decoding = 'async';
      img.loading = 'lazy';
      const chips = el('div', 'hs-chips');
      ['Once a second', 'Every tracked object', 'Every world'].forEach((word, i) => {
        const chip = el('span', i === 0 ? 'is-first' : '', word);
        chip.style.setProperty('--d', `${0.6 + i * 0.25}s`);
        chips.append(chip);
      });
      v.append(img, chips, el('span', 'hs-photo-tag', 'Live in the tracker'));
      return v;
    },
  },
];

// ---- the deck --------------------------------------------------------------------------------

export class HowSlides {
  private readonly root: HTMLElement;
  private readonly slides: HTMLElement[] = [];
  private readonly segments: HTMLButtonElement[] = [];
  private readonly count = el('span', 'hs-count');
  private index = 0;
  private inView = false;

  constructor(root: HTMLElement) {
    this.root = root;
    root.classList.add('hs');
    root.setAttribute('role', 'region');
    root.setAttribute('aria-roledescription', 'slides');
    root.setAttribute('aria-label', 'How Apsis finds close approaches, in eight steps');

    const backdrop = el('div', 'hs-backdrop');
    backdrop.innerHTML = '<div class="hs-plane"></div><div class="hs-glow"></div>';
    const stage = el('div', 'hs-stage');
    SCENES.forEach((scene, i) => {
      const slide = el('article', 'hs-slide');
      slide.setAttribute('aria-hidden', 'true');
      slide.setAttribute('aria-label', `${i + 1} of ${SCENES.length}: ${scene.title}`);
      const copy = el('div', 'hs-copy');
      const kicker = el('p', 'hs-kicker');
      kicker.append(el('span', 'hs-kicker-n', String(i + 1).padStart(2, '0')), el('span', '', scene.kicker));
      const title = el('h3', 'hs-title', scene.title);
      const text = el('p', 'hs-text');
      text.innerHTML = scene.text;
      copy.append(kicker, title, text);
      if (scene.extra) copy.append(scene.extra());
      const visual = el('div', 'hs-visual');
      visual.append(scene.visual());
      slide.append(copy, visual);
      stage.append(slide);
      this.slides.push(slide);
    });

    const nav = el('div', 'hs-nav');
    const prev = el('button', 'hs-arrow is-prev');
    const next = el('button', 'hs-arrow is-next');
    prev.type = next.type = 'button';
    prev.setAttribute('aria-label', 'Previous (←)');
    next.setAttribute('aria-label', 'Next (→)');
    prev.addEventListener('click', () => this.go(this.index - 1));
    next.addEventListener('click', () => this.go(this.index + 1));
    const progress = el('div', 'hs-progress');
    SCENES.forEach((scene, i) => {
      const segment = el('button', 'hs-seg');
      segment.type = 'button';
      segment.setAttribute('aria-label', `${i + 1}: ${scene.title}`);
      segment.title = scene.title;
      segment.addEventListener('click', () => this.go(i));
      progress.append(segment);
      this.segments.push(segment);
    });
    // Full screen: the scenes alone, for presenting (Esc, or the button again, comes back).
    const full = el('button', 'hs-full');
    full.type = 'button';
    full.setAttribute('aria-label', 'Full screen');
    full.title = 'Full screen (Esc to leave)';
    full.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 7.5V3h4.5M12.5 3H17v4.5M17 12.5V17h-4.5M7.5 17H3v-4.5"/></svg>';
    full.addEventListener('click', () => {
      if (document.fullscreenElement === root) void document.exitFullscreen();
      else void root.requestFullscreen?.().catch(() => undefined);
    });
    if (!document.fullscreenEnabled) full.hidden = true;
    nav.append(prev, progress, this.count, next, full);
    root.append(backdrop, stage, nav);

    // ← / → whenever the scenes are on screen: no click first, never while typing.
    new IntersectionObserver((entries) => {
      for (const entry of entries) this.inView = entry.isIntersecting;
      root.classList.toggle('is-in-view', this.inView);
    }, { threshold: 0.45 }).observe(root);
    window.addEventListener('keydown', (event) => {
      if (!this.inView || event.metaKey || event.ctrlKey || event.altKey || (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft')) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('#gallery:not(.is-hidden), #howto:not(.is-hidden)')) return; // an overlay above the page has the keys
      event.preventDefault();
      this.go(this.index + (event.key === 'ArrowRight' ? 1 : -1));
    });
    this.swipe(stage);
    this.go(0, true);
  }

  private go(to: number, first = false): void {
    if (to < 0 || to >= this.slides.length || (to === this.index && !first)) return;
    const forward = to > this.index;
    this.root.style.setProperty('--slide', String(to));
    this.root.dataset.dir = forward ? 'next' : 'prev';
    this.slides.forEach((slide, i) => {
      const on = i === to;
      slide.classList.toggle('is-on', on);
      slide.classList.toggle('is-before', i < to);
      slide.setAttribute('aria-hidden', String(!on));
    });
    this.segments.forEach((segment, i) => {
      segment.classList.toggle('is-done', i < to);
      segment.classList.toggle('is-on', i === to);
    });
    this.index = to;
    this.count.textContent = `${to + 1} / ${this.slides.length}`;
    this.countUp(this.slides[to]);
  }

  /** The big numbers count up to their (live) value when their scene arrives. */
  private countUp(slide: HTMLElement): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const node of slide.querySelectorAll<HTMLElement>('[data-countup]')) {
      // The value to reach: what the page wrote there (ui/landing.ts keeps it live), remembered
      // while a count is running so a quick back-and-forth does not count up to a half-way number.
      if (node.dataset.counting !== '1') node.dataset.target = (node.textContent ?? '').replace(/[^\d]/g, '');
      const target = Number(node.dataset.target);
      if (!target) continue;
      const start = performance.now(), length = 1100;
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / length);
        const eased = 1 - Math.pow(1 - t, 3);
        node.textContent = Math.round(target * eased).toLocaleString('en-US');
        if (t < 1 && slide.classList.contains('is-on')) requestAnimationFrame(tick);
        else {
          node.textContent = target.toLocaleString('en-US');
          node.dataset.counting = '';
        }
      };
      node.dataset.counting = '1';
      requestAnimationFrame(tick);
    }
  }

  /** A sideways swipe on the stage moves one scene (an upward or downward one scrolls the page). */
  private swipe(on: HTMLElement): void {
    let x0: number | null = null, y0 = 0;
    on.addEventListener('touchstart', (event) => {
      x0 = event.touches[0].clientX;
      y0 = event.touches[0].clientY;
    }, { passive: true });
    on.addEventListener('touchend', (event) => {
      if (x0 === null) return;
      const dx = event.changedTouches[0].clientX - x0, dy = event.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) this.go(this.index + (dx < 0 ? 1 : -1));
    }, { passive: true });
  }
}
