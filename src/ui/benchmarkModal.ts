/** Benchmark modal: results table, a hand-drawn canvas line chart, and CSV export. */

import type { BenchRow } from '../hashing/benchmark.ts';
import { $, fmt, fmtInt } from './dom.ts';

const RED = '#ff4d5e';
const CYAN = '#7fe3ff';
const MUTED = '#7f93ab';
const GRID = 'rgba(150, 185, 230, 0.13)';

export class BenchmarkModal {
  private readonly overlay = $('bench');
  private readonly canvas = $<HTMLCanvasElement>('bench-chart');
  private readonly body = $('bench-table').querySelector('tbody')!;
  private rows: BenchRow[] = [];
  private d = 10;
  private running = false;
  private readonly run: () => void;

  constructor(run: () => void) {
    this.run = run;
    $('bench-close').addEventListener('click', () => this.close());
    $('bench-rerun').addEventListener('click', () => this.start(this.d));
    $('bench-export').addEventListener('click', () => this.exportCsv());
    this.overlay.addEventListener('pointerdown', (event) => {
      if (event.target === this.overlay) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.overlay.classList.contains('is-hidden');
  }

  close(): void {
    this.overlay.classList.add('is-hidden');
  }

  /** Open the modal and ask the worker to run the benchmark. */
  start(d: number): void {
    if (this.running) return;
    this.d = d;
    this.rows = [];
    this.running = true;
    this.overlay.classList.remove('is-hidden');
    this.body.replaceChildren();
    $('bench-sub').textContent = `Same positions, same screening distance (d = ${d} km), two algorithms`;
    $('bench-status').textContent = 'Running in the worker…';
    $<HTMLButtonElement>('bench-rerun').disabled = true;
    $<HTMLButtonElement>('bench-export').disabled = true;
    this.draw();
    this.run();
  }

  addRow(row: BenchRow, index: number, total: number): void {
    this.rows[index] = row;
    const tr = document.createElement('tr');
    const cell = (text: string, className = '') => {
      const td = document.createElement('td');
      td.textContent = text;
      td.className = className;
      tr.append(td);
    };
    cell(fmtInt(row.n));
    cell(`${fmt(row.bruteMs, 2)} ms`, 'brute');
    cell(`${fmt(row.hashMs, 3)} ms`, 'hash');
    cell(`${fmt(row.speedup, 1)}×`);
    cell(fmtInt(row.pairs));
    cell(row.identical ? '✅' : '❌ mismatch');
    this.body.append(tr);
    $('bench-status').textContent = `Running in the worker… ${index + 1} of ${total} sizes done`;
    this.draw();
  }

  done(): void {
    this.running = false;
    const allSame = this.rows.every((r) => r.identical);
    const last = this.rows[this.rows.length - 1];
    $('bench-status').textContent = allSame && last
      ? `Results identical at every size. At ${fmtInt(last.n)} objects the hash is ${fmt(last.speedup, 1)}× faster.`
      : 'Mismatch between the two methods — see the table.';
    $<HTMLButtonElement>('bench-rerun').disabled = false;
    $<HTMLButtonElement>('bench-export').disabled = false;
  }

  /** Line chart of time vs n for both methods, drawn directly on a <canvas>. */
  private draw(): void {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const W = 560, H = 300;
    this.canvas.width = W * dpr;
    this.canvas.height = H * dpr;
    const ctx = this.canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const left = 58, right = 18, top = 22, bottom = 36;
    const rows = this.rows.filter(Boolean);
    // Round both axes up to "nice" values so the tick labels are readable numbers.
    const maxN = Math.ceil(Math.max(1000, ...rows.map((r) => r.n)) / 4000) * 4000;
    const rawMs = Math.max(1, ...rows.map((r) => r.bruteMs));
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawMs)));
    const maxMs = [1, 2, 4, 8, 10].map((m) => m * magnitude).find((m) => m >= rawMs)!;
    const x = (n: number) => left + (n / maxN) * (W - left - right);
    const y = (ms: number) => H - bottom - (ms / maxMs) * (H - top - bottom);

    // axes + grid
    ctx.font = '11px "JetBrains Mono Variable", ui-monospace, monospace';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const ms = (maxMs * i) / 4;
      ctx.strokeStyle = GRID;
      ctx.beginPath();
      ctx.moveTo(left, y(ms));
      ctx.lineTo(W - right, y(ms));
      ctx.stroke();
      ctx.fillStyle = MUTED;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`, left - 8, y(ms));
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i <= 4; i++) {
      const n = (maxN * i) / 4;
      ctx.fillStyle = MUTED;
      ctx.fillText(fmtInt(n), x(n), H - bottom + 8);
    }
    ctx.fillText('objects (n)', (left + W - right) / 2, H - 14);

    // the two series
    const series = (pick: (r: BenchRow) => number, color: string, label: string) => {
      if (rows.length === 0) return;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x(0), y(0));
      for (const r of rows) ctx.lineTo(x(r.n), y(pick(r)));
      ctx.stroke();
      for (const r of rows) {
        ctx.beginPath();
        ctx.arc(x(r.n), y(pick(r)), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      const last = rows[rows.length - 1];
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, x(last.n) - 8, y(pick(last)) - 6);
    };
    series((r) => r.bruteMs, RED, 'brute force  O(n²)');
    series((r) => r.hashMs, CYAN, 'spatial hash  O(n)');
  }

  private exportCsv(): void {
    const lines = ['n,brute_ms,hash_ms,speedup,brute_checks,hash_checks,pairs,identical,d_km'];
    for (const r of this.rows) {
      lines.push([r.n, r.bruteMs.toFixed(3), r.hashMs.toFixed(4), r.speedup.toFixed(2), r.bruteChecks, r.hashChecks, r.pairs, r.identical, this.d].join(','));
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `orbithash-benchmark-d${this.d}km.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
