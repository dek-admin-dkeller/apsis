/**
 * The grammar of what can be typed in the search field besides a name: a moment, a clock
 * speed, and which way a switch is being thrown ("turn … on", "hide …").
 *
 * Kept apart from commands.ts and free of anything from the browser, so that it can be tested
 * from Node (`node scripts/test-command.mjs`). The grammar is small on purpose: a phrase
 * either fits one of the shapes below exactly or it is not a time at all. A clever guess that
 * turns out wrong would move the clock somewhere the visitor never asked for.
 *
 *   now
 *   in 2 hours · +90m · -1d · 3 days ago · 1h 30m later      counted from where the clock is
 *   today · tomorrow · yesterday  [clock time]               the real calendar day
 *   2026-12-01 [clock time] · 1 dec [2026] [clock time]      midnight if no time is given
 *   9 pm · 21:00 · 9:30pm · noon · midnight                  the next time the clock reads that
 *
 * Clock times and dates are read on the visitor's chosen clock (UTC or local); adding "utc"
 * at the end forces UTC. The caller supplies that clock as a function, so nothing here knows
 * about time zones beyond "the wall clock is this many milliseconds ahead of UTC right then".
 *
 * (How well a typed phrase fits a name is a separate question, answered in src/ui/searchMatch.ts,
 * which also takes a leading "go to" or "show" off a phrase.)
 */

// ---------------------------------------------------------------- shared text helpers

/** Light clean-up for times and speeds, where + - : . still mean something. */
function tidy(text: string): string {
  return text
    .toLowerCase()
    .replace(/−/g, '-') // a typographic minus
    .replace(/×/g, 'x') // a multiplication sign
    .replace(/([ap])\.m\.?/g, '$1m')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------- the words around a command

/** "turn the monitor on", "hide clouds", "stop autopilot" → what is being switched, and which way. */
export function splitState(phrase: string): { rest: string; state: boolean | undefined } {
  const words = phrase.split(' ');
  if (['turn', 'switch', 'set', 'toggle'].includes(words[0])) words.shift();
  let state: boolean | undefined;
  if (['on', 'enable', 'show', 'start'].includes(words[0])) {
    state = true;
    words.shift();
  } else if (['off', 'disable', 'hide', 'stop', 'leave', 'exit', 'no'].includes(words[0])) {
    state = false;
    words.shift();
  } else if (words.at(-1) === 'on' || words.at(-1) === 'off') state = words.pop() === 'on';
  if (words[0] === 'the') words.shift();
  return { rest: words.join(' '), state: words.length > 0 ? state : undefined };
}

// ---------------------------------------------------------------- times

export interface TimeContext {
  /** The real present, Unix ms. */
  nowMs: number;
  /** What the simulation clock shows, Unix ms. */
  simMs: number;
  /** How far the visitor's chosen clock is ahead of UTC at that instant, ms (0 for UTC). */
  shiftMs: (utcMs: number) => number;
}

export interface ParsedTime {
  ms: number;
  /** "now" was typed: go back to the present at normal speed, rather than only moving the clock. */
  now: boolean;
}

const SECOND = 1000, MINUTE = 60 * SECOND, HOUR = 60 * MINUTE, DAY = 24 * HOUR;

/** Unit word → its length in ms. A hash table: one lookup per word typed. */
const UNITS = new Map<string, number>();
for (const [ms, words] of [
  [SECOND, 's sec secs second seconds'],
  [MINUTE, 'm min mins minute minutes'],
  [HOUR, 'h hr hrs hour hours'],
  [DAY, 'd day days'],
  [7 * DAY, 'w wk wks week weeks'],
] as [number, string][]) {
  for (const word of words.split(' ')) UNITS.set(word, ms);
}

/** Month name (short or full) → 0 … 11. */
const MONTHS = new Map<string, number>();
['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'].forEach((name, index) => {
  MONTHS.set(name, index);
  MONTHS.set(name.slice(0, 3), index);
});
MONTHS.set('sept', 8);

const NAMED_DAYS = new Map<string, number>([['today', 0], ['tomorrow', 1], ['yesterday', -1]]);

/** The words people put in front of a time: "set the clock to …", "jump to …", "at …". */
const LEAD = /^(?:(?:go|jump|skip|move|set)\s+)?(?:(?:the\s+)?(?:clock|time|date)\s+)?(?:to\s+)?(?:at\s+)?/;

/** "1h 30m", "2 hours", "an hour and 10 minutes" → ms; null if any part is not an amount and a unit. */
function parseSpan(text: string): number | null {
  const part = /^(?:(\d+(?:\.\d+)?)\s*|an?\s+)([a-z]+)(?:\s+and)?\s*/;
  let total = 0, rest = text, parts = 0;
  while (rest) {
    const m = part.exec(rest);
    const unit = m ? UNITS.get(m[2]) : undefined;
    if (!m || unit === undefined) return null;
    total += (m[1] === undefined ? 1 : Number(m[1])) * unit;
    rest = rest.slice(m[0].length);
    parts++;
  }
  return parts > 0 ? total : null;
}

/** A signed offset: "in 2 hours", "+90m", "-1d", "3 days ago", "1h 30m later". */
function parseOffset(text: string): number | null {
  let m: RegExpExecArray | null;
  let sign = 1, span: string;
  if ((m = /^in\s+(.+)$/.exec(text))) span = m[1];
  else if ((m = /^([+-])\s*(.+)$/.exec(text))) {
    sign = m[1] === '-' ? -1 : 1;
    span = m[2];
  } else if ((m = /^(.+?)\s+(?:ago|earlier|back)$/.exec(text))) {
    sign = -1;
    span = m[1];
  } else if ((m = /^(.+?)\s+(?:from now|later|ahead|forward|forwards)$/.exec(text))) span = m[1];
  else return null;
  const ms = parseSpan(span);
  return ms === null ? null : sign * ms;
}

interface ClockTime { h: number; m: number; s: number }

/**
 * "21:00", "9:30pm", "9 pm", "noon", "midnight". An hour on its own ("9") is refused: it
 * could as easily be a catalogue number, and there is no telling morning from evening.
 */
function parseClock(text: string): ClockTime | null {
  if (text === 'midnight') return { h: 0, m: 0, s: 0 };
  if (text === 'noon' || text === 'midday') return { h: 12, m: 0, s: 0 };
  const m = /^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)?$/.exec(text);
  if (!m || (m[2] === undefined && m[4] === undefined)) return null;
  let h = Number(m[1]);
  const minute = Number(m[2] ?? 0), second = Number(m[3] ?? 0);
  if (m[4]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[4] === 'pm' ? 12 : 0); // 12 am is 00:00, 12 pm is 12:00
  } else if (h > 23) return null;
  if (minute > 59 || second > 59) return null;
  return { h, m: minute, s: second };
}

const validDate = (y: number, month: number, d: number): boolean => {
  if (y < 1957 || y > 2100) return false; // the space age, give or take
  const date = new Date(Date.UTC(y, month, d));
  return date.getUTCMonth() === month && date.getUTCDate() === d; // 31 Feb would have rolled over
};

/** A typed time → the moment it means, or null if the text is not one of the shapes in the header. */
export function parseTime(text: string, ctx: TimeContext): ParsedTime | null {
  let s = tidy(text).replace(LEAD, '');
  let shift = ctx.shiftMs;
  const zone = /^(.*\S)\s+utc$/.exec(s) ?? /^(.*\d)z$/.exec(s);
  if (zone) {
    s = zone[1];
    shift = () => 0;
  }
  if (!s) return null;
  if (/^(?:now|right now|present|the present|live)$/.test(s)) return { ms: ctx.nowMs, now: true };

  // Offsets move the clock from where it is, so "+1h" twice goes two hours on.
  const offset = parseOffset(s);
  if (offset !== null) return { ms: ctx.simMs + offset, now: false };

  /** The date and time a clock on the chosen zone would show at `utcMs` (read its UTC fields). */
  const wall = (utcMs: number) => new Date(utcMs + shift(utcMs));
  /**
   * The other way: what a wall clock reads → the moment. The shift depends on the moment
   * itself (daylight saving), so guess with the shift at the wall time and correct once.
   */
  const moment = (y: number, month: number, d: number, clock: ClockTime): number => {
    const reading = Date.UTC(y, month, d, clock.h, clock.m, clock.s);
    return reading - shift(reading - shift(reading));
  };

  const words = s.replace(/^(\d{4}-\d{1,2}-\d{1,2})t(?=\d)/, '$1 ').split(' ').filter((word) => word !== 'at' && word !== 'on');
  const today = wall(ctx.nowMs);
  let date: { y: number; month: number; d: number } | null = null;
  let named = false; // today / tomorrow / yesterday
  let used = 0;

  const dayNumber = (word: string | undefined): number | null => {
    const m = /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(word ?? '');
    return m ? Number(m[1]) : null;
  };
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(words[0]);
  if (NAMED_DAYS.has(words[0])) {
    // Date.UTC carries a day past the end of the month over into the next one.
    date = { y: today.getUTCFullYear(), month: today.getUTCMonth(), d: today.getUTCDate() + NAMED_DAYS.get(words[0])! };
    named = true;
    used = 1;
  } else if (iso) {
    date = { y: Number(iso[1]), month: Number(iso[2]) - 1, d: Number(iso[3]) };
    used = 1;
  } else {
    // "1 dec" or "dec 1", optionally followed by a year; without one, this year.
    const dayFirst = dayNumber(words[0]) !== null && MONTHS.has(words[1] ?? '');
    const monthFirst = MONTHS.has(words[0]) && dayNumber(words[1]) !== null;
    if (dayFirst || monthFirst) {
      const d = dayNumber(words[dayFirst ? 0 : 1])!;
      const month = MONTHS.get(words[dayFirst ? 1 : 0])!;
      const hasYear = /^\d{4}$/.test(words[2] ?? '');
      date = { y: hasYear ? Number(words[2]) : today.getUTCFullYear(), month, d };
      used = hasYear ? 3 : 2;
    }
  }
  if (date && !named && !validDate(date.y, date.month, date.d)) return null;

  const rest = words.slice(used).join(' ');
  const clock = rest ? parseClock(rest) : null;
  if (rest && !clock) return null; // something was typed after the date that is not a time
  if (!date && !clock) return null;

  if (date) {
    // A named day without a time means "this time tomorrow"; a written date means its first moment.
    const at = clock ?? (named ? { h: today.getUTCHours(), m: today.getUTCMinutes(), s: today.getUTCSeconds() } : { h: 0, m: 0, s: 0 });
    return { ms: moment(date.y, date.month, date.d, at), now: false };
  }
  // Only a clock time: the next time the simulation clock reads it (so "midnight" is the coming one).
  const sim = wall(ctx.simMs);
  const sameDay = moment(sim.getUTCFullYear(), sim.getUTCMonth(), sim.getUTCDate(), clock!);
  if (sameDay >= ctx.simMs) return { ms: sameDay, now: false };
  return { ms: moment(sim.getUTCFullYear(), sim.getUTCMonth(), sim.getUTCDate() + 1, clock!), now: false };
}

// ---------------------------------------------------------------- clock speed

/** The fastest a typed speed will set: the top of the time bar's own range, beyond which motion between snapshots stops looking right. */
export const MAX_SPEED = 1000;
const MIN_SPEED = 0.01;

export type SpeedWord =
  | { kind: 'set'; speed: number; clamped: boolean } // negative = backwards
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'reverse' };

/**
 * "100x", "x10", "speed 10", "-10x", "0.5x", "pause", "play", "real time", "backwards".
 * A number on its own is not a speed: it needs the x or the word "speed".
 */
export function parseSpeed(text: string): SpeedWord | null {
  const s = tidy(text);
  if (/^(?:pause|stop|freeze|pause (?:time|the clock)|stop (?:time|the clock))$/.test(s)) return { kind: 'pause' };
  if (/^(?:play|resume|continue|unpause)$/.test(s)) return { kind: 'resume' };
  if (/^(?:real ?time|real time speed|normal speed)$/.test(s)) return { kind: 'set', speed: 1, clamped: false };
  if (/^(?:reverse|backwards?|rewind|run (?:time )?backwards?)$/.test(s)) return { kind: 'reverse' };
  const m = /^(?:(?:set\s+)?(?:the\s+)?(speed|rate)\s+(?:to\s+)?)?(x\s*)?([+-]?\d+(?:\.\d+)?)\s*(x|times)?$/.exec(s);
  if (!m || !(m[1] || m[2] || m[4])) return null;
  const value = Number(m[3]);
  if (value === 0) return { kind: 'pause' };
  const size = Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.abs(value)));
  return { kind: 'set', speed: Math.sign(value) * size, clamped: size !== Math.abs(value) };
}
