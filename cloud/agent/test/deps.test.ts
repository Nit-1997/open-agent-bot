import { afterEach, describe, expect, it, vi } from "vitest";
import { adminHooks, hostedAgentDeps, humanVerifierFor, startLimitTimers } from "../src/deps.js";
import { HostedRunPolicy } from "../src/limits/policy.js";
import { FakeUsageStore } from "./limits/fakeUsage.js";
import { hostedGateway } from "../src/gateway.js";
import type { Db } from "../src/store/client.js";
import type { Identity } from "@oab/core/identity/types.js";
import { RateLimiter } from "@oab/core/lib/rateLimit.js";
import { testConfig } from "./fixtures/config.js";
import { ALICE } from "./fixtures/users.js";

const stub = () => ({ auth: { admin: {} } }) as unknown as Db;
const clients = { db: stub(), anon: stub() };
const handles = () => ({ limiter: new RateLimiter(), forgetUser: vi.fn(async () => {}) });

describe("hostedAgentDeps", () => {
  it("listens on every interface with a hosted identity, the config port and the hosted mounts", () => {
    const cfg = testConfig();
    const { deps, status } = hostedAgentDeps(cfg, clients);
    expect(deps.host).toBe("0.0.0.0");
    expect(deps.port).toBeUndefined();
    expect(deps.config.port).toBe(cfg.port);
    expect(deps.identity.kind).toBe("hosted");
    expect(deps.config).toBe(cfg);
    expect(status).toBeDefined();
    const mounts = deps.routes!(handles());
    expect(mounts.map((m) => [m.stage, m.basePath])).toEqual([
      ["public", "/"],
      ["protected", "/admin"],
      ["protected", "/usage"],
      ["protected", "/human-check"],
      ["protected", "/account"],
    ]);
  });

  it("refuses an identity that is not hosted", () => {
    const local: Identity = { kind: "local", admitCaller: () => undefined, authenticate: async () => ({ ok: true, principal: ALICE }) };
    expect(() => hostedAgentDeps(testConfig(), clients, { identity: local })).toThrow(
      'the hosted agent needs a hosted identity, got "local"',
    );
  });

  it("offers the gateway only when an LLM key is configured", () => {
    expect(hostedAgentDeps(testConfig(), clients).deps.gateway).toBeUndefined();
    const cfg = testConfig({ LLM_API_KEY: "k", LLM_BASE_URL: "http://llm:4000/v1", AGENT_MODELS: "m1=Model One" });
    expect(hostedAgentDeps(cfg, clients).deps.gateway).toEqual({
      baseUrl: "http://llm:4000/v1",
      apiKey: "k",
      models: [{ id: "m1", label: "Model One" }],
    });
  });
});

describe("hostedAgentDeps request limits", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("builds one HostedRunPolicy on the shared limiter for runs and the usage route, over the seamed usage repo", async () => {
    const usage = new FakeUsageStore().repo({ caps: { perMonth: 50, perHour: 10 } });
    const { deps, usage: shown } = hostedAgentDeps(testConfig(), clients, { usage });
    expect(shown).toBe(usage);
    const core = handles();
    deps.routes!(core);
    const policy = deps.runPolicy!({ limiter: core.limiter });
    expect(policy).toBeInstanceOf(HostedRunPolicy);
    expect(deps.runPolicy!({ limiter: core.limiter })).toBe(policy);
  });

  it("sweeps stale slots every 30 s and prunes the usage log every hour, logging a failed prune", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const policy = { sweep: vi.fn() };
    const usage = { prune: vi.fn(async () => Promise.reject(new Error("down"))) };
    const stop = startLimitTimers(policy, usage);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(policy.sweep).toHaveBeenCalledTimes(2);
    expect(usage.prune).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3_540_000);
    expect(usage.prune).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.flat().join(" ")).toContain("[limits] usage prune failed");
    stop();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(usage.prune).toHaveBeenCalledTimes(1);
  });
});

describe("humanVerifierFor", () => {
  it("logs that open mode needs a secret and builds no verifier without one", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(humanVerifierFor({ appOrigin: "https://app.example" })).toBeUndefined();
    expect(warn.mock.calls.flat().join(" ")).toContain("[signup] open mode needs TURNSTILE_SECRET_KEY");
  });

  it("checks APP_ORIGIN's hostname without the port, and accepts the recorded test response only for a test secret in local-stack mode", async () => {
    const reply = (body: object) => vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body)));
    const ok = { success: true, hostname: "localhost", action: "human_check" };
    const test = { success: true, hostname: "example.com", metadata: { result_with_testing_key: true } };
    const pass = "1x0000000000000000000000000000000AA";
    reply(ok);
    expect(
      await humanVerifierFor({ appOrigin: "http://localhost:18721", turnstile: { secret: pass }, localStack: true })!.verify("t", {
        action: "human_check",
      }),
    ).toBe("ok");
    reply(test);
    expect(
      await humanVerifierFor({ appOrigin: "http://localhost:18721", turnstile: { secret: pass }, localStack: true })!.verify("t", {
        action: "human_check",
      }),
    ).toBe("ok");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    reply(test);
    expect(
      await humanVerifierFor({ appOrigin: "http://localhost:18721", turnstile: { secret: pass } })!.verify("t", { action: "human_check" }),
    ).toBe("failed");
  });
});

describe("adminHooks", () => {
  it("invalidates the status and then forgets the user when an account is disabled", async () => {
    const order: string[] = [];
    const status = { invalidate: vi.fn((id: string) => void order.push(`invalidate ${id}`)) };
    const forgetUser = vi.fn(async (id: string) => void order.push(`forget ${id}`));
    await adminHooks(status, { forgetUser }).onDisabled(ALICE.id);
    expect(order).toEqual([`invalidate ${ALICE.id}`, `forget ${ALICE.id}`]);
  });

  it("only invalidates the status when an account is enabled again", () => {
    const status = { invalidate: vi.fn() };
    const forgetUser = vi.fn(async () => {});
    adminHooks(status, { forgetUser }).onEnabled(ALICE.id);
    expect(status.invalidate).toHaveBeenCalledWith(ALICE.id);
    expect(forgetUser).not.toHaveBeenCalled();
  });
});

describe("hostedGateway", () => {
  const models = [{ id: "m", label: "M" }];
  it("is undefined without an API key", () => {
    expect(hostedGateway({ llmBaseUrl: "http://llm:4000/v1", models })).toBeUndefined();
    expect(hostedGateway({ llmBaseUrl: "http://llm:4000/v1", llmApiKey: "", models })).toBeUndefined();
  });

  it("carries the base URL, key and models with one", () => {
    expect(hostedGateway({ llmBaseUrl: "http://llm:4000/v1", llmApiKey: "k", models })).toEqual({
      baseUrl: "http://llm:4000/v1",
      apiKey: "k",
      models,
    });
  });
});
