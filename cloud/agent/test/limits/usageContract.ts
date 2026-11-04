import { describe, expect, it } from "vitest";
import type { AdmitResult, UsageCaps, UsageRepo } from "../../src/limits/usageRepo.js";

export type ContractUser = { id: string; email: string };

export type UsageContractEnv = {
  repo(opts: { caps: UsageCaps; now?: () => Date; timeoutMs?: number }): UsageRepo;
  email(tag: string): string;
  newUser(email?: string): Promise<ContractUser>;
  deleteUser(id: string): Promise<void>;
  monthCount(userId: string, month: string): Promise<number>;
};

const HOUR = 3_600_000;
const MIN = 60_000;
const BIG = { perMonth: 100_000, perHour: 1000 };

const clock = (iso: string) => {
  let t = Date.parse(iso);
  return {
    now: () => new Date(t),
    set: (next: string | number) => {
      t = typeof next === "number" ? next : Date.parse(next);
    },
  };
};

const at = (iso: string) => () => new Date(iso);

const okCount = (rs: AdmitResult[]) => rs.filter((r) => r.ok).length;

const logIdOf = (r: AdmitResult) => {
  if (!r.ok) throw new Error(`expected an admitted run, got ${r.reason}`);
  return r.logId;
};

function monthBefore(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 2, 12));
}

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;

export function usageContract(label: string, env: UsageContractEnv): void {
  describe(`usage repo contract (${label})`, () => {
    describe("monthly cap", () => {
      it("refuses the run past the cap with month and retryAt at the next UTC month", async () => {
        const u = await env.newUser();
        const repo = env.repo({ caps: { perMonth: 3, perHour: 100 }, now: at("2031-01-15T10:00:00.000Z") });
        const first = [await repo.admit(u.id), await repo.admit(u.id), await repo.admit(u.id)];
        expect(first.map((r) => r.ok && [r.monthUsed, r.hourUsed])).toEqual([
          [1, 1],
          [2, 2],
          [3, 3],
        ]);
        expect(await repo.admit(u.id)).toEqual({
          ok: false,
          reason: "month",
          monthUsed: 3,
          hourUsed: 3,
          retryAt: new Date("2031-02-01T00:00:00.000Z"),
        });
        expect(await env.monthCount(u.id, "2031-01-01")).toBe(3);
      });

      it("rolls December over to January of the next year", async () => {
        const u = await env.newUser();
        const repo = env.repo({ caps: { perMonth: 1, perHour: 100 }, now: at("2031-12-31T23:00:00.000Z") });
        expect((await repo.admit(u.id)).ok).toBe(true);
        const refused = await repo.admit(u.id);
        expect(refused.ok === false && refused.retryAt).toEqual(new Date("2032-01-01T00:00:00.000Z"));
      });
    });

    describe("hourly window", () => {
      it("refuses with retryAt = oldest + 1 h and resumes exactly then", async () => {
        const u = await env.newUser();
        const c = clock("2031-02-10T10:00:00.000Z");
        const t0 = c.now().getTime();
        const repo = env.repo({ caps: { perMonth: 100, perHour: 2 }, now: c.now });
        expect((await repo.admit(u.id)).ok).toBe(true);
        c.set(t0 + 10 * MIN);
        expect((await repo.admit(u.id)).ok).toBe(true);
        c.set(t0 + 20 * MIN);
        expect(await repo.admit(u.id)).toEqual({
          ok: false,
          reason: "hour",
          monthUsed: 2,
          hourUsed: 2,
          retryAt: new Date(t0 + HOUR),
        });
        c.set(t0 + HOUR - 1);
        expect((await repo.admit(u.id)).ok).toBe(false);
        c.set(t0 + HOUR);
        expect(await repo.admit(u.id)).toMatchObject({ ok: true, monthUsed: 3, hourUsed: 2 });
      });
    });

    describe("month boundary", () => {
      it("counts 23:59:59.999 in the old month and 00:00 UTC in the new one", async () => {
        const u = await env.newUser();
        const c = clock("2031-03-31T23:59:59.999Z");
        const repo = env.repo({ caps: { perMonth: 2, perHour: 100 }, now: c.now });
        expect((await repo.admit(u.id)).ok).toBe(true);
        expect((await repo.admit(u.id)).ok).toBe(true);
        const refused = await repo.admit(u.id);
        expect(refused).toMatchObject({ ok: false, reason: "month", retryAt: new Date("2031-04-01T00:00:00.000Z") });
        c.set("2031-04-01T00:00:00.000Z");
        expect(await repo.admit(u.id)).toMatchObject({ ok: true, monthUsed: 1, hourUsed: 3 });
        expect(await env.monthCount(u.id, "2031-03-01")).toBe(2);
        expect(await env.monthCount(u.id, "2031-04-01")).toBe(1);
      });

      it("never exceeds either cap when parallel admits straddle the boundary", async () => {
        const u = await env.newUser();
        const caps = { perMonth: 5, perHour: 8 };
        const before = env.repo({ caps, now: at("2031-04-30T23:59:59.999Z"), timeoutMs: 30_000 });
        const after = env.repo({ caps, now: at("2031-05-01T00:00:00.000Z"), timeoutMs: 30_000 });
        const results = await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 ? after : before).admit(u.id)));
        const april = await env.monthCount(u.id, "2031-04-01");
        const may = await env.monthCount(u.id, "2031-05-01");
        expect(okCount(results)).toBe(8);
        expect(april).toBeLessThanOrEqual(5);
        expect(may).toBeLessThanOrEqual(5);
        expect(april + may).toBe(8);
      });
    });

    it("never counts a refused admit", async () => {
      const u = await env.newUser();
      const repo = env.repo({ caps: { perMonth: 1, perHour: 100 }, now: at("2031-06-10T10:00:00.000Z") });
      expect((await repo.admit(u.id)).ok).toBe(true);
      for (let i = 0; i < 3; i++) expect((await repo.admit(u.id)).ok).toBe(false);
      expect(await env.monthCount(u.id, "2031-06-01")).toBe(1);
      expect(await repo.get(u.id)).toMatchObject({ monthUsed: 1, hourUsed: 1 });
    });

    describe("refund", () => {
      it("is idempotent and ignores unknown or foreign log ids", async () => {
        const u = await env.newUser();
        const other = await env.newUser();
        const repo = env.repo({ caps: BIG, now: at("2031-07-10T10:00:00.000Z") });
        const mine = logIdOf(await repo.admit(u.id));
        const theirs = logIdOf(await repo.admit(other.id));
        await repo.refund(u.id, mine);
        await repo.refund(u.id, mine);
        await repo.refund(u.id, theirs);
        await repo.refund(u.id, 999_999_999);
        expect(await env.monthCount(u.id, "2031-07-01")).toBe(0);
        expect(await env.monthCount(other.id, "2031-07-01")).toBe(1);
        expect(await repo.get(u.id)).toMatchObject({ monthUsed: 0, hourUsed: 0, hourRetryAt: null });
      });

      it("decrements the month of the log row, not the current one", async () => {
        const u = await env.newUser();
        const c = clock("2031-07-31T23:59:59.999Z");
        const repo = env.repo({ caps: BIG, now: c.now });
        const july = logIdOf(await repo.admit(u.id));
        c.set("2031-08-01T00:00:00.000Z");
        expect((await repo.admit(u.id)).ok).toBe(true);
        await repo.refund(u.id, july);
        expect(await env.monthCount(u.id, "2031-07-01")).toBe(0);
        expect(await env.monthCount(u.id, "2031-08-01")).toBe(1);
      });
    });

    it("prunes log rows older than an hour", async () => {
      const u = await env.newUser();
      const c = clock("2031-08-10T10:00:00.000Z");
      const t0 = c.now().getTime();
      const repo = env.repo({ caps: BIG, now: c.now });
      expect((await repo.admit(u.id)).ok).toBe(true);
      c.set(t0 + 59 * MIN);
      await repo.prune();
      c.set(t0 + 30 * MIN);
      expect((await repo.get(u.id)).hourUsed).toBe(1);
      c.set(t0 + 61 * MIN);
      await repo.prune();
      c.set(t0 + 30 * MIN);
      expect(await repo.get(u.id)).toEqual({ monthUsed: 1, hourUsed: 0, hourRetryAt: null });
    });

    it("reports the month and the hour with the hourly reset time", async () => {
      const u = await env.newUser();
      const c = clock("2031-08-20T10:00:00.000Z");
      const t0 = c.now().getTime();
      const repo = env.repo({ caps: BIG, now: c.now });
      expect(await repo.get(u.id)).toEqual({ monthUsed: 0, hourUsed: 0, hourRetryAt: null });
      await repo.admit(u.id);
      c.set(t0 + 5 * MIN);
      await repo.admit(u.id);
      expect(await repo.get(u.id)).toEqual({ monthUsed: 2, hourUsed: 2, hourRetryAt: new Date(t0 + HOUR) });
    });

    it("sums the month and counts active users", async () => {
      const [a, b, c] = [await env.newUser(), await env.newUser(), await env.newUser()];
      const repo = env.repo({ caps: BIG, now: at("2031-09-10T10:00:00.000Z") });
      expect(await repo.summary()).toEqual({ monthTotal: 0, activeUsers: 0 });
      await repo.admit(a.id);
      await repo.admit(a.id);
      await repo.admit(b.id);
      await repo.refund(c.id, logIdOf(await repo.admit(c.id)));
      expect(await repo.summary()).toEqual({ monthTotal: 3, activeUsers: 2 });
    });

    describe("page", () => {
      it("lists the month newest first with the total, filters and a past-the-end page", async () => {
        const users = [];
        for (let i = 0; i < 7; i++) users.push(await env.newUser(env.email(`page${i}`)));
        const c = clock("2031-10-01T08:00:00.000Z");
        const t0 = c.now().getTime();
        const repo = env.repo({ caps: BIG, now: c.now });
        for (const [i, u] of users.entries()) {
          for (let n = 0; n <= i; n++) {
            c.set(t0 + (i * 10 + n) * MIN);
            await repo.admit(u.id);
          }
        }
        c.set(t0 + 2 * HOUR);
        const newest = [...users].reverse();
        const first = await repo.page({ limit: 5, offset: 0 });
        expect(first.total).toBe(7);
        expect(first.items.map((r) => r.userId)).toEqual(newest.slice(0, 5).map((u) => u.id));
        expect(first.items[0]).toEqual({
          userId: users[6].id,
          email: users[6].email,
          monthUsed: 7,
          lastAt: new Date(t0 + 66 * MIN).toISOString(),
        });
        expect((await repo.page({ limit: 5, offset: 5 })).items.map((r) => r.userId)).toEqual(newest.slice(5).map((u) => u.id));
        expect(await repo.page({ limit: 5, offset: 10 })).toEqual({ total: 7, items: [] });
        const atLeast = await repo.page({ atLeast: 5, limit: 5, offset: 0 });
        expect([atLeast.total, atLeast.items.map((r) => r.monthUsed)]).toEqual([3, [7, 6, 5]]);
        const one = await repo.page({ query: users[2].email.toUpperCase().slice(0, 30), limit: 5, offset: 0 });
        expect(one.items.map((r) => r.userId)).toContain(users[2].id);
        expect((await repo.page({ query: users[3].email, limit: 5, offset: 0 })).items.map((r) => r.userId)).toEqual([users[3].id]);
        expect((await repo.page({ query: "%", limit: 5, offset: 0 })).total).toBe(0);
        expect((await repo.page({ query: "_", limit: 5, offset: 0 })).total).toBe(0);
        expect((await repo.page({ query: "\\", limit: 5, offset: 0 })).total).toBe(0);
        expect((await repo.page({ limit: 0, offset: -3 })).items).toHaveLength(1);
        expect((await repo.page({ limit: 500, offset: 0 })).items).toHaveLength(7);
      });

      it("rejects an at-least below 1 and a query over 100 characters", async () => {
        const repo = env.repo({ caps: BIG, now: at("2031-10-01T08:00:00.000Z") });
        await expect(repo.page({ atLeast: 0, limit: 5, offset: 0 })).rejects.toMatchObject({ code: "22023" });
        await expect(repo.page({ query: "x".repeat(101), limit: 5, offset: 0 })).rejects.toMatchObject({ code: "22023" });
      });
    });

    it("sets the human check once and reads it back", async () => {
      const u = await env.newUser();
      const repo = env.repo({ caps: BIG });
      expect(await repo.humanCheck.get(u.id)).toBe(false);
      await repo.humanCheck.set(u.id);
      await repo.humanCheck.set(u.id);
      expect(await repo.humanCheck.get(u.id)).toBe(true);
    });

    describe("concurrency", () => {
      it("admits exactly 50 of 100 parallel calls for one user with a month cap of 50", async () => {
        const u = await env.newUser();
        const repo = env.repo({ caps: { perMonth: 50, perHour: 1000 }, now: at("2031-11-10T10:00:00.000Z"), timeoutMs: 60_000 });
        const results = await Promise.all(Array.from({ length: 100 }, () => repo.admit(u.id)));
        expect(okCount(results)).toBe(50);
        expect(results.filter((r) => !r.ok && r.reason === "month")).toHaveLength(50);
        expect(await env.monthCount(u.id, "2031-11-01")).toBe(50);
      });

      it("admits exactly 10 each for 10 users × 20 parallel calls with a cap of 10", async () => {
        const users = await Promise.all(Array.from({ length: 10 }, () => env.newUser()));
        const repo = env.repo({ caps: { perMonth: 10, perHour: 1000 }, now: at("2031-11-20T10:00:00.000Z"), timeoutMs: 60_000 });
        const results = await Promise.all(
          users.flatMap((u) => Array.from({ length: 20 }, async () => [u.id, await repo.admit(u.id)] as const)),
        );
        for (const u of users) {
          expect(okCount(results.filter(([id]) => id === u.id).map(([, r]) => r))).toBe(10);
          expect(await env.monthCount(u.id, "2031-11-01")).toBe(10);
        }
      });
    });

    describe("delete carry-over", () => {
      it("carries the month's count and the human check to a re-sign-up with the same email", async () => {
        const u = await env.newUser();
        const repo = env.repo({ caps: BIG });
        for (let i = 0; i < 3; i++) expect((await repo.admit(u.id)).ok).toBe(true);
        await repo.humanCheck.set(u.id);
        await repo.tombstone(u.id);
        await env.deleteUser(u.id);
        const again = await env.newUser(u.email);
        expect(again.id).not.toBe(u.id);
        expect(await repo.get(again.id)).toMatchObject({ monthUsed: 3, hourUsed: 0 });
        expect(await repo.humanCheck.get(again.id)).toBe(true);
        const fresh = await env.newUser();
        expect(await repo.get(fresh.id)).toMatchObject({ monthUsed: 0 });
        expect(await repo.humanCheck.get(fresh.id)).toBe(false);
      });

      it("keeps the larger count when the same email is deleted twice in a month", async () => {
        const u = await env.newUser();
        const repo = env.repo({ caps: BIG });
        for (let i = 0; i < 4; i++) await repo.admit(u.id);
        await repo.tombstone(u.id);
        await env.deleteUser(u.id);
        const again = await env.newUser(u.email);
        await repo.admit(again.id);
        await repo.tombstone(again.id);
        await env.deleteUser(again.id);
        const third = await env.newUser(u.email);
        expect((await repo.get(third.id)).monthUsed).toBe(5);
      });

      it("starts a new month fresh but still carries a recent human check", async () => {
        const u = await env.newUser();
        const last = monthBefore(new Date(), 1);
        const old = env.repo({ caps: BIG, now: () => last });
        for (let i = 0; i < 2; i++) await old.admit(u.id);
        await old.humanCheck.set(u.id);
        await old.tombstone(u.id);
        await env.deleteUser(u.id);
        const again = await env.newUser(u.email);
        expect(await env.monthCount(again.id, monthKey(new Date()))).toBe(0);
        expect(await env.monthCount(again.id, monthKey(last))).toBe(0);
        expect(await env.repo({ caps: BIG }).humanCheck.get(again.id)).toBe(true);
      });

      it("ignores the human check of a tombstone older than two months", async () => {
        const u = await env.newUser();
        const old = env.repo({ caps: BIG, now: () => monthBefore(new Date(), 3) });
        await old.humanCheck.set(u.id);
        await old.tombstone(u.id);
        await env.deleteUser(u.id);
        const again = await env.newUser(u.email);
        expect(await env.repo({ caps: BIG }).humanCheck.get(again.id)).toBe(false);
      });
    });
  });
}
