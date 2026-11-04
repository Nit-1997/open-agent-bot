import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkPlan,
  M7_MIGRATIONS,
  MIGRATIONS_DIR,
  PRE_M7_CHECKS,
  parsePlan,
  PRE_M7_MIGRATIONS,
  preM7Migrations,
  preM7Query,
  preM7Versions,
} from "../scripts/check-push-plan.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/check-push-plan.mjs", import.meta.url));
const FINISHED = "Finished supabase db push.";

const json = (migrations, { dryRun = true, upToDate = migrations.length === 0 } = {}) =>
  JSON.stringify({ upToDate, dryRun, migrations, seeds: [], roles: [], message: upToDate ? "Remote database is up to date." : FINISHED });
const bullets = (migrations) => ["Would push these migrations:", ...migrations.map((m) => ` • \u001b[1m${m}\u001b[22m`)];
const dryRun = (migrations, opts) =>
  [
    "DRY RUN: migrations will *not* be pushed to the database.",
    "Connecting to remote database...",
    ...(migrations.length ? bullets(migrations) : []),
    json(migrations, opts),
  ].join("\n");

const run = (input, args = []) => spawnSync(process.execPath, [SCRIPT, ...args], { input, encoding: "utf8" });

describe("check-push-plan.mjs (Gate 8 dry-run helper, D21 step 3)", () => {
  it("names the two M7 migrations right after a frozen list of the 12 pre-M7 files in cloud/supabase/migrations", () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    assert.deepEqual(M7_MIGRATIONS, ["20261104092535_request_usage.sql", "20261104113650_signup_modes.sql"]);
    assert.equal(PRE_M7_MIGRATIONS.length, 12);
    assert.ok(Object.isFrozen(PRE_M7_MIGRATIONS));
    assert.deepEqual(files.slice(0, 14), [...PRE_M7_MIGRATIONS, ...M7_MIGRATIONS]);
    assert.deepEqual(preM7Migrations(), [...PRE_M7_MIGRATIONS]);
    assert.deepEqual(
      preM7Versions(),
      PRE_M7_MIGRATIONS.map((f) => f.slice(0, 14)),
    );
  });

  it("keeps the pre-M7 list when a later migration is added (an M8 file never joins the history-repair list)", () => {
    const m8 = "20261201000000_later.sql";
    const r = run(dryRun([...preM7Migrations(), ...M7_MIGRATIONS, m8]));
    assert.equal(r.status, 3);
    assert.match(r.stderr, new RegExp(`${preM7Versions().join(" ")}(?!\\s*20261201000000)`));
    assert.doesNotMatch(preM7Versions().join(" "), /20261201000000/);
    assert.equal(run(dryRun([...M7_MIGRATIONS, m8])).status, 1);
  });

  it("parses the CLI's JSON line and its bullet list, ignoring colour codes", () => {
    assert.deepEqual(parsePlan(dryRun(M7_MIGRATIONS)), {
      dryRun: true,
      upToDate: false,
      migrations: M7_MIGRATIONS,
      bullets: M7_MIGRATIONS,
    });
    assert.deepEqual(parsePlan(dryRun([])), { dryRun: true, upToDate: true, migrations: [], bullets: [] });
    assert.equal(parsePlan("Connecting to remote database...\nerror: password authentication failed\n"), undefined);
    assert.equal(parsePlan('{"migrations": "nope"}'), undefined);
  });

  it("exits 0 for exactly the two M7 files", () => {
    assert.deepEqual(checkPlan(parsePlan(dryRun(M7_MIGRATIONS))).code, 0);
    const r = run(dryRun(M7_MIGRATIONS));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /exactly the two M7 migrations/);
    for (const m of M7_MIGRATIONS) assert.match(r.stdout, new RegExp(m.replace(".", "\\.")));
  });

  it("exits 1 for one extra, one missing, another or a reordered file, naming the difference", () => {
    for (const [plan, why] of [
      [[...M7_MIGRATIONS, "20261105000000_extra.sql"], /extra: 20261105000000_extra\.sql/],
      [[M7_MIGRATIONS[0]], /missing: 20261104113650_signup_modes\.sql/],
      [["20261105000000_other.sql"], /missing: 20261104092535_request_usage\.sql/],
      [[M7_MIGRATIONS[1], M7_MIGRATIONS[0]], /order/],
    ]) {
      const r = run(dryRun(plan));
      assert.equal(r.status, 1, String(plan));
      assert.match(r.stderr, why, String(plan));
      assert.match(r.stderr, /STOP/);
    }
  });

  it("exits 3 when pre-M7 files are listed (history repair needed), with the versions to mark applied", () => {
    const all = [...preM7Migrations(), ...M7_MIGRATIONS];
    const r = run(dryRun(all));
    assert.equal(r.status, 3);
    assert.match(r.stderr, /history repair/i);
    assert.match(r.stderr, /12 pre-M7 migrations/);
    assert.match(r.stderr, new RegExp(preM7Versions().join(" ")));
    assert.equal(run(dryRun([preM7Migrations()[0], ...M7_MIGRATIONS])).status, 3);
  });

  it("exits 2 without a plan, for a real push or when the bullets and the JSON disagree", () => {
    assert.equal(run("").status, 2);
    assert.match(run("error: connection refused\n").stderr, /no dry-run plan/);
    const pushed = run(json(M7_MIGRATIONS, { dryRun: false }));
    assert.equal(pushed.status, 2);
    assert.match(pushed.stderr, /not a dry run/);
    const mixed = [...bullets([M7_MIGRATIONS[0]]), json(M7_MIGRATIONS)].join("\n");
    assert.equal(run(mixed).status, 2);
    assert.match(run(mixed).stderr, /bullet list and the JSON line differ/);
  });

  it("an empty plan is a STOP before the push, and the expected answer with --applied after it", () => {
    const r = run(dryRun([]));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /up to date/);
    const after = run(dryRun([]), ["--applied"]);
    assert.equal(after.status, 0, after.stderr);
    assert.match(after.stdout, /up to date/);
    assert.equal(run(dryRun(M7_MIGRATIONS), ["--applied"]).status, 1);
  });

  it("--pre-m7-versions prints the 12 versions on one line; --pre-m7-query prints one read-only select", () => {
    const v = run("", ["--pre-m7-versions"]);
    assert.equal(v.status, 0);
    assert.equal(v.stdout, `${preM7Versions().join(" ")}\n`);
    const q = run("", ["--pre-m7-query"]);
    assert.equal(q.status, 0);
    assert.equal(q.stdout, `${preM7Query()}\n`);
    assert.match(preM7Query(), /^select coalesce\(string_agg\(problem, '; '\), 'pre-M7 objects present'\) from \(values /);
    assert.doesNotMatch(preM7Query(), /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/i);
    assert.ok(PRE_M7_CHECKS.length >= 10);
    for (const [label] of PRE_M7_CHECKS) assert.ok(preM7Query().includes(`'${label}'`), label);
  });

  it("refuses unknown options and prints only file names", () => {
    const r = run(dryRun(M7_MIGRATIONS), ["--db-url"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /usage/);
    const secret = `postgresql://postgres.ref:hunter2-secret@pooler.example:5432/postgres`;
    const echoed = run(`${secret}\n${dryRun(M7_MIGRATIONS)}`);
    assert.equal(echoed.status, 0);
    assert.ok(!`${echoed.stdout}${echoed.stderr}`.includes("hunter2"));
  });

  it("reads the migrations folder next to the script", () => {
    assert.equal(MIGRATIONS_DIR, join(fileURLToPath(new URL("..", import.meta.url)), "migrations"));
  });
});
