import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { remoteRenderer } from "../../src/artifacts/remoteRenderer.js";
import { MAX_RENDER_BYTES, createRendererServer, forbiddenEnv } from "../../src/renderer/server.js";

const SECRET = "c".repeat(64);
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

async function start(engine: { pdf: (html: string) => Promise<Buffer>; thumb: (html: string) => Promise<Buffer> }) {
  const server = createRendererServer({ secret: SECRET, engine });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const fake = () => ({
  pdf: vi.fn(async (html: string) => Buffer.from(`%PDF ${html}`)),
  thumb: vi.fn(async (html: string) => Buffer.from(`JPG ${html}`)),
});

describe("renderer server", () => {
  it("answers the health check without a secret", async () => {
    const url = await start(fake());
    expect((await fetch(`${url}/health`)).status).toBe(200);
  });

  it("refuses a missing or wrong secret before rendering", async () => {
    const engine = fake();
    const url = await start(engine);
    const none = await fetch(`${url}/render/pdf`, { method: "POST", body: "<p/>" });
    const wrong = await fetch(`${url}/render/pdf`, {
      method: "POST",
      body: "<p/>",
      headers: { authorization: `Bearer ${"d".repeat(64)}` },
    });
    expect([none.status, wrong.status]).toEqual([401, 401]);
    expect(engine.pdf).not.toHaveBeenCalled();
  });

  it("renders through the agent's client and returns the bytes", async () => {
    const url = await start(fake());
    const client = remoteRenderer({ url, secret: SECRET });
    const signal = new AbortController().signal;
    expect((await client.pdf("<h1>Lisbon</h1>", signal)).toString()).toBe("%PDF <h1>Lisbon</h1>");
    expect((await client.thumb("<h1>ü</h1>", signal)).toString()).toBe("JPG <h1>ü</h1>");
  });

  it("refuses a body over the limit, an unknown path and other methods", async () => {
    const engine = fake();
    const url = await start(engine);
    const auth = { authorization: `Bearer ${SECRET}` };
    expect((await fetch(`${url}/render/pdf`, { method: "POST", body: "x".repeat(MAX_RENDER_BYTES + 1), headers: auth })).status).toBe(413);
    expect((await fetch(`${url}/render/png`, { method: "POST", body: "<p/>", headers: auth })).status).toBe(404);
    expect((await fetch(`${url}/render/pdf`, { headers: auth })).status).toBe(404);
    expect(engine.pdf).not.toHaveBeenCalled();
  });

  it("hides the render error from the caller and the client reports the status", async () => {
    const url = await start({ ...fake(), pdf: async () => Promise.reject(new Error("/secret/path exploded")) });
    const res = await fetch(`${url}/render/pdf`, { method: "POST", body: "<p/>", headers: { authorization: `Bearer ${SECRET}` } });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret");
    await expect(remoteRenderer({ url, secret: SECRET }).pdf("<p/>", new AbortController().signal)).rejects.toThrow(/500/);
  });

  it("runs two renders at a time", async () => {
    const gates: ReturnType<typeof deferred>[] = [];
    const started: string[] = [];
    const engine = {
      ...fake(),
      thumb: async (html: string) => {
        started.push(html);
        const g = deferred();
        gates.push(g);
        await g.promise;
        return Buffer.from(html);
      },
    };
    const url = await start(engine);
    const client = remoteRenderer({ url, secret: SECRET });
    const signal = new AbortController().signal;
    const all = ["a", "b", "c"].map((h) => client.thumb(h, signal));
    await vi.waitFor(() => expect(started).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(started).toHaveLength(2);
    gates[0].resolve();
    await vi.waitFor(() => expect(started).toHaveLength(3));
    for (const g of gates) g.resolve();
    expect((await Promise.all(all)).map(String)).toEqual(["a", "b", "c"]);
  });

  it("lets the agent abort a request", async () => {
    const url = await start({ ...fake(), pdf: () => new Promise<Buffer>(() => {}) });
    const abort = new AbortController();
    const pending = remoteRenderer({ url, secret: SECRET }).pdf("<p/>", abort.signal);
    abort.abort();
    await expect(pending).rejects.toThrow();
  });

  it("names agent secrets found in its environment without their values", () => {
    expect(forbiddenEnv({ RENDERER_SECRET: SECRET, PATH: "/bin" })).toEqual([]);
    expect(
      forbiddenEnv({ SUPABASE_SECRET_KEY: "sb_secret_x", CREDENTIAL_KEYS: "v1:x", OPENAI_API_KEY: "sk-x", AGENT_SERVICE_SECRET: "y" }),
    ).toEqual(["AGENT_SERVICE_SECRET", "CREDENTIAL_KEYS", "OPENAI_API_KEY", "SUPABASE_SECRET_KEY"]);
  });
});
