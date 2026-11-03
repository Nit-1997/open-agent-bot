import { describe, expect, it, vi } from "vitest";
import type { BrowserContext, Page, Route } from "playwright";
import { blockInternalRequests } from "../../src/browser/guard.js";
import { checkAction, isBlockedUrl } from "../../src/browser/policy.js";
import type { BrowserPool } from "../../src/browser/pool.js";
import { localPrincipal } from "../../src/identity/localIdentity.js";
import { createSafeFetch } from "../../src/lib/safeFetch.js";
import { publicHttpUrlError } from "../../src/lib/net.js";
import { hubFactory } from "../../src/providers/hubFactory.js";
import { secretsFor } from "../../src/secrets/secretsFor.js";
import { TurnBudget } from "../../src/tools/budget.js";
import { fetchPageTool } from "../../src/tools/fetchPage.js";
import { buildTools, PER_REPLY_LIMITS } from "../../src/tools/index.js";
import { wrapper } from "../fixtures/app.js";
import { fakeFetch, json } from "../fixtures/fakeFetch.js";
import { testConfig } from "../fixtures/config.js";
import { MemoryDb } from "../fixtures/memoryRepos.js";

const LOCAL_SERVICES = [
  "http://127.0.0.1:3000/api/chats",
  "http://127.0.0.1:8000/chats",
  "http://localhost:18330/",
  "http://host.docker.internal:11434/api/tags",
  "http://agent:3000/",
];

const textOf = (result: { content: Array<{ type: string; text?: string }> }) => result.content.map((c) => c.text ?? "").join("");

function fakePool() {
  const goto = vi.fn(async () => null);
  const page = { url: () => "about:blank", goto, isClosed: () => false } as unknown as Page;
  const pool = { page: vi.fn(async () => page), tab: vi.fn(async () => page) } as unknown as BrowserPool;
  return { pool, goto };
}

function localTools(pool: BrowserPool) {
  const user = localPrincipal();
  expect(user.capabilities.privateNetworkModels).toBe(true);
  return buildTools({
    cfg: testConfig(),
    artifacts: {} as never,
    pool,
    sessionKey: `${user.id}:chat`,
    userContext: null,
    budget: new TurnBudget(PER_REPLY_LIMITS),
  });
}

describe("tools never reach local services under the local principal", () => {
  it.each(LOCAL_SERVICES)("publicHttpUrlError refuses %s", (url) => {
    expect(publicHttpUrlError(url)).toMatch(/refusing internal or private address/);
  });

  it.each(LOCAL_SERVICES)("fetch_page refuses %s with no network attempt", async (url) => {
    const fetch = fakeFetch([]);
    const lookup = vi.fn(async () => ["93.184.216.34"]);
    const result = await fetchPageTool({ fetch, lookup }).execute("t", { url }, undefined, undefined, {} as never);
    expect(textOf(result)).toMatch(/refusing internal or private address/);
    expect(fetch.calls).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each(LOCAL_SERVICES)("the wired fetch_page tool refuses %s", async (url) => {
    const tool = localTools(fakePool().pool).find((t) => t.name === "fetch_page")!;
    const result = await tool.execute("t", { url }, undefined, undefined, {} as never);
    expect(textOf(result)).toMatch(/refusing internal or private address/);
  });

  it.each(LOCAL_SERVICES)("the wired browse tool refuses goto %s without navigating", async (url) => {
    const { pool, goto } = fakePool();
    const tool = localTools(pool).find((t) => t.name === "browse")!;
    const result = await tool.execute("t", { actions: [{ op: "goto", url }] }, undefined, undefined, {} as never);
    expect(textOf(result)).toMatch(/refusing internal or private address/);
    expect(goto).not.toHaveBeenCalled();
  });

  it.each(LOCAL_SERVICES)("browse policy refuses goto %s and isBlockedUrl stays a word check", (url) => {
    expect(checkAction({ op: "goto", url }, { url: "about:blank" })).toMatchObject({ allowed: false });
    expect(isBlockedUrl(url)).toBe(false);
  });

  it.each(LOCAL_SERVICES)("the browser route guard aborts %s with no lookup", async (url) => {
    let handler: ((route: Route) => Promise<void>) | undefined;
    const context = {
      route: vi.fn(async (_pattern: string, h: (route: Route) => Promise<void>) => {
        handler = h;
      }),
    } as unknown as BrowserContext;
    const lookup = vi.fn(async () => ["93.184.216.34"]);
    await blockInternalRequests(context, { lookup });
    const abort = vi.fn(async () => {});
    const go = vi.fn(async () => {});
    await handler!({ request: () => ({ url: () => url }), abort, continue: go } as unknown as Route);
    expect(abort).toHaveBeenCalledWith("blockedbyclient");
    expect(go).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("model providers for the local principal", () => {
  it("can use a model server on host.docker.internal", async () => {
    const db = new MemoryDb();
    const trusted = fakeFetch([[/\/models$/, () => json({ data: [{ id: "llama3" }] })]]);
    const guarded = fakeFetch([]);
    const hub = await hubFactory({
      repos: (id) => db.forUser(id),
      credentials: secretsFor(db, wrapper),
      network: { fetch: trusted, userFetch: createSafeFetch(guarded) },
    })(localPrincipal());
    const view = await hub.addLocal({ kind: "ollama", baseUrl: "http://host.docker.internal:11434/v1" });
    expect(view.configured).toBe(true);
    expect(trusted.calls).toContain("http://host.docker.internal:11434/v1/models");
    expect(guarded.calls).toEqual([]);
  });
});
