/**
 * "Constellations" (Objects panel): pick one constellation to see all of it at once —
 * its members brightened on the globe, their orbits drawn, and a live map of how many of
 * them each place on the ground can see. This file is only the controls; the drawing is
 * render/constellation.ts and the member lookup is a name pattern per constellation.
 */

import './constellations.css';
import type { Catalog } from '../data/catalog.ts';
import { COVERAGE_BANDS } from '../render/constellation.ts';
import { fmtInt } from './dom.ts';

export interface ConstellationsHost {
  catalog(): Catalog | null;
  /** Brighten these object indices on the globe and dim everything else; null = back to normal. */
  highlight(indices: number[] | null): void;
  /** Hand the chosen members to the 3D view. */
  show(members: number[] | null, options: { orbits: boolean; coverage: boolean; minElevationDeg: number; color: string }): void;
  /** Coverage numbers for the readout. */
  stats(): { coveredFraction: number; maxInView: number };
}

interface Kind {
  name: string;
  pattern: RegExp; // tested against the upper-cased object name
  color: string; // orbit lines
  /** How high above the horizon a ground user needs a satellite: dishes for broadband need more sky than a navigation receiver. */
  elevation: 5 | 10 | 25;
}

const KINDS: Kind[] = [
  { name: 'GPS', pattern: /^GPS |NAVSTAR/, color: '#4ff0b4', elevation: 10 },
  { name: 'Galileo', pattern: /^GSAT0|GALILEO/, color: '#4ff0b4', elevation: 10 },
  { name: 'GLONASS', pattern: /GLONASS/, color: '#4ff0b4', elevation: 10 },
  { name: 'BeiDou', pattern: /^BEIDOU/, color: '#4ff0b4', elevation: 10 },
  { name: 'Iridium', pattern: /^IRIDIUM \d/, color: '#7fe3ff', elevation: 10 },
  { name: 'Globalstar', pattern: /^GLOBALSTAR/, color: '#7fe3ff', elevation: 10 },
  { name: 'OneWeb', pattern: /^ONEWEB/, color: '#b693ff', elevation: 25 },
  { name: 'Starlink', pattern: /^STARLINK/, color: '#6fb1ff', elevation: 25 },
  { name: 'O3b', pattern: /^O3B/, color: '#7fe3ff', elevation: 10 },
  { name: 'Orbcomm', pattern: /^ORBCOMM/, color: '#7fe3ff', elevation: 10 },
  { name: 'Planet', pattern: /^(FLOCK|DOVE|SUPERDOVE)/, color: '#ffd966', elevation: 10 },
  { name: 'Spire', pattern: /^LEMUR/, color: '#ffd966', elevation: 10 },
  { name: 'Qianfan', pattern: /^QIANFAN/, color: '#b693ff', elevation: 25 },
  { name: 'Kuiper', pattern: /^KUIPER/, color: '#b693ff', elevation: 25 },
  { name: 'Guowang', pattern: /^(GUOWANG|HULIANWANG)/, color: '#b693ff', elevation: 25 },
];
const MIN_MEMBERS = 3;
const MAX_ORBITS_DRAWN = 300; // matches render/constellation.ts

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

export class ConstellationsPanel {
  private readonly host: ConstellationsHost;
  private readonly pills = el('div', 'quick constellation-pills');
  private readonly controls = el('div', 'constellation-controls is-hidden');
  private readonly orbitsBox = el('input');
  private readonly coverageBox = el('input');
  private readonly elevation = el('div', 'segmented');
  private readonly elevationLabel = el('p', 'field-label', 'A ground user needs it this high above the horizon');
  private readonly summary = el('p', 'note constellation-summary');
  private readonly readout = el('p', 'note constellation-readout');
  private readonly legend = el('div', 'constellation-legend');
  private readonly empty = el('p', 'note', 'No constellations in the loaded data.');
  private members = new Map<string, number[]>(); // constellation name → object indices
  private selected: Kind | null = null;
  private minElevation: 5 | 10 | 25 = 10;
  private lastReadout = -Infinity;

  constructor(container: HTMLElement, host: ConstellationsHost) {
    this.host = host;

    const toggle = (label: string, box: HTMLInputElement) => {
      const row = el('label', 'row-toggle');
      box.type = 'checkbox';
      box.checked = true;
      box.addEventListener('change', () => this.apply());
      row.append(el('span', '', label), box);
      return row;
    };
    for (const degrees of [5, 10, 25] as const) {
      const button = el('button', '', `${degrees}°`);
      button.dataset.value = String(degrees);
      button.addEventListener('click', () => {
        this.minElevation = degrees;
        this.apply();
      });
      this.elevation.append(button);
    }
    for (const band of COVERAGE_BANDS) {
      const item = el('span');
      const swatch = el('i');
      swatch.style.background = `rgb(${band.rgb.join(', ')})`;
      item.append(swatch, band.label);
      this.legend.append(item);
    }
    const clear = el('button', 'link', 'Clear');
    clear.addEventListener('click', () => this.select(null));

    this.controls.append(
      this.summary,
      toggle('Draw the orbits', this.orbitsBox),
      toggle('Coverage on the ground', this.coverageBox),
      this.elevationLabel, this.elevation,
      this.readout, this.legend, clear,
    );
    container.append(
      el('p', 'note', 'Pick one to see all of it at once: its orbits, and how many of its satellites each place on the ground can see.'),
      this.pills, this.empty, this.controls,
    );
    this.catalogChanged();
  }

  /** The catalogue was (re)loaded: recount the members and keep the selection if it still exists. */
  catalogChanged(): void {
    const catalog = this.host.catalog();
    this.members = new Map(KINDS.map((kind) => [kind.name, [] as number[]]));
    if (catalog) {
      for (const sat of catalog.sats) {
        const name = sat.name.toUpperCase();
        const kind = KINDS.find((k) => k.pattern.test(name)); // first match wins
        if (kind) this.members.get(kind.name)!.push(sat.index);
      }
    }
    const present = KINDS.filter((kind) => this.members.get(kind.name)!.length >= MIN_MEMBERS);
    this.pills.replaceChildren(...present.map((kind) => {
      const button = el('button');
      button.dataset.name = kind.name;
      button.append(kind.name, el('span', 'count', fmtInt(this.members.get(kind.name)!.length)));
      button.addEventListener('click', () => this.select(this.selected === kind ? null : kind));
      return button;
    }));
    this.empty.classList.toggle('is-hidden', present.length > 0);
    if (this.selected && !present.includes(this.selected)) this.selected = null;
    this.apply();
  }

  private select(kind: Kind | null): void {
    this.selected = kind;
    if (kind) this.minElevation = kind.elevation; // each kind starts at the elevation its users need
    this.apply();
  }

  /** Push the current choice to the globe and reflect it in the controls. */
  private apply(): void {
    const kind = this.selected;
    for (const button of this.pills.querySelectorAll<HTMLElement>('button')) {
      button.classList.toggle('is-on', button.dataset.name === kind?.name);
      button.setAttribute('aria-pressed', String(button.dataset.name === kind?.name));
    }
    this.controls.classList.toggle('is-hidden', !kind);
    this.lastReadout = -Infinity;
    if (!kind) {
      this.host.highlight(null);
      this.host.show(null, { orbits: false, coverage: false, minElevationDeg: this.minElevation, color: '#7fe3ff' });
      return;
    }
    const members = this.members.get(kind.name)!;
    const orbits = this.orbitsBox.checked, coverage = this.coverageBox.checked;
    for (const button of this.elevation.querySelectorAll<HTMLElement>('button')) {
      button.classList.toggle('is-on', button.dataset.value === String(this.minElevation));
    }
    this.elevation.classList.toggle('is-hidden', !coverage);
    this.elevationLabel.classList.toggle('is-hidden', !coverage);
    this.legend.classList.toggle('is-hidden', !coverage);
    this.readout.classList.toggle('is-hidden', !coverage);
    this.readout.textContent = coverage ? 'Working out the coverage…' : '';
    this.summary.textContent = `${kind.name}: ${fmtInt(members.length)} satellites`
      + (orbits && members.length > MAX_ORBITS_DRAWN ? `, ${MAX_ORBITS_DRAWN} of their orbits drawn.` : '.');
    this.host.highlight(members);
    this.host.show(members, { orbits, coverage, minElevationDeg: this.minElevation, color: kind.color });
  }

  /** Refresh the coverage sentence about once a second. */
  frame(realSeconds: number): void {
    if (!this.selected || !this.coverageBox.checked || realSeconds - this.lastReadout < 1) return;
    this.lastReadout = realSeconds;
    const { coveredFraction, maxInView } = this.host.stats();
    if (maxInView === 0) return; // first numbers not in yet
    const percent = coveredFraction > 0.995 ? 'all' : coveredFraction < 0.005 ? 'under 1%' : `${Math.round(coveredFraction * 100)}%`;
    const text = `Covers ${percent} of the Earth right now; up to ${fmtInt(maxInView)} in view at once.`;
    if (this.readout.textContent !== text) this.readout.textContent = text;
  }
}
