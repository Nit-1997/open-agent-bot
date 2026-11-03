import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../../..");

const TWINS: ReadonlyArray<readonly [string, string]> = [
  ["local/searxng/settings.yml", "deploy-config/searxng/settings.yml"],
  ["local/searxng/entrypoint.sh", "deploy-config/searxng/entrypoint.sh"],
  ["local/renderer/seccomp.json", "deploy-config/renderer/seccomp.json"],
];

describe("local stack config copies", () => {
  it.each(TWINS)("%s equals %s byte for byte", (local, hosted) => {
    const a = readFileSync(join(ROOT, local));
    const b = readFileSync(join(ROOT, hosted));
    expect(a.length).toBeGreaterThan(0);
    expect(a.equals(b)).toBe(true);
  });
});
