import { BlockedAddressError } from "../../src/lib/net.js";
import { createSafeFetch } from "../../src/lib/safeFetch.js";
import { OPENAI_CODEX_MODELS } from "@earendil-works/pi-ai/providers/openai-codex.models";
import { describe, expect, it } from "vitest";
import { EnvelopeCredentialStore } from "../../src/secrets/credentialStore.js";
import { wrapper } from "../fixtures/app.js";
import type { ProviderHub } from "../../src/providers/hub.js";
import { fakeFetch, json } from "../fixtures/fakeFetch.js";
import { testHub } from "../fixtures/hub.js";
import { MemoryDb } from "../fixtures/memoryRepos.js";
import { NO_CAPABILITIES } from "../../src/identity/types.js";
import { ADMIN, ALICE } from "../fixtures/users.js";

const seed = {
  baseUrl: "http://llm:4000/v1",
  apiKey: "sk-local-dev",
  models: [
    { id: "chat-default", label: "Qwen 3.5 (local)", note: "Free" },
    { id: "chat-sonnet-5.5", label: "Sonnet 5.5" },
  ],
};

const make = (db = new MemoryDb(), extra: Partial<Parameters<typeof ProviderHub.create>[0]> = {}) =>
  testHub({ litellm: seed, ...extra }, db).then((hub) => ({ hub, db }));

describe("ProviderHub", () => {
  it("takes context and output limits for gateway models from LiteLLM, keeping safe defaults for unknown ones", async () => {
    const f = fakeFetch([
      [
        /model\/info/,
        () =>
          json({
            data: [
              { model_name: "chat-sonnet-5.5", model_info: { max_input_tokens: 1_000_000, max_output_tokens: 128_000 } },
              { model_name: "chat-default", model_info: null },
            ],
          }),
      ],
    ]);
    const { hub } = await make(undefined, { fetch: f });
    expect(hub.resolve("litellm/chat-sonnet-5.5")).toMatchObject({ contextWindow: 1_000_000, maxTokens: 32_000 });
    expect(hub.resolve("litellm/chat-default")).toMatchObject({ contextWindow: 32768, maxTokens: 4096 });
  });

  it("takes per-token prices for gateway models from LiteLLM so runs report their cost", async () => {
    const f = fakeFetch([
      [
        /model\/info/,
        () =>
          json({
            data: [
              {
                model_name: "chat-sonnet-5.5",
                model_info: { input_cost_per_token: 2e-6, output_cost_per_token: 1e-5, cache_read_input_token_cost: 1e-7 },
              },
            ],
          }),
      ],
    ]);
    const { hub } = await make(undefined, { fetch: f });
    expect(hub.resolve("litellm/chat-sonnet-5.5")?.cost).toEqual({ input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 });
    expect(hub.resolve("litellm/chat-default")?.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it("lists the curated providers, with the LiteLLM gateway seeded and ready", async () => {
    const { hub } = await make();
    const list = hub.list();
    expect(list.map((p) => p.id)).toEqual(
      expect.arrayContaining(["openai", "anthropic", "openrouter", "together", "groq", "google", "litellm"]),
    );
    expect(list.find((p) => p.id === "openai")).toMatchObject({
      configured: false,
      methods: ["api_key", "oauth"],
      oauthLabel: "Sign in with ChatGPT",
    });
    expect(list.find((p) => p.id === "anthropic")).toMatchObject({ methods: ["api_key"] });
    expect(list.find((p) => p.id === "litellm")).toMatchObject({
      configured: true,
      kind: "local",
      enabled: ["chat-default", "chat-sonnet-5.5"],
    });
  });

  it("saves a key encrypted that survives a restart, and only ever shows a hint", async () => {
    const { hub, db } = await make();
    await hub.setKey("openai", "sk-proj-secretsecretsecret4242");
    expect(JSON.stringify(hub.list())).not.toContain("secretsecret");
    expect(hub.list().find((p) => p.id === "openai")).toMatchObject({ configured: true, hint: "sk-proj-…4242" });
    const row = [...db.credentials.values()][0];
    expect(row).toMatchObject({ provider: "openai", kind: "api_key", hint: "sk-proj-…4242", keyVersion: 1 });
    expect(row.ciphertext.toString("latin1")).not.toContain("secretsecret");
    const { hub: again } = await make(db);
    expect(again.list().find((p) => p.id === "openai")?.configured).toBe(true);
    expect((await again.runtime.checkAuth("openai"))?.type).toBe("api_key");
  });

  it("offers only the models enabled on configured providers, by provider/model reference", async () => {
    const { hub } = await make();
    expect(hub.enabledModels().map((m) => m.id)).toEqual(["litellm/chat-default", "litellm/chat-sonnet-5.5"]);
    await hub.setEnabled("openai", ["gpt-4.1"]);
    expect(hub.enabledModels().some((m) => m.id === "openai/gpt-4.1")).toBe(false);
    await hub.setKey("openai", "sk-x");
    expect(hub.enabledModels().find((m) => m.id === "openai/gpt-4.1")).toMatchObject({
      provider: "OpenAI",
      label: expect.any(String),
      note: "$2 in · $8 out per 1M tokens",
    });
  });

  it("offers only ChatGPT-plan models after a ChatGPT sign-in and drops ones the plan rejects", async () => {
    const plan = new Set(Object.values(OPENAI_CODEX_MODELS).map((m) => m.id));
    const db = new MemoryDb();
    const { hub: keyed } = await make(db);
    await keyed.setKey("openai", "sk-x");
    expect(keyed.models("openai").some((m) => m.id === "gpt-5.5")).toBe(true);
    await keyed.setEnabled("openai", ["gpt-5.5"]);

    const creds = new EnvelopeCredentialStore(ADMIN.id, db.forUser(ADMIN.id).credentials, wrapper);
    await creds.modify("openai", async () => ({ type: "oauth", refresh: "r", access: "a", expires: Date.now() + 3_600_000 }));
    const { hub } = await make(db);

    const listed = hub.models("openai").map((m) => m.id);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((id) => plan.has(id))).toBe(true);
    expect(listed).not.toContain("gpt-5.5");
    expect(
      hub
        .enabledModels()
        .filter((m) => m.id.startsWith("openai/"))
        .map((m) => m.id),
    ).toEqual(["openai/gpt-6.1-sol", "openai/gpt-6-luna"]);
    expect(hub.resolve("openai/gpt-5.5")).toBeUndefined();
    expect(hub.resolve("openai/gpt-6.1-sol")).toMatchObject({ id: "gpt-6.1-sol" });
    await expect(hub.setEnabled("openai", ["gpt-5.5"])).rejects.toThrow(/unknown model gpt-5.5/);
    await hub.setEnabled("openai", ["gpt-6-sol"]);
    expect(
      hub
        .enabledModels()
        .filter((m) => m.id.startsWith("openai/"))
        .map((m) => m.id),
    ).toEqual(["openai/gpt-6-sol"]);
  });

  it("resolves references, including old LiteLLM aliases without a provider", async () => {
    const { hub } = await make();
    await hub.setKey("openrouter", "sk-or");
    expect(hub.resolve("openrouter/anthropic/claude-haiku-4.5")?.id).toBe("anthropic/claude-haiku-4.5");
    expect(hub.resolve("chat-sonnet-5.5")?.provider).toBe("litellm");
    expect(hub.resolve("openai/gpt-4.1")).toBeUndefined();
    expect(hub.resolve("nope/x")).toBeUndefined();
  });

  it("adds a local server by discovering its models, and remembers it", async () => {
    const f = fakeFetch([
      [/host\.docker\.internal:11434\/v1\/models$/, () => json({ data: [{ id: "qwen3.5:35b" }, { id: "gemma4:latest" }] })],
    ]);
    const { hub, db } = await make(undefined, { fetch: f });
    const added = await hub.addLocal({
      kind: "ollama",
      baseUrl: "http://host.docker.internal:11434/v1",
      apiKey: "local-key-0123456789abcd",
    });
    expect(added).toMatchObject({ id: "ollama", configured: true, enabled: ["qwen3.5:35b", "gemma4:latest"] });
    expect(hub.resolve("ollama/qwen3.5:35b")?.baseUrl).toBe("http://host.docker.internal:11434/v1");
    expect([...db.credentials.values()].map((c) => c.provider)).toEqual(["ollama"]);
    const { hub: again } = await make(db, { fetch: f });
    expect(again.resolve("ollama/gemma4:latest")).toBeDefined();
  });

  it("explains when a local server can't be reached", async () => {
    const { hub } = await make(undefined, { fetch: fakeFetch([]) });
    await expect(hub.addLocal({ kind: "llamacpp", baseUrl: "http://host.docker.internal:8080/v1" })).rejects.toThrow(
      /couldn't list models/i,
    );
  });

  it("removes a cloud key or a local server", async () => {
    const f = fakeFetch([[/\/models$/, () => json({ data: [{ id: "m1" }] })]]);
    const { hub } = await make(undefined, { fetch: f });
    await hub.setKey("groq", "gsk");
    await hub.addLocal({ kind: "lmstudio", baseUrl: "http://host.docker.internal:1234/v1" });
    await hub.remove("groq");
    await hub.remove("lmstudio");
    expect(hub.list().find((p) => p.id === "groq")?.configured).toBe(false);
    expect(hub.list().find((p) => p.id === "lmstudio")?.configured).toBe(false);
    expect(hub.resolve("lmstudio/m1")).toBeUndefined();
  });

  it("refuses providers outside the curated list and blank keys", async () => {
    const { hub } = await make();
    await expect(hub.setKey("amazon-bedrock", "k")).rejects.toThrow(/not supported/);
    await expect(hub.setKey("openai", "  ")).rejects.toThrow(/empty/);
    await expect(hub.setEnabled("openai", ["not-a-model"])).rejects.toThrow(/unknown model/);
  });

  it("tests a model with one small tool call and reports cost", async () => {
    const { hub } = await make(undefined, {
      complete: async () =>
        ({
          content: [{ type: "toolCall", id: "t", name: "get_time", arguments: { city: "Paris" } }],
          usage: { cost: { total: 0.00012 } },
        }) as never,
    });
    expect(await hub.test("litellm/chat-default")).toMatchObject({ ok: true, toolCall: true, cost: 0.00012 });
  });

  it("reports a model that answers in prose instead of calling the tool", async () => {
    const { hub } = await make(undefined, {
      complete: async () => ({ content: [{ type: "text", text: "It is noon." }], usage: { cost: { total: 0 } } }) as never,
    });
    expect(await hub.test("litellm/chat-default")).toMatchObject({ ok: false, toolCall: false });
  });

  it("keeps one device ID per user for sign-in flows", async () => {
    const { hub, db } = await make();
    const id = hub.deviceId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const { hub: again } = await make(db);
    expect(again.deviceId()).toBe(id);
  });

  it("stores the enabled models in the user's settings, never the gateway or a key", async () => {
    const { hub, db } = await make();
    await hub.setEnabled("openai", ["gpt-4.1"]);
    const settings = JSON.stringify(db.settings.get(ADMIN.id)?.data);
    expect(JSON.parse(settings).enabled.openai).toEqual(["gpt-4.1"]);
    expect(JSON.parse(settings).custom.litellm).toBeUndefined();
    expect(settings).not.toContain("sk-");
  });

  it("offers the operator gateway only to the admin", async () => {
    const db = new MemoryDb();
    const user = await testHub({ litellm: seed, userId: ALICE.id, capabilities: NO_CAPABILITIES }, db);
    expect(user.list().some((p) => p.id === "litellm")).toBe(false);
    expect(user.resolve("litellm/chat-default")).toBeUndefined();
  });

  it("refuses private addresses for invited users, also when a stored one resolves inside", async () => {
    const f = fakeFetch([[/\/models$/, () => json({ data: [{ id: "m1" }] })]]);
    const db = new MemoryDb();
    const user = await testHub({ userId: ALICE.id, capabilities: NO_CAPABILITIES, fetch: f }, db);
    await expect(user.addLocal({ kind: "custom", baseUrl: "http://10.0.0.5:8000/v1" })).rejects.toMatchObject({ kind: "unprocessable" });
    await expect(user.addLocal({ kind: "custom", baseUrl: "http://localhost:8000/v1" })).rejects.toMatchObject({ kind: "unprocessable" });
    const rebinding = await testHub(
      { userId: ALICE.id, capabilities: NO_CAPABILITIES, fetch: f, lookup: async () => ["169.254.169.254"] },
      db,
    );
    await expect(rebinding.addLocal({ kind: "custom", baseUrl: "https://models.example.com/v1" })).rejects.toMatchObject({
      kind: "unprocessable",
    });
    const ok = await user.addLocal({ kind: "custom", baseUrl: "https://models.example.com/v1" });
    expect(ok.configured).toBe(true);
    const later = await testHub({ userId: ALICE.id, capabilities: NO_CAPABILITIES, fetch: f, lookup: async () => ["127.0.0.1"] }, db);
    expect(later.list().find((p) => p.id === "custom")?.configured).toBe(false);
  });

  it("sends an invited user's model calls through the guarded fetch, never the default one", async () => {
    const sse = () =>
      new Response(
        [
          `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 1, model: "m1", choices: [{ index: 0, delta: { role: "assistant", content: "hi" }, finish_reason: "stop" }] })}`,
          "data: [DONE]",
          "",
        ].join("\n\n"),
        { headers: { "content-type": "text/event-stream" } },
      );
    const f = fakeFetch([
      [/\/models$/, () => json({ data: [{ id: "m1" }] })],
      [/\/chat\/completions$/, sse],
    ]);
    const user = await testHub({ userId: ALICE.id, capabilities: NO_CAPABILITIES, userFetch: createSafeFetch(f) });
    await user.addLocal({ kind: "custom", baseUrl: "https://models.example.com/v1" });
    await user.test("custom/m1");
    expect(f.calls).toContain("https://models.example.com/v1/chat/completions");
  });

  it("maps a connect-time refusal to the private-address error", async () => {
    const blocked = (async () => {
      throw new TypeError("fetch failed", { cause: new BlockedAddressError("refusing models.example.com") });
    }) as typeof fetch;
    const user = await testHub({ userId: ALICE.id, capabilities: NO_CAPABILITIES, userFetch: blocked });
    await expect(user.addLocal({ kind: "custom", baseUrl: "https://models.example.com/v1" })).rejects.toMatchObject({
      kind: "unprocessable",
      message: "That address isn't reachable from the server.",
    });
  });

  it("refuses to overwrite settings another tab changed", async () => {
    const db = new MemoryDb();
    const f = fakeFetch([[/\/models$/, () => json({ data: [{ id: "m1" }] })]]);
    const first = await testHub({ fetch: f }, db);
    const second = await testHub({ fetch: f }, db);
    await first.addLocal({ kind: "custom", baseUrl: "https://models.example.com/v1" });
    await expect(second.setEnabled("custom", [])).rejects.toMatchObject({ kind: "conflict", code: "settings_changed" });
  });
});
