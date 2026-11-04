import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, describe, it } from "node:test";
import {
  assertAllowedCli,
  CLOUD_DIR,
  checkDbUrl,
  checkName,
  envLines,
  FORBIDDEN_ENV,
  LINKED_STATE,
  leftovers,
  MIGRATIONS_DIR,
  main,
  migrationVersions,
  parseArgs,
  parseStatusEnv,
  portsFor,
  Refusal,
  refuseBusyPorts,
  refuseEnv,
  refuseLinkedState,
  renderConfig,
  safeLines,
  selectMigrations,
  TEMPLATE,
  workdirFor,
} from "../scripts/local-stack.mjs";

const scratch = mkdtempSync(join(tmpdir(), "oab-ls-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const refuses = (fn, re) => assert.throws(fn, (e) => e instanceof Refusal && re.test(e.message));
const refusesAsync = (p, re) => assert.rejects(p, (e) => e instanceof Refusal && re.test(e.message));
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const KEY = JSON.stringify({
  kty: "EC",
  kid: "k1",
  use: "sig",
  key_ops: ["sign", "verify"],
  alg: "ES256",
  ext: true,
  d: "d",
  crv: "P-256",
  x: "x",
  y: "y",
});
const STATUS = [
  'API_URL="http://127.0.0.1:18741"',
  'DB_URL="postgresql://postgres:postgres@127.0.0.1:18742/postgres"',
  'PUBLISHABLE_KEY="sb_publishable_ABCdef123"',
  'SECRET_KEY="sb_secret_XYZ789"',
  'SERVICE_ROLE_KEY="eyJhbGciOi.x.y"',
].join("\n");

function fakeCli(calls, { status = STATUS, fail, running = new Set() } = {}) {
  return (args, o = {}) => {
    assertAllowedCli(args);
    calls.push(args);
    const sub = args.slice(2).join(" ");
    if (fail && sub.startsWith(fail)) return { status: 1, stdout: "", stderr: "boom" };
    const stack = basename(args[1]).replace(/^oab-sb-/, "");
    if (sub === "start") running.add(stack);
    if (sub.startsWith("stop")) running.delete(stack);
    if (sub.startsWith("gen signing-key")) {
      writeFileSync(join(args[1], "supabase", "signing_keys.json"), `[${KEY}]\n`);
      return { status: 0, stdout: "", stderr: "" };
    }
    if (sub.startsWith("status")) return { status: 0, stdout: o.capture ? status : "", stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };
}

const deps = (calls, extra = {}) => {
  const lines = [];
  const running = new Set();
  return {
    lines,
    deps: {
      env: {},
      tmp: scratch,
      out: (s) => lines.push(s),
      err: (s) => lines.push(s),
      cli: fakeCli(calls, { ...extra, running }),
      portFree: async () => true,
      docker: (args) => (args[0] === "ps" ? [...running].map((n) => `supabase_db_${n}`) : []),
      ...extra.deps,
    },
  };
};

describe("local-stack.mjs refusals", () => {
  it("accepts only oab-m7-<x> names", () => {
    assert.equal(checkName("oab-m7-b"), "oab-m7-b");
    for (const bad of [
      undefined,
      "",
      "oab-m6-b",
      "oab-m7-",
      "oab-m7-B",
      "oab-m7-a_b",
      "oab-m7-123456789012345678901",
      "x oab-m7-b",
      "open-agent-bot",
    ])
      refuses(() => checkName(bad), /--name must match/);
  });

  it("accepts a port base only inside 18700-18749 with room for 5 ports", () => {
    assert.deepEqual(portsFor("18740"), { base: 18740, shadow: 18740, api: 18741, db: 18742, spare: 18743, mail: 18744 });
    assert.equal(portsFor(18700).api, 18701);
    assert.equal(portsFor(18745).mail, 18749);
    for (const bad of ["18699", "18746", "18750", "8000", "54321", "1874a", "-18740", "18740.5", ""])
      refuses(() => portsFor(bad), /--ports must be/);
  });

  it("refuses a base whose ports are not free", async () => {
    const srv = createServer();
    await new Promise((r) => srv.listen({ port: 0, host: "127.0.0.1" }, r));
    const busy = srv.address().port;
    try {
      await refusesAsync(
        refuseBusyPorts({ base: 18740 }, async (p) => p !== 18742),
        /port 18742 is in use/,
      );
      const { portFree } = await import("../scripts/local-stack.mjs");
      assert.equal(await portFree(busy, "127.0.0.1"), false);
    } finally {
      await new Promise((r) => srv.close(r));
    }
    await refuseBusyPorts({ base: 18740 }, async () => true);
  });

  for (const name of FORBIDDEN_ENV) {
    it(`refuses ${name} in the environment`, async () => {
      refuses(() => refuseEnv({ [name]: "x" }), new RegExp(`refusing to run with ${name} set`));
      const calls = [];
      const { deps: d } = deps(calls);
      await refusesAsync(main(["status", "--name", "oab-m7-t", "--ports", "18740"], { ...d, env: { [name]: "value" } }), new RegExp(name));
      assert.deepEqual(calls, []);
    });
  }

  it("ignores empty forbidden variables and unrelated ones", () => {
    refuseEnv({ SUPABASE_ACCESS_TOKEN: "", OAB_SB_DB_URL: "x" });
  });

  for (const file of LINKED_STATE) {
    it(`refuses a linked-state ${file} file`, () => {
      const dir = join(scratch, `linked-${file}`, ".temp");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, file), "abcdefghijklmnopqrst");
      refuses(() => refuseLinkedState([join(scratch, "nope"), dir]), /linked-project state found/);
    });
  }

  it("ignores other CLI files such as cli-latest", () => {
    const dir = join(scratch, "cli-latest", ".temp");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "cli-latest"), "v2.111.0");
    refuseLinkedState([dir]);
  });

  it("refuses a linked-state file inside the stack workdir before running anything", async () => {
    const work = workdirFor("oab-m7-linked", scratch);
    mkdirSync(join(work, "supabase", ".temp"), { recursive: true });
    writeFileSync(join(work, "supabase", ".temp", "project-ref"), "abcdefghijklmnopqrst");
    const calls = [];
    const { deps: d } = deps(calls);
    await refusesAsync(main(["start", "--name", "oab-m7-linked", "--ports", "18740"], d), /linked-project state/);
    assert.deepEqual(calls, []);
    rmSync(work, { recursive: true, force: true });
  });

  it("accepts --db-url only for 127.0.0.1 on a factory port", () => {
    assert.ok(checkDbUrl("postgresql://postgres:postgres@127.0.0.1:18742/postgres"));
    for (const [bad, re] of [
      ["postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres", /host must be 127\.0\.0\.1/],
      ["postgresql://postgres:pw@aws-0-eu.pooler.supabase.com:5432/postgres", /host must be 127\.0\.0\.1/],
      ["postgresql://postgres:postgres@localhost:18742/postgres", /host must be 127\.0\.0\.1/],
      ["postgresql://postgres:postgres@127.0.0.2:18742/postgres", /host must be 127\.0\.0\.1/],
      ["postgresql://postgres:postgres@127.0.0.1:5432/postgres", /port must be/],
      ["postgresql://postgres:postgres@127.0.0.1/postgres", /port must be/],
      ["http://127.0.0.1:18742", /postgresql:\/\//],
      ["not a url", /not a URL/],
      [
        "postgresql://postgres:postgres@127.0.0.1:18742/postgres?host=db.example.com",
        /no query parameter but sslmode=disable \(got host\)/,
      ],
      ["postgresql://postgres:postgres@127.0.0.1:18742/postgres?hostaddr=10.0.0.1", /got hostaddr/],
      ["postgresql://postgres:postgres@127.0.0.1:18742/postgres?port=5432&sslmode=disable", /got port/],
      ["postgresql://postgres:postgres@127.0.0.1:18742/postgres?sslmode=require", /sslmode must be disable/],
      ["postgresql://postgres:postgres@127.0.0.1:18742/postgres?sslmode=disable&sslmode=require", /sslmode must be disable/],
    ])
      refuses(() => checkDbUrl(bad), re);
    assert.ok(checkDbUrl("postgresql://postgres:postgres@127.0.0.1:18742/postgres?sslmode=disable"));
  });

  it("accepts --migrations-until only for a version in cloud/supabase/migrations", () => {
    const all = migrationVersions();
    assert.ok(all.length >= 12);
    assert.deepEqual(selectMigrations(undefined), all);
    const v = all[2].split("_")[0];
    assert.deepEqual(selectMigrations(v), all.slice(0, 3));
    assert.deepEqual(selectMigrations(all.at(-1).split("_")[0]), all);
    for (const bad of ["20990101000000", "2026110106", all[0], "../x", ""])
      refuses(() => selectMigrations(bad), /is not a migration version/);
  });

  it("allows only the listed supabase commands, always with --workdir and never linked", () => {
    const wd = ["--workdir", "/tmp/oab-sb-oab-m7-b"];
    const db = "postgresql://postgres:postgres@127.0.0.1:18742/postgres";
    for (const ok of [
      ["start"],
      ["stop", "--no-backup"],
      ["status", "-o", "env"],
      ["gen", "signing-key", "--algorithm", "ES256"],
      ["db", "push", "--db-url", db, "--dry-run"],
      ["db", "push", "--db-url", db],
    ])
      assert.deepEqual(assertAllowedCli([...wd, ...ok]), [...wd, ...ok]);
    for (const bad of [
      ["link", "--project-ref", "abcdefghijklmnopqrst"],
      ["link"],
      ["config", "push"],
      ["functions", "deploy"],
      ["secrets", "set", "A=b"],
      ["db", "push"],
      ["db", "push", "--linked"],
      ["db", "push", "--dry-run"],
      ["db", "push", "--db-url", "postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres", "--dry-run"],
      ["db", "push", "--db-url", db, "--include-all"],
      ["db", "reset", "--local"],
      ["db", "reset", "--linked"],
      ["db", "reset"],
      ["db", "reset", "--db-url", db],
      ["stop"],
      ["stop", "--all"],
      ["stop", "--no-backup", "--project-id", "x"],
      ["status"],
      ["status", "-o", "json"],
      ["gen", "types"],
      ["gen", "signing-key", "--algorithm", "RS256"],
      ["start", "--project-ref=abc"],
      ["migration", "repair"],
    ])
      assert.throws(() => assertAllowedCli([...wd, ...bad]), Refusal, bad.join(" "));
    assert.throws(() => assertAllowedCli(["start"]), Refusal);
    assert.throws(() => assertAllowedCli(["status", "--workdir", "/tmp/x"]), Refusal);
  });

  it("refuses other subcommands, unknown options and misplaced flags", () => {
    for (const [argv, re] of [
      [["link", "--name", "oab-m7-b"], /usage/],
      [["db", "--name", "oab-m7-b"], /usage/],
      [[], /usage/],
      [["start", "--name", "oab-m7-b"], /start needs --ports/],
      [["start", "--name", "oab-m7-b", "--ports", "18740", "--linked"], /unknown or incomplete option/],
      [["start", "--name", "oab-m7-b", "--ports", "18740", "--project-ref", "abc"], /unknown or incomplete option/],
      [["start", "--name", "oab-m7-b", "--ports", "18740", "--name", "oab-m7-c"], /given twice/],
      [["stop", "--name", "oab-m7-b", "--migrations-until", "20261101060613"], /start only/],
      [
        ["start", "--name", "oab-m7-b", "--ports", "18740", "--db-url", "postgresql://p:p@127.0.0.1:18742/postgres"],
        /push-dry-run and push only/,
      ],
      [["push-dry-run", "--name", "oab-m7-b", "--db-url", "postgresql://p:p@db.x.supabase.co:5432/postgres"], /host must be 127\.0\.0\.1/],
      [["start", "--name", "oab-m7-b", "--ports", "18740", "--site-url", "https://app.worksimulation.ai"], /--site-url must be/],
      [["start", "--name", "oab-m7-b", "--ports", "18740", "--site-url", "http://localhost:3000"], /--site-url must be/],
    ])
      refuses(() => parseArgs(argv), re);
    assert.equal(
      parseArgs(["start", "--name", "oab-m7-b", "--ports", "18740", "--migrations-until", "20261101060613"]).migrationsUntil,
      "20261101060613",
    );
  });
});

describe("local-stack.mjs config and env", () => {
  const ports = portsFor(18740);
  const config = renderConfig(readFileSync(TEMPLATE, "utf8"), { name: "oab-m7-b", ports, siteUrl: "http://localhost:18721" });

  it("renders the project id, factory ports, issuer, external URL and both hooks", () => {
    assert.doesNotMatch(config, /\{\{|\}\}/);
    assert.match(config, /^project_id = "oab-m7-b"$/m);
    assert.match(config, /^\[api\]\nenabled = true\nport = 18741$/m);
    assert.match(config, /^external_url = "http:\/\/127\.0\.0\.1:18741"$/m);
    assert.match(config, /^jwt_issuer = "http:\/\/127\.0\.0\.1:18741\/auth\/v1"$/m);
    assert.match(config, /^\[db\]\nport = 18742\nshadow_port = 18740$/m);
    assert.match(config, /^\[local_smtp\]\nenabled = true\nport = 18744$/m);
    assert.match(config, /^site_url = "http:\/\/localhost:18721"$/m);
    assert.match(config, /^jwt_expiry = 900$/m);
    assert.match(config, /^enable_signup = true$/m);
    assert.match(config, /^signing_keys_path = "\.\/signing_keys\.json"$/m);
    assert.match(
      config,
      /\[auth\.hook\.before_user_created\]\nenabled = true\nuri = "pg-functions:\/\/postgres\/private\/before_user_created"/,
    );
    assert.match(
      config,
      /\[auth\.hook\.custom_access_token\]\nenabled = true\nuri = "pg-functions:\/\/postgres\/private\/custom_access_token"/,
    );
    for (const section of ["studio", "analytics", "db.pooler", "edge_runtime", "storage.image_transformation"])
      assert.match(config, new RegExp(`^\\[${section.replace(".", "\\.")}\\]\\nenabled = false$`, "m"), section);
    const used = [...config.matchAll(/port = (\d+)/g)].map((m) => Number(m[1]));
    for (const p of used) assert.ok(p >= 18740 && p <= 18744, String(p));
  });

  it("keeps secrets and real hosts out of the template", () => {
    const t = readFileSync(TEMPLATE, "utf8");
    assert.doesNotMatch(t, /supabase\.co|sb_secret_|sb_publishable_|eyJ|password\s*=|secret\s*=/i);
  });

  it("prints only the five OAB_SB_* variables, from the factory ports", () => {
    const lines = envLines(parseStatusEnv(STATUS), ports);
    assert.deepEqual(lines, [
      "export OAB_SB_API_URL='http://127.0.0.1:18741'",
      "export OAB_SB_DB_URL='postgresql://postgres:postgres@127.0.0.1:18742/postgres'",
      "export OAB_SB_PUBLISHABLE_KEY='sb_publishable_ABCdef123'",
      "export OAB_SB_SECRET_KEY='sb_secret_XYZ789'",
      "export OAB_SB_MAIL_URL='http://127.0.0.1:18744'",
    ]);
    refuses(() => envLines(parseStatusEnv('PUBLISHABLE_KEY="a\'b"\nSECRET_KEY="s"'), ports), /usable PUBLISHABLE_KEY/);
    refuses(() => envLines(parseStatusEnv('PUBLISHABLE_KEY="p"'), ports), /usable SECRET_KEY/);
    refuses(() => envLines(parseStatusEnv(`${STATUS}\nAPI_URL="http://127.0.0.1:54321"`), ports), /expected http:\/\/127\.0\.0\.1:18741/);
  });
});

describe("local-stack.mjs main", () => {
  it("start writes the temp workdir (config, byte-identical migrations, a 0600 ES256 key) and runs gen signing-key then start", async () => {
    const calls = [];
    const { deps: d, lines } = deps(calls);
    assert.equal(await main(["start", "--name", "oab-m7-unit", "--ports", "18740", "--migrations-until", "20261101060645"], d), 0);
    const work = workdirFor("oab-m7-unit", scratch);
    assert.deepEqual(calls, [
      ["--workdir", work, "gen", "signing-key", "--algorithm", "ES256"],
      ["--workdir", work, "start"],
    ]);
    assert.equal(statSync(work).mode & 0o777, 0o700);
    const keys = JSON.parse(readFileSync(join(work, "supabase", "signing_keys.json"), "utf8"));
    assert.equal(keys.length, 1);
    assert.equal(keys[0].alg, "ES256");
    assert.equal(statSync(join(work, "supabase", "signing_keys.json")).mode & 0o777, 0o600);
    const copied = readdirSync(join(work, "supabase", "migrations")).sort();
    assert.deepEqual(copied, selectMigrations("20261101060645"));
    assert.equal(copied.length, 4);
    for (const f of copied) assert.equal(sha(join(work, "supabase", "migrations", f)), sha(join(MIGRATIONS_DIR, f)));
    assert.match(readFileSync(join(work, "supabase", "config.toml"), "utf8"), /project_id = "oab-m7-unit"/);
    assert.match(lines.at(-1), /oab-m7-unit started on 127\.0\.0\.1:18740-18744 with 4 migrations/);

    calls.length = 0;
    assert.equal(await main(["env", "--name", "oab-m7-unit"], d), 0);
    assert.deepEqual(calls, [["--workdir", work, "status", "-o", "env"]]);
    assert.equal(lines.filter((l) => l.startsWith("export OAB_SB_")).length, 5);

    calls.length = 0;
    assert.equal(await main(["reset", "--name", "oab-m7-unit"], d), 0);
    assert.deepEqual(calls, [
      ["--workdir", work, "stop", "--no-backup"],
      ["--workdir", work, "gen", "signing-key", "--algorithm", "ES256"],
      ["--workdir", work, "start"],
    ]);
    assert.deepEqual(readdirSync(join(work, "supabase", "migrations")).sort(), selectMigrations("20261101060645"));

    calls.length = 0;
    assert.equal(await main(["push-dry-run", "--name", "oab-m7-unit"], d), 0);
    assert.deepEqual(calls, [
      [
        "--workdir",
        CLOUD_DIR,
        "db",
        "push",
        "--db-url",
        "postgresql://postgres:postgres@127.0.0.1:18742/postgres?sslmode=disable",
        "--dry-run",
      ],
    ]);
    assert.equal(existsSync(join(CLOUD_DIR, "supabase", ".temp")), false);

    calls.length = 0;
    assert.equal(await main(["stop", "--name", "oab-m7-unit"], d), 0);
    assert.deepEqual(calls, [["--workdir", work, "stop", "--no-backup"]]);
    assert.equal(existsSync(work), false);
    assert.match(lines.at(-1), /no containers, volumes or networks remain/);
  });

  it("push removes a .temp it created itself", async () => {
    const calls = [];
    const temp = join(CLOUD_DIR, "supabase", ".temp");
    const { deps: d } = deps(calls, {
      deps: {
        cli: (args) => {
          calls.push(assertAllowedCli(args));
          mkdirSync(temp, { recursive: true });
          writeFileSync(join(temp, "cli-latest"), "v2.111.0");
          return { status: 0, stdout: "", stderr: "" };
        },
      },
    });
    assert.equal(await main(["push", "--name", "oab-m7-unit", "--ports", "18710"], d), 0);
    assert.deepEqual(calls[0].slice(2), [
      "db",
      "push",
      "--db-url",
      "postgresql://postgres:postgres@127.0.0.1:18712/postgres?sslmode=disable",
    ]);
    assert.equal(existsSync(temp), false);
  });

  it("a failing CLI step is reported with its exit code", async () => {
    const calls = [];
    const { deps: d } = deps(calls, { fail: "start" });
    await refusesAsync(main(["start", "--name", "oab-m7-fail", "--ports", "18740"], d), /supabase start failed with exit 1/);
    rmSync(workdirFor("oab-m7-fail", scratch), { recursive: true, force: true });
  });

  it("start refuses busy ports before touching anything", async () => {
    const calls = [];
    const { deps: d } = deps(calls, { deps: { portFree: async (p) => p !== 18741 } });
    await refusesAsync(main(["start", "--name", "oab-m7-busy", "--ports", "18740"], d), /port 18741 is in use/);
    assert.deepEqual(calls, []);
    assert.equal(existsSync(workdirFor("oab-m7-busy", scratch)), false);
  });

  it("stop without state needs --ports, and reports anything left behind", async () => {
    const calls = [];
    const { deps: d } = deps(calls);
    await refusesAsync(main(["stop", "--name", "oab-m7-gone"], d), /no stack state/);
    await refusesAsync(main(["reset", "--name", "oab-m7-gone", "--ports", "18740"], d), /reset needs a stack started by this script/);
    const left = deps(calls, {
      deps: { docker: (args) => (args[0] === "volume" ? ["supabase_db_oab-m7-gone", "supabase_db_other"] : ["supabase_db_oab-m7-gone2"]) },
    });
    assert.equal(await main(["stop", "--name", "oab-m7-gone", "--ports", "18740"], left.deps), 1);
    assert.match(left.lines.at(-1), /left behind: volume supabase_db_oab-m7-gone$/);
  });

  it("stop with nothing running removes a leftover workdir without running the CLI", async () => {
    const calls = [];
    const { deps: d, lines } = deps(calls);
    const work = workdirFor("oab-m7-idle", scratch);
    mkdirSync(join(work, "supabase"), { recursive: true });
    writeFileSync(join(work, "supabase", "config.toml"), 'signing_keys_path = "./signing_keys.json"\n');
    assert.equal(await main(["stop", "--name", "oab-m7-idle", "--ports", "18740"], d), 0);
    assert.deepEqual(calls, []);
    assert.equal(existsSync(work), false);
    assert.match(lines.at(-1), /oab-m7-idle is not running; no containers, volumes or networks remain/);
  });

  it("stop with containers but no workdir writes an empty signing_keys.json before supabase stop", async () => {
    const calls = [];
    const keysAtStop = [];
    let up = true;
    const work = workdirFor("oab-m7-orphan", scratch);
    rmSync(work, { recursive: true, force: true });
    const { deps: d, lines } = deps(calls, {
      deps: {
        docker: (args) => (args[0] === "ps" && up ? ["supabase_db_oab-m7-orphan"] : []),
        cli: (args) => {
          calls.push(assertAllowedCli(args));
          keysAtStop.push(readFileSync(join(work, "supabase", "signing_keys.json"), "utf8"));
          up = false;
          return { status: 0, stdout: "", stderr: "" };
        },
      },
    });
    assert.equal(await main(["stop", "--name", "oab-m7-orphan", "--ports", "18740"], d), 0);
    assert.deepEqual(calls, [["--workdir", work, "stop", "--no-backup"]]);
    assert.deepEqual(keysAtStop, ["[]\n"]);
    assert.equal(existsSync(work), false);
    assert.match(lines.at(-1), /oab-m7-orphan stopped/);
  });

  it("never relays key lines from the CLI output", () => {
    assert.deepEqual(
      safeLines(
        'Applying migration x.sql...\n{"DB_URL":"postgresql://","PUBLISHABLE_KEY":"sb_publishable_a","SECRET_KEY":"sb_secret_b"}\nANON_KEY="eyJx"\n\nStarted.',
      ),
      ["Applying migration x.sql...", "Started."],
    );
  });

  it("leftovers matches only the stack's own suffix", () => {
    const list = (args) =>
      ({
        ps: ["supabase_db_oab-m7-b", "supabase_db_oab-m7-bb", "open-agent-bot-agent-1"],
        volume: ["supabase_storage_oab-m7-b"],
        network: ["supabase_network_oab-m7-b"],
      })[args[0]];
    assert.deepEqual(leftovers("oab-m7-b", list), [
      "container supabase_db_oab-m7-b",
      "volume supabase_storage_oab-m7-b",
      "network supabase_network_oab-m7-b",
    ]);
  });
});
