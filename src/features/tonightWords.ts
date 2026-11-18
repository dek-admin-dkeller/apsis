/**
 * The words for "Visible tonight": directions, heights and brightness as phrases a
 * first-time skywatcher can act on ("north-west, about halfway up"). Kept apart from the
 * maths (data/visibility.ts) and from the list (features/tonight.ts) so the wording can be
 * read, and changed, in one place.
 */

import type { PassEdge, SkyPoint, VisiblePass } from '../data/visibility.ts';

const DIRECTIONS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** Compass direction in a full word (azimuth 0 = north, 90 = east). */
export const compassWord = (azDeg: number): string => DIRECTIONS[Math.round((((azDeg % 360) + 360) % 360) / 45) % 8];

/** Height above the horizon as a share of the way from horizon (0°) to overhead (90°). */
export function heightWords(elDeg: number): string {
  if (elDeg >= 75) return 'almost overhead';
  if (elDeg >= 55) return 'high up';
  if (elDeg >= 35) return 'about halfway up';
  if (elDeg >= 20) return 'about a third of the way up';
  return 'low above the horizon';
}

/** "north-west, about halfway up". Straight overhead a compass direction means little, so it is left out. */
export const whereWords = (point: SkyPoint): string =>
  point.elDeg >= 80 ? 'almost overhead' : `${compassWord(point.azDeg)}, ${heightWords(point.elDeg)}`;

/**
 * An estimated magnitude in everyday terms. The steps follow familiar things in the sky:
 * Venus and Jupiter are brighter than −2.5; the handful of brightest stars lie between −1.5
 * and +0.5; the stars of the Plough are about +2; +4 is lost under street lights; +6 is the
 * limit of the eye under a truly dark sky.
 */
export function brightnessWords(estimate: number): string {
  const magnitude = Math.round(estimate * 10) / 10; // judge the number as it is shown, so "+2.5" always gets the same words
  if (magnitude <= -2.5) return 'Brilliant, brighter than any star';
  if (magnitude <= 0.5) return 'As bright as the brightest stars';
  if (magnitude <= 2.5) return 'Easy to see';
  if (magnitude <= 4) return 'Modest, best away from street lights';
  return 'Faint, needs a dark sky';
}

/** "−3.4" with a real minus sign, "+2.1" for the faint side: the sign matters and is easy to misread. */
export const magnitudeText = (magnitude: number): string =>
  `${magnitude < -0.05 ? '−' : magnitude > 0.05 ? '+' : ''}${Math.abs(magnitude).toFixed(1)}`;

const START: Record<PassEdge, { label: string; note: string }> = {
  horizon: { label: 'Rises', note: '' },
  shadow: { label: 'Appears', note: 'coming out of the Earth\'s shadow' },
  twilight: { label: 'First seen', note: 'as the sky gets dark enough' },
  window: { label: 'In view', note: 'already crossing the sky' },
};
const END: Record<PassEdge, { label: string; note: string }> = {
  horizon: { label: 'Sets', note: '' },
  shadow: { label: 'Fades', note: 'into the Earth\'s shadow' },
  twilight: { label: 'Lost', note: 'as the sky brightens' },
  window: { label: 'Still up', note: 'when the 24 hours end' },
};

export interface PathRow {
  label: string;
  text: string;
}

/**
 * Where to look, as two or three short rows: where it comes into view, its highest point,
 * where it goes. A pass that begins or ends at its highest point (it came out of the shadow
 * already high, or faded while still climbing) says so on that row instead of repeating it.
 */
export function pathRows(pass: VisiblePass): PathRow[] {
  const peakAtStart = pass.peakMs <= pass.startMs, peakAtEnd = pass.peakMs >= pass.endMs;
  const row = (edge: { label: string; note: string }, point: SkyPoint, isPeak: boolean, atHorizon: boolean): PathRow => ({
    label: edge.label,
    // Rising and setting happen at the 10° line by definition, so only the direction is news.
    text: [atHorizon ? `in the ${compassWord(point.azDeg)}` : whereWords(point), edge.note, isPeak ? 'its highest point' : ''].filter(Boolean).join(', '),
  });
  const rows = [row(START[pass.startWhy], pass.start, peakAtStart, pass.startWhy === 'horizon')];
  if (!peakAtStart && !peakAtEnd) rows.push({ label: 'Highest', text: whereWords(pass.peak) });
  rows.push(row(END[pass.endWhy], pass.end, peakAtEnd, pass.endWhy === 'horizon'));
  return rows;
}

/** One line for a message: "look west, low above the horizon". */
export const lookHint = (pass: VisiblePass): string => `look ${whereWords(pass.start)}`;
