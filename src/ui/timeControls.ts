/**
 * The time bar: a draggable day-long timeline on top; below it the UTC clock (click it to
 * set a date), play / pause, direction, 10-minute steps, speed and "Now".
 */

import { $ } from './dom.ts';
import { duration } from './inspector.ts';

export interface SimClock {
  time: number; // simulated time, Unix ms
  speed: number; // simulated seconds per real second (negative = backwards)
  paused: boolean;
}

const STEP_MS = 10 * 60 * 1000;
const HALF_WINDOW_MS = 12 * 3600 * 1000; // the timeline shows 12 hours either side of its centre

export class TimeControls {
  private readonly play = $('play');
  private readonly reverse = $('reverse');
  private readonly speeds = [...$('speeds').querySelectorAll('button')];
  private readonly input = $<HTMLInputElement>('clock-input');
  private readonly clock: SimClock;
  private readonly onJump: (timeMs: number) => void;
  private readonly timeline = $<HTMLInputElement>('timeline');
  private shownSecond = -1;
  /** Centre of the timeline window: the real present, unless the clock has been taken far from it. */
  private anchorMs: number | null = null; // null = follow the real present
  private dragging = false;

  /**
   * @param onChange  speed / pause changed
   * @param onJump    the clock should move to this time (the caller resets the simulation)
   * @param onNow     back to real time
   */
  constructor(clock: SimClock, onChange: () => void, onJump: (timeMs: number) => void, onNow: () => void) {
    this.clock = clock;
    this.onJump = onJump;
    this.play.addEventListener('click', () => {
      clock.paused = !clock.paused;
      this.sync();
      onChange();
    });
    this.reverse.addEventListener('click', () => {
      this.flip();
      onChange();
    });
    for (const button of this.speeds) {
      button.addEventListener('click', () => {
        clock.speed = Number(button.dataset.speed) * (clock.speed < 0 ? -1 : 1);
        clock.paused = false;
        this.sync();
        onChange();
      });
    }
    $('step-back').addEventListener('click', () => this.step(-1));
    $('step-fwd').addEventListener('click', () => this.step(1));
    $('now').addEventListener('click', () => {
      this.anchorMs = null;
      onNow();
    });

    // Dragging the timeline moves the clock; the simulation follows as fast as it can.
    this.timeline.addEventListener('input', () => {
      this.dragging = true;
      onJump(this.windowCentre() + Number(this.timeline.value) * 60000);
    });
    this.timeline.addEventListener('change', () => (this.dragging = false));
    this.timeline.addEventListener('keydown', (event) => event.stopPropagation()); // arrow keys nudge the slider only

    // Clicking the clock swaps it for a date-time field (UTC).
    $('clock-btn').addEventListener('click', () => {
      this.input.value = new Date(clock.time).toISOString().slice(0, 19);
      this.input.classList.remove('is-hidden');
      $('clock-btn').classList.add('is-hidden');
      this.input.focus();
    });
    const commit = (apply: boolean) => {
      if (this.input.classList.contains('is-hidden')) return;
      this.input.classList.add('is-hidden');
      $('clock-btn').classList.remove('is-hidden');
      const t = Date.parse(this.input.value + 'Z');
      if (apply && Number.isFinite(t)) onJump(t);
    };
    this.input.addEventListener('keydown', (event) => {
      event.stopPropagation(); // typing digits must not trigger the 1 / 2 / 3 shortcuts
      if (event.key === 'Enter') commit(true);
      if (event.key === 'Escape') commit(false);
    });
    this.input.addEventListener('blur', () => commit(true));
    this.sync();

    // The bar rests as a small pill and opens while it is in use: straight away when the
    // pointer arrives, closing a moment after it leaves (never mid-drag or while a date is
    // being typed).
    const bar = this.play.closest<HTMLElement>('.timebar')!;
    let closing = 0;
    const open = () => {
      clearTimeout(closing);
      bar.classList.add('is-open');
    };
    const close = () => {
      clearTimeout(closing);
      closing = window.setTimeout(() => {
        const busy = this.dragging || !this.input.classList.contains('is-hidden') || bar.matches(':hover');
        if (busy) close();
        else bar.classList.remove('is-open');
      }, 900);
    };
    bar.addEventListener('pointerenter', (event) => {
      // Touch: the first tap only opens the bar — it must not also press whichever button
      // ends up under the finger once the bar has grown.
      if (event.pointerType === 'touch' && !bar.classList.contains('is-open')) {
        const swallow = (click: Event) => {
          click.stopPropagation();
          click.preventDefault();
        };
        bar.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => bar.removeEventListener('click', swallow, { capture: true }), 350);
      }
      open();
    });
    // Touch has no "pointer left": tapping anywhere else closes the bar.
    document.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch' && !bar.contains(event.target as Node) && this.input.classList.contains('is-hidden')) {
        clearTimeout(closing);
        bar.classList.remove('is-open');
      }
    });
    bar.addEventListener('pointerleave', close);
    bar.addEventListener('focusin', (event) => {
      if ((event.target as HTMLElement).matches(':focus-visible')) open(); // keyboard users
    });
    bar.addEventListener('focusout', close);
  }

  private windowCentre(): number {
    return this.anchorMs ?? Date.now();
  }

  /** Run time the other way. */
  flip(): void {
    this.clock.speed = -this.clock.speed;
    this.clock.paused = false;
    this.sync();
  }

  step(direction: 1 | -1): void {
    this.onJump(this.clock.time + direction * STEP_MS);
  }

  /** Reflect the clock's speed / paused state in the buttons. */
  sync(): void {
    const { clock } = this;
    this.play.classList.toggle('is-paused', clock.paused);
    this.play.setAttribute('aria-label', clock.paused ? 'Play (Space)' : 'Pause (Space)');
    this.reverse.setAttribute('aria-pressed', String(clock.speed < 0));
    this.play.closest<HTMLElement>('.timebar')!.dataset.direction = clock.speed < 0 ? 'back' : 'forward';
    for (const button of this.speeds) button.classList.toggle('is-on', Number(button.dataset.speed) === Math.abs(clock.speed));
    const rate = Math.abs(clock.speed) >= 1 ? `${Math.round(Math.abs(clock.speed))}×` : `${Math.abs(clock.speed).toFixed(2)}× slow motion`;
    $('sb-rate').textContent = clock.paused ? 'paused' : (clock.speed < 0 ? '−' : '') + rate;
    this.shownSecond = -1;
  }

  /** Call every frame; touches the DOM only when the displayed second changes. */
  render(): void {
    const second = Math.floor(this.clock.time / 1000);
    if (second === this.shownSecond) return;
    this.shownSecond = second;
    const iso = new Date(second * 1000).toISOString(); // 2026-11-16T21:03:11.000Z
    $('clock-date').textContent = iso.slice(0, 10);
    $('clock-time').textContent = iso.slice(11, 19);
    // How far the simulation is from the real present.
    const offset = this.clock.time - Date.now();
    const live = Math.abs(offset) < 5000 && !this.clock.paused && this.clock.speed === 1;
    $('clock-offset').textContent = Math.abs(offset) < 5000 ? '' : `${offset > 0 ? '+' : '−'}${duration(offset)}`;
    const now = $('now');
    now.textContent = live ? 'Live' : 'Now';
    now.classList.toggle('is-live', live);

    // Timeline: normally centred on the real present; if the clock is taken more than
    // 12 hours away (a typed date, a long fast-forward) the window re-centres on the clock.
    if (!this.dragging) {
      if (this.anchorMs === null && Math.abs(offset) > HALF_WINDOW_MS) this.anchorMs = this.clock.time;
      else if (this.anchorMs !== null && Math.abs(this.clock.time - this.anchorMs) > HALF_WINDOW_MS) {
        this.anchorMs = Math.abs(offset) <= HALF_WINDOW_MS ? null : this.clock.time;
      }
      this.timeline.value = String(Math.round((this.clock.time - this.windowCentre()) / 60000));
    }
    const centre = this.windowCentre();
    const stamp = (ms: number) => new Date(ms).toISOString().slice(5, 16).replace('T', ' ');
    $('tl-start').textContent = this.anchorMs === null ? '−12 h' : stamp(centre - HALF_WINDOW_MS);
    $('tl-end').textContent = this.anchorMs === null ? '+12 h' : stamp(centre + HALF_WINDOW_MS);
    const nowAt = (Date.now() - centre) / (2 * HALF_WINDOW_MS) + 0.5; // where the real present falls in the window
    const marker = $('tl-now');
    marker.style.display = nowAt >= 0 && nowAt <= 1 ? '' : 'none';
    marker.style.left = `${(nowAt * 100).toFixed(2)}%`;
  }
}
