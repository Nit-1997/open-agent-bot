import { log } from "./log.js";

export class BackgroundQueue {
  private readonly waiting: Array<() => Promise<void>> = [];
  private running = 0;
  private readonly settled = new Set<() => void>();

  constructor(private readonly opts: { name: string; max: number; concurrency: number }) {}

  push(task: () => Promise<void>): boolean {
    if (this.waiting.length >= this.opts.max) {
      log.warn(`[${this.opts.name}] queue full, dropped a task`);
      return false;
    }
    this.waiting.push(task);
    this.pump();
    return true;
  }

  idle(): Promise<void> {
    if (!this.running && !this.waiting.length) return Promise.resolve();
    return new Promise((resolve) => this.settled.add(resolve));
  }

  private pump(): void {
    while (this.running < this.opts.concurrency && this.waiting.length) {
      const task = this.waiting.shift()!;
      this.running++;
      void task()
        .catch(() => log.warn(`[${this.opts.name}] task failed`))
        .finally(() => {
          this.running--;
          this.pump();
          if (!this.running && !this.waiting.length) {
            for (const done of this.settled) done();
            this.settled.clear();
          }
        });
    }
  }
}
