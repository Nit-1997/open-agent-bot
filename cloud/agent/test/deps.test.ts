import { describe, expect, it, vi } from "vitest";
import { adminHooks, hostedAgentDeps } from "../../src/hosted/deps.js";
import { hostedGateway } from "../../src/hosted/gateway.js";
import type { Db } from "../../src/hosted/store/client.js";
import type { Identity } from "../../src/identity/types.js";
import { RateLimiter } from "../../src/lib/rateLimit.js";
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
