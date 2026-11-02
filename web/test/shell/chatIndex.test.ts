import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatIndex } from "@/lib/chatIndex";

const TOTAL = 45;
const row = (n: number) => ({ id: `chat-${n}`, title: `Chat ${n}`, lastMessageAt: "2026-11-01T10:00:00Z" });
const pageOf = (page: number) => {
  const items = Array.from({ length: Math.max(0, Math.min(20, TOTAL - (page - 1) * 20)) }, (_, i) => row((page - 1) * 20 + i + 1));
  return Response.json({ items, total: TOTAL, page, pageSize: 20 });
};

let held: { page: number; release: () => void }[];

beforeEach(() => {
  chatIndex.reset();
  held = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (url: string) =>
        new Promise<Response>((resolve) => {
          const page = Number(/page=(\d+)/.exec(url)![1]);
          held.push({ page, release: () => resolve(pageOf(page)) });
        }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

const tick = () => new Promise((r) => setTimeout(r, 0));
async function release(page: number) {
  const i = held.findIndex((h) => h.page === page);
  held.splice(i, 1)[0].release();
  await tick();
}

describe("chatIndex", () => {
  it("drops an in-flight more() after reset()", async () => {
    const first = chatIndex.load();
    await release(1);
    await first;
    const more = chatIndex.more();
    await tick();
    chatIndex.reset();
    await release(2);
    await more;
    expect(chatIndex.get()).toMatchObject({ status: "idle", items: [], pages: 0, loadingMore: false });
  });

  it("keeps the pages a more() added while a load() was running", async () => {
    const first = chatIndex.load();
    await release(1);
    await first;
    const refresh = chatIndex.load();
    await tick();
    const more = chatIndex.more();
    await tick();
    await release(2);
    await more;
    expect(chatIndex.get().pages).toBe(2);
    await release(1);
    while (held.length) await release(held[0].page);
    await refresh;
    expect(chatIndex.get()).toMatchObject({ status: "ready", pages: 2, loadingMore: false });
    expect(chatIndex.get().items).toHaveLength(40);
  });

  it("ignores a more() that finishes after a newer load()", async () => {
    const first = chatIndex.load();
    await release(1);
    await first;
    const more = chatIndex.more();
    await tick();
    const refresh = chatIndex.load();
    await tick();
    await release(1);
    await refresh;
    await release(2);
    await more;
    expect(chatIndex.get()).toMatchObject({ status: "ready", pages: 1, loadingMore: false });
    expect(chatIndex.get().items).toHaveLength(20);
  });
});
