import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Identity } from "../../src/identity/types.js";
import { StartupRefusal } from "../../src/local/refusal.js";
import { startLocal } from "../../src/local/start.js";
import {
  call,
  type LocalRoot,
  localEnv,
  localRoot,
  P,
  runInput,
  type StubModel,
  stream,
  stubModel,
  tcpServers,
  textDeltas,
  UI_INDEX,
  waitFor,
} from "./localHarness.js";

const OPENROUTER_KEY = `sk-or-v1-${"7".repeat(64)}`;
const RUN = "/api/copilotkit/agent/openagent/run";
const STOP = (thread: string) => `/api/copilotkit/agent/openagent/stop/${thread}`;

type Local = Awaited<ReturnType<typeof startLocal>>;

let quiet: Array<{ mockRestore(): void }> = [];
beforeEach(() => {
  quiet = [vi.spyOn(console, "log").mockImplementation(() => {}), vi.spyOn(console, "warn").mockImplementation(() => {})];
});
afterEach(() => {
  for (const q of quiet) q.mockRestore();
});

describe("startLocal end to end, in process", () => {
  let r: LocalRoot;
  let model: StubModel;
  let local: Local;
  let serversBefore: number;
  let serversAfterStart: number;

  beforeAll(async () => {
    r = localRoot();
    model = await stubModel();
    serversBefore = tcpServers();
    local = await startLocal(localEnv(r));
    serversAfterStart = tcpServers();
  });

  afterAll(async () => {
    await local?.close();
    await model?.close();
    r?.dispose();
  });

  it("listens on exactly one port, the front's", () => {
    expect(serversAfterStart - serversBefore).toBe(1);
    expect(local.port).toBeGreaterThan(0);
  });

  it("answers /health", async () => {
    const res = await call(local.port, "/health", { host: "127.0.0.1:3000" });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual({ ok: true, app: "open-agent", version: "dev", schema: 1 });
  });

  it("serves the UI build", async () => {
    const res = await call(local.port, "/chats");
    expect(res.status).toBe(200);
    expect(res.text).toBe(UI_INDEX);
  });

  it("refuses a foreign Host on pages and /api", async () => {
    expect((await call(local.port, "/", { host: "evil.example" })).status).toBe(421);
    expect((await call(local.port, "/api/chats", { host: `localhost:${P + 1}` })).status).toBe(421);
  });

  it("serves onboarding endpoints through /api", async () => {
    const options = await call(local.port, "/api/onboarding/options?country=US");
    expect(options.status).toBe(200);
    const saved = await call(local.port, "/api/profile", { method: "PUT", body: { profile: { name: "Local Lee" } } });
    expect(saved.status).toBe(200);
    const profile = await call(local.port, "/api/profile");
    expect(JSON.parse(profile.text)).toMatchObject({ profile: { name: "Local Lee" } });
  });

  it("refuses writes from other origins", async () => {
    const res = await call(local.port, "/api/profile", {
      method: "PUT",
      headers: { origin: "http://evil.example" },
      body: { profile: { name: "Pwned" } },
    });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.text)).toMatchObject({ error: "bad_origin" });
  });

  it("stores a model key as ciphertext", async () => {
    const res = await call(local.port, "/api/providers/openrouter/key", { method: "POST", body: { apiKey: OPENROUTER_KEY } });
    expect(res.status).toBe(200);
    const providers = JSON.parse((await call(local.port, "/api/providers")).text) as {
      providers: Array<{ id: string; configured: boolean }>;
    };
    expect(providers.providers.find((p) => p.id === "openrouter")).toMatchObject({ configured: true });
    const db = new DatabaseSync(join(r.data, "open-agent.db"), { readOnly: true });
    try {
      const rows = db.prepare("SELECT provider, ciphertext FROM provider_credentials").all() as Array<{
        provider: string;
        ciphertext: Uint8Array;
      }>;
      expect(rows.map((row) => row.provider)).toEqual(["openrouter"]);
      expect(Buffer.from(rows[0].ciphertext).toString("latin1")).not.toContain("7777777777");
    } finally {
      db.close();
    }
  });

  it("answers CopilotKit info through /api/copilotkit/info", async () => {
    const res = await call(local.port, "/api/copilotkit/info");
    expect(res.status).toBe(200);
    expect(res.text).toContain("openagent");
  });

  it("streams a run from a local model and Stop ends it", async () => {
    const added = await call(local.port, "/api/providers/local", { method: "POST", body: { kind: "custom", baseUrl: model.url } });
    expect(added.status, added.text).toBe(200);
    const thread = randomUUID();
    const run = await stream(local.port, RUN, {
      method: "POST",
      headers: { accept: "text/event-stream" },
      body: runInput(thread, "custom/stub"),
    });
    expect(run.status).toBe(200);
    expect(run.headers["content-type"]).toContain("text/event-stream");
    await waitFor(() => textDeltas(run.text()) >= 3);
    const stop = await call(local.port, STOP(thread), { method: "POST", headers: { accept: "application/json" } });
    expect(stop.status).toBeLessThan(300);
    await run.ended;
    await waitFor(() => model.open === 0);
    expect(model.aborted).toBeGreaterThanOrEqual(1);
    const count = textDeltas(run.text());
    expect(count).toBeLessThan(400);
    const chats = JSON.parse((await call(local.port, "/api/chats")).text) as { items: Array<{ id: string }> };
    expect(chats.items.map((c) => c.id)).toContain(thread);
  });

  it("keeps the run going after the browser disconnects, as hosted does, and Stop still ends it", async () => {
    const before = model.aborted;
    const thread = randomUUID();
    const run = await stream(local.port, RUN, {
      method: "POST",
      headers: { accept: "text/event-stream" },
      body: runInput(thread, "custom/stub"),
    });
    await waitFor(() => textDeltas(run.text()) >= 3);
    const seen = model.completions;
    run.disconnect();
    await run.ended;
    expect((await call(local.port, "/health")).status).toBe(200);
    expect(model.open).toBe(1);
    const stop = await call(local.port, STOP(thread), { method: "POST", headers: { accept: "application/json" } });
    expect(stop.status).toBeLessThan(300);
    await waitFor(() => model.aborted > before && model.open === 0);
    expect(model.completions).toBe(seen);
  });

  it("logs requests without queries or secrets", async () => {
    const lines: string[] = [];
    quiet[0].mockRestore();
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.join(" "));
    });
    try {
      await call(local.port, "/api/search?q=secret-word");
      await call(local.port, "/chats?x=hidden-query");
    } finally {
      spy.mockRestore();
    }
    expect(lines.filter((l) => l.startsWith("[http] "))).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^\[http\] GET \/api\/search 200 \d+ms$/),
        expect.stringMatching(/^\[http\] GET \/chats 200 \d+ms$/),
      ]),
    );
    const all = lines.join("\n");
    expect(all).not.toContain("secret-word");
    expect(all).not.toContain("hidden-query");
  });

  it("keeps keys and data files private, with no agent secret on disk", () => {
    expect(readdirSync(r.keys)).toEqual(["kek"]);
    expect(readdirSync(r.renderer)).toEqual(["secret"]);
    expect(readFileSync(join(r.renderer, "secret"), "utf8")).toMatch(/^[0-9a-f]{64}\n$/);
    expect(readdirSync(r.data).sort()).toEqual(["backups", "open-agent.db", "open-agent.db-shm", "open-agent.db-wal", "reports"]);
  });
});

describe("startLocal across a restart", () => {
  it("decrypts a saved key with the KEK file after close() and reopen", async () => {
    const r = localRoot();
    try {
      const first = await startLocal(localEnv(r));
      await call(first.port, "/api/providers/openrouter/key", { method: "POST", body: { apiKey: OPENROUTER_KEY } });
      await first.close();
      expect(existsSync(join(r.data, "open-agent.db-wal"))).toBe(false);
      const kek = readFileSync(join(r.keys, "kek"), "utf8");
      const second = await startLocal(localEnv(r));
      try {
        const providers = JSON.parse((await call(second.port, "/api/providers")).text) as {
          providers: Array<{ id: string; configured: boolean; hint?: string }>;
        };
        expect(providers.providers.find((p) => p.id === "openrouter")).toMatchObject({ configured: true });
        expect(readFileSync(join(r.keys, "kek"), "utf8")).toBe(kek);
      } finally {
        await second.close();
      }
    } finally {
      r.dispose();
    }
  });

  it("closes the front and the store on close(), leaving no listener", async () => {
    const r = localRoot();
    try {
      await waitFor(() => tcpServers() === 0, 5000);
      const before = tcpServers();
      const local = await startLocal(localEnv(r));
      expect(tcpServers()).toBe(before + 1);
      await local.close();
      await local.close();
      await waitFor(() => tcpServers() === before, 2000);
      expect(existsSync(join(r.data, "open-agent.db-wal"))).toBe(false);
      await expect(call(local.port, "/health")).rejects.toThrow();
    } finally {
      r.dispose();
    }
  });
});

describe("startLocal refusals in process", () => {
  let r: LocalRoot;
  beforeEach(() => {
    r = localRoot();
  });
  afterEach(() => r.dispose());

  async function refusal(promise: Promise<unknown>): Promise<StartupRefusal> {
    const err = await promise.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(StartupRefusal);
    return err as StartupRefusal;
  }

  it("refuses a hosted-kind identity", async () => {
    const hosted: Identity = {
      kind: "hosted",
      admitCaller: () => undefined,
      authenticate: async () => ({ ok: false, error: new Error("no") }),
    } as unknown as Identity;
    const before = tcpServers();
    const err = await refusal(startLocal(localEnv(r), { identity: () => hosted }));
    expect(err.code).toBe("identity");
    await waitFor(() => tcpServers() === before, 2000);
    expect(existsSync(join(r.data, "open-agent.db-wal"))).toBe(false);
  });

  it("refuses a missing UI build with ui_missing and closes the store", async () => {
    const ui = join(r.root, "no-ui");
    const err = await refusal(startLocal(localEnv(r, { OPEN_AGENT_UI_DIR: ui })));
    expect(err).toMatchObject({ code: "ui_missing", message: `UI build not found at ${ui}` });
    expect(existsSync(join(r.data, "open-agent.db-wal"))).toBe(false);
  });

  it("refuses a port that is already in use with listen and closes the store", async () => {
    const blocker = createServer();
    await new Promise<void>((ok) => blocker.listen(0, "127.0.0.1", () => ok()));
    try {
      const { port } = blocker.address() as AddressInfo;
      const err = await refusal(startLocal(localEnv(r, { OPEN_AGENT_LISTEN_PORT: String(port) })));
      expect(err.code).toBe("listen");
      expect(err.message).toContain(`127.0.0.1:${port}`);
      expect(err.message).toContain("EADDRINUSE");
      expect(existsSync(join(r.data, "open-agent.db-wal"))).toBe(false);
    } finally {
      await new Promise<void>((ok) => blocker.close(() => ok()));
    }
  });

  it("refuses hosted settings before touching the data directory", async () => {
    await expect(startLocal(localEnv(r, { SUPABASE_URL: "https://x.supabase.co" }))).rejects.toMatchObject({ name: "ConfigError" });
    expect(existsSync(r.data)).toBe(false);
  });
});

describe("the launch-token hook", () => {
  const TOKEN = "fedcba9876543210".repeat(4);
  let r: LocalRoot;
  let local: Local;

  beforeAll(async () => {
    r = localRoot();
    local = await startLocal(localEnv(r, { OPEN_AGENT_LAUNCH_TOKEN: TOKEN }));
  });
  afterAll(async () => {
    await local?.close();
    r?.dispose();
  });

  it("refuses /api without the cookie", async () => {
    const res = await call(local.port, "/api/chats");
    expect(res.status).toBe(401);
    expect(JSON.parse(res.text)).toMatchObject({ error: "launch_required" });
  });

  it("refuses a wrong cookie", async () => {
    const res = await call(local.port, "/api/chats", { headers: { cookie: `oa_launch=${"0".repeat(64)}` } });
    expect(res.status).toBe(401);
  });

  it("admits the cookie", async () => {
    const res = await call(local.port, "/api/chats", { headers: { cookie: `oa_launch=${TOKEN}` } });
    expect(res.status).toBe(200);
  });

  it("still serves pages", async () => {
    expect((await call(local.port, "/")).status).toBe(200);
  });
});

describe("the launch-token hook is off with an empty variable", () => {
  it("admits /api with OPEN_AGENT_LAUNCH_TOKEN empty", async () => {
    const r = localRoot();
    try {
      const local = await startLocal(localEnv(r, { OPEN_AGENT_LAUNCH_TOKEN: "" }));
      try {
        expect((await call(local.port, "/api/chats")).status).toBe(200);
      } finally {
        await local.close();
      }
    } finally {
      r.dispose();
    }
  });
});
