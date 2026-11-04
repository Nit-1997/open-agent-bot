import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE = "cloud/deploy-config/test/fixtures/migrations-pre-m6.sha256";
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const pinned = readFileSync(join(ROOT, FIXTURE), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    const [hash, name] = l.split(/\s+/);
    return { hash, name };
  });

describe(`Supabase migrations (cloud/supabase/migrations, pinned by ${FIXTURE})`, () => {
  const now = readdirSync(join(ROOT, "cloud/supabase/migrations")).sort();

  it("has exactly the pre-M6 migration names", () => {
    assert.ok(pinned.length >= 12, `only ${pinned.length} migrations pinned`);
    assert.deepEqual(
      now,
      pinned.map((p) => p.name),
    );
  });

  it("keeps every migration byte for byte (SHA-256 equal to the pre-M6 file)", () => {
    for (const { hash, name } of pinned) assert.equal(sha(readFileSync(join(ROOT, "cloud/supabase/migrations", name))), hash, name);
  });
});
