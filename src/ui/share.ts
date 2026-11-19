/**
 * The share window: a QR code people can scan from the screen (handy in a classroom) and
 * the link itself with a copy button. "This view" reopens exactly what is on screen;
 * "Home page" is the plain site address.
 */

import { $ } from './dom.ts';

/**
 * The QR library is only needed once the window opens, so it is not in the first file the page
 * loads; `warmShare()` fetches it in an idle moment after start-up, so it is there when wanted.
 */
type QrFactory = typeof import('qrcode-generator');
let qrLibrary: Promise<QrFactory> | null = null;
export const warmShare = (): Promise<QrFactory> => (qrLibrary ??= import('qrcode-generator').then((m) => m.default));

export class ShareDialog {
  private readonly overlay = $('share-dialog');
  private readonly canvas = $<HTMLCanvasElement>('share-qr');
  private readonly field = $<HTMLInputElement>('share-url');
  private viewUrl = '';
  private which: 'view' | 'home' = 'view';

  constructor() {
    $('share-close').addEventListener('click', () => this.close());
    this.overlay.addEventListener('pointerdown', (event) => {
      if (event.target === this.overlay) this.close();
    });
    for (const button of $('share-which').querySelectorAll<HTMLElement>('button')) {
      button.addEventListener('click', () => this.show(button.dataset.value as 'view' | 'home'));
    }
    const copy = $('share-copy');
    copy.addEventListener('click', () => {
      const done = () => {
        copy.textContent = 'Copied';
        setTimeout(() => (copy.textContent = 'Copy link'), 1600);
      };
      const attempt = navigator.clipboard?.writeText(this.field.value);
      if (attempt) attempt.then(done, () => this.field.select());
      else this.field.select(); // no clipboard access: leave the link selected for Ctrl/Cmd+C
    });
    this.field.addEventListener('focus', () => this.field.select());
    this.field.addEventListener('keydown', (event) => event.stopPropagation());
  }

  get isOpen(): boolean {
    return !this.overlay.classList.contains('is-hidden');
  }

  /** @param viewUrl link that restores the current view; @param specific true if it points at an object or a close approach */
  open(viewUrl: string, specific: boolean): void {
    this.viewUrl = viewUrl;
    this.overlay.classList.remove('is-hidden');
    this.show(specific ? 'view' : 'home');
  }

  close(): void {
    this.overlay.classList.add('is-hidden');
  }

  private show(which: 'view' | 'home'): void {
    this.which = which;
    for (const button of $('share-which').querySelectorAll<HTMLElement>('button')) {
      button.classList.toggle('is-on', button.dataset.value === this.which);
    }
    const url = which === 'view' ? this.viewUrl : `${location.origin}${location.pathname}`;
    this.field.value = url;
    this.drawQr(url);
  }

  /** Dark squares on white, with the quiet margin scanners need. */
  private drawQr(text: string): void {
    void warmShare().then((qrcode) => {
      if (this.field.value === text) this.paintQr(qrcode, text); // the link may have changed while it loaded
    });
  }

  private paintQr(qrcode: QrFactory, text: string): void {
    const qr = qrcode(0, 'M'); // 0 = smallest version that fits; M = survives ~15% damage
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const margin = 3;
    const cell = Math.max(3, Math.floor(480 / (count + margin * 2)));
    const size = cell * (count + margin * 2);
    this.canvas.width = this.canvas.height = size;
    const ctx = this.canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#05080f';
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) ctx.fillRect((col + margin) * cell, (row + margin) * cell, cell, cell);
      }
    }
  }
}
