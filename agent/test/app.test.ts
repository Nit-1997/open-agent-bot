import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderHub } from "../src/providers/hub.js";
import { LoginFlows } from "../src/providers/logins.js";
import { SessionStore } from "../src/session/sessionStore.js";
import { fakeFetch, json } from "./fixtures/fakeFetch.js";

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
        AGENT_MODEL: "chat-default",
        AGENT_MODELS: "chat-sonnet-5.5=Sonnet 5.5",
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
      const app = createApp({ cfg, store: store(), hub, logins });
      const call = (path: string, init: RequestInit = {}) =>
        app.request(path, { ...init, headers: { "x-agent-secret": "s3", "content-type": "application/json", ...(init.headers ?? {}) } });
      return { app, call };
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

    it("lists the enabled models by provider/model reference with the default", async () => {
      const { call } = await setup();
      expect(await (await call("/models")).json()).toEqual({
        default: "litellm/chat-default",
        models: [
          { id: "litellm/chat-default", label: "chat-default", provider: "LiteLLM gateway" },
          { id: "litellm/chat-sonnet-5.5", label: "Sonnet 5.5", provider: "LiteLLM gateway" },
        ],
      });
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

    it("turns bad requests into readable 400s", async () => {
      const { call } = await setup();
      const res = await call("/providers/groq/key", { method: "POST", body: JSON.stringify({ apiKey: " " }) });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "the key is empty" });
      expect((await call("/providers/amazon-bedrock/key", { method: "POST", body: JSON.stringify({ apiKey: "x" }) })).status).toBe(400);
    });
  });
});
