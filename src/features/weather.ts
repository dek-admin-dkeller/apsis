/**
 * Space weather and rough re-entry estimates (reserved element: #weather-body, at the top of
 * the Objects panel's "Lowest orbits" section).
 *
 * Two readings from NOAA, in plain words — how active the Sun is and how disturbed the
 * Earth's magnetic field is — and what they mean for the objects listed underneath: both
 * heat the upper air, heated air swells, and low satellites then come down faster.
 *
 * The readings are downloaded the first time the section is opened and at most once per
 * session (data/spaceWeather.ts keeps a copy for three hours). The solar flux is also handed
 * to the list of lowest objects (ui/feed.ts → data/decay.ts), where it shapes the outlook of
 * the "time left" estimates. Those estimates do not need it: with NOAA out of reach they
 * assume an average Sun, and one line here says so.
 */

import './weather.css';
import { airDensity, exosphereTempK } from '../data/decay.ts';
import { cachedSpaceWeather, isFresh, kpWords, loadSpaceWeather, type SpaceWeather } from '../data/spaceWeather.ts';
import type { App } from '../ui/app.ts';
import { $, fmt } from '../ui/dom.ts';
import { setDecayWeather } from '../ui/feed.ts';
import { clockStamp, duration } from '../ui/inspector.ts';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

/** Today's flux against its own recent average. */
function fluxWords(flux: number, mean: number | null): string {
  if (mean === null) return flux < 90 ? 'a quiet Sun' : flux < 150 ? 'a moderately active Sun' : 'an active Sun';
  const ratio = flux / mean;
  if (ratio > 1.25) return 'well above average';
  if (ratio > 1.08) return 'a little above average';
  if (ratio < 0.8) return 'well below average';
  if (ratio < 0.92) return 'a little below average';
  return 'about average';
}

/**
 * The K index that describes the air right now. The upper air heats within hours of a
 * magnetic storm and takes about a day to cool, so the day's peak still counts: half-way
 * between the latest value and that peak.
 */
function lingeringKp(weather: SpaceWeather): number | null {
  if (weather.kp === null) return null;
  return weather.kpPeak === null ? weather.kp : (weather.kp + Math.max(weather.kp, weather.kpPeak)) / 2;
}

/**
 * How dense the air at 300 km is today compared with an ordinary day of the last three
 * months (average flux, calm magnetic field), using the same simple model as the estimates.
 * 300 km is where the objects in the list spend their last weeks.
 */
function airThickness(weather: SpaceWeather): number | null {
  const mean = weather.fluxMean ?? weather.flux;
  if (mean === null) return null; // without the Sun's reading there is no "usual" to compare with
  const usual = airDensity(300, exosphereTempK(mean, mean));
  const today = airDensity(300, exosphereTempK(weather.flux ?? mean, mean, lingeringKp(weather) ?? undefined));
  return today / usual;
}

function meaningWords(ratio: number): string {
  if (ratio >= 2) return 'The upper air is much thicker than usual today: low satellites are coming down a good deal faster.';
  if (ratio >= 1.35) return 'The upper air is thicker than usual today: low satellites are coming down faster.';
  if (ratio <= 0.75) return 'The upper air is thinner than usual today: low satellites are coming down more slowly.';
  return 'The upper air is about as thick as usual today: low satellites are coming down at their usual pace.';
}

export function installWeather(app: App): void {
  const body = $('weather-body');
  if (!body) return;
  const section = body.closest('details');

  const fluxValue = el('dd', 'plain'), kpValue = el('dd', 'plain');
  const fluxRow = el('div'), kpRow = el('div');
  fluxRow.append(el('dt', '', 'Sun’s radio flux'), fluxValue);
  kpRow.append(el('dt', '', 'Earth’s magnetic field'), kpValue);
  const readings = el('dl', 'kv is-hidden');
  readings.append(fluxRow, kpRow);
  const meaning = el('p', 'note');
  const about = el('p', 'note');
  body.append(readings, meaning, about);

  let weather: SpaceWeather | null = null;
  let status: 'waiting' | 'reading' | 'done' = 'waiting';

  const render = (): void => {
    const guide = 'Beside each name: a rough time left in orbit, worked out from its own sinking rate. '
      + 'It could easily be half or double, and thrusters can change it at will.';
    if (!weather) {
      readings.classList.add('is-hidden');
      meaning.textContent = status === 'reading' ? 'Reading today’s space weather…'
        : status === 'done' ? 'Today’s space weather could not be read, so the estimates assume an average Sun.' : '';
      about.textContent = guide;
      return;
    }
    readings.classList.remove('is-hidden');
    fluxRow.classList.toggle('is-hidden', weather.flux === null);
    kpRow.classList.toggle('is-hidden', weather.kp === null);
    if (weather.flux !== null) {
      fluxValue.textContent = `${fmt(weather.flux, 0)}, ${fluxWords(weather.flux, weather.fluxMean)}`;
      fluxRow.title = 'How bright the Sun is at a wavelength of 10.7 cm, which rises and falls with the ultraviolet that heats the upper air. '
        + (weather.fluxMean !== null ? `Its average over the last three months is ${fmt(weather.fluxMean, 0)}. ` : '')
        + 'About 70 is a quiet Sun; 200 or more is a very active one.';
    }
    if (weather.kp !== null) {
      const stormEarlier = weather.kpPeak !== null && weather.kpPeak >= 5 && weather.kp < 5;
      kpValue.textContent = `${kpWords(weather.kp)} (Kp ${fmt(weather.kp, 1)})${stormEarlier ? ', after a storm in the past day' : ''}`;
      kpRow.title = 'The planetary K index: how disturbed the Earth’s magnetic field is, from 0 (calm) to 9 (extreme). A magnetic storm heats the upper air for a day or so.';
    }
    const ratio = airThickness(weather);
    const storm = (lingeringKp(weather) ?? 0) >= 5;
    // Where the readings come from and when, kept short: "(NOAA, 18 Nov 17:17 UTC)".
    const source = isFresh(weather) ? `(NOAA, ${clockStamp(weather.at)})`
      : `(NOAA, ${clockStamp(weather.at)}, ${duration(Date.now() - weather.at)} ago; a newer reading could not be fetched)`;
    meaning.textContent = (ratio === null ? '' : `${meaningWords(ratio)} `)
      + (storm ? 'During a magnetic storm the lowest objects can come down sooner than estimated. ' : '')
      + source;
    about.textContent = guide;
  };

  const use = (next: SpaceWeather | null): void => {
    weather = next;
    // The estimates take the flux only when both today's value and its average are known.
    setDecayWeather(next && next.flux !== null && next.fluxMean !== null ? { fluxNow: next.flux, fluxMean: next.fluxMean } : null);
    render();
  };

  // A copy saved in the last three hours costs nothing to use, so the estimates start with it.
  const saved = cachedSpaceWeather();
  if (saved && isFresh(saved)) {
    status = 'done';
    use(saved);
  } else render();

  // Otherwise ask NOAA once, and only when somebody actually opens the section.
  const opened = (): void => {
    if (!section?.open || status !== 'waiting') return;
    status = 'reading';
    render();
    void loadSpaceWeather().then((loaded) => {
      status = 'done';
      use(loaded);
    });
  };
  section?.addEventListener('toggle', opened);
  opened();

  // The time of the reading is written on the chosen clock.
  app.onSettings((_settings, changed) => {
    if (changed === 'clockZone') render();
  });
}
