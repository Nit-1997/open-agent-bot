import type { UserStatus } from "@oab/shared/admin";

type Lookup = (userId: string) => Promise<UserStatus | undefined>;
type Entry = { active: boolean; at: number };

export const STATUS_TTL_MS = 30_000;

export class UserStatusCache {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(
    private readonly lookup: Lookup,
    opts: { now?: () => number; ttlMs?: number } = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs ?? STATUS_TTL_MS;
  }

  async isActive(userId: string): Promise<boolean> {
    const hit = this.entries.get(userId);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.active;
    const active = (await this.lookup(userId)) === "active";
    this.entries.set(userId, { active, at: this.now() });
    if (this.entries.size > 10_000) this.entries.delete(this.entries.keys().next().value!);
    return active;
  }

  invalidate(userId: string): void {
    this.entries.delete(userId);
  }
}
