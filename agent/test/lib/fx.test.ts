import { describe, expect, it } from "vitest";
import { createFx } from "../../src/lib/fx.js";
import { fakeFetch, json } from "../fixtures/fakeFetch.js";

const rates = () => json({ amount: 1, base: "EUR", date: "2026-10-29", rates: { USD: 1.1, GBP: 0.85 } });

describe("fx", () => {
  it("reads ECB rates from frankfurter and returns one", async () => {
    const f = fakeFetch([[/frankfurter/, rates]]);
    const fx = createFx({ fetch: f });
    expect(await fx("EUR", "USD")).toBe(1.1);
    expect(f.calls[0]).toBe("https://api.frankfurter.app/latest?from=EUR");
  });

  it("returns 1 for the same currency without a request", async () => {
    const f = fakeFetch([]);
    expect(await createFx({ fetch: f })("eur", "EUR")).toBe(1);
    expect(f.calls).toHaveLength(0);
  });

  it("caches a base for 24 hours and refetches after", async () => {
    let t = 0;
    const f = fakeFetch([[/frankfurter/, rates]]);
    const fx = createFx({ fetch: f, now: () => t });
    await fx("EUR", "USD");
    await fx("EUR", "GBP");
    t = 86_400_000 - 1;
    await fx("EUR", "USD");
    expect(f.calls).toHaveLength(1);
    t = 86_400_000;
    await fx("EUR", "USD");
    expect(f.calls).toHaveLength(2);
  });

  it("shares one request between concurrent callers", async () => {
    const f = fakeFetch([[/frankfurter/, rates]]);
    const fx = createFx({ fetch: f });
    await Promise.all([fx("EUR", "USD"), fx("EUR", "GBP")]);
    expect(f.calls).toHaveLength(1);
  });

  it("returns null on an HTTP error, a bad body, an unknown currency, or a hang", async () => {
    const log: string[] = [];
    expect(
      await createFx({ fetch: fakeFetch([[/frankfurter/, () => new Response("no", { status: 500 })]]), log: (l) => log.push(l) })(
        "EUR",
        "USD",
      ),
    ).toBeNull();
    expect(log[0]).toContain("HTTP 500");
    expect(await createFx({ fetch: fakeFetch([[/frankfurter/, () => json({ rates: {} })]]), log: () => {} })("EUR", "USD")).toBeNull();
    expect(await createFx({ fetch: fakeFetch([[/frankfurter/, rates]]) })("EUR", "XXX")).toBeNull();
    const hang = ((_: unknown, init?: RequestInit) =>
      new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("timeout"))))) as typeof fetch;
    expect(await createFx({ fetch: hang, timeoutMs: 20, log: () => {} })("EUR", "USD")).toBeNull();
  });

  it("does not cache a failure", async () => {
    let fail = true;
    const f = fakeFetch([[/frankfurter/, () => (fail ? new Response("no", { status: 503 }) : rates())]]);
    const fx = createFx({ fetch: f, log: () => {} });
    expect(await fx("EUR", "USD")).toBeNull();
    fail = false;
    expect(await fx("EUR", "USD")).toBe(1.1);
  });
});
