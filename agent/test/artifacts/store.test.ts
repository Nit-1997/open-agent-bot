import { describe, expect, it, vi } from "vitest";
import { ArtifactStore, MAX_ARTIFACT_BYTES } from "../../src/artifacts/store.js";
import { MemoryDb } from "../fixtures/memoryRepos.js";
import { ALICE, BOB, CHAT_1 } from "../fixtures/users.js";

const fakePdf = async (html: string) => Buffer.from(`%PDF ${html}`);

describe("ArtifactStore", () => {
  it("stores the HTML under the owner's folder and reads it back", async () => {
    const db = new MemoryDb();
    const s = new ArtifactStore(fakePdf);
    const alice = db.forUser(ALICE.id);
    await alice.chats.claim(CHAT_1, {});
    const { id } = await s.save(alice, CHAT_1, "Party plan", "<h1>Hi</h1>");
    expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect([...db.objects.keys()]).toEqual([`${ALICE.id}/${id}.html`]);
    expect(await s.get(alice, id)).toEqual({ title: "Party plan", html: "<h1>Hi</h1>" });
  });

  it("treats another user's artifact, a traversal id and an unknown id the same: not found", async () => {
    const db = new MemoryDb();
    const s = new ArtifactStore(fakePdf);
    const { id } = await s.save(db.forUser(ALICE.id), null, "Mine", "<p>x</p>");
    const bob = db.forUser(BOB.id);
    expect(await s.get(bob, id)).toBeNull();
    expect(await s.renderPdf(bob, id)).toBeNull();
    expect(await s.get(bob, "../../etc")).toBeNull();
    expect(await s.get(bob, "abcdefghijkl")).toBeNull();
  });

  it("refuses HTML over 5 MB", async () => {
    const s = new ArtifactStore(fakePdf);
    await expect(s.save(new MemoryDb().forUser(ALICE.id), null, "Big", "x".repeat(MAX_ARTIFACT_BYTES + 1))).rejects.toMatchObject({
      kind: "too_large",
    });
  });

  it("removes the uploaded object when the metadata insert fails", async () => {
    const db = new MemoryDb();
    const alice = db.forUser(ALICE.id);
    const owner = { ...alice, artifacts: { ...alice.artifacts, insert: vi.fn().mockRejectedValue(new Error("db down")) } };
    await expect(new ArtifactStore(fakePdf).save(owner, null, "T", "<p/>")).rejects.toThrow("db down");
    expect(db.objects.size).toBe(0);
  });

  it("renders a PDF once for concurrent requests, stores it and serves the stored copy afterwards", async () => {
    const db = new MemoryDb();
    const render = vi.fn(fakePdf);
    const s = new ArtifactStore(render);
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
});
