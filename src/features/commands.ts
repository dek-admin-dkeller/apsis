/**
 * Everything the search field understands besides a name: places, times, clock speeds and
 * actions. There used to be a separate command bar for these; the owner asked for one field,
 * so this module now only SUPPLIES rows. It registers one source with `app.addSearch`, and
 * the search field (src/ui/search.ts) lists its rows under their own headings beside the
 * objects and the types.
 *
 * Every row says in words what it is about to do ("Go to Tokyo, Japan", "Set the clock to
 * 19 Nov 21:00") and nothing runs until a row is chosen. What can be typed:
 *
 *   a place       "tokyo", "go to cairo"                → src/data/places.ts, app.flyToGround
 *   a time        "tomorrow 9 pm", "+90m", "now" …      → commandParse.ts, app.jumpTo
 *   a speed       "100x", "pause", "real time"          → commandParse.ts, app.setSpeed
 *   an action     "monitor on", "sky view", "miles" …   → the table in buildCommands below
 */

import { PLACES, type Place } from '../data/places.ts';
import { displayName } from '../data/names.ts';
import type { App, PanelName, SearchHit, Toggle, ViewName, SectionName } from '../ui/app.ts';
import { fmt, fmtInt } from '../ui/dom.ts';
import { clockShiftMs, clockStamp, duration } from '../ui/inspector.ts';
import { matchNormalized, normalize, withoutVerb } from '../ui/searchMatch.ts';
import type { Settings } from '../ui/settings.ts';
import { MAX_SPEED, parseSpeed, parseTime, splitState } from './commandParse.ts';

const MAX_PLACES = 4;
const MAX_ACTIONS = 5;

/** What choosing a row does, before it is given a heading and a score. */
interface Outcome {
  text: string; // what will happen, in words
  hint?: string; // a detail for the right-hand side: "in use now", "already on"
  run: () => void;
  said?: string; // confirmation shown afterwards, for effects that are easy to miss on screen
}

interface Command {
  kind: string; // the quiet word on the right of its row: View, Panel, Setting, Layer, Action
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

export function installCommands(app: App): void {
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
      : { text: 'Stand at the ground station and look up at the sky', run: () => app.toggle('sky', true) }));
    add('View', 'ride along,ride,first person', true, (state) => {
      const sat = app.selected();
      if (state === false) return { text: 'Stop riding along', run: () => app.toggle('ride', false) };
      if (!sat) return { text: 'Ride along with an object', hint: 'select one first', run: () => app.toast('Select an object first, then ride along with it.') };
      return { text: `Ride along with ${displayName(sat)}`, run: () => app.toggle('ride', true) };
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

    // Every section of the Objects panel by name, so that no feature is more than a few keys away.
    const section = (name: SectionName, phrases: string, text: string): void => add('Panel', phrases, false, () => ({ text, run: () => app.openSection(name) }));
    section('tonight', 'visible tonight,tonight,bright passes,passes tonight,what can i see', 'Show the bright passes visible tonight');
    section('launches', 'launches,upcoming launches,next launch,rocket launches,launch schedule', 'Show the upcoming launches');
    section('changes', 'orbit changes,changes,manoeuvres,maneuvers,what changed', 'Show which orbits have changed since the last update');
    section('newest', 'newest in orbit,newest,latest launches,new objects,recent launches', 'Show the newest objects in orbit');
    section('trains', 'satellite trains,trains,starlink train', 'Show the satellite trains');
    section('lowest', 'lowest orbits,lowest,re-entries,reentries,decay,space weather,solar activity', 'Show the lowest orbits and today’s space weather');
    section('constellations', 'constellations,constellation,coverage,networks', 'Open the constellations');
    section('growth', 'growth by year,growth,by year,history,since 1957', 'Open growth by year');
    section('designer', 'design a satellite,designer,design,my own satellite', 'Open the satellite designer');
    section('watchlist', 'watchlist,watch list,starred,favourites,favorites', 'Open the watchlist');
    section('appearance', 'colours,colors,colour by,color by,appearance,marker size', 'Open the colour and marker settings');

    add('Action', 'deselect,clear selection,unselect', false, () => {
      const sat = app.selected();
      return { text: sat ? `Deselect ${displayName(sat)}` : 'Deselect', hint: sat ? '' : 'nothing is selected', run: () => app.select(null) };
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

  /** The commands that fit `query`, each with the score of its best-fitting phrase (0 … 1). */
  function lookup(query: string): Map<Command, number> {
    const found = new Map<Command, number>();
    if (!query) return found;
    const offer = (entries: { command: Command; phrase: string }[]) => {
      for (const { command, phrase } of entries) {
        const score = matchNormalized(query, phrase);
        if (score > (found.get(command) ?? 0)) found.set(command, score);
      }
    };
    const first = query.split(' ')[0];
    offer(byFirstWord.get(first) ?? []);
    // A first word still being typed ("mon"): the keys that begin with it. A few dozen string
    // compares over the table's keys, not over every phrase.
    for (const [key, entries] of byFirstWord) if (key !== first && key.startsWith(first)) offer(entries);
    // Only when that finds little, look everywhere: "altitude" for "colour by altitude", or a misspelling.
    if (found.size < 3) for (const entries of byFirstWord.values()) offer(entries);
    return found;
  }

  // 250 places are few enough to score one by one; their names are normalised once, here.
  const places = PLACES.map((place) => ({ place, names: [normalize(place.name), ...place.also.map(normalize)], region: normalize(place.region) }));

  // ---------------------------------------------------------------- reading what was typed

  /** A row for the search field: the outcome under its heading, with any confirmation folded into what it runs. */
  const row = (group: string, note: string, score: number, outcome: Outcome): SearchHit => ({
    title: outcome.text,
    note: outcome.hint || note,
    group,
    score,
    run: () => {
      outcome.run();
      if (outcome.said) app.toast(outcome.said);
    },
  });

  function interpret(raw: string): SearchHit[] {
    const full = normalize(raw);
    if (!full) return [];
    const { bare, going } = withoutVerb(full); // without a leading "go to", "show", "open" …
    const hits: SearchHit[] = [];
    if (app.speed() !== 0) lastSpeed = app.speed();

    // a time
    const time = parseTime(raw, { nowMs: Date.now(), simMs: app.time(), shiftMs: clockShiftMs });
    if (time?.now) {
      hits.push(row('Time', '', 0.97, { text: 'Back to the present, at normal speed', hint: clockStamp(time.ms), run: () => app.jumpToNow() }));
    } else if (time) {
      const ms = time.ms, away = ms - app.time();
      // clockStamp leaves the year out, which is right for nearly every jump; say it when it is not this year.
      const year = new Date(ms + clockShiftMs(ms)).getUTCFullYear();
      const thisYear = new Date(Date.now() + clockShiftMs(Date.now())).getUTCFullYear();
      const distance = Math.abs(away) < 1000 ? 'where the clock is now' : `${duration(away)} ${away > 0 ? 'ahead' : 'back'}`;
      hits.push(row('Time', '', 0.97, {
        text: `Set the clock to ${clockStamp(ms)}`, hint: year === thisYear ? distance : `${year}, ${distance}`,
        run: () => app.jumpTo(ms), said: `Clock set to ${clockStamp(ms)}`,
      }));
    }

    // a speed
    const speed = parseSpeed(raw);
    if (speed?.kind === 'pause') {
      hits.push(row('Time', 'Speed', 0.97, { text: 'Pause the clock', hint: app.speed() === 0 ? 'already paused' : '', run: () => app.setSpeed(0), said: 'Clock paused' }));
    } else if (speed?.kind === 'resume') {
      hits.push(row('Time', 'Speed', 0.97, { text: `Run the clock at ${speedText(lastSpeed)}${lastSpeed < 0 ? ', backwards' : ''}`, hint: app.speed() !== 0 ? 'already running' : '', run: () => app.setSpeed(lastSpeed) }));
    } else if (speed?.kind === 'reverse') {
      const next = -lastSpeed;
      hits.push(row('Time', 'Speed', 0.97, { text: `Run time ${next < 0 ? 'backwards' : 'forwards'} at ${speedText(next)}`, run: () => app.setSpeed(next) }));
    } else if (speed) {
      const value = speed.speed;
      const text = value === 1 ? 'Run time at its real speed (1×)' : `Run time ${value < 0 ? 'backwards ' : ''}at ${speedText(value)}`;
      hits.push(row('Time', 'Speed', 0.97, {
        text, hint: speed.clamped ? `${fmtInt(MAX_SPEED)}× is the fastest` : '',
        run: () => app.setSpeed(value), said: `Time is running at ${speedText(value)}${value < 0 ? ', backwards' : ''}`,
      }));
    }

    // actions and settings
    const asTyped = lookup(full);
    const bareFound = bare !== full ? lookup(bare) : new Map<Command, number>();
    const switched = splitState(full);
    const withState = switched.state !== undefined ? lookup(switched.rest) : new Map<Command, number>();
    const actions: SearchHit[] = [];
    for (const command of new Set([...asTyped.keys(), ...bareFound.keys(), ...withState.keys()])) {
      const plain = Math.max(asTyped.get(command) ?? 0, (bareFound.get(command) ?? 0) - 0.01);
      const stated = command.takesState ? withState.get(command) ?? 0 : 0;
      if (plain === 0 && stated === 0) continue;
      const useState = stated >= plain;
      actions.push(row('Actions', command.kind, useState ? stated : plain, command.make(useState ? switched.state : undefined)));
    }
    actions.sort((a, b) => b.score - a.score);
    hits.push(...actions.slice(0, MAX_ACTIONS));

    // places: the name, another name for it, or (loosely) its country
    const found: SearchHit[] = [];
    for (const { place, names, region } of places) {
      let score = 0;
      for (const query of bare !== full ? [full, bare] : [full]) {
        names.forEach((name, index) => (score = Math.max(score, matchNormalized(query, name) - (index > 0 ? 0.02 : 0))));
        if (score === 0 && matchNormalized(query, region) >= 0.6) score = 0.32;
      }
      if (score < 0.3) continue;
      if (going) score = Math.min(1, score + 0.1); // "go to …" was typed: a place is what is wanted
      found.push(row('Places', coordinates(place), score, {
        text: `Go to ${place.name}${place.region ? `, ${place.region}` : ''}`, run: () => app.flyToGround(place.lat, place.lon),
      }));
    }
    found.sort((a, b) => b.score - a.score);
    hits.push(...found.slice(0, MAX_PLACES));
    return hits;
  }

  app.addSearch(interpret);
}
