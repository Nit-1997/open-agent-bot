import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { SessionStore } from "../src/session/sessionStore.js";

const store = () => new SessionStore({ idleMs: 1000, create: async () => { throw new Error("unused"); } });

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

  it("lists the models users can pick, behind the shared secret", async () => {
    const cfg = loadConfig({ LLM_API_KEY: "k", AGENT_MODEL: "chat-default", AGENT_MODELS: "chat-sonnet-5.5=Sonnet 5.5", AGENT_SHARED_SECRET: "s3" });
    const app = createApp({ cfg, store: store() });
    expect((await app.request("/models")).status).toBe(401);
    const res = await app.request("/models", { headers: { "x-agent-secret": "s3" } });
    expect(await res.json()).toEqual({
      default: "chat-default",
      models: [
        { id: "chat-default", label: "chat-default" },
        { id: "chat-sonnet-5.5", label: "Sonnet 5.5" },
      ],
    });
  });
});
