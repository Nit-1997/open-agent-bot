import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { DATA_DIR, DOMAIN_RE, drift, loadList, localDbUrl, pinnedSha, REFUSAL_CODE } from "../scripts/blocked-domains.mjs";

const source = readFileSync(join(DATA_DIR, "SOURCE.md"), "utf8");
const raw = readFileSync(join(DATA_DIR, "disposable-domains.txt"));

describe("cloud/supabase/data/disposable-domains.txt (CC0, vendored)", () => {
  it("matches the SHA-256 recorded in SOURCE.md, with the pinned commit and the CC0 licence", () => {
    assert.equal(createHash("sha256").update(raw).digest("hex"), pinnedSha(source));
    assert.match(source, /\| Commit \| `[0-9a-f]{40}` \|/);
    assert.match(source, /\| Licence \| CC0 1\.0 Universal/);
    assert.match(source, /https:\/\/github\.com\/disposable-email-domains\/disposable-email-domains/);
  });

  it("has one lower-case domain per line that the database check accepts, no duplicates, and the line count in SOURCE.md", () => {
    const lines = loadList();
    assert.ok(lines.length >= 1000, `${lines.length} lines`);
    for (const l of lines) assert.match(l, DOMAIN_RE);
    assert.equal(new Set(lines).size, lines.length);
    assert.match(source, new RegExp(`\\| Lines \\| ${lines.length} \\|`));
    assert.ok(lines.includes("mailinator.com"));
    for (const big of ["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "proton.me", "example.test"])
      assert.equal(lines.includes(big), false, big);
  });

  it("refuses a list whose hash or lines don't match", () => {
    const dir = mkdtempSync(join(tmpdir(), "oab-domains-"));
    try {
      writeFileSync(join(dir, "SOURCE.md"), source);
      writeFileSync(join(dir, "disposable-domains.txt"), `${raw}evil.example\n`);
      assert.throws(() => loadList(dir), /doesn't match SOURCE\.md/);
      const bad = "Mailinator.COM\n";
      writeFileSync(join(dir, "disposable-domains.txt"), bad);
      writeFileSync(join(dir, "SOURCE.md"), `| SHA-256 | \`${createHash("sha256").update(bad).digest("hex")}\` |`);
      assert.throws(() => loadList(dir), /line 1 isn't a lower-case domain/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("blocked-domains.mjs", () => {
  it("--local accepts only 127.0.0.1 on 18700-18749 and refuses live database env", () => {
    assert.equal(localDbUrl({ OAB_SB_DB_URL: "postgresql://postgres:postgres@127.0.0.1:18742/postgres" }).includes("18742"), true);
    for (const url of [
      "postgresql://postgres:postgres@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
      "postgresql://postgres:postgres@localhost:18742/postgres",
      "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
      "https://127.0.0.1:18742",
      "not a url",
      "postgresql://postgres:postgres@127.0.0.1:18742/postgres?host=db.example.com",
      "postgresql://postgres:postgres@127.0.0.1:18742/postgres?hostaddr=10.0.0.1",
    ])
      assert.throws(
        () => localDbUrl({ OAB_SB_DB_URL: url }),
        (e) => e.code === REFUSAL_CODE,
        url,
      );
    assert.throws(() => localDbUrl({}), /needs OAB_SB_DB_URL/);
    assert.throws(
      () => localDbUrl({ OAB_SB_DB_URL: "postgresql://postgres:postgres@127.0.0.1:18742/postgres?hostaddr=10.0.0.1" }),
      /no query parameter but sslmode=disable \(got hostaddr\)/,
    );
    for (const k of ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF", "SUPABASE_DB_PASSWORD", "SUPABASE_DB_URL", "LIVE_DB_URL"])
      assert.throws(
        () => localDbUrl({ OAB_SB_DB_URL: "postgresql://postgres:postgres@127.0.0.1:18742/postgres", [k]: "x" }),
        new RegExp(k),
      );
  });

  it("computes missing and extra domains", () => {
    assert.deepEqual(drift(["a.com", "b.com", "c.com"], ["c.com", "z.com", "y.com"]), {
      missing: ["a.com", "b.com"],
      extra: ["y.com", "z.com"],
    });
  });
});
