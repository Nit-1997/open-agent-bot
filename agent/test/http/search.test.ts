import { describe, expect, it, vi } from "vitest";
import type { SearchResponse } from "../../../shared/lists.js";
import { UserError } from "../../src/lib/errors.js";
import { makeApp } from "../fixtures/app.js";
import { ALICE, BOB, CHAT_1, CHAT_2 } from "../fixtures/users.js";

async function seeded() {
  const h = await makeApp();
  const r = h.db.forUser(ALICE.id);
  await r.chats.claim(CHAT_1, {});
  await r.chats.touch(CHAT_1, { titleIfEmpty: "Weekend in Big Sur" });
  await r.messages.append(CHAT_1, "r1", [
    { role: "assistant", content: `${"x".repeat(100)} sunset at McWay Falls ${"y".repeat(300)}`, status: "complete" },
  ]);
  await r.chats.claim(CHAT_2, {});
  await r.chats.touch(CHAT_2, { titleIfEmpty: "Taco night" });
  await r.artifacts.insert({ id: "report000001", chatId: CHAT_1, title: "Big Sur guide", sizeBytes: 1 });
  const b = h.db.forUser(BOB.id);
  await b.artifacts.insert({ id: "report000002", chatId: null, title: "Big Sur secrets", sizeBytes: 1 });
  return h;
}

const get = async (call: Awaited<ReturnType<typeof makeApp>>["call"], q: string) => (await (await call(ALICE, q)).json()) as SearchResponse;

describe("GET /search", () => {
  it("finds chat titles, message text and report titles, newest first, with counts per kind", async () => {
    const { call } = await seeded();
    const body = await get(call, "/search?q=big%20sur");
    expect(body).toMatchObject({ total: 2, query: "big sur", scope: "all", counts: { chats: 1, reports: 1 }, page: 1, pageSize: 10 });
    expect(body.items[0]).toMatchObject({ kind: "report", id: "report000001", chatId: CHAT_1, chatTitle: "Weekend in Big Sur" });
    expect(body.items[1]).toMatchObject({ kind: "chat", chatId: CHAT_1, match: "title", snippet: null });
  });

  it("maps a message match into a snippet with truncation flags", async () => {
    const { call } = await seeded();
    const body = await get(call, "/search?q=mcway&scope=chats");
    expect(body.total).toBe(1);
    const hit = body.items[0];
    expect(hit.kind === "chat" && hit.match).toBe("message");
    if (hit.kind !== "chat" || !hit.snippet) throw new Error("expected a snippet");
    expect(hit.snippet.text).toContain("McWay");
    expect(hit.snippet).toMatchObject({ truncatedStart: true, truncatedEnd: true });
    expect(body.counts).toEqual({ chats: 1, reports: 0 });
  });

  it("keeps the total and counts on a page past the end", async () => {
    const { call } = await seeded();
    const body = await get(call, "/search?q=big%20sur&page=5");
    expect(body.items).toEqual([]);
    expect(body).toMatchObject({ total: 2, counts: { chats: 1, reports: 1 } });
  });

  it("validates q, scope and page", async () => {
    const { call } = await seeded();
    for (const q of [
      "/search?q=a",
      `/search?q=${"a".repeat(101)}`,
      "/search",
      "/search?q=ab&scope=plans",
      "/search?q=ab&page=0",
      "/search?q=ab&page=1002",
    ])
      expect((await call(ALICE, q)).status, q).toBe(400);
    expect((await call(ALICE, `/search?q=${"%20".repeat(401)}ab`)).status).toBe(400);
    const cleaned = await get(call, "/search?q=ta%00co%E2%80%8B");
    expect(cleaned.query).toBe("taco");
    expect(cleaned.total).toBe(1);
  });

  it("maps a 22023 from the database to 400", async () => {
    const h = await seeded();
    const repos = h.deps.repos;
    const { call } = await makeApp({
      repos: (id) => ({
        ...repos(id),
        search: { search: vi.fn(async () => Promise.reject(new UserError("Search for 2 to 100 characters.", "invalid"))) },
      }),
    });
    expect((await call(ALICE, "/search?q=abc")).status).toBe(400);
  });
});
