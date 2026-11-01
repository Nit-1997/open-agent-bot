import { describe, expect, it, vi } from "vitest";
import { LoginFlows } from "../src/providers/logins.js";
import { createRegistry } from "../src/sources/index.js";
import { makeApp } from "./fixtures/app.js";
import { fakeFetch, json } from "./fixtures/fakeFetch.js";
import { ADMIN, ALICE, BOB, CHAT_1 } from "./fixtures/users.js";

const USER_ROUTES: Array<[string, string]> = [
  ["POST", "/agui"],
  ["GET", "/chats"],
  ["GET", `/chats/${CHAT_1}/messages`],
  ["GET", "/profile"],
  ["PUT", "/profile"],
  ["GET", "/settings"],
  ["POST", "/settings/brave-search/key"],
  ["GET", "/places?q=555"],
  ["GET", "/onboarding/options"],
  ["GET", "/models"],
  ["GET", "/providers"],
  ["POST", "/providers/groq/key"],
  ["DELETE", "/providers/groq"],
  ["GET", "/artifacts/abcdefghijkl"],
];

describe("createApp guards", () => {
  it("serves health without any secret", async () => {
    const { call } = await makeApp();
    const res = await call(null, "/health", { secret: null });
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects every other route without the service secret before looking at the token", async () => {
    const { call } = await makeApp();
    for (const [method, path] of [...USER_ROUTES, ["POST", "/access-requests"], ["POST", "/auth/email-link"], ["GET", "/admin/users"]]) {
      for (const secret of [null, "b".repeat(64)]) {
        const res = await call(ALICE, path, { method, secret });
        expect(res.status, `${method} ${path}`).toBe(401);
        expect(await res.json()).toEqual({ error: "unauthorized" });
      }
    }
  });

  it("answers signed_out with a bearer challenge when the token is missing or wrong", async () => {
    const { call } = await makeApp();
    for (const [method, path] of USER_ROUTES) {
      const res = await call(null, path, { method });
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe('Bearer error="invalid_token"');
      expect(await res.json()).toMatchObject({ error: "signed_out" });
    }
    expect((await call(null, "/profile", { headers: { authorization: "Bearer nope" } })).status).toBe(401);
  });

  it("refuses a deactivated user with 403 account_disabled", async () => {
    const { call, accounts } = await makeApp();
    accounts.users.get(ALICE.id)!.status = "deactivated";
    const res = await call(ALICE, "/profile");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "account_disabled" });
  });

  it("fails closed with 503 when the status lookup is down", async () => {
    const { call, accounts } = await makeApp();
    vi.spyOn(accounts, "repo").mockImplementation(() => {
      throw new Error("db down");
    });
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await call(BOB, "/profile");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "auth_unavailable" });
    quiet.mockRestore();
  });

  it("hides admin routes from non-admins behind a 404", async () => {
    const { call } = await makeApp();
    for (const path of ["/admin/users", "/admin/access-requests"]) {
      const res = await call(ALICE, path);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: "not_found" });
    }
    expect((await call(ADMIN, "/admin/users")).status).toBe(200);
  });

  it("answers OPTIONS with 405 and sends no CORS headers", async () => {
    const { call } = await makeApp();
    const res = await call(null, "/profile", { method: "OPTIONS", secret: null });
    expect(res.status).toBe(405);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects a non-uuid thread id and malformed run input with 400", async () => {
    const { call } = await makeApp();
    expect((await call(ALICE, "/agui", { method: "POST", body: "{}" })).status).toBe(400);
    const bad = await call(ALICE, "/agui", { method: "POST", body: JSON.stringify({ threadId: "t1", runId: "r", messages: [] }) });
    expect(bad.status).toBe(400);
  });
});

describe("per-user data", () => {
  it("keeps each user's profile separate", async () => {
    const { call } = await makeApp();
    await call(ALICE, "/profile", { method: "PUT", body: JSON.stringify({ profile: { name: "Alice" } }) });
    expect(await (await call(ALICE, "/profile")).json()).toMatchObject({ profile: { name: "Alice" } });
    expect(((await (await call(BOB, "/profile")).json()) as { profile: { name?: string } }).profile.name).toBeUndefined();
  });

  it("saves the profile, rejects an invalid one with 400 and returns what was stored", async () => {
    const { call } = await makeApp();
    const saved = await call(ALICE, "/profile", { method: "PUT", body: JSON.stringify({ profile: { name: " Nitin ", food: ["Vegan"] } }) });
    expect(((await saved.json()) as { profile: { name: string } }).profile.name).toBe("Nitin");
    const bad = await call(ALICE, "/profile", { method: "PUT", body: JSON.stringify({ profile: { travel: { style: "jet" } } }) });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid", message: "that profile isn't valid" });
  });

  it("stores a key encrypted, shows only a hint, and never shares it with another user", async () => {
    const { call, db } = await makeApp();
    const key = "gsk_secretsecretsecretsecret9f3a";
    expect((await call(ALICE, "/providers/groq/key", { method: "POST", body: JSON.stringify({ apiKey: key }) })).status).toBe(200);
    const body = await (await call(ALICE, "/providers")).text();
    expect(body).not.toContain(key);
    expect(JSON.parse(body).providers.find((p: { id: string }) => p.id === "groq")).toMatchObject({
      configured: true,
      source: "key",
      hint: "gsk_…9f3a",
    });
    const stored = [...db.credentials.values()][0];
    expect(stored.ciphertext.toString("utf8")).not.toContain("secretsecret");
    const bob = (await (await call(BOB, "/providers")).json()) as { providers: Array<{ id: string; configured: boolean }> };
    expect(bob.providers.find((p) => p.id === "groq")?.configured).toBe(false);
  });

  it("enables a provider's models and offers them in /models, with the profile's model as default", async () => {
    const { call } = await makeApp();
    await call(ALICE, "/providers/groq/key", { method: "POST", body: JSON.stringify({ apiKey: "gsk_0123456789abcdefghij" }) });
    const models = (await (await call(ALICE, "/providers/groq/models")).json()) as { models: Array<{ id: string }> };
    const first = `groq/${models.models[0].id}`;
    await call(ALICE, "/providers/groq/models", { method: "PUT", body: JSON.stringify({ enabled: [models.models[0].id] }) });
    expect((await (await call(ALICE, "/models")).json()) as object).toMatchObject({ default: null, models: [{ id: first }] });
    await call(ALICE, "/profile", { method: "PUT", body: JSON.stringify({ profile: { defaultModel: first } }) });
    expect(await (await call(ALICE, "/models")).json()).toMatchObject({ default: first });
  });

  it("stores the Brave Search key and only reports whether it is set", async () => {
    const { call } = await makeApp();
    expect(await (await call(ALICE, "/settings")).json()).toEqual({ braveSearch: false });
    await call(ALICE, "/settings/brave-search/key", { method: "POST", body: JSON.stringify({ apiKey: "BSAbravebravebravebrave77" }) });
    const body = await (await call(ALICE, "/settings")).text();
    expect(JSON.parse(body)).toEqual({ braveSearch: true, braveSearchHint: "…ve77" });
    expect(body).not.toContain("BSAbrave");
    expect(await (await call(BOB, "/settings")).json()).toEqual({ braveSearch: false });
    await call(ALICE, "/settings/brave-search", { method: "DELETE" });
    expect(await (await call(ALICE, "/settings")).json()).toEqual({ braveSearch: false });
  });

  it("refuses private local servers for invited users but lets the admin add them", async () => {
    const f = fakeFetch([[/host\.docker\.internal:11434\/v1\/models$/, () => json({ data: [{ id: "qwen3.5:35b" }] })]]);
    const { call } = await makeApp({ fetch: f });
    const body = JSON.stringify({ kind: "ollama", baseUrl: "http://host.docker.internal:11434/v1" });
    const refused = await call(ALICE, "/providers/local", { method: "POST", body });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ error: "invalid", message: "That address isn't reachable from the server." });
    const added = await call(ADMIN, "/providers/local", { method: "POST", body });
    expect(await added.json()).toMatchObject({ provider: { id: "ollama", configured: true } });
    expect((await call(ADMIN, "/providers/ollama", { method: "DELETE" })).status).toBe(200);
  });

  it("serves address suggestions and chip rows for onboarding", async () => {
    const places = vi.fn(async () => [
      { label: "555 California St, San Francisco", city: "San Francisco", country: "US", lat: 37.79, lon: -122.4 },
    ]);
    const { call } = await makeApp({ onboarding: { registry: createRegistry(), groceries: async () => null, places } });
    expect(await (await call(ALICE, "/places?q=555%20Cali")).json()).toMatchObject({ places: [{ city: "San Francisco" }] });
    const opts = (await (await call(ALICE, "/onboarding/options?lat=37.79&lon=-122.4&country=us")).json()) as Record<string, any>;
    expect(opts).toMatchObject({ country: "US", currency: "USD", units: "imperial" });
  });

  it("answers caller mistakes with a code and a readable message", async () => {
    const { call } = await makeApp();
    const res = await call(ALICE, "/providers/groq/key", { method: "POST", body: JSON.stringify({ apiKey: " " }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid", message: "the key is empty" });
    expect((await call(ALICE, "/providers/amazon-bedrock/key", { method: "POST", body: JSON.stringify({ apiKey: "x" }) })).status).toBe(
      404,
    );
    const anthropic = await call(ALICE, "/providers/anthropic/login", { method: "POST" });
    expect(await anthropic.json()).toEqual({ error: "invalid", message: "Anthropic has no sign-in option here" });
  });

  it("answers unexpected failures with a 500 that hides the internal message", async () => {
    const { call, hubs } = await makeApp();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(hubs, "get").mockRejectedValue(new Error("EACCES secret details"));
    const res = await call(ALICE, "/providers");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal", message: "Something went wrong on the agent. Check its logs." });
    quiet.mockRestore();
  });
});

describe("provider sign-in flows", () => {
  const flows = () =>
    new LoginFlows(async (_user, _id, ui) => {
      ui.notify({ type: "auth_url", url: "https://auth.openai.com/authorize?x=1" });
      await ui.prompt({ type: "manual_code", message: "Paste the final redirect URL" });
    });

  it("runs a sign-in the browser polls and answers, visible only to its owner", async () => {
    const { call } = await makeApp({ logins: flows() });
    const { flow } = (await (await call(ALICE, "/providers/openai/login", { method: "POST" })).json()) as { flow: string };
    await new Promise((r) => setTimeout(r, 0));
    expect(await (await call(ALICE, `/providers/logins/${flow}`)).json()).toMatchObject({
      status: "running",
      prompt: { message: "Paste the final redirect URL" },
    });
    expect((await call(BOB, `/providers/logins/${flow}`)).status).toBe(404);
    expect((await call(BOB, `/providers/logins/${flow}/answer`, { method: "POST", body: JSON.stringify({ value: "x" }) })).status).toBe(
      404,
    );
    const answered = await call(ALICE, `/providers/logins/${flow}/answer`, {
      method: "POST",
      body: JSON.stringify({ value: "http://localhost:1455/auth/callback?code=c" }),
    });
    expect(answered.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(await (await call(ALICE, `/providers/logins/${flow}`)).json()).toMatchObject({ status: "done" });
  });

  it("allows one ChatGPT sign-in per agent process", async () => {
    const { call } = await makeApp({ logins: flows() });
    expect((await call(ALICE, "/providers/openai/login", { method: "POST" })).status).toBe(200);
    const busy = await call(BOB, "/providers/openai/login", { method: "POST" });
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ error: "login_busy" });
  });
});

describe("rate limits", () => {
  it("answers 429 with Retry-After once a user goes over the key limit, without affecting others", async () => {
    const { call } = await makeApp();
    for (let i = 0; i < 20; i++) await call(ALICE, "/providers/groq", { method: "DELETE" });
    const res = await call(ALICE, "/providers/groq", { method: "DELETE" });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await res.json()).toMatchObject({ error: "rate_limited", retryAfter: expect.any(Number) });
    expect((await call(BOB, "/providers/groq", { method: "DELETE" })).status).toBe(200);
  });
});
