/**
 * Settings: what is drawn, how it looks, and where the ground station is. Every control
 * anywhere in the page that carries a `data-setting` attribute edits the setting of that
 * name, so this file wires them all up generically (several controls may share one
 * setting — the Layers panel and the inspector both toggle the orbit path). Choices are
 * remembered in localStorage.
 */

import type { ColorMode } from '../render/satellites.ts';
import type { Quality } from '../render/scene.ts';
import { $ } from './dom.ts';
import type { LabelMode } from './labels.ts';

export interface Settings {
  colorMode: ColorMode;
  labels: LabelMode;
  pointSize: number;
  glow: number;
  // selected object
  orbitPath: boolean;
  groundTrack: boolean;
  footprint: boolean;
  model: boolean;
  autoOrbit: boolean;
  // Earth
  earthDrift: boolean;
  siteMarker: boolean;
  aurora: boolean;
  clouds: boolean;
  sharpGround: boolean; // stream detailed imagery when zoomed in
  atmosphere: boolean;
  borders: boolean;
  graticule: boolean;
  terminator: boolean;
  // sky
  stars: boolean;
  constellations: boolean;
  planets: boolean;
  skyLabels: boolean;
  // rendering
  glass: boolean;
  quietUi: boolean; // bars fade back when no panel is open and the pointer is elsewhere
  quality: 'auto' | Quality;
  // ground station
  siteName: string;
  siteLat: number;
  siteLon: number;
}

const DEFAULTS: Settings = {
  colorMode: 'category',
  labels: 'nearby',
  pointSize: 1,
  glow: 0.6,
  orbitPath: true,
  groundTrack: true,
  footprint: true,
  model: true,
  autoOrbit: true,
  earthDrift: true,
  siteMarker: true,
  aurora: false,
  clouds: true,
  sharpGround: true,
  atmosphere: true,
  borders: false,
  graticule: false,
  terminator: false,
  stars: true,
  constellations: true,
  planets: true,
  skyLabels: true,
  glass: true,
  quietUi: true,
  quality: 'auto',
  siteName: 'High Point, NC',
  siteLat: 35.97,
  siteLon: -79.99,
};
const STORAGE_KEY = 'orbithash.settings.v2';

export class SettingsStore {
  readonly settings: Settings;
  private readonly apply: (settings: Settings, changed: keyof Settings | null) => void;
  private readonly groups = [...document.querySelectorAll<HTMLElement>('.segmented[data-setting]')];
  private readonly inputs = [...document.querySelectorAll<HTMLInputElement>('input[data-setting]')];

  /** `apply` is called once at start-up (changed = null) and again after every change. */
  constructor(apply: (settings: Settings, changed: keyof Settings | null) => void) {
    this.apply = apply;
    let saved: Partial<Settings> = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Settings>;
    } catch { /* corrupted or unavailable storage → defaults */ }
    this.settings = { ...DEFAULTS, ...saved };

    for (const group of this.groups) {
      for (const button of group.querySelectorAll('button')) {
        button.addEventListener('click', () => this.set(group.dataset.setting as keyof Settings, button.dataset.value!));
      }
    }
    for (const input of this.inputs) {
      const key = input.dataset.setting as keyof Settings;
      if (input.type === 'checkbox') input.addEventListener('change', () => this.set(key, input.checked));
      else if (input.type === 'range') input.addEventListener('input', () => this.set(key, Number(input.value)));
      else if (input.type === 'number') {
        input.addEventListener('change', () => {
          const value = Math.min(Number(input.max), Math.max(Number(input.min), Number(input.value)));
          this.set(key, Number.isFinite(value) ? value : (DEFAULTS[key] as number));
        });
      } else input.addEventListener('change', () => this.set(key, input.value.trim()));
      if (input.type !== 'checkbox' && input.type !== 'range') {
        input.addEventListener('keydown', (event) => event.stopPropagation()); // typing must not trigger shortcuts
      }
    }
    $('display-reset').addEventListener('click', () => {
      Object.assign(this.settings, DEFAULTS);
      this.changed(null);
    });
    this.changed(null);
  }

  set(key: keyof Settings, value: string | number | boolean): void {
    (this.settings as unknown as Record<string, unknown>)[key] = value;
    this.changed(key);
  }

  /** Reflect the settings in every control, save them, and apply them to the scene. */
  private changed(key: keyof Settings | null): void {
    const s = this.settings as unknown as Record<string, string | number | boolean>;
    for (const group of this.groups) {
      for (const button of group.querySelectorAll('button')) {
        button.classList.toggle('is-on', button.dataset.value === s[group.dataset.setting!]);
      }
    }
    for (const input of this.inputs) {
      if (input.type === 'checkbox') input.checked = Boolean(s[input.dataset.setting!]);
      else if (document.activeElement !== input || key === null) input.value = String(s[input.dataset.setting!]);
    }
    $('size-label').textContent = `${Math.round(this.settings.pointSize * 100)}%`;
    $('glow-label').textContent = this.settings.glow < 0.02 ? 'off' : `${Math.round(this.settings.glow * 100)}%`;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch { /* private mode: settings simply are not remembered */ }
    this.apply(this.settings, key);
  }

  setFps(fps: number, quality: Quality): void {
    $('fps-label').textContent = `${Math.round(fps)} fps, ${quality}`;
    $('sb-fps').textContent = `${Math.round(fps)} fps`;
  }
}
