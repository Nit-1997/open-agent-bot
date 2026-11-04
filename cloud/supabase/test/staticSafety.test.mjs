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
  linked: /--linked\b/g,
  "supabase-co": /\.supabase\.co\b/g,
};

const SCANNED_FILES = ["cloud/supabase/scripts/local-stack.mjs", "cloud/supabase/scripts/blocked-domains.mjs"];
const SCANNED_DIRS = ["cloud/agent/test/local", "cloud/supabase/test", "scripts/demo/m7"];

const FIXTURES = {
  "cloud/supabase/scripts/local-stack.mjs": { counts: { linked: 1 }, reason: "assertAllowedCli refuses --linked; it never passes it" },
  "cloud/supabase/test/localStack.test.mjs": {
    counts: { linked: 3, "supabase-co": 3 },
    reason: "refusal fixtures: linked flags and live database hosts the script must refuse",
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
      linked: ["supabase db push --linked", "db reset --linked"],
      "supabase-co": ["https://abcdefghijklmnopqrst.supabase.co", "db.abcdefghijklmnopqrst.supabase.co:5432"],
    };
    for (const [id, lines] of Object.entries(samples)) for (const line of lines) assert.equal(hits(line)[id], 1, `${id}: ${line}`);
    assert.deepEqual(
      hits("supabase --workdir cloud db push --db-url postgresql://postgres:postgres@127.0.0.1:18712/postgres --dry-run"),
      {},
    );
    assert.deepEqual(hits("supabase start --workdir /tmp/oab-sb-oab-m7-b"), {});
  });

  it("scans the M7 files, and the fixture list names only scanned files", () => {
    const files = scanned();
    assert.ok(files.includes("cloud/supabase/scripts/local-stack.mjs"));
    assert.ok(files.includes("cloud/agent/test/local/harness.ts"));
    assert.ok(files.includes("cloud/supabase/test/localStack.test.mjs"));
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
    for (const [f, t] of [
      ["harness.ts", harness],
      ["vitest.local.config.ts", config],
      ["local-stack.mjs", script],
    ])
      assert.match(t, /local_stack_only/, f);
    for (const name of ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF", "SUPABASE_DB_URL", "LIVE_DB_URL"])
      assert.match(harness, new RegExp(`"${name}"`), name);
    assert.match(harness, /u\.hostname !== "127\.0\.0\.1"/);
    assert.match(harness, /\^http:\\\/\\\/127\\\.0\\\.0\\\.1:/);
    assert.match(config, /guardLocalEnv\(process\.env\)/);
    assert.match(config, /process\.exit\(2\)/);
    assert.match(config, /setupFiles:[^\n]*test\/local\/setup\.ts/);
    for (const name of ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF", "SUPABASE_DB_PASSWORD", "SUPABASE_DB_URL"])
      assert.match(script, new RegExp(`"${name}"`), name);
    assert.match(script, /u\.hostname !== "127\.0\.0\.1"/);
    assert.match(script, /a === "--linked" \|\| a === "--project-ref"/);
    const pkg = JSON.parse(text("cloud/agent/package.json"));
    assert.equal(pkg.scripts["test:local"], "vitest run -c vitest.local.config.ts");
  });

  it("lists each out-of-scope file with its reason", () => {
    for (const [f, reason] of Object.entries(OUT_OF_SCOPE)) assert.ok(reason.length > 20, relative(ROOT, join(ROOT, f)));
  });
});
