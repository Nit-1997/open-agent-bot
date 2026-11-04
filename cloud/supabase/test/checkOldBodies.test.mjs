import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { BODIES_QUERY, compareBodies, FUNCTIONS, ROLLBACK, rollbackBodies } from "../scripts/check-old-bodies.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/check-old-bodies.mjs", import.meta.url));
const MIGRATIONS = fileURLToPath(new URL("../migrations/", import.meta.url));
const run = (input, args = []) => spawnSync(process.execPath, [SCRIPT, ...args], { input, encoding: "utf8" });

const bodyIn = (file, name) => {
  const sql = readFileSync(`${MIGRATIONS}${file}`, "utf8");
  const at = sql.indexOf(`create function ${name}(`);
  const open = sql.indexOf("$$", at) + 2;
  return sql.slice(open, sql.indexOf("$$", open));
};

const OLD = {
  "private.handle_new_user()": bodyIn("20261101060619_profiles.sql", "private.handle_new_user"),
  "private.before_user_created(jsonb)": bodyIn("20261101060633_access.sql", "private.before_user_created"),
};

describe("check-old-bodies.mjs (Gate 8 step: live bodies match rollback/m7.sql)", () => {
  it("parses both function bodies from rollback/m7.sql, equal to the migrations that created them", () => {
    assert.deepEqual(FUNCTIONS, ["private.handle_new_user()", "private.before_user_created(jsonb)"]);
    assert.ok(ROLLBACK.endsWith("cloud/supabase/rollback/m7.sql"));
    const bodies = rollbackBodies();
    assert.deepEqual(Object.keys(bodies).sort(), [...FUNCTIONS].sort());
    for (const f of FUNCTIONS) {
      assert.ok(OLD[f].includes("begin"), f);
      assert.equal(bodies[f], OLD[f], f);
    }
  });

  it("the query is one read-only select that returns a JSON object of prosrc by signature", () => {
    assert.match(BODIES_QUERY, /^select json_object_agg\(p\.oid::regprocedure::text, p\.prosrc\) from pg_proc p where p\.oid in \(/);
    for (const f of FUNCTIONS) assert.ok(BODIES_QUERY.includes(`'${f}'::regprocedure`), f);
    assert.doesNotMatch(BODIES_QUERY, /\b(insert|update|delete|drop|alter|create|grant|revoke)\b/i);
    const q = run("", ["--query"]);
    assert.equal(q.status, 0);
    assert.equal(q.stdout, `${BODIES_QUERY}\n`);
  });

  it("exits 0 when both live bodies match, naming each function", () => {
    assert.deepEqual(compareBodies(OLD).problems, []);
    const r = run(`${JSON.stringify(OLD)}\n`);
    assert.equal(r.status, 0, r.stderr);
    for (const f of FUNCTIONS) assert.match(r.stdout, new RegExp(`${f.replace(/[()]/g, "\\$&")} matches rollback/m7\\.sql`));
  });

  it("exits 1 when a body differs (the M7 body after the push, or a hand edit on live), without printing the bodies", () => {
    const m7 = { ...OLD, "private.handle_new_user()": `${OLD["private.handle_new_user()"]}  perform 1;\n` };
    const r = run(JSON.stringify(m7));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /private\.handle_new_user\(\) differs from rollback\/m7\.sql/);
    assert.match(r.stderr, /STOP/);
    assert.ok(!r.stderr.includes("perform 1"));
    assert.ok(!r.stderr.includes("invited_emails"));
  });

  it("exits 2 for a missing function, malformed input or an unknown option", () => {
    const one = { "private.handle_new_user()": OLD["private.handle_new_user()"] };
    const missing = run(JSON.stringify(one));
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /private\.before_user_created\(jsonb\) is missing/);
    assert.equal(run("").status, 2);
    assert.equal(run("not json").status, 2);
    assert.equal(run("[]").status, 2);
    assert.equal(run(JSON.stringify(OLD), ["--db-url"]).status, 2);
  });
});
