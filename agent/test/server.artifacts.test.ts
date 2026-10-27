import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { ArtifactStore } from "../src/artifacts/store.js";
import { loadConfig } from "../src/config.js";
import { SessionStore } from "../src/session/sessionStore.js";

let dir: string;
let artifacts: ArtifactStore;
let app: ReturnType<typeof createApp>;
let id: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "artifacts-"));
  artifacts = new ArtifactStore(dir);
  ({ id } = await artifacts.save("Diwali Plan!", "<html><body><h1>Plan</h1></body></html>"));
  const store = new SessionStore({ idleMs: 1000, create: async () => { throw new Error("unused"); } });
  app = createApp({ cfg: loadConfig({ LLM_API_KEY: "k" }), store, artifacts });
});
afterAll(async () => {
  await artifacts.close();
  await rm(dir, { recursive: true, force: true });
});

describe("artifact routes", () => {
  it("artifact route sets sandbox CSP", async () => {
    const res = await app.request(`/artifacts/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe("sandbox allow-scripts");
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toContain("<h1>Plan</h1>");
  });

  it("returns 404 for unknown artifact", async () => {
    expect((await app.request("/artifacts/abcdefghijkl")).status).toBe(404);
  });

  it("pdf route returns application/pdf", async () => {
    const res = await app.request(`/artifacts/${id}.pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="diwali-plan.pdf"');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
  }, 60000);
});
