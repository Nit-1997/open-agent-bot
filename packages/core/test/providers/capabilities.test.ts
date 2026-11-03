import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { NO_CAPABILITIES } from "../../src/identity/types.js";
import { createSafeFetch } from "../../src/lib/safeFetch.js";
import type { ProviderHub } from "../../src/providers/hub.js";
import { fakeFetch, json } from "../fixtures/fakeFetch.js";
import { testHub } from "../fixtures/hub.js";
import { MemoryDb } from "../fixtures/memoryRepos.js";
import { GATEWAY, PRIVATE_TARGET, PRIVATE_URLS } from "../fixtures/privateUrls.js";
import { ALICE, ALL_CAPABILITIES } from "../fixtures/users.js";

const TSC = join(createRequire(import.meta.url).resolve("typescript/package.json"), "../bin/tsc");

const models = () => fakeFetch([[/\/models$/, () => json({ data: [{ id: "m1" }] })]]);

const completion = () =>
  new Response(
    [
      `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 1, model: "m1", choices: [{ index: 0, delta: { role: "assistant", content: "hi" }, finish_reason: "stop" }] })}`,
      "data: [DONE]",
      "",
    ].join("\n\n"),
    { headers: { "content-type": "text/event-stream" } },
  );

type Caps = { privateNetworkModels: boolean; operatorGateway: boolean };

async function hubWith(capabilities: Caps, extra: Parameters<typeof testHub>[0] = {}, db = new MemoryDb()) {
  const trusted = models();
  const guarded = models();
  const hub = await testHub(
    { userId: ALICE.id, capabilities, fetch: trusted, userFetch: createSafeFetch(guarded), litellm: GATEWAY, ...extra },
    db,
  );
  return { hub, trusted, guarded, db };
}

async function storeSettings(db: MemoryDb, data: object) {
  const repo = db.forUser(ALICE.id).providerSettings;
  await repo.put(data, (await repo.get()).stamp);
}

const touchedGateway = (calls: string[]) => calls.some((u) => u.startsWith("http://llm:4000"));
const hasGateway = (hub: ProviderHub) => hub.list().some((p) => p.id === "litellm");

describe("ProviderHub with no capabilities", () => {
  for (const baseUrl of PRIVATE_URLS) {
    it(`refuses ${baseUrl}`, async () => {
      const { hub, trusted, guarded } = await hubWith(NO_CAPABILITIES);
      await expect(hub.addLocal({ kind: "custom", baseUrl })).rejects.toMatchObject({ kind: "unprocessable", message: PRIVATE_TARGET });
      expect(trusted.calls).toEqual([]);
      expect(guarded.calls).toEqual([]);
    });
  }

  for (const resolved of ["127.0.0.1", "169.254.169.254"]) {
    it(`refuses a public name that resolves to ${resolved}`, async () => {
      const { hub } = await hubWith(NO_CAPABILITIES, { lookup: async () => [resolved] });
      await expect(hub.addLocal({ kind: "custom", baseUrl: "https://models.example.com/v1" })).rejects.toMatchObject({
        kind: "unprocessable",
        message: PRIVATE_TARGET,
      });
    });
  }

  it("drops a private base URL written straight into stored settings and never registers it", async () => {
    const db = new MemoryDb();
    await storeSettings(db, {
      custom: { custom: { kind: "custom", label: "Sneaky", baseUrl: "http://127.0.0.1:8000/v1", models: [{ id: "m1", label: "m1" }] } },
      enabled: { custom: ["m1"] },
      hidden: [],
    });
    const { hub } = await hubWith(NO_CAPABILITIES, {}, db);
    expect(hub.resolve("custom/m1")).toBeUndefined();
    expect(hub.list().find((p) => p.id === "custom")?.configured).toBe(false);
    expect(hub.runtime.getModel("custom", "m1")).toBeUndefined();
  });

  it("deletes a user-written litellm entry so no litellm model resolves", async () => {
    const db = new MemoryDb();
    await storeSettings(db, {
      custom: {
        litellm: { kind: "litellm", label: "Mine", baseUrl: "https://evil.example.com/v1", models: [{ id: "chat-default", label: "x" }] },
      },
      enabled: { litellm: ["chat-default"] },
      hidden: [],
    });
    const { hub } = await hubWith(NO_CAPABILITIES, { litellm: undefined }, db);
    expect(hasGateway(hub)).toBe(false);
    expect(hub.resolve("litellm/chat-default")).toBeUndefined();
    expect(hub.resolve("chat-default")).toBeUndefined();
    expect(hub.enabledModels().some((m) => m.id.startsWith("litellm/"))).toBe(false);
  });

  it("hides a configured gateway and never sends it a request", async () => {
    const { hub, trusted, guarded } = await hubWith(NO_CAPABILITIES);
    expect(hasGateway(hub)).toBe(false);
    expect(hub.resolve("litellm/chat-default")).toBeUndefined();
    expect(await hub.test("litellm/chat-default")).toMatchObject({ ok: false });
    expect(touchedGateway(trusted.calls)).toBe(false);
    expect(touchedGateway(guarded.calls)).toBe(false);
  });

  it("sends model calls to an allowed public URL through the safe fetch, never the default one", async () => {
    const trusted = fakeFetch([
      [/\/models$/, () => json({ data: [{ id: "m1" }] })],
      [/\/chat\/completions$/, completion],
    ]);
    const guarded = fakeFetch([
      [/\/models$/, () => json({ data: [{ id: "m1" }] })],
      [/\/chat\/completions$/, completion],
    ]);
    const { hub } = await hubWith(NO_CAPABILITIES, { fetch: trusted, userFetch: createSafeFetch(guarded) });
    await hub.addLocal({ kind: "custom", baseUrl: "https://models.example.com/v1" });
    await hub.test("custom/m1");
    expect(guarded.calls).toContain("https://models.example.com/v1/models");
    expect(guarded.calls).toContain("https://models.example.com/v1/chat/completions");
    expect(trusted.calls).toEqual([]);
  });
});

describe("ProviderHub capabilities are independent", () => {
  it("privateNetworkModels without operatorGateway allows a private URL but offers no gateway", async () => {
    const { hub, trusted, guarded } = await hubWith({ privateNetworkModels: true, operatorGateway: false });
    expect((await hub.addLocal({ kind: "ollama", baseUrl: "http://127.0.0.1:11434/v1" })).configured).toBe(true);
    expect(hasGateway(hub)).toBe(false);
    expect(hub.resolve("litellm/chat-default")).toBeUndefined();
    expect(touchedGateway(trusted.calls)).toBe(false);
    expect(touchedGateway(guarded.calls)).toBe(false);
  });

  it("operatorGateway without privateNetworkModels offers the gateway but refuses a private URL", async () => {
    const { hub } = await hubWith({ privateNetworkModels: false, operatorGateway: true });
    expect(hasGateway(hub)).toBe(true);
    expect(hub.resolve("litellm/chat-default")).toBeDefined();
    await expect(hub.addLocal({ kind: "ollama", baseUrl: "http://127.0.0.1:11434/v1" })).rejects.toMatchObject({
      kind: "unprocessable",
      message: PRIVATE_TARGET,
    });
  });

  it("operatorGateway without privateNetworkModels calls the gateway with the operator fetch, not the safe one", async () => {
    const operator = fakeFetch([[/\/chat\/completions$/, completion]]);
    vi.stubGlobal("fetch", operator);
    try {
      const { hub, guarded } = await hubWith({ privateNetworkModels: false, operatorGateway: true }, { fetch: operator });
      await hub.test("litellm/chat-default");
      expect(operator.calls).toContain("http://llm:4000/v1/chat/completions");
      expect(touchedGateway(guarded.calls)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("all capabilities behave like today's admin", async () => {
    const { hub } = await hubWith(ALL_CAPABILITIES);
    expect(hasGateway(hub)).toBe(true);
    expect((await hub.addLocal({ kind: "ollama", baseUrl: "http://127.0.0.1:11434/v1" })).configured).toBe(true);
  });
});

describe("ProviderHub.create types", () => {
  it("does not compile without capabilities", () => {
    const run = spawnSync(process.execPath, [TSC, "-p", join(import.meta.dirname, "capabilities.tsconfig.json")], { encoding: "utf8" });
    expect(`${run.stdout}${run.stderr}`).toBe("");
    expect(run.status).toBe(0);
  }, 60_000);
});
