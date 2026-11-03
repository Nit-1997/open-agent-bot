import { describe, expect, it } from "vitest";
import { createAccessService } from "../../src/hosted/access/service.js";
import { BackgroundQueue } from "../../src/lib/backgroundQueue.js";
import { RateLimiter } from "../../src/lib/rateLimit.js";
import { makeApp } from "../fixtures/app.js";
import { ALICE } from "../fixtures/users.js";

const post = (h: Awaited<ReturnType<typeof makeApp>>, path: string, body: object) =>
  h.call(null, path, { method: "POST", body: JSON.stringify(body), headers: { "x-client-ip": "203.0.113.7, 10.0.0.1" } });

describe("public service routes", () => {
  it("answers 202 at once for every access request outcome, then records new requests", async () => {
    const h = await makeApp();
    const first = await post(h, "/access-requests", { name: "Dummy", email: "dummy@example.test", note: "hi", formToken: "f1" });
    const dup = await post(h, "/access-requests", { name: "Dummy", email: "dummy@example.test", note: "", formToken: "f2" });
    const member = await post(h, "/access-requests", { name: "Alice", email: ALICE.email, note: "", formToken: "f3" });
    for (const res of [first, dup, member]) {
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ ok: true });
    }
    await h.queue.idle();
    expect([...h.accounts.requests.values()].map((r) => r.email)).toEqual(["dummy@example.test"]);
  });

  it("answers 400 only for a malformed body", async () => {
    const h = await makeApp();
    expect((await post(h, "/access-requests", { name: "", email: "x", formToken: "f" })).status).toBe(400);
    expect((await post(h, "/access-requests", { name: "A", email: "a@example.test" })).status).toBe(400);
    expect((await post(h, "/auth/email-link", { email: "nope" })).status).toBe(400);
  });

  it("answers email links before the send finishes, whether or not the address has access", async () => {
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const sent: string[] = [];
    const queue = new BackgroundQueue({ name: "test", max: 10, concurrency: 1 });
    const access = createAccessService({
      pepper: Buffer.alloc(32, 1),
      limiter: new RateLimiter(),
      queue,
      submit: async () => "inserted",
      sendMagicLink: async (email) => {
        await slow;
        sent.push(email);
        return email === ALICE.email ? {} : { code: "otp_disabled" };
      },
    });
    const h = await makeApp({ access });
    for (const email of [ALICE.email, "stranger@example.test"]) {
      const res = await post(h, "/auth/email-link", { email });
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ ok: true });
    }
    expect(sent).toEqual([]);
    release();
    await queue.idle();
    expect(sent).toEqual([ALICE.email, "stranger@example.test"]);
  });
});
