/**
 * The command bar: press Ctrl+K (Cmd+K on a Mac), then type an object, a place, a time, a
 * speed or an action. It builds its own overlay; no element is reserved for it in index.html.
 * Anything on the page that carries the attribute `data-command-open` opens it as well.
 *
 * Every row says in words what it is about to do ("Go to Tokyo, Japan", "Set the clock to
 * 19 Nov 21:00 UTC") before anything happens, and nothing runs until a row is chosen. What
 * can be typed:
 *
 *   an object     a name or a catalogue number          → app.search, then app.select
 *   a place       "tokyo", "go to cairo"                → src/data/places.ts, app.flyToGround
 *   a time        "tomorrow 9 pm", "+90m", "now" …      → commandParse.ts, app.jumpTo
 *   a speed       "100x", "pause", "real time"          → commandParse.ts, app.setSpeed
 *   an action     "monitor on", "sky view", "miles" …   → the table in buildCommands below
 *
 * The keyboard: this module cannot touch the app's own shortcut handler, so it listens on
 * `window` in the capture phase, which runs first. While the bar is closed it takes only its
 * opening shortcut; while it is open it stops every key there, so that typing "c" in the box
 * can never switch the monitor on behind it.
 */

import './command.css';
import { PLACES, type Place } from '../data/places.ts';
import { CATEGORY_COLORS } from '../data/types.ts';
import type { App, PanelName, Toggle, ViewName } from '../ui/app.ts';
import { fmt, fmtInt } from '../ui/dom.ts';
import { clockShiftMs, clockStamp, duration } from '../ui/inspector.ts';
import type { Settings } from '../ui/settings.ts';
import { MAX_SPEED, matchScore, normalize, parseSpeed, parseTime } from './commandParse.ts';

const MAX_ROWS = 8;
/** Shown while the box is empty; each is run through the same code as typed text, so the examples cannot drift from the grammar. */
const EXAMPLES = ['iss', 'go to tokyo', 'tomorrow 9 pm', 'in 2 hours', '100x', 'monitor on', 'colour by altitude', 'geo ring'];

/** One row of the list: what would happen, and how to make it happen. */
interface Result {
  kind: string; // the small label on the left: Object, Place, Time …
  text: string; // what choosing the row will do, in words
  hint?: string; // a detail on the right: a catalogue number, coordinates, "in use now"
  dot?: string; // colour of the dot in front of an object's name
  score: number;
  run: () => void;
  said?: string; // confirmation shown afterwards, for effects that are easy to miss on screen
}
type Outcome = Omit<Result, 'kind' | 'score'>;

interface Command {
  kind: string;
  phrases: string[]; // the ways of typing it, normalised
  takesState: boolean; // understands "… on" and "… off"
  /** `state` is what the visitor asked for (on / off), or undefined if they did not say. */
  make: (state: boolean | undefined) => Outcome;
}

/** The names of the settings that are plain switches. */
type Flag = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

const speedText = (speed: number): string => `${Math.abs(speed) >= 1 ? fmtInt(Math.abs(speed)) : String(Math.abs(speed))}×`;
const coordinates = (place: Place): string =>
  `${fmt(Math.abs(place.lat), 1)}° ${place.lat >= 0 ? 'N' : 'S'}, ${fmt(Math.abs(place.lon), 1)}° ${place.lon >= 0 ? 'E' : 'W'}`;

/** "go to cairo" → "cairo": the verb says what kind of thing follows, the rest is what to look for. */
const VERB = /^(?:please )?(?:go to|goto|go|fly to|fly over|take me to|jump to|zoom to|show me|show|open|find|select|look at|view|switch to|use) (?:the )?/;

/** "turn the monitor on", "hide clouds", "stop autopilot" → what is being switched, and which way. */
function splitState(query: string): { rest: string; state: boolean | undefined } {
  const words = query.split(' ');
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

export function installCommand(app: App): void {
  let lastSpeed = 1; // the speed to return to after "pause" (the app reports 0 while paused)

  // ---------------------------------------------------------------- the actions and settings

  const commands: Command[] = [];
  const add = (kind: string, phrases: string, takesState: boolean, make: Command['make']): void => {
    commands.push({ kind, phrases: phrases.split(',').map(normalize), takesState, make });
  };

  function buildCommands(): void {
    // things that are on or off
    const onOff = (what: Toggle, phrases: string, on: string, off: string, either: () => string): void => {
      add('Action', phrases, true, (state) => ({ text: state === undefined ? either() : state ? on : off, run: () => app.toggle(what, state) }));
    };
    onOff('monitor', 'monitor,close approach monitor,conjunction monitor,screening',
      'Switch the close-approach monitor on', 'Switch the close-approach monitor off', () => 'Switch the close-approach monitor on or off');
    onOff('cells', 'screening cells,cells,hash grid,hash cells,grid cells',
      'Show the screening cells', 'Hide the screening cells', () => 'Show or hide the screening cells');
    onOff('autopilot', 'autopilot,autopilot tour,auto pilot,demo',
      'Start the autopilot tour', 'Stop the autopilot tour', () => 'Start or stop the autopilot tour');
    onOff('fullscreen', 'full screen,fullscreen',
      'Enter full screen', 'Leave full screen', () => (document.fullscreenElement ? 'Leave full screen' : 'Enter full screen'));

    // Views one steps into. The app cannot be asked whether one is open, so the plain phrase
    // always means "go in" (harmless if already there) and only an explicit "off" leaves.
    add('View', 'sky view,sky,sky from my location,look up', true, (state) => (state === false
      ? { text: 'Leave the sky view', run: () => app.toggle('sky', false) }
      : { text: 'Stand at the ground station and look up at the sky', hint: app.settings().siteName, run: () => app.toggle('sky', true) }));
    add('View', 'ride along,ride,first person', true, (state) => {
      const sat = app.selected();
      if (state === false) return { text: 'Stop riding along', run: () => app.toggle('ride', false) };
      if (!sat) return { text: 'Ride along with an object', hint: 'select one first', run: () => app.toast('Select an object first, then ride along with it.') };
      return { text: `Ride along with ${sat.name}`, run: () => app.toggle('ride', true) };
    });

    // things that open
    const opens = (what: Toggle, phrases: string, text: string): void => add('Action', phrases, false, () => ({ text, run: () => app.toggle(what, true) }));
    opens('howto', 'how it works,how does it work,walkthrough,hashing,explain', 'Open How it works, the walkthrough of the hashing');
    opens('keys', 'shortcuts,keyboard shortcuts,keys,controls,help', 'Show the controls and keyboard shortcuts');
    opens('share', 'share,share link,link,qr code', 'Share this view as a link or a QR code');

    const view = (which: ViewName, phrases: string, text: string): void => add('View', phrases, false, () => ({ text, run: () => app.view(which) }));
    view('home', 'home,reset,reset view', 'Go home: the whole Earth, the present, everything closed');
    view('earth', 'earth,whole earth,earth view,globe', 'View the whole Earth');
    view('leo', 'low orbit,leo,low earth orbit', 'View low Earth orbit from close up');
    view('geo', 'geo ring,geo,geostationary ring,geostationary', 'View the geostationary ring from above the pole');
    view('moon', 'earth and moon,moon', 'View the Earth with the Moon beyond it');

    const panel = (name: PanelName, phrases: string, text: string): void => add('Panel', phrases, false, () => ({ text, run: () => app.openPanel(name) }));
    panel('objects', 'objects,objects panel,filters', 'Open the Objects panel');
    panel('layers', 'layers,layers panel,map layers', 'Open the Layers panel');
    panel('conj', 'close approaches,close approach panel,conjunctions', 'Open the Close-approach monitor panel');
    panel('settings', 'settings,settings panel,preferences,options', 'Open the Settings panel');
    add('Panel', 'close panel,close panels,close the panel', false, () => ({ text: 'Close the open panel', run: () => app.openPanel(null) }));

    add('Action', 'deselect,clear selection,unselect', false, () => {
      const sat = app.selected();
      return { text: sat ? `Deselect ${sat.name}` : 'Deselect', hint: sat ? '' : 'nothing is selected', run: () => app.select(null) };
    });

    // settings with a fixed set of choices: only the values `Settings` allows can be written here
    // (`said` is the confirmation afterwards: what is now the case, where `text` was what would be done)
    function choice<K extends keyof Settings>(name: K, value: Settings[K], phrases: string, text: string, said: string): void {
      add('Setting', phrases, false, () => ({ text, hint: app.settings()[name] === value ? 'in use now' : '', run: () => app.setSetting(name, value), said }));
    }
    choice('units', 'metric', 'kilometres,kilometers,km,metric,units kilometres,units km,units metric', 'Show distances in kilometres', 'Distances are in kilometres');
    choice('units', 'imperial', 'miles,mi,imperial,units miles,units imperial', 'Show distances in miles', 'Distances are in miles');
    choice('clockZone', 'utc', 'utc,utc time,clock utc,times in utc,time zone utc', 'Show times in UTC', 'Times are in UTC');
    choice('clockZone', 'local', 'local time,local,my time,clock local,times in local time,time zone local', 'Show times in my local time', 'Times are in your local time');

    const colours: [Settings['colorMode'], string, string][] = [
      ['category', 'type', 'type,category,kind'],
      ['orbit', 'orbit', 'orbit,orbit regime'],
      ['altitude', 'altitude', 'altitude,height'],
      ['owner', 'owner', 'owner,operator,country'],
      ['age', 'launch year', 'launch year,age,year'],
      ['tilt', 'tilt', 'tilt,inclination'],
    ];
    for (const [mode, label, words] of colours) {
      const phrases = words.split(',').flatMap((word) => [`colour by ${word}`, `color by ${word}`, `colour ${word}`, `color ${word}`]);
      choice('colorMode', mode, phrases.join(','), `Colour the objects by ${label}`, `Objects are coloured by ${label}`);
    }
    choice('labels', 'off', 'name tags off,labels off,names off,no name tags,no labels,hide name tags', 'Name tags off', 'Name tags are off');
    choice('labels', 'notable', 'name tags well known,labels well known,name tags famous,well known names', 'Name tags on well-known spacecraft only', 'Name tags are on well-known spacecraft only');
    choice('labels', 'nearby', 'name tags as you zoom,labels as you zoom,name tags on,labels on,name tags zoom', 'Name tags that appear as you zoom in', 'Name tags appear as you zoom in');
    choice('quality', 'auto', 'quality auto,graphics auto,graphics quality auto', 'Let the tracker choose the graphics quality', 'Graphics quality is chosen automatically');
    for (const quality of ['high', 'balanced', 'fast'] as const) {
      choice('quality', quality, `quality ${quality},graphics ${quality},graphics quality ${quality}`, `Set the graphics quality to ${quality}`, `Graphics quality is ${quality}`);
    }

    // settings that are plain switches, named as they are in the Layers and Settings panels
    const flag = (name: Flag, phrases: string, label: string): void => {
      add('Layer', phrases, true, (state) => {
        const now = app.settings()[name];
        const on = state ?? !now; // not said which way: the other way from now
        return { text: `${label} ${on ? 'on' : 'off'}`, hint: now === on ? `already ${on ? 'on' : 'off'}` : '', run: () => app.setSetting(name, on), said: `${label}: ${on ? 'on' : 'off'}` };
      });
    };
    flag('orbitPath', 'orbit path,orbit line,path', 'Orbit path');
    flag('groundTrack', 'ground track,track', 'Ground track');
    flag('footprint', 'coverage footprint,footprint,coverage', 'Coverage footprint');
    flag('model', '3d model,3d models,model,models', '3D model');
    flag('clouds', 'clouds,cloud', 'Clouds');
    flag('aurora', 'aurora,northern lights', 'Live aurora');
    flag('atmosphere', 'atmosphere', 'Atmosphere');
    flag('sharpGround', 'sharp ground,sharp ground when zoomed in,detailed ground', 'Sharp ground when zoomed in');
    flag('borders', 'coastlines and borders,borders,coastlines,countries', 'Coastlines and borders');
    flag('graticule', 'latitude longitude grid,lat lon grid,grid lines,graticule', 'Latitude / longitude grid');
    flag('terminator', 'day night line,night line,terminator', 'Day / night line');
    flag('earthDrift', 'slowly circle the earth,circle the earth,earth drift', 'Slowly circle the Earth');
    flag('siteMarker', 'ground station marker,station marker,my location marker', 'Ground station marker');
    flag('stars', 'stars and milky way,stars,milky way', 'Stars and Milky Way');
    flag('constellations', 'constellations,constellation lines', 'Constellations');
    flag('planets', 'planets', 'Planets');
    flag('skyLabels', 'names in the sky,sky names,sky labels', 'Names in the sky');
  }
  buildCommands();

  // Commands sit in a hash table keyed by the first word of each way of typing them, so the
  // usual case (the first word typed is the first word of a command) is one Map lookup, not
  // a pass over the whole table.
  const byFirstWord = new Map<string, { command: Command; phrase: string }[]>();
  for (const command of commands) {
    for (const phrase of command.phrases) {
      const key = phrase.split(' ')[0];
      const entries = byFirstWord.get(key);
      if (entries) entries.push({ command, phrase });
      else byFirstWord.set(key, [{ command, phrase }]);
    }
  }

  /** The commands that fit `query`, each with the score of its best-fitting phrase. */
  function lookup(query: string): Map<Command, number> {
    const found = new Map<Command, number>();
    if (!query) return found;
    const offer = (entries: { command: Command; phrase: string }[]) => {
      for (const { command, phrase } of entries) {
        const score = matchScore(query, phrase);
        if (score > (found.get(command) ?? 0)) found.set(command, score);
      }
    };
    const first = query.split(' ')[0];
    offer(byFirstWord.get(first) ?? []);
    // A first word still being typed ("mon"): the keys that begin with it. A few dozen string
    // compares over the table's keys, not over every phrase.
    for (const [key, entries] of byFirstWord) if (key !== first && key.startsWith(first)) offer(entries);
    // Only when that finds little, look everywhere: "altitude" for "colour by altitude".
    if (found.size < 3) for (const entries of byFirstWord.values()) offer(entries);
    return found;
  }

  // 250 places are few enough to score one by one; their names are normalised once, here.
  const places = PLACES.map((place) => ({ place, names: [normalize(place.name), ...place.also.map(normalize)], region: normalize(place.region) }));

  // ---------------------------------------------------------------- reading what was typed

  function interpret(raw: string): Result[] {
    const full = normalize(raw);
    if (!full) return [];
    const bare = full.replace(VERB, ''); // without a leading "go to", "show", "open" …
    const going = bare !== full && /^(?:please )?(?:go|goto|fly|take|jump|zoom)/.test(full);
    const results: Result[] = [];

    // a time
    const time = parseTime(raw, { nowMs: Date.now(), simMs: app.time(), shiftMs: clockShiftMs });
    if (time?.now) {
      results.push({ kind: 'Time', text: 'Back to the present, at normal speed', hint: clockStamp(time.ms), score: 97, run: () => app.jumpToNow() });
    } else if (time) {
      const ms = time.ms, away = ms - app.time();
      // clockStamp leaves the year out, which is right for nearly every jump; say it when it is not this year.
      const year = new Date(ms + clockShiftMs(ms)).getUTCFullYear();
      const thisYear = new Date(Date.now() + clockShiftMs(Date.now())).getUTCFullYear();
      const distance = Math.abs(away) < 1000 ? 'where the clock is now' : `${duration(away)} ${away > 0 ? 'ahead' : 'back'}`;
      results.push({
        kind: 'Time', text: `Set the clock to ${clockStamp(ms)}`, hint: year === thisYear ? distance : `${year}, ${distance}`, score: 97,
        run: () => app.jumpTo(ms), said: `Clock set to ${clockStamp(ms)}`,
      });
    }

    // a speed
    const speed = parseSpeed(raw);
    if (speed?.kind === 'pause') {
      results.push({ kind: 'Speed', text: 'Pause the clock', hint: app.speed() === 0 ? 'already paused' : '', score: 97, run: () => app.setSpeed(0), said: 'Clock paused' });
    } else if (speed?.kind === 'resume') {
      results.push({ kind: 'Speed', text: `Run the clock at ${speedText(lastSpeed)}${lastSpeed < 0 ? ', backwards' : ''}`, hint: app.speed() !== 0 ? 'already running' : '', score: 97, run: () => app.setSpeed(lastSpeed) });
    } else if (speed?.kind === 'reverse') {
      const next = -lastSpeed;
      results.push({ kind: 'Speed', text: `Run time ${next < 0 ? 'backwards' : 'forwards'} at ${speedText(next)}`, score: 97, run: () => app.setSpeed(next) });
    } else if (speed) {
      const value = speed.speed;
      const text = value === 1 ? 'Run time at its real speed (1×)' : `Run time ${value < 0 ? 'backwards ' : ''}at ${speedText(value)}`;
      results.push({
        kind: 'Speed', text, hint: speed.clamped ? `${fmtInt(MAX_SPEED)}× is the fastest` : '', score: 97,
        run: () => app.setSpeed(value), said: `Time is running at ${speedText(value)}${value < 0 ? ', backwards' : ''}`,
      });
    }

    // actions and settings
    const asTyped = lookup(full);
    const withoutVerb = bare !== full ? lookup(bare) : new Map<Command, number>();
    const switched = splitState(full);
    const withState = switched.state !== undefined ? lookup(switched.rest) : new Map<Command, number>();
    for (const command of new Set([...asTyped.keys(), ...withoutVerb.keys(), ...withState.keys()])) {
      const plain = Math.max(asTyped.get(command) ?? 0, (withoutVerb.get(command) ?? 0) - 1);
      const stated = command.takesState ? withState.get(command) ?? 0 : 0;
      if (plain === 0 && stated === 0) continue;
      const useState = stated >= plain;
      results.push({ kind: command.kind, score: useState ? stated : plain, ...command.make(useState ? switched.state : undefined) });
    }

    // places: the name, another name for it, or (loosely) its country
    for (const { place, names, region } of places) {
      let score = 0;
      for (const query of bare !== full ? [full, bare] : [full]) {
        names.forEach((name, index) => (score = Math.max(score, matchScore(query, name) - (index > 0 ? 2 : 0))));
        if (score === 0 && matchScore(query, region) >= 50) score = 20;
      }
      if (score === 0) continue;
      if (going) score += 10; // "go to …" was typed: a place is what is wanted
      results.push({
        kind: 'Place', text: `Go to ${place.name}${place.region ? `, ${place.region}` : ''}`, hint: coordinates(place), score,
        run: () => app.flyToGround(place.lat, place.lon),
      });
    }

    // objects: the catalogue's own search (hash lookups by number, name and name prefix)
    let sats = app.search(raw.trim(), 6);
    if (sats.length === 0 && bare !== full) sats = app.search(bare, 6);
    const strict = time !== null || speed !== null; // "-1d" was understood as a time: do not also offer every name with "1D" in it
    sats.forEach((sat, index) => {
      const exact = normalize(sat.name) === bare || String(sat.noradId) === bare;
      if (strict && !exact) return;
      results.push({
        kind: 'Object', text: `Select ${sat.name}`, hint: `catalogue no. ${sat.noradId}`, dot: CATEGORY_COLORS[sat.category],
        score: exact ? 96 : 58 - index, run: () => app.select(sat),
      });
    });

    // Best first. Array.sort is stable, so equal scores stay in the order above. When something
    // fits well, the loose matches (text found inside a word, a city's country) are left out:
    // they are a fallback for when nothing better turns up, not padding for the list.
    results.sort((a, b) => b.score - a.score);
    const good = results[0]?.score >= 80 ? results.filter((result) => result.score >= 30) : results;
    return good.slice(0, MAX_ROWS);
  }

  // ---------------------------------------------------------------- the overlay

  const root = document.createElement('div');
  root.className = 'cmd is-hidden';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Command bar');
  root.innerHTML = `
    <div class="cmd-box">
      <div class="cmd-field">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5l3.5 3.5L3 11.5M8.5 11.5H13" /></svg>
        <input class="cmd-input" type="text" role="combobox" aria-expanded="true" aria-controls="cmd-list" aria-autocomplete="list"
          placeholder="An object, a place, a time or a command" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" />
        <button class="cmd-close" type="button" aria-label="Close the command bar"><kbd>Esc</kbd><span aria-hidden="true">×</span></button>
      </div>
      <p class="cmd-head"></p>
      <ul class="cmd-list" id="cmd-list" role="listbox" aria-label="What this would do"></ul>
      <p class="cmd-empty note is-hidden">Nothing fits that. Try a satellite's name or number, a city, a time such as “tomorrow 9 pm” or “+2h”, or a command such as “pause” or “miles”.</p>
      <p class="cmd-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> choose</span><span><kbd>Enter</kbd> run</span><span><kbd>Esc</kbd> close</span></p>
    </div>`;
  document.body.append(root);

  const box = root.querySelector('.cmd-box') as HTMLElement;
  const input = root.querySelector('.cmd-input') as HTMLInputElement;
  const list = root.querySelector('.cmd-list') as HTMLElement;
  const head = root.querySelector('.cmd-head') as HTMLElement;
  const empty = root.querySelector('.cmd-empty') as HTMLElement;

  let isOpen = false;
  let results: Result[] = [];
  let typed: string[] | null = null; // in the examples list: what to type for each row
  let active = -1; // the highlighted row, -1 for none
  let returnTo: HTMLElement | null = null; // where the keyboard focus was before the bar opened

  function setActive(index: number): void {
    active = index;
    [...list.children].forEach((row, i) => {
      row.classList.toggle('is-active', i === index);
      row.setAttribute('aria-selected', String(i === index));
    });
    if (index >= 0) {
      input.setAttribute('aria-activedescendant', `cmd-row-${index}`);
      list.children[index]?.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  /** Work out the rows for what is in the box now and draw them. */
  function update(): void {
    const text = input.value.trim();
    if (text) {
      results = interpret(text);
      typed = null;
    } else {
      // Nothing typed yet: show what kinds of thing can be, as rows that work when clicked.
      const shown = EXAMPLES.flatMap((example) => {
        const best = interpret(example)[0];
        return best ? [{ example, best }] : []; // an object's name finds nothing until the catalogue has loaded
      });
      results = shown.map((entry) => entry.best);
      typed = shown.map((entry) => entry.example);
    }
    head.textContent = typed ? 'Try typing' : '';
    head.classList.toggle('is-hidden', !typed);
    list.classList.toggle('is-examples', typed !== null);
    empty.classList.toggle('is-hidden', results.length > 0);
    list.replaceChildren(...results.map((result, index) => {
      const row = document.createElement('li');
      row.id = `cmd-row-${index}`;
      row.setAttribute('role', 'option');
      const label = document.createElement('span');
      label.className = typed ? 'cmd-say' : 'cmd-kind';
      label.textContent = typed ? typed[index] : result.kind;
      const what = document.createElement('span');
      what.className = 'cmd-text';
      if (result.dot) {
        const dot = document.createElement('i');
        dot.style.color = result.dot;
        what.append(dot);
      }
      what.append(result.text);
      row.append(label, what);
      if (result.hint) {
        const hint = document.createElement('span');
        hint.className = 'cmd-hint';
        hint.textContent = result.hint;
        row.append(hint);
      }
      // "click", not "pointerdown": on a touch screen a press is also how the list is scrolled.
      row.addEventListener('click', () => choose(result));
      row.addEventListener('pointermove', (event) => {
        if (event.pointerType === 'mouse' && active !== index) setActive(index);
      });
      return row;
    }));
    // Something typed: Enter runs the top row. Only examples: nothing is chosen until the visitor chooses.
    setActive(typed || results.length === 0 ? -1 : 0);
  }

  function choose(result: Result): void {
    close();
    result.run();
    if (result.said) app.toast(result.said);
  }

  /**
   * Not while the welcome page or the loading screen is in front: the bar would open unseen
   * behind them and swallow the Enter key the welcome page is waiting for.
   */
  const ready = (): boolean => !document.getElementById('landing') && !document.getElementById('hud')?.classList.contains('hud-hidden');

  /** Keep the bar inside what is actually visible: on a phone the on-screen keyboard covers the lower half. */
  function fit(): void {
    const view = window.visualViewport;
    root.style.setProperty('--cmd-vh', `${view?.height ?? window.innerHeight}px`);
    root.style.setProperty('--cmd-top', `${view?.offsetTop ?? 0}px`);
  }

  function open(): void {
    if (isOpen || !ready()) return;
    isOpen = true;
    returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (app.speed() !== 0) lastSpeed = app.speed();
    input.value = '';
    root.classList.remove('is-hidden');
    fit();
    update();
    input.focus();
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    root.classList.add('is-hidden');
    input.blur();
    // Hand the focus back, except to a text field: that would bring a phone's keyboard straight back up.
    if (returnTo?.isConnected && !(returnTo instanceof HTMLInputElement && returnTo.type !== 'checkbox' && returnTo.type !== 'range')) returnTo.focus({ preventScroll: true });
    returnTo = null;
  }

  input.addEventListener('input', update);
  // Some phone keyboards report their "Go" key only as a line break in the text, never as an
  // Enter key press. (On a real keyboard the key handler below runs first and cancels this.)
  input.addEventListener('beforeinput', (event) => {
    if (event.inputType !== 'insertLineBreak') return;
    event.preventDefault();
    if (results[active]) choose(results[active]);
  });
  root.addEventListener('click', (event) => {
    if (event.target === root) close(); // the dimmed area around the box
  });
  root.querySelector('.cmd-close')!.addEventListener('click', close);
  // Pressing a row or the box's edge must not take the caret out of the text field.
  box.addEventListener('mousedown', (event) => {
    if (event.target !== input) event.preventDefault();
  });
  window.visualViewport?.addEventListener('resize', () => isOpen && fit());
  window.visualViewport?.addEventListener('scroll', () => isOpen && fit());

  // One listener for every trigger, present or future: <button data-command-open>.
  document.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('[data-command-open]')) {
      event.preventDefault();
      open();
    }
  });

  window.addEventListener('keydown', (event) => {
    // (String(): a browser filling in a saved form field sends a key event with no key at all.)
    const shortcut = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && String(event.key).toLowerCase() === 'k';
    if (!isOpen) {
      if (!shortcut || !ready()) return; // closed: every other key belongs to the app
      event.preventDefault(); // the browser's own Ctrl+K (the address bar's search)
      event.stopImmediatePropagation();
      open();
      return;
    }
    // Open: nothing typed here may reach the app's shortcuts, or the tour's and the autopilot's
    // listeners, which also sit on window. Stopping it here means the input never sees the
    // event as a listener either, so the list's keys are handled in this one place.
    event.stopImmediatePropagation();
    if (event.isComposing) return; // an input method is still putting a character together
    if (shortcut || event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Tab') {
      event.preventDefault(); // Tab stays inside the bar: there is nowhere else to go while it is open
      const up = event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey);
      if (results.length > 0) setActive(active < 0 ? (up ? results.length - 1 : 0) : (active + (up ? results.length - 1 : 1)) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (results[active]) choose(results[active]);
    } else if (document.activeElement !== input) input.focus(); // a click elsewhere took the caret: typing goes to the box again
  }, true);
  // The app listens for key presses only, but a held key that outlives the bar should not leak either.
  for (const type of ['keyup', 'keypress'] as const) {
    window.addEventListener(type, (event) => {
      if (isOpen) event.stopImmediatePropagation();
    }, true);
  }
}
