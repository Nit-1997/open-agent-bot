import { describe, expect, it } from "vitest";
import { makeApp } from "../fixtures/app.js";
import { ALICE, BOB } from "../fixtures/users.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("chat routes", () => {
  it("lists a user's chats newest first, 20 per page, with the total", async () => {
    const { call, db } = await makeApp();
    const r = db.forUser(ALICE.id);
    for (let i = 1; i <= 22; i++) {
      await r.chats.claim(id(i), {});
      await r.chats.touch(id(i), { titleIfEmpty: `chat ${i}` });
    }
    await db.forUser(BOB.id).chats.claim(id(99), {});
    const page1 = (await (await call(ALICE, "/chats?page=1")).json()) as {
      items: Array<{ title: string }>;
      total: number;
      page: number;
      pageSize: number;
    };
    expect(page1).toMatchObject({ total: 22, page: 1, pageSize: 20 });
    expect(page1.items.map((c) => c.title).slice(0, 3)).toEqual(["chat 22", "chat 21", "chat 20"]);
    const page2 = (await (await call(ALICE, "/chats?page=2")).json()) as { items: unknown[] };
    expect(page2.items).toHaveLength(2);
    expect((await call(ALICE, "/chats?page=0")).status).toBe(400);
    expect((await call(ALICE, "/chats?page=x")).status).toBe(400);
  });

  it("returns one chat to its owner and 404 to everyone else", async () => {
    const { call, db } = await makeApp();
    const r = db.forUser(ALICE.id);
    await r.chats.claim(id(1), {});
    await r.chats.touch(id(1), { titleIfEmpty: "Big Sur" });
    const body = (await (await call(ALICE, `/chats/${id(1)}`)).json()) as { chat: { id: string; title: string } };
    expect(body.chat).toMatchObject({ id: id(1), title: "Big Sur" });
    expect((await call(BOB, `/chats/${id(1)}`)).status).toBe(404);
    expect((await call(ALICE, "/chats/not-a-uuid")).status).toBe(404);
    expect((await call(ALICE, `/chats/${id(2)}`)).status).toBe(404);
  });

  it("returns a chat's messages to its owner and 404 to everyone else", async () => {
    const { call, db } = await makeApp();
    const r = db.forUser(ALICE.id);
    await r.chats.claim(id(1), {});
    await r.messages.append(id(1), "r1", [
      { role: "user", content: "hi", status: "complete" },
      { role: "assistant", content: "half", status: "interrupted" },
    ]);
    const mine = (await (await call(ALICE, `/chats/${id(1)}/messages`)).json()) as { items: unknown[]; total: number };
    expect(mine.total).toBe(2);
    expect(mine.items).toMatchObject([
      { role: "user", content: "hi", status: "complete" },
      { role: "assistant", content: "half", status: "interrupted" },
    ]);
    expect((await call(BOB, `/chats/${id(1)}/messages`)).status).toBe(404);
    expect((await call(ALICE, "/chats/not-a-uuid/messages")).status).toBe(404);
  });
});
