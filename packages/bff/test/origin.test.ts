import { describe, expect, it, vi } from "vitest";
import { createBff } from "../src/index.ts";
import { deps, fakeAgent, request } from "./support.ts";

const LOCAL = "http://127.0.0.1:3000";

async function write(appOrigin: Parameters<typeof createBff>[0]["appOrigin"], origin: string | null) {
  const agent = fakeAgent();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin !== null) headers.origin = origin;
  const res = await createBff(deps({ appOrigin, fetch: agent.fetch }))(request("/api/profile", { method: "PUT", body: "{}", headers }));
  return { res, agent };
}

describe("appOrigin", () => {
  const shapes = () =>
    [
      ["a string", LOCAL],
      ["a list", [LOCAL, "http://localhost:3000"]],
      ["a predicate", vi.fn((o: string) => o === LOCAL)],
    ] as const;

  for (const [label, appOrigin] of shapes()) {
    it(`${label}: a missing Origin and Origin: null are refused before it is consulted`, async () => {
      for (const origin of [null, "null"]) {
        const { res, agent } = await write(appOrigin, origin);
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "bad_origin" });
        expect(agent.seen).toEqual([]);
      }
      if (typeof appOrigin === "function") expect(appOrigin).not.toHaveBeenCalled();
    });

    it(`${label}: the exact origin passes`, async () => {
      const { res, agent } = await write(appOrigin, LOCAL);
      expect(res.status).toBe(200);
      expect(agent.seen).toHaveLength(1);
    });
  }

  it.each([
    `${LOCAL}/`,
    "http://127.0.0.1:30000",
    "HTTP://127.0.0.1:3000",
    "http://127.0.0.1:3000.evil",
    "http://127.0.0.1",
    "https://127.0.0.1:3000",
  ])("a list refuses %j", async (origin) => {
    const { res, agent } = await write([LOCAL, "http://localhost:3000"], origin);
    expect(res.status).toBe(403);
    expect(agent.seen).toEqual([]);
  });

  it("a string matches exactly too", async () => {
    expect((await write(LOCAL, `${LOCAL}/`)).res.status).toBe(403);
    expect((await write(LOCAL, "HTTP://127.0.0.1:3000")).res.status).toBe(403);
  });

  it("the predicate sees only real origins", async () => {
    const predicate = vi.fn(() => false);
    expect((await write(predicate, "http://other.test")).res.status).toBe(403);
    expect(predicate).toHaveBeenCalledWith("http://other.test");
  });

  it("safe methods need no Origin", async () => {
    const agent = fakeAgent();
    const res = await createBff(deps({ appOrigin: LOCAL, fetch: agent.fetch }))(request("/api/profile"));
    expect(res.status).toBe(200);
  });
});
