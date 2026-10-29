import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProviderHub } from "../../src/providers/hub.js";
import { fakeFetch, json } from "../fixtures/fakeFetch.js";

const seed = {
  baseUrl: "http://llm:4000/v1",
  apiKey: "sk-local-dev",
  models: [
    { id: "chat-default", label: "Qwen 3.5 (local)", note: "Free" },
    { id: "chat-sonnet-5.5", label: "Sonnet 5.5" },
  ],
};

const make = (dir = mkdtempSync(join(tmpdir(), "hub-")), extra: Partial<Parameters<typeof ProviderHub.create>[0]> = {}) =>
  ProviderHub.create({ dataDir: dir, litellm: seed, fetch: fakeFetch([]), ...extra }).then((hub) => ({ hub, dir }));

describe("ProviderHub", () => {
  it("takes context and output limits for gateway models from LiteLLM, keeping safe defaults for unknown ones", async () => {
    const f = fakeFetch([
      [/model\/info/, () => json({ data: [{ model_name: "chat-sonnet-5.5", model_info: { max_input_tokens: 1_000_000, max_output_tokens: 128_000 } }, { model_name: "chat-default", model_info: null }] })],
    ]);
    const { hub } = await make(undefined, { fetch: f });
    expect(hub.resolve("litellm/chat-sonnet-5.5")).toMatchObject({ contextWindow: 1_000_000, maxTokens: 32_000 });
    expect(hub.resolve("litellm/chat-default")).toMatchObject({ contextWindow: 32768, maxTokens: 4096 });
  });

  it("takes per-token prices for gateway models from LiteLLM so runs report their cost", async () => {
    const f = fakeFetch([
      [/model\/info/, () => json({ data: [{ model_name: "chat-sonnet-5.5", model_info: { input_cost_per_token: 2e-6, output_cost_per_token: 1e-5, cache_read_input_token_cost: 1e-7 } }] })],
    ]);
    const { hub } = await make(undefined, { fetch: f });
    expect(hub.resolve("litellm/chat-sonnet-5.5")?.cost).toEqual({ input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 });
    expect(hub.resolve("litellm/chat-default")?.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it("lists the curated providers, with the LiteLLM gateway seeded and ready", async () => {
    const { hub } = await make();
    const list = hub.list();
    expect(list.map((p) => p.id)).toEqual(expect.arrayContaining(["openai", "anthropic", "openrouter", "together", "groq", "google", "litellm"]));
    expect(list.find((p) => p.id === "openai")).toMatchObject({ configured: false, methods: ["api_key", "oauth"], oauthLabel: "Sign in with ChatGPT" });
    expect(list.find((p) => p.id === "anthropic")).toMatchObject({ methods: ["api_key"] });
    expect(list.find((p) => p.id === "litellm")).toMatchObject({ configured: true, kind: "local", enabled: ["chat-default", "chat-sonnet-5.5"] });
  });

  it("saves a key that survives a restart, never returns it, and keeps the file private", async () => {
    const { hub, dir } = await make();
    await hub.setKey("openai", "sk-secret-abc");
    expect(JSON.stringify(hub.list())).not.toContain("sk-secret-abc");
    const { hub: again } = await make(dir);
    expect(again.list().find((p) => p.id === "openai")?.configured).toBe(true);
    expect(statSync(join(dir, "auth.json")).mode & 0o077).toBe(0);
    expect(statSync(dir).mode & 0o077).toBe(0);
  });

  it("offers only the models enabled on configured providers, by provider/model reference", async () => {
    const { hub } = await make();
    expect(hub.enabledModels().map((m) => m.id)).toEqual(["litellm/chat-default", "litellm/chat-sonnet-5.5"]);
    await hub.setEnabled("openai", ["gpt-4.1"]);
    expect(hub.enabledModels().some((m) => m.id === "openai/gpt-4.1")).toBe(false);
    await hub.setKey("openai", "sk-x");
    expect(hub.enabledModels().find((m) => m.id === "openai/gpt-4.1")).toMatchObject({ provider: "OpenAI", label: expect.any(String), note: "$2 in · $8 out per 1M tokens" });
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
    const f = fakeFetch([[/host\.docker\.internal:11434\/v1\/models$/, () => json({ data: [{ id: "qwen3.5:35b" }, { id: "gemma4:latest" }] })]]);
    const { hub, dir } = await make(undefined, { fetch: f });
    const added = await hub.addLocal({ kind: "ollama", baseUrl: "http://host.docker.internal:11434/v1" });
    expect(added).toMatchObject({ id: "ollama", configured: true, enabled: ["qwen3.5:35b", "gemma4:latest"] });
    expect(hub.resolve("ollama/qwen3.5:35b")?.baseUrl).toBe("http://host.docker.internal:11434/v1");
    const { hub: again } = await make(dir, { fetch: f });
    expect(again.resolve("ollama/gemma4:latest")).toBeDefined();
  });

  it("explains when a local server can't be reached", async () => {
    const { hub } = await make(undefined, { fetch: fakeFetch([]) });
    await expect(hub.addLocal({ kind: "llamacpp", baseUrl: "http://host.docker.internal:8080/v1" })).rejects.toThrow(/couldn't list models/i);
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
        ({ content: [{ type: "toolCall", id: "t", name: "get_time", arguments: { city: "Paris" } }], usage: { cost: { total: 0.00012 } } }) as never,
    });
    expect(await hub.test("litellm/chat-default")).toMatchObject({ ok: true, toolCall: true, cost: 0.00012 });
  });

  it("reports a model that answers in prose instead of calling the tool", async () => {
    const { hub } = await make(undefined, { complete: async () => ({ content: [{ type: "text", text: "It is noon." }], usage: { cost: { total: 0 } } }) as never });
    expect(await hub.test("litellm/chat-default")).toMatchObject({ ok: false, toolCall: false });
  });

  it("keeps one device ID per installation for sign-in flows", async () => {
    const { hub, dir } = await make();
    const id = await hub.deviceId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await hub.deviceId()).toBe(id);
    const { hub: again } = await make(dir);
    expect(await again.deviceId()).toBe(id);
  });

  it("stores the enabled models in a non-secret settings file", async () => {
    const { hub, dir } = await make();
    await hub.setEnabled("openai", ["gpt-4.1"]);
    const settings = readFileSync(join(dir, "providers.json"), "utf8");
    expect(JSON.parse(settings).enabled.openai).toEqual(["gpt-4.1"]);
    expect(settings).not.toContain("sk-");
  });
});
