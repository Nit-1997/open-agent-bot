import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../../src/artifacts/store.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "artifacts-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ArtifactStore", () => {
  it("store.save then get round-trips", async () => {
    const s = new ArtifactStore(dir);
    const { id } = await s.save("Party plan", "<h1>Hi</h1>");
    expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(await s.get(id)).toEqual({ title: "Party plan", html: "<h1>Hi</h1>" });
  });

  it('store.get rejects path traversal id "../../etc"', async () => {
    const s = new ArtifactStore(dir);
    expect(await s.get("../../etc")).toBeNull();
    expect(await s.get("aaaaaaaaaaa/")).toBeNull();
  });

  it("returns null for unknown id", async () => {
    expect(await new ArtifactStore(dir).get("abcdefghijkl")).toBeNull();
  });
});
