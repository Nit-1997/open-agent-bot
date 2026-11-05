import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURES = ["cloud/deploy-config/test/fixtures/migrations-pre-m6.sha256", "cloud/deploy-config/test/fixtures/migrations-m7.sha256"];
const MIGRATIONS = join(ROOT, "cloud/supabase/migrations");
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const pinnedIn = (fixture) =>
  readFileSync(join(ROOT, fixture), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [hash, name] = l.split(/\s+/);
      return { hash, name };
    });
const [preM6, m7] = FIXTURES.map(pinnedIn);
const pinned = [...preM6, ...m7];

const HANDLE_NEW_USER = /create (?:or replace )?function private\.handle_new_user\(\)[\s\S]*?\$\$;/;
const BEFORE_USER_CREATED = /create (?:or replace )?function private\.before_user_created\(event jsonb\)[\s\S]*?\$\$;/;

describe(`Supabase migrations (cloud/supabase/migrations, pinned by ${FIXTURES.join(" and ")})`, () => {
  const now = readdirSync(MIGRATIONS).sort();

  it("has exactly the pinned migration names, the pre-M6 ones first", () => {
    assert.ok(preM6.length >= 12, `only ${preM6.length} pre-M6 migrations pinned`);
    assert.deepEqual(
      m7.map((p) => p.name),
      ["20261104092535_request_usage.sql", "20261104113650_signup_modes.sql"],
    );
    assert.deepEqual(
      now,
      pinned.map((p) => p.name),
    );
    assert.ok(
      m7.every((p) => p.name > preM6.at(-1).name),
      "the M7 migrations sort after every pre-M6 one",
    );
  });

  it("keeps every migration byte for byte (SHA-256 equal to the pinned file)", () => {
    for (const { hash, name } of pinned) assert.equal(sha(readFileSync(join(MIGRATIONS, name))), hash, name);
  });
});

describe("rollback/m7.sql (Gate 8 rollback)", () => {
  const rollback = readFileSync(join(ROOT, "cloud/supabase/rollback/m7.sql"), "utf8");
  const original = readFileSync(join(MIGRATIONS, "20261101060619_profiles.sql"), "utf8");

  it("restores handle_new_user verbatim from the migration that created it", () => {
    const restored = HANDLE_NEW_USER.exec(rollback)?.[0];
    const created = HANDLE_NEW_USER.exec(original)?.[0];
    assert.ok(restored && created);
    assert.equal(restored, created.replace("create function", "create or replace function"));
  });

  it("restores before_user_created verbatim from the access migration and clears the M7 version comment", () => {
    const access = readFileSync(join(MIGRATIONS, "20261101060633_access.sql"), "utf8");
    const restored = BEFORE_USER_CREATED.exec(rollback)?.[0];
    const created = BEFORE_USER_CREATED.exec(access)?.[0];
    assert.ok(restored && created);
    assert.equal(restored, created.replace("create function", "create or replace function"));
    assert.match(rollback, /^comment on function private\.before_user_created\(jsonb\) is null;$/m);
  });

  it("only replaces function bodies", () => {
    const statements = rollback
      .split("\n")
      .filter((l) => l && !l.startsWith("--"))
      .join("\n");
    assert.doesNotMatch(statements, /\b(drop|delete|truncate|alter table|grant|revoke)\b/i);
  });
});
