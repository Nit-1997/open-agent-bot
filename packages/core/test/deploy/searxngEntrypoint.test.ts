import { execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "../../../../deploy-config/searxng/entrypoint.sh");

const run = (file: string) =>
  execFileSync("sh", [SCRIPT, "sh", "-c", 'printf %s "$SEARXNG_SECRET"'], {
    env: { PATH: process.env.PATH, SEARXNG_SECRET_FILE: file },
  }).toString();

describe("SearXNG entrypoint", () => {
  it("generates the secret once, keeps it on the volume and exports it before starting SearXNG", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "searxng-")), "vol", "secret");
    const first = run(file);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await readFile(file, "utf8")).toBe(first);
    expect(run(file)).toBe(first);
  });
});
