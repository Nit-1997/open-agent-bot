import { randomUUID } from "node:crypto";
import { errorResponse } from "@oab/core/http/handlers.js";
import type { AuthEnv } from "@oab/core/identity/types.js";
import { RateLimiter } from "@oab/core/lib/rateLimit.js";
import { Hono } from "hono";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadHostedConfig } from "../../src/config.js";
import { hostedAgentDeps } from "../../src/deps.js";
import { createUsageRepo, type UsageRepo } from "../../src/limits/usageRepo.js";
import { createAnonClient, createServiceClient } from "../../src/store/client.js";
import { TEST_ENV } from "../fixtures/config.js";
import { admin, anon, cleanup, closeHarness, invite, localEnv, sql, testEmail, track } from "./harness.js";

beforeEach(() => {
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  try {
    expect(await cleanup()).toBe(0);
  } finally {
    await closeHarness();
  }
});

type Account = { id: string; email: string; accessToken: string };

async function signUpThroughHook(email: string): Promise<Account> {
  const link = await admin().auth.admin.generateLink({ type: "magiclink", email: track(email) });
  if (link.error) throw link.error;
  const { data, error } = await anon().auth.verifyOtp({ type: "email", token_hash: link.data.properties.hashed_token });
  if (error || !data.session || !data.user) throw error ?? new Error("verifyOtp returned no session");
  return { id: data.user.id, email, accessToken: data.session.access_token };
}

async function invitedSignUp(email = testEmail("del")): Promise<Account> {
  await invite(email);
  return signUpThroughHook(email);
}

function agent(wrap?: (inner: UsageRepo) => UsageRepo) {
  const env = localEnv();
  const cfg = loadHostedConfig({
    ...TEST_ENV,
    SUPABASE_LOCAL_STACK: "1",
    SUPABASE_URL: env.apiUrl,
    SUPABASE_PUBLISHABLE_KEY: env.publishableKey,
    SUPABASE_SECRET_KEY: env.secretKey,
    APP_ORIGIN: "http://localhost:18721",
    LIMIT_REQUESTS_PER_HOUR: "100",
    LIMIT_REQUESTS_PER_MONTH: "100",
  });
  const clients = { db: createServiceClient(cfg), anon: createAnonClient(cfg) };
  const inner = createUsageRepo(clients.db, { caps: { perMonth: cfg.limits.perMonth, perHour: cfg.limits.perHour } });
  const { deps } = hostedAgentDeps(cfg, clients, { usage: wrap ? wrap(inner) : inner });
  const forgotten: string[] = [];
  const limiter = new RateLimiter();
  const mounts = deps.routes!({ limiter, forgetUser: async (id) => void forgotten.push(id) });
  const policy = deps.runPolicy!({ limiter });
  const app = new Hono<AuthEnv>();
  app.use(async (c, next) => {
    const out = await deps.identity.authenticate(c.req.raw);
    if (!out.ok) return errorResponse(c, out.error);
    c.set("user", out.principal);
    await next();
  });
  app.route("/", mounts.find((m) => m.basePath === "/account")!.routes);
  const post = (who: Account, body: unknown, path = "/account/delete") =>
    app.request(path, {
      method: "POST",
      headers: { authorization: `Bearer ${who.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const admitAs = async (who: Account) => {
    const out = await deps.identity.authenticate(new Request("http://agent/", { headers: { authorization: `Bearer ${who.accessToken}` } }));
    if (!out.ok) throw out.error;
    return policy.admit({ principal: out.principal, chatId: randomUUID(), runId: `r-${randomUUID().slice(0, 8)}` });
  };
  return { post, admitAs, forgotten };
}

async function admitN(a: ReturnType<typeof agent>, who: Account, n: number) {
  for (let i = 0; i < n; i++) {
    const r = await a.admitAs(who);
    if (!r.ok) throw r.error;
    r.ticket.end();
  }
}

const monthCount = async (id: string) =>
  Number((await sql<{ n: number }>("select coalesce(sum(count), 0)::int as n from public.request_usage where user_id = $1", [id]))[0].n);
const checked = async (id: string) => (await sql("select 1 from public.human_checks where user_id = $1", [id])).length === 1;
const exists = async (id: string) => (await sql("select 1 from auth.users where id = $1", [id])).length === 1;

describe("self-serve delete and re-sign-up on the local stack (AC 22, D20, D23)", () => {
  it("signs a new address up through the before_user_created hook, which refuses a non-invited address", async () => {
    const stranger = testEmail("stranger");
    const refused = await admin().auth.admin.generateLink({ type: "magiclink", email: track(stranger) });
    expect(refused.error?.message).toContain("invite-only");
    const user = await invitedSignUp();
    expect(await exists(user.id)).toBe(true);
  });

  it("deletes the member with the typed email, then the same email re-signing up this month keeps the count and the human check", async () => {
    const a = agent();
    const user = await invitedSignUp();
    await admitN(a, user, 2);
    await sql("insert into public.human_checks (user_id) values ($1)", [user.id]);

    const wrong = await a.post(user, { confirmEmail: "someone-else@example.test" });
    expect(wrong.status).toBe(422);
    expect(await exists(user.id)).toBe(true);

    const ok = await a.post(user, { confirmEmail: user.email.toUpperCase() });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(a.forgotten).toEqual([user.id]);
    expect(await exists(user.id)).toBe(false);
    const [left] = await sql<{ n: number }>(
      `select (select count(*) from public.profiles where user_id = $1)
            + (select count(*) from public.request_usage where user_id = $1)
            + (select count(*) from public.human_checks where user_id = $1)
            + (select count(*) from public.invited_emails where email = $2)::int as n`,
      [user.id, user.email],
    );
    expect(Number(left.n)).toBe(0);
    expect((await a.post(user, { confirmEmail: user.email })).status).toBe(403);

    const again = await invitedSignUp(user.email);
    expect(again.id).not.toBe(user.id);
    expect(await monthCount(again.id)).toBe(2);
    expect(await checked(again.id)).toBe(true);
    const [next] = await sql<{ month_used: number }>(
      "select month_used from public.request_usage_get($1, date_trunc('month', now()) + interval '1 month' + interval '1 hour')",
      [again.id],
    );
    expect(next.month_used).toBe(0);
  });

  it("deletes only the session user: another user's id or email in the body deletes nobody", async () => {
    const a = agent();
    const alice = await invitedSignUp();
    const bob = await invitedSignUp();
    for (const body of [
      { confirmEmail: bob.email, userId: bob.id },
      { confirmEmail: bob.email, id: bob.id },
    ]) {
      expect((await a.post(alice, body)).status).toBe(422);
    }
    expect((await a.post(alice, { confirmEmail: bob.email }, `/account/delete/${bob.id}`)).status).toBe(404);
    expect(await exists(bob.id)).toBe(true);
    expect(await exists(alice.id)).toBe(true);
    expect(a.forgotten).toEqual([]);
  });

  it("allows 3 delete attempts per hour per user, then answers 429", async () => {
    const a = agent();
    const user = await invitedSignUp();
    for (let i = 0; i < 3; i++) expect((await a.post(user, { confirmEmail: "nope@example.test" })).status).toBe(422);
    const limited = await a.post(user, { confirmEmail: user.email });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).not.toBeNull();
    expect(await exists(user.id)).toBe(true);
  });

  it("refuses a run admitted between the delete start and the tombstone, so the carried-over count is exact", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let reached!: () => void;
    const atTombstone = new Promise<void>((r) => (reached = r));
    const a = agent((inner) => ({
      ...inner,
      tombstone: async (id) => {
        reached();
        await held;
        await inner.tombstone(id);
      },
    }));
    const user = await invitedSignUp();
    await admitN(a, user, 3);

    const pending = a.post(user, { confirmEmail: user.email });
    await atTombstone;
    const during = await a.admitAs(user);
    expect(during.ok ? "ok" : { code: during.error.opts.code, kind: during.error.kind }).toEqual({
      code: "account_disabled",
      kind: "forbidden",
    });
    expect(await monthCount(user.id)).toBe(3);
    release();
    expect((await pending).status).toBe(200);

    const again = await invitedSignUp(user.email);
    expect(await monthCount(again.id)).toBe(3);
  });
});
