import { describe, expect, it } from "vitest";
import { makeApp } from "../fixtures/app.js";
import { ALICE } from "../fixtures/users.js";

const post = (h: Awaited<ReturnType<typeof makeApp>>, path: string, body: object) =>
  h.call(null, path, { method: "POST", body: JSON.stringify(body), headers: { "x-client-ip": "203.0.113.7, 10.0.0.1" } });

describe("public service routes", () => {
  it("answers 202 for every access request outcome, padded to the floor", async () => {
    const h = await makeApp();
    const started = Date.now();
    const first = await post(h, "/access-requests", { name: "Dummy", email: "dummy@example.test", note: "hi" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(290);
    const dup = await post(h, "/access-requests", { name: "Dummy", email: "dummy@example.test", note: "" });
    const member = await post(h, "/access-requests", { name: "Alice", email: ALICE.email, note: "" });
    for (const res of [first, dup, member]) {
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ ok: true });
    }
    expect([...h.accounts.requests.values()].map((r) => r.email)).toEqual(["dummy@example.test"]);
  });

  it("answers 400 only for a malformed body", async () => {
    const h = await makeApp();
    expect((await post(h, "/access-requests", { name: "", email: "x" })).status).toBe(400);
    expect((await post(h, "/auth/email-link", { email: "nope" })).status).toBe(400);
  });

  it("answers 202 for email links whether or not the address has access", async () => {
    const h = await makeApp();
    for (const email of [ALICE.email, "stranger@example.test"]) {
      const res = await post(h, "/auth/email-link", { email });
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ ok: true });
    }
  });
});
