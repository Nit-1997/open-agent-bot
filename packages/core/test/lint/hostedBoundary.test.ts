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
      'const t = `import "../hosted/d.js" ${"x"}`;',
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
];

describe("hosted boundary rules on fixture trees", () => {
  it.each(blocked)("%s blocks %j", (rule, tree, specifier) => {
    const [file] = Object.keys(tree);
    expect(boundaryViolations(tree)).toContainEqual({ rule, file, specifier });
  });

  it.each(allowed)("allows %s", (_name, tree) => {
    expect(boundaryViolations(tree)).toEqual([]);
  });

  it("keeps B1 and B3 exceptions narrow", () => {
    expect(ENTRIES).toEqual(["server.ts", "scripts/rotateCredentials.ts"]);
    expect(B1_EXCEPTIONS).toEqual([...ENTRIES, "app.ts"]);
    expect(B3_EXCEPTIONS).toEqual(["auth/verify.ts"]);
    expect(boundaryViolations({ "app.ts": 'import { adminRoutes } from "./hosted/http/admin.js";\nimport "jose";\n' })).toEqual([
      { rule: "B3", file: "app.ts", specifier: "jose" },
    ]);
  });
});

describe("hosted boundary on src/", () => {
  const tree = readSourceTree(SRC);

  it("has a hosted folder", () => {
    expect(Object.keys(tree).filter((f) => f.startsWith("hosted/")).length).toBeGreaterThan(10);
  });

  it("has no B1–B4 violations", () => {
    expect(boundaryViolations(tree)).toEqual([]);
  });

  it("still needs every temporary exception", () => {
    const strict = boundaryViolations(tree, { b1: ENTRIES, b3: [] });
    expect(new Set(strict.map((v) => `${v.rule} ${v.file}`))).toEqual(new Set(["B1 app.ts", "B3 auth/verify.ts"]));
  });
});

describe("Biome enforces B1, B3 and B4", () => {
  const { lint, dispose } = biomeFixtures("hosted-boundary-");
  afterAll(dispose);

  const lintBlocked: Array<[string, string]> = [
    ["src/http/chats.ts", 'import x from "../hosted/store/client.js";\nexport default x;\n'],
    ["src/http/chats.ts", 'export const load = () => import("../hosted/admin/service.js");\n'],
    ["src/lib/x.ts", 'import { createClient } from "@supabase/supabase-js";\nexport default createClient;\n'],
    ["src/lib/x.ts", 'import { jwtVerify } from "jose";\nexport default jwtVerify;\n'],
    ["src/lib/x.ts", 'import { UserError } from "@oab/core/lib/errors.js";\nexport default UserError;\n'],
    ["src/lib/x.ts", 'import x from "@oab/core";\nexport default x;\n'],
  ];

  const lintAllowed: Array<[string, string]> = [
    ["src/hosted/store/users.ts", 'import { UserError } from "@oab/core/lib/errors.js";\nexport default UserError;\n'],
    ["src/hosted/store/client.ts", 'import { createClient } from "@supabase/supabase-js";\nexport default createClient;\n'],
    ["src/server.ts", 'import "./hosted/main.js";\n'],
    ["src/scripts/rotateCredentials.ts", 'import { rotateStale } from "../hosted/secrets/rotate.js";\nexport default rotateStale;\n'],
    ["src/app.ts", 'import { adminRoutes } from "./hosted/http/admin.js";\nexport default adminRoutes;\n'],
    ["src/auth/verify.ts", 'import { jwtVerify } from "jose";\nexport default jwtVerify;\n'],
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

  it("still blocks cloud imports where the override applies", () => {
    for (const file of ["src/http/chats.ts", "src/hosted/x.ts"]) {
      const r = lint("core", file, 'import x from "../../cloud/agent/store.ts";\nexport default x;\n');
      expect(r.out).toContain("Nothing outside cloud/ may import from cloud/.");
      expect(r.status).not.toBe(0);
    }
  });
});
