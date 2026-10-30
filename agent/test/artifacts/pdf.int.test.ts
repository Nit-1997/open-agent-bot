import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../../src/artifacts/store.js";

const stores: ArtifactStore[] = [];
afterEach(async () => {
  await Promise.all(stores.splice(0).map((s) => s.close()));
});

describe("ArtifactStore.renderPdf", () => {
  it("renders once for concurrent requests and serves the cached file afterwards", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pdf-"));
    const store = new ArtifactStore(dir);
    stores.push(store);
    const { id } = await store.save("Trip", "<h1>Lisbon</h1>");
    const [a, b] = await Promise.all([store.renderPdf(id), store.renderPdf(id)]);
    expect(a?.subarray(0, 4).toString()).toBe("%PDF");
    expect(b).toBe(a);
    expect(existsSync(join(dir, `${id}.pdf`))).toBe(true);
    await store.close();
    const again = await store.renderPdf(id);
    expect(again?.equals(a!)).toBe(true);
    expect((store as unknown as { browser?: unknown }).browser).toBeUndefined();
  });

  it("returns null for an unknown artifact", async () => {
    const store = new ArtifactStore(mkdtempSync(join(tmpdir(), "pdf-")));
    stores.push(store);
    expect(await store.renderPdf("AAAAAAAAAAAA")).toBeNull();
  });
});
