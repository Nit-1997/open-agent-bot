import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderHub } from "../src/providers/hub.js";
import { LoginFlows } from "../src/providers/logins.js";
import { SessionStore } from "../src/session/sessionStore.js";
import { fakeFetch, json } from "./fixtures/fakeFetch.js";
import { MemoryProfileStore } from "../src/profile/store.js";
import { createRegistry } from "../src/sources/index.js";

const store = () =>
  new SessionStore({
    idleMs: 1000,
    create: async () => {
      throw new Error("unused");
    },
  });

describe("createApp", () => {
  it("serves health", async () => {
    const app = createApp({ cfg: loadConfig({ LLM_API_KEY: "k" }), store: store() });
    const res = await app.request("/health");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects /agui without shared secret when one is configured", async () => {
    const app = createApp({ cfg: loadConfig({ LLM_API_KEY: "k", AGENT_SHARED_SECRET: "s3" }), store: store() });
    const res = await app.request("/agui", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    expect(res.status).toBe(401);
  });

  it("rejects malformed run input with 400", async () => {
    const app = createApp({ cfg: loadConfig({ LLM_API_KEY: "k" }), store: store() });
    const res = await app.request("/agui", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    expect(res.status).toBe(400);
  });

  describe("models and providers", () => {
    const setup = async () => {
      const cfg = loadConfig({
        LLM_API_KEY: "k",
        AGENT_MODELS: "chat-default|chat-sonnet-5.5=Sonnet 5.5",
        AGENT_SHARED_SECRET: "s3",
      });
      const f = fakeFetch([[/host\.docker\.internal:11434\/v1\/models$/, () => json({ data: [{ id: "qwen3.5:35b" }] })]]);
      const hub = await ProviderHub.create({
        dataDir: mkdtempSync(join(tmpdir(), "app-")),
        litellm: { baseUrl: cfg.llmBaseUrl, apiKey: cfg.llmApiKey!, models: cfg.models },
        fetch: f,
      });
      const logins = new LoginFlows(async (_id, ui) => {
        ui.notify({ type: "auth_url", url: "https://auth.openai.com/authorize?x=1" });
        await ui.prompt({ type: "manual_code", message: "Paste the final redirect URL" });
      });
      const profiles = new MemoryProfileStore();
      const places = vi.fn(async (q: string) =>
        q === "555 Cali"
          ? [{ label: "555 California St, San Francisco", city: "San Francisco", country: "US", lat: 37.79, lon: -122.4 }]
          : [],
      );
      const app = createApp({
        cfg,
        store: store(),
        hub,
        logins,
        profiles,
        onboarding: { registry: createRegistry(), groceries: async () => null, places },
      });
      const call = (path: string, init: RequestInit = {}) =>
        app.request(path, { ...init, headers: { "x-agent-secret": "s3", "content-type": "application/json", ...(init.headers ?? {}) } });
      return { app, call, hub, profiles };
    };

    it("keeps every model and provider route behind the shared secret", async () => {
      const { app } = await setup();
      for (const [method, path] of [
        ["GET", "/models"],
        ["GET", "/providers"],
        ["POST", "/providers/groq/key"],
        ["DELETE", "/providers/groq"],
      ]) {
        expect((await app.request(path, { method })).status).toBe(401);
      }
    });

    it("lists the enabled models and reports the profile's model as the default, never a server default", async () => {
      const { call } = await setup();
      const models = [
        { id: "litellm/chat-default", label: "chat-default", provider: "LiteLLM gateway" },
        { id: "litellm/chat-sonnet-5.5", label: "Sonnet 5.5", provider: "LiteLLM gateway" },
      ];
      expect(await (await call("/models")).json()).toEqual({ default: null, models });
      await call("/profile", { method: "PUT", body: JSON.stringify({ profile: { defaultModel: "litellm/chat-sonnet-5.5" } }) });
      expect(await (await call("/models")).json()).toEqual({ default: "litellm/chat-sonnet-5.5", models });
      await call("/profile", { method: "PUT", body: JSON.stringify({ profile: { defaultModel: "groq/gone" } }) });
      expect(((await (await call("/models")).json()) as { default: string | null }).default).toBeNull();
    });

    it("keeps profile, settings, places and onboarding options behind the shared secret", async () => {
      const { app } = await setup();
      for (const [method, path] of [
        ["GET", "/profile"],
        ["PUT", "/profile"],
        ["GET", "/settings"],
        ["POST", "/settings/brave-search/key"],
        ["GET", "/places?q=555"],
        ["GET", "/onboarding/options"],
      ]) {
        expect((await app.request(path, { method })).status).toBe(401);
      }
    });

    it("saves the profile, rejects an invalid one with 400 and returns what was stored", async () => {
      const { call } = await setup();
      const saved = await call("/profile", { method: "PUT", body: JSON.stringify({ profile: { name: " Nitin ", food: ["Vegan"] } }) });
      expect(((await saved.json()) as { profile: { name: string } }).profile.name).toBe("Nitin");
      const bad = await call("/profile", { method: "PUT", body: JSON.stringify({ profile: { travel: { style: "jet" } } }) });
      expect(bad.status).toBe(400);
      expect(await (await call("/profile")).json()).toMatchObject({ profile: { name: "Nitin", food: ["Vegan"] } });
    });

    it("stores the Brave Search key with the other keys and only says whether it is set", async () => {
      const { call, hub } = await setup();
      expect(await (await call("/settings")).json()).toEqual({ braveSearch: false });
      await call("/settings/brave-search/key", { method: "POST", body: JSON.stringify({ apiKey: "brv-secret" }) });
      const body = await (await call("/settings")).text();
      expect(JSON.parse(body)).toEqual({ braveSearch: true });
      expect(body).not.toContain("brv-secret");
      expect(hub.secret("brave-search")).toBe("brv-secret");
      await call("/settings/brave-search", { method: "DELETE" });
      expect(hub.secret("brave-search")).toBeUndefined();
    });

    it("serves address suggestions and chip rows for onboarding", async () => {
      const { call } = await setup();
      expect(await (await call("/places?q=555%20Cali")).json()).toMatchObject({ places: [{ city: "San Francisco" }] });
      const opts = (await (await call("/onboarding/options?lat=37.79&lon=-122.4&country=us")).json()) as Record<string, any>;
      expect(opts).toMatchObject({ country: "US", currency: "USD", units: "imperial", airports: ["OAK", "SFO", "SJC"] });
      expect(opts.rows.sites).toContainEqual({ label: "Expedia", access: "linked" });
      expect(opts.rows.sites).toContainEqual({ label: "Airbnb", access: "searched" });
    });

    it("offers TypeSafe as a key-only provider for Jev", async () => {
      const { call } = await setup();
      const list = (await (await call("/providers")).json()) as { providers: Array<{ id: string; methods: string[]; note?: string }> };
      expect(list.providers.find((p) => p.id === "typesafe")).toMatchObject({ methods: ["api_key"], note: expect.stringMatching(/Jev/) });
      expect((await call("/providers/typesafe/key", { method: "POST", body: JSON.stringify({ apiKey: "ts-x" }) })).status).toBe(200);
    });

    it("saves a key without ever echoing it, then lists and enables that provider's models", async () => {
      const { call } = await setup();
      const saved = await call("/providers/groq/key", { method: "POST", body: JSON.stringify({ apiKey: "gsk-secret" }) });
      expect(saved.status).toBe(200);
      const body = JSON.stringify(await (await call("/providers")).json());
      expect(body).not.toContain("gsk-secret");
      expect(JSON.parse(body).providers.find((p: { id: string }) => p.id === "groq")).toMatchObject({ configured: true, source: "key" });
      const models = (await (await call("/providers/groq/models")).json()) as { models: Array<{ id: string }> };
      expect(models.models.length).toBeGreaterThan(0);
      const put = await call("/providers/groq/models", { method: "PUT", body: JSON.stringify({ enabled: [models.models[0].id] }) });
      expect(put.status).toBe(200);
      const all = (await (await call("/models")).json()) as { models: Array<{ id: string }> };
      expect(all.models.map((m) => m.id)).toContain(`groq/${models.models[0].id}`);
    });

    it("adds a local server and removes providers", async () => {
      const { call } = await setup();
      const added = await call("/providers/local", {
        method: "POST",
        body: JSON.stringify({ kind: "ollama", baseUrl: "http://host.docker.internal:11434/v1" }),
      });
      expect(await added.json()).toMatchObject({ provider: { id: "ollama", configured: true } });
      expect((await call("/providers/ollama", { method: "DELETE" })).status).toBe(200);
    });

    it("runs a sign-in as a flow the browser polls and answers", async () => {
      const { call } = await setup();
      const started = (await (await call("/providers/openai/login", { method: "POST" })).json()) as { flow: string };
      await new Promise((r) => setTimeout(r, 0));
      expect(await (await call(`/providers/logins/${started.flow}`)).json()).toMatchObject({
        status: "running",
        authUrl: "https://auth.openai.com/authorize?x=1",
        prompt: { message: "Paste the final redirect URL" },
      });
      const answered = await call(`/providers/logins/${started.flow}/answer`, {
        method: "POST",
        body: JSON.stringify({ value: "http://127.0.0.1:1455/auth/callback?code=c" }),
      });
      expect(answered.status).toBe(200);
      await new Promise((r) => setTimeout(r, 0));
      expect(await (await call(`/providers/logins/${started.flow}`)).json()).toMatchObject({ status: "done" });
      expect((await call("/providers/logins/unknown")).status).toBe(404);
    });

    it("refuses sign-in for providers without an allowed sign-in option", async () => {
      const { call } = await setup();
      const res = await call("/providers/anthropic/login", { method: "POST" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Anthropic has no sign-in option here" });
    });

    it("answers caller mistakes with 400, 404 or 409 and a readable message", async () => {
      const { call } = await setup();
      const res = await call("/providers/groq/key", { method: "POST", body: JSON.stringify({ apiKey: " " }) });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "the key is empty" });
      expect((await call("/providers/amazon-bedrock/key", { method: "POST", body: JSON.stringify({ apiKey: "x" }) })).status).toBe(404);
      const expired = "00000000-0000-0000-0000-000000000000";
      expect((await call(`/providers/logins/${expired}/answer`, { method: "POST", body: JSON.stringify({ value: "x" }) })).status).toBe(
        404,
      );
    });

    it("answers unexpected failures with a 500 that hides the internal message", async () => {
      const { call, hub } = await setup();
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(hub, "list").mockImplementation(() => {
        throw new Error("EACCES: /data/agent/providers.json");
      });
      const res = await call("/providers");
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Something went wrong on the agent. Check its logs." });
      quiet.mockRestore();
    });
  });
});
