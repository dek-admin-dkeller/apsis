/**
 * Export a close approach as a printable report or a CSV table (reserved element: #enc-export
 * in the close-approach panel).
 *
 * Two buttons, shown while an approach is open:
 *   Report      a one-page document in a new tab, to print or save as a PDF from the browser
 *               (no PDF library: the browser's own print dialog is the PDF route)
 *   Data (CSV)  both objects' positions and velocities and the range between them, one row
 *               per time step through the approach
 * Every number is recomputed from the two element sets (data/approachData.ts); the page is
 * laid out in features/reportPage.ts. This file only gathers the inputs and delivers the result.
 */

import { approachCsv, approachRows, epochMs, summarize, type ApproachSummary } from '../data/approachData.ts';
import { rangeKm } from '../data/ephemeris.ts';
import { regionName } from '../data/regions.ts';
import { ownerName, typeLabel } from '../data/satcat.ts';
import type { Satellite } from '../data/types.ts';
import type { App } from '../ui/app.ts';
import { $ } from '../ui/dom.ts';
import type { Encounter } from '../ui/encounterPanel.ts';
import './report.css';
import { reportHtml, type ReportObject } from './reportPage.ts';

const CHART_SAMPLES = 161; // the same resolution as the panel's own range chart

/** Hand the browser a file to save. The blob's address is released once the download has had time to start. */
function download(filename: string, mime: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // Not straight away: Safari cancels a download whose address is revoked in the same tick.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** "25544-48274-20261118T140322Z": the two catalogue numbers and the time, safe in a file name. */
const fileStem = (enc: Encounter, tcaMs: number): string =>
  `apsis-close-approach-${enc.a.noradId}-${enc.b.noradId}-${new Date(Math.round(tcaMs)).toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;

export function installReport(app: App): void {
  const slot = $('enc-export');
  slot.classList.add('enc-export');
  const button = (label: string, title: string): HTMLButtonElement => {
    const node = document.createElement('button');
    node.className = 'btn';
    node.type = 'button';
    node.textContent = label;
    node.title = title;
    return node;
  };
  const reportButton = button('Report', 'Open a one-page report in a new tab, to print or save as a PDF');
  const csvButton = button('Data (CSV)', 'Download both objects\' positions and velocities through the approach as a table');
  slot.append(reportButton, csvButton);

  const show = (encounter: Encounter | null): void => void slot.classList.toggle('is-hidden', !encounter);
  app.onEncounter(show);
  show(app.encounter());

  /** The closest approach worked out afresh from the two element sets, or a message if SGP4 cannot do it. */
  const summaryOf = (enc: Encounter): ApproachSummary | null => {
    const summary = summarize(enc.recA, enc.recB, enc.approach.tcaMs);
    if (!summary) app.toast('These orbits cannot be computed at that time');
    return summary;
  };

  /** What the catalogue knows about one object, in words (empty strings where the facts file has nothing). */
  const describe = (sat: Satellite, epoch: number): ReportObject => {
    const fact = app.facts().get(sat.noradId); // Map keyed by NORAD id
    return {
      name: sat.name, noradId: sat.noradId, intlDes: sat.intlDes,
      type: fact ? typeLabel(fact.type) : '',
      owner: fact?.owner ? ownerName(fact.owner) : '',
      // The full date when the catalogue facts have it; otherwise the year the designator starts with.
      launched: fact?.launchDate || (sat.launchYear ? String(sat.launchYear) : ''),
      epochMs: epoch,
    };
  };

  reportButton.addEventListener('click', () => {
    const enc = app.encounter();
    const summary = enc && summaryOf(enc);
    if (!enc || !summary) return;
    const ranges: number[] = [];
    for (let i = 0; i < CHART_SAMPLES; i++) {
      ranges.push(rangeKm(enc.recA, enc.recB, summary.tcaMs + ((i / (CHART_SAMPLES - 1)) * 2 - 1) * enc.windowS * 1000));
    }
    const html = reportHtml({
      a: describe(enc.a, epochMs(enc.recA)),
      b: describe(enc.b, epochMs(enc.recB)),
      summary,
      coMoving: enc.approach.coMoving,
      windowS: enc.windowS,
      ranges,
      alertKm: app.alertKm(),
      region: regionName(summary.mid.latDeg, summary.mid.lonDeg),
      generatedMs: Date.now(),
      dataFetchedAt: app.catalog()?.fetchedAt ?? '',
      localClock: app.settings().clockZone === 'local',
    });
    // The tab is opened here, inside the click itself: a window opened later (after a timer or
    // a network reply) is what pop-up blockers stop. Everything above is quick and synchronous.
    const tab = window.open('', '_blank');
    if (!tab) {
      download(`${fileStem(enc, summary.tcaMs)}.html`, 'text/html', html);
      app.toast('The browser blocked the new tab, so the report was saved as a file instead');
      return;
    }
    tab.document.open();
    tab.document.write(html);
    tab.document.close();
  });

  csvButton.addEventListener('click', () => {
    const enc = app.encounter();
    const summary = enc && summaryOf(enc);
    if (!enc || !summary) return;
    const rows = approachRows(enc.recA, enc.recB, summary.tcaMs, enc.windowS);
    const csv = approachCsv(rows, summary, { nameA: enc.a.name, noradA: enc.a.noradId, nameB: enc.b.name, noradB: enc.b.noradId });
    download(`${fileStem(enc, summary.tcaMs)}.csv`, 'text/csv', csv);
    app.toast(`Saved ${rows.length} rows`);
  });
}
