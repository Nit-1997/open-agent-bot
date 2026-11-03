import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  B1_EXCEPTIONS,
  B3_EXCEPTIONS,
  boundaryViolations,
  ENTRIES,
  importSpecifiers,
  readSourceTree,
  type SourceTree,
} from "./boundary.js";
import { biomeFixtures } from "./biomeFixture.js";

const SRC = join(import.meta.dirname, "../../src");
const BOUNDARY_MESSAGE = "Core must not import hosted implementations.";

describe("import scanner", () => {
  it("finds static, type-only, side-effect, re-export, multi-line and dynamic imports", () => {
    const code = [
      'import { a } from "./a.js";',
      'import type { B } from "../b.js";',
      'import "./c.js";',
      'export * from "./d.js";',
      'export { e } from "./e.js";',
      "import {\n  f,\n  g,\n} from './fg.js';",
      'const h = await import("./h.js");',
      'const i = () => import(\n  "./i.js"\n);',
    ].join("\n");
    expect(importSpecifiers(code)).toEqual(["./a.js", "../b.js", "./c.js", "./d.js", "./e.js", "./fg.js", "./h.js", "./i.js"]);
  });

  it("ignores comments, strings, templates, regexes and import.meta", () => {
    const code = [
      '// import "../hosted/a.js";',
      '/* export * from "../hosted/b.js"; */',
      "const s = 'import \"../hosted/c.js\"';",
      `const t = \`import "../hosted/d.js" \${"x"}\`;`,
      "const r = /from [\"'](x)[\"']/g;",
      'const u = import.meta.url; const v = "from";',
      'const w = a / b; const y = "import";',
    ].join("\n");
    expect(importSpecifiers(code)).toEqual([]);
  });
});

const blocked: Array<[string, SourceTree, string]> = [
  ["B1", { "http/chats.ts": 'import "../hosted/store/client.js";\n' }, "../hosted/store/client.js"],
  ["B1", { "http/chats.ts": 'import type { Db } from "../hosted/store/client.js";\n' }, "../hosted/store/client.js"],
  ["B1", { "agui/x.ts": 'export const f = () => import("../hosted/admin/service.js");\n' }, "../hosted/admin/service.js"],
  ["B1", { "x.ts": 'export * from "./hosted/store/users.js";\n' }, "./hosted/store/users.js"],
  ["B2", { "hosted/store/users.ts": 'import "../../config.js";\n' }, "../../config.js"],
  ["B2", { "hosted/x.ts": 'import { log } from "../lib/log.js";\n' }, "../lib/log.js"],
  ["B2", { "hosted/x.ts": 'export { log } from "../lib/log.js";\n' }, "../lib/log.js"],
  ["B3", { "http/x.ts": 'import { createClient } from "@supabase/supabase-js";\n' }, "@supabase/supabase-js"],
  ["B3", { "lib/x.ts": 'import { jwtVerify } from "jose";\n' }, "jose"],
  ["B4", { "hosted/x.ts": 'import "@oab/core/hosted/store/client.js";\n' }, "@oab/core/hosted/store/client.js"],
  ["B4", { "lib/x.ts": 'import { UserError } from "@oab/core/lib/errors.js";\n' }, "@oab/core/lib/errors.js"],
  ["B4", { "server.ts": 'import "@oab/core/hosted/main.js";\n' }, "@oab/core/hosted/main.js"],
  ["B4", { "hosted/x.ts": 'import "@oab/core/Hosted/store/client.js";\n' }, "@oab/core/Hosted/store/client.js"],
  ["B4", { "hosted/x.ts": 'import "@oab/core/HOSTED/main.js";\n' }, "@oab/core/HOSTED/main.js"],
  ["B4", { "hosted/x.ts": 'import "@oab/core/hosted";\n' }, "@oab/core/hosted"],
  ["B4", { "hosted/x.ts": 'import "@oab/core/scripts/rotateCredentials.js";\n' }, "@oab/core/scripts/rotateCredentials.js"],
  [
    "B4",
    { "hosted/x.ts": 'export const f = () => import("@oab/core/Scripts/rotateCredentials.js");\n' },
    "@oab/core/Scripts/rotateCredentials.js",
  ],
  ["B4", { "hosted/admin/x.ts": 'export { r } from "@oab/core/SCRIPTS/x.js";\n' }, "@oab/core/SCRIPTS/x.js"],
  ["B6", { "hosted/deps.ts": 'import "@oab/core/identity/localIdentity.js";\n' }, "@oab/core/identity/localIdentity.js"],
  [
    "B6",
    { "hosted/x.ts": 'import type { LocalIdentity } from "@oab/core/identity/local/identity.js";\n' },
    "@oab/core/identity/local/identity.js",
  ],
  ["B6", { "hosted/x.ts": 'export const f = () => import("@oab/core/identity/localLaunch.js");\n' }, "@oab/core/identity/localLaunch.js"],
  ["B6", { "hosted/identity/x.ts": 'import "../../identity/localIdentity.js";\n' }, "../../identity/localIdentity.js"],
];

const allowed: Array<[string, SourceTree]> = [
  [
    "hosted reaching core through the self-reference",
    { "hosted/store/users.ts": 'import { UserError } from "@oab/core/lib/errors.js";\n' },
  ],
  ["hosted importing hosted relatively", { "hosted/admin/service.ts": 'import type { AdminRepo } from "../store/admin.js";\n' }],
  ["vendor imports inside hosted", { "hosted/store/client.ts": 'import { createClient } from "@supabase/supabase-js";\nimport "jose";\n' }],
  ["the server entry", { "server.ts": 'import "./hosted/main.js";\n' }],
  ["the rotation entry", { "scripts/rotateCredentials.ts": 'import { rotateStale } from "../hosted/secrets/rotate.js";\n' }],
  ["names that only contain hosted", { "lib/x.ts": 'import "./hostedLimits.js";\nimport "../unhosted/x.js";\n' }],
  ["core importing core", { "http/chats.ts": 'import type { UserRepos } from "../store/types.js";\n' }],
  ["hosted reaching the identity port", { "hosted/identity/x.ts": 'import type { Identity } from "@oab/core/identity/types.js";\n' }],
  [
    "core paths that only start like hosted or scripts",
    { "hosted/x.ts": 'import "@oab/core/hostedLimits.js";\nimport "@oab/core/scriptsTool.js";\n' },
  ],
  ["core reaching a local identity", { "app.ts": 'import "./identity/localIdentity.js";\n' }],
];

describe("hosted boundary rules on fixture trees", () => {
  it.each(blocked)("%s blocks %j", (rule, tree, specifier) => {
    const [file] = Object.keys(tree);
    expect(boundaryViolations(tree)).toContainEqual({ rule, file, specifier });
  });

  it.each(allowed)("allows %s", (_name, tree) => {
    expect(boundaryViolations(tree)).toEqual([]);
  });

  it("keeps B1 exceptions to the two entries and has no B3 exceptions", () => {
    expect(ENTRIES).toEqual(["server.ts", "scripts/rotateCredentials.ts"]);
    expect(B1_EXCEPTIONS).toEqual(ENTRIES);
    expect(B3_EXCEPTIONS).toEqual([]);
    expect(boundaryViolations({ "app.ts": 'import { adminRoutes } from "./hosted/http/admin.js";\nimport "jose";\n' })).toEqual([
      { rule: "B1", file: "app.ts", specifier: "./hosted/http/admin.js" },
      { rule: "B3", file: "app.ts", specifier: "jose" },
    ]);
    expect(boundaryViolations({ "startAgent.ts": 'import { hostedRoutes } from "./hosted/routes.js";\n' })).toEqual([
      { rule: "B1", file: "startAgent.ts", specifier: "./hosted/routes.js" },
    ]);
  });
});

describe("hosted boundary on src/", () => {
  const tree = readSourceTree(SRC);

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

describe("Biome enforces B1, B3, B4 and B6", () => {
  const { lint, dispose } = biomeFixtures("hosted-boundary-");
  afterAll(dispose);

  const lintBlocked: Array<[string, string]> = [
    ["src/http/chats.ts", 'import x from "../hosted/store/client.js";\nexport default x;\n'],
    ["src/http/chats.ts", 'export const load = () => import("../hosted/admin/service.js");\n'],
    ["src/lib/x.ts", 'import { createClient } from "@supabase/supabase-js";\nexport default createClient;\n'],
    ["src/lib/x.ts", 'import { jwtVerify } from "jose";\nexport default jwtVerify;\n'],
    ["src/lib/x.ts", 'import { UserError } from "@oab/core/lib/errors.js";\nexport default UserError;\n'],
    ["src/lib/x.ts", 'import x from "@oab/core";\nexport default x;\n'],
    ["src/auth/verify.ts", 'import { jwtVerify } from "jose";\nexport default jwtVerify;\n'],
    ["src/app.ts", 'import { adminRoutes } from "./hosted/http/admin.js";\nexport default adminRoutes;\n'],
    ["src/startAgent.ts", 'import { hostedRoutes } from "./hosted/routes.js";\nexport default hostedRoutes;\n'],
  ];

  const lintAllowed: Array<[string, string]> = [
    ["src/hosted/store/users.ts", 'import { UserError } from "@oab/core/lib/errors.js";\nexport default UserError;\n'],
    ["src/hosted/store/client.ts", 'import { createClient } from "@supabase/supabase-js";\nexport default createClient;\n'],
    ["src/server.ts", 'import "./hosted/main.js";\n'],
    ["src/scripts/rotateCredentials.ts", 'import { rotateStale } from "../hosted/secrets/rotate.js";\nexport default rotateStale;\n'],
    ["src/hosted/identity/verify.ts", 'import { jwtVerify } from "jose";\nexport default jwtVerify;\n'],
    ["src/http/chats.ts", 'import type { UserRepos } from "../store/types.js";\nexport type R = UserRepos;\n'],
  ];

  it.each(lintBlocked)("blocks %s: %s", (file, code) => {
    const r = lint("core", file, code);
    expect(r.out).toContain(BOUNDARY_MESSAGE);
    expect(r.status).not.toBe(0);
  });

  it.each(lintAllowed)("allows %s: %s", (file, code) => {
    const r = lint("core", file, code);
    expect(r.out).not.toContain("noRestrictedImports");
    expect(r.status).toBe(0);
  });

  it("blocks @oab/core/hosted/* inside hosted files", () => {
    const r = lint("core", "src/hosted/x.ts", 'import x from "@oab/core/hosted/store/client.js";\nexport default x;\n');
    expect(r.out).toContain("lint/style/noRestrictedImports");
    expect(r.status).not.toBe(0);
  });

  it("blocks @oab/core/scripts/* inside hosted files", () => {
    const r = lint("core", "src/hosted/x.ts", 'import x from "@oab/core/scripts/rotateCredentials.js";\nexport default x;\n');
    expect(r.out).toContain("Scripts are entry points; hosted code must not import them.");
    expect(r.status).not.toBe(0);
  });

  it("allows core paths that only start like hosted or scripts inside hosted files", () => {
    const r = lint(
      "core",
      "src/hosted/x.ts",
      'import x from "@oab/core/hostedLimits.js";\nimport y from "@oab/core/scriptsTool.js";\nexport default [x, y];\n',
    );
    expect(r.out).not.toContain("noRestrictedImports");
    expect(r.status).toBe(0);
  });

  it("blocks local identity modules inside hosted files", () => {
    for (const spec of ["@oab/core/identity/localIdentity.js", "@oab/core/identity/local/identity.js"]) {
      const r = lint("core", "src/hosted/deps.ts", `import x from "${spec}";\nexport default x;\n`);
      expect(r.out).toContain("Hosted code must not use a local identity.");
      expect(r.status).not.toBe(0);
    }
  });

  it("still blocks cloud imports where the override applies", () => {
    for (const file of ["src/http/chats.ts", "src/hosted/x.ts"]) {
      const r = lint("core", file, 'import x from "../../cloud/agent/store.ts";\nexport default x;\n');
      expect(r.out).toContain("Nothing outside cloud/ may import from cloud/.");
      expect(r.status).not.toBe(0);
    }
  });
});
