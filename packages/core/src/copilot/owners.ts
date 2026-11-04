export const OWNERS_MAX = 10_000;
export const OWNER_TTL_MS = 30 * 60 * 1000;

type Entry = { userId: string; at: number };

export class ThreadOwners {
  private readonly entries = new Map<string, Entry>();
  private readonly max: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: { max?: number; ttlMs?: number; now?: () => number } = {}) {
    this.max = opts.max ?? OWNERS_MAX;
    this.ttlMs = opts.ttlMs ?? OWNER_TTL_MS;
    this.now = opts.now ?? (() => Date.now());
  }

  get size(): number {
    return this.entries.size;
  }

  claim(threadId: string, userId: string): void {
    const key = threadId.toLowerCase();
    this.entries.delete(key);
    this.entries.set(key, { userId, at: this.now() });
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  ownerOf(threadId: string): string | undefined {
    const key = threadId.toLowerCase();
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (this.now() - entry.at >= this.ttlMs) return undefined;
    entry.at = this.now();
    this.entries.set(key, entry);
    return entry.userId;
  }
}

export const CONNECTS_PER_USER = 8;

export class ConnectSlots {
  private readonly open = new Map<string, number>();

  constructor(private readonly perUser: number = CONNECTS_PER_USER) {}

  count(userId: string): number {
    return this.open.get(userId) ?? 0;
  }

  acquire(userId: string): (() => void) | undefined {
    const n = this.count(userId);
    if (n >= this.perUser) return undefined;
    this.open.set(userId, n + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = this.count(userId) - 1;
      if (left <= 0) this.open.delete(userId);
      else this.open.set(userId, left);
    };
  }
}
