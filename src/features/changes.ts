/**
 * Orbit changes and data freshness (a feature module: see src/ui/app.ts).
 *
 *   Objects panel, "Orbit changes" (#changes-body)
 *       What differs between the two most recent downloads of the catalogue: objects whose
 *       orbit grew, shrank or tilted by more than air drag and measurement noise explain
 *       ("possible manoeuvres"), objects that are new, objects that are gone.
 *   Inspector, Live tab (#insp-fresh)
 *       For the selected object: how old its elements are (with a warning once they are
 *       stale), its catalogue status in words, and its entry in the list above if it has one.
 *
 * Where a comparison comes from:
 *   - public/data/changes.json, written at build time when the site refreshes its data every
 *     8 hours (scripts/diff-elements.mjs). It does not exist locally or on a first deployment.
 *   - or it is made here, when the catalogue is replaced ("Download current elements"): the
 *     catalogue that was loaded is compared with the one that replaced it.
 * Both use the same rules, src/data/changes.ts. This file is only wording and DOM, and it
 * never fetches anything except that one small file from its own site.
 */

import './changes.css';
import type { Catalog } from '../data/catalog.ts';
import { CHANGE_KINDS, compareElements, epochMs, STALE_DAYS, type ChangeKind, type ChangeReport, type OrbitChange } from '../data/changes.ts';
import { statusLabel } from '../data/satcat.ts';
import { CATEGORY_COLORS, type Satellite, type Snapshot } from '../data/types.ts';
import type { App } from '../ui/app.ts';
import { CUSTOM_NORAD_ID } from '../ui/designer.ts';
import { $, fmt, fmtInt, fmtKm, fmtRange } from '../ui/dom.ts';
import { clockStamp, utcStamp } from '../ui/inspector.ts';

const DAY_MS = 86400000;
const ROWS_SHOWN = 5; // per group, until "Show all" is pressed
const FRESH_REDRAW_S = 5; // how often "14 hours ago" is brought up to date

const HEADING: Record<ChangeKind, string> = { raised: 'Raised', lowered: 'Lowered', plane: 'Changed tilt', new: 'New in the data', gone: 'No longer in the data' };
const COUNT_WORD: Record<ChangeKind, string> = { raised: 'raised', lowered: 'lowered', plane: 'changed tilt', new: 'new', gone: 'gone' };
/** When a group was cut short: which of its members the list kept (see compareElements). */
const KEPT_WORD: Record<ChangeKind, string> = { raised: 'clearest', lowered: 'clearest', plane: 'clearest', new: 'newest', gone: 'lowest' };

/** What a catalogue status means for reading the data, added after the inspector's own word for it. */
const STATUS_HINT: Record<string, string> = {
  '-': 'no longer controlled', D: 'reported as re-entered', X: 'working past its planned life', B: 'held in reserve', S: 'held in reserve',
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

/** A change in orbit size: metres (or feet) below a kilometre, fewer decimals as it grows. */
function size(km: number): string {
  const v = Math.abs(km);
  return v < 10 ? fmtRange(v) : fmtKm(v, v < 100 ? 1 : 0);
}
const tilt = (deg: number): string => `${deg < 0 ? '−' : '+'}${fmt(Math.abs(deg), Math.abs(deg) < 0.1 ? 3 : 2)}°`;

/** "14 hours", "3.2 days": a span of time in the words the Data note in Settings uses. */
function span(ms: number): string {
  const hours = Math.abs(ms) / 3.6e6;
  if (hours < 1) return 'less than an hour';
  if (hours < 48) return Math.round(hours) === 1 ? '1 hour' : `${Math.round(hours)} hours`;
  return `${fmt(hours / 24, 1)} days`;
}

/** The right-hand end of a list row: the change in two or three words. */
function brief(change: OrbitChange): string {
  switch (change.kind) {
    case 'raised': return `up ${size(change.deltaKm)}`;
    case 'lowered': return `down ${size(change.deltaKm)}`;
    case 'plane': return `tilt ${tilt(change.deltaIncDeg)}`;
    case 'new': return `at ${fmtKm(change.altKm)}`;
    case 'gone': return `was at ${fmtKm(change.altKm)}`;
  }
}

/** The same, as the value of a row in the inspector. */
function headline(change: OrbitChange): string {
  switch (change.kind) {
    case 'raised': return `Raised ${size(change.deltaKm)}`;
    case 'lowered': return `Lowered ${size(change.deltaKm)}`;
    case 'plane': return `Tilt ${tilt(change.deltaIncDeg)}`;
    case 'new': return 'New in the data';
    case 'gone': return 'No longer in the data';
  }
}

/** The same change as a full sentence or two, for the inspector and the row's tooltip. */
function sentence(change: OrbitChange, report: ChangeReport): string {
  if (change.kind === 'new') return `New in the data: it was not in the download of ${clockStamp(Date.parse(report.from))}.`;
  if (change.kind === 'gone') {
    return `Not in the latest download. Last measured ${clockStamp(change.prevEpochMs)} at about ${fmtKm(change.altKm)}; it may have re-entered or been taken off the list.`;
  }
  const between = `between its measurements of ${utcStamp(change.prevEpochMs)} and ${clockStamp(change.nextEpochMs)}`;
  const drag = -change.expectedKm; // how far the earlier record expected it to sink by itself
  let text: string;
  if (change.kind === 'raised') {
    text = `Possible manoeuvre: its orbit grew by ${size(change.deltaKm)} ${between}.`;
    if (drag > 0.005) text += ` Air drag alone would have lowered it by about ${size(drag)}.`;
    else if (change.expectedKm > 0.005) text += ` Its own slow drift explains about ${size(change.expectedKm)} of that.`;
  } else if (change.kind === 'lowered') {
    text = `Possible manoeuvre: its orbit shrank by ${size(change.deltaKm)} ${between}.`;
    if (drag > 0.005) text += ` Air drag alone explains about ${size(drag)} of that.`;
  } else {
    text = `Possible manoeuvre: its tilt changed by ${tilt(change.deltaIncDeg)} ${between}, with no clear change in height.`;
  }
  if (change.kind !== 'plane' && change.planeChanged) text += ` Its tilt also changed by ${tilt(change.deltaIncDeg)}.`;
  return text;
}

export function installChanges(app: App): void {
  const body = $('changes-body');
  const freshBox = $('insp-fresh');
  body.classList.add('changes');

  let report: ChangeReport | null = null;
  let madeHere = false; // compared in this browser rather than read from changes.json
  let settled = false; // the look for changes.json has finished (until then the section stays blank)
  // NORAD id → its change: a hash table, so the inspector finds the selected object's entry
  // in one lookup instead of searching the list.
  let byId = new Map<number, OrbitChange>();
  const expanded = new Set<ChangeKind>();
  let request = 0; // guards against a late reply for a catalogue that has since been replaced

  function setReport(next: ChangeReport | null, here: boolean): void {
    report = next;
    madeHere = here;
    settled = true;
    byId = new Map((next?.changes ?? []).map((change) => [change.noradId, change]));
    expanded.clear();
    renderList();
    renderFresh(true);
  }

  /** The comparison made when the site was built, if there is one and it belongs to this catalogue. */
  async function loadPublished(catalog: Catalog): Promise<void> {
    const mine = ++request;
    let found: ChangeReport | null = null;
    try {
      const res = await fetch('./data/changes.json');
      // A missing file can come back as the app's own HTML page; json() then throws, which is fine.
      const file = res.ok ? ((await res.json()) as ChangeReport) : null;
      // It must describe the download that is loaded: a file left from another one would name
      // changes that are not in this data.
      if (file && Array.isArray(file.changes) && file.counts && file.to === catalog.fetchedAt) found = file;
    } catch { /* no file (local copy, first deployment) or offline: there is simply no comparison yet */ }
    if (mine === request) setReport(found, false);
  }

  /** A catalogue as the comparison wants it: the plain records, without the visitor's own designed satellite. */
  const records = (catalog: Catalog): Snapshot => ({
    fetchedAt: catalog.fetchedAt,
    objects: catalog.sats.map((sat) => sat.omm).filter((rec) => rec.NORAD_CAT_ID !== CUSTOM_NORAD_ID),
  });

  // ---- the list in the Objects panel ------------------------------------------------------

  function row(change: OrbitChange, shown: ChangeReport): HTMLLIElement {
    const sat = app.catalog()?.byNorad.get(change.noradId); // gone objects are not in the catalogue
    const li = el('li');
    li.dataset.norad = String(change.noradId);
    const pick = el('button', 'watch-pick');
    const dot = el('i', 'dot');
    if (sat) dot.style.color = CATEGORY_COLORS[sat.category];
    pick.append(dot, el('span', 'name', change.name), el('span', 'alt', brief(change)));
    pick.title = sentence(change, shown);
    pick.disabled = !sat;
    // Looked up again at the click: the catalogue (and its Satellite objects) may have been rebuilt since.
    pick.addEventListener('click', () => {
      const now = app.catalog()?.byNorad.get(change.noradId);
      if (now) app.select(now);
    });
    li.classList.toggle('is-on', app.selected()?.noradId === change.noradId);
    li.append(pick);
    return li;
  }

  function renderList(): void {
    if (!settled) return;
    if (!report) {
      const settings = el('button', 'link', 'Open Settings');
      settings.addEventListener('click', () => app.openPanel('settings'));
      body.replaceChildren(
        el('p', 'note', 'No comparison yet. This list needs two downloads of the catalogue to set side by side. '
          + 'It appears after the site’s next data refresh (every 8 hours), or straight away if you press “Download current elements” in Settings.'),
        settings,
      );
      return;
    }
    const shown = report;
    const from = Date.parse(shown.from), to = Date.parse(shown.to);
    const found = CHANGE_KINDS.filter((kind) => shown.counts[kind] > 0).map((kind) => `${fmtInt(shown.counts[kind])} ${COUNT_WORD[kind]}`);
    const nodes: HTMLElement[] = [
      el('p', 'note changes-summary', `Between ${utcStamp(from)} and ${clockStamp(to)}: ${found.length > 0 ? found.join(', ') : 'nothing beyond ordinary drag and measurement noise'}.`),
    ];

    for (const kind of CHANGE_KINDS) {
      const group = shown.changes.filter((change) => change.kind === kind);
      if (group.length === 0) continue;
      // Biggest first within a group (the file is ordered by how clear each change is instead).
      if (kind === 'raised' || kind === 'lowered') group.sort((a, b) => Math.abs(b.deltaKm) - Math.abs(a.deltaKm));
      else if (kind === 'plane') group.sort((a, b) => Math.abs(b.deltaIncDeg) - Math.abs(a.deltaIncDeg));
      const total = shown.counts[kind];
      const heading = el('p', 'field-label');
      heading.append(el('span', '', HEADING[kind]), el('span', 'count', total > group.length ? `${fmtInt(total)}, ${KEPT_WORD[kind]} ${group.length} listed` : fmtInt(total)));
      const list = el('ol', 'watch-list');
      list.append(...(expanded.has(kind) ? group : group.slice(0, ROWS_SHOWN)).map((change) => row(change, shown)));
      nodes.push(heading, list);
      if (group.length > ROWS_SHOWN) {
        const more = el('button', 'link', expanded.has(kind) ? 'Show fewer' : `Show all ${group.length}`);
        more.addEventListener('click', () => {
          if (!expanded.delete(kind)) expanded.add(kind);
          renderList();
        });
        nodes.push(more);
      }
    }

    // What the words mean and how far to trust them, in the same breath as the list.
    let about = '“Raised”, “lowered” and “changed tilt” are possible manoeuvres: the orbit changed by more than air drag and measurement noise explain. '
      + 'That is worked out from two sets of published elements, not a confirmed report, and a poor measurement can look the same. ';
    if (to - from > 3 * DAY_MS) about += `These two downloads are ${span(to - from)} apart, so only large changes can be told from drag. `;
    about += `${fmtInt(shown.compared)} objects had been measured again; ${fmtInt(shown.unchanged)} had not, so nothing can be said about those.`;
    if (madeHere) about += ' Compared in this browser, between the data that was loaded and the elements you downloaded.';
    nodes.push(el('p', 'note', about));
    body.replaceChildren(...nodes);
  }

  // ---- the selected object (inspector, Live tab) --------------------------------------------

  let freshKey = ''; // what is on screen now, so the periodic redraw only touches the page when the words change
  let lastFreshAt = -Infinity;

  function renderFresh(force = false, sat: Satellite | null = app.selected()): void {
    if (!sat) {
      freshKey = '';
      freshBox.replaceChildren();
      return;
    }
    const epoch = epochMs(sat.omm);
    const now = Date.now();
    const age = now - epoch;
    const facts = app.facts();
    const fact = facts.get(sat.noradId);
    const change = byId.get(sat.noradId);
    // The picture is drawn for the simulated time, so that is what staleness has to be judged against.
    const clockAway = Math.abs(app.time() - now) > 3.6e6;
    const gapDays = Math.abs(app.time() - epoch) / DAY_MS;
    const stale = gapDays > STALE_DAYS;

    const measured = age >= 0 ? `${span(age)} ago` : `${span(age)} ahead`;
    const own = sat.noradId === CUSTOM_NORAD_ID; // designed by the visitor: nobody measured it
    let status: string;
    if (own) status = 'Your own design';
    else if (facts.size === 0) status = 'Not available'; // the catalogue facts file is optional
    else if (!fact) status = 'Not in the catalogue file';
    else {
      const hint = fact.status ? STATUS_HINT[fact.status] : fact.type === 'DEB' ? 'usual for debris' : fact.type === 'R/B' ? 'usual for rocket bodies' : '';
      status = hint ? `${statusLabel(fact.status)} (${hint})` : statusLabel(fact.status); // statusLabel: the inspector's own wording
    }
    let warning = '';
    if (stale && clockAway) warning = `The clock is set ${span(gapDays * DAY_MS)} from this measurement, so the position drawn is only a rough prediction.`;
    else if (stale) warning = `More than ${STALE_DAYS} days old. A prediction drifts further from the truth every day, so the position drawn may be far from where this object really is.`;
    else if (age < 0 && !own) warning = 'Dated in the future: this is a forecast orbit rather than a measurement.';
    let note = '';
    if (change && report) {
      note = sentence(change, report);
      if (change.kind !== 'new') {
        note += fact && (fact.status === '-' || fact.status === 'D')
          ? ' The catalogue lists it as non-operational, so a poor measurement is the likelier explanation.'
          : ' Worked out from the published elements; not a confirmed report.';
      }
    }

    const stamp = clockStamp(epoch);
    const key = [sat.noradId, own, measured, stamp, status, warning, note].join('|');
    if (!force && key === freshKey) return;
    freshKey = key;

    const facet = (term: string, value: HTMLElement | string, className = ''): HTMLElement => {
      const line = el('div');
      const dd = el('dd', `plain ${className}`.trim());
      dd.append(value);
      line.append(el('dt', '', term), dd);
      return line;
    };
    const when = el('span');
    when.append(measured, el('span', 'muted', ` · ${stamp}`));
    const list = el('dl', 'kv fresh');
    list.append(facet(own ? 'Elements written' : age >= 0 ? 'Elements measured' : 'Elements dated', when, stale ? 'is-stale' : ''), facet('Catalogue status', status));
    if (change) list.append(facet('Since the previous download', headline(change), 'is-flagged'));
    freshBox.replaceChildren(list, ...[el('p', 'note fresh-warn', warning), el('p', 'note', note)].filter((p) => p.textContent));
  }

  // ---- wiring -------------------------------------------------------------------------------

  app.onCatalog((next, previous) => {
    if (!previous) return void loadPublished(next); // start-up: is there a comparison from build time?
    if (previous.fetchedAt === next.fetchedAt) {
      // The same download, rebuilt (the visitor added or removed their own satellite): the
      // comparison still stands, but rows must find their objects in the new catalogue.
      renderList();
      return;
    }
    request++; // a reply still on its way for the old catalogue no longer applies
    const older = Date.parse(next.fetchedAt) > Date.parse(previous.fetchedAt);
    setReport(older ? compareElements(records(previous), records(next)) : null, true);
  });
  app.onSelect((sat) => {
    for (const li of body.querySelectorAll<HTMLElement>('li[data-norad]')) li.classList.toggle('is-on', !!sat && li.dataset.norad === String(sat.noradId));
    renderFresh(true, sat);
  });
  app.onFacts(() => renderFresh(true));
  app.onSettings((_settings, changed) => {
    // Lengths and times are written as text, so they are rewritten when the unit or clock choice changes.
    if (changed === null || changed === 'units' || changed === 'clockZone') {
      renderList();
      renderFresh(true);
    }
  });
  app.onFrame((frame) => {
    if (frame.uiHidden || !app.selected() || frame.realSeconds - lastFreshAt < FRESH_REDRAW_S) return;
    lastFreshAt = frame.realSeconds;
    renderFresh(); // keeps "14 hours ago" and the clock warning current; writes nothing if the words are the same
  });

  const loaded = app.catalog();
  if (loaded) void loadPublished(loaded); // installed after the catalogue arrived
}
