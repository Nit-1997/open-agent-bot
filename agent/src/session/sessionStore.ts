import type { FrameBus } from "../browser/frames.js";
import type { Evidence } from "../grounding/evidence.js";
import type { ActiveCart } from "../shop/cart.js";
import type { PiSession } from "../pi/createPiSession.js";
import type { UserContext } from "../prompt/systemPrompt.js";

export type HistoryMessage = { role: "user" | "assistant"; text: string };

export type SessionEntry = {
  session: PiSession;
  busy: boolean;
  lastUsed: number;
  dispose: () => Promise<void>;
  onRunStart?: () => void;
  evidence?: Evidence;
  setModel?: (id: string) => Promise<void>;
  frames?: FrameBus;
  cart?: ActiveCart;
  turnStats?: () => { jevCalls: number; jevCostUsd: number };
};

export class SessionStore {
  private entries = new Map<string, SessionEntry>();
  private pending = new Map<string, Promise<SessionEntry>>();
  private readonly idleMs: number;
  private readonly now: () => number;
  private readonly create: (threadId: string, ctx: UserContext | null, history?: HistoryMessage[]) => Promise<SessionEntry>;

  constructor(opts: {
    idleMs: number;
    now?: () => number;
    create: (threadId: string, ctx: UserContext | null, history?: HistoryMessage[]) => Promise<SessionEntry>;
  }) {
    this.idleMs = opts.idleMs;
    this.now = opts.now ?? Date.now;
    this.create = opts.create;
  }

  get(threadId: string): SessionEntry | undefined {
    return this.entries.get(threadId);
  }

  async getOrCreate(threadId: string, ctx: UserContext | null, history?: HistoryMessage[]): Promise<SessionEntry> {
    const existing = this.entries.get(threadId);
    if (existing) {
      existing.lastUsed = this.now();
      return existing;
    }
    let p = this.pending.get(threadId);
    if (!p) {
      p = this.create(threadId, ctx, history).then((e) => {
        e.lastUsed = this.now();
        this.entries.set(threadId, e);
        this.pending.delete(threadId);
        return e;
      });
      p.catch(() => this.pending.delete(threadId));
      this.pending.set(threadId, p);
    }
    return p;
  }

  touch(threadId: string): void {
    const e = this.entries.get(threadId);
    if (e) e.lastUsed = this.now();
  }

  async sweep(): Promise<void> {
    const cutoff = this.now() - this.idleMs;
    for (const [id, e] of this.entries) {
      if (!e.busy && e.lastUsed < cutoff) {
        this.entries.delete(id);
        await e.dispose().catch((err: unknown) => console.error(`[session] dispose failed thread=${id}`, err));
      }
    }
  }

  async disposeAll(): Promise<void> {
    const all = [...this.entries.values()];
    this.entries.clear();
    await Promise.allSettled(all.map((e) => e.dispose()));
  }
}
