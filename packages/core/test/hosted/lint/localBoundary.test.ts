import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { biomeFixtures } from "../../lint/biomeFixture.js";
import { readSourceTree } from "../../lint/boundary.js";
import { localViolations, withAppended } from "../../lint/localRules.js";

const SRC = join(import.meta.dirname, "../../../src");
const LOCAL_MESSAGE = "Hosted code must not use the local store.";

describe("local store boundary on src/", () => {
  const tree = readSourceTree(SRC);

  it("flags injected imports in real files without changing them", () => {
    const before = { deps: readFileSync(join(SRC, "hosted/deps.ts"), "utf8") };
    expect(localViolations(withAppended(tree, "hosted/deps.ts", 'import "@oab/core/local/store/sqliteStore.js";\n'))).toEqual([
      { rule: "B7", file: "hosted/deps.ts", specifier: "@oab/core/local/store/sqliteStore.js" },
    ]);
    expect(readFileSync(join(SRC, "hosted/deps.ts"), "utf8")).toBe(before.deps);
  });
});

describe("Biome enforces B7, B8 and B9", () => {
  const { lint, dispose } = biomeFixtures("local-boundary-");
  afterAll(dispose);
  const real = (file: string) => readFileSync(join(SRC, file), "utf8");

  it("fails lint on the real files with an injected import", () => {
    const deps = lint("core", "src/hosted/deps.ts", `${real("hosted/deps.ts")}import "@oab/core/local/store/sqliteStore.js";\n`);
    expect(deps.out).toContain(LOCAL_MESSAGE);
    expect(deps.status).not.toBe(0);
  });
});
