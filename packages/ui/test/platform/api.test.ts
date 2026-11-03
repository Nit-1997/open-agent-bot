import { afterEach, describe, expect, it, vi } from "vitest";
import { api, configureApi, createApiClient, resetApiForTests } from "../../src/platform/api.ts";

afterEach(() => {
  resetApiForTests();
  vi.unstubAllGlobals();
});

const UNSAFE = ["//evil.example/x", "/\\evil.example", "/a\\b", "/ok/..\\x"] as const;

describe("createApiClient", () => {
  it("prefixes url and fetch with the base URL", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("ok"));
    const client = createApiClient({ baseUrl: "http://127.0.0.1:18300/api", fetch });
    expect(client.url("/artifacts/r1?format=pdf")).toBe("http://127.0.0.1:18300/api/artifacts/r1?format=pdf");
    await client.fetch("/chats?page=2");
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:18300/api/chats?page=2");
  });

  it("passes init through unchanged and adds no cache option", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("ok"));
    const client = createApiClient({ baseUrl: "/api", fetch });
    const init: RequestInit = { method: "DELETE" };
    await client.fetch("/settings/brave-search", init);
    expect(fetch).toHaveBeenCalledWith("/api/settings/brave-search", init);
    expect(fetch.mock.calls[0][1]).toBe(init);
    expect(init).toEqual({ method: "DELETE" });
  });

  it("uses the global fetch at call time when none is injected", async () => {
    const client = createApiClient({ baseUrl: "/api" });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetch);
    await client.fetch("/models", { cache: "no-store" });
    expect(fetch).toHaveBeenCalledWith("/api/models", { cache: "no-store" });
  });

  it.each(UNSAFE)("refuses %s for url and fetch without calling fetch", async (path) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("ok"));
    const client = createApiClient({ baseUrl: "/api", fetch });
    expect(() => client.url(path as `/${string}`)).toThrow(TypeError);
    await expect(async () => client.fetch(path as `/${string}`)).rejects.toThrow(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("api singleton", () => {
  it("defaults to /api", () => {
    expect(api().url("/chats")).toBe("/api/chats");
  });

  it("uses the configured client", () => {
    configureApi(createApiClient({ baseUrl: "http://127.0.0.1:18300/api" }));
    expect(api().url("/chats")).toBe("http://127.0.0.1:18300/api/chats");
  });

  it("accepts the same base again and refuses a different one", () => {
    configureApi(createApiClient({ baseUrl: "/api" }));
    configureApi(createApiClient({ baseUrl: "/api" }));
    expect(() => configureApi(createApiClient({ baseUrl: "/other" }))).toThrow();
    expect(api().url("/x")).toBe("/api/x");
  });
});
