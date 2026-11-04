import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { biomeFixtures } from "../../../../packages/core/test/lint/biomeFixture.js";
import { localViolations, withAppended } from "../../../../packages/core/test/lint/localRules.js";
import { BIOME, hostedSourceTree, SRC } from "../fixtures/sourceTree.js";

const LOCAL_MESSAGE = "Hosted code must not use the local store.";

describe("local store boundary on src/", () => {
  const tree = hostedSourceTree();

  it("flags injected imports in real files without changing them", () => {
    const before = { deps: readFileSync(join(SRC, "deps.ts"), "utf8") };
    expect(localViolations(withAppended(tree, "hosted/deps.ts", 'import "@oab/core/local/store/sqliteStore.js";\n'))).toEqual([
      { rule: "B7", file: "hosted/deps.ts", specifier: "@oab/core/local/store/sqliteStore.js" },
    ]);
    expect(readFileSync(join(SRC, "deps.ts"), "utf8")).toBe(before.deps);
  });
});

describe("Biome enforces B7, B8 and B9", () => {
  const { lint, dispose } = biomeFixtures("local-boundary-");
  afterAll(dispose);
  const real = (file: string) => readFileSync(join(SRC, file), "utf8");

  it.each([
    ["src/deps.ts", 'import "@oab/core/local/store/sqliteStore.js";\n'],
    ["src/x.ts", 'import { DatabaseSync } from "node:sqlite";\nexport default DatabaseSync;\n'],
  ])("blocks %s: %s", (file, code) => {
    const r = lint("agent", file, code, BIOME);
    expect(r.out).toContain(LOCAL_MESSAGE);
    expect(r.status).not.toBe(0);
  });

  it("fails lint on the real files with an injected import", () => {
    const deps = lint("agent", "src/deps.ts", `${real("deps.ts")}import "@oab/core/local/store/sqliteStore.js";\n`, BIOME);
    expect(deps.out).toContain(LOCAL_MESSAGE);
    expect(deps.status).not.toBe(0);
  });
});
