import { afterAll, describe, expect, it } from "vitest";
import { biomeFixtures } from "../../../../packages/core/test/lint/biomeFixture.js";
import { boundaryViolations, ENTRIES } from "../../../../packages/core/test/lint/boundary.js";
import { BIOME, hostedSourceTree } from "../fixtures/sourceTree.js";

describe("hosted boundary on src/", () => {
  const tree = hostedSourceTree();

  it("has a hosted folder", () => {
    expect(Object.keys(tree).filter((f) => f.startsWith("hosted/")).length).toBeGreaterThan(10);
  });

  it("has no B1–B6 violations", () => {
    expect(boundaryViolations(tree)).toEqual([]);
  });

  it("needs no temporary exception", () => {
    const strict = boundaryViolations(tree, { b1: ENTRIES, b3: [] });
    expect(strict).toEqual([]);
  });
});

describe("Biome enforces the hosted-side rules in cloud/agent", () => {
  const { lint, dispose } = biomeFixtures("cloud-agent-boundary-");
  afterAll(dispose);
  const lintAgent = (file: string, code: string) => lint("agent", file, code, BIOME);

  it.each([
    ["src/store/users.ts", 'import { UserError } from "@oab/core/lib/errors.js";\nexport default UserError;\n'],
    ["src/store/client.ts", 'import { createClient } from "@supabase/supabase-js";\nexport default createClient;\n'],
    ["src/server.ts", 'import "./deps.js";\n'],
    ["src/scripts/rotateCredentials.ts", 'import { rotateStale } from "../secrets/rotate.js";\nexport default rotateStale;\n'],
    ["src/identity/verify.ts", 'import { jwtVerify } from "jose";\nexport default jwtVerify;\n'],
  ])("allows %s: %s", (file, code) => {
    const r = lintAgent(file, code);
    expect(r.out).not.toContain("noRestrictedImports");
    expect(r.status).toBe(0);
  });

  it("blocks @oab/core/scripts/* inside hosted files", () => {
    const r = lintAgent("src/x.ts", 'import x from "@oab/core/scripts/rotateCredentials.js";\nexport default x;\n');
    expect(r.out).toContain("Scripts are entry points; hosted code must not import them.");
    expect(r.status).not.toBe(0);
  });

  it("allows core paths that only start like hosted or scripts inside hosted files", () => {
    const r = lintAgent(
      "src/x.ts",
      'import x from "@oab/core/hostedLimits.js";\nimport y from "@oab/core/scriptsTool.js";\nexport default [x, y];\n',
    );
    expect(r.out).not.toContain("noRestrictedImports");
    expect(r.status).toBe(0);
  });

  it("blocks local identity modules inside hosted files", () => {
    for (const spec of ["@oab/core/identity/localIdentity.js", "@oab/core/identity/local/identity.js"]) {
      const r = lintAgent("src/deps.ts", `import x from "${spec}";\nexport default x;\n`);
      expect(r.out).toContain("Hosted code must not use a local identity.");
      expect(r.status).not.toBe(0);
    }
  });
});
