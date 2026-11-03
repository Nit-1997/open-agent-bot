import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ALLOWLIST, BASE_COUNT, ID_ROOTS, REPO, scanIds } from "../ids-static.mjs";

describe("static ids", () => {
  it("finds intrinsic elements without an id only under the roots passed in", () => {
    const repo = mkdtempSync(join(tmpdir(), "ids-static-"));
    try {
      mkdirSync(join(repo, "a"), { recursive: true });
      mkdirSync(join(repo, "b"), { recursive: true });
      writeFileSync(join(repo, "a/One.tsx"), `export const One = (p: object) => <div id="one"><span /><Box /><a {...p} /></div>;`);
      writeFileSync(join(repo, "b/Two.tsx"), `export const Two = () => <p />;`);
      const allowlist = [{ file: join("a", "One.tsx"), tag: "a", reason: "spreads props that carry a required id" }];
      const scan = scanIds({ repo, roots: ["a"], allowlist });
      assert.equal(scan.elements.length, 3);
      assert.equal(scan.covered.length, 2);
      assert.deepEqual(scan.missing, [`${join("a", "One.tsx")}:1 <span>`]);
      assert.deepEqual(scan.unusedAllowlist, []);
      assert.deepEqual(scanIds({ repo, roots: ["b"], allowlist }).unusedAllowlist, allowlist);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("gives every intrinsic JSX element in the ui and web sources an id", () => {
    const { elements, missing } = scanIds({ repo: REPO, roots: ID_ROOTS, allowlist: ALLOWLIST });
    assert.deepEqual(missing, []);
    assert.ok(elements.length >= BASE_COUNT, `${elements.length} elements, expected at least ${BASE_COUNT}`);
  });

  it("scans the ui, web and local-web sources", () => {
    for (const root of ["packages/ui/src", "packages/local-web/src", "web/app", "web/components"]) assert.ok(ID_ROOTS.includes(root), root);
  });

  it("keeps the spread allowlist short, justified and in use", () => {
    assert.ok(ALLOWLIST.length <= 10);
    for (const entry of ALLOWLIST) assert.ok(entry.reason.trim().length > 10, entry.file);
    assert.deepEqual(scanIds({ repo: REPO, roots: ID_ROOTS, allowlist: ALLOWLIST }).unusedAllowlist, []);
  });
});
