import { describe, expect, it, vi } from "vitest";
import { type AuthOutcome, createBff } from "../src/index.ts";
import { deps, fakeAgent, localAuth, signedIn } from "./support.ts";

const ORIGIN = "http://127.0.0.1:3000";
const LOCAL = { appOrigin: [ORIGIN, "http://localhost:3000"], allowedHosts: ["127.0.0.1:3000", "localhost:3000"] };

function req(host: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (host === null) headers.delete("host");
  else headers.set("host", host);
  return new Request(`${ORIGIN}/api/models`, { ...init, headers });
}

describe("allowedHosts (local-style config)", () => {
  it.each(["evil.example", "127.0.0.1:3000.evil.example", "127.0.0.1", "127.0.0.1:3001", "localhost"])(
    "Host %s → 421 before auth",
    async (host) => {
      const auth = vi.fn(signedIn);
      const agent = fakeAgent();
      const res = await createBff(deps({ ...LOCAL, auth, fetch: agent.fetch }))(req(host));
      expect(res.status).toBe(421);
      expect(await res.json()).toMatchObject({ error: "misdirected" });
      expect(auth).not.toHaveBeenCalled();
      expect(agent.seen).toEqual([]);
    },
  );

  it("a missing Host → 421 before auth", async () => {
    const auth = vi.fn(signedIn);
    const res = await createBff(deps({ ...LOCAL, auth, fetch: fakeAgent().fetch }))(req(null));
    expect(res.status).toBe(421);
    expect(auth).not.toHaveBeenCalled();
  });

  it.each(["127.0.0.1:3000", "localhost:3000", "LOCALHOST:3000"])("Host %s passes", async (host) => {
    const agent = fakeAgent();
    const res = await createBff(deps({ ...LOCAL, fetch: agent.fetch }))(req(host));
    expect(res.status).toBe(200);
    expect(agent.seen).toHaveLength(1);
  });

  it("hosted (allowedHosts unset) runs no Host check", async () => {
    const agent = fakeAgent();
    const res = await createBff(deps({ fetch: agent.fetch }))(req("evil.example"));
    expect(res.status).toBe(200);
  });

  it("refuses an empty allowedHosts entry list item", () => {
    expect(() => createBff(deps({ allowedHosts: [""] }))).toThrow();
  });
});

describe("sample localAuth (the shape M3 uses)", () => {
  const bff = (auth: (r: Request) => Promise<AuthOutcome>) => createBff(deps({ ...LOCAL, auth, fetch: fakeAgent().fetch }));

  it("refuses an unsafe method with Sec-Fetch-Site: cross-site", async () => {
    const res = await bff(localAuth("secret"))(
      new Request(`${ORIGIN}/api/profile`, {
        method: "PUT",
        body: "{}",
        headers: { host: "127.0.0.1:3000", origin: ORIGIN, "sec-fetch-site": "cross-site" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("accepts same-origin writes and sends only the per-install secret", async () => {
    const agent = fakeAgent();
    const handler = createBff(deps({ ...LOCAL, auth: localAuth("secret"), fetch: agent.fetch }));
    const res = await handler(
      new Request(`${ORIGIN}/api/profile`, {
        method: "PUT",
        body: "{}",
        headers: { host: "127.0.0.1:3000", origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(200);
    expect([...agent.seen[0].headers.keys()].sort()).toEqual(["content-type", "x-agent-secret"]);
  });
});
