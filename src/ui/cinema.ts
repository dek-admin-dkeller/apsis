/**
 * Cinema: two things for showing Apsis off without touching it.
 *
 *   Autopilot   a looping, hands-free tour of about a minute and a half — whole Earth, the
 *               low-orbit swarm, the Space Station, a ride along, Hubble, the geostationary
 *               ring, a close approach, the sky from the ground — with a caption per scene.
 *               Any key, click or scroll hands control back.
 *   Recording   saves what the 3D view shows (plus the caption and a small mark) as a video
 *               file. Works with or without the autopilot.
 *
 * This file knows nothing about the scene itself: everything it does goes through the
 * handful of actions main.ts passes in.
 */

import './cinema.css';

export interface CinemaActions {
  selectByName(name: string): boolean; // select + fly to an object; false if it is not in the catalogue
  deselect(): void;
  preset(which: 1 | 2 | 3): void; // whole Earth / low-orbit skim / GEO ring
  rideAlong(on: boolean): void; // view from the selected object
  skyView(on: boolean): void; // view from the ground station
  setMonitor(on: boolean): void; // close-approach monitor
  openClosestCrossing(): boolean; // opens the close-approach view on a crossing pair; false if none is listed yet
  closeApproach(): void;
  setSpeed(multiplier: number): void; // time rate: 1, 10, 100 or 1000
  hideInterface(on: boolean): void; // hides all panels and bars (same as the H key)
  toast(text: string): void;
}

interface Scene {
  title: string;
  text: string;
  seconds: number;
  /** Set the scene up. Return false to skip it (e.g. the object is not in the catalogue). */
  enter(): boolean | void;
}

const MAX_RECORDING_S = 180; // a video is kept in memory until it is saved, so bound it
const MAX_VIDEO_WIDTH = 1920;
const INPUT_GRACE_MS = 400; // the click or key that STARTED the autopilot must not also stop it
const DISPLAY_FONT = '"Space Grotesk Variable", "Inter Variable", system-ui, sans-serif';
const UI_FONT = '"Inter Variable", system-ui, sans-serif';

export class Cinema {
  /** Called whenever isPlaying / isRecording changes (so buttons can follow). */
  onChange: (() => void) | null = null;

  private readonly actions: CinemaActions;
  private readonly glCanvas: HTMLCanvasElement;
  private readonly scenes: Scene[];

  // ---- autopilot state
  private playing = false;
  private startedAt = 0;
  private sceneIndex = -1;
  private timers: number[] = [];
  private riding = false; // what the autopilot itself has switched on, so it can switch it off again
  private inSky = false;
  private approachOpen = false;
  private monitorOn = false;
  private hasSelection = false;

  // ---- caption (DOM + what the recording draws)
  private root: HTMLDivElement | null = null;
  private captionEl: HTMLDivElement | null = null;
  private titleEl: HTMLParagraphElement | null = null;
  private textEl: HTMLParagraphElement | null = null;
  private hintEl: HTMLDivElement | null = null;
  private caption: { title: string; text: string; shownAt: number } | null = null;

  // ---- recording state
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private videoCanvas: HTMLCanvasElement | null = null;
  private raf = 0;
  private recStartedAt = 0;
  private recTicker = 0;
  private recChip: HTMLDivElement | null = null;

  constructor(actions: CinemaActions, canvas: HTMLCanvasElement) {
    this.actions = actions;
    this.glCanvas = canvas;
    this.scenes = this.buildScenes();
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get isRecording(): boolean {
    return this.recorder !== null;
  }

  // ================================================================ autopilot

  /** Start the hands-free tour: hides the interface and shows a caption per scene. */
  play(): void {
    if (this.playing) return;
    this.buildDom();
    this.playing = true;
    this.startedAt = performance.now();
    this.sceneIndex = -1;
    this.actions.hideInterface(true);
    this.root!.classList.add('is-playing');
    this.hintEl!.classList.add('is-on');
    this.later(5000, () => this.hintEl?.classList.remove('is-on'));
    window.addEventListener('pointerdown', this.onUserInput, true);
    window.addEventListener('wheel', this.onUserInput, { capture: true, passive: true });
    window.addEventListener('keydown', this.onUserInput, true);
    this.next();
    this.onChange?.();
  }

  /** Stop the tour and put things back: interface shown, normal speed, special views closed. */
  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    this.clearTimers();
    window.removeEventListener('pointerdown', this.onUserInput, true);
    window.removeEventListener('wheel', this.onUserInput, true);
    window.removeEventListener('keydown', this.onUserInput, true);
    this.undoScene();
    this.actions.hideInterface(false);
    this.root?.classList.remove('is-playing');
    this.captionEl?.classList.remove('is-on');
    this.hintEl?.classList.remove('is-on');
    this.caption = null;
    // Whatever is selected stays selected for the user to explore; the next tour starts clean.
    this.hasSelection = false;
    this.selectedName = null;
    this.onChange?.();
  }

  /** Any real key press, click or scroll from the user ends the autopilot. */
  private readonly onUserInput = (event: Event): void => {
    if (!this.playing || !event.isTrusted) return; // ignore anything scripts dispatch
    if (performance.now() - this.startedAt < INPUT_GRACE_MS) return;
    if (event.type === 'keydown') {
      // The key only stops the tour; it must not also fire one of the app's shortcuts.
      event.stopImmediatePropagation();
      event.preventDefault();
    }
    this.stop();
  };

  private later(ms: number, run: () => void): void {
    this.timers.push(window.setTimeout(run, ms));
  }

  private clearTimers(): void {
    for (const id of this.timers) clearTimeout(id);
    this.timers = [];
  }

  /** Switch off whatever the previous scene switched on. */
  private undoScene(): void {
    if (this.riding) this.actions.rideAlong(false);
    if (this.approachOpen) this.actions.closeApproach();
    if (this.inSky) this.actions.skyView(false);
    if (this.monitorOn) this.actions.setMonitor(false);
    this.riding = this.approachOpen = this.inSky = this.monitorOn = false;
    this.actions.setSpeed(1);
  }

  private clearSelection(): void {
    if (this.hasSelection) this.actions.deselect();
    this.hasSelection = false;
    this.selectedName = null;
  }

  private selectedName: string | null = null;

  /** Select an object by name (once), remembering which one is selected. */
  private focusOn(name: string): boolean {
    if (this.selectedName === name && this.hasSelection) return true;
    const ok = this.actions.selectByName(name);
    if (ok) {
      this.selectedName = name;
      this.hasSelection = true;
    }
    return ok;
  }

  /** Move on to the next scene that agrees to run. */
  private next(): void {
    if (!this.playing) return;
    this.clearSceneTimers();
    for (let tries = 0; tries < this.scenes.length; tries++) {
      this.sceneIndex = (this.sceneIndex + 1) % this.scenes.length;
      const scene = this.scenes[this.sceneIndex];
      this.undoScene();
      if (scene.enter() === false) continue; // not available: try the one after
      this.showCaption(scene.title, scene.text);
      if (scene.seconds > 0) this.sceneTimer(scene.seconds * 1000, () => this.next());
      return;
    }
    this.stop(); // nothing could run at all
  }

  // Scene timers are kept apart from the start-up hint timer so advancing never cancels the hint.
  private sceneTimers: number[] = [];
  private sceneTimer(ms: number, run: () => void): void {
    const id = window.setTimeout(run, ms);
    this.sceneTimers.push(id);
    this.timers.push(id);
  }
  private clearSceneTimers(): void {
    for (const id of this.sceneTimers) clearTimeout(id);
    this.timers = this.timers.filter((id) => !this.sceneTimers.includes(id));
    this.sceneTimers = [];
  }

  private showCaption(title: string, text: string): void {
    this.caption = { title, text, shownAt: performance.now() + 280 };
    const el = this.captionEl!;
    el.classList.remove('is-on');
    // Swap the words while the old caption is faded out, then fade the new one in.
    this.sceneTimer(280, () => {
      this.titleEl!.textContent = title;
      this.textEl!.textContent = text;
      el.classList.add('is-on');
    });
  }

  private buildScenes(): Scene[] {
    const a = this.actions;
    return [
      {
        title: 'Earth orbit, right now',
        text: 'Every tracked object in Earth orbit, placed from public tracking data and moving in real time.',
        seconds: 10,
        enter: () => {
          this.clearSelection();
          a.preset(1);
        },
      },
      {
        title: 'Low Earth orbit',
        text: 'Most of what flies is here, a few hundred kilometres up. Time is running 100 times faster.',
        seconds: 12,
        enter: () => {
          this.clearSelection();
          a.preset(2);
          a.setSpeed(100);
        },
      },
      {
        title: 'International Space Station',
        text: 'About 420 km up, and once around the planet roughly every 93 minutes.',
        seconds: 12,
        enter: () => this.focusOn('ISS (ZARYA)'),
      },
      {
        title: 'Riding along',
        text: 'The view from the station, looking ahead along its orbit. Time is running 10 times faster.',
        seconds: 12,
        enter: () => {
          if (!this.focusOn('ISS (ZARYA)')) return false;
          a.rideAlong(true);
          this.riding = true;
          a.setSpeed(10);
        },
      },
      {
        title: 'Hubble Space Telescope',
        text: 'Launched in 1990 and still observing from above the atmosphere.',
        seconds: 11,
        enter: () => this.focusOn('HST'),
      },
      {
        title: 'The geostationary ring',
        text: 'At 35,786 km a satellite keeps pace with the turning Earth, so hundreds share one circle. Time is running 1,000 times faster.',
        seconds: 12,
        enter: () => {
          this.clearSelection();
          a.preset(3);
          a.setSpeed(1000);
        },
      },
      {
        title: 'Close approaches',
        text: 'Every object is checked against all the others about once a second.',
        seconds: 0, // timed by hand below: it depends on when the monitor has a crossing pair to show
        enter: () => {
          this.clearSelection();
          a.preset(1);
          a.setMonitor(true);
          this.monitorOn = true;
          const open = (): boolean => {
            if (!a.openClosestCrossing()) return false;
            this.approachOpen = true;
            this.showCaption('Two spacecraft, crossing paths', 'A slow-motion replay of the pass, with the distance between them.');
            this.sceneTimer(13000, () => this.next());
            return true;
          };
          // Give the monitor a few seconds to fill its list; one retry, then move on.
          this.sceneTimer(3500, () => {
            if (!open()) this.sceneTimer(3000, () => { if (!open()) this.next(); });
          });
        },
      },
      {
        title: 'From the ground',
        text: 'The same objects seen from the ground station, crossing the sky. Time is running 100 times faster.',
        seconds: 12,
        enter: () => {
          this.clearSelection();
          a.skyView(true);
          this.inSky = true;
          a.setSpeed(100);
        },
      },
    ];
  }

  private buildDom(): void {
    if (this.root) return;
    const root = document.createElement('div');
    root.id = 'cinema';
    root.setAttribute('aria-live', 'polite');
    const caption = document.createElement('div');
    caption.className = 'cinema-caption';
    const title = document.createElement('p');
    title.className = 'cinema-title';
    const text = document.createElement('p');
    text.className = 'cinema-text';
    caption.append(title, text);
    const hint = document.createElement('div');
    hint.className = 'cinema-hint';
    hint.textContent = 'Autopilot — press any key to stop';
    root.append(caption, hint);
    document.body.append(root);
    this.root = root;
    this.captionEl = caption;
    this.titleEl = title;
    this.textEl = text;
    this.hintEl = hint;
  }

  // ================================================================ recording

  /** Start or stop recording the view to a video file. */
  toggleRecording(): void {
    if (this.recorder) this.stopRecording();
    else this.startRecording();
  }

  private startRecording(): void {
    const video = document.createElement('canvas');
    if (typeof MediaRecorder === 'undefined' || typeof video.captureStream !== 'function') {
      this.actions.toast('This browser cannot record video. Try a current Chrome, Edge, Firefox or Safari.');
      return;
    }
    // Same shape as the 3D view, at most 1920 wide, even dimensions (video encoders require them).
    const source = this.glCanvas;
    const scale = Math.min(1, MAX_VIDEO_WIDTH / Math.max(1, source.width));
    video.width = Math.max(2, Math.round((source.width * scale) / 2) * 2);
    video.height = Math.max(2, Math.round((source.height * scale) / 2) * 2);

    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
      .find((type) => MediaRecorder.isTypeSupported(type));
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(video.captureStream(30), { mimeType, videoBitsPerSecond: 8_000_000 });
    } catch {
      this.actions.toast('Video recording could not start in this browser.');
      return;
    }
    this.videoCanvas = video;
    this.chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    recorder.onstop = () => this.saveRecording(recorder.mimeType || mimeType || 'video/webm');
    recorder.start(1000); // hand over a chunk every second
    this.recorder = recorder;
    this.recStartedAt = performance.now();

    // Copy the 3D view into the video canvas every frame. The WebGL canvas only holds its
    // picture during the frame it was drawn in, and the app's own frame callback runs before
    // this one in each tick, so the copy always sees a finished frame.
    const tick = () => {
      if (!this.recorder) return;
      this.drawVideoFrame();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);

    this.showRecChip();
    this.recTicker = window.setInterval(() => {
      const seconds = (performance.now() - this.recStartedAt) / 1000;
      this.updateRecChip(seconds);
      if (seconds >= MAX_RECORDING_S) this.stopRecording();
    }, 500);
    this.onChange?.();
  }

  private stopRecording(): void {
    const recorder = this.recorder;
    if (!recorder) return;
    this.recorder = null; // stops the frame loop
    cancelAnimationFrame(this.raf);
    clearInterval(this.recTicker);
    this.recChip?.classList.remove('is-on');
    try {
      recorder.stop(); // → onstop → saveRecording
    } catch { /* already stopped */ }
    for (const track of recorder.stream.getTracks()) track.stop();
    this.onChange?.();
  }

  private saveRecording(mimeType: string): void {
    const blob = new Blob(this.chunks, { type: mimeType });
    this.chunks = [];
    this.videoCanvas = null;
    if (blob.size === 0) {
      this.actions.toast('Nothing was recorded.');
      return;
    }
    const stamp = new Date().toISOString().slice(0, 19).replace('T', '-').replace(/:/g, ''); // 2026-11-18-004219
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `apsis-${stamp}.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    this.actions.toast('Video saved to your downloads');
  }

  /** One video frame: the 3D view, then the caption (if the autopilot is showing one) and a small mark. */
  private drawVideoFrame(): void {
    const video = this.videoCanvas;
    const ctx = video?.getContext('2d');
    if (!video || !ctx) return;
    const source = this.glCanvas;
    const w = video.width, h = video.height;
    if (source.width > 0 && source.height > 0) {
      // If the window was resized mid-recording, crop the centre rather than stretch the picture.
      const want = w / h, have = source.width / source.height;
      const sw = have > want ? source.height * want : source.width;
      const sh = have > want ? source.height : source.width / want;
      ctx.drawImage(source, (source.width - sw) / 2, (source.height - sh) / 2, sw, sh, 0, 0, w, h);
    }
    const unit = w / 1440; // text is sized as if the frame were 1440 CSS pixels wide
    ctx.textBaseline = 'alphabetic';

    const caption = this.playing ? this.caption : null;
    const alpha = caption ? Math.min(1, Math.max(0, (performance.now() - caption.shownAt) / 450)) : 0;
    if (caption && alpha > 0) {
      // A soft shade along the bottom keeps the words readable over a bright Earth.
      const shade = ctx.createLinearGradient(0, h * 0.62, 0, h);
      shade.addColorStop(0, 'rgba(2, 4, 10, 0)');
      shade.addColorStop(1, `rgba(2, 4, 10, ${0.62 * alpha})`);
      ctx.fillStyle = shade;
      ctx.fillRect(0, h * 0.62, w, h * 0.38);

      const left = Math.max(w * 0.04, 20 * unit);
      const maxWidth = Math.min(620 * unit, w * 0.8);
      ctx.globalAlpha = alpha;
      ctx.font = `400 ${15 * unit}px ${UI_FONT}`;
      const lines = wrapText(ctx, caption.text, maxWidth);
      let y = h - Math.max(h * 0.07, 40 * unit) - (lines.length - 1) * 22 * unit;
      const titleY = y - 26 * unit;
      ctx.fillStyle = '#7fe3ff';
      ctx.fillRect(left, titleY - 40 * unit, 28 * unit, 2 * unit);
      ctx.fillStyle = '#dce8f6';
      ctx.font = `600 ${27 * unit}px ${DISPLAY_FONT}`;
      ctx.fillText(caption.title, left, titleY);
      ctx.font = `400 ${15 * unit}px ${UI_FONT}`;
      ctx.fillStyle = 'rgba(220, 232, 246, 0.84)';
      for (const line of lines) {
        ctx.fillText(line, left, y);
        y += 22 * unit;
      }
      ctx.globalAlpha = 1;
    }

    // The mark, bottom right: letter-spaced by hand so it looks the same in every browser.
    ctx.font = `600 ${13 * unit}px ${DISPLAY_FONT}`;
    ctx.fillStyle = 'rgba(220, 232, 246, 0.6)';
    const gap = 4.5 * unit;
    const letters = [...'APSIS'];
    let x = w - Math.max(w * 0.03, 18 * unit) - letters.reduce((sum, ch) => sum + ctx.measureText(ch).width + gap, -gap);
    for (const ch of letters) {
      ctx.fillText(ch, x, h - Math.max(h * 0.035, 20 * unit));
      x += ctx.measureText(ch).width + gap;
    }
  }

  private showRecChip(): void {
    if (!this.recChip) {
      const chip = document.createElement('div');
      chip.className = 'cinema-rec';
      chip.setAttribute('role', 'status');
      const dot = document.createElement('i');
      const label = document.createElement('span');
      chip.append(dot, label);
      document.body.append(chip);
      this.recChip = chip;
    }
    this.updateRecChip(0);
    this.recChip.classList.add('is-on');
  }

  private updateRecChip(seconds: number): void {
    const label = this.recChip?.lastElementChild;
    const whole = Math.floor(seconds);
    if (label) label.textContent = `REC ${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  }
}

/** Break a sentence into lines no wider than `maxWidth` (canvas text does not wrap by itself). */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}
