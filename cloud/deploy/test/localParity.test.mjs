import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const TWINS = [
  ["local/searxng/settings.yml", "cloud/deploy/searxng/settings.yml"],
  ["local/searxng/entrypoint.sh", "cloud/deploy/searxng/entrypoint.sh"],
  ["local/renderer/seccomp.json", "cloud/deploy/renderer/seccomp.json"],
];

describe("local stack config copies", () => {
  for (const [local, hosted] of TWINS) {
    it(`${local} equals ${hosted} byte for byte`, () => {
      const a = readFileSync(join(ROOT, local));
      const b = readFileSync(join(ROOT, hosted));
      assert.ok(a.length > 0);
      assert.equal(a.equals(b), true);
    });
  }
});
