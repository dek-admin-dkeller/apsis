/**
 * The share window, made for presenting: a QR code people can scan from the screen, the site's
 * address short enough to type from a projector ("dek-…github.io/apsis": no "https://", no
 * trailing slash; GitHub Pages redirects it to the site), and the full link written out in full,
 * wrapped, never cut off (it used to sit in a one-line field that hid most of it), with a copy
 * button. "This view" reopens exactly what is on screen; "Home page" is the plain site address.
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
  private readonly field = $('share-url');
  private url = '';
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
      const attempt = navigator.clipboard?.writeText(this.url);
      if (attempt) attempt.then(done, () => this.selectLink());
      else this.selectLink(); // no clipboard access: leave the link selected for Ctrl/Cmd+C
    });
    // A click on the link selects all of it (to copy by hand).
    this.field.addEventListener('click', () => this.selectLink());
    // The address to type: the site without "https://" and without the trailing slash, in two
    // pieces that never break inside themselves ("dek-…github.io" + "/apsis"), so a projector
    // shows it either on one line or split at the slash, never mid-word.
    this.showAddress(location.host, location.pathname.replace(/\/(index\.html)?$/, ''));
  }

  /** Exported for testing the layout with the published address. */
  showAddress(host: string, path: string): void {
    const piece = (text: string) => Object.assign(document.createElement('span'), { className: 'share-piece', textContent: text });
    $('share-address').replaceChildren(piece(host), ...(path ? [document.createElement('wbr'), piece(path)] : []));
  }

  private selectLink(): void {
    const range = document.createRange();
    range.selectNodeContents(this.field);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
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
    this.url = url;
    this.field.textContent = url;
    this.drawQr(url);
  }

  /** Dark squares on white, with the quiet margin scanners need. */
  private drawQr(text: string): void {
    void warmShare().then((qrcode) => {
      if (this.url === text) this.paintQr(qrcode, text); // the link may have changed while it loaded
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
