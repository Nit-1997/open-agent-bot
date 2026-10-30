import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSharedSecret } from "../../src/lib/secret.js";

describe("ensureSharedSecret", () => {
  it("creates a 32-byte secret on first start and reuses it after", async () => {
    const dir = await mkdtemp(join(tmpdir(), "secret-"));
    const path = join(dir, "shared", "agent-secret");
    const first = await ensureSharedSecret(path);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect((await stat(path)).mode & 0o777).toBe(0o640);
    expect(await ensureSharedSecret(path)).toBe(first);
    expect((await readFile(path, "utf8")).trim()).toBe(first);
  });

  it("generates a different secret for a new volume", async () => {
    const a = await ensureSharedSecret(join(await mkdtemp(join(tmpdir(), "secret-")), "s"));
    const b = await ensureSharedSecret(join(await mkdtemp(join(tmpdir(), "secret-")), "s"));
    expect(a).not.toBe(b);
  });
});
