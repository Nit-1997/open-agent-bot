import type { Principal } from "../identity/types.js";
import type { ProviderHub } from "./hub.js";

type Entry = { hub: Promise<ProviderHub>; usedAt: number };

export class UserHubs {
  private readonly entries = new Map<string, Entry>();
  private readonly max: number;
  private readonly idleMs: number;
  private readonly now: () => number;

  constructor(
    private readonly build: (user: Principal) => Promise<ProviderHub>,
    opts: { max?: number; idleMs?: number; now?: () => number } = {},
  ) {
    this.max = opts.max ?? 200;
    this.idleMs = opts.idleMs ?? 15 * 60_000;
    this.now = opts.now ?? Date.now;
  }

  get(user: Principal): Promise<ProviderHub> {
    const key = `${user.id}:${user.isAdmin ? "admin" : "user"}`;
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.usedAt < this.idleMs) {
      this.entries.delete(key);
      this.entries.set(key, { ...hit, usedAt: this.now() });
      return hit.hub;
    }
    const hub = this.build(user);
    hub.catch(() => {
      if (this.entries.get(key)?.hub === hub) this.entries.delete(key);
    });
    this.entries.delete(key);
    this.entries.set(key, { hub, usedAt: this.now() });
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!);
    return hub;
  }

  invalidate(userId: string): void {
    for (const key of [...this.entries.keys()]) if (key.startsWith(`${userId}:`)) this.entries.delete(key);
  }
}
