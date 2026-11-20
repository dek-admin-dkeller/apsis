/**
 * Loading screen: animated object counter and progress bar.
 *
 * On a visit to the home page it comes FIRST (the owner's choice; `html.intro`, set by the
 * inline script in index.html, puts it above the page): the rocket climbs with the real
 * progress, an altitude gauge beside it filling as it goes, and lifts off to reveal the home
 * page once the globe and the catalogue are in (`introLiftoff`; main.ts decides when).
 *
 * Opened straight into the tracker it stays up until everything has loaded, then lifts off.
 * From the home page it is under that page and mostly never seen: it is set aside as soon as
 * the globe can be drawn (`setAside`), and only comes back if the visitor goes into the
 * tracker before the rest has loaded. Its progress is kept up to date either way.
 */

import { $, fmtInt } from './dom.ts';

export class LoadingScreen {
  private readonly counter = $('loading-count');
  private readonly bar = $('loading-bar');
  private readonly status = $('loading-status');
  private counted: Promise<void> = Promise.resolve();

  /** Count up from 0 to the number of objects in the catalogue. */
  countTo(total: number, durationMs = 2200): void {
    this.counted = new Promise((resolve) => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, Math.max(0, (now - start) / durationMs)); // the first frame's timestamp can predate `start`
        this.counter.textContent = fmtInt(total * (1 - Math.pow(1 - t, 3))); // ease-out
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  private shown = 0;

  /** Progress never goes backwards, even though textures and data finish in no fixed order. */
  progress(fraction: number, status: string): void {
    fraction = this.shown = Math.max(this.shown, fraction);
    this.bar.style.width = `${Math.round(fraction * 100)}%`;
    $('loading').dataset.percent = String(Math.round(fraction * 100)); // the gauge's label (launch.ts)
    $('loading').style.setProperty('--p', fraction.toFixed(3)); // how high the rocket has climbed
    this.status.textContent = status;
  }

  /**
   * The end of the launch screen that opens a visit: lift-off, then the home page. If the
   * tracker is not loaded yet (a slow connection), the screen is put away under the page,
   * ready to come back with its real progress if the visitor goes in early.
   */
  async introLiftoff(loaded: boolean): Promise<void> {
    if (loaded) this.progress(1, 'Ready');
    $('loading').classList.add('is-liftoff');
    await new Promise((resolve) => setTimeout(resolve, 850));
    $('loading').classList.add(loaded ? 'is-done' : 'is-leaving'); // fades out, still above the page
    await new Promise((resolve) => setTimeout(resolve, 1000));
    document.documentElement.classList.remove('intro'); // now under the page again
    if (!loaded) {
      $('loading').classList.remove('is-liftoff', 'is-leaving'); // back on its pad, out of sight
      this.setAside(true);
    }
  }

  /** Launch and fade out once the counter has finished its run. */
  async finish(): Promise<void> {
    await this.counted;
    this.progress(1, 'Lift-off');
    $('loading').classList.add('is-liftoff'); // the rocket leaves the top of the screen …
    await new Promise((resolve) => setTimeout(resolve, 900));
    $('loading').classList.add('is-done'); // … and the globe fades in behind it
  }

  /**
   * Take the screen out of the picture without ending it (true), or bring it back (false).
   * Used while the home page is showing the live globe through itself: the page's backdrop
   * is see-through then, and this screen must not be what shows.
   */
  setAside(on: boolean): void {
    $('loading').classList.toggle('is-aside', on);
  }

  /**
   * The tracker finished loading while the visitor was still on the home page: put this
   * screen away at once, with no lift-off, so the live globe can show through that page.
   */
  skip(): void {
    this.progress(1, 'Ready');
    $('loading').classList.add('is-done');
  }

  fail(message: string): void {
    this.status.textContent = message;
    this.status.style.color = 'var(--red)';
  }
}
