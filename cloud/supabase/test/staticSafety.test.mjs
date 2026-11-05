import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const SELF = "cloud/supabase/test/staticSafety.test.mjs";

const FORBIDDEN = {
  "remote-cli": /\bsupabase\s+(link|config\s+push|functions\s+deploy|secrets\s+set)\b/g,
  "db-push-not-local": /\bdb\s+push\b(?![^\n]*--db-url\s+["']?postgres(?:ql)?:\/\/[^@\s]*@127\.0\.0\.1:)/g,
  "repair-not-local": /\bmigration\s+repair\b(?![^\n]*--db-url\s+["']?postgres(?:ql)?:\/\/[^@\s]*@127\.0\.0\.1:)/g,
  "reset-not-local": /\bdb\s+reset\b(?![^\n]*--db-url\s+["']?postgres(?:ql)?:\/\/[^@\s]*@127\.0\.0\.1:)/g,
  "project-ref": /--project-ref\b(?![^\n]*--db-url\s+["']?postgres(?:ql)?:\/\/[^@\s]*@127\.0\.0\.1:)/g,
  linked: /--linked\b/g,
  "supabase-co": /\.supabase\.co\b/g,
};

const SCANNED_FILES = [
  "cloud/supabase/scripts/localGuard.mjs",
  "cloud/supabase/scripts/local-stack.mjs",
  "cloud/supabase/scripts/blocked-domains.mjs",
  "cloud/supabase/scripts/managementApi.mjs",
  "cloud/supabase/scripts/gen-types.mjs",
  "cloud/supabase/scripts/check-push-plan.mjs",
  "cloud/supabase/scripts/check-old-bodies.mjs",
];
const SCANNED_DIRS = ["cloud/agent/test/local", "cloud/supabase/test", "scripts/demo/m7"];

const FIXTURES = {
  "cloud/supabase/scripts/local-stack.mjs": {
    counts: { linked: 1, "project-ref": 2 },
    reason: "assertAllowedCli refuses --linked and --project-ref; it never passes them",
  },
  "cloud/supabase/test/localStack.test.mjs": {
    counts: { linked: 3, "supabase-co": 3, "project-ref": 3 },
    reason: "refusal fixtures: linked flags, --project-ref and live database hosts the script must refuse",
  },
  "cloud/supabase/test/genTypes.test.mjs": {
    counts: { linked: 2 },
    reason: "refusal fixtures: gen-types.mjs must refuse --linked and never pass it to the CLI",
  },
  "cloud/supabase/test/blockedDomains.test.mjs": {
    counts: { "supabase-co": 1 },
    reason: "refusal fixture: a live database host that blocked-domains.mjs --local must refuse",
  },
  "cloud/supabase/test/checkPushPlan.test.mjs": {
    counts: { "db-push-not-local": 1 },
    reason: "dry-run output fixture: the CLI's own closing message, fed to check-push-plan.mjs on stdin; nothing runs it",
  },
  "cloud/agent/test/local/harnessGuard.test.ts": {
    counts: { "supabase-co": 3 },
    reason: "refusal fixtures: live API and database hosts the harness must refuse",
  },
};

const OUT_OF_SCOPE = {
  "cloud/supabase/scripts/dev-link.mjs": "hosted e2e helper for the production project (prints a sign-in link); not an M7 file",
  "cloud/supabase/scripts/configure-auth.mjs": "owner tool: writes the production auth config through the Management API",
  "cloud/README.md": "the owner runbook; it names production commands on purpose",
};

const walk = (dir) =>
  existsSync(join(ROOT, dir))
    ? readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
      )
    : [];

const scanned = () =>
  [...SCANNED_FILES.filter((f) => existsSync(join(ROOT, f))), ...SCANNED_DIRS.flatMap(walk)].filter((f) => f !== SELF).sort();

const hits = (text) =>
  Object.fromEntries(
    Object.entries(FORBIDDEN)
      .map(([id, re]) => [id, (text.match(re) ?? []).length])
      .filter(([, n]) => n > 0),
  );

describe("static safety of the M7 executable files (D19, R14)", () => {
  it("detects every forbidden shape", () => {
    const samples = {
      "remote-cli": [
        "supabase link --project-ref abc",
        "npx supabase config push",
        "supabase functions deploy x",
        "supabase  secrets set A=b",
      ],
      "db-push-not-local": [
        "supabase db push",
        "supabase --workdir cloud db push --dry-run",
        "db push --db-url postgresql://postgres:pw@aws-0.pooler.example.com:5432/postgres",
        'db push --db-url "$LIVE_DB_URL"',
      ],
      "repair-not-local": [
        "supabase migration repair --status applied 20261101060613",
        'supabase --workdir cloud migration repair --status applied 1 --db-url "$LIVE_DB_URL"',
      ],
      "reset-not-local": ["supabase db reset", "npx supabase db reset --db-url postgresql://postgres:pw@db.example.com:5432/postgres"],
      "project-ref": ["supabase link --project-ref abc", "--project-ref=abc"],
      linked: ["supabase db push --linked", "supabase db pull --linked"],
      "supabase-co": ["https://abcdefghijklmnopqrst.supabase.co", "db.abcdefghijklmnopqrst.supabase.co:5432"],
    };
    for (const [id, lines] of Object.entries(samples)) for (const line of lines) assert.equal(hits(line)[id], 1, `${id}: ${line}`);
    assert.deepEqual(
      hits("supabase --workdir cloud db push --db-url postgresql://postgres:postgres@127.0.0.1:18712/postgres --dry-run"),
      {},
    );
    assert.deepEqual(hits("supabase start --workdir /tmp/oab-sb-oab-m7-b"), {});
    assert.deepEqual(
      hits(
        "supabase --workdir cloud migration repair --status applied 1 --db-url postgresql://postgres:postgres@127.0.0.1:18712/postgres?sslmode=disable",
      ),
      {},
    );
    assert.deepEqual(hits("supabase db reset --db-url postgresql://postgres:postgres@127.0.0.1:18712/postgres"), {});
  });

  it("scans the M7 files, and the fixture list names only scanned files", () => {
    const files = scanned();
    assert.ok(files.includes("cloud/supabase/scripts/local-stack.mjs"));
    assert.ok(files.includes("cloud/agent/test/local/harness.ts"));
    assert.ok(files.includes("cloud/supabase/test/localStack.test.mjs"));
    for (const f of ["cloud/supabase/scripts/check-push-plan.mjs", "cloud/supabase/scripts/check-old-bodies.mjs", "scripts/demo/m7/lib.sh"])
      assert.ok(files.includes(f), f);
    for (const f of Object.keys(FIXTURES)) assert.ok(files.includes(f), f);
    for (const f of Object.keys(OUT_OF_SCOPE)) {
      assert.ok(existsSync(join(ROOT, f)), f);
      assert.equal(files.includes(f), false, f);
    }
  });

  it("finds no forbidden command outside the listed fixtures", () => {
    const found = {};
    for (const f of scanned()) {
      const h = hits(readFileSync(join(ROOT, f), "utf8"));
      if (Object.keys(h).length) found[f] = h;
    }
    assert.deepEqual(
      found,
      Object.fromEntries(Object.entries(FIXTURES).map(([f, { counts }]) => [f, counts])),
      "a new forbidden command appeared, or a fixture changed (update FIXTURES with a reason)",
    );
  });

  it("keeps the refusals present in the harness, its vitest config and local-stack.mjs (Security M1)", () => {
    const text = (f) => readFileSync(join(ROOT, f), "utf8");
    const harness = text("cloud/agent/test/local/harness.ts");
    const config = text("cloud/agent/vitest.local.config.ts");
    const script = text("cloud/supabase/scripts/local-stack.mjs");
    const guard = text("cloud/supabase/scripts/localGuard.mjs");
    for (const [f, t] of [
      ["vitest.local.config.ts", config],
      ["localGuard.mjs", guard],
    ])
      assert.match(t, /local_stack_only/, f);
    for (const name of ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF", "SUPABASE_DB_PASSWORD", "SUPABASE_DB_URL", "LIVE_DB_URL"])
      assert.match(guard, new RegExp(`"${name}"`), name);
    assert.match(guard, /u\.hostname !== "127\.0\.0\.1"/);
    assert.match(guard, /filter\(\(k\) => k !== "sslmode"\)/);
    assert.match(guard, /ssl\[0\] !== "disable"/);
    for (const [f, t] of [
      ["harness.ts", harness],
      ["local-stack.mjs", script],
      ["blocked-domains.mjs", text("cloud/supabase/scripts/blocked-domains.mjs")],
    ]) {
      assert.match(t, /from "(?:\.\/|\.\.\/\.\.\/\.\.\/supabase\/scripts\/)localGuard\.mjs"/, f);
      assert.match(t, /forbiddenEnvSet\(env\)/, f);
      assert.match(t, /localDbUrlProblem\(raw, /, f);
    }
    assert.match(harness, /\^http:\\\/\\\/127\\\.0\\\.0\\\.1:/);
    assert.match(config, /guardLocalEnv\(process\.env\)/);
    assert.match(config, /process\.exit\(2\)/);
    assert.match(config, /setupFiles:[^\n]*test\/local\/setup\.ts/);
    assert.match(script, /a === "--linked" \|\| a === "--project-ref"/);
    const pkg = JSON.parse(text("cloud/agent/package.json"));
    assert.equal(pkg.scripts["test:local"], "vitest run -c vitest.local.config.ts");
  });

  it("lists each out-of-scope file with its reason", () => {
    for (const [f, reason] of Object.entries(OUT_OF_SCOPE)) assert.ok(reason.length > 20, relative(ROOT, join(ROOT, f)));
  });
});
