import { describe, expect, it, vi } from "vitest";
import { ArtifactStore, MAX_ARTIFACT_BYTES } from "../../src/artifacts/store.js";
import { MemoryDb } from "../fixtures/memoryRepos.js";
import { ALICE, BOB, CHAT_1 } from "../fixtures/users.js";

const fakePdf = async (html: string) => Buffer.from(`%PDF ${html}`);
const fakeJpg = async (html: string) => Buffer.from(`JPG ${html}`);
const store = (pdf = fakePdf, jpg = fakeJpg) => new ArtifactStore(pdf, jpg);
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe("ArtifactStore", () => {
  it("stores the HTML under the owner's folder and reads it back", async () => {
    const db = new MemoryDb();
    const s = store();
    const alice = db.forUser(ALICE.id);
    await alice.chats.claim(CHAT_1, {});
    const { id } = await s.save(alice, CHAT_1, "Party plan", "<h1>Hi</h1>");
    expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(db.objects.has(`${ALICE.id}/${id}.html`)).toBe(true);
    expect(await s.get(alice, id)).toEqual({ title: "Party plan", html: "<h1>Hi</h1>" });
    await s.thumbnail(alice, id);
    expect([...db.objects.keys()].sort()).toEqual([`${ALICE.id}/${id}.html`, `${ALICE.id}/${id}.jpg`]);
  });

  it("treats another user's artifact, a traversal id and an unknown id the same: not found", async () => {
    const db = new MemoryDb();
    const s = store();
    const { id } = await s.save(db.forUser(ALICE.id), null, "Mine", "<p>x</p>");
    const bob = db.forUser(BOB.id);
    expect(await s.get(bob, id)).toBeNull();
    expect(await s.renderPdf(bob, id)).toBeNull();
    expect(await s.thumbnail(bob, id)).toBeNull();
    expect(await s.thumbnail(bob, "../../etc")).toBeNull();
    expect(await s.get(bob, "../../etc")).toBeNull();
    expect(await s.get(bob, "abcdefghijkl")).toBeNull();
  });

  it("refuses HTML over 5 MB", async () => {
    const s = store();
    await expect(s.save(new MemoryDb().forUser(ALICE.id), null, "Big", "x".repeat(MAX_ARTIFACT_BYTES + 1))).rejects.toMatchObject({
      kind: "too_large",
    });
  });

  it("removes the uploaded object when the metadata insert fails", async () => {
    const db = new MemoryDb();
    const alice = db.forUser(ALICE.id);
    const owner = { ...alice, artifacts: { ...alice.artifacts, insert: vi.fn().mockRejectedValue(new Error("db down")) } };
    await expect(store().save(owner, null, "T", "<p/>")).rejects.toThrow("db down");
    expect(db.objects.size).toBe(0);
  });

  it("renders a PDF once for concurrent requests, stores it and serves the stored copy afterwards", async () => {
    const db = new MemoryDb();
    const render = vi.fn(fakePdf);
    const s = store(render);
    const alice = db.forUser(ALICE.id);
    const { id } = await s.save(alice, null, "Trip", "<h1>Lisbon</h1>");
    const [a, b] = await Promise.all([s.renderPdf(alice, id), s.renderPdf(alice, id)]);
    expect(a?.pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(b?.pdf).toBe(a?.pdf);
    expect(db.objects.has(`${ALICE.id}/${id}.pdf`)).toBe(true);
    const again = await s.renderPdf(alice, id);
    expect(again?.pdf.equals(a!.pdf)).toBe(true);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("renders a thumbnail eagerly after save, once, and serves the stored copy afterwards", async () => {
    const db = new MemoryDb();
    const thumb = vi.fn(fakeJpg);
    const s = store(fakePdf, thumb);
    const alice = db.forUser(ALICE.id);
    const beforeRender = vi.fn();
    const { id } = await s.save(alice, null, "Trip", "<h1>Lisbon</h1>");
    const [a, b] = await Promise.all([s.thumbnail(alice, id, { beforeRender }), s.thumbnail(alice, id, { beforeRender })]);
    expect(a?.toString()).toBe("JPG <h1>Lisbon</h1>");
    expect(b).toBe(a);
    expect(beforeRender).not.toHaveBeenCalled();
    expect((await alice.artifacts.get(id))?.thumbReady).toBe(true);
    expect((await s.thumbnail(alice, id, { beforeRender }))?.equals(a!)).toBe(true);
    expect(thumb).toHaveBeenCalledTimes(1);
    expect(beforeRender).not.toHaveBeenCalled();
  });

  it("charges beforeRender once for concurrent requests that start a render, and not for a cached read", async () => {
    const db = new MemoryDb();
    const alice = db.forUser(ALICE.id);
    const id = "abcdefghijkl";
    await alice.artifacts.insert({ id, chatId: null, title: "T", sizeBytes: 3 });
    await alice.storage.upload(id, "html", Buffer.from("<p/>"));
    const fresh = store();
    const beforeRender = vi.fn();
    await Promise.all([fresh.thumbnail(alice, id, { beforeRender }), fresh.thumbnail(alice, id, { beforeRender })]);
    expect(beforeRender).toHaveBeenCalledTimes(1);
    await fresh.thumbnail(alice, id, { beforeRender });
    expect(beforeRender).toHaveBeenCalledTimes(1);
  });

  it("stops before rendering when beforeRender throws, and uploads nothing", async () => {
    const db = new MemoryDb();
    const alice = db.forUser(ALICE.id);
    const thumb = vi.fn(fakeJpg);
    const pdf = vi.fn(fakePdf);
    const s = store(pdf, thumb);
    await alice.artifacts.insert({ id: "abcdefghijkl", chatId: null, title: "T", sizeBytes: 3 });
    await alice.storage.upload("abcdefghijkl", "html", Buffer.from("<p/>"));
    const limited = () => {
      throw new Error("rate limited");
    };
    await expect(s.thumbnail(alice, "abcdefghijkl", { beforeRender: limited })).rejects.toThrow("rate limited");
    await expect(s.renderPdf(alice, "abcdefghijkl", { beforeRender: limited })).rejects.toThrow("rate limited");
    expect(thumb).not.toHaveBeenCalled();
    expect(pdf).not.toHaveBeenCalled();
    expect([...db.objects.keys()]).toEqual([`${ALICE.id}/abcdefghijkl.html`]);
  });

  it("registers the eager render before save returns, so a request right after joins it", async () => {
    const db = new MemoryDb();
    const gate = deferred();
    const thumb = vi.fn(async (html: string) => {
      await gate.promise;
      return fakeJpg(html);
    });
    const s = store(fakePdf, thumb);
    const alice = db.forUser(ALICE.id);
    const { id } = await s.save(alice, null, "Trip", "<p/>");
    const beforeRender = vi.fn();
    const joined = s.thumbnail(alice, id, { beforeRender });
    gate.resolve();
    expect((await joined)?.toString()).toBe("JPG <p/>");
    expect(thumb).toHaveBeenCalledTimes(1);
    expect(beforeRender).not.toHaveBeenCalled();
  });

  it("logs a failing eager render and still returns the id", async () => {
    const db = new MemoryDb();
    const s = store(fakePdf, async () => {
      throw new Error("chromium gone");
    });
    const alice = db.forUser(ALICE.id);
    const { id } = await s.save(alice, null, "Trip", "<p/>");
    expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);
    await expect(s.thumbnail(alice, id)).rejects.toThrow("chromium gone");
    expect(db.objects.has(`${ALICE.id}/${id}.jpg`)).toBe(false);
  });

  it("removes the uploaded thumbnail when its row is gone by the time it is stored", async () => {
    const db = new MemoryDb();
    const alice = db.forUser(ALICE.id);
    const owner = { ...alice, artifacts: { ...alice.artifacts, setThumb: vi.fn().mockResolvedValue(false) } };
    const s = store();
    await alice.artifacts.insert({ id: "abcdefghijkl", chatId: null, title: "T", sizeBytes: 3 });
    await alice.storage.upload("abcdefghijkl", "html", Buffer.from("<p/>"));
    expect(await s.thumbnail(owner, "abcdefghijkl")).toBeNull();
    expect(db.objects.has(`${ALICE.id}/abcdefghijkl.jpg`)).toBe(false);
  });

  it("renders one at a time per user while another user's render runs, and drops the idle queue", async () => {
    const db = new MemoryDb();
    const gates = new Map<string, ReturnType<typeof deferred>>();
    const started: string[] = [];
    const thumb = async (html: string) => {
      started.push(html);
      const g = deferred();
      gates.set(html, g);
      await g.promise;
      return fakeJpg(html);
    };
    const s = store(fakePdf, thumb);
    const seed = async (userId: string, id: string, html: string) => {
      const r = db.forUser(userId);
      await r.artifacts.insert({ id, chatId: null, title: "T", sizeBytes: 3 });
      await r.storage.upload(id, "html", Buffer.from(html));
      return r;
    };
    const alice = await seed(ALICE.id, "aaaaaaaaaaa1", "a1");
    await seed(ALICE.id, "aaaaaaaaaaa2", "a2");
    const bob = await seed(BOB.id, "bbbbbbbbbbb1", "b1");
    const a1 = s.thumbnail(alice, "aaaaaaaaaaa1");
    const a2 = s.thumbnail(alice, "aaaaaaaaaaa2");
    const b1 = s.thumbnail(bob, "bbbbbbbbbbb1");
    await vi.waitFor(() => expect(started.sort()).toEqual(["a1", "b1"]));
    gates.get("b1")!.resolve();
    await b1;
    expect(started).not.toContain("a2");
    gates.get("a1")!.resolve();
    await a1;
    await vi.waitFor(() => expect(started).toContain("a2"));
    gates.get("a2")!.resolve();
    await a2;
    expect((s as unknown as { userSlots: Map<string, unknown> }).userSlots.size).toBe(0);
  });
});
