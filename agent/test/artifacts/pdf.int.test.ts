import { afterEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { MemoryDb } from "../fixtures/memoryRepos.js";
import { ALICE } from "../fixtures/users.js";

const stores: ArtifactStore[] = [];
afterEach(async () => {
  await Promise.all(stores.splice(0).map((s) => s.close()));
});

describe("ArtifactStore PDF rendering in Chromium", () => {
  it("renders a real PDF and closes the browser afterwards", async () => {
    const store = new ArtifactStore();
    stores.push(store);
    const alice = new MemoryDb().forUser(ALICE.id);
    const { id } = await store.save(alice, null, "Trip", "<h1>Lisbon</h1>");
    const out = await store.renderPdf(alice, id);
    expect(out?.pdf.subarray(0, 4).toString()).toBe("%PDF");
    await store.close();
    expect((store as unknown as { browser?: unknown }).browser).toBeUndefined();
  }, 60000);
});
