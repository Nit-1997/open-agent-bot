import { describe, expect, it } from "vitest";
import { makeApp } from "../fixtures/app.js";
import { fakeFetch, json } from "../fixtures/fakeFetch.js";
import { GATEWAY, PRIVATE_TARGET, PRIVATE_URLS } from "../fixtures/privateUrls.js";
import { ADMIN, ALICE } from "../fixtures/users.js";

type Providers = { providers: Array<{ id: string }> };
type Models = { models: Array<{ id: string }> };

async function harness() {
  const f = fakeFetch([[/\/models$/, () => json({ data: [{ id: "m1" }] })]]);
  const h = await makeApp({ fetch: f, gateway: GATEWAY });
  return { ...h, calls: f.calls };
}

const touchedGateway = (calls: string[]) => calls.some((u) => u.startsWith(GATEWAY.baseUrl.replace(/\/v1$/, "")));

describe("provider routes for a user with no capabilities", () => {
  for (const baseUrl of PRIVATE_URLS) {
    it(`POST /providers/local refuses ${baseUrl}`, async () => {
      const { call, calls } = await harness();
      const res = await call(ALICE, "/providers/local", { method: "POST", body: JSON.stringify({ kind: "custom", baseUrl }) });
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: "invalid", message: PRIVATE_TARGET });
      expect(calls).toEqual([]);
    });
  }

  it("lists no gateway in /providers or /models and never contacts it", async () => {
    const { call, calls } = await harness();
    const providers = (await (await call(ALICE, "/providers")).json()) as Providers;
    expect(providers.providers.map((p) => p.id)).not.toContain("litellm");
    const models = (await (await call(ALICE, "/models")).json()) as Models;
    expect(models.models.some((m) => m.id.startsWith("litellm/"))).toBe(false);
    expect(touchedGateway(calls)).toBe(false);
  });

  it("cannot test a gateway model", async () => {
    const { call, calls } = await harness();
    const res = await call(ALICE, "/providers/test", { method: "POST", body: JSON.stringify({ model: "litellm/chat-default" }) });
    expect(await res.json()).toMatchObject({ ok: false });
    expect(touchedGateway(calls)).toBe(false);
  });
});

describe("provider routes for the admin", () => {
  it("lists the gateway in /providers", async () => {
    const { call } = await harness();
    const providers = (await (await call(ADMIN, "/providers")).json()) as Providers;
    expect(providers.providers.map((p) => p.id)).toContain("litellm");
  });
});
