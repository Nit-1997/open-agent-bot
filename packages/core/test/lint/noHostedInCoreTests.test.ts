import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { describe, expect, it } from "vitest";
import { importSpecifiers, stringLiterals } from "./boundary.js";

const CORE = join(import.meta.dirname, "../..");
const ROOTS = ["test", "evals"];
const SKIP = new Set(["evals/results", "node_modules"]);
const CODE = /\.(?:[cm]?ts|[cm]?js)$/;

type Via = "import" | "string";
type What = "hosted-src" | "hosted-tests" | "vendor" | "supabase-dir" | "deploy-config" | "evals-login";
type Finding = { file: string; via: Via; what: What; value: string };
type Exemption = { file: string; allow: Array<Via | `${Via}:${What}`>; reason: string };

const EXEMPT: Exemption[] = [
  { file: "test/lint/boundary.ts", allow: ["string"], reason: "the import scanner names hosted/, @supabase/ and jose in its rules" },
  { file: "test/lint/noHostedInCoreTests.test.ts", allow: ["string"], reason: "this rule's own patterns and refusal fixtures" },
  { file: "test/lint/hostedBoundary.test.ts", allow: ["string"], reason: "B1–B6 refusal fixtures" },
  { file: "test/lint/localBoundary.test.ts", allow: ["string"], reason: "B7 refusal fixtures name src/hosted files" },
  { file: "test/lint/selfReference.test.ts", allow: ["string"], reason: "R2 refusal fixtures: @oab/core/hosted/* is not exported" },
  { file: "test/local/importGraph.test.ts", allow: ["string"], reason: "the local graph's hosted, @supabase/* and jose refusal fixtures" },
  {
    file: "test/evals/localTarget.test.ts",
    allow: ["string:vendor"],
    reason: "a test name says --target local never loads @supabase/supabase-js",
  },
  { file: "test/evals/moduleGraph.ts", allow: ["string"], reason: "the probe that proves --target local never loads @supabase/*" },
  {
    file: "test/deploy/copilotTelemetry.test.ts",
    allow: ["string:deploy-config"],
    reason: "reads deploy-config/env.examples; moves to cloud/deploy/test in 6.6 (D3)",
  },
  {
    file: "test/deploy/localConfigParity.test.ts",
    allow: ["string:deploy-config"],
    reason: "compares local/ twins with deploy-config/; moves to cloud/deploy/test in 6.6 (D3)",
  },
];

const resolveFrom = (file: string, specifier: string) => posix.normalize(posix.join(posix.dirname(file), specifier));

function importWhat(file: string, specifier: string): What | undefined {
  if (/^@supabase\//.test(specifier) || /^jose(\/|$)/.test(specifier)) return "vendor";
  if (/^@oab\/core\/hosted(\/|$)/i.test(specifier)) return "hosted-src";
  if (!specifier.startsWith(".")) return undefined;
  const to = resolveFrom(file, specifier).toLowerCase();
  if (to === "src/hosted" || to.startsWith("src/hosted/")) return "hosted-src";
  if (to === "test/hosted" || to.startsWith("test/hosted/")) return "hosted-tests";
  if (to.startsWith("../../supabase/") || to === "../../supabase") return "supabase-dir";
  if (to.startsWith("../../deploy-config/") || to === "../../deploy-config") return "deploy-config";
  if (/^evals\/auth\/hosted(\.[cm]?[jt]s)?$/.test(to)) return "evals-login";
  return undefined;
}

const STRING_RULES: Array<[What, RegExp]> = [
  ["hosted-src", /(^|[^\w-])src\/hosted($|[^\w-])/i],
  ["hosted-src", /@oab\/core\/hosted($|[^\w-])/i],
  ["vendor", /@supabase\//],
  ["vendor", /^jose(\/|$)/],
  ["supabase-dir", /(^|\/)supabase\//],
  ["deploy-config", /(^|[^\w-])deploy-config($|[^\w-])/],
];

function hostedRefs(file: string, code: string): Finding[] {
  const out: Finding[] = [];
  for (const value of importSpecifiers(code)) {
    const what = importWhat(file, value);
    if (what) out.push({ file, via: "import", what, value });
  }
  for (const value of stringLiterals(code)) {
    for (const [what, re] of STRING_RULES) if (re.test(value)) out.push({ file, via: "string", what, value });
  }
  return out;
}

const exempted = (f: Finding) =>
  EXEMPT.some((e) => e.file === f.file && (e.allow.includes(f.via) || e.allow.includes(`${f.via}:${f.what}`)));

function coreFiles(roots = ROOTS): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(join(CORE, dir)).flatMap((name) => {
      const rel = posix.join(dir, name);
      if (name.startsWith(".") || SKIP.has(rel)) return [];
      if (statSync(join(CORE, rel)).isDirectory()) return walk(rel);
      return CODE.test(name) ? [rel] : [];
    });
  return roots.filter((r) => existsSync(join(CORE, r))).flatMap(walk);
}

const scan = (files: string[]) => files.flatMap((f) => hostedRefs(f, readFileSync(join(CORE, f), "utf8")));
const label = (f: Finding) => `${f.file} ${f.via}:${f.what} ${JSON.stringify(f.value)}`;

describe("hosted reference scanner", () => {
  const blocked: Array<[string, string, string, Via, What]> = [
    ["a static import of src/hosted", "test/http/x.test.ts", 'import { a } from "../../src/hosted/routes.js";', "import", "hosted-src"],
    ["a type-only import", "test/x.test.ts", 'import type { V } from "../src/hosted/identity/verify.js";', "import", "hosted-src"],
    ["a dynamic import", "test/a/b.test.ts", 'const m = await import("../../src/hosted/config.js");', "import", "hosted-src"],
    ["a re-export", "test/fixtures/x.ts", 'export { hostedRoutes } from "../../src/hosted/routes.js";', "import", "hosted-src"],
    ["the self-reference", "test/x.test.ts", 'import "@oab/core/hosted/config.js";', "import", "hosted-src"],
    ["@supabase/*", "test/x.test.ts", 'import { createClient } from "@supabase/supabase-js";', "import", "vendor"],
    ["jose", "evals/x.ts", 'import { jwtVerify } from "jose";', "import", "vendor"],
    ["a require of jose", "test/x.test.ts", 'const j = require("jose");', "string", "vendor"],
    [
      "the supabase scripts",
      "test/scripts/x.test.ts",
      'import { a } from "../../../../supabase/scripts/admin.mjs";',
      "import",
      "supabase-dir",
    ],
    [
      "the hosted test harness",
      "test/http/x.test.ts",
      'import { makeHostedApp } from "../hosted/fixtures/hostedApp.js";',
      "import",
      "hosted-tests",
    ],
    ["the hosted evals login", "test/evals/x.test.ts", 'await import("../../evals/auth/hosted.js");', "import", "evals-login"],
    [
      "a deploy-config path string",
      "test/deploy/x.test.ts",
      'const p = join(ROOT, "deploy-config", "searxng");',
      "string",
      "deploy-config",
    ],
    ["a deploy-config file", "evals/x.ts", 'readFileSync(resolve(root, "deploy-config/.env-agent"));', "string", "deploy-config"],
    ["a hosted path in a template", "test/x.test.ts", "const p = `$" + "{CORE}/src/hosted/deps.ts`;", "string", "hosted-src"],
    ["a supabase path in a template", "test/x.test.ts", "const p = `$" + "{ROOT}/supabase/migrations`;", "string", "supabase-dir"],
  ];

  it.each(blocked)("flags %s", (_name, file, code, via, what) => {
    expect(hostedRefs(file, code)).toContainEqual(expect.objectContaining({ file, via, what }));
  });

  it.each([
    ["comments", 'import x from "./x.js";\n// import "../../src/hosted/a.js";\n/* "deploy-config/.env-agent" */'],
    ["core imports", 'import { createApp } from "../src/app.js";\nimport { ALICE } from "./fixtures/users.js";'],
    [
      "names that only contain the words",
      'const a = "hostedLimits"; const b = "my-deploy-configs"; const c = "supabase.co"; const d = "josefine";',
    ],
    ["core paths that only start like hosted", 'import { x } from "../hostedLimits.js";\nimport "../../src/hostedNames.js";'],
  ])("passes %s", (_name, code) => {
    expect(hostedRefs("test/http/x.test.ts", code)).toEqual([]);
  });

  it("still flags a real import in a file whose strings are exempt", () => {
    const findings = hostedRefs("test/lint/hostedBoundary.test.ts", 'import "../../src/hosted/deps.js";\n');
    expect(findings.filter((f) => !exempted(f)).map((f) => `${f.via}:${f.what}`)).toEqual(["import:hosted-src"]);
  });
});

describe("core tests and evals without hosted code", () => {
  const files = coreFiles();
  const findings = scan(files);

  it("scans the core test and evals trees", () => {
    expect(files).toContain("test/app.test.ts");
    expect(files).toContain("evals/run.ts");
    expect(files.some((f) => f.startsWith("test/hosted/"))).toBe(false);
  });

  it("finds no hosted import, @supabase/*, jose, supabase/ or deploy-config/ outside test/hosted", () => {
    expect(findings.filter((f) => !exempted(f)).map(label)).toEqual([]);
  });

  it("keeps every exemption in use, with a reason", () => {
    for (const e of EXEMPT) {
      expect(e.reason.length, e.file).toBeGreaterThan(10);
      expect(files, e.file).toContain(e.file);
      expect(
        findings.some((f) => f.file === e.file && exempted(f)),
        `${e.file} is exempt but has no finding`,
      ).toBe(true);
    }
  });

  it("keeps no hosted test group and no hosted evals login: both live in cloud/agent", () => {
    expect(existsSync(join(CORE, "test/hosted"))).toBe(false);
    expect(existsSync(join(CORE, "evals/auth/hosted.ts"))).toBe(false);
    expect(existsSync(join(CORE, "evals/auth/local.ts"))).toBe(true);
  });
});

describe("core source and manifest without hosted code", () => {
  it("finds no hosted import, @supabase/*, jose, supabase/ or deploy-config/ in src", () => {
    const files = coreFiles(["src"]);
    expect(files).toContain("src/local/main.ts");
    expect(scan(files).map(label)).toEqual([]);
  });

  it("has no hosted folder, server entry or rotation script in src", () => {
    for (const path of ["src/hosted", "src/server.ts", "src/scripts/rotateCredentials.ts"])
      expect(existsSync(join(CORE, path)), path).toBe(false);
  });

  it("depends on no @supabase/* or jose, has no test:supabase and starts the local entry", () => {
    const pkg = JSON.parse(readFileSync(join(CORE, "package.json"), "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies });
    expect(deps.filter((d) => /^@supabase\//.test(d) || d === "jose")).toEqual([]);
    expect(Object.keys(pkg.exports).filter((k) => /hosted/i.test(k))).toEqual([]);
    expect(pkg.scripts["test:supabase"]).toBeUndefined();
    expect(pkg.scripts.start).toBe("node dist/local/main.js");
  });
});
