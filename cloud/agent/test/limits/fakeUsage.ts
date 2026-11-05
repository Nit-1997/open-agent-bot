import { randomUUID } from "node:crypto";
import {
  type AdmitResult,
  type UsageNow,
  type UsagePageQuery,
  type UsageRepo,
  type UsageRepoOptions,
  type UsageRowDb,
  type UsageSummary,
  UsageRepoError,
} from "../../src/limits/usageRepo.js";

const HOUR = 3_600_000;

export const monthOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;

const nextMonthStart = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1));
};

export function minusMonths(at: number, n: number): number {
  const d = new Date(at);
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() - n;
  const y = Math.floor(total / 12);
  const m = total % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}

type UsageRow = { count: number; lastAt: number | null };
type Tombstone = { count: number; checkedAt: number | null; deletedAt: number };

export class FakeUsageStore {
  private readonly users = new Map<string, string>();
  private readonly usage = new Map<string, UsageRow>();
  private log: { id: number; userId: string; at: number }[] = [];
  private nextLog = 1;
  private readonly checks = new Map<string, number>();
  private readonly tombstones = new Map<string, Tombstone>();

  constructor(private readonly ambient: () => Date = () => new Date()) {}

  newUser(email: string = `fake-${randomUUID().slice(0, 8)}@example.test`, id: string = randomUUID()): { id: string; email: string } {
    const lower = email.toLowerCase();
    this.users.set(id, lower);
    const now = this.ambient().getTime();
    const month = monthOf(new Date(now));
    const carried = this.tombstones.get(`${lower}|${month}`);
    if (carried && carried.count > 0) this.usage.set(`${id}|${month}`, { count: carried.count, lastAt: null });
    const cutoff = minusMonths(now, 2);
    const checked = [...this.tombstones.entries()]
      .filter(([k, t]) => k.startsWith(`${lower}|`) && t.deletedAt > cutoff && t.checkedAt !== null)
      .map(([, t]) => t.checkedAt as number);
    if (checked.length) this.checks.set(id, Math.max(...checked));
    return { id, email: lower };
  }

  deleteUser(id: string): void {
    this.users.delete(id);
    for (const k of [...this.usage.keys()]) if (k.startsWith(`${id}|`)) this.usage.delete(k);
    this.log = this.log.filter((l) => l.userId !== id);
    this.checks.delete(id);
  }

  monthCount(userId: string, month: string): number {
    return this.usage.get(`${userId}|${month}`)?.count ?? 0;
  }

  tombstoneCount(): number {
    return this.tombstones.size;
  }

  private known(where: string, userId: string): void {
    if (!this.users.has(userId)) throw new UsageRepoError(where, "23503");
  }

  private window(userId: string, now: number) {
    return this.log.filter((l) => l.userId === userId && l.at > now - HOUR);
  }

  admit(userId: string, caps: UsageRepoOptions["caps"], now: number): AdmitResult {
    this.known("admit", userId);
    const month = monthOf(new Date(now));
    const key = `${userId}|${month}`;
    const row = this.usage.get(key) ?? { count: 0, lastAt: null };
    this.usage.set(key, row);
    this.log = this.log.filter((l) => !(l.userId === userId && l.at <= now - HOUR));
    const inHour = this.window(userId, now);
    if (row.count >= caps.perMonth)
      return { ok: false, reason: "month", monthUsed: row.count, hourUsed: inHour.length, retryAt: nextMonthStart(month) };
    if (inHour.length >= caps.perHour) {
      const oldest = Math.min(...inHour.map((l) => l.at));
      return { ok: false, reason: "hour", monthUsed: row.count, hourUsed: inHour.length, retryAt: new Date(oldest + HOUR) };
    }
    row.count += 1;
    row.lastAt = now;
    const id = this.nextLog++;
    this.log.push({ id, userId, at: now });
    return { ok: true, monthUsed: row.count, hourUsed: inHour.length + 1, logId: id };
  }

  refund(userId: string, logId: number): void {
    const i = this.log.findIndex((l) => l.id === logId && l.userId === userId);
    if (i === -1) return;
    const [entry] = this.log.splice(i, 1);
    const row = this.usage.get(`${userId}|${monthOf(new Date(entry.at))}`);
    if (row) row.count = Math.max(row.count - 1, 0);
  }

  get(userId: string, now: number): UsageNow {
    const inHour = this.window(userId, now);
    return {
      monthUsed: this.monthCount(userId, monthOf(new Date(now))),
      hourUsed: inHour.length,
      hourRetryAt: inHour.length ? new Date(Math.min(...inHour.map((l) => l.at)) + HOUR) : null,
    };
  }

  summary(now: number): UsageSummary {
    const suffix = `|${monthOf(new Date(now))}`;
    const rows = [...this.usage.entries()].filter(([k]) => k.endsWith(suffix)).map(([, r]) => r);
    return { monthTotal: rows.reduce((n, r) => n + r.count, 0), activeUsers: rows.filter((r) => r.count > 0).length };
  }

  page(q: UsagePageQuery, now: number): { total: number; items: UsageRowDb[] } {
    if ((q.atLeast !== undefined && q.atLeast < 1) || (q.query?.length ?? 0) > 100) throw new UsageRepoError("page", "22023");
    const month = monthOf(new Date(now));
    const needle = q.query ? q.query.toLowerCase() : undefined;
    const matched = [...this.usage.entries()]
      .map(([k, r]) => ({ userId: k.split("|")[0], month: k.split("|")[1], ...r }))
      .filter((r) => r.month === month && r.count > 0 && (q.atLeast === undefined || r.count >= q.atLeast))
      .map((r) => ({ ...r, email: this.users.get(r.userId) ?? "" }))
      .filter((r) => this.users.has(r.userId) && (needle === undefined || r.email.includes(needle)))
      .sort((a, b) => {
        if (a.lastAt !== b.lastAt) {
          if (a.lastAt === null) return 1;
          if (b.lastAt === null) return -1;
          return b.lastAt - a.lastAt;
        }
        return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
      });
    const limit = Math.min(Math.max(q.limit, 1), 50);
    const offset = Math.max(q.offset, 0);
    return {
      total: matched.length,
      items: matched.slice(offset, offset + limit).map((r) => ({
        userId: r.userId,
        email: r.email,
        monthUsed: r.count,
        lastAt: r.lastAt === null ? null : new Date(r.lastAt).toISOString(),
      })),
    };
  }

  lastRequest(userId: string): string | null {
    const times = [...this.usage.entries()]
      .filter(([k, r]) => k.startsWith(`${userId}|`) && r.lastAt !== null)
      .map(([, r]) => r.lastAt as number);
    return times.length ? new Date(Math.max(...times)).toISOString() : null;
  }

  prune(now: number): void {
    this.log = this.log.filter((l) => l.at > now - HOUR);
    const cutoff = minusMonths(now, 2);
    for (const [k, t] of [...this.tombstones.entries()]) if (t.deletedAt <= cutoff) this.tombstones.delete(k);
  }

  tombstone(userId: string, now: number): void {
    const email = this.users.get(userId);
    if (email === undefined) return;
    const month = monthOf(new Date(now));
    const key = `${email}|${month}`;
    const prev = this.tombstones.get(key);
    const count = this.monthCount(userId, month);
    const checkedAt = this.checks.get(userId) ?? null;
    this.tombstones.set(key, {
      count: Math.max(prev?.count ?? 0, count),
      checkedAt: checkedAt ?? prev?.checkedAt ?? null,
      deletedAt: now,
    });
  }

  humanCheckGet(userId: string): boolean {
    return this.checks.has(userId);
  }

  humanCheckSet(userId: string, now: number): void {
    this.known("humanCheck.set", userId);
    if (!this.checks.has(userId)) this.checks.set(userId, now);
  }

  repo(opts: UsageRepoOptions): FakeUsageRepo {
    return new FakeUsageRepo(this, opts, this.ambient);
  }
}

export class FakeUsageRepo implements UsageRepo {
  calls = 0;
  failWith: Error | undefined;

  constructor(
    private readonly store: FakeUsageStore,
    private readonly opts: UsageRepoOptions,
    private readonly ambient: () => Date,
  ) {}

  private now(): number {
    return (this.opts.now ?? this.ambient)().getTime();
  }

  private async run<T>(fn: () => T): Promise<T> {
    this.calls++;
    if (this.failWith) throw this.failWith;
    return fn();
  }

  admit = (userId: string) => this.run(() => this.store.admit(userId, this.opts.caps, this.now()));
  refund = (userId: string, logId: number) => this.run(() => this.store.refund(userId, logId));
  get = (userId: string) => this.run(() => this.store.get(userId, this.now()));
  summary = () => this.run(() => this.store.summary(this.now()));
  page = (q: UsagePageQuery) => this.run(() => this.store.page(q, this.now()));
  lastRequest = (userId: string) => this.run(() => this.store.lastRequest(userId));
  prune = () => this.run(() => this.store.prune(this.now()));
  tombstone = (userId: string) => this.run(() => this.store.tombstone(userId, this.now()));
  humanCheck = {
    get: (userId: string) => this.run(() => this.store.humanCheckGet(userId)),
    set: (userId: string) => this.run(() => this.store.humanCheckSet(userId, this.now())),
  };
}
