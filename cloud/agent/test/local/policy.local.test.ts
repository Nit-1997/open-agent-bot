import { randomUUID } from "node:crypto";
import { EventType } from "@ag-ui/core";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { RunHandle, StartRunResult } from "@oab/core/agui/startRun.js";
import { NO_CAPABILITIES, type Principal } from "@oab/core/identity/types.js";
import { RateLimiter } from "@oab/core/lib/rateLimit.js";
import type { Limits } from "@oab/shared/usage";
import { nextUtcMonth } from "@oab/shared/usage";
import { drain, errorCodes, holdUntilAbort, pullUntil, runWorld } from "../../../../packages/core/test/agui/runWorld.js";
import { humanCheckOff } from "../../src/limits/humanCheckStub.js";
import { HostedRunPolicy } from "../../src/limits/policy.js";
import { RunSlots } from "../../src/limits/slots.js";
import { checkUsageFunctions } from "../../src/limits/startup.js";
import { createUsageRepo, type UsageRepo } from "../../src/limits/usageRepo.js";
import { createServiceClient } from "../../src/store/client.js";
import { createSupabaseStore } from "../../src/store/supabaseStore.js";
import { cleanup, closeHarness, createUser, localEnv, sql } from "./harness.js";

const db = () => createServiceClient({ supabaseUrl: localEnv().apiUrl, supabaseSecretKey: localEnv().secretKey });

afterAll(async () => {
  try {
    expect(await cleanup()).toBe(0);
  } finally {
    await closeHarness();
  }
});

const monthStart = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
};

const countOf = async (userId: string) =>
  (
    await sql<{ count: number }>("select count from public.request_usage where user_id = $1 and month = $2::date", [userId, monthStart()])
  )[0]?.count ?? 0;

function hosted(limits: Partial<Limits> = {}) {
  const full: Limits = { runningPerUser: 1, perHour: 100, perMonth: 100, runningServer: 8, ...limits };
  const repo = createUsageRepo(db(), { caps: { perMonth: full.perMonth, perHour: full.perHour } });
  let calls = 0;
  const usage: UsageRepo = {
    ...repo,
    admit: (id) => {
      calls++;
      return repo.admit(id);
    },
  };
  const policy = new HostedRunPolicy({
    limits: full,
    usage,
    slots: new RunSlots({ staleAfterMs: 340_000 }),
    humanCheck: humanCheckOff,
    limiter: new RateLimiter(),
  });
  const world = runWorld({ policy, script: holdUntilAbort });
  return { policy, world, repo, calls: () => calls };
}

const principalOf = (u: { id: string; email: string }): Principal => ({ ...u, capabilities: NO_CAPABILITIES });

function runOf(r: StartRunResult): RunHandle {
  if (!r.ok) throw new Error(`refused: ${r.error.opts.code}`);
  return r.run;
}

const codeOf = (r: StartRunResult) => (r.ok ? "ok" : r.error.opts.code);

async function reloadUntil<T>(probe: () => Promise<T>, done: (v: T) => boolean): Promise<T> {
  await sql("notify pgrst, 'reload schema'");
  for (let i = 0; i < 100; i++) {
    const v = await probe();
    if (done(v)) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("PostgREST did not pick up the schema change");
}

describe("HostedRunPolicy on the local stack with a held run", () => {
  it("charges a held run once, refuses a second chat limit_running (also with the same runId) and admits after the run ends", async () => {
    const h = hosted();
    const alice = principalOf(await createUser({ invited: false }));
    const first = runOf(await h.world.start(alice, randomUUID(), "held-run"));
    await pullUntil(first, EventType.TEXT_MESSAGE_CONTENT);
    expect(await countOf(alice.id)).toBe(1);
    expect(codeOf(await h.world.start(alice, randomUUID(), "held-run"))).toBe("limit_running");
    expect(codeOf(await h.world.start(alice, randomUUID(), "other-run"))).toBe("limit_running");
    expect(await countOf(alice.id)).toBe(1);
    first.close();
    await vi.waitFor(() => expect(h.policy.snapshot().running).toBe(0));
    const next = runOf(await h.world.start(alice, randomUUID(), "next-run"));
    await pullUntil(next, EventType.TEXT_MESSAGE_CONTENT);
    next.close();
    await vi.waitFor(() => expect(h.policy.snapshot().running).toBe(0));
    expect(await countOf(alice.id)).toBe(2);
  });

  it("refunds a same-chat resend refused THREAD_BUSY in the database", async () => {
    const h = hosted({ runningPerUser: 2 });
    const alice = principalOf(await createUser({ invited: false }));
    const chat = randomUUID();
    const first = runOf(await h.world.start(alice, chat, "r1"));
    await pullUntil(first, EventType.TEXT_MESSAGE_CONTENT);
    const resend = runOf(await h.world.start(alice, chat, "r2"));
    expect(errorCodes(await drain(resend))).toEqual(["THREAD_BUSY"]);
    await vi.waitFor(async () => expect(await countOf(alice.id)).toBe(1));
    const logs = await sql<{ n: number }>("select count(*)::int as n from public.request_log where user_id = $1", [alice.id]);
    expect(logs[0]?.n).toBe(1);
    first.close();
    await vi.waitFor(() => expect(h.policy.snapshot().running).toBe(0));
    expect(await countOf(alice.id)).toBe(1);
  });

  it("refuses the 4th run of the month with limit_monthly at the next UTC month, then serves the cache without a database call", async () => {
    const h = hosted({ perMonth: 3 });
    const alice = principalOf(await createUser({ invited: false }));
    for (let i = 0; i < 3; i++) {
      const run = runOf(await h.world.start(alice, randomUUID(), `r${i}`));
      await pullUntil(run, EventType.TEXT_MESSAGE_CONTENT);
      run.close();
      await vi.waitFor(() => expect(h.policy.snapshot().running).toBe(0));
    }
    const refused = await h.world.start(alice, randomUUID(), "r4");
    if (refused.ok) throw new Error("admitted");
    expect(refused.error.opts).toMatchObject({
      code: "limit_monthly",
      details: { retryAt: nextUtcMonth(Date.now()).toISOString(), limit: 3, used: 3, window: "month" },
    });
    expect(h.calls()).toBe(4);
    expect(codeOf(await h.world.start(alice, randomUUID(), "r5"))).toBe("limit_monthly");
    expect(h.calls()).toBe(4);
    expect(await countOf(alice.id)).toBe(3);
  });

  it("admits exactly the server cap of 20 parallel runs across 20 users", async () => {
    const h = hosted({ runningServer: 8 });
    const users = await Promise.all(Array.from({ length: 20 }, () => createUser({ invited: false })));
    const results = await Promise.all(users.map((u) => h.world.start(principalOf(u), randomUUID(), "r")));
    expect(results.filter((r) => r.ok)).toHaveLength(8);
    expect(results.filter((r) => !r.ok).map(codeOf)).toEqual(Array(12).fill("server_busy"));
    const [{ total }] = await sql<{ total: number }>(
      "select coalesce(sum(count), 0)::int as total from public.request_usage where user_id = any($1::uuid[])",
      [users.map((u) => u.id)],
    );
    expect(total).toBe(8);
    for (const r of results) if (r.ok) r.run.close();
    await vi.waitFor(() => expect(h.policy.snapshot().running).toBe(0));
  });

  it("fails closed with usage_unavailable while request_admit is not executable, and works again after the re-grant", async () => {
    const h = hosted();
    const alice = principalOf(await createUser({ invited: false }));
    const fn = "public.request_admit(uuid, integer, integer, timestamp with time zone)";
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await sql(`revoke execute on function ${fn} from service_role`);
      const refused = await reloadUntil(
        () => h.world.start(alice, randomUUID(), "r1"),
        (r) => !r.ok,
      );
      if (refused.ok) throw new Error("admitted");
      expect(refused.error.opts).toMatchObject({ code: "usage_unavailable", retryAfter: 60 });
      expect(refused.error.kind).toBe("unavailable");
      expect(h.policy.snapshot().running).toBe(0);
      expect(await countOf(alice.id)).toBe(0);
    } finally {
      await sql(`grant execute on function ${fn} to service_role`);
      quiet.mockRestore();
    }
    const ok = await reloadUntil(
      () => h.world.start(alice, randomUUID(), "r2"),
      (r) => r.ok,
    );
    const run = runOf(ok);
    await pullUntil(run, EventType.TEXT_MESSAGE_CONTENT);
    run.close();
    await vi.waitFor(() => expect(h.policy.snapshot().running).toBe(0));
    expect(await countOf(alice.id)).toBe(1);
  });
});

describe("usage functions startup check on the local stack", () => {
  const repo = () => createUsageRepo(db(), { caps: { perMonth: 50, perHour: 10 } });

  it("passes with the migrations applied", async () => {
    expect(await checkUsageFunctions(repo())).toBe("ok");
  });

  it("reports missing while request_usage_summary is renamed away (PGRST202)", async () => {
    try {
      await sql("alter function public.request_usage_summary(timestamptz) rename to request_usage_summary_x");
      expect(
        await reloadUntil(
          () => checkUsageFunctions(repo()),
          (v) => v === "missing",
        ),
      ).toBe("missing");
    } finally {
      await sql("alter function public.request_usage_summary_x(timestamptz) rename to request_usage_summary");
    }
    expect(
      await reloadUntil(
        () => checkUsageFunctions(repo()),
        (v) => v === "ok",
      ),
    ).toBe("ok");
  });

  it("reports missing while request_usage_summary is not executable (42501)", async () => {
    try {
      await sql("revoke execute on function public.request_usage_summary(timestamptz) from service_role");
      expect(
        await reloadUntil(
          () => checkUsageFunctions(repo()),
          (v) => v === "missing",
        ),
      ).toBe("missing");
    } finally {
      await sql("grant execute on function public.request_usage_summary(timestamptz) to service_role");
    }
    expect(
      await reloadUntil(
        () => checkUsageFunctions(repo()),
        (v) => v === "ok",
      ),
    ).toBe("ok");
  });
});

describe("hosted store on the local stack (A13)", () => {
  it("claims a chat and stores messages with the secret key", async () => {
    const u = await createUser({ invited: false });
    const repos = createSupabaseStore(db()).forUser(u.id);
    const chat = randomUUID();
    await repos.chats.claim(chat, {});
    await repos.messages.append(chat, "r1", [{ role: "user", content: "hello", status: "complete" }]);
    expect((await repos.messages.history(chat)).items.map((m) => m.content)).toEqual(["hello"]);
  });
});
