import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forUser } from "../../src/db/users.js";
import { createBareUser, deleteCreatedUsers, enabled, managementQuery, remainingRows, service } from "./helpers.js";

describe.skipIf(!enabled)("search_user_content (live project)", () => {
  let a: { id: string };
  let b: { id: string };
  const chats = { sur: randomUUID(), zurich: randomUUID(), sale: randomUUID(), slash: randomUUID(), both: randomUUID() };

  const rpc = (user: string, q: string, scope = "all", limit = 10, offset = 0) =>
    service().rpc("search_user_content", { p_user: user, p_query: q, p_scope: scope, p_limit: limit, p_offset: offset });

  const at = (n: number) => new Date(Date.UTC(2026, 9, 1 + n)).toISOString();

  beforeAll(async () => {
    [a, b] = await Promise.all([createBareUser(), createBareUser()]);
    const ra = forUser(service(), a.id);
    const titles: Record<keyof typeof chats, string> = {
      sur: "Weekend in Big Sur",
      zurich: "Zürich trip",
      sale: "50% off sale",
      slash: "Paths a\\b",
      both: "Tacos tonight",
    };
    let n = 0;
    for (const [k, title] of Object.entries(titles) as Array<[keyof typeof chats, string]>) {
      await ra.chats.claim(chats[k], {});
      await service()
        .from("chats")
        .update({ title, last_message_at: at(n++) })
        .eq("id", chats[k]);
    }
    await ra.messages.append(chats.sur, "r1", [
      { role: "assistant", content: `${"x".repeat(200)} then McWay Falls at sunset ${"y".repeat(300)}`, status: "complete" },
    ]);
    await ra.messages.append(chats.both, "r1", [{ role: "user", content: "best tacos near me", status: "complete" }]);
    await ra.artifacts.insert({ id: "searchRep001", chatId: chats.sur, title: "Big Sur guide", sizeBytes: 1 });
    await service()
      .from("artifacts")
      .update({ created_at: at(10) })
      .eq("id", "searchRep001");
    const rb = forUser(service(), b.id);
    const other = randomUUID();
    await rb.chats.claim(other, {});
    await rb.chats.touch(other, { titleIfEmpty: "Big Sur for Bob" });
  }, 60_000);

  afterAll(async () => {
    expect(await remainingRows(await deleteCreatedUsers())).toBe(0);
  }, 60_000);

  it("matches titles, messages and report titles, newest first, with stable counts per scope", async () => {
    const all = (await rpc(a.id, "big sur")).data;
    expect(all).toMatchObject({ total: 2, chats: 1, reports: 1 });
    expect(all.items.map((i: { kind: string }) => i.kind)).toEqual(["report", "chat"]);
    for (const scope of ["chats", "reports"]) {
      const r = (await rpc(a.id, "big sur", scope)).data;
      expect([r.chats, r.reports]).toEqual([1, 1]);
      expect(r.total).toBe(1);
    }
    const msg = (await rpc(a.id, "mcway")).data;
    expect(msg.items[0]).toMatchObject({ kind: "chat", refId: chats.sur, match: "message" });
    const start = msg.items[0].snippetStart as number;
    expect(msg.items[0].snippet.toLowerCase()).toContain("mcway");
    expect(msg.items[0].snippet.toLowerCase().indexOf("mcway")).toBeLessThanOrEqual(60);
    expect(start).toBeGreaterThan(1);
  });

  it("returns one row for a chat matching by title and message", async () => {
    const r = (await rpc(a.id, "tacos")).data;
    expect(r.total).toBe(1);
    expect(r.items[0]).toMatchObject({ refId: chats.both, match: "title" });
    expect(r.items[0].snippet).toContain("tacos");
  });

  it("is case-insensitive and handles non-ASCII", async () => {
    expect((await rpc(a.id, "ZÜRICH")).data.total).toBe(1);
    expect((await rpc(a.id, "WEEKEND")).data.total).toBe(1);
  });

  it("matches %, _ and \\ literally", async () => {
    expect((await rpc(a.id, "50%")).data.total).toBe(1);
    expect((await rpc(a.id, "5_")).data.total).toBe(0);
    expect((await rpc(a.id, "a\\b")).data.total).toBe(1);
    expect((await rpc(a.id, "%%")).data.total).toBe(0);
  });

  it("pages with a stable total and keeps totals past the end", async () => {
    const first = (await rpc(a.id, "ri", "all", 1, 0)).data;
    const second = (await rpc(a.id, "ri", "all", 1, 1)).data;
    expect(first.total).toBe(second.total);
    expect(first.items[0].refId).not.toBe(second.items[0]?.refId);
    const past = (await rpc(a.id, "big sur", "all", 10, 100)).data;
    expect(past).toMatchObject({ total: 2, chats: 1, reports: 1, items: [] });
  });

  it("never shows another user's rows", async () => {
    const r = (await rpc(b.id, "big sur")).data;
    expect(r).toMatchObject({ total: 1, chats: 1, reports: 0 });
    expect(r.items[0].title).toBe("Big Sur for Bob");
  });

  it("rejects out-of-range arguments with 22023", async () => {
    for (const [q, scope, limit, offset] of [
      ["a", "all", 10, 0],
      ["x".repeat(101), "all", 10, 0],
      ["ab", "plans", 10, 0],
      ["ab", "all", 0, 0],
      ["ab", "all", 51, 0],
      ["ab", "all", 10, 10001],
      ["ab", "all", 10, -1],
    ] as const) {
      const r = await rpc(a.id, q, scope, limit, offset);
      expect(r.error?.code, `${q.slice(0, 5)} ${scope} ${limit} ${offset}`).toBe("22023");
    }
  });

  it("uses an index for a three-character needle over 500 messages", async () => {
    const chat = randomUUID();
    const ra = forUser(service(), a.id);
    await ra.chats.claim(chat, {});
    const rows = Array.from({ length: 500 }, (_, i) => ({
      role: "user" as const,
      content: `message ${i} about ${i % 50 === 0 ? "kayaks" : "hiking"} and more`,
      status: "complete" as const,
    }));
    for (let i = 0; i < rows.length; i += 100) await ra.messages.append(chat, `seed${i}`, rows.slice(i, i + 100));
    await managementQuery("select 1");
    const plan = await managementQuery<{ "QUERY PLAN": string }>(
      `explain (analyze, buffers) select distinct on (m.chat_id) m.chat_id, m.content from public.chat_messages m where m.user_id = '${a.id}' and m.content ilike '%kay%' order by m.chat_id, m.id desc`,
    );
    const text = plan.map((r) => r["QUERY PLAN"]).join("\n");
    expect(text).toMatch(
      /Bitmap Index Scan on (chat_messages_content_trgm_idx|chat_messages_user_idx)|Index Scan using chat_messages_user_idx/,
    );
    expect(text).not.toMatch(/Seq Scan on chat_messages/);
  });
});
