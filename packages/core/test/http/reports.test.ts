import { describe, expect, it } from "vitest";
import { makeApp } from "../fixtures/app.js";
import { ALICE, BOB } from "../fixtures/users.js";

const chat = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const id = (n: number) => `report${String(n).padStart(6, "0")}`;

describe("report routes", () => {
  it("pages a user's reports newest first with chat titles, 12 per page", async () => {
    const { call, db } = await makeApp();
    const r = db.forUser(ALICE.id);
    await r.chats.claim(chat(1), {});
    await r.chats.touch(chat(1), { titleIfEmpty: "Big Sur" });
    for (let i = 1; i <= 13; i++)
      await r.artifacts.insert({ id: id(i), chatId: i === 13 ? chat(1) : null, title: `Report ${i}`, sizeBytes: i });
    await db.forUser(BOB.id).artifacts.insert({ id: id(99), chatId: null, title: "Bob's", sizeBytes: 1 });
    const page1 = (await (await call(ALICE, "/reports")).json()) as {
      items: Array<{ title: string; chatId: string | null; chatTitle: string | null }>;
      total: number;
      pageSize: number;
    };
    expect(page1).toMatchObject({ total: 13, pageSize: 12 });
    expect(page1.items).toHaveLength(12);
    expect(page1.items[0]).toMatchObject({ title: "Report 13", chatId: chat(1), chatTitle: "Big Sur" });
    expect(page1.items[1]).toMatchObject({ title: "Report 12", chatId: null, chatTitle: null });
    const page2 = (await (await call(ALICE, "/reports?page=2")).json()) as { items: Array<{ title: string }> };
    expect(page2.items.map((x) => x.title)).toEqual(["Report 1"]);
    expect((await call(ALICE, "/reports?page=0")).status).toBe(400);
  });

  it("reports a deleted chat as nulls", async () => {
    const { call, db } = await makeApp();
    await db.forUser(ALICE.id).chats.claim(chat(7), {});
    await db.forUser(ALICE.id).artifacts.insert({ id: id(1), chatId: chat(7), title: "Orphan", sizeBytes: 5 });
    db.chats.delete(chat(7));
    const body = (await (await call(ALICE, `/reports/${id(1)}`)).json()) as { report: { chatId: null; chatTitle: null } };
    expect(body.report).toMatchObject({ id: id(1), title: "Orphan", chatId: null, chatTitle: null, pdfReady: false, sizeBytes: 5 });
  });

  it("answers 404 for another user's report and for a bad id", async () => {
    const { call, db } = await makeApp();
    await db.forUser(BOB.id).artifacts.insert({ id: id(1), chatId: null, title: "Bob's", sizeBytes: 1 });
    expect((await call(ALICE, `/reports/${id(1)}`)).status).toBe(404);
    expect((await call(ALICE, "/reports/..")).status).toBe(404);
    expect((await call(ALICE, "/reports/short")).status).toBe(404);
  });

  it("rate limits lists", async () => {
    const { call } = await makeApp();
    let last = 0;
    for (let i = 0; i < 241; i++) last = (await call(ALICE, "/reports")).status;
    expect(last).toBe(429);
  });
});
