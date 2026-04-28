import { createWorker, type Worker as TesseractWorker } from 'tesseract.js';

/**
 * Tesseract worker pool — keeps N pre-warmed Tesseract.js workers (each
 * bound to a Node-side child process) so that OCR doesn't run inline on
 * the main worker thread.
 *
 * Design: a fixed-size pool with a Promise-based wait queue. recognise()
 * checks out a worker, runs the job, returns it. Tesseract initialises its
 * language-data lazily — we eagerly load `fra+eng` once per worker.
 */
export interface OcrResult {
  readonly text: string;
  readonly confidence: number; // [0, 1]
}

export class OcrPool {
  private readonly workers: TesseractWorker[] = [];
  private readonly available: TesseractWorker[] = [];
  private readonly waitQueue: Array<(w: TesseractWorker) => void> = [];
  private initialised = false;

  constructor(
    private readonly size: number = 4,
    private readonly languages: string = 'fra+eng',
  ) {}

  async init(): Promise<void> {
    if (this.initialised) return;
    for (let i = 0; i < this.size; i++) {
      const w = await createWorker(this.languages);
      this.workers.push(w);
      this.available.push(w);
    }
    this.initialised = true;
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
    this.workers.length = 0;
    this.available.length = 0;
    this.waitQueue.length = 0;
    this.initialised = false;
  }

  async recognise(input: Buffer | Uint8Array): Promise<OcrResult> {
    if (!this.initialised) await this.init();
    const worker = await this.checkout();
    try {
      const { data } = await worker.recognize(input);
      return { text: data.text, confidence: data.confidence / 100 };
    } finally {
      this.checkin(worker);
    }
  }

  private checkout(): Promise<TesseractWorker> {
    const ready = this.available.pop();
    if (ready) return Promise.resolve(ready);
    return new Promise<TesseractWorker>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  private checkin(worker: TesseractWorker): void {
    const next = this.waitQueue.shift();
    if (next) {
      next(worker);
    } else {
      this.available.push(worker);
    }
  }
}
