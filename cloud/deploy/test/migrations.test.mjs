import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const PIN = "4879d41";
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const git = (args) => execFileSync("git", args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });

describe(`Supabase migrations (cloud/supabase/migrations, pinned to ${PIN})`, () => {
  const pinned = git(["ls-tree", "--name-only", `${PIN}:supabase/migrations`])
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .sort();
  const now = readdirSync(join(ROOT, "cloud/supabase/migrations")).sort();

  it(`has exactly the migration names of ${PIN}`, () => {
    assert.ok(pinned.length >= 12, `only ${pinned.length} migrations at ${PIN}`);
    assert.deepEqual(now, pinned);
  });

  it(`keeps every migration byte for byte (SHA-256 equal to ${PIN})`, () => {
    for (const name of pinned) {
      const before = sha(git(["show", `${PIN}:supabase/migrations/${name}`]));
      const after = sha(readFileSync(join(ROOT, "cloud/supabase/migrations", name)));
      assert.equal(after, before, name);
    }
  });
});
