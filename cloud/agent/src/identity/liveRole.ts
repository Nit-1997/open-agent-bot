import type { AuthAdmin } from "../admin/authAdmin.js";

export const LIVE_ROLE_TTL_MS = 30_000;
const MAX_USERS = 10_000;

type Entry = { admin: boolean; at: number };

export class LiveRoleCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<boolean>>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(
    private readonly auth: Pick<AuthAdmin, "getUser">,
    opts: { now?: () => number; ttlMs?: number } = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs ?? LIVE_ROLE_TTL_MS;
  }

  isAdmin(userId: string): Promise<boolean> {
    const hit = this.entries.get(userId);
    if (hit && this.now() - hit.at < this.ttlMs) return Promise.resolve(hit.admin);
    const running = this.inflight.get(userId);
    if (running) return running;
    const lookup = this.lookup(userId).finally(() => this.inflight.delete(userId));
    this.inflight.set(userId, lookup);
    return lookup;
  }

  private async lookup(userId: string): Promise<boolean> {
    const account = await this.auth.getUser(userId);
    const admin = !!account?.isAdmin && (!account.bannedUntil || Date.parse(account.bannedUntil) <= this.now());
    this.entries.delete(userId);
    this.entries.set(userId, { admin, at: this.now() });
    if (this.entries.size > MAX_USERS) this.entries.delete(this.entries.keys().next().value!);
    return admin;
  }
}
