/**
 * The bell in the top bar: what is happening now, and what is coming up.
 *
 * One list gathered from data the app already reads, never a new source:
 *   live now     spacecraft a Deep Space Network dish is talking to this minute (space/dsn.ts),
 *                a rocket on its way up or about to lift off (data/launches.ts), a meteor shower
 *                that is active tonight (space/showers.ts);
 *   coming up    the next launches with a time to the minute, the next asteroid to pass the
 *                Earth (deep.json's fly-by list), the next shower peak.
 * Three kinds of row (the owner's rule: only what is out of the ordinary raises an alert):
 *   'alert'    happening now and not routine: a rocket lifting off or in flight, a meteor
 *              shower within a day of its peak, an asteroid within six hours of passing.
 *              These are counted on the bell, with a pulsing ring.
 *   'ongoing'  live but routine: a spacecraft talking to a dish (some dish is talking to some
 *              craft nearly all the time), a shower in the weeks it is active. Listed, marked
 *              live in a quieter way, and never counted: alone they give the bell a still dot.
 *   'coming'   what is next, soonest first. Every row is a way to go and see it: the craft at its world,
 * the launch pad on the globe, the asteroid on its path, the shower's section.
 *
 * Times are on the REAL clock (Date.now()), not the simulated one: "live" means live.
 *
 * How often it asks (see "Outside services" in CLAUDE.md): the launch list goes through
 * loadLaunches(), which keeps a copy for an hour, so at most one Launch Library request an
 * hour; the Deep Space Network feed is read once every five minutes while the tab is
 * visible (and once a minute while the list is open). Nothing is asked while the tab is hidden.
 */

import { findPasses, makeSatrec, type Pass } from '../data/ephemeris.ts';
import { loadLaunches, type Launch } from '../data/launches.ts';
import { loadDeep } from '../space/deep.ts';
import { DSN_NOW_URL, latestDsn, watchDsn } from '../space/dsn.ts';
import { activeShowers, nextShowers } from '../space/showers.ts';
import { eclipses, jupiterEvents, planetTransits, type SkyEvent } from '../space/skyEvents.ts';
import type { DsnLink, Flyby } from '../space/types.ts';
import type { App } from '../ui/app.ts';
import { $ } from '../ui/dom.ts';
import { clockStamp, duration } from '../ui/inspector.ts';
import { watchLaunch } from './ascent.ts';

/** A launch counts as "now" from this long before lift-off (if its time is known to the minute)… */
const SOON_MS = 20 * 60000;
/** …and until this long after, unless the service already says how it went. */
const AFTER_MS = 15 * 60000;
const DSN_EVERY_MS = 5 * 60000;
const LAUNCHES_EVERY_MS = 15 * 60000; // loadLaunches() answers from its hour-old copy in between

type Icon = 'dish' | 'rocket' | 'shower' | 'rock' | 'eclipse' | 'station';
type Kind = 'alert' | 'ongoing' | 'coming';
/** A shower counts as news within this long of its peak; the rest of its weeks it is routine. */
const PEAK_NEWS_MS = 24 * 3600000;
/** An asteroid counts as passing "now" within this long of its closest moment. */
const ROCK_NOW_MS = 6 * 3600000;
interface Row {
  kind: Kind;
  /** Stable for the same event (a notification is sent once per id). */
  id?: string;
  icon: Icon;
  title: string;
  note: string;
  /** For the order of "coming up": soonest first. */
  at: number;
  run: () => void;
}

const ICONS: Record<Icon, string> = {
  dish: '<path d="M4 13a6 6 0 0 0 8.5-8.5z" /><path d="M8.2 8.8 13 4M13 4h2.5M13 4V1.5M6 15.5h6" />',
  rocket: '<path d="M10 2.5c2.4 2 3.4 4.8 3 8.5H7c-.4-3.7.6-6.5 3-8.5z" /><path d="M7 11l-2 3h3M13 11l2 3h-3M9 14.5h2l-1 3z" />',
  shower: '<path d="M15.5 3.5 9 10M12.5 2.5 8 7M16.5 7 12 11.5" /><circle cx="6.5" cy="13.5" r="2.2" />',
  rock: '<path d="M5 6.5 9 4l5 1.5 2 4-1.5 4.5L10 16l-4.5-1.5L3.5 10z" />',
  station: '<path d="M3 10h14M6 7v6M14 7v6M8.5 8.5h3v3h-3z" />',
  eclipse: '<circle cx="8.5" cy="10" r="5.5" /><path d="M12.6 5.6a5.5 5.5 0 1 1 0 8.8 5.5 5.5 0 0 0 0-8.8z" fill="currentColor" stroke="none" opacity="0.7" />',
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

/** "in 3 h 20 min", "in 12 min", "4 min ago". */
const fromNow = (ms: number): string => (ms >= 0 ? `in ${duration(ms)}` : `${duration(-ms)} ago`);

export function installBell(app: App): void {
  const button = $('bell');
  const menu = $('bell-menu');
  const list = $('bell-list');
  const dot = $('bell-dot');
  const phoneDot = document.getElementById('m-live-dot');
  if (!button || !menu || !list) return;

  let links: DsnLink[] = latestDsn();
  let launches: Launch[] = [];
  let flybys: Flyby[] = [];
  let open = false;

  // ---- the Space Station over the visitor (data/ephemeris.ts findPasses) ----------------------

  type IssPass = Pass & { dark: boolean }; // dark: the Sun is below −6° at the visitor at the peak (a bright pass can be seen)
  let issPasses: IssPass[] = [];
  let issAt = 0;
  const hasLocation = (): boolean => app.hasOwnLocation();
  /** The next passes in 24 h, worked out in an idle moment at most every ten minutes (a few ms of SGP4). */
  function refreshIss(): void {
    if (!hasLocation() || Date.now() - issAt < 10 * 60000) return;
    issAt = Date.now();
    const work = (): void => {
      const iss = app.catalog()?.byName.get('ISS (ZARYA)')?.[0];
      if (!iss) return;
      const observer = app.observer();
      issPasses = findPasses(makeSatrec(iss), observer, Date.now() - 15 * 60000, 24, 6).map((pass) => ({ ...pass, dark: sunAltitudeDeg(observer.latDeg, observer.lonDeg, pass.peakMs) < -6 }));
      render();
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(work, { timeout: 4000 });
    else setTimeout(work, 300);
  }

  // ---- notifications (only if the visitor turns them on, from the bell) -----------------------

  const NOTIFY_KEY = 'apsis.bell.notify';
  const SENT_KEY = 'apsis.bell.sent';
  const notifyWanted = (): boolean => {
    try {
      return localStorage.getItem(NOTIFY_KEY) === 'yes' && 'Notification' in window && Notification.permission === 'granted';
    } catch {
      return false;
    }
  };
  /** Ids already notified (kept two days, so a reload does not repeat them). */
  function sent(): Map<string, number> {
    try {
      const saved = JSON.parse(localStorage.getItem(SENT_KEY) ?? '{}') as Record<string, number>;
      return new Map(Object.entries(saved).filter(([, at]) => Date.now() - at < 2 * 86400000));
    } catch {
      return new Map();
    }
  }
  function notify(all: Row[]): void {
    if (!notifyWanted()) return;
    const done = sent();
    for (const row of all) {
      if (row.kind !== 'alert' || !row.id || done.has(row.id)) continue;
      done.set(row.id, Date.now());
      try {
        const note = new Notification(row.title, { body: row.note, tag: row.id, icon: './icons/icon-192.png' });
        note.onclick = () => {
          window.focus();
          row.run();
          note.close();
        };
      } catch { /* some browsers allow notifications only from a service worker: then the bell alone says it */ }
    }
    try {
      localStorage.setItem(SENT_KEY, JSON.stringify(Object.fromEntries(done)));
    } catch { /* storage unavailable */ }
  }
  /** The footer switch: asks the browser (from the click itself) and remembers the choice. */
  function notifyFooter(): HTMLElement {
    const foot = el('div', 'bell-foot');
    if (!('Notification' in window)) return foot;
    const on = notifyWanted();
    const button = el('button', 'bell-notify', on ? 'Notifications on · turn off' : 'Notify me when something happens');
    button.type = 'button';
    button.title = 'A browser notification for alerts only (a launch, an eclipse, a close asteroid, the Station overhead), never for routine things';
    button.addEventListener('click', () => {
      if (notifyWanted()) {
        try { localStorage.setItem(NOTIFY_KEY, 'no'); } catch { /* storage unavailable */ }
        render();
        return;
      }
      void Notification.requestPermission().then((permission) => {
        try { localStorage.setItem(NOTIFY_KEY, permission === 'granted' ? 'yes' : 'no'); } catch { /* storage unavailable */ }
        if (permission !== 'granted') app.toast('Notifications are blocked for this site in the browser’s settings.');
        // What is already happening is not news to someone looking at it: mark it as sent.
        const done = sent();
        for (const row of rows()) if (row.kind === 'alert' && row.id) done.set(row.id, Date.now());
        try { localStorage.setItem(SENT_KEY, JSON.stringify(Object.fromEntries(done))); } catch { /* storage unavailable */ }
        render();
      });
    });
    foot.append(button);
    return foot;
  }

  // ---- what there is to show ----------------------------------------------------------------

  function rows(): Row[] {
    const now = Date.now();
    const out: Row[] = [];

    // Spacecraft in contact: one row per craft (a craft can be on two dishes at once).
    const seen = new Set<string>();
    for (const link of links) {
      if (!(link.up || link.down) || seen.has(link.craft)) continue;
      seen.add(link.craft);
      const dishes = links.filter((other) => other.craft === link.craft && (other.up || other.down)).map((other) => other.site);
      out.push({
        kind: 'ongoing', icon: 'dish', title: link.name, at: now,
        note: `In contact with ${[...new Set(dishes)].join(' and ')}${link.roundTripS ? ` · ${duration(link.roundTripS * 500)} each way` : ''}`,
        run: () => {
          if (!app.showDeepCraft(link.craft)) app.openSection('dsn');
        },
      });
    }

    for (const launch of launches) {
      const until = launch.netMs - now;
      const exact = launch.precision === 'exact';
      const flying = launch.state === 'flying';
      const imminent = exact && launch.state === 'go' && until < SOON_MS && until > -AFTER_MS;
      if (launch.state === 'done' || launch.state === 'failed') continue;
      if (!flying && !imminent && (until < 0 || !exact)) continue;
      out.push({
        kind: flying || imminent ? 'alert' : 'coming', id: `launch-${launch.id}`,
        icon: 'rocket',
        title: `${launch.rocket} · ${launch.mission}`,
        note: flying ? `${until < 0 ? `Lifted off ${duration(-until)} ago` : 'In flight'} from ${launch.place}`
          : until > 0 ? `${imminent ? 'Lift-off' : clockStamp(launch.netMs)} ${fromNow(until)} · ${launch.place}`
          : `Lift-off was due ${fromNow(until)} · ${launch.place}`,
        at: launch.netMs,
        run: () => {
          // Lifting off or flying: watch its (estimated) climb. Otherwise show the pad.
          if ((flying || imminent) && watchLaunch(launch)) return;
          void app.goEarth().then(() => {
            app.openSection('launches');
            if (launch.latDeg !== null && launch.lonDeg !== null) app.flyToGround(launch.latDeg, launch.lonDeg, 3000);
          });
        },
      });
    }

    for (const time of activeShowers(now)) {
      const toPeak = time.peakMs - now;
      out.push({
        kind: Math.abs(toPeak) < PEAK_NEWS_MS ? 'alert' : 'ongoing', id: `shower-${time.shower.code}-${new Date(time.peakMs).getUTCFullYear()}`, icon: 'shower', title: `${time.shower.name} meteor shower`, at: now,
        note: Math.abs(toPeak) < 36 * 3600000 ? `Active now · peak ${fromNow(toPeak)}` : `Active now · ${toPeak < 0 ? 'peaked' : 'peak'} ${clockStamp(time.peakMs)}`,
        run: () => app.openSection('showers'),
      });
    }
    const next = nextShowers(now, 1)[0];
    if (next && !activeShowers(now).some((time) => time.shower.code === next.shower.code)) {
      out.push({
        kind: 'coming', icon: 'shower', title: `${next.shower.name} meteor shower`, at: next.peakMs,
        note: `Peak ${fromNow(next.peakMs - now)} · up to ${next.shower.rate} an hour`,
        run: () => app.openSection('showers'),
      });
    }

    // The Space Station over the visitor (only with their own location): passing now or rising
    // within ten minutes, high enough to matter (20°), is an alert; the next pass is coming up.
    // Without a location, one row offers to use it.
    for (const pass of issPasses) {
      const live = now >= pass.startMs - 10 * 60000 && now <= pass.endMs && pass.peakElDeg >= 20;
      if (!live && (pass.startMs < now || out.some((row) => row.icon === 'station' && row.kind === 'coming'))) continue;
      const eye = pass.sunlit && pass.dark ? ' · bright to the eye' : '';
      out.push({
        kind: live ? 'alert' : 'coming', icon: 'station', id: `iss-${pass.startMs}`, at: pass.startMs,
        title: 'Space Station over you',
        note: `${now >= pass.startMs ? 'Up now' : live ? `Rises ${fromNow(pass.startMs - now)}` : clockStamp(pass.startMs)} · up to ${Math.round(pass.peakElDeg)}° high${eye}`,
        run: () => void app.goEarth().then(() => {
          if (pass.startMs > Date.now() + 120000) app.jumpTo(pass.startMs - 30000); // to just before it rises
          const iss = app.catalog()?.byName.get('ISS (ZARYA)')?.[0];
          if (iss) app.select(iss);
        }),
      });
    }
    if (!hasLocation()) {
      out.push({
        kind: 'coming', icon: 'station', at: now + 365 * 86400000, title: 'Space Station over you',
        note: 'Share your location to see when it next flies over',
        run: () => void app.useMyLocation().then(() => {
          issAt = 0;
          render();
        }),
      });
    }

    // Launched in the last three days and now in the tracking data (ongoing: it is news, not an alarm).
    for (const launch of app.freshLaunches().slice(0, 3)) {
      out.push({
        kind: 'ongoing', icon: 'rocket', title: launch.title, at: now,
        note: `Launched ${launch.date ? `on ${clockStamp(Date.parse(`${launch.date}T12:00:00Z`)).replace(/ \d\d:\d\d.*$/, '')}` : 'in the last day'} · now tracked`,
        run: () => void app.goEarth().then(() => app.showLaunchGroup(launch.members)),
      });
    }

    // Eclipses and transits (space/skyEvents.ts): an Earth eclipse or a planet crossing the Sun
    // is rare, an alert while it happens; the shadows of Jupiter's moons happen most days, so
    // they are ongoing. Coming up: the next rare one of each kind, and the next shadow on Jupiter.
    const events = sky(now);
    const nextOf = new Set<string>();
    for (const event of events) {
      const live = event.startMs <= now && now <= event.endMs;
      const key = event.rare ? event.kind : 'jupiter';
      if (!live && (event.startMs < now || nextOf.has(key))) continue;
      if (!live) nextOf.add(key);
      out.push({
        kind: live ? (event.rare ? 'alert' : 'ongoing') : 'coming', id: event.id, icon: 'eclipse', title: event.title, at: event.peakMs,
        note: live ? `Now · ${event.detail}` : `${clockStamp(event.peakMs)} · ${event.detail}`,
        run: () => showSkyEvent(event),
      });
    }

    // Asteroids. A rock passes within a dozen Moon-distances nearly every day, so passing alone
    // is not news: only one coming closer than two Moon-distances is an alert. And only the
    // closest few have a path in the data (JPL is asked for those), so "coming up" names the
    // next one that can actually be followed; a click on one without a path says so.
    const known = (flyby: Flyby): boolean => !!(flyby as Flyby & { motion?: unknown }).motion;
    const passingNow = flybys.filter((flyby) => Math.abs(flyby.timeMs - now) < ROCK_NOW_MS).sort((a, b) => a.distanceKm - b.distanceKm)[0];
    const nextKnown = flybys.filter((flyby) => flyby.timeMs > now && known(flyby)).sort((a, b) => a.timeMs - b.timeMs)[0];
    for (const rock of [passingNow, nextKnown]) {
      if (!rock || (rock === nextKnown && rock === passingNow)) continue;
      const lunar = rock.distanceKm / 384400;
      const passing = rock === passingNow;
      out.push({
        kind: passing ? (lunar < 2 ? 'alert' : 'ongoing') : 'coming', id: `rock-${rock.name}`, icon: 'rock', title: `Asteroid ${rock.name}`, at: rock.timeMs,
        note: `${passing ? 'Passing the Earth now · closest' : 'Passes the Earth'} ${fromNow(rock.timeMs - now)} · ${lunar < 10 ? lunar.toFixed(1) : Math.round(lunar)} times the Moon's distance`,
        run: () => {
          if (app.showFlyby(rock.name)) return;
          app.openSection('flybys');
          app.toast(`${rock.name} is too far out for its path to be in the data (only the closest few are followed). Its time and distance are in the list.`);
        },
      });
    }

    // Alerts, then what is ongoing (showers before the list of contacts), then what is coming,
    // soonest first, with a few launches at most.
    const alerts = out.filter((row) => row.kind === 'alert');
    const ongoing = out.filter((row) => row.kind === 'ongoing').sort((a, b) => Number(a.icon === 'dish') - Number(b.icon === 'dish'));
    const coming = out.filter((row) => row.kind === 'coming').sort((a, b) => a.at - b.at);
    let rockets = 0;
    return [...alerts, ...ongoing, ...coming.filter((row) => row.icon !== 'rocket' || ++rockets <= 4)];
  }

  /** The clock to the event's peak, at the world where it shows: the shadows are drawn there. */
  let shownEvent: SkyEvent | null = null;
  function showSkyEvent(event: SkyEvent): void {
    shownEvent = event;
    app.jumpTo(event.peakMs);
    if (event.kind === 'solar-eclipse') {
      void app.goEarth().then(() => {
        // Two frames later: the globe must first have turned to the new time, or the camera
        // aims at where that longitude WAS (it landed 26° off before).
        if (event.latDeg !== undefined && event.lonDeg !== undefined) {
          const { latDeg, lonDeg } = event;
          requestAnimationFrame(() => requestAnimationFrame(() => app.flyToGround(latDeg, lonDeg, 9000)));
        }
      });
    } else {
      app.goWorld(event.body);
    }
  }

  // Share links: "#event=solar-2027-02-06" opens that eclipse (or transit) at its peak. The id
  // carries its date, so it is found by working out only the days round it.
  app.addShareLink({
    add: (q) => {
      const t = app.time();
      if (!shownEvent || t < shownEvent.startMs - 3600000 || t > shownEvent.endMs + 3600000) return false;
      q.set('event', shownEvent.id);
      return true;
    },
    apply: (q) => {
      const id = q.get('event') ?? '';
      const date = /(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2})?/.exec(id);
      if (!date) return false;
      const at = Date.parse(`${date[1]}${date[2] ?? 'T12:00'}:00Z`);
      const near = [...eclipses(at - 2 * 86400000, at + 2 * 86400000), ...planetTransits(at - 2 * 86400000, at + 2 * 86400000), ...jupiterEvents(at - 86400000, at + 86400000)];
      const event = near.find((candidate) => candidate.id === id);
      if (!event) {
        app.toast('That event could not be found.');
        return true;
      }
      showSkyEvent(event);
      return true;
    },
  });

  // Eclipses and transits a year ahead (they are rare), Jupiter's routine shadows a few days.
  // The first working-out takes some tens of milliseconds, so it is done in an idle moment and
  // never inside a frame; it is kept for ten minutes (the bell redraws every 30 s).
  let skyCache: { at: number; events: SkyEvent[] } | null = null;
  let skyPending = false;
  function sky(now: number): SkyEvent[] {
    if ((!skyCache || now - skyCache.at > 10 * 60000) && !skyPending) {
      skyPending = true;
      const work = (): void => {
        const t = Date.now();
        try {
          const rare = [...eclipses(t - 12 * 3600000, t + 400 * 86400000), ...planetTransits(t - 12 * 3600000, t + 400 * 86400000)];
          skyCache = { at: t, events: [...rare, ...jupiterEvents(t - 12 * 3600000, t + 4 * 86400000)].sort((a, b) => a.startMs - b.startMs) };
        } catch (error) {
          console.error('Sky events could not be worked out', error);
          skyCache = { at: t, events: [] };
        }
        skyPending = false;
        render();
      };
      if (typeof requestIdleCallback === 'function') requestIdleCallback(work, { timeout: 5000 });
      else setTimeout(work, 200);
    }
    return skyCache?.events ?? [];
  }

  // ---- drawing ------------------------------------------------------------------------------

  function badge(all: Row[]): void {
    const events = all.filter((row) => row.kind === 'alert').length;
    const ongoing = all.filter((row) => row.kind === 'ongoing').length;
    dot.textContent = events > 0 ? String(events) : '';
    dot.classList.toggle('is-hidden', events + ongoing === 0);
    dot.classList.toggle('is-quiet', events === 0);
    phoneDot?.classList.toggle('is-hidden', events === 0);
    button.classList.toggle('is-live', events > 0);
    button.title = events > 0 ? `${events} happening now — what's live and coming up` : "What's live and coming up";
  }

  function render(): void {
    refreshIss();
    const all = rows();
    badge(all);
    notify(all);
    if (!open) return;
    const parts: HTMLElement[] = [];
    const section = (title: string, items: Row[]) => {
      if (items.length === 0) return;
      const head = el('div', 'bell-head', title);
      if (items.some((row) => row.icon === 'dish')) {
        // Where "in contact" comes from: NASA's own live page of the same feed.
        const source = el('a', 'bell-source', 'Contacts: NASA DSN Now ↗');
        source.href = DSN_NOW_URL;
        source.target = '_blank';
        source.rel = 'noopener noreferrer';
        source.title = 'NASA’s live Deep Space Network page, the source of every contact listed here';
        head.append(source);
      }
      parts.push(head);
      for (const row of items) {
        const item = el('button', `bell-row is-${row.kind}`);
        item.type = 'button';
        const icon = el('span', 'bell-icon');
        icon.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true">${ICONS[row.icon]}</svg>`;
        const text = el('span', 'bell-text');
        text.append(el('b', '', row.title), el('span', '', row.note));
        item.append(icon, text);
        if (row.kind === 'alert') item.append(el('span', 'bell-live', 'Live'));
        item.addEventListener('click', () => {
          setOpen(false);
          row.run();
        });
        parts.push(item);
      }
    };
    section('Happening now', all.filter((row) => row.kind === 'alert'));
    section('Ongoing', all.filter((row) => row.kind === 'ongoing'));
    section('Coming up', all.filter((row) => row.kind === 'coming'));
    if (parts.length === 0) parts.push(el('p', 'bell-empty', 'Nothing to report just now. Contacts, launches and meteor showers appear here as they happen.'));
    parts.push(notifyFooter());
    list.replaceChildren(...parts);
  }

  // ---- asking (politely) --------------------------------------------------------------------

  let stopDsn: (() => void) | null = null;
  let dsnAt = 0;
  const readDsnOnce = (): void => {
    dsnAt = Date.now();
    const once = watchDsn((next) => {
      once();
      links = next;
      render();
    });
  };
  const readLaunches = (): void => {
    void loadLaunches().then(({ list: got }) => {
      if (got) launches = got.launches;
      render();
    });
  };
  let launchesAt = 0;

  function setOpen(next: boolean): void {
    open = next;
    menu.classList.toggle('is-hidden', !open);
    button.setAttribute('aria-expanded', String(open));
    if (open) {
      stopDsn = watchDsn((next) => {
        links = next;
        render();
      });
      readLaunches();
      launchesAt = Date.now();
    } else {
      stopDsn?.();
      stopDsn = null;
    }
    render();
  }

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(!open);
  });
  document.addEventListener('pointerdown', (event) => {
    if (open && !menu.contains(event.target as Node) && !button.contains(event.target as Node)) setOpen(false);
  });
  window.addEventListener('keydown', (event) => {
    if (open && event.key === 'Escape') {
      event.stopImmediatePropagation(); // Escape closes the list only
      setOpen(false);
    }
  }, true);

  void loadDeep().then((deep) => {
    if (deep) flybys = deep.flybys;
    render();
  });
  // The launch list once the page has settled (from its saved copy if that is under an hour old).
  window.setTimeout(() => {
    readLaunches();
    launchesAt = Date.now();
  }, 8000);
  dsnAt = Date.now(); // the Deep Space Network section reads the feed once at start; take that answer
  window.setTimeout(() => {
    links = latestDsn();
    render();
  }, 9000);

  // Keep the badge honest while the tab is visible: countdowns move, and contacts begin and end.
  window.setInterval(() => {
    if (document.hidden) return;
    const now = Date.now();
    if (!open && now - dsnAt > DSN_EVERY_MS) readDsnOnce();
    if (now - launchesAt > LAUNCHES_EVERY_MS) {
      launchesAt = now;
      readLaunches();
    }
    render();
  }, 30000);
}

/** The Sun's altitude at a place, degrees (low precision: enough to tell night from twilight). */
function sunAltitudeDeg(latDeg: number, lonDeg: number, tMs: number): number {
  const d = (tMs - Date.UTC(2000, 0, 1, 12)) / 86400000;
  const rad = Math.PI / 180;
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const lambda = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = (280.46061837 + 360.98564736629 * d) * rad;
  const hour = gmst + lonDeg * rad - ra;
  const lat = latDeg * rad;
  return Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hour)) / rad;
}
