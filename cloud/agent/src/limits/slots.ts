import { randomUUID } from "node:crypto";
import { log } from "@oab/core/lib/log.js";

export type Slot = Readonly<{ userId: string; runId: string; startedAt: number }>;

export class RunSlots {
  private readonly slots = new Map<string, Slot>();
  private readonly now: () => number;
  private readonly staleAfterMs: number;
  private released = 0;

  constructor(opts: { staleAfterMs: number; now?: () => number }) {
    this.staleAfterMs = opts.staleAfterMs;
    this.now = opts.now ?? Date.now;
  }

  get staleReleased(): number {
    return this.released;
  }

  reserve(userId: string, runId: string): string {
    const ticketId = randomUUID();
    this.slots.set(ticketId, { userId, runId, startedAt: this.now() });
    return ticketId;
  }

  release(ticketId: string): boolean {
    return this.slots.delete(ticketId);
  }

  count(userId?: string): number {
    if (userId === undefined) return this.slots.size;
    let n = 0;
    for (const s of this.slots.values()) if (s.userId === userId) n++;
    return n;
  }

  sweep(): Slot[] {
    const now = this.now();
    const stale: Slot[] = [];
    for (const [ticketId, s] of [...this.slots]) {
      if (now - s.startedAt <= this.staleAfterMs) continue;
      this.slots.delete(ticketId);
      this.released++;
      stale.push(s);
      log.warn(`[limits] released a stale run slot user=${s.userId} run=${s.runId} age=${Math.round((now - s.startedAt) / 1000)}s`);
    }
    return stale;
  }
}
